"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import GitHubIcon from "@/app/components/icons/GitHubIcon";
import TrashIcon from "@/app/components/icons/TrashIcon";
import StatusDot, { type StatusDotVariant } from "@/app/components/StatusDot";
import {
  useChats,
  useRepository,
  useWorkflowRuns,
  useWorktrees,
} from "@/lib/hooks/swr";
import { type Chat, type ChatStatus, deleteChat } from "@/lib/utils/api";
import styles from "./RepositoryShell.module.css";
import WorktreeRunsSection from "./WorktreeRunsSection";
import RunWorkflowModal from "./workflow-runs/RunWorkflowModal";

interface Props {
  organization: string;
  name: string;
  children: React.ReactNode;
}

const chatStatusToDotVariant: Record<ChatStatus, StatusDotVariant> = {
  running: "running",
  awaiting_input: "awaiting",
  failed: "failure",
  idle: "idle",
};

const chatStatusLabel: Record<ChatStatus, string> = {
  running: "Running",
  awaiting_input: "Awaiting input",
  failed: "Failed",
  idle: "Idle",
};

function ChatListItem({
  chat,
  organization,
  name,
  onDeleted,
}: {
  chat: Chat;
  organization: string;
  name: string;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className={styles.runItem}>
      <StatusDot variant={chatStatusToDotVariant[chat.status]} />
      <span className={styles.srOnly}>{chatStatusLabel[chat.status]}</span>
      <Link
        href={`/repositories/${organization}/${name}/chat/${chat.id}`}
        className={styles.runInfo}
      >
        <span className={styles.runBranch}>
          {chat.title ?? "Untitled chat"}
        </span>
      </Link>
      <button
        type="button"
        className={styles.chatDeleteButton}
        onClick={async (e) => {
          e.preventDefault();
          if (deleting) return;
          setDeleting(true);
          try {
            await deleteChat(chat.id);
            onDeleted();
          } finally {
            setDeleting(false);
          }
        }}
        disabled={deleting}
        aria-label="Delete chat"
      >
        <TrashIcon size={14} />
      </button>
    </div>
  );
}

export default function RepositoryShell({
  organization,
  name,
  children,
}: Props) {
  const alias = `${organization}/${name}`;
  const router = useRouter();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const { data: repo } = useRepository(organization, name);
  const { data: chats, mutate: mutateChats } = useChats(organization, name);
  const {
    data: worktrees,
    error: worktreesError,
    isLoading: worktreesLoading,
  } = useWorktrees(organization, name);
  const {
    data: runs,
    error: runsError,
    isLoading: runsLoading,
  } = useWorkflowRuns(organization, name);

  const dataLoading = worktreesLoading || runsLoading;
  const dataHasLoadedOnce =
    !!worktrees || !!worktreesError || !!runs || !!runsError;
  const dataError = worktreesError || runsError;
  const dataErrorMessage = dataError
    ? dataError instanceof Error
      ? dataError.message
      : "Failed to load data"
    : null;

  return (
    <div className={styles.shell}>
      <aside className={styles.leftPane}>
        <div className={styles.headingRow}>
          <h1 className={styles.heading}>
            <Link
              href={`/repositories/${organization}/${name}`}
              className={styles.headingLink}
            >
              {alias}
            </Link>
          </h1>
          {repo?.github_url && (
            <a
              href={repo.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.githubLink}
              aria-label="Open on GitHub"
            >
              <GitHubIcon />
            </a>
          )}
        </div>
        {repo && (
          <WorktreeRunsSection
            organization={organization}
            name={name}
            worktrees={worktrees ?? []}
            runs={runs ?? []}
            loading={dataLoading}
            hasLoadedOnce={dataHasLoadedOnce}
            error={dataErrorMessage}
            onRunWorkflow={() => setShowLaunchModal(true)}
          />
        )}
        <section className={styles.paneSection}>
          <h3 className={styles.paneHeading}>Chats</h3>
          <button
            type="button"
            className={styles.newChatButton}
            onClick={() => {
              router.push(`/repositories/${organization}/${name}/chat/new`);
            }}
          >
            New Chat
          </button>
          {chats && chats.length > 0 && (
            <div className={styles.runsList}>
              {chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  organization={organization}
                  name={name}
                  onDeleted={mutateChats}
                />
              ))}
            </div>
          )}
        </section>
      </aside>
      <div className={styles.content}>{children}</div>
      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={alias}
        />
      )}
    </div>
  );
}
