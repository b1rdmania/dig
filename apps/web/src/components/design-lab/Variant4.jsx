"use client";

import React, { useState, useEffect } from 'react';

const customStyles = {
  body: {
    backgroundColor: '#2A2A2A',
    backgroundImage: `
      repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px),
      radial-gradient(circle at 50% 50%, #3a3a3a 0%, #111 100%)
    `,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    padding: '32px',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    WebkitFontSmoothing: 'antialiased',
    textTransform: 'uppercase',
    margin: 0,
    boxSizing: 'border-box',
  },
  appContainer: {
    width: '100%',
    maxWidth: '1000px',
    backgroundColor: '#F3F2EE',
    borderRadius: '6px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    border: '1.5px solid #1A1A1A',
    height: '85vh',
  },
  searchHeader: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#F3F2EE',
    borderBottom: '1.5px solid #1A1A1A',
  },
  searchMeta: {
    textAlign: 'center',
    padding: '16px',
    fontSize: '1.2rem',
    fontWeight: 700,
    borderBottom: '1.5px solid #1A1A1A',
  },
  searchInputWrapper: {
    display: 'flex',
    width: '100%',
  },
  searchInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '16px 24px',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: '3rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    color: '#1A1A1A',
    outline: 'none',
    textAlign: 'center',
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  navSidebar: {
    width: '250px',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#F3F2EE',
    overflowY: 'auto',
    borderRight: '1.5px solid #1A1A1A',
  },
  navItem: {
    padding: '16px 24px',
    fontSize: '1.1rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background-color 0.1s, color 0.1s',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1.5px solid #1A1A1A',
  },
  navItemActive: {
    backgroundColor: '#1A1A1A',
    color: '#F3F2EE',
  },
  navCount: {
    fontSize: '0.8rem',
    opacity: 0.7,
  },
  resultsArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    backgroundColor: '#F3F2EE',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
    borderBottom: '1.5px solid #1A1A1A',
  },
  albumArt: {
    width: '48px',
    height: '48px',
    border: '1px solid #1A1A1A',
    marginRight: '16px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    textAlign: 'center',
    padding: '2px',
    backgroundColor: '#F3F2EE',
    color: '#1A1A1A',
    transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    flexShrink: 0,
  },
  albumArtInverted: {
    backgroundColor: '#1A1A1A',
    color: '#F3F2EE',
  },
  resultInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  trackTitle: {
    fontSize: '1.4rem',
    fontWeight: 800,
    lineHeight: 1,
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  trackArtist: {
    fontSize: '0.9rem',
    fontWeight: 600,
    opacity: 0.8,
  },
  trackMeta: {
    fontSize: '0.9rem',
    fontWeight: 600,
    textAlign: 'right',
    paddingLeft: '16px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #1A1A1A',
    borderRadius: '50%',
    padding: '2px 8px',
    fontFamily: '"Times New Roman", Times, serif',
    fontStyle: 'italic',
    fontSize: '0.6em',
    fontWeight: 'normal',
    letterSpacing: 0,
    textTransform: 'none',
    marginTop: '-4px',
  },
  badgeHover: {
    borderColor: '#F3F2EE',
    color: '#F3F2EE',
  },
  playerBar: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    backgroundColor: '#F3F2EE',
    minHeight: '80px',
    borderTop: '1.5px solid #1A1A1A',
  },
  playerSection: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '16px',
  },
  playerLabel: {
    fontSize: '1.2rem',
    fontWeight: 800,
    textAlign: 'center',
    marginBottom: '4px',
  },
  playerValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    textAlign: 'center',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    gap: '32px',
    fontSize: '1.5rem',
    fontWeight: 800,
  },
  controlBtn: {
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
};

const tracks = [
  { id: 1, title: 'SLAPFUNK BENDER', artist: 'BENNY RODRIGUES', duration: '06:42', badge: 'Live', inverted: false },
  { id: 2, title: 'DUNGEON MEAT', artist: 'SAMUEL DEEP', duration: '05:15', badge: 'Explicit', inverted: false },
  { id: 3, title: 'HUERTA GROOVE', artist: 'HUERTA / YOUANDEWAN', duration: '08:00', badge: 'B2B', inverted: true },
  { id: 4, title: 'ANIL ARAS DUB', artist: 'ANIL ARAS', duration: '04:30', badge: null, inverted: false },
  { id: 5, title: 'DOUDOU MD RHYTHM', artist: 'DOUDOU MD', duration: '07:22', badge: null, inverted: false },
  { id: 6, title: 'SENC ROTATION', artist: 'DJ SENC', duration: '05:55', badge: null, inverted: false },
];

const navItems = [
  { label: 'Top Results', count: null },
  { label: 'Tracks', count: 42 },
  { label: 'Artists', count: 8 },
  { label: 'Albums', count: 14 },
  { label: 'Playlists', count: 3 },
];

const ResultRow = ({ track, isPlaying, onClick }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...customStyles.resultRow,
        ...(hovered ? { backgroundColor: '#1A1A1A', color: '#F3F2EE' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick(track)}
    >
      <div
        style={{
          ...customStyles.albumArt,
          ...(track.inverted ? customStyles.albumArtInverted : {}),
          ...(hovered ? { borderColor: '#F3F2EE', transform: 'rotate(-2deg)', backgroundColor: track.inverted ? '#F3F2EE' : '#1A1A1A', color: track.inverted ? '#1A1A1A' : '#F3F2EE' } : {}),
        }}
      >
        {track.inverted ? <>LOG<br />O</> : <>ART<br />WORK</>}
      </div>
      <div style={customStyles.resultInfo}>
        <div style={customStyles.trackTitle}>
          {track.title}
          {track.badge && (
            <span style={{ ...customStyles.badge, ...(hovered ? customStyles.badgeHover : {}) }}>
              {track.badge}
            </span>
          )}
        </div>
        <div style={customStyles.trackArtist}>{track.artist}</div>
      </div>
      <div style={customStyles.trackMeta}>{track.duration}</div>
    </div>
  );
};

const App = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState(1);
  const [nowPlaying, setNowPlaying] = useState(tracks[2]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [hoveredControl, setHoveredControl] = useState(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      body { margin: 0; padding: 0; }
      input::placeholder { color: rgba(26, 26, 26, 0.3); }
      ::-webkit-scrollbar { width: 10px; }
      ::-webkit-scrollbar-track { background: #F3F2EE; border-left: 1.5px solid #1A1A1A; }
      ::-webkit-scrollbar-thumb { background: #1A1A1A; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const handleTrackClick = (track) => {
    setNowPlaying(track);
    setIsPlaying(true);
  };

  const handlePrev = () => {
    const currentIndex = tracks.findIndex(t => t.id === nowPlaying.id);
    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    setNowPlaying(tracks[prevIndex]);
    setIsPlaying(true);
  };

  const handleNext = () => {
    const currentIndex = tracks.findIndex(t => t.id === nowPlaying.id);
    const nextIndex = (currentIndex + 1) % tracks.length;
    setNowPlaying(tracks[nextIndex]);
    setIsPlaying(true);
  };

  const handlePlayPause = () => {
    setIsPlaying(prev => !prev);
  };

  const filteredTracks = tracks.filter(track =>
    searchQuery === '' ||
    track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.artist.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={customStyles.body}>
      <div style={customStyles.appContainer}>
        {/* Header */}
        <header style={customStyles.searchHeader}>
          <div style={customStyles.searchMeta}>
            SYSTEM QUERY ENGINE <span style={{ margin: '0 10px' }}>//</span> BUILD 2024
          </div>
          <div style={customStyles.searchInputWrapper}>
            <input
              type="text"
              style={customStyles.searchInput}
              placeholder="ENTER ARTIST OR TRACK"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        {/* Main Content */}
        <main style={customStyles.mainContent}>
          {/* Sidebar Nav */}
          <nav style={customStyles.navSidebar}>
            {navItems.map((item, index) => (
              <div
                key={index}
                style={{
                  ...customStyles.navItem,
                  ...(activeNav === index ? customStyles.navItemActive : {}),
                }}
                onClick={() => setActiveNav(index)}
                onMouseEnter={(e) => {
                  if (activeNav !== index) {
                    e.currentTarget.style.backgroundColor = '#1A1A1A';
                    e.currentTarget.style.color = '#F3F2EE';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeNav !== index) {
                    e.currentTarget.style.backgroundColor = '';
                    e.currentTarget.style.color = '';
                  }
                }}
              >
                <span>{item.label}</span>
                {item.count !== null && (
                  <span style={customStyles.navCount}>{item.count}</span>
                )}
              </div>
            ))}
            <div style={{ flex: 1 }} />
          </nav>

          {/* Results Area */}
          <section style={customStyles.resultsArea}>
            {filteredTracks.map((track) => (
              <ResultRow
                key={track.id}
                track={track}
                isPlaying={isPlaying && nowPlaying.id === track.id}
                onClick={handleTrackClick}
              />
            ))}
            {filteredTracks.length === 0 && (
              <div style={{ padding: '32px', textAlign: 'center', fontWeight: 800, opacity: 0.4 }}>
                NO RESULTS FOUND
              </div>
            )}
          </section>
        </main>

        {/* Player Bar */}
        <footer style={customStyles.playerBar}>
          <div style={{ ...customStyles.playerSection, borderRight: '1.5px solid #1A1A1A' }}>
            <div style={customStyles.playerLabel}>NOW PLAYING</div>
            <div style={customStyles.playerValue}>{nowPlaying ? nowPlaying.title : '—'}</div>
          </div>
          <div style={customStyles.playerSection}>
            <div style={customStyles.playerLabel}>TRANSPORT</div>
            <div style={customStyles.controls}>
              <span
                style={{ ...customStyles.controlBtn, ...(hoveredControl === 'prev' ? { opacity: 0.5 } : {}) }}
                onMouseEnter={() => setHoveredControl('prev')}
                onMouseLeave={() => setHoveredControl(null)}
                onClick={handlePrev}
              >
                PREV
              </span>
              <span
                style={{ ...customStyles.controlBtn, ...(hoveredControl === 'play' ? { opacity: 0.5 } : {}) }}
                onMouseEnter={() => setHoveredControl('play')}
                onMouseLeave={() => setHoveredControl(null)}
                onClick={handlePlayPause}
              >
                {isPlaying ? '|| PAUSE' : '▶ PLAY'}
              </span>
              <span
                style={{ ...customStyles.controlBtn, ...(hoveredControl === 'next' ? { opacity: 0.5 } : {}) }}
                onMouseEnter={() => setHoveredControl('next')}
                onMouseLeave={() => setHoveredControl(null)}
                onClick={handleNext}
              >
                NEXT
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
