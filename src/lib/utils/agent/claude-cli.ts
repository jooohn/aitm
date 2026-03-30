import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeQueryParams, ClaudeStub } from "./claude-stub";

async function* spawnClaudeQuery(
  params: ClaudeQueryParams,
): AsyncIterable<SDKMessage> {
  const { prompt, cwd, permissionMode, abortController, outputFormat } = params;

  const child = spawn(
    "claude",
    [
      "--print",
      "--output-format",
      "stream-json",
      "--permission-mode",
      permissionMode,
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  );

  const onAbort = () => child.kill("SIGTERM");
  abortController.signal.addEventListener("abort", onAbort, { once: true });

  child.stdin!.write(prompt, "utf8");
  child.stdin!.end();

  const rl = createInterface({
    input: child.stdout!,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as SDKMessage;
      // Populate structured_output by parsing the result text when outputFormat is set.
      if (
        message.type === "result" &&
        message.subtype === "success" &&
        outputFormat &&
        message.result
      ) {
        try {
          (message as Record<string, unknown>).structured_output = JSON.parse(
            message.result,
          );
        } catch {
          // Not valid JSON — leave structured_output undefined.
        }
      }
      yield message;
    }
  } finally {
    abortController.signal.removeEventListener("abort", onAbort);
    rl.close();
    if (!child.killed) child.kill("SIGTERM");
  }
}

export const claudeCLI: ClaudeStub = {
  query: spawnClaudeQuery,
};
