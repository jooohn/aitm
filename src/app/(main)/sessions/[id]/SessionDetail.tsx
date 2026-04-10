"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import SendIcon from "@/app/components/icons/SendIcon";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import { swrKeys, useSession } from "@/lib/hooks/swr";
import {
  replyToSession,
  type Session,
  type SessionStatus,
} from "@/lib/utils/api";
import type {
  CommandExecutionItem,
  CommandGroupItem,
  OutputItem,
  ProcessingStepsItem,
  ToolGroupItem,
} from "@/lib/utils/outputItem";
import { parseLogEntry } from "@/lib/utils/parseLogEntry";
import OutputItemView from "./OutputItemView";
import styles from "./SessionDetail.module.css";

function summarizeCommand(command: string): string {
  if (command.includes("rg --files")) return "List repository files";
  if (command.includes("git status")) return "Check git status";
  if (command.includes("npm test")) return "Run tests";
  if (command.includes("sed -n")) return "Read file";
  return "Run command";
}

const NON_CONVERSATIONAL_KINDS = new Set([
  "tool_call",
  "tool_group",
  "command_execution",
  "command_group",
]);

function isNonConversational(item: OutputItem): boolean {
  return NON_CONVERSATIONAL_KINDS.has(item.kind);
}

function appendToInnerGroup(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  const last = items[items.length - 1];

  if (newItem.kind === "tool_call") {
    if (last?.kind === "tool_call" && last.toolName === newItem.toolName) {
      const group: ToolGroupItem = {
        kind: "tool_group",
        toolName: newItem.toolName,
        calls: [last, newItem],
      };
      return [...items.slice(0, -1), group];
    }
    if (last?.kind === "tool_group" && last.toolName === newItem.toolName) {
      const group: ToolGroupItem = {
        ...last,
        calls: [...last.calls, newItem],
      };
      return [...items.slice(0, -1), group];
    }
  }

  if (newItem.kind === "command_execution") {
    const summary = summarizeCommand(newItem.command);
    if (
      last?.kind === "command_execution" &&
      summarizeCommand(last.command) === summary
    ) {
      const group: CommandGroupItem = {
        kind: "command_group",
        summary,
        calls: [last, newItem],
      };
      return [...items.slice(0, -1), group];
    }
    if (last?.kind === "command_group" && last.summary === summary) {
      const group: CommandGroupItem = {
        ...last,
        calls: [...last.calls, newItem],
      };
      return [...items.slice(0, -1), group];
    }
  }

  return [...items, newItem];
}

function appendWithGrouping(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  const last = items[items.length - 1];

  if (isNonConversational(newItem)) {
    // Extend existing processing_steps group
    if (last?.kind === "processing_steps") {
      const group: ProcessingStepsItem = {
        ...last,
        items: appendToInnerGroup(last.items, newItem),
      };
      return [...items.slice(0, -1), group];
    }
    // Merge previous non-conversational item into a new group
    if (last && isNonConversational(last)) {
      const group: ProcessingStepsItem = {
        kind: "processing_steps",
        items: appendToInnerGroup([last], newItem),
      };
      return [...items.slice(0, -1), group];
    }
    // Single non-conversational item (no merge yet)
    return [...items, newItem];
  }

  // Conversational item — just append
  return [...items, newItem];
}

interface Props {
  session: Session;
  onSessionUpdated?: (session: Session) => void;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: "Running",
  awaiting_input: "Awaiting input",
  success: "Succeeded",
  failure: "Failed",
};

const SESSION_BADGE_VARIANT: Record<SessionStatus, StatusBadgeVariant> = {
  running: "running",
  awaiting_input: "awaiting",
  success: "success",
  failure: "failure",
};

export default function SessionDetail({
  session: initial,
  onSessionUpdated,
}: Props) {
  const { data: session } = useSession(initial.id, { fallbackData: initial });
  const currentSession = session ?? initial;

  const [outputItems, setOutputItems] = useState<OutputItem[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Sync prop changes to SWR cache
  useEffect(() => {
    void mutate(swrKeys.session(initial.id), initial, { revalidate: false });
  }, [initial]);

  // Reset UI state when a different session is passed in
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset UI state when a different session is passed in
  useEffect(() => {
    setOutputItems([]);
    setReplyText("");
    setReplying(false);
    setReplyError(null);
    autoScrollRef.current = true;
  }, [initial.id]);

  // Notify parent when session updates
  useEffect(() => {
    if (session) {
      onSessionUpdated?.(session);
    }
  }, [session, onSessionUpdated]);

  // SSE stream for live output
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${currentSession.id}/stream`);

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
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [currentSession.id]);

  // Auto-scroll output pane when new items arrive
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

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      const updated = await replyToSession(currentSession.id, replyText.trim());
      await mutate(swrKeys.session(currentSession.id), updated);
      setReplyText("");
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : "Failed to send reply",
      );
    } finally {
      setReplying(false);
    }
  }

  const clarifyingQuestion =
    currentSession.status === "awaiting_input"
      ? (currentSession.transition_decision?.clarifying_question ??
        currentSession.transition_decision?.handoff_summary ??
        null)
      : null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <StatusBadge variant={SESSION_BADGE_VARIANT[currentSession.status]}>
            {STATUS_LABELS[currentSession.status]}
          </StatusBadge>
        </div>
      </div>

      <section>
        <h2 className={styles.sectionHeading}>Goal</h2>
        <div className={styles.goalPane}>{currentSession.goal}</div>
      </section>

      <section>
        <h2 className={styles.sectionHeading}>Session</h2>
        <div
          ref={outputRef}
          className={styles.output}
          onScroll={handleOutputScroll}
        >
          {outputItems.length === 0 ? (
            <span className={styles.outputEmpty}>No output yet…</span>
          ) : (
            outputItems.map((item, i) => (
              <OutputItemView
                key={i}
                item={item}
                isLastItem={i === outputItems.length - 1}
                sessionStatus={currentSession.status}
              />
            ))
          )}

          {currentSession.status === "awaiting_input" && (
            <form onSubmit={handleReply} className={styles.replyForm}>
              {clarifyingQuestion && (
                <p className={styles.clarifyingQuestion}>
                  {clarifyingQuestion}
                </p>
              )}
              <div className={styles.replyInputWrapper}>
                <textarea
                  className={styles.replyInput}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) {
                      e.preventDefault();
                      handleReply(e);
                    }
                  }}
                  placeholder="Type your reply…"
                  disabled={replying}
                  rows={3}
                />
                <button
                  type="submit"
                  className={styles.replyButton}
                  disabled={replying || !replyText.trim()}
                  aria-label="Send reply"
                >
                  <SendIcon size={14} />
                </button>
              </div>
              {replyError && <p className={styles.error}>{replyError}</p>}
            </form>
          )}
        </div>
      </section>

      {currentSession.terminal_attach_command && (
        <dl className={styles.details}>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Terminal attach</dt>
            <dd>
              <code className={styles.attachCommand}>
                {currentSession.terminal_attach_command}
              </code>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
