"use client";

import { useEffect } from "react";
import { trackReleasePageViewed, trackVersionPageViewed } from "@/lib/analytics";

interface Props {
  type: "release" | "version";
  entityId: number;
  title: string;
}

export function PageViewTracker({ type, entityId, title }: Props) {
  useEffect(() => {
    if (type === "release") {
      trackReleasePageViewed(entityId, title);
    } else {
      trackVersionPageViewed(entityId, title);
    }
  }, [type, entityId, title]);

  return null;
}
