"use client";

/* eslint-disable @next/next/no-img-element -- Original artwork, local photo previews and attributed remote evidence use native images. */

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { onTheCounter, type Bottle } from "../counter";
import s from "./v2.module.css";
import { retainedMessages, wineHistory } from "./history";

const API = process.env.NEXT_PUBLIC_DIG_API_URL || "https://dig-api.fly.dev";
const STORAGE = "winebore-v2-conversation";
type Turn = { role: "user" | "assistant"; content: string; display?: string; image?: string; evidence?: Bottle[]; error?: boolean; stopped?: boolean; needsPhoto?: boolean; upload?: boolean };
type Attachment = { data: string; name: string };
type Event = { type: string; text?: string; answer?: string; evidence?: Bottle[]; error?: { message: string } };

function Icon({ name }: { name: "send" | "plus" | "copy" | "retry" | "close" | "arrow" | "stop" | "check" }) {
  const paths = {
    send: <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    copy: <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>,
    retry: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

async function prepareImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("That photo is rather large. Choose one under 20 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); throw new Error("Couldn't open that photo. Try another."); }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function WineBoreV2() {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [activity, setActivity] = useState("Opening the cellar book…");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const about = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const lastUser = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      if (Array.isArray(saved)) setMessages(saved.filter((t): t is Turn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-40));
    } catch { /* A disabled store must not prevent a conversation. */ }
    setReady(true);
    return () => { controller.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      // Photos are deliberately not retained in browser storage.
      localStorage.setItem(STORAGE, JSON.stringify(retainedMessages(messages).map(({ image: _image, ...turn }) => turn)));
    } catch { /* Storage full or disabled: the current conversation still works. */ }
  }, [messages, ready]);

  useEffect(() => {
    if (messages.at(-1)?.role === "user") lastUser.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = scroll.current;
    if (el) setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }, [messages, draft, busy]);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [input]);

  function trackScroll() {
    const el = scroll.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }

  async function selectPhoto(selected?: File) {
    if (!selected || lock.current || preparing) return;
    lock.current = true;
    setNotice(""); setPreparing(true);
    let photo: Attachment | undefined;
    try { photo = { data: await prepareImage(selected), name: selected.name }; }
    catch (error) { setNotice(error instanceof Error ? error.message : "Couldn't open that photo."); }
    finally { setPreparing(false); lock.current = false; if (file.current) file.current.value = ""; }
    if (photo) await uploadList(photo);
  }

  async function uploadList(photo: Attachment, base: Turn[] = messages) {
    if (lock.current) return;
    lock.current = true;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setNotice(""); setDraft(""); draftRef.current = "";
    setActivity("Reading your wine list…"); setNearBottom(true);
    const user: Turn = { role: "user", content: "", display: `Wine list: ${photo.name}`, image: photo.data, needsPhoto: true, upload: true };
    setMessages([...base, user]);
    try {
      const read = await fetch(`${API}/v1/wine/read-list`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: photo.data }), signal: abort.signal });
      const data = await read.json();
      if (!read.ok) throw new Error(data.error?.message || "Couldn't read that photo. Try a straighter one.");
      if (typeof data.list !== "string" || !data.list.trim()) throw new Error("Couldn't find a wine list in that photo. Try another.");
      setMessages([...base, { ...user, needsPhoto: false, content: `Here's my updated wine list:\n${data.list}`, display: `Wine list uploaded · ${photo.name}` }, { role: "assistant", content: "Wine list updated. What do you want to know?", upload: true }]);
    } catch (error) {
      setMessages([...base, user, { role: "assistant", content: abort.signal.aborted ? "Wine list upload stopped. Try again when you're ready." : error instanceof Error ? error.message : "Couldn't upload that wine list. Try again.", error: true, upload: true }]);
    } finally {
      setBusy(false); lock.current = false; controller.current = null;
      textarea.current?.focus();
    }
  }

  async function send(base: Turn[] = messages, retry?: Turn) {
    if (lock.current || preparing) return;
    const text = retry?.content ?? input.trim();
    if (!text) return;
    lock.current = true;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setNotice(""); setDraft(""); draftRef.current = "";
    if (!retry) setInput(""); setNearBottom(true);
    const user: Turn = retry ?? { role: "user", content: text };
    setMessages([...base, user]);
    let terminal = false;
    const finish = (turn: Turn) => { if (!terminal) { terminal = true; setMessages([...base, user, turn]); } };
    try {
      setActivity("Opening the cellar book…");
      const res = await fetch(`${API}/v1/ask/stream`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ bore: "wine", question: user.content, history: wineHistory(base) }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || "The shop's gone quiet. Try again in a moment.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder(); let buffer = "";
      const handle = (line: string) => {
        if (!line.trim() || terminal) return;
        let event: Event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "delta") { draftRef.current += event.text ?? ""; setDraft(draftRef.current); }
        if (event.type === "status") { draftRef.current = ""; setDraft(""); setActivity("A moment. There's something worth finding."); }
        if (event.type === "result") finish({ role: "assistant", content: event.answer || "Lost my train of thought. Ask me again.", evidence: event.evidence ?? [] });
        if (event.type === "error") finish({ role: "assistant", content: event.error?.message || "Something interrupted us. Try again.", error: true });
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        lines.forEach(handle);
      }
      buffer += decoder.decode(); handle(buffer);
      if (!terminal) throw new Error("The connection dropped. Try that again.");
    } catch (error) {
      if (abort.signal.aborted) finish({ role: "assistant", content: draftRef.current, stopped: true });
      else finish({ role: "assistant", content: error instanceof Error ? error.message : "Couldn't reach the shop. Check your connection.", error: true });
    } finally {
      setBusy(false); setDraft(""); draftRef.current = ""; lock.current = false; controller.current = null;
    }
  }

  function retryAt(index: number) {
    const user = messages[index - 1];
    if (user?.role !== "user") return;
    // A failed transcription needs the photo again, not an empty model question.
    if (user.needsPhoto) {
      if (user.image) void uploadList({ data: user.image, name: "Wine list" }, messages.slice(0, index - 1));
      else setNotice("Choose the wine-list photo again. Photos are not saved between visits.");
      return;
    }
    void send(messages.slice(0, index - 1), user);
  }

  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopied(index); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(null), 1800); }
    catch { setNotice("Couldn't copy automatically. You can select the answer to copy it."); }
  }

  function reset() {
    if (lock.current || preparing) return;
    setMessages([]); setInput(""); setNotice("");
    textarea.current?.focus();
  }
  const started = messages.length > 0;

  return (
    <div className={s.app} data-started={started}>
      {started && <header className={s.header}>
        <a className={s.brand} href="/winebore" aria-label="Wine Bore home">Wine Bore<span>.</span></a>
        <div className={s.headerActions}>
          <button className={s.newChat} onClick={reset} disabled={busy || preparing || !started} aria-label="New conversation"><Icon name="plus" /><span>New conversation</span></button>
        </div>
      </header>}

      <div ref={scroll} className={s.scroll} onScroll={trackScroll}>
        {!started ? (
          <section className={s.welcome}>
            <img className={s.heroFace} src="/winebore-face.png" alt="Wine Bore, unimpressed, holding a glass of red." width="482" height="512" />
            <h1><b>Wine Bore<span>.</span></b> Ask.</h1>
          </section>
        ) : (
          <section className={s.conversation} aria-label="Conversation">
            {messages.map((m, i) => m.role === "user" ? (
              <div key={i} ref={i === messages.length - 1 ? lastUser : undefined} className={s.userTurn}>
                <div className={s.userBubble}>
                  {m.image && <img className={s.listImage} src={m.image} alt="Your uploaded wine list" />}
                  <p>{m.display || m.content}</p>
                </div>
              </div>
            ) : (
              <article key={i} className={s.answer}>
                <div className={s.speaker}><img src="/winebore-face.png" alt="" /><span>Wine Bore<span className={s.red}>.</span></span></div>
                <div className={`${s.prose} ${m.error ? s.error : ""}`}><ReactMarkdown>{m.content}</ReactMarkdown></div>
                {m.stopped && <p className={s.status}>Response stopped.</p>}
                {!m.error && !m.stopped && !m.needsPhoto && <Counter bottles={onTheCounter(m.evidence, m.content)} />}
                <div className={s.answerActions}>
                  {m.content && <button onClick={() => void copy(m.content, i)} aria-label={copied === i ? "Answer copied" : "Copy answer"}><Icon name={copied === i ? "check" : "copy"} />{copied === i ? "Copied" : "Copy"}</button>}
                  {i === messages.length - 1 && (!m.upload || m.error) && messages[i - 1]?.role === "user" && <button onClick={() => retryAt(i)} disabled={busy}><Icon name="retry" />Try again</button>}
                </div>
              </article>
            ))}
            {busy && <article className={s.answer} aria-busy="true">
              <div className={s.speaker}><img src="/winebore-face.png" alt="" /><span>Wine Bore<span className={s.red}>.</span></span></div>
              {draft ? <div className={`${s.prose} ${s.streaming}`}><ReactMarkdown>{draft}</ReactMarkdown></div> : <p className={s.thinking} role="status"><span />{activity}</p>}
            </article>}
          </section>
        )}
        <div ref={bottom} className={s.bottom} />
      </div>

      <div className={`${s.composerArea} ${!started ? s.openingComposer : ""}`}>
        {!nearBottom && started && <button className={s.jump} onClick={() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }}>Latest reply ↓</button>}
        <form className={s.composer} onSubmit={(e) => { e.preventDefault(); void send(); }}>

          <label className={s.srOnly} htmlFor="wine-v2-question">Ask Wine Bore</label>
          <textarea ref={textarea} id="wine-v2-question" rows={1} value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="Go on then." onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className={s.composerTools}>
            <input ref={file} className={s.srOnly} type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} onChange={(e) => void selectPhoto(e.target.files?.[0])} />
            <button type="button" className={s.upload} onClick={() => file.current?.click()} disabled={busy || preparing || !ready}><Icon name="plus" /><span>{preparing ? "Preparing photo…" : "Upload a wine list."}</span></button>
            <div className={s.sendSide}>{input.length > 900 && <span className={s.charCount}>{input.length}/1000</span>}{busy ? <button type="button" className={s.send} onClick={() => controller.current?.abort()} aria-label="Stop response"><Icon name="stop" /></button> : <button type="submit" className={s.send} disabled={!input.trim() || preparing || !ready} aria-label="Send message"><Icon name="send" /></button>}</div>
          </div>
        </form>
        {notice && <p className={s.notice} role="alert">{notice}</p>}
        <div className={s.footnote}>{started && <span>Conversation saved on this device. Photos aren't saved.</span>}<button onClick={() => about.current?.showModal()}>How we built this</button></div>
      </div>

      <dialog ref={about} className={s.about} onClick={(e) => { if (e.target === about.current) about.current?.close(); }}>
        <div className={s.aboutInner}><button className={s.close} onClick={() => about.current?.close()} aria-label="Close about"><Icon name="close" /></button><h2>How we built this</h2>
            <p>This started with Record Bore. I wanted to see if we could give a language model the kind of taste and strong opinions you don&rsquo;t naturally get from GPT or Claude.</p>
            <p>We gave him an opinionated persona, then collated and processed a lot of wine data. Currently about 40 GB of information on wines, producers, regions and the rules behind them, which he can look up when you ask him something.</p>
            <p>The data starts with Liv-ex&rsquo;s wine list, then adds regional rulebooks and producer information. The rulebooks even describe how the wine should taste, which gives him something to work with.</p>
            <p>Still an experiment. Ask him about a bottle, or upload a wine list and see what he makes of it.</p>
            <div className={s.aboutFooter}>
              <span>Made by b1rdmania · </span>
              <span><a href="https://github.com/b1rdmania" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://x.com/b1rdmania" target="_blank" rel="noopener noreferrer">X</a></span>
            </div>
</div>
      </dialog>
    </div>
  );
}

function Counter({ bottles }: { bottles: Bottle[] }) {
  const items = bottles.filter((b) => b.type === "wine" || b.type === "producer");
  const featured = items.find((b) => b.type === "wine");
  const supporting = items.filter((b) => b !== featured);
  const places = bottles.filter((b) => b.type === "appellation");
  if (!items.length && !places.length) return null;

  return <div className={s.counter}>
    {featured && <>
      <div className={s.counterHeading}><span>On the counter</span></div>
      <article className={s.featuredWine}>
        {featured.image && <a className={s.featuredImage} href={featured.image.page} target="_blank" rel="noopener noreferrer">
          <img src={featured.image.src} alt={`Producer image for ${featured.title}`} loading="lazy" />
        </a>}
        <div className={s.featuredBody}>
          <h3>{featured.title}</h3>
          {featured.subtitle && <p>{featured.subtitle}</p>}
          <div className={s.featuredActions}>
            {featured.find_url && <a className={s.findWine} href={featured.find_url} target="_blank" rel="noopener noreferrer">Find this wine <Icon name="arrow" /></a>}
            {featured.site_url && <a href={featured.site_url} target="_blank" rel="noopener noreferrer">Producer website ↗</a>}
          </div>
          {featured.image && <a className={s.credit} href={featured.image.page} target="_blank" rel="noopener noreferrer">{featured.image.credit || "Wikimedia Commons"}{featured.image.licence ? ` · ${featured.image.licence}` : ""}</a>}
        </div>
      </article>
    </>}
    {supporting.length > 0 && (featured ? (
      <details className={s.references}>
        <summary>Also mentioned <span>{supporting.length} <span className={s.expand}>+</span></span></summary>
        <ReferenceRows items={supporting} />
      </details>
    ) : <><div className={s.counterHeading}><span>On the counter</span></div><ReferenceRows items={supporting} /></>)}
    {places.length > 0 && <details className={s.places}>
      <summary><span>Where it comes from</span><span>{places.map((b) => b.title).join(" · ")} <span className={s.expand}>+</span></span></summary>
      <div className={s.placeGrid}>{places.map((b) => <div key={b.id}>{b.map_url && <a href={b.map_url} target="_blank" rel="noopener noreferrer"><img src={b.map_url} alt={`Map of ${b.title}`} /></a>}<h3>{b.title}</h3>{b.subtitle && <p>{b.subtitle}</p>}</div>)}</div>
    </details>}
  </div>;
}

function ReferenceRows({ items }: { items: Bottle[] }) {
  return <div className={s.referenceRows}>{items.map((b) => <div key={`${b.type}/${b.id}`} className={s.referenceRow}>
    <div><h3>{b.title}</h3>{b.subtitle && <p>{b.subtitle}</p>}</div>
    <div className={s.referenceLinks}>
      {b.site_url && <a href={b.site_url} target="_blank" rel="noopener noreferrer" aria-label={`Producer website for ${b.title}`}>Website ↗</a>}
      {b.find_url && <a href={b.find_url} target="_blank" rel="noopener noreferrer" aria-label={`Find ${b.title}`}>Find <Icon name="arrow" /></a>}
    </div>
  </div>)}</div>;
}
