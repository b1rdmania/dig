import type { Provenance as ProvenanceType } from "@/lib/types";
import styles from "./Provenance.module.css";

interface Props {
  provenance: ProvenanceType;
}

export function Provenance({ provenance }: Props) {
  return (
    <div className={styles.badge}>
      <span>{provenance.source}</span>
      <span>|</span>
      <span>{provenance.dump_date}</span>
      <span>|</span>
      <span>#{provenance.discogs_id}</span>
    </div>
  );
}
