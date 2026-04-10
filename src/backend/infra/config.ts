import { readFileSync } from "fs";
import yaml, { YAMLException } from "js-yaml";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod/v4";
import type { PermissionMode } from "@/backend/domain/agent/permission-mode";
import { METADATA_PRESETS } from "./presets";

function getConfigPath(): string {
  return (
    process.env.AITM_CONFIG_PATH ?? join(homedir(), ".aitm", "config.yaml")
  );
}

export type AgentProvider = "claude" | "codex";

const agentProviderSchema = z.enum(["claude", "codex"]);
const permissionModeSchema = z.enum(["plan", "edit", "full"]);

export interface AgentConfig {
  provider: AgentProvider;
  model?: string;
  command?: string;
  permission_mode?: PermissionMode;
}

export type AgentConfigOverride = Partial<AgentConfig>;

export interface ConfigRepositoryCommand {
  id: string;
  label: string;
  command: string;
}

export interface ConfigRepository {
  path: string;
  commands?: ConfigRepositoryCommand[];
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

export interface WorkflowArtifact {
  name: string;
  path: string;
  description?: string;
}

export interface WorkflowSuggestionRule {
  condition: string;
  inputs?: Record<string, string>;
}

export interface WorkflowDefinition {
  label?: string;
  initial_step: string;
  max_steps?: number;
  inputs?: WorkflowInput[];
  artifacts?: WorkflowArtifact[];
  recommended_when?: WorkflowSuggestionRule;
  steps: Record<string, WorkflowStep>;
}

export interface ConfigSnapshot {
  agent: AgentConfig;
  repositories: ConfigRepository[];
  workflows: Record<string, WorkflowDefinition>;
}

const CORE_DECISION_KEYS = new Set([
  "transition",
  "reason",
  "handoff_summary",
  "clarifying_question",
]);

function fail(message: string): never {
  throw new Error(message);
}

const transitionSchema = z
  .object({
    when: z.string(),
    step: z.string().optional(),
    terminal: z.enum(["success", "failure"]).optional(),
  })
  .check((ctx) => {
    if (ctx.value.step !== undefined && ctx.value.terminal !== undefined) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "cannot define both step and terminal",
        path: [],
      });
    }
    if (ctx.value.step === undefined && ctx.value.terminal === undefined) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "must define either step or terminal (success|failure)",
        path: [],
      });
    }
  })
  .transform((val): WorkflowTransition => {
    if (val.step !== undefined) {
      return { step: val.step, when: val.when };
    }
    return { terminal: val.terminal!, when: val.when };
  });

const transitionsSchema = z.array(transitionSchema).nonempty();

const agentConfigSchema = z.object({
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
  command: z.string().optional(),
  permission_mode: permissionModeSchema.optional(),
});

const outputMetadataFieldSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
});

function validatePresets(
  value: unknown,
  path: string,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (value === undefined) return undefined;
  const presets = parseZodWithPath(z.array(z.string()), value, path);
  const entries: [string, OutputMetadataFieldDef][] = [];
  for (let i = 0; i < presets.length; i++) {
    const presetName = presets[i];
    const preset = METADATA_PRESETS[presetName];
    if (!preset) {
      fail(`${path}[${i}] must reference a known preset`);
    }
    entries.push([
      `presets__${presetName}`,
      { type: preset.type, description: preset.description },
    ]);
  }
  return entries.length > 0
    ? (Object.fromEntries(entries) as Record<string, OutputMetadataFieldDef>)
    : undefined;
}

const workflowInputSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  type: z.enum(["text", "multiline-text"]).optional(),
});

const workflowArtifactSchema = z.object({
  path: z.string(),
  description: z.string().optional(),
});

const workflowSuggestionSchema = z.object({
  condition: z.string(),
  inputs: z.record(z.string(), z.string()).optional(),
});

function parseZodWithPath<T>(
  schema: z.ZodType<T>,
  value: unknown,
  path: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const subpath = first.path.length > 0 ? `.${first.path.join(".")}` : "";
  fail(`${path}${subpath} ${first.message}`);
}

function validateOutputMetadata(
  value: unknown,
  path: string,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const entries: [string, OutputMetadataFieldDef][] = [];
  for (const [key, def] of Object.entries(record)) {
    const fieldPath = `${path}.${key}`;
    if (CORE_DECISION_KEYS.has(key)) {
      fail(`${fieldPath} uses a reserved metadata field name`);
    }
    if (typeof def !== "object" || def === null || Array.isArray(def)) {
      fail(`${fieldPath} must be an object`);
    }
    entries.push([
      key,
      parseZodWithPath(outputMetadataFieldSchema, def, fieldPath),
    ]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function validateAgentOutput(
  value: unknown,
  path: string,
): AgentWorkflowStep["output"] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;

  const presetMetadata = validatePresets(record.presets, `${path}.presets`);
  const explicitMetadata = validateOutputMetadata(
    record.metadata,
    `${path}.metadata`,
  );

  const metadata = { ...presetMetadata, ...explicitMetadata };
  return Object.keys(metadata).length > 0 ? { metadata } : undefined;
}

function validateWorkflowStep(value: unknown, path: string): WorkflowStep {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;

  const explicitType = record.type;
  if (
    explicitType !== undefined &&
    explicitType !== "agent" &&
    explicitType !== "command" &&
    explicitType !== "manual-approval"
  ) {
    fail(`${path}.type must be one of: agent, command, manual-approval`);
  }

  const transitions = parseZodWithPath(
    transitionsSchema,
    record.transitions,
    `${path}.transitions`,
  );

  if (explicitType === "manual-approval") {
    for (const key of ["goal", "command", "agent", "output"] as const) {
      if (record[key] !== undefined) {
        fail(`${path} cannot define ${key} for a manual-approval step`);
      }
    }
    return { type: "manual-approval", transitions };
  }

  if (
    explicitType === "agent" ||
    (explicitType === undefined && typeof record.goal === "string")
  ) {
    if (record.command !== undefined) {
      fail(`${path} cannot define command for an agent step`);
    }
    if (typeof record.goal !== "string") fail(`${path}.goal must be a string`);
    return {
      type: "agent",
      goal: record.goal,
      transitions,
      agent:
        record.agent === undefined
          ? undefined
          : (parseZodWithPath(
              agentConfigSchema,
              record.agent,
              `${path}.agent`,
            ) as AgentConfigOverride),
      output: validateAgentOutput(record.output, `${path}.output`),
    };
  }

  if (typeof record.command === "string" || explicitType === "command") {
    if (typeof record.command !== "string")
      fail(`${path}.command must be a string`);
    for (const key of ["goal", "agent", "output"] as const) {
      if (record[key] !== undefined) {
        fail(`${path} cannot define ${key} for a command step`);
      }
    }
    return { type: "command", command: record.command, transitions };
  }

  if (record.command !== undefined) {
    fail(`${path} cannot define command for an agent step`);
  }
  if (typeof record.goal !== "string") fail(`${path}.goal must be a string`);
  return {
    type: "agent",
    goal: record.goal,
    transitions,
    agent:
      record.agent === undefined
        ? undefined
        : (parseZodWithPath(
            agentConfigSchema,
            record.agent,
            `${path}.agent`,
          ) as AgentConfigOverride),
    output: validateAgentOutput(record.output, `${path}.output`),
  };
}

function validateWorkflowDefinition(
  name: string,
  value: unknown,
): WorkflowDefinition {
  const path = `workflows.${name}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;

  if (typeof record.initial_step !== "string") {
    fail(`${path}.initial_step must be a string`);
  }
  if (
    typeof record.steps !== "object" ||
    record.steps === null ||
    Array.isArray(record.steps) ||
    Object.keys(record.steps).length === 0
  ) {
    fail(`${path}.steps must be a non-empty object`);
  }
  if (record.max_steps !== undefined) {
    const maxStepsResult = z.int().positive().safeParse(record.max_steps);
    if (!maxStepsResult.success) {
      fail(`${path}.max_steps must be a positive integer`);
    }
  }

  const inputs =
    record.inputs !== undefined
      ? Object.entries(
          parseZodWithPath(
            z.record(z.string(), workflowInputSchema),
            record.inputs,
            `${path}.inputs`,
          ),
        ).map(([inputName, def]) => ({
          name: inputName,
          label: def.label,
          description: def.description,
          required: def.required,
          type: def.type,
        }))
      : undefined;

  const artifacts =
    record.artifacts !== undefined
      ? Object.entries(
          parseZodWithPath(
            z.record(z.string(), workflowArtifactSchema),
            record.artifacts,
            `${path}.artifacts`,
          ),
        ).map(([artifactName, def]) => {
          if (def.path.trim() === "") {
            fail(`${path}.artifacts.${artifactName}.path must not be empty`);
          }
          if (def.path.startsWith("/") || def.path.includes("\\")) {
            fail(
              `${path}.artifacts.${artifactName}.path must be a relative POSIX path`,
            );
          }

          const segments = def.path.split("/");
          if (segments.some((segment) => segment === "" || segment === ".")) {
            fail(
              `${path}.artifacts.${artifactName}.path must not contain empty or '.' segments`,
            );
          }
          if (segments.includes("..")) {
            fail(
              `${path}.artifacts.${artifactName}.path must not escape the artifact root`,
            );
          }

          return {
            name: artifactName,
            path: def.path,
            description: def.description,
          };
        })
      : undefined;

  const recommended_when =
    record.recommended_when !== undefined
      ? parseZodWithPath(
          workflowSuggestionSchema,
          record.recommended_when,
          `${path}.recommended_when`,
        )
      : undefined;

  const steps = Object.fromEntries(
    Object.entries(record.steps as Record<string, unknown>).map(
      ([stepName, stepDef]) => [
        stepName,
        validateWorkflowStep(stepDef, `${path}.steps.${stepName}`),
      ],
    ),
  );

  if (!(record.initial_step in steps)) {
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
    label:
      typeof record.label === "string"
        ? parseZodWithPath(z.string(), record.label, `${path}.label`)
        : undefined,
    initial_step: record.initial_step,
    max_steps: record.max_steps as number | undefined,
    inputs,
    artifacts,
    recommended_when,
    steps,
  };
}

function validateConfig(raw: unknown): ConfigSnapshot {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("Invalid config root: expected an object");
  }
  const record = raw as Record<string, unknown>;
  if (record.workflows !== undefined && typeof record.workflows !== "object") {
    fail("workflows must be an object");
  }

  const agent: AgentConfig =
    record.agent !== undefined
      ? (() => {
          const parsed = parseZodWithPath(
            agentConfigSchema,
            record.agent,
            "agent",
          );
          return {
            provider: parsed.provider ?? "claude",
            model: parsed.model,
            command: parsed.command,
            permission_mode: parsed.permission_mode as
              | PermissionMode
              | undefined,
          };
        })()
      : { provider: "claude" };

  const repositoryCommandSchema = z.object({
    label: z.string(),
    command: z.string(),
  });

  const rawRepositories =
    record.repositories !== undefined
      ? parseZodWithPath(
          z.array(
            z.object({
              path: z.string(),
              commands: z
                .record(z.string(), repositoryCommandSchema)
                .optional(),
            }),
          ),
          record.repositories,
          "repositories",
        )
      : [];

  const repositories: ConfigRepository[] = rawRepositories.map((r) => {
    const result: ConfigRepository = { path: r.path };
    if (r.commands) {
      result.commands = Object.entries(r.commands).map(([id, def]) => ({
        id,
        label: def.label,
        command: def.command,
      }));
    }
    return result;
  });

  const workflows =
    record.workflows !== undefined
      ? Object.fromEntries(
          Object.entries(record.workflows as Record<string, unknown>).map(
            ([name, def]) => [name, validateWorkflowDefinition(name, def)],
          ),
        )
      : {};

  return { agent, repositories, workflows };
}

export function loadConfig(): ConfigSnapshot {
  const configPath = getConfigPath();
  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
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

export function resolveAgentConfig(
  base: AgentConfig,
  override?: AgentConfigOverride,
): AgentConfig {
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
