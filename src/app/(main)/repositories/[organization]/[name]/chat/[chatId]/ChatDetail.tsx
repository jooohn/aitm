"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import OutputItemView from "@/app/(main)/sessions/[id]/OutputItemView";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import { swrKeys, useChat } from "@/lib/hooks/swr";
import {
  type ChatStatus,
  fetchChatHistory,
  sendChatMessage,
} from "@/lib/utils/api";
import type { OutputItem } from "@/lib/utils/outputItem";
import { parseLogEntry } from "@/lib/utils/parseLogEntry";
import styles from "./ChatDetail.module.css";
import ProposalCard from "./ProposalCard";

function appendWithGrouping(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  // For proposals and proposal_actions, just append
  if (newItem.kind === "proposals" || newItem.kind === "proposal_action") {
    return [...items, newItem];
  }

  const last = items[items.length - 1];

  if (newItem.kind === "tool_call") {
    if (last?.kind === "tool_call" && last.toolName === newItem.toolName) {
      return [
        ...items.slice(0, -1),
        {
          kind: "tool_group",
          toolName: newItem.toolName,
          calls: [last, newItem],
        },
      ];
    }
    if (last?.kind === "tool_group" && last.toolName === newItem.toolName) {
      return [
        ...items.slice(0, -1),
        { ...last, calls: [...last.calls, newItem] },
      ];
    }
  }

  return [...items, newItem];
}

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
  const { data: chat, mutate: mutateChat } = useChat(chatId);
  const [outputItems, setOutputItems] = useState<OutputItem[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const prevStatusRef = useRef<ChatStatus | null>(null);

  // Load existing conversation history on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: only run once on mount
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on chat?.status
  useEffect(() => {
    if (!chat) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = chat.status;
    if (prev && prev !== chat.status && chat.status !== "running") {
      mutateChat();
    }
  }, [chat?.status, mutateChat]);

  // Auto-scroll when new items arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: outputItems triggers the scroll
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputItems]);

  function handleOutputScroll() {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 10;
  }

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  const handleProposalActioned = useCallback(() => {
    mutateChat();
  }, [mutateChat]);

  if (!chat) {
    return <div className={styles.container}>Loading...</div>;
  }

  const canSend = chat.status !== "running" && !sending;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{chat.title ?? "New chat"}</h2>
        <StatusBadge variant={BADGE_VARIANT[chat.status]}>
          {STATUS_LABELS[chat.status]}
        </StatusBadge>
      </div>

      <div
        ref={outputRef}
        className={styles.output}
        onScroll={handleOutputScroll}
      >
        {outputItems.length === 0 && chat.status === "idle" ? (
          <span className={styles.outputEmpty}>
            Send a message to start the conversation...
          </span>
        ) : outputItems.length === 0 ? (
          <span className={styles.outputEmpty}>Waiting for response...</span>
        ) : (
          outputItems.map((item, i) => {
            if (item.kind === "proposals") {
              return (
                <div key={i} className={styles.proposalsContainer}>
                  {item.proposals.map((p) => {
                    const proposalData = chat.proposals?.find(
                      (cp) => cp.id === p.id,
                    );
                    return (
                      <ProposalCard
                        key={p.id}
                        chatId={chatId}
                        proposal={
                          proposalData ?? {
                            ...p,
                            status: "pending",
                            chat_id: chatId,
                            workflow_run_id: null,
                            created_at: "",
                            updated_at: "",
                          }
                        }
                        onActioned={handleProposalActioned}
                      />
                    );
                  })}
                </div>
              );
            }
            if (item.kind === "proposal_action") {
              return null; // Actions are reflected in ProposalCard state
            }
            return <OutputItemView key={i} item={item} />;
          })
        )}
      </div>

      <form onSubmit={handleSend} className={styles.inputForm}>
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
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!canSend || !messageText.trim()}
        >
          {sending ? "Sending..." : "Send"}
        </button>
        {sendError && <p className={styles.error}>{sendError}</p>}
      </form>
    </div>
  );
}
