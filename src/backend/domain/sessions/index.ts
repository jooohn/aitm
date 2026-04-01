import { randomUUID } from "crypto";
import { accessSync, constants, mkdirSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  type AgentConfig,
  getAgentConfig,
  type WorkflowTransition,
} from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import type { AgentService, TransitionDecision } from "../agent";
import type { WorktreeService } from "../worktrees";
import type { SessionRepository } from "./session-repository";

export type SessionStatus =
  | "RUNNING"
  | "AWAITING_INPUT"
  | "SUCCEEDED"
  | "FAILED";

export interface Session {
  id: string;
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: string; // JSON-serialized WorkflowTransition[]
  transition_decision: string | null; // JSON-serialized TransitionDecision
  status: SessionStatus;
  terminal_attach_command: string | null;
  log_file_path: string;
  claude_session_id: string | null;
  state_execution_id: string | null;
  state_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  repository_path: string;
  worktree_branch: string;
  goal: string;
  transitions: WorkflowTransition[];
  agent_config?: AgentConfig;
  state_execution_id?: string;
}

export interface ListSessionsFilter {
  repository_path?: string;
  worktree_branch?: string;
  status?: SessionStatus;
}

function sessionsLogDir(): string {
  const candidates = [
    process.env.AITM_SESSION_LOG_DIR,
    process.env.AITM_SESSIONS_DIR,
    join(homedir(), ".aitm", "sessions"),
    join(tmpdir(), "aitm", "sessions"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      return dir;
    } catch {
      // Try the next writable location.
    }
  }

  throw new Error("Unable to create a writable session log directory");
}

export class SessionService {
  constructor(
    private sessionRepository: SessionRepository,
    private agentService: AgentService,
    private worktreeService: WorktreeService,
    private eventBus: EventBus,
  ) {}

  private buildOnComplete(
    sessionId: string,
  ): (decision: TransitionDecision | null) => void {
    return (decision) =>
      this.eventBus.emit("session.completed", { sessionId, decision });
  }

  createSession(input: CreateSessionInput): Session {
    const id = randomUUID();
    const now = new Date().toISOString();
    const log_file_path = join(sessionsLogDir(), `${id}.log`);
    const agentConfig = input.agent_config ?? getAgentConfig();

    this.sessionRepository.insertSession({
      id,
      repository_path: input.repository_path,
      worktree_branch: input.worktree_branch,
      goal: input.goal,
      transitions: JSON.stringify(input.transitions),
      log_file_path,
      state_execution_id: input.state_execution_id ?? null,
      now,
    });

    let cwd: string;
    try {
      const worktrees = this.worktreeService.listWorktrees(
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
      console.error(
        `Failed to resolve worktree for session ${id}:`,
        err instanceof Error ? err.message : err,
      );
      this.sessionRepository.setSessionFailed(id, now);
      this.eventBus.emit("session.completed", {
        sessionId: id,
        decision: null,
      });
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
        this.buildOnComplete(id),
      )
      .catch(console.error);

    return this.getSession(id) as Session;
  }

  listSessions(filter: ListSessionsFilter = {}): Session[] {
    return this.sessionRepository.listSessions(filter);
  }

  getSession(id: string): Session | undefined {
    return this.sessionRepository.getSession(id);
  }

  failSession(id: string): Session {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status === "SUCCEEDED" || session.status === "FAILED") {
      throw new Error(
        `Session ${id} is already in a terminal state: ${session.status}`,
      );
    }

    this.agentService.cancelAgent(id);

    const now = new Date().toISOString();
    this.sessionRepository.setSessionFailed(id, now);

    return this.getSession(id) as Session;
  }

  replyToSession(id: string, message: string): void {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status !== "AWAITING_INPUT") {
      throw new Error(`Session ${id} is not awaiting input`);
    }

    const transitions: WorkflowTransition[] = JSON.parse(session.transitions);
    const agentConfig = getAgentConfig();

    let cwd: string;
    try {
      const worktrees = this.worktreeService.listWorktrees(
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

    this.agentService
      .resumeAgent(
        id,
        message,
        cwd,
        transitions,
        agentConfig,
        session.log_file_path,
        this.buildOnComplete(id),
      )
      .catch(console.error);
  }

  deleteWorktreeData(repositoryPath: string, branches: string[]): void {
    if (branches.length === 0) return;

    const rows = this.sessionRepository.deleteWorktreeData(
      repositoryPath,
      branches,
    );

    for (const { log_file_path } of rows) {
      try {
        unlinkSync(log_file_path);
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
