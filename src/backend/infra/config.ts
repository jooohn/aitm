import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { homedir } from "os";
import { join } from "path";

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
}

export type AgentConfigOverride = Partial<AgentConfig>;

export interface ConfigRepository {
  path: string;
}

export type WorkflowTransition =
  | { state: string; when: string }
  | { terminal: "success" | "failure"; when: string };

export interface AgentWorkflowState {
  type: "agent";
  goal: string;
  transitions: WorkflowTransition[];
  agent?: AgentConfigOverride;
}

export interface CommandWorkflowState {
  type: "command";
  command: string;
  transitions: WorkflowTransition[];
}

export type WorkflowState = AgentWorkflowState | CommandWorkflowState;

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
  initial_state: string;
  inputs?: Record<string, WorkflowInputDef>;
  states?: Record<string, WorkflowState>;
}

export interface WorkflowDefinition {
  initial_state: string;
  inputs?: WorkflowInput[];
  states: Record<string, WorkflowState>;
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
  };
}

function normalizeWorkflowState(
  raw: Exclude<WorkflowState, "type">,
): WorkflowState {
  if ("goal" in raw) {
    return {
      type: "agent",
      goal: raw.goal,
      transitions: raw.transitions,
      agent: normalizeAgentConfigOverride(raw.agent),
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
  const states = raw.states ?? {};
  return {
    ...raw,
    inputs,
    states: Object.fromEntries(
      Object.entries(states).map(([name, state]) => [
        name,
        normalizeWorkflowState(state),
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
