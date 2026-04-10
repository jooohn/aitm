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

export type CommandGroupItem = {
  kind: "command_group";
  summary: string;
  calls: CommandExecutionItem[];
};

export type ProposalItem = {
  kind: "proposals";
  proposals: Array<{
    id: string;
    workflow_name: string;
    inputs: Record<string, string>;
    rationale: string;
  }>;
};

export type ProposalActionItem = {
  kind: "proposal_action";
  proposal_id: string;
  action: "approved" | "rejected";
  workflow_run_id?: string;
  branch?: string;
  reason?: string;
};

export type UserInputItem = {
  kind: "user_input";
  content: string;
};

export type ProcessingStepsItem = {
  kind: "processing_steps";
  items: OutputItem[];
};

export type OutputItem =
  | TextItem
  | ToolCallItem
  | ToolGroupItem
  | CommandExecutionItem
  | CommandGroupItem
  | ProposalItem
  | ProposalActionItem
  | UserInputItem
  | ProcessingStepsItem;
