"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import ChatTranscript from "@/app/components/ChatTranscript/ChatTranscript";
import SendIcon from "@/app/components/icons/SendIcon";
import { swrKeys, useSession } from "@/lib/hooks/swr";
import { replyToSession, type Session } from "@/lib/utils/api";
import type { OutputItem } from "@/lib/utils/outputItem";
import { appendWithGrouping } from "@/lib/utils/outputItemGrouping";
import { parseLogEntry } from "@/lib/utils/parseLogEntry";
import styles from "./SessionDetail.module.css";

interface Props {
  session: Session;
  onSessionUpdated?: (session: Session) => void;
}

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
  const [goalExpanded, setGoalExpanded] = useState(false);

  // Sync prop changes to SWR cache
  useEffect(() => {
    void mutate(swrKeys.session(initial.id), initial, { revalidate: false });
  }, [initial]);

  // Reset UI state when a different session is passed in
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when session id changes
  useEffect(() => {
    setOutputItems([]);
    setReplyText("");
    setReplying(false);
    setReplyError(null);
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
      <section className={styles.goalSection}>
        <button
          type="button"
          className={styles.goalToggle}
          aria-expanded={goalExpanded}
          onClick={() => setGoalExpanded((v) => !v)}
        >
          <span className={styles.goalChevron}>{goalExpanded ? "▼" : "▶"}</span>
          <span className={styles.sectionHeading}>Goal</span>
        </button>
        {goalExpanded && (
          <div className={styles.goalPane}>{currentSession.goal}</div>
        )}
      </section>

      <ChatTranscript
        items={outputItems}
        isRunning={currentSession.status === "running"}
      >
        {currentSession.status === "awaiting_input" && (
          <form onSubmit={handleReply} className={styles.replyForm}>
            {clarifyingQuestion && (
              <p className={styles.clarifyingQuestion}>{clarifyingQuestion}</p>
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
      </ChatTranscript>

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
