import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    setupFiles: ["src/test-setup.ts"],
    env: {
      AITM_DB_PATH: ":memory:",
      HOME: "/tmp/aitm-vitest-home",
      NODE_ENV: "test",
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
