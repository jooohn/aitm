import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { homedir } from "os";
import { join } from "path";

function getConfigPath(): string {
  return (
    process.env.AITM_CONFIG_PATH ?? join(homedir(), ".aitm", "config.yaml")
  );
}

export interface ConfigRepository {
  path: string;
}

export type WorkflowTransition =
  | { state: string; when: string }
  | { terminal: "success" | "failure"; when: string };

export interface WorkflowState {
  goal: string;
  transitions: WorkflowTransition[];
}

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
  states: Record<string, WorkflowState>;
}

export interface WorkflowDefinition {
  initial_state: string;
  inputs?: WorkflowInput[];
  states: Record<string, WorkflowState>;
}

interface RawConfig {
  repositories?: ConfigRepository[];
  workflows?: Record<string, RawWorkflowDefinition>;
}

function normalizeWorkflow(raw: RawWorkflowDefinition): WorkflowDefinition {
  const inputs = raw.inputs
    ? Object.entries(raw.inputs).map(([name, def]) => ({ name, ...def }))
    : undefined;
  return { ...raw, inputs };
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

export function getConfigWorkflows(): Record<string, WorkflowDefinition> {
  const raw = readConfig().workflows ?? {};
  return Object.fromEntries(
    Object.entries(raw).map(([name, def]) => [name, normalizeWorkflow(def)]),
  );
}
