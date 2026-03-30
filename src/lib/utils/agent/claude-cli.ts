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

  // Collect stderr so we can surface it if the process produces no output.
  let stderrOutput = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString("utf8");
  });

  try {
    let hadOutput = false;
    for await (const line of rl) {
      if (!line.trim()) continue;
      hadOutput = true;
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

    // If the process exited without producing any output, surface stderr as an error.
    if (!hadOutput && stderrOutput.trim()) {
      throw new Error(
        `claude CLI exited with no output: ${stderrOutput.trim()}`,
      );
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
