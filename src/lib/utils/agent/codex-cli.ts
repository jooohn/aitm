import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentMessage, AgentQueryParams, AgentRuntime } from "./runtime";

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
  const { prompt, cwd, command, model, abortController, outputFormat } = params;

  const tempDir = mkdtempSync(join(tmpdir(), "aitm-codex-"));
  const schemaPath = join(tempDir, "output-schema.json");
  const outputPath = join(tempDir, "last-message.json");

  if (outputFormat?.type === "json_schema") {
    writeFileSync(schemaPath, JSON.stringify(outputFormat.schema), "utf8");
  }

  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
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

  const child = spawn(command ?? "codex", args, {
    cwd,
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
      resultText = readFileSync(outputPath, "utf8").trim();
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
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export const codexCLI: AgentRuntime = {
  query: spawnCodexQuery,
};
