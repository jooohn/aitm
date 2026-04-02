import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { logger } from "@/backend/infra/logger";
import { toCodexConfig } from "./permission-mode";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentRuntime,
  OutputFormat,
  SessionTransition,
} from "./runtime";
import { USER_INPUT_TRANSITION_NAME } from "./runtime";

function extractTextBlocks(event: unknown): string[] {
  if (!event || typeof event !== "object") return [];
  const record = event as Record<string, unknown>;

  const directText = record.text;
  if (typeof directText === "string" && directText.trim() !== "") {
    return [directText];
  }

  const delta = record.delta;
  if (typeof delta === "string" && delta.trim() !== "") {
    return [delta];
  }

  const message = record.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === "string" && text.trim() !== "" ? [text] : [];
  });
}

function extractEventType(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" && type.trim() !== "" ? type : null;
}

function extractMessage(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const message = (event as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== ""
    ? message
    : undefined;
}

async function* spawnCodexQuery(
  params: AgentQueryParams,
): AsyncIterable<AgentMessage> {
  const {
    prompt,
    cwd,
    command,
    model,
    permissionMode,
    abortController,
    outputFormat,
  } = params;

  const tempDir = await mkdtemp(join(tmpdir(), "aitm-codex-"));
  const schemaPath = join(tempDir, "output-schema.json");
  const outputPath = join(tempDir, "last-message.json");

  if (outputFormat?.type === "json_schema") {
    await writeFile(schemaPath, JSON.stringify(outputFormat.schema), "utf8");
  }

  const codexConfig = toCodexConfig(permissionMode);
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    codexConfig.sandboxMode,
    "--output-last-message",
    outputPath,
    "-C",
    cwd,
  ];

  if (outputFormat?.type === "json_schema") {
    args.push("--output-schema", schemaPath);
  }

  if (model) {
    args.push("--model", model);
  }

  const spawnInput = { command: command ?? "codex", args, cwd };
  logger.info(spawnInput, "Spawning codex CLI");
  const child = spawn(spawnInput.command, spawnInput.args, {
    cwd: spawnInput.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

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

  yield {
    type: "system",
    subtype: "init",
  };

  const rl = createInterface({
    input: child.stdout!,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let stderrOutput = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString("utf8");
  });

  let exitCode: number | null = null;
  const exitPromise = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: unknown;
      try {
        event = JSON.parse(line);
        logger.debug({ event }, "codex line output");
      } catch {
        continue;
      }

      const texts = extractTextBlocks(event);
      for (const text of texts) {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text }] },
        };
      }

      if (texts.length === 0) {
        const eventType = extractEventType(event);
        if (eventType) {
          yield {
            type: "event",
            event_type: eventType,
            message: extractMessage(event),
            detail: event,
          };
        }
      }
    }

    exitCode = await exitPromise;
    if (spawnError) throw spawnError;

    let resultText = "";
    try {
      resultText = (await readFile(outputPath, "utf8")).trim();
    } catch {
      // Leave empty if the CLI did not write a final message file.
    }

    let structuredOutput: unknown;
    if (resultText) {
      try {
        structuredOutput = JSON.parse(resultText);
      } catch {
        // Leave undefined if the final message is plain text.
      }
    }

    yield {
      type: "result",
      subtype: exitCode === 0 ? "success" : "error",
      result: resultText || stderrOutput.trim() || undefined,
      structured_output: structuredOutput,
    };
  } finally {
    abortController.signal.removeEventListener("abort", onAbort);
    rl.close();
    if (!child.killed) child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildTransitionOutputFormatForCodex(
  transitions: SessionTransition[],
): OutputFormat {
  const transitionNames = transitions.map((t) => {
    if ("user_input" in t) return USER_INPUT_TRANSITION_NAME;
    if ("state" in t) return t.state;
    return t.terminal;
  });

  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties: {
        transition: {
          type: "string",
          enum: transitionNames,
        },
        reason: { type: "string" },
        handoff_summary: { type: "string" },
      },
      required: ["transition", "reason", "handoff_summary"],
      additionalProperties: false,
    },
  };
}

export const codexCLI: AgentRuntime = {
  query: spawnCodexQuery,
  resume: () => {
    throw new Error("codex CLI resume not supported; use codex SDK");
  },
  buildTransitionOutputFormat: buildTransitionOutputFormatForCodex,
};
