import { existsSync, readFileSync } from "fs";
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

export interface GoalWorkflowState {
  goal: string;
  transitions: WorkflowTransition[];
  agent?: AgentConfigOverride;
}

export interface CommandWorkflowState {
  command: string;
  transitions: WorkflowTransition[];
}

export type WorkflowState = GoalWorkflowState | CommandWorkflowState;

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

function normalizeWorkflowState(raw: WorkflowState): WorkflowState {
  if ("goal" in raw) {
    return {
      goal: raw.goal,
      transitions: raw.transitions,
      agent: normalizeAgentConfigOverride(raw.agent),
    };
  }

  return {
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

function readConfig(): RawConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  const raw = yaml.load(readFileSync(configPath, "utf-8"));
  if (raw && typeof raw === "object") return raw as RawConfig;
  return {};
}

export function getConfigRepositories(): ConfigRepository[] {
  return readConfig().repositories ?? [];
}

export function getAgentConfig(): AgentConfig {
  const raw = readConfig().agent;
  return {
    provider: raw?.provider ?? "claude",
    model: raw?.model,
    command: raw?.command,
  };
}

export function resolveAgentConfig(
  override?: AgentConfigOverride,
): AgentConfig {
  const base = getAgentConfig();
  const inheritsProviderFields =
    override?.provider === undefined || override.provider === base.provider;

  return {
    provider: override?.provider ?? base.provider,
    model: override?.model ?? (inheritsProviderFields ? base.model : undefined),
    command:
      override?.command ?? (inheritsProviderFields ? base.command : undefined),
  };
}

export function getConfigWorkflows(): Record<string, WorkflowDefinition> {
  const raw = readConfig().workflows ?? {};
  return Object.fromEntries(
    Object.entries(raw).map(([name, def]) => [name, normalizeWorkflow(def)]),
  );
}
