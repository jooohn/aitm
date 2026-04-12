import type Database from "better-sqlite3";
import type { EventBus } from "@/backend/infra/event-bus";
import { splitAlias } from "@/lib/utils/inferAlias";
import type { Chat, ChatProposal, ChatProposalStatus, ChatStatus } from ".";
import {
  type ChatProposalRow,
  type ChatRow,
  chatProposalRowToDomain,
  chatRowToDomain,
} from "./chat-serializer";

export class ChatRepository {
  constructor(
    private db: Database.Database,
    private eventBus?: EventBus,
  ) {}

  private emitChatStatusChanged(chatId: string, status: ChatStatus): void {
    if (!this.eventBus) return;

    const row = this.db
      .prepare("SELECT repository_path FROM chats WHERE id = ?")
      .get(chatId) as { repository_path: string } | undefined;
    if (!row) return;

    const { organization, name } = splitAlias(row.repository_path);
    this.eventBus.emit("chat.status-changed", {
      chatId,
      status,
      repositoryOrganization: organization,
      repositoryName: name,
    });
  }

  ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id                  TEXT PRIMARY KEY,
        repository_path     TEXT NOT NULL,
        title               TEXT,
        status              TEXT NOT NULL DEFAULT 'idle',
        agent_config        TEXT NOT NULL,
        log_file_path       TEXT NOT NULL,
        claude_session_id   TEXT,
        parent_chat_id      TEXT REFERENCES chats(id) ON DELETE SET NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

    `);

    const columns = this.db.prepare("PRAGMA table_info(chats)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((c) => c.name === "parent_chat_id")) {
      this.db.exec(
        "ALTER TABLE chats ADD COLUMN parent_chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL",
      );
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_proposals (
        id                  TEXT PRIMARY KEY,
        chat_id             TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        workflow_name       TEXT NOT NULL,
        inputs              TEXT NOT NULL,
        rationale           TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        workflow_run_id     TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
    `);
  }

  insertChat(params: {
    id: string;
    repository_path: string;
    title: string | null;
    agent_config: Chat["agent_config"];
    log_file_path: string;
    claude_session_id?: string | null;
    parent_chat_id?: string | null;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO chats
         (id, repository_path, title, status, agent_config, log_file_path,
          claude_session_id, parent_chat_id, created_at, updated_at)
         VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.repository_path,
        params.title,
        JSON.stringify(params.agent_config),
        params.log_file_path,
        params.claude_session_id ?? null,
        params.parent_chat_id ?? null,
        params.now,
        params.now,
      );
  }

  getChat(id: string): Chat | undefined {
    const row = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as
      | ChatRow
      | undefined;
    return row ? chatRowToDomain(row) : undefined;
  }

  getChatStatus(id: string): ChatStatus | null {
    const row = this.db
      .prepare("SELECT status FROM chats WHERE id = ?")
      .get(id) as { status: ChatStatus } | undefined;
    return row?.status ?? null;
  }

  listChats(repositoryPath?: string): Chat[] {
    if (repositoryPath) {
      const rows = this.db
        .prepare(
          "SELECT * FROM chats WHERE repository_path = ? ORDER BY created_at DESC",
        )
        .all(repositoryPath) as ChatRow[];
      return rows.map(chatRowToDomain);
    }
    const rows = this.db
      .prepare("SELECT * FROM chats ORDER BY created_at DESC")
      .all() as ChatRow[];
    return rows.map(chatRowToDomain);
  }

  deleteChat(id: string): boolean {
    const result = this.db.prepare("DELETE FROM chats WHERE id = ?").run(id);
    return result.changes > 0;
  }

  setChatStatus(id: string, status: ChatStatus, now: string): boolean {
    const result = this.db
      .prepare("UPDATE chats SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    if (result.changes > 0) {
      this.emitChatStatusChanged(id, status);
    }
    return result.changes > 0;
  }

  setChatClaudeSessionId(id: string, claudeSessionId: string): void {
    this.db
      .prepare("UPDATE chats SET claude_session_id = ? WHERE id = ?")
      .run(claudeSessionId, id);
  }

  setChatTitle(id: string, title: string, now: string): void {
    this.db
      .prepare(
        "UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND title IS NULL",
      )
      .run(title, now, id);
  }

  // -- Proposals --

  insertProposals(
    chatId: string,
    proposals: Array<{
      id: string;
      workflow_name: string;
      inputs: Record<string, string>;
      rationale: string;
    }>,
    now: string,
  ): void {
    const stmt = this.db.prepare(
      `INSERT INTO chat_proposals
       (id, chat_id, workflow_name, inputs, rationale, status, workflow_run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    );
    for (const p of proposals) {
      stmt.run(
        p.id,
        chatId,
        p.workflow_name,
        JSON.stringify(p.inputs),
        p.rationale,
        now,
        now,
      );
    }
  }

  getProposal(id: string): ChatProposal | undefined {
    const row = this.db
      .prepare("SELECT * FROM chat_proposals WHERE id = ?")
      .get(id) as ChatProposalRow | undefined;
    return row ? chatProposalRowToDomain(row) : undefined;
  }

  listProposals(chatId: string): ChatProposal[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM chat_proposals WHERE chat_id = ? ORDER BY created_at ASC",
      )
      .all(chatId) as ChatProposalRow[];
    return rows.map(chatProposalRowToDomain);
  }

  updateProposalStatus(
    id: string,
    status: ChatProposalStatus,
    workflowRunId: string | null,
    now: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE chat_proposals
         SET status = ?, workflow_run_id = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, workflowRunId, now, id);
    return result.changes > 0;
  }

  recoverCrashedChats(): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE chats SET status = 'idle', updated_at = ? WHERE status = 'running'",
      )
      .run(now);
  }
}
