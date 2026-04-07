import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export async function setupTestConfigDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  const configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  return configFile;
}

export async function writeTestConfig(
  configFile: string,
  content: string,
): Promise<void> {
  await writeFile(configFile, content);
}
