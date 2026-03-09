"use client";

import React, { useState, useEffect, useRef } from 'react';

export const customStyles = {
  root: {
    '--bg': '#F4F4F4',
    '--text-main': '#111111',
    '--text-sec': '#666666',
    '--line': '#D0D0D0',
    '--accent': '#000000',
    '--white': '#FFFFFF',
  },
  body: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    backgroundColor: '#F4F4F4',
    color: '#111111',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    overflowX: 'hidden',
  },
  microLabel: {
    fontSize: '10px',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#111111',
  },
  hLarge: {
    fontSize: '4.5rem',
    fontWeight: '300',
    letterSpacing: '-0.03em',
    lineHeight: '1.1',
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#111111',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    backgroundColor: 'transparent',
  },
  header: {
    height: '64px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 48px',
    borderBottom: '1px solid #D0D0D0',
  },
  heroSection: {
    padding: '64px 48px',
    borderBottom: '1px solid #D0D0D0',
    display: 'flex',
    flexDirection: 'column',
    gap: '48px',
  },
  resultsSection: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    borderBottom: '1px solid #D0D0D0',
  },
  column: {
    padding: '32px 48px',
    borderRight: '1px solid #D0D0D0',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  columnLast: {
    padding: '32px 48px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  btnBlackPill: {
    backgroundColor: '#000000',
    color: '#FFFFFF',
    borderRadius: '999px',
    padding: '8px 12px 8px 16px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    border: 'none',
    cursor: 'pointer',
  },
  dot: {
    width: '4px',
    height: '4px',
    backgroundColor: '#FFFFFF',
    borderRadius: '50%',
  },
  btnWhitePill: {
    backgroundColor: 'transparent',
    color: '#111111',
    border: '1px solid #D0D0D0',
    borderRadius: '999px',
    padding: '6px 6px 6px 20px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '16px',
    fontSize: '14px',
    fontWeight: '400',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  iconCircle: {
    width: '32px',
    height: '32px',
    backgroundColor: '#000000',
    borderRadius: '50%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#FFFFFF',
  },
  artBox: {
    width: '100%',
    aspectRatio: '1',
    border: '1px solid #D0D0D0',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    transition: 'border-color 0.2s',
  },
  artBoxRound: {
    width: '100%',
    aspectRatio: '1',
    border: '1px solid #D0D0D0',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    transition: 'border-color 0.2s',
    borderRadius: '50%',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 0',
    borderBottom: '1px solid transparent',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  listItemHover: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 0',
    borderBottom: '1px solid #D0D0D0',
    cursor: 'pointer',
  },
  player: {
    height: '72px',
    padding: '0 48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F4F4F4',
  },
  playerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    width: '25%',
  },
  playerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    width: '50%',
    justifyContent: 'center',
  },
  timeline: {
    flex: 1,
    height: '1px',
    backgroundColor: '#D0D0D0',
    position: 'relative',
    maxWidth: '400px',
  },
  timelineProgress: {
    position: 'absolute',
    top: '-1px',
    left: '0',
    height: '3px',
    backgroundColor: '#000000',
    width: '35%',
  },
  playerActions: {
    width: '25%',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '16px',
    alignItems: 'center',
  },
  ctrlBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnPlay: {
    background: 'none',
    border: '1px solid #111111',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
  },
  geoIcon: {
    stroke: '#111111',
    strokeWidth: '1',
    fill: 'none',
    vectorEffect: 'non-scaling-stroke',
  },
};

export const GeoIcon = ({ style, ...props }) => (
  <svg style={{ stroke: '#111111', strokeWidth: 1, fill: 'none', vectorEffect: 'non-scaling-stroke', ...style }} {...props} />
);

export const ListItem = ({ index, title, artist, isPlaying, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={hovered ? customStyles.listItemHover : customStyles.listItem}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <span style={{ fontSize: '10px', width: '24px', color: '#666666' }}>{index}</span>
      <div>
        <div style={{ fontSize: '0.95rem', fontWeight: '400', marginBottom: '4px', color: isPlaying ? '#000' : '#111111' }}>{title}</div>
        <div style={{ fontSize: '0.85rem', fontWeight: '400', color: '#666666', lineHeight: '1.4' }}>{artist}</div>
      </div>
    </div>
  );
};

export const ArtworkCard = ({ index, children, title, desc, round, textCenter, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '10px', color: '#111111' }}>{index}</span>
      </div>
      <div style={round
        ? { ...customStyles.artBoxRound, borderColor: hovered ? '#111111' : '#D0D0D0' }
        : { ...customStyles.artBox, borderColor: hovered ? '#111111' : '#D0D0D0' }
      }>
        {children}
      </div>
      <div style={textCenter ? { textAlign: 'center' } : {}}>
        <div style={{ fontSize: '1.1rem', fontWeight: '400', marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '0.85rem', fontWeight: '400', color: '#666666', lineHeight: '1.4' }}>{desc}</div>
      </div>
    </div>
  );
};

const App = () => {
  const [searchValue, setSearchValue] = useState('Ambient electronica');
  const [activeFilter, setActiveFilter] = useState('all');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState({ title: 'Rhubarb', artist: 'Aphex Twin' });
  const [whitePillHover1, setWhitePillHover1] = useState(false);
  const [whitePillHover2, setWhitePillHover2] = useState(false);
  const [currentTime, setCurrentTime] = useState('01:24');
  const [progress, setProgress] = useState(35);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { margin: 0; padding: 0; }
      .search-input-main::placeholder { color: #C0C0C0; }
      .search-input-main { caret-color: #111111; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const tracks = [
    { index: '01', title: 'Rhubarb', artist: 'Aphex Twin' },
    { index: '02', title: 'Xtal', artist: 'Aphex Twin' },
    { index: '03', title: 'Pulsewidth', artist: 'Aphex Twin' },
    { index: '04', title: 'Tha', artist: 'Aphex Twin' },
  ];

  const handleTrackClick = (track) => {
    setCurrentTrack({ title: track.title, artist: track.artist });
    setIsPlaying(true);
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  return (
    <div style={customStyles.body}>
      {/* Header */}
      <header style={customStyles.header}>
        <div style={{ ...customStyles.microLabel, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          U/MUSIC
        </div>
        <div style={{ ...customStyles.microLabel, display: 'flex', justifyContent: 'space-between', width: '120px' }}>
          <span>SYS</span>
          <span>21:25</span>
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Hero / Search */}
        <section style={customStyles.heroSection}>
          <div style={customStyles.microLabel}>/ SEARCH</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="search-input-main"
              style={customStyles.hLarge}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search..."
            />
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <button
              style={{
                ...customStyles.btnBlackPill,
                backgroundColor: activeFilter === 'all' ? '#000000' : '#333333',
              }}
              onClick={() => setActiveFilter('all')}
            >
              All Results
              <div style={customStyles.dot} />
            </button>
            <button
              style={{
                ...customStyles.btnWhitePill,
                borderColor: whitePillHover1 ? '#111111' : activeFilter === 'artists' ? '#111111' : '#D0D0D0',
              }}
              onMouseEnter={() => setWhitePillHover1(true)}
              onMouseLeave={() => setWhitePillHover1(false)}
              onClick={() => setActiveFilter('artists')}
            >
              Artists
              <div style={customStyles.iconCircle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </button>
            <button
              style={{
                ...customStyles.btnWhitePill,
                borderColor: whitePillHover2 ? '#111111' : activeFilter === 'albums' ? '#111111' : '#D0D0D0',
              }}
              onMouseEnter={() => setWhitePillHover2(true)}
              onMouseLeave={() => setWhitePillHover2(false)}
              onClick={() => setActiveFilter('albums')}
            >
              Albums
              <div style={customStyles.iconCircle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        </section>

        {/* Results */}
        <section style={customStyles.resultsSection}>
          {/* Tracks Column */}
          <div style={customStyles.column}>
            <div style={customStyles.microLabel}>/ TRACKS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
              {tracks.map((track) => (
                <ListItem
                  key={track.index}
                  index={track.index}
                  title={track.title}
                  artist={track.artist}
                  isPlaying={currentTrack.title === track.title && isPlaying}
                  onClick={() => handleTrackClick(track)}
                />
              ))}
            </div>
          </div>

          {/* Albums Column */}
          <div style={customStyles.column}>
            <div style={customStyles.microLabel}>/ ALBUMS</div>
            <div style={{ marginTop: '16px' }}>
              <ArtworkCard
                index="001"
                title="Selected Ambient Works 85-92"
                desc="Aphex Twin • 1992"
                onClick={() => {}}
              >
                <svg viewBox="0 0 100 100" style={{ width: '60%', height: '60%' }}>
                  <circle style={customStyles.geoIcon} cx="50" cy="50" r="30" />
                  <circle style={customStyles.geoIcon} cx="50" cy="50" r="10" />
                  <line style={customStyles.geoIcon} x1="50" y1="20" x2="50" y2="80" />
                </svg>
              </ArtworkCard>
            </div>
          </div>

          {/* Artists Column */}
          <div style={customStyles.column}>
            <div style={customStyles.microLabel}>/ ARTISTS</div>
            <div style={{ marginTop: '16px' }}>
              <ArtworkCard
                index="002"
                title="Aphex Twin"
                desc="Artist"
                round
                textCenter
                onClick={() => {}}
              >
                <svg viewBox="0 0 100 100" style={{ width: '60%', height: '60%' }}>
                  <polygon style={customStyles.geoIcon} points="50,20 80,70 20,70" />
                </svg>
              </ArtworkCard>
            </div>
            <div style={{ marginTop: '32px' }}>
              <ArtworkCard
                index="003"
                title="Boards of Canada"
                desc="Artist"
                round
                textCenter
                onClick={() => {}}
              >
                <svg viewBox="0 0 100 100" style={{ width: '60%', height: '60%' }}>
                  <rect style={customStyles.geoIcon} x="25" y="25" width="50" height="50" />
                </svg>
              </ArtworkCard>
            </div>
          </div>

          {/* Playlists Column */}
          <div style={customStyles.columnLast}>
            <div style={customStyles.microLabel}>/ PLAYLISTS</div>
            <div style={{ marginTop: '16px' }}>
              <ArtworkCard
                index="004"
                title="IDM Essentials"
                desc="Curated by System • 42 Tracks"
                onClick={() => {}}
              >
                <svg viewBox="0 0 100 100" style={{ width: '60%', height: '60%' }}>
                  <path style={customStyles.geoIcon} d="M20,50 Q50,20 80,50 T20,50" />
                  <path style={customStyles.geoIcon} d="M20,60 Q50,90 80,60 T20,60" />
                </svg>
              </ArtworkCard>
            </div>
          </div>
        </section>
      </main>

      {/* Player Footer */}
      <footer style={customStyles.player}>
        <div style={customStyles.playerInfo}>
          <div style={{ width: '40px', height: '40px', border: '1px solid #D0D0D0', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 100 100">
              <circle style={customStyles.geoIcon} cx="50" cy="50" r="30" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: '400', marginBottom: '2px' }}>{currentTrack.title}</div>
            <div style={{ fontSize: '0.75rem', fontWeight: '400', color: '#666666' }}>{currentTrack.artist}</div>
          </div>
        </div>

        <div style={customStyles.playerControls}>
          <button style={customStyles.ctrlBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 20L9 12l10-8v16zM5 19V5" />
            </svg>
          </button>
          <button style={customStyles.ctrlBtnPlay} onClick={handlePlayPause}>
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
          <button style={customStyles.ctrlBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 4l10 8-10 8V4zM19 5v14" />
            </svg>
          </button>
          <div style={{ ...customStyles.microLabel, marginLeft: '16px' }}>{currentTime}</div>
          <div style={customStyles.timeline}>
            <div style={{ ...customStyles.timelineProgress, width: `${progress}%` }} />
          </div>
          <div style={{ ...customStyles.microLabel, color: '#666666' }}>07:44</div>
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
};

export default App;
