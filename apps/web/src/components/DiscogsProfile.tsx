import Link from "next/link";
import { type ReactNode } from "react";

/**
 * Parses Discogs profile markup into React elements.
 *
 * Discogs uses [aXXXXXX] for artist refs, [lXXXXXX] for label refs,
 * [mXXXXXX] for master refs, [rXXXXXX] for release refs, and
 * [url=...]text[/url] for links.
 */
export function DiscogsProfile({
  text,
  className,
  names,
  style,
}: {
  text: string;
  className?: string;
  /** Optional map of discogs IDs to display names for inline refs */
  names?: Record<string, string>;
  style?: React.CSSProperties;
}) {
  return <p className={className} style={style}>{parseDiscogsMarkup(text, names)}</p>;
}

/** Extract all entity IDs referenced in profile text */
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

function parseDiscogsMarkup(
  text: string,
  names?: Record<string, string>
): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /\[a(\d+)\]|\[l(\d+)\]|\[m(\d+)\]|\[r(\d+)\]|\[url=([^\]]+)\](.*?)\[\/url\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const name = names?.[`a${match[1]}`];
      if (name) {
        parts.push(
          <Link key={match.index} href={`/artist/${match[1]}`}>{name}</Link>
        );
      } else {
        // Artist not in our catalog — link to Discogs
        parts.push(
          <a key={match.index} href={`https://www.discogs.com/artist/${match[1]}`} target="_blank" rel="noreferrer">
            {`artist`}
          </a>
        );
      }
    } else if (match[2]) {
      const name = names?.[`l${match[2]}`];
      if (name) {
        parts.push(
          <Link key={match.index} href={`/label/${match[2]}`}>{name}</Link>
        );
      } else {
        parts.push(
          <a key={match.index} href={`https://www.discogs.com/label/${match[2]}`} target="_blank" rel="noreferrer">
            {`label`}
          </a>
        );
      }
    } else if (match[3]) {
      const name = names?.[`m${match[3]}`];
      if (name) {
        parts.push(
          <Link key={match.index} href={`/release/${match[3]}`}>{name}</Link>
        );
      } else {
        parts.push(
          <a key={match.index} href={`https://www.discogs.com/master/${match[3]}`} target="_blank" rel="noreferrer">
            {`release`}
          </a>
        );
      }
    } else if (match[4]) {
      const name = names?.[`r${match[4]}`];
      if (name) {
        parts.push(
          <Link key={match.index} href={`/version/${match[4]}`}>{name}</Link>
        );
      } else {
        parts.push(
          <a key={match.index} href={`https://www.discogs.com/release/${match[4]}`} target="_blank" rel="noreferrer">
            {`release`}
          </a>
        );
      }
    } else if (match[5] && match[6]) {
      parts.push(
        <a key={match.index} href={match[5]} target="_blank" rel="noreferrer">
          {match[6]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
