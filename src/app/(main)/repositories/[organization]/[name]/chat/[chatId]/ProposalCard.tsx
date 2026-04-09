"use client";

import { useState } from "react";
import {
  approveChatProposal,
  type ChatProposal,
  rejectChatProposal,
} from "@/lib/utils/api";
import styles from "./ProposalCard.module.css";

interface Props {
  chatId: string;
  proposal: ChatProposal;
  onActioned: () => void;
}

export default function ProposalCard({ chatId, proposal, onActioned }: Props) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = proposal.status === "pending";

  async function handleApprove() {
    setActing(true);
    setError(null);
    try {
      await approveChatProposal(chatId, proposal.id);
      onActioned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    setActing(true);
    setError(null);
    try {
      await rejectChatProposal(chatId, proposal.id);
      onActioned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setActing(false);
    }
  }

  return (
    <div
      className={`${styles.card} ${
        proposal.status === "approved"
          ? styles.cardApproved
          : proposal.status === "rejected"
            ? styles.cardRejected
            : styles.cardPending
      }`}
    >
      <div className={styles.header}>
        <span className={styles.workflowName}>{proposal.workflow_name}</span>
        {!isPending && (
          <span
            className={`${styles.statusBadge} ${
              proposal.status === "approved"
                ? styles.badgeApproved
                : styles.badgeRejected
            }`}
          >
            {proposal.status === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </div>

      <p className={styles.rationale}>{proposal.rationale}</p>

      {Object.keys(proposal.inputs).length > 0 && (
        <dl className={styles.inputs}>
          {Object.entries(proposal.inputs).map(([key, value]) => (
            <div key={key} className={styles.inputRow}>
              <dt className={styles.inputKey}>{key}</dt>
              <dd className={styles.inputValue}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {isPending && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.approveButton}
            onClick={handleApprove}
            disabled={acting}
          >
            {acting ? "..." : "Approve"}
          </button>
          <button
            type="button"
            className={styles.rejectButton}
            onClick={handleReject}
            disabled={acting}
          >
            Reject
          </button>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
