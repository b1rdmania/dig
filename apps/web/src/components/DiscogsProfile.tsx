import Link from "next/link";
import { type ReactNode } from "react";

/**
 * Parses Discogs profile markup (BBCode-ish) into React.
 *
 * Discogs uses:
 *   - Inline formatting: [b], [i], [u], [s] and their closing counterparts.
 *   - Numeric ID refs:   [a123456], [l123456], [m123456], [r123456].
 *   - Named refs:        [a=Artist Name], [l=Label Name], [m=Name], [r=Name].
 *   - URLs:              [url=https://…]label[/url] and [url]https://…[/url].
 *
 * Numeric refs we route to the corresponding entity page (resolved to a
 * readable name via `names` when provided). Named refs we route through
 * `/search?q=…&type=…` because we don't have a name→ID crosswalk on hand at
 * render time (Discogs doesn't store the ID in the markup; resolving one-
 * by-one would be a perf cliff on the initial paint). Search lands the user
 * where they'd expect.
 *
 * Paragraphs are split on blank lines (CR/LF tolerant). Single newlines
 * inside a paragraph become `<br>` so mid-paragraph linebreaks survive.
 */
export function DiscogsProfile({
  text,
  className,
  names,
  style,
}: {
  text: string;
  className?: string;
  /** Optional map of discogs IDs (e.g. "a123") → display names for inline refs */
  names?: Record<string, string>;
  style?: React.CSSProperties;
}) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={className} style={style}>
      {paragraphs.map((para, i) => (
        <p key={i}>{parseInline(para, names, String(i))}</p>
      ))}
    </div>
  );
}

/** Extract all entity IDs referenced in profile text (numeric refs only). */
export function extractProfileRefs(text: string): {
  artists: number[];
  labels: number[];
} {
  const artists: number[] = [];
  const labels: number[] = [];
  const pattern = /\[a(\d+)\]|\[l(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) artists.push(Number(match[1]));
    if (match[2]) labels.push(Number(match[2]));
  }
  return {
    artists: [...new Set(artists)],
    labels: [...new Set(labels)],
  };
}

// ── Internals ───────────────────────────────────────────────────────────────

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Paths we use for named-ref links; keep search-route compatible. */
const SEARCH_TYPE: Record<"a" | "l" | "m" | "r", string> = {
  a: "artist",
  l: "label",
  m: "master",
  r: "release",
};

const ENTITY_PATH: Record<"a" | "l" | "m" | "r", string> = {
  a: "artist",
  l: "label",
  m: "master",
  r: "master",
};

/**
 * One alternation capturing every Discogs markup token we support. Order
 * matters — the named-ref alternative must sit before the numeric ref so
 * `[a=Zip]` doesn't get partially consumed by `[a\d+]`.
 *
 * Groups:
 *    1 = [b]…[/b]       — bold body
 *    2 = [i]…[/i]       — italic body
 *    3 = [u]…[/u]       — underline body
 *    4 = [s]…[/s]       — strike body
 *    5 = kind of [x=Name]   (a/l/m/r)
 *    6 = Name  of [x=Name]
 *    7 = kind of [xID]
 *    8 = ID    of [xID]
 *    9 = href  of [url=…]…[/url]
 *   10 = body  of [url=…]…[/url]
 *   11 = bare  of [url]…[/url]
 */
const INLINE_PATTERN =
  /\[b\]([\s\S]*?)\[\/b\]|\[i\]([\s\S]*?)\[\/i\]|\[u\]([\s\S]*?)\[\/u\]|\[s\]([\s\S]*?)\[\/s\]|\[([almr])=([^\]]+)\]|\[([almr])(\d+)\]|\[url=([^\]]+)\]([\s\S]*?)\[\/url\]|\[url\]([^[\]\s]+)\[\/url\]/g;

function parseInline(
  text: string,
  names: Record<string, string> | undefined,
  keyBase: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  // Fresh regex per call — `g`-flag state is per-instance and recursive
  // calls below would otherwise share the same `lastIndex`.
  const pattern = new RegExp(INLINE_PATTERN.source, INLINE_PATTERN.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(renderWithLineBreaks(text.slice(lastIndex, match.index), `${keyBase}-t${counter}`));
    }
    const k = `${keyBase}-${counter++}`;

    if (match[1] !== undefined) {
      out.push(<strong key={k}>{parseInline(match[1], names, k)}</strong>);
    } else if (match[2] !== undefined) {
      out.push(<em key={k}>{parseInline(match[2], names, k)}</em>);
    } else if (match[3] !== undefined) {
      out.push(<u key={k}>{parseInline(match[3], names, k)}</u>);
    } else if (match[4] !== undefined) {
      out.push(<s key={k}>{parseInline(match[4], names, k)}</s>);
    } else if (match[5] && match[6]) {
      // Named ref: [a=Name] → search link
      const kind = match[5] as "a" | "l" | "m" | "r";
      const name = match[6].trim();
      out.push(
        <Link
          key={k}
          href={`/search?q=${encodeURIComponent(name)}&type=${SEARCH_TYPE[kind]}`}
        >
          {name}
        </Link>,
      );
    } else if (match[7] && match[8]) {
      // Numeric ref: [a123] → entity page (or Discogs fallback if we don't know the name)
      const kind = match[7] as "a" | "l" | "m" | "r";
      const id = match[8];
      const resolved = names?.[`${kind}${id}`];
      if (resolved) {
        out.push(
          <Link key={k} href={`/${ENTITY_PATH[kind]}/${id}`}>
            {resolved}
          </Link>,
        );
      } else {
        // Fall back to Discogs with the canonical URL for that entity kind.
        const discogsPath = kind === "r" ? "release" : kind === "m" ? "master" : kind === "l" ? "label" : "artist";
        out.push(
          <a
            key={k}
            href={`https://www.discogs.com/${discogsPath}/${id}`}
            target="_blank"
            rel="noreferrer"
          >
            {kind === "a" ? "artist" : kind === "l" ? "label" : "release"}
          </a>,
        );
      }
    } else if (match[9] && match[10] !== undefined) {
      out.push(
        <a key={k} href={match[9]} target="_blank" rel="noreferrer">
          {parseInline(match[10], names, k)}
        </a>,
      );
    } else if (match[11]) {
      out.push(
        <a key={k} href={match[11]} target="_blank" rel="noreferrer">
          {match[11]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    out.push(renderWithLineBreaks(text.slice(lastIndex), `${keyBase}-tail`));
  }

  return out;
}

/**
 * Split plain-text chunks on single newlines and intersperse <br/>. Paragraph
 * breaks are already handled by splitParagraphs; this preserves mid-paragraph
 * hard breaks (e.g. the "Label Code: LC XXXX" line often sits on its own in
 * the middle of a label profile).
 */
function renderWithLineBreaks(text: string, keyBase: string): ReactNode {
  if (!text.includes("\n")) return text;
  const pieces = text.split("\n");
  return pieces.flatMap((p, i) => (i === 0 ? [p] : [<br key={`${keyBase}-br${i}`} />, p]));
}
