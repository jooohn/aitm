"use client";

import { useState } from "react";
import type { SessionStatus } from "@/lib/utils/api";
import type {
  CommandExecutionItem,
  CommandGroupItem,
  OutputItem,
  ProcessingStepsItem,
  ToolCallItem,
} from "@/lib/utils/outputItem";
import styles from "./SessionDetail.module.css";

interface Props {
  item: OutputItem;
  isLastItem?: boolean;
  sessionStatus?: SessionStatus;
}

function renderInputDetails(input: unknown): React.ReactNode {
  if (input === null || input === undefined) {
    return (
      <span className={styles.toolCallNoDetails}>No details available</span>
    );
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <span className={styles.toolCallNoDetails}>No details available</span>
      );
    }
    return (
      <dl className={styles.toolCallInputList}>
        {entries.map(([key, value]) => (
          <div key={key} className={styles.toolCallInputRow}>
            <dt className={styles.toolCallInputKey}>{key}</dt>
            <dd className={styles.toolCallInputValue}>
              {typeof value === "string" ? (
                value
              ) : (
                <pre className={styles.toolCallInputPre}>
                  {JSON.stringify(value, null, 2)}
                </pre>
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <pre className={styles.toolCallInputPre}>
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function ToolCallView({
  item,
  indented = false,
}: {
  item: ToolCallItem;
  indented?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`${styles.toolCallRow} ${indented ? styles.toolCallRowIndented : ""}`}
    >
      <button
        type="button"
        className={styles.toolCallHeader}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.toolCallChevron}>{expanded ? "▼" : "▶"}</span>
        <span className={styles.toolCallName}>{item.toolName}</span>
      </button>
      {expanded && (
        <div className={styles.toolCallBody}>
          {item.input !== undefined ? (
            renderInputDetails(item.input)
          ) : (
            <span className={styles.toolCallNoDetails}>
              No details available
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeCommand(command: string): string {
  if (command.includes("rg --files")) return "List repository files";
  if (command.includes("git status")) return "Check git status";
  if (command.includes("npm test")) return "Run tests";
  if (command.includes("sed -n")) return "Read file";
  return "Run command";
}

function formatExitLabel(item: CommandExecutionItem): string | null {
  if (item.status === "failed") {
    return item.exitCode !== undefined
      ? `Failed with exit ${item.exitCode}`
      : "Failed";
  }
  if (item.exitCode !== undefined) {
    return `Exit ${item.exitCode}`;
  }
  if (item.status) {
    return item.status;
  }
  return null;
}

function CommandExecutionView({ item }: { item: CommandExecutionItem }) {
  const isFailed =
    item.status === "failed" ||
    (typeof item.exitCode === "number" && item.exitCode !== 0);
  const [expanded, setExpanded] = useState(isFailed);
  const statusLabel = formatExitLabel(item);

  return (
    <div
      className={`${styles.commandRow} ${isFailed ? styles.commandRowFailed : styles.commandRowSuccess}`}
    >
      <button
        type="button"
        className={styles.commandHeader}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.toolCallChevron}>{expanded ? "▼" : "▶"}</span>
        <span className={styles.commandSummary}>
          {summarizeCommand(item.command)}
        </span>
        {statusLabel && (
          <span
            className={styles.commandStatus}
            data-failed={isFailed || undefined}
          >
            {statusLabel}
          </span>
        )}
      </button>
      <div className={styles.commandPreview}>{item.command}</div>
      {expanded && (
        <div className={styles.commandBody}>
          {item.output ? (
            <pre className={styles.commandOutput}>{item.output}</pre>
          ) : (
            <span className={styles.toolCallNoDetails}>No output captured</span>
          )}
        </div>
      )}
    </div>
  );
}

function CommandGroupView({ item }: { item: CommandGroupItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.commandGroupRow}>
      <button
        type="button"
        className={styles.commandHeader}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.toolCallChevron}>{expanded ? "▼" : "▶"}</span>
        <span className={styles.commandSummary}>
          {item.calls.length} {item.summary}
        </span>
      </button>
      {expanded && (
        <div className={styles.commandGroupBody}>
          {item.calls.map((call, i) => (
            <CommandExecutionView key={i} item={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProcessingStepsView({
  item,
  isActive,
}: {
  item: ProcessingStepsItem;
  isActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalCount = item.items.reduce((sum, child) => {
    if (child.kind === "tool_group") return sum + child.calls.length;
    if (child.kind === "command_group") return sum + child.calls.length;
    return sum + 1;
  }, 0);

  const label = isActive
    ? `Processing ${totalCount} steps…`
    : `Processed ${totalCount} steps`;

  return (
    <div className={styles.processingStepsRow}>
      <button
        type="button"
        className={styles.processingStepsHeader}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.toolCallChevron}>{expanded ? "▼" : "▶"}</span>
        <span className={styles.processingStepsLabel}>{label}</span>
      </button>
      {expanded && (
        <div className={styles.processingStepsBody}>
          {item.items.map((child, i) => (
            <OutputItemView key={i} item={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OutputItemView({
  item,
  isLastItem,
  sessionStatus,
}: Props) {
  const [groupExpanded, setGroupExpanded] = useState(false);

  switch (item.kind) {
    case "text":
      return <div className={styles.outputLine}>{item.content}</div>;

    case "user_input":
      return (
        <div className={styles.userInputRow}>
          <span className={styles.userInputLabel}>You</span>
          <span className={styles.userInputContent}>{item.content}</span>
        </div>
      );

    case "tool_call":
      return <ToolCallView item={item} />;

    case "command_execution":
      return <CommandExecutionView item={item} />;

    case "command_group":
      return <CommandGroupView item={item} />;

    case "processing_steps":
      return (
        <ProcessingStepsView
          item={item}
          isActive={!!isLastItem && sessionStatus === "running"}
        />
      );

    case "tool_group": {
      const count = item.calls.length;
      return (
        <div className={styles.toolGroupRow}>
          <button
            type="button"
            className={styles.toolCallHeader}
            onClick={() => setGroupExpanded((v) => !v)}
          >
            <span className={styles.toolCallChevron}>
              {groupExpanded ? "▼" : "▶"}
            </span>
            <span className={styles.toolCallName}>
              {count} {item.toolName} calls
            </span>
          </button>
          {groupExpanded && (
            <div className={styles.toolGroupBody}>
              {item.calls.map((call, i) => (
                <ToolCallView key={i} item={call} indented />
              ))}
            </div>
          )}
        </div>
      );
    }
  }
}
