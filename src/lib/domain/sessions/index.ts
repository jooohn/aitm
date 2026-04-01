import { randomUUID } from "crypto";
import { accessSync, constants, mkdirSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  type AgentConfig,
  getAgentConfig,
  type WorkflowTransition,
} from "../../infra/config";
import {
  cancelAgent,
  sendMessageToAgent,
  startAgent,
  type TransitionDecision,
} from "../../utils/agent";
import type { SessionRepository } from "./session-repository";

export type SessionStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
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

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "agent";
  content: string;
  created_at: string;
}

export class SessionService {
  constructor(private sessionRepository: SessionRepository) {}

  createSession(
    input: CreateSessionInput,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): Session {
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

    startAgent(
      id,
      input.repository_path,
      input.worktree_branch,
      input.goal,
      input.transitions,
      agentConfig,
      log_file_path,
      onComplete,
    ).catch(console.error);

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

    cancelAgent(id);

    const now = new Date().toISOString();
    this.sessionRepository.setSessionFailed(id, now);

    return this.getSession(id) as Session;
  }

  listMessages(sessionId: string): SessionMessage[] {
    return this.sessionRepository.listMessages(sessionId);
  }

  saveMessage(
    sessionId: string,
    role: "user" | "agent",
    content: string,
  ): void {
    this.sessionRepository.insertMessage(sessionId, role, content);
  }

  sendUserMessage(sessionId: string, content: string): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== "WAITING_FOR_INPUT") {
      throw new Error(
        `Session is not waiting for input (status: ${session.status})`,
      );
    }

    this.saveMessage(sessionId, "user", content);
    sendMessageToAgent(sessionId, content);
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

  // Mark any sessions left in a non-terminal state as FAILED.
  // Called on startup so that sessions from a previous server run are recovered.
  recoverCrashedSessions(): void {
    this.sessionRepository.recoverCrashedSessions();
  }
}
