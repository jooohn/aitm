import type { ThreadEvent } from "@openai/codex-sdk";
import { Codex } from "@openai/codex-sdk";
import type { OutputMetadataFieldDef } from "@/backend/infra/config";
import { toCodexConfig } from "./permission-mode";
import type {
  AgentMessage,
  AgentQueryParams,
  AgentResumeParams,
  AgentRuntime,
  OutputFormat,
  SessionTransition,
} from "./runtime";
import { USER_INPUT_TRANSITION_NAME } from "./runtime";

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

  const codexConfig = toCodexConfig(permissionMode);
  const thread = codex.startThread({
    model,
    workingDirectory: cwd,
    ...codexConfig,
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

  const codexConfig = toCodexConfig(permissionMode);
  const thread = codex.resumeThread(agentSessionId, {
    model,
    workingDirectory: cwd,
    ...codexConfig,
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

export function buildTransitionOutputFormatForCodex(
  transitions: SessionTransition[],
  metadataFields?: Record<string, OutputMetadataFieldDef>,
): OutputFormat {
  const transitionNames = transitions.map((t) => {
    if ("user_input" in t) return USER_INPUT_TRANSITION_NAME;
    if ("step" in t) return t.step;
    return t.terminal;
  });

  const properties: Record<string, Record<string, unknown>> = {
    transition: {
      type: "string",
      enum: transitionNames,
    },
    reason: { type: "string" },
    handoff_summary: { type: "string" },
  };

  if (metadataFields) {
    for (const [key, def] of Object.entries(metadataFields)) {
      if (key in properties) continue; // never overwrite core fields
      const prop: Record<string, unknown> = { type: def.type };
      if (def.description) prop.description = def.description;
      properties[key] = prop;
    }
  }

  const required = Object.keys(properties);

  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

export class CodexSDK implements AgentRuntime {
  query(params: AgentQueryParams): AsyncIterable<AgentMessage> {
    return streamQuery(params);
  }

  resume(params: AgentResumeParams): AsyncIterable<AgentMessage> {
    return streamResume(params);
  }

  buildTransitionOutputFormat = buildTransitionOutputFormatForCodex;
}
