import { readFile } from "fs/promises";
import yaml, { YAMLException } from "js-yaml";
import { homedir } from "os";
import { join } from "path";
import type { PermissionMode } from "@/backend/domain/agent/permission-mode";
import { METADATA_PRESETS } from "./presets";

function getConfigPath(): string {
  return (
    process.env.AITM_CONFIG_PATH ?? join(homedir(), ".aitm", "config.yaml")
  );
}

export type AgentProvider = "claude" | "codex";

export interface AgentConfig {
  provider: AgentProvider;
  model?: string;
  command?: string;
  permission_mode?: PermissionMode;
}

export type AgentConfigOverride = Partial<AgentConfig>;

export interface ConfigRepository {
  path: string;
}

export type WorkflowTransition =
  | { step: string; when: string }
  | { terminal: "success" | "failure"; when: string };

export interface OutputMetadataFieldDef {
  type: string;
  description?: string;
}

export interface AgentWorkflowStep {
  type: "agent";
  goal: string;
  transitions: WorkflowTransition[];
  agent?: AgentConfigOverride;
  output?: {
    metadata?: Record<string, OutputMetadataFieldDef>;
  };
}

export interface CommandWorkflowStep {
  type: "command";
  command: string;
  transitions: WorkflowTransition[];
}

export interface ManualApprovalWorkflowStep {
  type: "manual-approval";
  transitions: WorkflowTransition[];
}

export type WorkflowStep =
  | AgentWorkflowStep
  | CommandWorkflowStep
  | ManualApprovalWorkflowStep;

export interface WorkflowInput {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "multiline-text";
}

export interface WorkflowDefinition {
  initial_step: string;
  max_steps?: number;
  inputs?: WorkflowInput[];
  steps: Record<string, WorkflowStep>;
}

interface ConfigSnapshot {
  agent: AgentConfig;
  repositories: ConfigRepository[];
  workflows: Record<string, WorkflowDefinition>;
}

const VALID_AGENT_PROVIDERS = new Set<AgentProvider>(["claude", "codex"]);
const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  "plan",
  "edit",
  "full",
]);
const VALID_INPUT_TYPES = new Set(["text", "multiline-text"]);
const CORE_DECISION_KEYS = new Set(["transition", "reason", "handoff_summary"]);

let configSnapshot: ConfigSnapshot | null = null;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOptionalString(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value;
}

function validateOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
  return value;
}

function validateTransitions(
  value: unknown,
  path: string,
): WorkflowTransition[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must be a non-empty array`);
  }

  return value.map((transition, index) => {
    const transitionPath = `${path}[${index}]`;
    if (!isRecord(transition)) fail(`${transitionPath} must be an object`);
    if (typeof transition.when !== "string") {
      fail(`${transitionPath}.when must be a string`);
    }

    if (typeof transition.step === "string") {
      if (transition.terminal !== undefined) {
        fail(`${transitionPath} cannot define both step and terminal`);
      }
      return { step: transition.step, when: transition.when };
    }

    if (
      transition.terminal === "success" ||
      transition.terminal === "failure"
    ) {
      return { terminal: transition.terminal, when: transition.when };
    }

    fail(
      `${transitionPath} must define either step or terminal (success|failure)`,
    );
  });
}

function validateAgentConfig(
  value: unknown,
  path: string,
  allowPartial: boolean,
): AgentConfig | AgentConfigOverride {
  if (!isRecord(value)) fail(`${path} must be an object`);

  const provider = value.provider;
  if (
    provider !== undefined &&
    !VALID_AGENT_PROVIDERS.has(provider as AgentProvider)
  ) {
    fail(`${path}.provider must be one of: claude, codex`);
  }
  if (!allowPartial && provider === undefined) {
    return {
      provider: "claude",
      model: validateOptionalString(value.model, `${path}.model`),
      command: validateOptionalString(value.command, `${path}.command`),
      permission_mode: validatePermissionMode(
        value.permission_mode,
        `${path}.permission_mode`,
      ),
    };
  }

  return {
    provider: provider as AgentProvider | undefined,
    model: validateOptionalString(value.model, `${path}.model`),
    command: validateOptionalString(value.command, `${path}.command`),
    permission_mode: validatePermissionMode(
      value.permission_mode,
      `${path}.permission_mode`,
    ),
  };
}

function validatePermissionMode(
  value: unknown,
  path: string,
): PermissionMode | undefined {
  if (value === undefined) return undefined;
  if (!VALID_PERMISSION_MODES.has(value as PermissionMode)) {
    fail(`${path} must be one of: plan, edit, full`);
  }
  return value as PermissionMode;
}

function validateRepositories(
  value: unknown,
  path: string,
): ConfigRepository[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${path} must be an array`);

  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) fail(`${entryPath} must be an object`);
    if (typeof entry.path !== "string")
      fail(`${entryPath}.path must be a string`);
    return { path: entry.path };
  });
}

function validateWorkflowInputs(
  value: unknown,
  path: string,
): WorkflowInput[] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`${path} must be an object`);

  return Object.entries(value).map(([name, def]) => {
    const inputPath = `${path}.${name}`;
    if (!isRecord(def)) fail(`${inputPath} must be an object`);
    if (typeof def.label !== "string")
      fail(`${inputPath}.label must be a string`);
    const type = def.type;
    if (type !== undefined && !VALID_INPUT_TYPES.has(String(type))) {
      fail(`${inputPath}.type must be one of: text, multiline-text`);
    }
    return {
      name,
      label: def.label,
      description: validateOptionalString(
        def.description,
        `${inputPath}.description`,
      ),
      required: validateOptionalBoolean(def.required, `${inputPath}.required`),
      type: type as WorkflowInput["type"] | undefined,
    };
  });
}

function validateOutputMetadata(
  value: unknown,
  path: string,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`${path} must be an object`);

  const entries = Object.entries(value).map(([key, def]) => {
    const fieldPath = `${path}.${key}`;
    if (CORE_DECISION_KEYS.has(key)) {
      fail(`${fieldPath} uses a reserved metadata field name`);
    }
    if (!isRecord(def)) fail(`${fieldPath} must be an object`);
    if (typeof def.type !== "string")
      fail(`${fieldPath}.type must be a string`);
    return [
      key,
      {
        type: def.type,
        description: validateOptionalString(
          def.description,
          `${fieldPath}.description`,
        ),
      },
    ] as const;
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function resolvePresetMetadata(
  value: unknown,
  path: string,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${path} must be an array`);

  const entries = value.flatMap((presetName, index) => {
    const presetPath = `${path}[${index}]`;
    if (typeof presetName !== "string") fail(`${presetPath} must be a string`);
    const preset = METADATA_PRESETS[presetName];
    if (!preset) {
      fail(`${presetPath} must reference a known preset`);
    }
    return [
      [
        `presets__${presetName}`,
        { type: preset.type, description: preset.description },
      ] as const,
    ];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function validateAgentOutput(
  value: unknown,
  path: string,
): AgentWorkflowStep["output"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`${path} must be an object`);

  const metadata = {
    ...resolvePresetMetadata(value.presets, `${path}.presets`),
    ...validateOutputMetadata(value.metadata, `${path}.metadata`),
  };

  return Object.keys(metadata).length > 0 ? { metadata } : undefined;
}

function validateWorkflowStep(value: unknown, path: string): WorkflowStep {
  if (!isRecord(value)) fail(`${path} must be an object`);

  const explicitType = value.type;
  if (
    explicitType !== undefined &&
    explicitType !== "agent" &&
    explicitType !== "command" &&
    explicitType !== "manual-approval"
  ) {
    fail(`${path}.type must be one of: agent, command, manual-approval`);
  }

  if (explicitType === "manual-approval") {
    if (value.goal !== undefined) {
      fail(`${path} cannot define goal for a manual-approval step`);
    }
    if (value.command !== undefined) {
      fail(`${path} cannot define command for a manual-approval step`);
    }
    if (value.agent !== undefined) {
      fail(`${path} cannot define agent for a manual-approval step`);
    }
    if (value.output !== undefined) {
      fail(`${path} cannot define output for a manual-approval step`);
    }
    return {
      type: "manual-approval",
      transitions: validateTransitions(
        value.transitions,
        `${path}.transitions`,
      ),
    };
  }

  if (explicitType === "agent") {
    if (value.command !== undefined) {
      fail(`${path} cannot define command for an agent step`);
    }
    if (typeof value.goal !== "string") fail(`${path}.goal must be a string`);
    return {
      type: "agent",
      goal: value.goal,
      transitions: validateTransitions(
        value.transitions,
        `${path}.transitions`,
      ),
      agent:
        value.agent === undefined
          ? undefined
          : (validateAgentConfig(
              value.agent,
              `${path}.agent`,
              true,
            ) as AgentConfigOverride),
      output: validateAgentOutput(value.output, `${path}.output`),
    };
  }

  if (typeof value.command === "string" || explicitType === "command") {
    if (typeof value.command !== "string")
      fail(`${path}.command must be a string`);
    if (value.goal !== undefined) {
      fail(`${path} cannot define goal for a command step`);
    }
    if (value.agent !== undefined) {
      fail(`${path} cannot define agent for a command step`);
    }
    if (value.output !== undefined) {
      fail(`${path} cannot define output for a command step`);
    }
    return {
      type: "command",
      command: value.command,
      transitions: validateTransitions(
        value.transitions,
        `${path}.transitions`,
      ),
    };
  }

  if (value.command !== undefined) {
    fail(`${path} cannot define command for an agent step`);
  }
  if (typeof value.goal !== "string") fail(`${path}.goal must be a string`);
  return {
    type: "agent",
    goal: value.goal,
    transitions: validateTransitions(value.transitions, `${path}.transitions`),
    agent:
      value.agent === undefined
        ? undefined
        : (validateAgentConfig(
            value.agent,
            `${path}.agent`,
            true,
          ) as AgentConfigOverride),
    output: validateAgentOutput(value.output, `${path}.output`),
  };
}

function validateWorkflowDefinition(
  name: string,
  value: unknown,
): WorkflowDefinition {
  const path = `workflows.${name}`;
  if (!isRecord(value)) fail(`${path} must be an object`);
  if (typeof value.initial_step !== "string") {
    fail(`${path}.initial_step must be a string`);
  }
  if (!isRecord(value.steps) || Object.keys(value.steps).length === 0) {
    fail(`${path}.steps must be a non-empty object`);
  }
  if (value.max_steps !== undefined) {
    if (
      typeof value.max_steps !== "number" ||
      !Number.isInteger(value.max_steps) ||
      value.max_steps <= 0
    ) {
      fail(`${path}.max_steps must be a positive integer`);
    }
  }

  const steps = Object.fromEntries(
    Object.entries(value.steps).map(([stepName, stepDef]) => [
      stepName,
      validateWorkflowStep(stepDef, `${path}.steps.${stepName}`),
    ]),
  );

  if (!(value.initial_step in steps)) {
    fail(`${path}.initial_step must reference an existing step`);
  }

  for (const [stepName, stepDef] of Object.entries(steps)) {
    for (const transition of stepDef.transitions) {
      if ("step" in transition && !(transition.step in steps)) {
        fail(
          `${path}.steps.${stepName}.transitions references unknown step ${transition.step}`,
        );
      }
    }
  }

  return {
    initial_step: value.initial_step,
    max_steps: value.max_steps as number | undefined,
    inputs: validateWorkflowInputs(value.inputs, `${path}.inputs`),
    steps,
  };
}

function validateConfig(raw: unknown): ConfigSnapshot {
  if (!isRecord(raw)) fail("Invalid config root: expected an object");
  if (raw.workflows !== undefined && !isRecord(raw.workflows)) {
    fail("workflows must be an object");
  }

  return {
    agent: {
      provider: "claude",
      ...(raw.agent === undefined
        ? {}
        : (validateAgentConfig(raw.agent, "agent", false) as AgentConfig)),
    },
    repositories: validateRepositories(raw.repositories, "repositories"),
    workflows:
      raw.workflows !== undefined
        ? Object.fromEntries(
            Object.entries(raw.workflows).map(([name, def]) => [
              name,
              validateWorkflowDefinition(name, def),
            ]),
          )
        : {},
  };
}

async function loadConfigSnapshot(): Promise<ConfigSnapshot> {
  const configPath = getConfigPath();
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail(`Config file not found: ${configPath}`);
    }
    fail(`Unable to read config: ${configPath}`);
  }

  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (error) {
    const detail = error instanceof YAMLException ? `: ${error.message}` : "";
    fail(`Invalid YAML in config: ${configPath}${detail}`);
  }

  try {
    return validateConfig(raw ?? {});
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${error.message} (${configPath})`);
    }
    throw error;
  }
}

function requireConfigSnapshot(): ConfigSnapshot {
  if (!configSnapshot) {
    fail("Configuration has not been initialized");
  }
  return configSnapshot;
}

export async function initializeConfig(): Promise<void> {
  if (configSnapshot) return;
  configSnapshot = await loadConfigSnapshot();
}

export function resetConfigForTests(): void {
  configSnapshot = null;
}

export async function getConfigRepositories(): Promise<ConfigRepository[]> {
  return requireConfigSnapshot().repositories;
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return requireConfigSnapshot().agent;
}

export async function resolveAgentConfig(
  override?: AgentConfigOverride,
): Promise<AgentConfig> {
  const base = requireConfigSnapshot().agent;
  const inheritsProviderFields =
    override?.provider === undefined || override.provider === base.provider;

  return {
    provider: override?.provider ?? base.provider,
    model: override?.model ?? (inheritsProviderFields ? base.model : undefined),
    command:
      override?.command ?? (inheritsProviderFields ? base.command : undefined),
    permission_mode:
      override?.permission_mode ??
      (inheritsProviderFields ? base.permission_mode : undefined),
  };
}

export async function getConfigWorkflows(): Promise<
  Record<string, WorkflowDefinition>
> {
  return requireConfigSnapshot().workflows;
}
