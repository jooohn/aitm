"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import styles from "./ArtifactPage.module.css";

interface ArtifactViewerProps {
  path: string;
  content: string;
}

function getFileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function MarkdownViewer({ content }: { content: string }) {
  return <Markdown>{content}</Markdown>;
}

function JsonViewer({ content }: { content: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }
  return <pre>{formatted}</pre>;
}

function RawViewer({ content }: { content: string }) {
  return <pre>{content}</pre>;
}

type ViewMode = "preview" | "raw";

function hasFormattedView(ext: string): boolean {
  return ext === ".md" || ext === ".json";
}

function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className={styles.viewModeToggle}>
      <button
        type="button"
        className={`${styles.viewModeButton} ${viewMode === "preview" ? styles.viewModeButtonActive : ""}`}
        aria-pressed={viewMode === "preview"}
        onClick={() => onViewModeChange("preview")}
      >
        Preview
      </button>
      <button
        type="button"
        className={`${styles.viewModeButton} ${viewMode === "raw" ? styles.viewModeButtonActive : ""}`}
        aria-pressed={viewMode === "raw"}
        onClick={() => onViewModeChange("raw")}
      >
        Raw
      </button>
    </div>
  );
}

export function useArtifactViewMode(path: string) {
  const ext = getFileExtension(path);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const showToggle = hasFormattedView(ext);
  return { viewMode, setViewMode, showToggle };
}

export { ViewModeToggle };

export default function ArtifactViewer({
  path,
  content,
  viewMode,
}: ArtifactViewerProps & { viewMode: ViewMode }) {
  const ext = getFileExtension(path);

  const renderContent = () => {
    if (viewMode === "raw" || !hasFormattedView(ext)) {
      return <RawViewer content={content} />;
    }
    if (ext === ".md") {
      return <MarkdownViewer content={content} />;
    }
    if (ext === ".json") {
      return <JsonViewer content={content} />;
    }
    return <RawViewer content={content} />;
  };

  const dataType =
    viewMode === "raw" || !hasFormattedView(ext)
      ? "raw"
      : ext === ".md"
        ? "markdown"
        : ext === ".json"
          ? "json"
          : "raw";

  return (
    <div data-testid="artifact-viewer" data-type={dataType}>
      {renderContent()}
    </div>
  );
}
