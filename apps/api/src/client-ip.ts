/**
 * The visitor's IP address.
 *
 * Fly terminates the connection at its proxy, so req.ip is the proxy, not the
 * visitor. fly-client-ip is set by the platform and not spoofable through it;
 * x-forwarded-for is the fallback for other hosts, req.ip for direct (local)
 * connections. dig-api is not behind Cloudflare, so cf-connecting-ip is not read.
 */
import type { FastifyRequest } from "fastify";

export function clientIp(req: Pick<FastifyRequest, "headers" | "ip">): string {
  const fly = String(req.headers["fly-client-ip"] ?? "").trim();
  if (fly) return fly;
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.ip;
}
