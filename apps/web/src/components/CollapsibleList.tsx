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
          fontSize: "0.7rem",
          color: "var(--link)",
          border: "1px solid var(--line)",
          borderRadius: "2px",
          padding: "0.15rem 0.5rem",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {expanded ? "Show less" : `+${children.length - maxVisible} more`}
      </button>
    </div>
  );
}
