import type {
  CommandGroupItem,
  OutputItem,
  ProcessingStepsItem,
  ToolGroupItem,
} from "./outputItem";

export function summarizeCommand(command: string): string {
  if (command.includes("rg --files")) return "List repository files";
  if (command.includes("git status")) return "Check git status";
  if (command.includes("npm test")) return "Run tests";
  if (command.includes("sed -n")) return "Read file";
  return "Run command";
}

const NON_CONVERSATIONAL_KINDS = new Set<OutputItem["kind"]>([
  "text",
  "tool_call",
  "tool_group",
  "command_execution",
  "command_group",
]);

function isNonConversational(item: OutputItem): boolean {
  return NON_CONVERSATIONAL_KINDS.has(item.kind);
}

function appendToInnerGroup(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  const last = items[items.length - 1];

  if (newItem.kind === "tool_call") {
    if (last?.kind === "tool_call" && last.toolName === newItem.toolName) {
      const group: ToolGroupItem = {
        kind: "tool_group",
        toolName: newItem.toolName,
        calls: [last, newItem],
      };
      return [...items.slice(0, -1), group];
    }
    if (last?.kind === "tool_group" && last.toolName === newItem.toolName) {
      const group: ToolGroupItem = {
        ...last,
        calls: [...last.calls, newItem],
      };
      return [...items.slice(0, -1), group];
    }
  }

  if (newItem.kind === "command_execution") {
    const summary = summarizeCommand(newItem.command);
    if (
      last?.kind === "command_execution" &&
      summarizeCommand(last.command) === summary
    ) {
      const group: CommandGroupItem = {
        kind: "command_group",
        summary,
        calls: [last, newItem],
      };
      return [...items.slice(0, -1), group];
    }
    if (last?.kind === "command_group" && last.summary === summary) {
      const group: CommandGroupItem = {
        ...last,
        calls: [...last.calls, newItem],
      };
      return [...items.slice(0, -1), group];
    }
  }

  return [...items, newItem];
}

export function appendWithGrouping(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  const last = items[items.length - 1];

  if (isNonConversational(newItem)) {
    if (last?.kind === "processing_steps") {
      const group: ProcessingStepsItem = {
        ...last,
        items: appendToInnerGroup(last.items, newItem),
      };
      return [...items.slice(0, -1), group];
    }
    if (last && isNonConversational(last)) {
      const group: ProcessingStepsItem = {
        kind: "processing_steps",
        items: appendToInnerGroup([last], newItem),
      };
      return [...items.slice(0, -1), group];
    }
    return [...items, newItem];
  }

  return [...items, newItem];
}
