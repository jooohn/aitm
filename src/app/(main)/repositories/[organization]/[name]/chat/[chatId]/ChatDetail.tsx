"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import Button from "@/app/components/Button";
import ChatTranscript from "@/app/components/ChatTranscript/ChatTranscript";
import IconButton from "@/app/components/IconButton";
import CloseIcon from "@/app/components/icons/CloseIcon";
import SendIcon from "@/app/components/icons/SendIcon";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import { swrKeys, useChat } from "@/lib/hooks/swr";
import {
  type ChatStatus,
  fetchChatHistory,
  sendChatMessage,
} from "@/lib/utils/api";
import type { OutputItem } from "@/lib/utils/outputItem";
import { appendWithGrouping } from "@/lib/utils/outputItemGrouping";
import { parseLogEntry } from "@/lib/utils/parseLogEntry";
import styles from "./ChatDetail.module.css";
import ProposalCard from "./ProposalCard";

const STATUS_LABELS: Record<ChatStatus, string> = {
  running: "Running",
  awaiting_input: "Awaiting input",
  idle: "Idle",
  failed: "Failed",
};

const BADGE_VARIANT: Record<ChatStatus, StatusBadgeVariant> = {
  running: "running",
  awaiting_input: "awaiting",
  idle: "success",
  failed: "failure",
};

interface Props {
  chatId: string;
}

export default function ChatDetail({ chatId }: Props) {
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();
  const { data: chat, mutate: mutateChat } = useChat(chatId);
  const [outputItems, setOutputItems] = useState<OutputItem[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const prevStatusRef = useRef<ChatStatus | null>(null);

  // Load existing conversation history on mount
  useEffect(() => {
    fetchChatHistory(chatId)
      .then((entries) => {
        let items: OutputItem[] = [];
        for (const entry of entries) {
          const parsed = parseLogEntry(entry);
          if (parsed === null) continue;
          const newItems = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of newItems) {
            items = appendWithGrouping(items, item);
          }
        }
        setOutputItems(items);
      })
      .catch(() => {
        // ignore history load errors
      });
  }, [chatId]);

  // SSE stream — open when status is "running"
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on chat?.status, not the full chat object
  useEffect(() => {
    if (!chat || chat.status !== "running") return;

    // Reset items — the SSE stream replays the full log file from the beginning
    setOutputItems([]);

    const es = new EventSource(`/api/chats/${chatId}/stream`);

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as Record<string, unknown>;
        const parsed = parseLogEntry(entry);
        if (parsed === null) return;
        const newItems: OutputItem[] = Array.isArray(parsed)
          ? parsed
          : [parsed];
        setOutputItems((prev) => {
          let next = [...prev];
          for (const item of newItems) {
            next = appendWithGrouping(next, item);
          }
          return next;
        });
      } catch {
        // ignore malformed entries
      }
    };

    es.addEventListener("done", () => {
      es.close();
      mutateChat();
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [chatId, chat?.status, mutateChat]);

  // When status transitions away from running, re-fetch to get updated proposals
  // and auto-open drawer when awaiting input
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on chat?.status
  useEffect(() => {
    if (!chat) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = chat.status;
    if (prev && prev !== chat.status && chat.status !== "running") {
      mutateChat();
    }
    if (chat.status === "awaiting_input" && prev !== "awaiting_input") {
      setDrawerOpen(true);
      setDrawerClosing(false);
    }
  }, [chat?.status, mutateChat]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!messageText.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const updated = await sendChatMessage(chatId, messageText.trim());
      await mutate(swrKeys.chat(chatId), updated);
      setMessageText("");
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  const handleProposalActioned = useCallback(() => {
    mutateChat();
  }, [mutateChat]);

  function handleCloseDrawer() {
    setDrawerClosing(true);
    setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, 200);
  }

  if (!chat) {
    return <div className={styles.container}>Loading...</div>;
  }

  const canSend = chat.status !== "running" && !sending;

  const proposals = chat.proposals ?? [];
  const pendingCount = proposals.filter((p) => p.status === "pending").length;
  const visibleItems = outputItems.filter(
    (item) => item.kind !== "proposals" && item.kind !== "proposal_action",
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {chat.parent_chat_id && (
            <Link
              href={`/repositories/${organization}/${name}/chat/${chat.parent_chat_id}`}
              className={styles.parentLink}
            >
              Parent chat
            </Link>
          )}
          <h2 className={styles.title}>{chat.title ?? "New chat"}</h2>
          <StatusBadge variant={BADGE_VARIANT[chat.status]}>
            {STATUS_LABELS[chat.status]}
          </StatusBadge>
        </div>
        {proposals.length > 0 && (
          <Button
            size="sm"
            onClick={() => {
              setDrawerOpen(true);
              setDrawerClosing(false);
            }}
          >
            Suggested Runs{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Button>
        )}
      </div>

      <ChatTranscript
        items={visibleItems}
        isRunning={chat.status === "running"}
        className={styles.output}
        emptyMessage={
          chat.status === "idle"
            ? "Send a message to start the conversation..."
            : "Waiting for response..."
        }
      />

      <form onSubmit={handleSend} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.messageInput}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              chat.status === "running"
                ? "Agent is working..."
                : "Type a message..."
            }
            disabled={!canSend}
            rows={3}
          />
          <span className={styles.sendButtonPosition}>
            <IconButton
              type="submit"
              size="md"
              variant="primary"
              disabled={!canSend || !messageText.trim()}
              aria-label="Send message"
            >
              <SendIcon size={16} />
            </IconButton>
          </span>
        </div>
        {sendError && <p className={styles.error}>{sendError}</p>}
      </form>

      {drawerOpen && (
        <div className={styles.overlay}>
          <div
            className={`${styles.backdrop} ${drawerClosing ? styles.backdropClosing : ""}`}
            onClick={handleCloseDrawer}
          />
          <aside
            className={`${styles.drawer} ${drawerClosing ? styles.drawerClosing : ""}`}
          >
            <div className={styles.drawerHeader}>
              <h3 className={styles.drawerTitle}>Suggested Runs</h3>
              <IconButton
                size="sm"
                onClick={handleCloseDrawer}
                aria-label="Close suggested runs"
              >
                <CloseIcon />
              </IconButton>
            </div>
            <div className={styles.drawerBody}>
              {proposals.length === 0 ? (
                <span className={styles.drawerEmpty}>No suggestions yet</span>
              ) : (
                <>
                  {proposals
                    .filter((p) => p.status === "pending")
                    .map((p) => (
                      <ProposalCard
                        key={p.id}
                        chatId={chatId}
                        proposal={p}
                        onActioned={handleProposalActioned}
                      />
                    ))}
                  {proposals.some((p) => p.status === "approved") && (
                    <>
                      <h4 className={styles.drawerSectionHeading}>
                        Approved suggestions
                      </h4>
                      {proposals
                        .filter((p) => p.status === "approved")
                        .map((p) => (
                          <ProposalCard
                            key={p.id}
                            chatId={chatId}
                            proposal={p}
                            onActioned={handleProposalActioned}
                          />
                        ))}
                    </>
                  )}
                  {proposals.some((p) => p.status === "rejected") && (
                    <>
                      <h4 className={styles.drawerSectionHeading}>
                        Rejected suggestions
                      </h4>
                      {proposals
                        .filter((p) => p.status === "rejected")
                        .map((p) => (
                          <ProposalCard
                            key={p.id}
                            chatId={chatId}
                            proposal={p}
                            onActioned={handleProposalActioned}
                          />
                        ))}
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
