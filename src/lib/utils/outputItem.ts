export type TextItem = {
  kind: "text";
  content: string;
};

export type ToolCallItem = {
  kind: "tool_call";
  toolName: string;
  input?: unknown; // raw input object from the log entry, if present
};

export type ToolGroupItem = {
  kind: "tool_group";
  toolName: string;
  calls: ToolCallItem[]; // at least 2 entries (single calls stay as ToolCallItem)
};

export type CommandExecutionItem = {
  kind: "command_execution";
  command: string;
  output?: string;
  exitCode?: number;
  status?: string;
};

export type OutputItem =
  | TextItem
  | ToolCallItem
  | ToolGroupItem
  | CommandExecutionItem;
