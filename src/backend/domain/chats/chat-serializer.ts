import type { AgentConfig } from "@/backend/infra/config";
import { parseJson } from "@/backend/utils/json";
import type { Chat, ChatProposal, ChatProposalStatus, ChatStatus } from ".";

export interface ChatRow {
  id: string;
  repository_path: string;
  title: string | null;
  status: ChatStatus;
  agent_config: string;
  log_file_path: string;
  claude_session_id: string | null;
  parent_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatProposalRow {
  id: string;
  chat_id: string;
  workflow_name: string;
  inputs: string;
  rationale: string;
  status: ChatProposalStatus;
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export function chatRowToDomain(row: ChatRow): Chat {
  return {
    ...row,
    agent_config: parseJson<AgentConfig>(row.agent_config, {
      provider: "claude",
    }),
  };
}

export function chatProposalRowToDomain(row: ChatProposalRow): ChatProposal {
  return {
    ...row,
    inputs: parseJson<Record<string, string>>(row.inputs, {}),
  };
}
