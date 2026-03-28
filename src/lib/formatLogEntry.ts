type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
};

type LogEntry = Record<string, unknown>;

export function formatLogEntry(entry: LogEntry): string | null {
  const type = entry.type as string;

  switch (type) {
    case "system":
      if (entry.subtype === "init") return "▶ Session started";
      return null;

    case "result":
      if (entry.subtype === "success") return "✓ Goal completed";
      return `✗ Session ended: ${entry.subtype}`;

    case "question":
      return `? ${entry.question}`;

    case "answer":
      return `> ${entry.answer}`;

    case "error":
      return `! Error: ${entry.message}`;

    case "assistant": {
      const msg = entry.message as { content?: ContentBlock[] } | undefined;
      if (!msg?.content?.length) return null;
      const parts = msg.content
        .map((block) => {
          if (block.type === "text" && block.text) return block.text;
          if (block.type === "tool_use" && block.name) return `[${block.name}]`;
          return null;
        })
        .filter((s): s is string => s !== null);
      return parts.length > 0 ? parts.join("\n") : null;
    }

    default:
      return null;
  }
}
