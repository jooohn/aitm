"use client";

import { useLayoutEffect, useRef, useState } from "react";
import styles from "./CollapsibleText.module.css";

interface Props {
  children: React.ReactNode;
  /** Maximum number of visible lines before collapsing. Default 10. */
  maxLines?: number;
  className?: string;
}

export default function CollapsibleText({
  children,
  maxLines = 10,
  className,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(true);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: must re-measure when children or maxLines change
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // With -webkit-line-clamp applied, scrollHeight > clientHeight when overflowing
    setNeedsCollapse(el.scrollHeight > el.clientHeight + 1);
  }, [children, maxLines]);

  return (
    <div className={className}>
      <div
        ref={contentRef}
        className={clamped ? styles.clamped : styles.expanded}
        style={clamped ? { WebkitLineClamp: maxLines } : undefined}
      >
        {children}
      </div>
      {needsCollapse && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setClamped((v) => !v)}
        >
          {clamped ? "Show all" : "Show less"}
        </button>
      )}
    </div>
  );
}
