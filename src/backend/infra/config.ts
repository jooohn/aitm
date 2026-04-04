import { readFile } from "fs/promises";
import yaml from "js-yaml";
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
    presets?: string[];
    metadata?: Record<string, OutputMetadataFieldDef>;
  };
}

export interface CommandWorkflowStep {
  type: "command";
  command: string;
  transitions: WorkflowTransition[];
}

export type WorkflowStep = AgentWorkflowStep | CommandWorkflowStep;

export interface WorkflowInput {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "multiline-text";
}

interface WorkflowInputDef {
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "multiline-text";
}

interface RawWorkflowDefinition {
  initial_step: string;
  inputs?: Record<string, WorkflowInputDef>;
  steps?: Record<string, WorkflowStep>;
}

export interface WorkflowDefinition {
  initial_step: string;
  inputs?: WorkflowInput[];
  steps: Record<string, WorkflowStep>;
}

interface RawConfig {
  agent?: Partial<AgentConfig>;
  repositories?: ConfigRepository[];
  workflows?: Record<string, RawWorkflowDefinition>;
}

function normalizeAgentConfigOverride(
  raw: AgentConfigOverride | undefined,
): AgentConfigOverride | undefined {
  if (!raw) return undefined;
  return {
    provider: raw.provider,
    model: raw.model,
    command: raw.command,
    permission_mode: raw.permission_mode,
  };
}

const CORE_DECISION_KEYS = new Set(["transition", "reason", "handoff_summary"]);

function normalizeOutputMetadata(
  raw: unknown,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([key, def]) =>
      !CORE_DECISION_KEYS.has(key) &&
      def !== null &&
      typeof def === "object" &&
      typeof (def as Record<string, unknown>).type === "string",
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([key, def]) => {
      const d = def as Record<string, unknown>;
      const field: OutputMetadataFieldDef = { type: d.type as string };
      if (typeof d.description === "string") field.description = d.description;
      return [key, field];
    }),
  );
}

function resolvePresets(
  presets: string[] | undefined,
): Record<string, OutputMetadataFieldDef> | undefined {
  if (!presets || !Array.isArray(presets)) return undefined;
  const entries = presets
    .filter((name) => name in METADATA_PRESETS)
    .map((name) => {
      const preset = METADATA_PRESETS[name];
      return [
        `presets__${name}`,
        { type: preset.type, description: preset.description },
      ] as const;
    });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function normalizeOutput(
  raw: AgentWorkflowStep["output"],
): AgentWorkflowStep["output"] | undefined {
  if (!raw) return undefined;
  const presetMetadata = resolvePresets(raw.presets);
  const explicitMetadata = normalizeOutputMetadata(raw.metadata);
  const metadata =
    presetMetadata || explicitMetadata
      ? { ...presetMetadata, ...explicitMetadata }
      : undefined;
  if (!metadata) return undefined;
  return { metadata };
}

function normalizeWorkflowStep(
  raw: Exclude<WorkflowStep, "type">,
): WorkflowStep {
  if ("goal" in raw) {
    return {
      type: "agent",
      goal: raw.goal,
      transitions: raw.transitions,
      agent: normalizeAgentConfigOverride(raw.agent),
      output: normalizeOutput(raw.output),
    };
  }

  return {
    type: "command",
    command: raw.command,
    transitions: raw.transitions,
  };
}

function normalizeWorkflow(raw: RawWorkflowDefinition): WorkflowDefinition {
  const inputs = raw.inputs
    ? Object.entries(raw.inputs).map(([name, def]) => ({ name, ...def }))
    : undefined;
  const steps = raw.steps ?? {};
  return {
    ...raw,
    inputs,
    steps: Object.fromEntries(
      Object.entries(steps).map(([name, step]) => [
        name,
        normalizeWorkflowStep(step),
      ]),
    ),
  };
}

async function readConfig(): Promise<RawConfig> {
  const configPath = getConfigPath();
  try {
    const content = await readFile(configPath, "utf-8");
    const raw = yaml.load(content);
    if (raw && typeof raw === "object") return raw as RawConfig;
    return {};
  } catch {
    return {};
  }
}

export async function getConfigRepositories(): Promise<ConfigRepository[]> {
  return (await readConfig()).repositories ?? [];
}

export async function getAgentConfig(): Promise<AgentConfig> {
  const raw = (await readConfig()).agent;
  return {
    provider: raw?.provider ?? "claude",
    model: raw?.model,
    command: raw?.command,
    permission_mode: raw?.permission_mode,
  };
}

export async function resolveAgentConfig(
  override?: AgentConfigOverride,
): Promise<AgentConfig> {
  const base = await getAgentConfig();
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
  const raw = (await readConfig()).workflows ?? {};
  return Object.fromEntries(
    Object.entries(raw).map(([name, def]) => [name, normalizeWorkflow(def)]),
  );
}
