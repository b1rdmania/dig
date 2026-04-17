import type { CSSProperties, ReactNode } from "react";
import styles from "./MonoTable.module.css";

interface Props {
  /** A CSS grid-template-columns string. e.g. "44px 1fr 60px" */
  columns: string;
  children: ReactNode;
  className?: string;
}

interface RowProps {
  children: ReactNode;
  /** Optional click handler — adds hover state and pointer cursor. */
  onClick?: () => void;
  className?: string;
  /** Render the row dimmed (out-of-scope, secondary). */
  dim?: boolean;
}

interface CellProps {
  children: ReactNode;
  align?: "start" | "end";
  /** Render with sans body type instead of mono (for titles inside otherwise-mono rows). */
  body?: boolean;
  className?: string;
}

/**
 * A mono-aligned tabular layout via CSS grid. Used by tracklists and the
 * notable-versions component. Children should be <MonoTable.Row>s, each
 * containing the same number of <MonoTable.Cell>s as columns.
 */
export function MonoTable({ columns, children, className }: Props) {
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <div className={`${styles.table}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </div>
  );
}

MonoTable.Row = function Row({ children, onClick, className, dim }: RowProps) {
  return (
    <div
      className={`${styles.row}${dim ? ` ${styles.dim}` : ""}${onClick ? ` ${styles.clickable}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      style={{ gridColumn: "1 / -1" }}
    >
      {children}
    </div>
  );
};

MonoTable.Cell = function Cell({ children, align = "start", body = false, className }: CellProps) {
  return (
    <span
      className={`${styles.cell}${align === "end" ? ` ${styles.alignEnd}` : ""}${body ? ` ${styles.body}` : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
};
