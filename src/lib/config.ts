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

interface Config {
  repositories?: ConfigRepository[];
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
