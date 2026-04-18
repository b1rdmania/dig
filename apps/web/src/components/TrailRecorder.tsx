"use client";

import { useEffect } from "react";
import { pushTrail, type TrailKind } from "@/lib/trail";

interface Props {
  kind: TrailKind;
  id: string | number;
  name: string;
  subtitle?: string;
}

/**
 * Drop a breadcrumb onto the session trail when an entity page mounts.
 * Renders nothing. Idempotent across re-renders for the same id.
 */
export function TrailRecorder({ kind, id, name, subtitle }: Props) {
  const idStr = String(id);
  useEffect(() => {
    if (!name) return;
    pushTrail({ kind, id: idStr, name, subtitle });
  }, [kind, idStr, name, subtitle]);
  return null;
}
