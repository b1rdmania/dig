// ---------------------------------------------------------------------------
// /v1/wine - the small public surface the Wine Bore page needs besides /v1/ask.
//   GET /v1/wine/opener   a real bottle/grower/appellation for the page to open on
//   GET /v1/wine/stats    row counts, for the shop window and the eval
// No LLM here; structured data only, like the rest of the API.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { Database, Kysely } from "@dig/db";
import { sql } from "@dig/db";
import { randomOpenerSubject } from "@dig/domain";
import { cachePublic } from "./util.js";

// Eight ways to open on something real. {name} is the subject, {ctx} its
// region/appellation. The page picks one; the model then sees it as the
// first assistant turn.
const OPENERS: Array<(name: string, ctx: string | null) => string> = [
  (n, c) => `Anyway. I was just refiling ${n}${c ? ` under ${c}` : ""}, which is where it belongs. What do you want?`,
  (n) => `If you've come in to say "smooth", the door's behind you. If you've come in about ${n}, sit down.`,
  (n, c) => `Someone's just asked me for Malbec. I gave them ${n}${c ? ` - ${c}` : ""} and they looked frightened. Go on then.`,
  (n) => `Kettle's on. I was halfway through an argument with myself about ${n}. Make it quick or make it interesting.`,
  (n, c) => `${n}. ${c ? `${c}. ` : ""}Nobody asks for it, everybody should. Anyway - what are you after?`,
  (n) => `Don't lean on the rack. And don't say Prosecco. I've got ${n} open in the back if you can behave.`,
  (n, c) => `Between suppliers at the moment, so nothing's on the shelf - but I know exactly what ${n}${c ? ` from ${c}` : ""} is allowed to be, which is more than most. Ask.`,
  (n) => `You've got the look of someone about to say "a nice red". Be more specific, or I'll start on ${n} and you'll be here an hour.`,
];

export function registerWineRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get("/v1/wine/opener", async (_req, reply) => {
    try {
      const subject = await randomOpenerSubject(db);
      const name = subject?.name ?? "the Jura";
      const ctx = subject?.context ?? null;
      const text = OPENERS[Math.floor(Math.random() * OPENERS.length)](name, ctx);
      reply.header("cache-control", "no-store");
      return reply.send({ text, subject });
    } catch {
      return reply.send({ text: OPENERS[1]("the Jura", null), subject: null });
    }
  });

  app.get("/v1/wine/stats", async (_req, reply) => {
    try {
      const r = await sql<{ k: string; n: string }>`
        SELECT 'appellations' AS k, count(*)::text AS n FROM wine.appellations
        UNION ALL SELECT 'producers', count(*)::text FROM wine.producers
        UNION ALL SELECT 'wines', count(*)::text FROM wine.wines WHERE status = 'Live'
        UNION ALL SELECT 'grapes', count(*)::text FROM wine.grapes
        UNION ALL SELECT 'documents', count(*)::text FROM wine.appellation_documents
        UNION ALL SELECT 'listings', count(*)::text FROM wine.listings
        UNION ALL SELECT 'shelves', count(*)::text FROM wine.shelves
      `.execute(db);
      const out: Record<string, number> = {};
      for (const row of r.rows) out[row.k] = Number(row.n);
      cachePublic(reply, 300);
      return reply.send(out);
    } catch (err: any) {
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: String(err?.message ?? err), details: null } });
    }
  });
}
