import { logger } from "@/backend/infra/logger";
import { appendToLog } from "@/backend/utils/log";
import type { BranchNameService } from "../branch-name";
import { ConflictError, NotFoundError } from "../errors";
import type { WorkflowRunService } from "../workflow-runs";
import type { WorktreeService } from "../worktrees";
import type { ChatAgent } from "./chat-agent";
import type { ChatRepository } from "./chat-repository";

export class ProposalService {
  constructor(
    private chatRepository: ChatRepository,
    private worktreeService: WorktreeService,
    private workflowRunService: WorkflowRunService,
    private branchNameService: BranchNameService,
    private chatAgent: ChatAgent,
  ) {}

  async approveProposal(
    chatId: string,
    proposalId: string,
    overrides?: { workflow_name?: string; inputs?: Record<string, string> },
  ): Promise<{ workflowRunId: string }> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);

    const proposal = this.chatRepository.getProposal(proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.chat_id !== chatId)
      throw new Error("Proposal does not belong to this chat");
    if (proposal.status !== "pending") {
      throw new ConflictError(
        `Proposal ${proposalId} is already ${proposal.status}`,
      );
    }

    const workflowName = overrides?.workflow_name ?? proposal.workflow_name;
    const inputs = overrides?.inputs ?? proposal.inputs;

    const branch = this.branchNameService.generate(workflowName, inputs);

    await this.worktreeService.createWorktree(chat.repository_path, branch);

    const run = await this.workflowRunService.createWorkflowRun({
      repository_path: chat.repository_path,
      worktree_branch: branch,
      workflow_name: workflowName,
      inputs,
    });

    const now = new Date().toISOString();
    this.chatRepository.updateProposalStatus(
      proposalId,
      "approved",
      run.id,
      now,
    );

    const confirmMessage = `Proposal approved: workflow "${workflowName}" started on branch "${branch}" (workflow-run ID: ${run.id}).`;
    await appendToLog(chat.log_file_path, {
      type: "proposal_action",
      proposal_id: proposalId,
      action: "approved",
      workflow_run_id: run.id,
      branch,
    });

    if (chat.status === "awaiting_input") {
      this.chatRepository.setChatStatus(chatId, "running", now);
      this.chatAgent
        .runAgent(chatId, chat, confirmMessage, false)
        .catch((err) =>
          logger.error(
            { err, chatId },
            "Failed to resume chat agent after approval",
          ),
        );
    }

    return { workflowRunId: run.id };
  }

  async rejectProposal(
    chatId: string,
    proposalId: string,
    reason?: string,
  ): Promise<void> {
    const chat = this.chatRepository.getChat(chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);

    const proposal = this.chatRepository.getProposal(proposalId);
    if (!proposal) throw new NotFoundError("Proposal", proposalId);
    if (proposal.chat_id !== chatId)
      throw new Error("Proposal does not belong to this chat");
    if (proposal.status !== "pending") {
      throw new ConflictError(
        `Proposal ${proposalId} is already ${proposal.status}`,
      );
    }

    const now = new Date().toISOString();
    this.chatRepository.updateProposalStatus(proposalId, "rejected", null, now);

    await appendToLog(chat.log_file_path, {
      type: "proposal_action",
      proposal_id: proposalId,
      action: "rejected",
      reason: reason ?? null,
    });

    if (chat.status === "awaiting_input") {
      const rejectMessage = reason
        ? `Proposal rejected: "${proposal.workflow_name}" — Reason: ${reason}`
        : `Proposal rejected: "${proposal.workflow_name}"`;
      this.chatRepository.setChatStatus(chatId, "running", now);
      this.chatAgent
        .runAgent(chatId, chat, rejectMessage, false)
        .catch((err) =>
          logger.error(
            { err, chatId },
            "Failed to resume chat agent after rejection",
          ),
        );
    }
  }
}
