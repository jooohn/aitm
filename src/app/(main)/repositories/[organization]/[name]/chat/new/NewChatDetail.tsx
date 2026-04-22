"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ChatTranscript from "@/app/components/ChatTranscript/ChatTranscript";
import SendIcon from "@/app/components/icons/SendIcon";
import { createChat, sendChatMessage } from "@/lib/utils/api";
import styles from "../[chatId]/ChatDetail.module.css";

interface Props {
  organization: string;
  name: string;
}

export default function NewChatDetail({ organization, name }: Props) {
  const router = useRouter();
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    if (!messageText.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const chat = await createChat(organization, name);
      await sendChatMessage(chat.id, messageText.trim());
      router.replace(`/repositories/${organization}/${name}/chat/${chat.id}`);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to create chat",
      );
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  const canSend = !sending;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>New chat</h2>
        </div>
      </div>

      <ChatTranscript
        items={[]}
        className={styles.output}
        emptyMessage="Send a message to start the conversation..."
      />

      <form onSubmit={handleSend} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.messageInput}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={!canSend}
            rows={3}
          />
          <button
            type="submit"
            className={styles.sendButton}
            disabled={!canSend || !messageText.trim()}
            aria-label="Send message"
          >
            <SendIcon size={16} />
          </button>
        </div>
        {sendError && <p className={styles.error}>{sendError}</p>}
      </form>
    </div>
  );
}
