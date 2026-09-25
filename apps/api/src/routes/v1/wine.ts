// ---------------------------------------------------------------------------
// /v1/wine - the small public surface the Wine Bore page needs besides /v1/ask.
//   GET /v1/wine/opener   a real bottle/grower/appellation for the page to open on
//   GET /v1/wine/stats    row counts, for the shop window and the eval
//   POST /v1/wine/read-list  a photo of a wine list -> plain text, one wine a
//                            line, so the page can hand it to /v1/ask as a turn
// The read step is the only model call here; everything else is structured data.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { Database, Kysely } from "@dig/db";
import { sql } from "@dig/db";
import { randomOpenerSubject } from "@dig/domain";
import { cachePublic } from "./util.js";
import { requirePrivateKey } from "./ask/auth.js";
import { checkPublicAsk, isPublicAskEnabled, recordPublicAsk } from "./ask/public.js";
import { providerPreference } from "./ask/loop.js";
import { getBore } from "./ask/bores.js";

// Reading a list is one ask on the wine till. The image goes to the same
// model the Bore runs on (Kimi K3 takes images on OpenRouter); it comes
// back as text and the page sends that text through /v1/ask like any turn,
// so every name the Bore then mocks is still looked up.
const READ_MODEL = process.env.LLM_MODEL ?? "moonshotai/kimi-k3";
const READ_PROMPT = [
  "This is a photo of a wine list, or a shelf, or a menu.",
  "Transcribe the wines. One wine per line: producer, wine name, vintage, price, exactly as printed, in the order printed. Keep section headings (e.g. Champagne, Reds) on their own line.",
  "No commentary. No markdown. If the photo is not a wine list, reply with the single word NOT_A_LIST.",
].join(" ");
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// The line the page opens on. He's mid-thought when you walk in: short,
// dry, a bit rude, never a greeting and never "how can I help". Some lines
// name something real from the cellar book (a shelf pick or a classified
// wine), each only with the kind of subject it reads right for; some name
// nothing. No line states a fact about its subject - nothing's been looked
// up yet, and the model sees the opener as its own first turn.
type OpenerKind = "wine" | "producer" | "appellation";
interface Opener { kinds: OpenerKind[] | null; line: (name: string, where: string | null) => string }

const ANY: OpenerKind[] = ["wine", "producer", "appellation"];
const OPENERS: Opener[] = [
  // Cold opens: no subject.
  { kinds: null, line: () => "Yes? And if it's Prosecco, no." },
  { kinds: null, line: () => "Shut the door, you're letting the Malbec drinkers in." },
  { kinds: null, line: () => "Before you say it: I don't do \"smooth\"." },
  { kinds: null, line: () => "You've got a Pinot Grigio face. Prove me wrong." },
  { kinds: null, line: () => "Nothing's for sale. Everything's up for argument. Go on." },
  { kinds: null, line: () => "I've read every rulebook in Europe so you don't have to. What?" },
  { kinds: null, line: () => "If it's \"the Rioja we had on holiday\", I can't help you. Anything else, try me." },
  { kinds: null, line: () => "You again. Or someone with the same haircut. What?" },
  { kinds: null, line: () => "Thirty years of this and people still ask what goes with fish. Don't." },
  { kinds: null, line: () => "Don't tell me what you like. Tell me what you drank last and I'll tell you what's wrong with it." },
  // Something he's drinking.
  { kinds: ["wine"], line: (n) => `I've got the ${n} open and nobody to be smug at. You'll do.` },
  { kinds: ["wine"], line: (n) => `Keep your voice down, the ${n} is breathing.` },
  { kinds: ["wine"], line: (n) => `I'd pour you some ${n}, but you'd call it "smooth". Ask me something instead.` },
  { kinds: ["wine"], line: (n) => `Nothing's for sale. I'm drinking the ${n}. You're not. What?` },
  // A grower or a place.
  { kinds: ANY, line: (n) => `${n}. Heard of it? Didn't think so. Ask.` },
  { kinds: ANY, line: (n) => `Mid-argument with myself about ${n}. I'm losing. Distract me.` },
  { kinds: ANY, line: (n) => `Somebody called ${n} "fruity" this morning. I'm still not over it.` },
  { kinds: ANY, line: (n) => `Three people asked about ${n} today. None of them deserved it. Your turn.` },
  { kinds: ["producer"], line: (n, w) => `${n}${w ? `, ${w}` : ""}. Write that down. Right - what?` },
  { kinds: ["producer"], line: (n) => `If ${n} ever sends me a Christmas card I'll retire. What do you want?` },
  { kinds: ["appellation"], line: (n, w) => `I read the ${n} rulebook for fun last night${w ? `. In ${w} they'd call that normal` : ""}. What's yours?` },
  { kinds: ["appellation"], line: (n) => `Say "${n}" properly or don't say it at all. Go on.` },
];

// Appellation context arrives as a country code ("FR"); say the country.
const COUNTRY = new Intl.DisplayNames(["en-GB"], { type: "region" });
function place(where: string | null): string | null {
  if (!where) return null;
  if (/^[A-Z]{2}$/.test(where)) {
    try { return COUNTRY.of(where) ?? null; } catch { return null; }
  }
  return where;
}

// With something real to hand he names it most of the time; the cold opens
// keep him from sounding like a rotation.
const NAMED_SHARE = 0.7;

export function pickOpener(subject: { kind: OpenerKind; name: string; context: string | null } | null, rand = Math.random): string {
  const cold = OPENERS.filter((o) => o.kinds === null);
  const named = subject ? OPENERS.filter((o) => o.kinds?.includes(subject.kind)) : [];
  const pool = named.length && rand() < NAMED_SHARE ? named : cold;
  const o = pool[Math.floor(rand() * pool.length)];
  // "Chateau Margaux Premier Cru Classe, Margaux" -> the part before the comma.
  const name = subject?.kind === "wine" ? subject.name.split(",")[0].trim() : subject?.name ?? "";
  return o.line(name, place(subject?.context ?? null));
}

export function registerWineRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get("/v1/wine/opener", async (_req, reply) => {
    try {
      const subject = await randomOpenerSubject(db);
      const text = pickOpener(subject);
      reply.header("cache-control", "no-store");
      return reply.send({ text, subject });
    } catch {
      return reply.send({ text: pickOpener(null), subject: null });
    }
  });

  app.post<{ Body: { image?: string } }>("/v1/wine/read-list", {
    bodyLimit: MAX_IMAGE_BYTES + 512 * 1024,
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const bore = getBore("wine");
    const auth = requirePrivateKey(req);
    let isPublic = false;
    if (!auth.ok) {
      if (!isPublicAskEnabled()) return reply.status(auth.status).send(auth.body);
      const pub = await checkPublicAsk(req, db, bore.quotaKey);
      if (!pub.ok) return reply.status(pub.status).send(pub.body);
      isPublic = true;
    }
    const apiKey = String(process.env.OPENROUTER_API_KEY ?? "").trim();
    if (!apiKey) return reply.status(503).send({ error: { code: "CONFIG_ERROR", message: "LLM provider is not configured", details: null } });

    const image = String(req.body?.image ?? "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_BYTES * 1.4) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "image must be a jpeg, png or webp data URL under 6 MB", details: null } });
    }

    if (isPublic) await recordPublicAsk(db, bore.quotaKey);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "http-referer": "https://app.dig.baby", "x-title": "Dig" },
        body: JSON.stringify({
          model: READ_MODEL,
          max_tokens: 900,
          temperature: 0.1,
          provider: providerPreference(READ_MODEL),
          reasoning: { effort: "low" },
          messages: [{ role: "user", content: [{ type: "text", text: READ_PROMPT }, { type: "image_url", image_url: { url: image } }] }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        req.log.warn({ event: "wine_read_list_failed", status: res.status, body: (await res.text()).slice(0, 300) });
        return reply.status(502).send({ error: { code: "UPSTREAM", message: "Couldn't read that. Try a straighter photo.", details: null } });
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = String(data.choices?.[0]?.message?.content ?? "").trim();
      req.log.info({ event: "wine_read_list", ms: Date.now() - started, chars: text.length });
      if (!text || /^NOT_A_LIST\b/i.test(text)) {
        return reply.send({ list: null });
      }
      // Cap what goes back so it fits the ask's 1000-char question limit with room for the framing.
      return reply.send({ list: text.slice(0, 850) });
    } catch (err) {
      req.log.warn({ event: "wine_read_list_error", err: String(err) });
      return reply.status(502).send({ error: { code: "UPSTREAM", message: "Couldn't read that. Try again.", details: null } });
    } finally {
      clearTimeout(timer);
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
