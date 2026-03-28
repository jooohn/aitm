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

export interface WorkflowDefinition {
  initial_state: string;
  states: Record<string, WorkflowState>;
}

interface Config {
  repositories?: ConfigRepository[];
  workflows?: Record<string, WorkflowDefinition>;
}

function readConfig(): Config {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  const raw = yaml.load(readFileSync(configPath, "utf-8"));
  if (raw && typeof raw === "object") return raw as Config;
  return {};
}

export function getConfigRepositories(): ConfigRepository[] {
  return readConfig().repositories ?? [];
}

export function getConfigWorkflows(): Record<string, WorkflowDefinition> {
  return readConfig().workflows ?? {};
}
