import styles from "./LabelWordmark.module.css";

interface Props {
  discogsId: number;
  /** Label display name. Used for the fallback typeset plate + a11y. */
  name: string;
  /** Tier-1 palette. Drives the fallback plate background/foreground. */
  palette?: { accent: string; accent_ink: string } | null;
  size?: "sm" | "md" | "lg";
}

/**
 * Hand-set SVG wordmarks for the most iconic tier-1 labels in our
 * editorial set, plus a typeset "plate" fallback for every other label
 * with an editorial palette. Plain text otherwise.
 *
 * Curated SVGs are intentionally typographic (not redrawn brand logos)
 * so we own the rendering and avoid licensing exposure. The visual
 * intent is: each label feels distinct and "designed" the moment you
 * land on its page.
 *
 * Adding a new curated wordmark:
 *   1. Add a renderer to CURATED_WORDMARKS keyed by Discogs label id.
 *   2. Inline the SVG, use `currentColor` for ink so the palette can
 *      override it via the wrapping CSS variable.
 *   3. Keep the SVG height consistent with `viewBox` height — the CSS
 *      .svg rule scales by height, width auto.
 */
export function LabelWordmark({ discogsId, name, palette, size = "md" }: Props) {
  const renderer = CURATED_WORDMARKS[discogsId];
  const wrapStyle = palette
    ? ({
        ["--label-accent" as string]: palette.accent,
        ["--label-accent-ink" as string]: palette.accent_ink,
      } as React.CSSProperties)
    : undefined;

  return (
    <span
      className={`${styles.wrap} ${styles[`size-${size}`]}`}
      style={wrapStyle}
      role="img"
      aria-label={name}
    >
      {renderer ? renderer({ palette }) : <PlateWordmark name={name} />}
    </span>
  );
}

/* ---------- Typeset plate fallback ---------- */

function PlateWordmark({ name }: { name: string }) {
  // Render `&` in a condensed italic, like a label catalog header would.
  const parts = name.split(/(\s*&\s*)/g);
  return (
    <span className={styles.plate}>
      {parts.map((part, i) =>
        /^\s*&\s*$/.test(part) ? (
          <span className={styles.plateAmpersand} key={i}>
            &
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/* ---------- Curated wordmarks ----------
 *
 * These are typographic compositions, not facsimiles of the labels'
 * actual brand marks. They use the label's editorial palette so they
 * look in-family with the rest of the page.
 */

type Renderer = (args: { palette?: { accent: string; accent_ink: string } | null }) => React.ReactElement;

const CURATED_WORDMARKS: Record<number, Renderer> = {
  // R & S Records (245) — yellow plate, ampersand in serif italic, the way
  // Renaat used to print sleeves in the late '80s/early '90s.
  245: () => (
    <svg className={styles.svg} viewBox="0 0 280 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="280" height="70" fill="var(--label-accent, #f5d000)" />
      <g fill="var(--label-accent-ink, #1a1a1a)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={800} fontSize={48} textAnchor="middle">
        <text x="40" y="52">R</text>
        <text x="140" y="54" fontFamily='"Iowan Old Style", Georgia, serif' fontWeight={500} fontStyle="italic" fontSize={48}>&amp;</text>
        <text x="240" y="52">S</text>
      </g>
      <line x1="14" y1="60" x2="266" y2="60" stroke="var(--label-accent-ink, #1a1a1a)" strokeWidth="1.5" />
      <text x="140" y="68" textAnchor="middle" fill="var(--label-accent-ink, #1a1a1a)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={6} letterSpacing="0.4em">RECORDS · GHENT</text>
    </svg>
  ),

  // Warp Records (23528) — bold W with the letterforms cropped, the
  // "purple W" feel you got off the early Artificial Intelligence sleeves.
  23528: () => (
    <svg className={styles.svg} viewBox="0 0 240 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="240" height="70" fill="var(--label-accent, #3a3a3a)" />
      <text x="20" y="56" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={56} letterSpacing="-0.05em">
        WARP
      </text>
      <text x="190" y="62" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.18em" textAnchor="end">
        WAP000—
      </text>
    </svg>
  ),

  // Tresor Records (271891) — Berlin steel, all caps stacked square.
  271891: () => (
    <svg className={styles.svg} viewBox="0 0 280 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="280" height="70" fill="var(--label-accent, #7a8a99)" />
      <rect x="2" y="2" width="276" height="66" fill="none" stroke="var(--label-accent-ink, #1a1a1a)" strokeWidth="1" />
      <text x="140" y="48" textAnchor="middle" fill="var(--label-accent-ink, #1a1a1a)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={800} fontSize={42} letterSpacing="0.12em">
        TRESOR
      </text>
      <text x="140" y="62" textAnchor="middle" fill="var(--label-accent-ink, #1a1a1a)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={8} letterSpacing="0.32em">
        BERLIN · 1991
      </text>
    </svg>
  ),

  // Basic Channel (255) — brutalist mono block, no name, just a marker.
  255: () => (
    <svg className={styles.svg} viewBox="0 0 320 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="320" height="70" fill="var(--label-accent, #3a3a3a)" />
      <rect x="14" y="14" width="42" height="42" fill="var(--label-accent-ink, #f4f1e8)" />
      <text x="78" y="44" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontWeight={700} fontSize={22} letterSpacing="0.18em">
        BASIC CHANNEL
      </text>
      <text x="78" y="58" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.32em">
        BCD ___
      </text>
    </svg>
  ),

  // Underground Resistance (258) — slogan-driven, militant typography.
  258: () => (
    <svg className={styles.svg} viewBox="0 0 360 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="360" height="70" fill="var(--label-accent, #0a0a0a)" />
      <text x="14" y="34" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={26} letterSpacing="-0.02em">
        UNDERGROUND
      </text>
      <text x="14" y="60" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={26} letterSpacing="-0.02em">
        RESISTANCE
      </text>
      <line x1="246" y1="14" x2="246" y2="56" stroke="var(--label-accent-ink, #f4f1e8)" strokeWidth="2" />
      <text x="258" y="34" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.22em">
        UR · DETROIT
      </text>
      <text x="258" y="50" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.22em">
        REVOLUTION
      </text>
    </svg>
  ),

  // Trax Records (267) — Chicago house, sleeve-band style.
  267: () => (
    <svg className={styles.svg} viewBox="0 0 280 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="280" height="70" fill="var(--label-accent, #1a1a1a)" />
      <text x="20" y="56" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={56} fontStyle="italic" letterSpacing="-0.03em">
        TRAX
      </text>
      <text x="240" y="58" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.22em" textAnchor="end">
        CHICAGO
      </text>
    </svg>
  ),

  // Dance Mania (314) — black ground, yellow rave-flyer ink.
  314: () => (
    <svg className={styles.svg} viewBox="0 0 320 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="320" height="70" fill="var(--label-accent, #0a0a0a)" />
      <text x="20" y="46" fill="var(--label-accent-ink, #ffe600)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={36} letterSpacing="-0.02em">
        DANCE
      </text>
      <text x="180" y="46" fill="var(--label-accent-ink, #ffe600)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={36} fontStyle="italic" letterSpacing="-0.02em">
        MANIA
      </text>
      <text x="20" y="62" fill="var(--label-accent-ink, #ffe600)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={9} letterSpacing="0.32em">
        GHETTO HOUSE — CHICAGO
      </text>
    </svg>
  ),

  // Axis Records (10211) — Detroit techno orange, X-mark.
  10211: () => (
    <svg className={styles.svg} viewBox="0 0 240 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="240" height="70" fill="var(--label-accent, #c8431f)" />
      <text x="20" y="56" fill="var(--label-accent-ink, #1a1a1a)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={48} letterSpacing="-0.02em">
        AXIS
      </text>
      <line x1="160" y1="14" x2="220" y2="56" stroke="var(--label-accent-ink, #1a1a1a)" strokeWidth="6" />
      <line x1="220" y1="14" x2="160" y2="56" stroke="var(--label-accent-ink, #1a1a1a)" strokeWidth="6" />
    </svg>
  ),

  // Ninja Tune (109) — black plate, off-kilter spacing.
  109: () => (
    <svg className={styles.svg} viewBox="0 0 320 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="320" height="70" fill="var(--label-accent, #0a0a0a)" />
      <text x="20" y="50" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={800} fontSize={36} letterSpacing="0.02em">
        NINJA
      </text>
      <text x="160" y="50" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={300} fontSize={36} letterSpacing="0.05em">
        TUNE
      </text>
      <text x="160" y="62" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={8} letterSpacing="0.32em">
        ZEN — LONDON
      </text>
    </svg>
  ),

  // Mute Records (36339) — red plate, tiny stamp.
  36339: () => (
    <svg className={styles.svg} viewBox="0 0 240 70" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="240" height="70" fill="var(--label-accent, #d62828)" />
      <text x="20" y="54" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"IBM Plex Sans", system-ui, sans-serif' fontWeight={900} fontSize={48} letterSpacing="-0.03em">
        MUTE
      </text>
      <text x="220" y="58" textAnchor="end" fill="var(--label-accent-ink, #f4f1e8)" fontFamily='"JetBrains Mono", ui-monospace, monospace' fontSize={8} letterSpacing="0.28em">
        STUMM —
      </text>
    </svg>
  ),
};

/** Public helper — `true` if a label has a curated wordmark. Used by
 * pages that want to skip the plain h1 in favour of the SVG mark. */
export function hasCuratedWordmark(discogsId: number): boolean {
  return discogsId in CURATED_WORDMARKS;
}
