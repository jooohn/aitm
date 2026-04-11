"use client";

import { type ReactNode, useEffect, useRef } from "react";
import OutputItemView from "@/app/(main)/sessions/[id]/OutputItemView";
import type { OutputItem } from "@/lib/utils/outputItem";
import styles from "./ChatTranscript.module.css";

interface Props {
  items: OutputItem[];
  isRunning?: boolean;
  emptyMessage?: string;
  className?: string;
  children?: ReactNode;
}

export default function ChatTranscript({
  items,
  isRunning = false,
  emptyMessage = "No output yet…",
  className,
  children,
}: Props) {
  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers the scroll
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [items, children]);

  function handleScroll() {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 10;
  }

  return (
    <div
      ref={outputRef}
      className={`${styles.output} ${className ?? ""}`}
      onScroll={handleScroll}
    >
      {items.length === 0 && !children ? (
        <span className={styles.empty}>{emptyMessage}</span>
      ) : (
        items.map((item, i) => (
          <OutputItemView
            key={i}
            item={item}
            isLastItem={i === items.length - 1}
            isRunning={isRunning}
          />
        ))
      )}
      {children}
    </div>
  );
}
