import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/backend/infra/event-bus";
import { ChatRepository } from "./chat-repository";

describe("ChatRepository event emission", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let chatRepository: ChatRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    eventBus = new EventBus();
    chatRepository = new ChatRepository(db, eventBus);
    chatRepository.ensureTables();
  });

  afterEach(() => {
    db.close();
  });

  function insertTestChat(id = "chat-1", repositoryPath = "org/repo") {
    chatRepository.insertChat({
      id,
      repository_path: repositoryPath,
      title: null,
      agent_config: { provider: "claude" },
      log_file_path: `/tmp/${id}.log`,
      now: "2026-04-12T00:00:00.000Z",
    });
  }

  it("emits chat.status-changed when setChatStatus changes the status", () => {
    insertTestChat();

    const listener = vi.fn();
    eventBus.on("chat.status-changed", listener);

    chatRepository.setChatStatus(
      "chat-1",
      "running",
      "2026-04-12T00:00:01.000Z",
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      chatId: "chat-1",
      status: "running",
      repositoryOrganization: "org",
      repositoryName: "repo",
    });
  });

  it("does not emit chat.status-changed when the chat does not exist", () => {
    const listener = vi.fn();
    eventBus.on("chat.status-changed", listener);

    chatRepository.setChatStatus(
      "nonexistent",
      "running",
      "2026-04-12T00:00:01.000Z",
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it("works without eventBus (graceful degradation)", () => {
    const repoWithoutBus = new ChatRepository(db);
    repoWithoutBus.ensureTables();

    repoWithoutBus.insertChat({
      id: "chat-2",
      repository_path: "org/repo",
      title: null,
      agent_config: { provider: "claude" },
      log_file_path: "/tmp/chat-2.log",
      now: "2026-04-12T00:00:00.000Z",
    });

    expect(() =>
      repoWithoutBus.setChatStatus(
        "chat-2",
        "running",
        "2026-04-12T00:00:01.000Z",
      ),
    ).not.toThrow();
  });
});

describe("ChatRepository.ensureTables migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("adds parent_chat_id column to an existing chats table that lacks it", () => {
    db.exec(`
      CREATE TABLE chats (
        id                  TEXT PRIMARY KEY,
        repository_path     TEXT NOT NULL,
        title               TEXT,
        status              TEXT NOT NULL DEFAULT 'idle',
        agent_config        TEXT NOT NULL,
        log_file_path       TEXT NOT NULL,
        claude_session_id   TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
    `);

    const columnsBefore = db
      .prepare("PRAGMA table_info(chats)")
      .all() as Array<{ name: string }>;
    expect(columnsBefore.some((c) => c.name === "parent_chat_id")).toBe(false);

    const repo = new ChatRepository(db);
    repo.ensureTables();

    const columnsAfter = db.prepare("PRAGMA table_info(chats)").all() as Array<{
      name: string;
    }>;
    expect(columnsAfter.some((c) => c.name === "parent_chat_id")).toBe(true);
  });

  it("does not fail when parent_chat_id column already exists", () => {
    const repo = new ChatRepository(db);
    repo.ensureTables();
    repo.ensureTables();

    const columns = db.prepare("PRAGMA table_info(chats)").all() as Array<{
      name: string;
    }>;
    expect(columns.some((c) => c.name === "parent_chat_id")).toBe(true);
  });
});
