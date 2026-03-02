"use client";

import { trackOutboundDiscogsClicked } from "@/lib/analytics";

interface Props {
  href: string;
  entityType: string;
  entityId: number;
  className?: string;
  children: React.ReactNode;
}

export function OutboundLink({ href, entityType, entityId, className, children }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={() => trackOutboundDiscogsClicked(entityType, entityId)}
    >
      {children}
    </a>
  );
}
