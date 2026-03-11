"use client";

import React, { useState, useEffect } from 'react';

const customStyles = {
  appContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#070707',
    color: '#f4f4f4',
    fontFamily: "'Inter', sans-serif",
    lineHeight: '1.5',
    WebkitFontSmoothing: 'antialiased',
  },
  scrollContent: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: '80px',
  },
  topNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    position: 'sticky',
    top: 0,
    background: 'linear-gradient(to bottom, rgba(7,7,7,1) 0%, rgba(7,7,7,0.9) 60%, rgba(7,7,7,0) 100%)',
    zIndex: 100,
  },
  navBtn: {
    background: 'none',
    border: 'none',
    color: '#f4f4f4',
    fontSize: '20px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  brandMark: {
    fontFamily: "'Playfair Display', serif",
    fontSize: '16px',
    fontStyle: 'italic',
    letterSpacing: '0.05em',
  },
  heroSection: {
    padding: '0 24px 32px',
    position: 'relative',
  },
  artworkContainer: {
    width: '100%',
    aspectRatio: '1',
    backgroundColor: '#0a0a0a',
    position: 'relative',
    marginBottom: '24px',
    overflow: 'hidden',
  },
  artworkImage: {
    width: '100%',
    height: '100%',
    background: 'radial-gradient(circle at 30% 30%, #2a2a2a 0%, #000000 100%)',
    objectFit: 'cover',
    mixBlendMode: 'luminosity',
    opacity: 0.8,
  },
  artworkOverlay: {
    position: 'absolute',
    inset: 0,
    boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)',
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  releaseTitle: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 400,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    fontSize: '38px',
    marginBottom: '4px',
    margin: 0,
  },
  releaseArtist: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 400,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    fontSize: '20px',
    color: '#8c8c8c',
    fontStyle: 'italic',
    margin: 0,
  },
  actionRow: {
    display: 'flex',
    gap: '16px',
    marginTop: '32px',
    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    padding: '16px 0',
  },
  actionBtnPrimary: {
    flex: 1,
    background: '#f4f4f4',
    border: '1px solid #f4f4f4',
    color: '#070707',
    padding: '12px',
    fontFamily: "'Inter', sans-serif",
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 500,
    transition: 'background 0.2s',
  },
  actionBtnSecondary: {
    flex: 1,
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: '#f4f4f4',
    padding: '12px',
    fontFamily: "'Inter', sans-serif",
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
    transition: 'background 0.2s',
  },
  metadataSection: {
    padding: '0 24px',
    marginTop: '32px',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    paddingBottom: '32px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  },
  metaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metaLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#8c8c8c',
    fontWeight: 500,
  },
  metaValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: '14px',
    color: '#f4f4f4',
    fontStyle: 'italic',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: '32px',
    marginBottom: '16px',
    padding: '0 24px',
  },
  sectionTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: '18px',
    color: '#f4f4f4',
    fontStyle: 'italic',
  },
  sectionMeta: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '10px',
    color: '#505050',
    letterSpacing: '0.05em',
  },
  tracklist: {
    listStyle: 'none',
    padding: '0 24px',
    margin: 0,
  },
  trackItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  trackItemLast: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 0',
  },
  trackNum: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '10px',
    color: '#505050',
    width: '24px',
  },
  trackTitle: {
    flex: 1,
    fontFamily: "'Playfair Display', serif",
    fontSize: '15px',
    paddingRight: '16px',
  },
  trackDuration: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '11px',
    color: '#8c8c8c',
    fontVariantNumeric: 'tabular-nums',
  },
  accordionGroup: {
    marginTop: '32px',
    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
  },
  accordionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    cursor: 'pointer',
    background: 'transparent',
    width: '100%',
    textAlign: 'left',
    color: '#f4f4f4',
    border: 'none',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  },
  accLabel: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  accCount: {
    fontFamily: "'Playfair Display', serif",
    fontSize: '14px',
    color: '#8c8c8c',
    fontStyle: 'italic',
  },
  accIcon: {
    fontFamily: "'Inter', sans-serif",
    fontSize: '16px',
    fontWeight: 300,
    color: '#505050',
  },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: '80px',
    background: 'rgba(7, 7, 7, 0.95)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 100,
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    color: '#505050',
    textDecoration: 'none',
    width: '64px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
  },
  navItemActive: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    color: '#f4f4f4',
    textDecoration: 'none',
    width: '64px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
  },
  navIconSearch: {
    width: '20px',
    height: '20px',
    border: '1px solid currentColor',
    borderRadius: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
  },
  navIconCatalog: {
    width: '20px',
    height: '14px',
    borderTop: '2px solid currentColor',
    borderBottom: '2px solid currentColor',
    borderLeft: 'none',
    borderRight: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
  },
  navIconUser: {
    width: '20px',
    height: '20px',
    border: '1px solid currentColor',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
  },
  navLabel: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 500,
    fontFamily: "'Inter', sans-serif",
  },
  crosshairMeta: {
    position: 'relative',
    paddingLeft: '16px',
  },
  crosshairMetaBefore: {
    position: 'absolute',
    left: '0',
    top: '50%',
    width: '8px',
    height: '1px',
    background: 'rgba(255, 255, 255, 0.3)',
  },
};

const tracks = [
  { num: '01', title: 'Part I: Acknowledgement', duration: '7:47' },
  { num: '02', title: 'Part II: Resolution', duration: '7:22' },
  { num: '03', title: 'Part III: Pursuance', duration: '10:45' },
  { num: '04', title: 'Part IV: Psalm', duration: '7:08' },
];

const accordionItems = [
  { label: 'Versions / Pressings', count: '184' },
  { label: 'Full Credits & Roles', count: '12' },
  { label: 'Related Context', count: null },
];

const MusicCatalogPage = () => {
  const [activeNav, setActiveNav] = useState('search');
  const [openAccordions, setOpenAccordions] = useState({});
  const [added, setAdded] = useState(false);
  const [playing, setPlaying] = useState(false);

  const toggleAccordion = (index) => {
    setOpenAccordions((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleAdd = () => {
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const handlePlay = () => {
    setPlaying((prev) => !prev);
  };

  return (
    <div style={customStyles.appContainer}>
      <header style={customStyles.topNav}>
        <button style={customStyles.navBtn}>←</button>
        <div style={customStyles.brandMark}>Dig</div>
        <button style={customStyles.navBtn}>⋯</button>
      </header>

      <main style={customStyles.scrollContent}>
        <section style={customStyles.heroSection}>
          <div style={customStyles.artworkContainer}>
            <div style={customStyles.artworkImage}></div>
            <div style={customStyles.artworkOverlay}></div>
          </div>

          <div style={customStyles.titleBlock}>
            <h1 style={customStyles.releaseTitle}>A Love Supreme</h1>
            <h2 style={customStyles.releaseArtist}>John Coltrane</h2>
          </div>

          <div style={customStyles.actionRow}>
            <button
              style={customStyles.actionBtnPrimary}
              onClick={handlePlay}
            >
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              style={customStyles.actionBtnSecondary}
              onClick={handleAdd}
            >
              <span>{added ? '✓ Added' : '+ Add'}</span>
            </button>
          </div>
        </section>

        <section style={customStyles.metadataSection}>
          <div style={customStyles.metaGrid}>
            <div style={customStyles.metaItem}>
              <span style={customStyles.metaLabel}>Released</span>
              <span style={customStyles.metaValue}>Jan 1965</span>
            </div>
            <div style={customStyles.metaItem}>
              <span style={customStyles.metaLabel}>Label</span>
              <span style={customStyles.metaValue}>Impulse!</span>
            </div>
            <div style={customStyles.metaItem}>
              <span style={customStyles.metaLabel}>Genre</span>
              <span style={customStyles.metaValue}>Avant-Garde Jazz</span>
            </div>
            <div style={customStyles.metaItem}>
              <span style={customStyles.metaLabel}>Format</span>
              <span style={customStyles.metaValue}>Master Release</span>
            </div>
          </div>
        </section>

        <div style={customStyles.sectionHeader}>
          <h3 style={customStyles.sectionTitle}>Tracklist</h3>
          <span style={customStyles.sectionMeta}>32:48 TOTAL</span>
        </div>

        <ul style={customStyles.tracklist}>
          {tracks.map((track, index) => (
            <li
              key={track.num}
              style={index === tracks.length - 1 ? customStyles.trackItemLast : customStyles.trackItem}
            >
              <span style={customStyles.trackNum}>{track.num}</span>
              <span style={customStyles.trackTitle}>{track.title}</span>
              <span style={customStyles.trackDuration}>{track.duration}</span>
            </li>
          ))}
        </ul>

        <div style={customStyles.accordionGroup}>
          {accordionItems.map((item, index) => (
            <React.Fragment key={index}>
              <button
                style={customStyles.accordionRow}
                onClick={() => toggleAccordion(index)}
              >
                <div style={customStyles.crosshairMeta}>
                  <div style={customStyles.crosshairMetaBefore}></div>
                  <span style={customStyles.accLabel}>{item.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {item.count && <span style={customStyles.accCount}>{item.count}</span>}
                  <span style={customStyles.accIcon}>
                    {openAccordions[index] ? '−' : '+'}
                  </span>
                </div>
              </button>
              {openAccordions[index] && (
                <div
                  style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '12px',
                    color: '#8c8c8c',
                    lineHeight: 1.6,
                  }}
                >
                  {item.label === 'Versions / Pressings' && (
                    <p>184 different pressings and versions of this release are available in the catalog.</p>
                  )}
                  {item.label === 'Full Credits & Roles' && (
                    <p>John Coltrane — Tenor & Soprano Saxophone, Composer<br />
                    McCoy Tyner — Piano<br />
                    Jimmy Garrison — Bass<br />
                    Elvin Jones — Drums<br />
                    Bob Thiele — Producer<br />
                    Rudy Van Gelder — Engineer</p>
                  )}
                  {item.label === 'Related Context' && (
                    <p>Recorded in December 1964 at Van Gelder Studio, Englewood Cliffs, New Jersey. Widely regarded as one of the greatest jazz albums ever recorded.</p>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </main>

      <nav style={customStyles.bottomNav}>
        <button
          style={activeNav === 'search' ? customStyles.navItemActive : customStyles.navItem}
          onClick={() => setActiveNav('search')}
        >
          <div style={customStyles.navIconSearch}></div>
          <span style={customStyles.navLabel}>Search</span>
        </button>
        <button
          style={activeNav === 'catalog' ? customStyles.navItemActive : customStyles.navItem}
          onClick={() => setActiveNav('catalog')}
        >
          <div style={customStyles.navIconCatalog}></div>
          <span style={customStyles.navLabel}>Catalog</span>
        </button>
        <button
          style={activeNav === 'account' ? customStyles.navItemActive : customStyles.navItem}
          onClick={() => setActiveNav('account')}
        >
          <div style={customStyles.navIconUser}></div>
          <span style={customStyles.navLabel}>Account</span>
        </button>
      </nav>
    </div>
  );
};

const App = () => {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { background-color: #070707; overscroll-behavior-y: none; }
      button:active { opacity: 0.7; }
      ::-webkit-scrollbar { display: none; }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(link);
      document.head.removeChild(style);
    };
  }, []);

  return (
    <MusicCatalogPage />
  );
};

export default App;
