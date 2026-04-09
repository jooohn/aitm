import { randomUUID } from "crypto";
import { appendFile, mkdir, unlink } from "fs/promises";
import { dirname } from "path";
import type {
  AgentConfig,
  OutputMetadataFieldDef,
  WorkflowTransition,
} from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { logger } from "@/backend/infra/logger";
import type { AgentService, TransitionDecision } from "../agent";
import type { WorktreeService } from "../worktrees";
import type { SessionRepository } from "./session-repository";

export type SessionStatus =
  | "running"
  | "awaiting_input"
  | "success"
  | "failure";

export interface Session {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
  transition_decision: TransitionDecision | null;
  agent_config: AgentConfig;
  status: SessionStatus;
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  step_execution_id: string | null;
  metadata_fields: Record<string, OutputMetadataFieldDef> | null;
  step_name: string | null;
  workflow_name?: string | null;
  workflow_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
  log_file_path: string;
  agent_config?: AgentConfig;
  step_execution_id?: string;
  metadata_fields?: Record<string, OutputMetadataFieldDef>;
}

export interface ListSessionsFilter {
  repository_path?: string;
  worktree_branch?: string;
  status?: SessionStatus;
}

async function appendSessionLogEntry(
  logFilePath: string,
  entry: unknown,
): Promise<void> {
  try {
    await appendFile(logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Non-critical — ignore log write errors.
  }
}

export class SessionService {
  constructor(
    private sessionRepository: SessionRepository,
    private agentService: AgentService,
    private worktreeService: WorktreeService,
    private eventBus: EventBus,
    private defaultAgentConfig: AgentConfig,
  ) {
    this.eventBus.on("agent-session.completed", ({ sessionId, decision }) => {
      this.handleAgentSessionCompleted(sessionId, decision);
    });
  }

  private handleAgentSessionCompleted(
    sessionId: string,
    decision: TransitionDecision | null,
  ): void {
    const now = new Date().toISOString();
    const didUpdate = decision
      ? this.sessionRepository.setSessionSucceeded(sessionId, now, decision)
      : this.sessionRepository.setSessionFailed(sessionId, now, null);

    if (!didUpdate) return;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const log_file_path = input.log_file_path;
    await mkdir(dirname(log_file_path), { recursive: true });
    const agentConfig = input.agent_config ?? this.defaultAgentConfig;

    this.sessionRepository.insertSession({
      id,
      repository_path: input.repository_path,
      worktree_branch: input.worktree_branch,
      goal: input.goal,
      transitions: input.transitions,
      agent_config: agentConfig,
      log_file_path,
      step_execution_id: input.step_execution_id ?? null,
      metadata_fields: input.metadata_fields ?? null,
      now,
    });

    let cwd: string;
    try {
      const worktrees = await this.worktreeService.listWorktrees(
        input.repository_path,
      );
      const worktree = worktrees.find(
        (w) => w.branch === input.worktree_branch,
      );
      if (!worktree) {
        throw new Error(`Worktree not found: ${input.worktree_branch}`);
      }
      cwd = worktree.path;
    } catch (err) {
      logger.error(
        { err, sessionId: id },
        "Failed to resolve worktree for session",
      );
      this.sessionRepository.setSessionFailed(id, now, null);
      return this.getSession(id) as Session;
    }

    this.agentService
      .startAgent(
        id,
        cwd,
        input.goal,
        input.transitions,
        agentConfig,
        log_file_path,
        undefined,
        input.metadata_fields,
      )
      .catch((err) =>
        logger.error({ err, sessionId: id }, "Failed to start agent"),
      );

    return this.getSession(id) as Session;
  }

  listSessions(filter: ListSessionsFilter = {}): Session[] {
    return this.sessionRepository.listSessions(filter);
  }

  getSession(id: string): Session | undefined {
    return this.sessionRepository.getSession(id);
  }

  listPersistedWorktreeBranches(repositoryPath: string): string[] {
    return this.sessionRepository.listPersistedWorktreeBranches(repositoryPath);
  }

  failSession(id: string): Session {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status === "success" || session.status === "failure") {
      throw new Error(
        `Session ${id} is already in a terminal state: ${session.status}`,
      );
    }

    const now = new Date().toISOString();
    this.agentService.cancelAgent(id);
    this.sessionRepository.setSessionFailed(id, now, null);

    return this.getSession(id) as Session;
  }

  async replyToSession(id: string, message: string): Promise<void> {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status !== "awaiting_input") {
      throw new Error(`Session ${id} is not awaiting input`);
    }

    let cwd: string;
    try {
      const worktrees = await this.worktreeService.listWorktrees(
        session.repository_path,
      );
      const worktree = worktrees.find(
        (w) => w.branch === session.worktree_branch,
      );
      if (!worktree) {
        throw new Error(`Worktree not found: ${session.worktree_branch}`);
      }
      cwd = worktree.path;
    } catch (err) {
      throw new Error(
        `Failed to resolve worktree: ${err instanceof Error ? err.message : err}`,
      );
    }

    await appendSessionLogEntry(session.log_file_path, {
      type: "user_input",
      message,
    });

    this.agentService
      .resumeAgent(
        id,
        message,
        cwd,
        session.transitions,
        session.agent_config,
        session.log_file_path,
        undefined,
        session.metadata_fields ?? undefined,
      )
      .catch((err) =>
        logger.error({ err, sessionId: id }, "Failed to resume agent"),
      );
  }

  async deleteWorktreeData(
    repositoryPath: string,
    branches: string[],
  ): Promise<void> {
    if (branches.length === 0) return;

    const rows = this.sessionRepository.deleteWorktreeData(
      repositoryPath,
      branches,
    );

    for (const { log_file_path } of rows) {
      try {
        await unlink(log_file_path);
      } catch {
        // ignore missing files
      }
    }
  }

  // Mark any RUNNING sessions as FAILED on startup.
  // AWAITING_INPUT sessions survive restarts since they don't depend on
  // in-memory state.
  recoverCrashedSessions(): void {
    this.sessionRepository.recoverCrashedSessions();
  }
}
