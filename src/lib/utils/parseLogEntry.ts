import type {
  CommandExecutionItem,
  OutputItem,
  TextItem,
  ToolCallItem,
} from "./outputItem";

type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
};

type LogEntry = Record<string, unknown>;

function text(content: string): TextItem {
  return { kind: "text", content };
}

function toolCall(toolName: string, input?: unknown): ToolCallItem {
  return {
    kind: "tool_call",
    toolName,
    ...(input !== undefined ? { input } : {}),
  };
}

function commandExecution(
  detail: Record<string, unknown>,
): CommandExecutionItem | null {
  const command = detail.command;
  if (typeof command !== "string" || command.trim() === "") {
    return null;
  }

  const item: CommandExecutionItem = {
    kind: "command_execution",
    command,
  };

  if (typeof detail.aggregated_output === "string") {
    item.output = detail.aggregated_output;
  }
  if (typeof detail.exit_code === "number") {
    item.exitCode = detail.exit_code;
  }
  if (typeof detail.status === "string") {
    item.status = detail.status;
  }

  return item;
}

export function parseLogEntry(
  entry: LogEntry,
): OutputItem | OutputItem[] | null {
  const type = entry.type as string;

  switch (type) {
    case "system":
      if (entry.subtype === "init") return text("▶ Session started");
      return null;

    case "result":
      if (entry.subtype === "success") return text("✓ Goal completed");
      return text(`✗ Session ended: ${entry.subtype}`);

    case "awaiting_input":
      return text(`⏳ Awaiting input: ${entry.message ?? ""}`);

    case "user_input":
      return text(`You: ${entry.message ?? ""}`);

    case "error":
      return text(`! Error: ${entry.message}`);

    case "event": {
      const eventType = entry.event_type;
      const message = entry.message;
      if (typeof eventType !== "string" || eventType.trim() === "") {
        return null;
      }
      if (
        eventType === "command_execution" &&
        entry.detail &&
        typeof entry.detail === "object" &&
        !Array.isArray(entry.detail)
      ) {
        return commandExecution(entry.detail as Record<string, unknown>);
      }
      if (typeof message === "string" && message.trim() !== "") {
        return text(`• ${eventType}: ${message}`);
      }
      return text(`• ${eventType}`);
    }

    case "assistant": {
      const msg = entry.message as { content?: ContentBlock[] } | undefined;
      if (!msg?.content?.length) return null;
      const items: OutputItem[] = [];
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          items.push(text(block.text));
        } else if (block.type === "tool_use" && block.name) {
          items.push(toolCall(block.name, block.input));
        }
      }
      if (items.length === 0) return null;
      if (items.length === 1) return items[0];
      return items;
    }

    default:
      return null;
  }
}
