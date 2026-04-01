import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildTransitionOutputFormatForClaude } from "@/backend/domain/agent/claude-common";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
} from "./runtime";

interface SpawnClaudeParams {
  prompt: string;
  cwd: string;
  command?: string;
  model?: string;
  permissionMode: string;
  abortController: AbortController;
  outputFormat?: { type: string; schema: Record<string, unknown> };
  resumeSessionId?: string;
}

async function* spawnClaude(
  params: SpawnClaudeParams,
): AsyncIterable<AgentMessage> {
  const {
    prompt,
    cwd,
    command,
    model,
    permissionMode,
    abortController,
    outputFormat,
    resumeSessionId,
  } = params;

  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    permissionMode,
  ];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  if (outputFormat?.type === "json_schema") {
    args.push("--json-schema", JSON.stringify(outputFormat.schema));
  }

  if (model) {
    args.push("--model", model);
  }

  const spawnInput = { command: command ?? "claude", args, cwd };
  console.log(JSON.stringify(spawnInput));
  const child = spawn(spawnInput.command, spawnInput.args, {
    cwd: spawnInput.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Capture spawn errors (e.g. ENOENT when the claude binary is not installed)
  // so they surface through the generator rather than as unhandled events.
  let spawnError: Error | null = null;
  child.on("error", (err) => {
    spawnError = err;
  });
  child.stdin!.on("error", () => {});
  child.stderr!.on("error", () => {});

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
      yield message as unknown as AgentMessage;
    }

    // If the process failed to spawn (e.g. binary not found), surface that error.
    if (spawnError) {
      throw spawnError;
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

export const claudeCLI: AgentRuntime = {
  query: (params) => spawnClaude(params),

  resume: (params) =>
    spawnClaude({
      ...params,
      permissionMode: params.permissionMode,
      resumeSessionId: params.agentSessionId,
    }),

  buildTransitionOutputFormat: buildTransitionOutputFormatForClaude,
};
