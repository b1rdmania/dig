"use client";

import { useState, type ReactNode } from "react";

interface Props {
  children: ReactNode[];
  maxVisible?: number;
  className?: string;
}

export function CollapsibleList({ children, maxVisible = 8, className }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (children.length <= maxVisible) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
      {expanded ? children : children.slice(0, maxVisible)}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.58rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase" as const,
          color: "var(--accent-light)",
          border: "1px solid var(--line)",
          borderRadius: "2px",
          padding: "0.16rem 0.55rem",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {expanded ? "Show less" : `+${children.length - maxVisible} more`}
      </button>
    </div>
  );
}
