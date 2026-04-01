import type { SandboxMode, ThreadEvent } from "@openai/codex-sdk";
import { Codex } from "@openai/codex-sdk";
import { buildTransitionOutputFormatForCodex } from "./codex-cli";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
} from "./runtime";

function sandboxModeFor(permissionMode: string): SandboxMode {
  return permissionMode === "acceptEdits" ? "workspace-write" : "read-only";
}

async function* streamEvents(
  events: AsyncIterable<ThreadEvent>,
  hasOutputFormat: boolean,
): AsyncIterable<AgentMessage> {
  let lastAgentMessageText: string | undefined;

  for await (const event of events) {
    const mapped = mapEvent(event, hasOutputFormat, () => lastAgentMessageText);

    if (
      event.type === "item.completed" &&
      event.item.type === "agent_message"
    ) {
      lastAgentMessageText = event.item.text;
    }

    if (mapped) yield mapped;
  }
}

async function* streamQuery(
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

  const codex = new Codex(command ? { codexPathOverride: command } : undefined);

  const thread = codex.startThread({
    model,
    workingDirectory: cwd,
    sandboxMode: sandboxModeFor(permissionMode),
    skipGitRepoCheck: true,
  });

  const { events } = await thread.runStreamed(prompt, {
    outputSchema:
      outputFormat?.type === "json_schema" ? outputFormat.schema : undefined,
    signal: abortController.signal,
  });

  yield* streamEvents(events, outputFormat !== undefined);
}

async function* streamResume(
  params: AgentResumeParams,
): AsyncIterable<AgentMessage> {
  const {
    agentSessionId,
    prompt,
    cwd,
    command,
    model,
    permissionMode,
    abortController,
    outputFormat,
  } = params;

  const codex = new Codex(command ? { codexPathOverride: command } : undefined);

  const thread = codex.resumeThread(agentSessionId, {
    model,
    workingDirectory: cwd,
    sandboxMode: sandboxModeFor(permissionMode),
    skipGitRepoCheck: true,
  });

  const { events } = await thread.runStreamed(prompt, {
    outputSchema:
      outputFormat?.type === "json_schema" ? outputFormat.schema : undefined,
    signal: abortController.signal,
  });

  yield* streamEvents(events, outputFormat !== undefined);
}

function mapEvent(
  event: ThreadEvent,
  hasOutputFormat: boolean,
  getLastAgentText: () => string | undefined,
): AgentMessage | null {
  switch (event.type) {
    case "thread.started":
      return {
        type: "system",
        subtype: "init",
        session_id: event.thread_id,
      };

    case "item.completed": {
      const item = event.item;
      if (item.type === "agent_message") {
        return {
          type: "assistant",
          message: { content: [{ type: "text", text: item.text }] },
        };
      }
      return {
        type: "event",
        event_type: item.type,
        detail: item,
      };
    }

    case "turn.completed": {
      const text = getLastAgentText();
      let structuredOutput: unknown;
      if (hasOutputFormat && text) {
        try {
          structuredOutput = JSON.parse(text);
        } catch {
          // Not valid JSON — leave undefined.
        }
      }
      return {
        type: "result",
        subtype: "success",
        result: text,
        structured_output: structuredOutput,
      };
    }

    case "turn.failed":
      return {
        type: "result",
        subtype: "error",
        result: event.error.message,
      };

    case "error":
      return {
        type: "result",
        subtype: "error",
        result: event.message,
      };

    default:
      return null;
  }
}

export const codexSDK: AgentRuntime = {
  query: streamQuery,
  resume: streamResume,
  buildTransitionOutputFormat: buildTransitionOutputFormatForCodex,
};
