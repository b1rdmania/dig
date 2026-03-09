"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { customStyles, ListItem, ArtworkCard, GeoIcon } from "./Variant3";

function Pill({ label, active, href }) {
  const style = {
    ...customStyles.btnWhitePill,
    borderColor: active ? "#111111" : "#D0D0D0",
  };

  const content = (
    <>
      {label}
      <div style={customStyles.iconCircle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        <span style={style}>{content}</span>
      </Link>
    );
  }

  return (
    <span style={{ ...style, pointerEvents: "none" }}>{content}</span>
  );
}

function LinkedItem({ item, isPlaying, onClick }) {
  return (
    <div>
      {item.href ? (
        <Link href={item.href} style={{ textDecoration: "none", color: "inherit" }}>
          <ListItem
            index={item.index}
            title={item.title}
            artist={item.subtitle}
            isPlaying={isPlaying}
            onClick={onClick}
          />
        </Link>
      ) : (
        <ListItem
          index={item.index}
          title={item.title}
          artist={item.subtitle}
          isPlaying={isPlaying}
          onClick={onClick}
        />
      )}
    </div>
  );
}

function CardGlyph({ type }) {
  if (type === "artist") {
    return (
      <svg viewBox="0 0 100 100" style={{ width: "60%", height: "60%" }}>
        <polygon style={customStyles.geoIcon} points="50,20 80,70 20,70" />
      </svg>
    );
  }
  if (type === "label") {
    return (
      <svg viewBox="0 0 100 100" style={{ width: "60%", height: "60%" }}>
        <rect style={customStyles.geoIcon} x="25" y="25" width="50" height="50" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" style={{ width: "60%", height: "60%" }}>
      <circle style={customStyles.geoIcon} cx="50" cy="50" r="30" />
      <circle style={customStyles.geoIcon} cx="50" cy="50" r="10" />
      <line style={customStyles.geoIcon} x1="50" y1="20" x2="50" y2="80" />
    </svg>
  );
}

function CardItem({ item }) {
  const card = (
    <ArtworkCard
      index={item.index}
      title={item.title}
      desc={item.subtitle}
      round={item.type === "artist"}
      textCenter={item.type === "artist"}
      onClick={() => {}}
    >
      {item.thumb ? (
        <img src={item.thumb} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <CardGlyph type={item.type} />
      )}
    </ArtworkCard>
  );

  if (!item.href) return card;
  return <Link href={item.href} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link>;
}

/**
 * @param {{
 *  sectionLabel?: string;
 *  title?: string;
 *  queryValue?: string;
 *  pills?: Array<{label: string; active?: boolean; href?: string}>;
 *  columns?: Array<{title: string; items: Array<{index: string; title: string; subtitle: string; href?: string; type?: string; thumb?: string}>}>;
 *  nowPlaying?: {title: string; artist: string} | null;
 *  searchTarget?: string;
 *  palette?: "v3" | "v3v5";
 * }} props
 */
export default function Variant3LiveShell(props) {
  const {
    sectionLabel,
    title,
    queryValue,
    pills,
    columns,
    nowPlaying = null,
    searchTarget = "/design-lab/live/search",
    palette = "v3v5",
  } = props;
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(
    nowPlaying || { title: "No track selected", artist: "Dig" },
  );
  const [progress] = useState(35);

  const [query, setQuery] = useState(queryValue || "");

  const tracksCol = columns[0] || { title: "TRACKS", items: [] };
  const albumsCol = columns[1] || { title: "RELEASES", items: [] };
  const artistsCol = columns[2] || { title: "ARTISTS", items: [] };
  const extraCol = columns[3] || { title: "MORE", items: [] };

  const hasTracks = tracksCol.items.length > 0;
  const themed = palette === "v3v5";

  const paletteStyles = themed
    ? {
        body: {
          ...customStyles.body,
          backgroundColor: "#050505",
          color: "#050505",
          padding: "4px",
          gap: "4px",
        },
        header: {
          ...customStyles.header,
          backgroundColor: "#f4b3af",
          borderBottom: "4px solid #050505",
        },
        hero: {
          ...customStyles.heroSection,
          backgroundColor: "#f4b3af",
          borderBottom: "4px solid #050505",
          padding: "36px 40px",
        },
        grid: {
          ...customStyles.resultsSection,
          borderBottom: "4px solid #050505",
        },
        col1: { ...customStyles.column, backgroundColor: "#b4b8b6", borderRight: "4px solid #050505" },
        col2: { ...customStyles.column, backgroundColor: "#e2aa59", borderRight: "4px solid #050505" },
        col3: { ...customStyles.column, backgroundColor: "#579ebd", borderRight: "4px solid #050505" },
        col4: { ...customStyles.columnLast, backgroundColor: "#4b8260" },
        footer: { ...customStyles.player, backgroundColor: "#eea5bc", borderTop: "4px solid #050505" },
      }
    : {
        body: customStyles.body,
        header: customStyles.header,
        hero: customStyles.heroSection,
        grid: customStyles.resultsSection,
        col1: customStyles.column,
        col2: customStyles.column,
        col3: customStyles.column,
        col4: customStyles.columnLast,
        footer: customStyles.player,
      };

  function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`${searchTarget}?q=${encodeURIComponent(q)}`);
  }

  return (
    <div style={paletteStyles.body}>
      <header style={paletteStyles.header}>
        <div style={{ ...customStyles.microLabel, display: "flex", alignItems: "center", gap: "8px" }}>
          <GeoIcon width="12" height="12" viewBox="0 0 24 24">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </GeoIcon>
          {sectionLabel || "/ LIVE"}
        </div>
        <div style={{ ...customStyles.microLabel, display: "flex", justifyContent: "space-between", width: "140px" }}>
          <span>DIG</span>
          <span>LIVE</span>
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <section style={paletteStyles.hero}>
          <div style={customStyles.microLabel}>/ SEARCH</div>
          <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="text"
              className="search-input-main"
              style={customStyles.hLarge}
              value={query || title}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={title || "Search"}
            />
            <button type="submit" style={customStyles.btnBlackPill}>
              Search
              <div style={customStyles.dot} />
            </button>
          </form>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <button style={customStyles.btnBlackPill}>
              Live Data
              <div style={customStyles.dot} />
            </button>
            {(pills || []).slice(0, 3).map((p) => (
              <Pill key={p.label} label={p.label} active={Boolean(p.active)} href={p.href} />
            ))}
          </div>
        </section>

        <section style={paletteStyles.grid}>
          <div style={paletteStyles.col1}>
            <div style={customStyles.microLabel}>/ {tracksCol.title || "TRACKS"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}>
              {hasTracks ? tracksCol.items.slice(0, 8).map((item) => (
                <LinkedItem
                  key={`${tracksCol.title}-${item.index}-${item.title}`}
                  item={item}
                  isPlaying={currentTrack.title === item.title && isPlaying}
                  onClick={() => {
                    setCurrentTrack({ title: item.title, artist: item.subtitle || "Dig" });
                    setIsPlaying(true);
                  }}
                />
              )) : (
                <div style={{ ...customStyles.microLabel, color: "#666" }}>NO DATA</div>
              )}
            </div>
          </div>

          <div style={paletteStyles.col2}>
            <div style={customStyles.microLabel}>/ {albumsCol.title || "RELEASES"}</div>
            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "32px" }}>
              {albumsCol.items.slice(0, 2).map((item) => (
                <CardItem key={`${albumsCol.title}-${item.index}-${item.title}`} item={item} />
              ))}
            </div>
          </div>

          <div style={paletteStyles.col3}>
            <div style={customStyles.microLabel}>/ {artistsCol.title || "ARTISTS"}</div>
            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "32px" }}>
              {artistsCol.items.slice(0, 2).map((item) => (
                <CardItem key={`${artistsCol.title}-${item.index}-${item.title}`} item={item} />
              ))}
            </div>
          </div>

          <div style={paletteStyles.col4}>
            <div style={customStyles.microLabel}>/ {extraCol.title || "MORE"}</div>
            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "32px" }}>
              {extraCol.items.slice(0, 2).map((item) => (
                <CardItem key={`${extraCol.title}-${item.index}-${item.title}`} item={item} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer style={paletteStyles.footer}>
        <div style={customStyles.playerInfo}>
          <div style={{ width: "40px", height: "40px", border: "1px solid #D0D0D0", display: "flex", justifyContent: "center", alignItems: "center" }}>
            <svg width="20" height="20" viewBox="0 0 100 100">
              <circle style={customStyles.geoIcon} cx="50" cy="50" r="30" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 400, marginBottom: "2px" }}>{currentTrack.title}</div>
            <div style={{ fontSize: "0.75rem", fontWeight: 400, color: "#666" }}>{currentTrack.artist}</div>
          </div>
        </div>

        <div style={customStyles.playerControls}>
          <button style={customStyles.ctrlBtn} onClick={() => setIsPlaying(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 20L9 12l10-8v16zM5 19V5" />
            </svg>
          </button>
          <button style={customStyles.ctrlBtnPlay} onClick={() => setIsPlaying((p) => !p)}>
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          <button style={customStyles.ctrlBtn} onClick={() => setIsPlaying(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 4l10 8-10 8V4zM19 5v14" />
            </svg>
          </button>
          <div style={{ ...customStyles.microLabel, marginLeft: "16px" }}>01:24</div>
          <div style={customStyles.timeline}>
            <div style={{ ...customStyles.timelineProgress, width: `${progress}%` }} />
          </div>
          <div style={{ ...customStyles.microLabel, color: "#666" }}>07:44</div>
        </div>

        <div style={customStyles.playerActions}>
          <div style={customStyles.microLabel}>/ AUDIO</div>
          <button style={customStyles.ctrlBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
