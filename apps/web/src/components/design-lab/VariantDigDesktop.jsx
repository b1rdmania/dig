"use client";

import React, { useState, useEffect } from 'react';

const customStyles = {
  root: {
    '--bg-core': '#020202',
    '--bg-surface': '#0a0b0d',
    '--fg-primary': '#f0ebe1',
    '--fg-muted': '#82807a',
    '--fg-dim': '#4a4947',
    '--border-subtle': '#1c1c1a',
    '--border-focus': '#3a3936',
    '--accent-glow': 'rgba(140, 150, 160, 0.03)',
  },
  appHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backgroundColor: '#020202',
    borderBottom: '1px solid #1c1c1a',
    padding: '1rem 2rem',
    display: 'grid',
    gridTemplateColumns: '200px 1fr 200px',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  logo: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '1.5rem',
    fontStyle: 'italic',
    letterSpacing: '-0.02em',
    color: '#f0ebe1',
    textDecoration: 'none',
  },
  globalSearch: {
    justifySelf: 'center',
    width: '100%',
    maxWidth: '400px',
    position: 'relative',
  },
  searchInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #3a3936',
    color: '#f0ebe1',
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.85rem',
    padding: '0.25rem 0',
    transition: 'border-color 0.2s ease',
    outline: 'none',
  },
  userNav: {
    justifySelf: 'end',
    display: 'flex',
    gap: '1rem',
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#82807a',
  },
  mainContent: {
    flex: 1,
    maxWidth: '1440px',
    margin: '0 auto',
    width: '100%',
    padding: '4rem 2rem',
  },
  releaseHero: {
    display: 'grid',
    gridTemplateColumns: '400px 1fr',
    gap: '4rem',
    marginBottom: '4rem',
    alignItems: 'start',
  },
  artContainer: {
    width: '100%',
    aspectRatio: '1/1',
    background: 'radial-gradient(circle at 50% 30%, #0a0b0d 0%, #020202 100%)',
    border: '1px solid #1c1c1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  artPattern: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(45deg, transparent 48%, #1c1c1a 49%, #1c1c1a 51%, transparent 52%), linear-gradient(-45deg, transparent 48%, #1c1c1a 49%, #1c1c1a 51%, transparent 52%)',
    backgroundSize: '60px 60px',
    opacity: 0.1,
  },
  artPlaceholderText: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '2rem',
    color: '#4a4947',
    fontStyle: 'italic',
    zIndex: 1,
  },
  releaseMetaCore: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  entityType: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#4a4947',
    marginBottom: '1rem',
  },
  releaseTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 400,
    lineHeight: 1.1,
    fontSize: '5rem',
    letterSpacing: '-0.02em',
    marginLeft: '-0.05em',
    marginBottom: '0.25rem',
    color: '#f0ebe1',
  },
  releaseArtist: {
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 400,
    fontSize: '2rem',
    color: '#82807a',
    fontStyle: 'italic',
    marginBottom: '1rem',
  },
  releaseFacts: {
    display: 'flex',
    gap: '1rem',
    borderTop: '1px solid #1c1c1a',
    borderBottom: '1px solid #1c1c1a',
    padding: '0.5rem 0',
    marginBottom: '2rem',
  },
  factItem: {
    display: 'flex',
    flexDirection: 'column',
  },
  factLabel: {
    fontSize: '0.6rem',
    textTransform: 'uppercase',
    color: '#4a4947',
    letterSpacing: '0.05em',
  },
  factValue: {
    fontSize: '0.85rem',
    color: '#f0ebe1',
  },
  actionRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  btn: {
    background: 'transparent',
    border: '1px solid #3a3936',
    color: '#f0ebe1',
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '0.6rem 1.2rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  btnPrimary: {
    background: '#f0ebe1',
    color: '#020202',
    border: '1px solid #f0ebe1',
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '0.6rem 1.2rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  dataLayout: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '4rem',
  },
  sectionTitle: {
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 400,
    fontSize: '1.2rem',
    borderBottom: '1px solid #1c1c1a',
    paddingBottom: '0.5rem',
    marginBottom: '1rem',
    color: '#82807a',
  },
  tracklist: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tracklistTh: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#4a4947',
    fontWeight: 400,
    padding: '0.5rem 0',
    paddingBottom: '0.25rem',
    borderBottom: '1px solid #1c1c1a',
    textAlign: 'left',
  },
  tracklistThTime: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#4a4947',
    fontWeight: 400,
    padding: '0.5rem 0',
    paddingBottom: '0.25rem',
    borderBottom: '1px solid #1c1c1a',
    textAlign: 'right',
  },
  tracklistTd: {
    padding: '0.5rem 0',
    borderBottom: '1px solid #1c1c1a',
    textAlign: 'left',
  },
  trackNum: {
    width: '40px',
    color: '#4a4947',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '0.85rem',
    padding: '0.5rem 0',
    borderBottom: '1px solid #1c1c1a',
  },
  trackTitle: {
    fontSize: '0.9rem',
    color: '#f0ebe1',
  },
  trackArtists: {
    fontSize: '0.8rem',
    color: '#82807a',
    marginTop: '2px',
  },
  trackTime: {
    textAlign: 'right',
    color: '#82807a',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '0.85rem',
    padding: '0.5rem 0',
    borderBottom: '1px solid #1c1c1a',
  },
  creditsBlock: {
    backgroundColor: '#0a0b0d',
    padding: '1rem',
    border: '1px solid #1c1c1a',
  },
  posterCredits: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.65rem',
    lineHeight: 1.6,
    textAlign: 'center',
    textTransform: 'uppercase',
    color: '#82807a',
  },
  posterCreditsSpan: {
    color: '#f0ebe1',
    letterSpacing: '0.05em',
  },
  versionsList: {
    marginTop: '4rem',
  },
  versionGroup: {
    borderBottom: '1px solid #1c1c1a',
  },
  versionSummary: {
    padding: '1rem 0',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '1.2rem',
    color: '#82807a',
    userSelect: 'none',
  },
  versionSummaryOpen: {
    padding: '1rem 0',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: '1.2rem',
    color: '#f0ebe1',
    userSelect: 'none',
  },
  versionToggle: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '1rem',
    color: '#4a4947',
  },
  versionItems: {
    paddingBottom: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  versionItem: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    padding: '0.5rem',
    background: 'transparent',
    border: '1px solid transparent',
    transition: 'all 0.2s',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  versionItemHover: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    padding: '0.5rem',
    background: '#0a0b0d',
    border: '1px solid #3a3936',
    transition: 'all 0.2s',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  viTitle: {
    fontSize: '0.85rem',
    color: '#f0ebe1',
  },
  viMeta: {
    fontSize: '0.75rem',
    color: '#82807a',
  },
  viFormat: {
    fontSize: '0.75rem',
    color: '#4a4947',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

const Header = ({ searchValue, onSearchChange }) => {
  return (
    <header style={customStyles.appHeader}>
      <a href="#" style={customStyles.logo}>dig.</a>
      <div style={customStyles.globalSearch}>
        <input
          type="text"
          placeholder="Search catalog, artists, labels..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          style={customStyles.searchInput}
        />
      </div>
      <nav style={customStyles.userNav}>
        <a href="#" style={{ color: '#82807a', textDecoration: 'none', transition: 'color 0.2s ease' }}>Collection</a>
        <a href="#" style={{ color: '#82807a', textDecoration: 'none', transition: 'color 0.2s ease' }}>Account</a>
      </nav>
    </header>
  );
};

const VersionGroup = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hoveredItem, setHoveredItem] = useState(null);

  return (
    <div style={customStyles.versionGroup}>
      <div
        style={isOpen ? customStyles.versionSummaryOpen : customStyles.versionSummary}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{title}</span>
        <span style={customStyles.versionToggle}>{isOpen ? '−' : '+'}</span>
      </div>
      {isOpen && (
        <div style={customStyles.versionItems}>
          {React.Children.map(children, (child, index) =>
            React.cloneElement(child, {
              isHovered: hoveredItem === index,
              onMouseEnter: () => setHoveredItem(index),
              onMouseLeave: () => setHoveredItem(null),
            })
          )}
        </div>
      )}
    </div>
  );
};

const VersionItem = ({ title, meta, format, isHovered, onMouseEnter, onMouseLeave }) => {
  return (
    <a
      href="#"
      style={isHovered ? customStyles.versionItemHover : customStyles.versionItem}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div>
        <div style={customStyles.viTitle}>{title}</div>
        <div style={customStyles.viMeta}>{meta}</div>
      </div>
      <div style={customStyles.viFormat}>{format}</div>
    </a>
  );
};

const TrackRow = ({ num, title, artists, time }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      style={{ backgroundColor: isHovered ? '#0a0b0d' : 'transparent', transition: 'background-color 0.2s ease' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <td style={customStyles.trackNum}>{num}</td>
      <td style={customStyles.tracklistTd}>
        <div style={customStyles.trackTitle}>{title}</div>
        <div style={customStyles.trackArtists}>{artists}</div>
      </td>
      <td style={customStyles.trackTime}>{time}</td>
    </tr>
  );
};

const HomePage = () => {
  const [addedToCollection, setAddedToCollection] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayMaster = () => {
    setIsPlaying(!isPlaying);
  };

  const handleAddToCollection = () => {
    setAddedToCollection(true);
    setTimeout(() => setAddedToCollection(false), 2000);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const tracks = [
    { num: '01', title: 'Metamorphosis', artists: 'Michiru Yamane', time: '2:34' },
    { num: '02', title: 'Prologue', artists: 'Michiru Yamane', time: '1:28' },
    { num: '03', title: 'Dance of Pales', artists: 'Michiru Yamane', time: '4:15' },
    { num: '04', title: 'Wood Carving Partita', artists: 'Michiru Yamane', time: '3:01' },
    { num: '05', title: 'Requiem for the Gods', artists: 'Michiru Yamane', time: '5:12' },
  ];

  return (
    <main style={customStyles.mainContent}>
      <section style={customStyles.releaseHero}>
        <div style={customStyles.artContainer}>
          <div style={customStyles.artPattern}></div>
          <span style={customStyles.artPlaceholderText}>Obscura</span>
        </div>

        <div style={customStyles.releaseMetaCore}>
          <div style={customStyles.entityType}>Master Release</div>
          <h1 style={customStyles.releaseTitle}>Symphony of the Night</h1>
          <h2 style={customStyles.releaseArtist}>The Alucard Ensemble</h2>

          <div style={customStyles.releaseFacts}>
            <div style={customStyles.factItem}>
              <span style={customStyles.factLabel}>Released</span>
              <span style={customStyles.factValue}>1997</span>
            </div>
            <div style={customStyles.factItem}>
              <span style={customStyles.factLabel}>Genre</span>
              <span style={customStyles.factValue}>Neo-Classical / Dark Ambient</span>
            </div>
            <div style={customStyles.factItem}>
              <span style={customStyles.factLabel}>Primary Label</span>
              <span style={customStyles.factValue}>Konami Kukeiha Club</span>
            </div>
          </div>

          <div style={customStyles.actionRow}>
            <button
              style={customStyles.btnPrimary}
              onClick={handlePlayMaster}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#ffffff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f0ebe1'; }}
            >
              {isPlaying ? 'Pause Master' : 'Play Master'}
            </button>
            <button
              style={customStyles.btn}
              onClick={handleAddToCollection}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3936'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {addedToCollection ? 'Added!' : 'Add to Collection'}
            </button>
            <button
              style={customStyles.btn}
              onClick={handleShare}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3936'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Share
            </button>
          </div>
        </div>
      </section>

      <div style={customStyles.dataLayout}>
        <div>
          <h3 style={customStyles.sectionTitle}>Tracklist</h3>
          <table style={customStyles.tracklist}>
            <thead>
              <tr>
                <th style={{ ...customStyles.tracklistTh, width: '40px' }}>#</th>
                <th style={customStyles.tracklistTh}>Title / Artists</th>
                <th style={customStyles.tracklistThTime}>Time</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track) => (
                <TrackRow
                  key={track.num}
                  num={track.num}
                  title={track.title}
                  artists={track.artists}
                  time={track.time}
                />
              ))}
            </tbody>
          </table>
        </div>

        <aside>
          <h3 style={customStyles.sectionTitle}>Master Credits</h3>
          <div style={customStyles.creditsBlock}>
            <div style={customStyles.posterCredits}>
              Composed and Arranged By<br />
              <span style={customStyles.posterCreditsSpan}>Michiru Yamane</span>
              <br /><br />
              Additional Programming By<br />
              <span style={customStyles.posterCreditsSpan}>Akiropito</span> &amp; <span style={customStyles.posterCreditsSpan}>Sanoppi</span>
              <br /><br />
              Mastered at Studio D, Tokyo by<br />
              <span style={customStyles.posterCreditsSpan}>Hiroshi Muraoka</span>
              <br /><br />
              Executive Producer<br />
              <span style={customStyles.posterCreditsSpan}>Koji Igarashi</span><br />
              A Konami Kukeiha Club Production
            </div>
          </div>

          <div style={customStyles.versionsList}>
            <h3 style={{ ...customStyles.sectionTitle, marginTop: '2rem' }}>Known Versions</h3>

            <VersionGroup title="Vinyl Pressings" defaultOpen={true}>
              <VersionItem
                title="Original Japanese Pressing"
                meta="Mondo • 1997 • KICA-7760"
                format="2xLP"
              />
              <VersionItem
                title="Remastered Blood Splatter Edition"
                meta="Mondo • 2018 • MOND-114"
                format="2xLP"
              />
            </VersionGroup>

            <VersionGroup title="CD & Digital" defaultOpen={false}>
              <VersionItem
                title="Original Soundtrack CD"
                meta="Konami • 1997"
                format="CD"
              />
            </VersionGroup>
          </div>
        </aside>
      </div>
    </main>
  );
};

const App = () => {
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Inter:wght@300;400;500&display=swap');
      
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      body {
        background-color: #020202;
        color: #f0ebe1;
        font-family: 'Inter', sans-serif;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        min-height: 100vh;
      }
      
      input::placeholder {
        color: #4a4947;
      }
      
      input:focus {
        border-bottom-color: #f0ebe1 !important;
      }
      
      a {
        color: inherit;
        text-decoration: none;
        transition: color 0.2s ease;
      }
      
      a:hover {
        color: #f0ebe1;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <div style={{ backgroundColor: '#020202', color: '#f0ebe1', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header searchValue={searchValue} onSearchChange={setSearchValue} />
      <HomePage />
    </div>
  );
};

export default App;
