"use client";

import React, { useState, useEffect } from 'react';

const customStyles = {
  root: {
    '--c-pink': '#f4b3af',
    '--c-orange': '#e88d67',
    '--c-grey': '#b4b8b6',
    '--c-yellow': '#e2aa59',
    '--c-blue': '#579ebd',
    '--c-green': '#4b8260',
    '--c-pink-dark': '#eea5bc',
    '--c-black': '#050505',
    '--border-width': '4px',
  },
  massiveText: {
    fontWeight: 900,
    lineHeight: 0.8,
    letterSpacing: '-0.05em',
    transform: 'scaleY(1.1)',
    transformOrigin: 'bottom left',
    textTransform: 'uppercase',
  },
  blockFill: {
    fontWeight: 900,
    lineHeight: 0.85,
    letterSpacing: '-0.03em',
    textAlign: 'justify',
    textAlignLast: 'justify',
    wordBreak: 'break-all',
    marginBottom: 'auto',
    textTransform: 'uppercase',
  },
  massiveInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '8px solid #050505',
    fontWeight: 900,
    color: '#050505',
    padding: '0 0 10px 0',
    outline: 'none',
    letterSpacing: '-0.04em',
    textTransform: 'uppercase',
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  heroImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '60%',
    height: '70%',
    backgroundColor: '#050505',
    maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 40%, rgba(0,0,0,0))',
    WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 40%, rgba(0,0,0,0))',
    zIndex: 1,
    backgroundImage:
      'repeating-linear-gradient(45deg, #111 25%, transparent 25%, transparent 75%, #111 75%, #111), repeating-linear-gradient(45deg, #111 25%, #111 25%, transparent 25%, transparent 75%, #111 75%, #111)',
    backgroundPosition: '0 0, 2px 2px',
    backgroundSize: '4px 4px',
  },
  patternStripes: {
    background:
      'repeating-linear-gradient(180deg, #050505, #050505 4px, transparent 4px, transparent 12px)',
    height: '60px',
    width: '100%',
    marginTop: 'auto',
  },
};

const App = () => {
  const [searchValue, setSearchValue] = useState('');
  const [filters, setFilters] = useState({
    techno: true,
    house: false,
    experimental: true,
    ambient: false,
    vinyl: false,
    digital: true,
  });
  const [hoveredTrack, setHoveredTrack] = useState(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        text-transform: uppercase;
        color: #050505;
      }
      body {
        background-color: #050505;
        margin: 0;
        padding: 0;
      }
      .massive-input-placeholder::placeholder {
        color: rgba(0,0,0,0.3);
        text-transform: uppercase;
      }
      .b-checkbox {
        appearance: none;
        -webkit-appearance: none;
        width: 1.2rem;
        height: 1.2rem;
        border: 3px solid #050505;
        background: transparent;
        position: relative;
        cursor: pointer;
        flex-shrink: 0;
      }
      .b-checkbox:checked::after {
        content: '';
        position: absolute;
        top: 2px; left: 2px; right: 2px; bottom: 2px;
        background: #050505;
      }
      .track-item-hover:hover {
        background: #050505;
        color: #e2aa59 !important;
        padding-left: 0.5rem;
        transition: padding 0.1s;
      }
      .track-item-hover:hover span {
        color: #e2aa59 !important;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const toggleFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const tracks = [
    { id: '01', name: 'SEQUENCE A', time: '6:04' },
    { id: '02', name: 'MODULATION', time: '5:12' },
    { id: '03', name: 'NOISE FLOOR', time: '7:33' },
    { id: '04', name: 'ARTIFACT', time: '4:45' },
    { id: '05', name: 'SUB BASS', time: '6:20' },
  ];

  const fontSizeClamp = (min, vw, max) => `clamp(${min}, ${vw}, ${max})`;

  return (
    <div
      style={{
        backgroundColor: '#050505',
        minHeight: '100vh',
        padding: '4px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridAutoRows: 'minmax(100px, auto)',
        gap: '4px',
      }}
    >
      {/* Search Block */}
      <div
        style={{
          gridColumn: '1 / 5',
          gridRow: '1',
          minHeight: '250px',
          backgroundColor: '#f4b3af',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderBottom: '4px solid #050505',
              paddingBottom: '0.5rem',
              marginBottom: '2rem',
              fontWeight: 700,
              fontSize: '1rem',
              letterSpacing: 0,
            }}
          >
            <span>DATABASE SEARCH ■ V.2.4</span>
            <span>►► GLOBAL</span>
            <span>■ ■ ■</span>
          </div>
          <div
            style={{
              ...customStyles.massiveText,
              fontSize: fontSizeClamp('3rem', '7vw', '8rem'),
              marginBottom: '1rem',
            }}
          >
            FIND
            <br />
            AUDIO
          </div>
          <input
            type="text"
            className="massive-input-placeholder"
            placeholder="ARTIST, TRACK, LABEL..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            style={{
              ...customStyles.massiveInput,
              fontSize: fontSizeClamp('2rem', '5vw', '6rem'),
            }}
          />
        </div>
      </div>

      {/* Filters Block */}
      <div
        style={{
          gridColumn: '1 / 2',
          gridRow: '2 / 5',
          backgroundColor: '#b4b8b6',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '8px solid #050505',
            paddingBottom: '1rem',
            marginBottom: '1.5rem',
            fontWeight: 800,
            fontSize: '1.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          <span>FILTERS</span>
          <span>↓</span>
        </div>

        {/* Genre Section */}
        <div
          style={{
            borderBottom: '4px solid #050505',
            paddingTop: 0,
            paddingBottom: '1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            <span>GENRE</span>
            <span>►</span>
          </div>
          {[
            { key: 'techno', label: 'TECHNO' },
            { key: 'house', label: 'HOUSE' },
            { key: 'experimental', label: 'EXPERIMENTAL' },
            { key: 'ambient', label: 'AMBIENT' },
          ].map(({ key, label }) => (
            <label
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.75rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {label}
              <input
                type="checkbox"
                className="b-checkbox"
                checked={filters[key]}
                onChange={() => toggleFilter(key)}
              />
            </label>
          ))}
        </div>

        {/* Format Section */}
        <div
          style={{
            borderBottom: '4px solid #050505',
            paddingTop: '1.5rem',
            paddingBottom: '1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            <span>FORMAT</span>
            <span>►</span>
          </div>
          {[
            { key: 'vinyl', label: 'VINYL' },
            { key: 'digital', label: 'DIGITAL' },
          ].map(({ key, label }) => (
            <label
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.75rem',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {label}
              <input
                type="checkbox"
                className="b-checkbox"
                checked={filters[key]}
                onChange={() => toggleFilter(key)}
              />
            </label>
          ))}
        </div>

        {/* BPM Range Section */}
        <div style={{ paddingTop: '1.5rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            <span>BPM RANGE</span>
            <span>►</span>
          </div>
          <div
            style={{
              display: 'flex',
              border: '3px solid #050505',
              height: '2rem',
            }}
          >
            <div
              style={{
                flex: 1,
                backgroundColor: '#050505',
                color: '#b4b8b6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1rem',
                textTransform: 'uppercase',
              }}
            >
              120
            </div>
            <div
              style={{
                flex: 1,
                borderLeft: '3px solid #050505',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1rem',
                textTransform: 'uppercase',
              }}
            >
              140
            </div>
          </div>
        </div>

        {/* Stripe pattern */}
        <div style={customStyles.patternStripes} />
      </div>

      {/* Hero Block */}
      <div
        style={{
          gridColumn: '2 / 4',
          gridRow: '2 / 4',
          backgroundColor: '#e88d67',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
        }}
      >
        <div style={customStyles.heroImageOverlay} />
        <div
          style={{
            padding: '1.5rem',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            zIndex: 2,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderBottom: '4px solid rgba(0,0,0,0.2)',
              paddingBottom: '0.5rem',
              marginBottom: '2rem',
              fontWeight: 700,
              fontSize: '1rem',
            }}
          >
            <span>FEATURED RELEASE</span>
            <span>■</span>
          </div>
          <div
            style={{
              ...customStyles.massiveText,
              fontSize: fontSizeClamp('3rem', '7vw', '8rem'),
              position: 'relative',
              zIndex: 3,
              color: '#050505',
            }}
          >
            SYSTEM
            <br />
            OVER
            <br />
            RIDE
          </div>
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'relative',
              zIndex: 3,
              fontWeight: 800,
              fontSize: '1.5rem',
              letterSpacing: '-0.02em',
            }}
          >
            <span>VARIOUS ARTISTS</span>
            <span>[2024]</span>
          </div>
        </div>
      </div>

      {/* Stats Block */}
      <div
        style={{
          gridColumn: '4 / 5',
          gridRow: '2 / 3',
          backgroundColor: '#579ebd',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '1.5rem',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            ...customStyles.blockFill,
            fontSize: fontSizeClamp('1.5rem', '3vw', '4rem'),
          }}
        >
          INDEX
          <br />
          STATS
          <br />
          &amp; DATA
          <br />
          STREAM
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
            borderTop: '4px solid #050505',
            paddingTop: '1rem',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '0.8em',
              height: '0.8em',
              backgroundColor: '#050505',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>LIVE</span>
          <span
            style={{
              display: 'inline-block',
              width: '0.8em',
              height: '0.8em',
              backgroundColor: '#050505',
            }}
          />
        </div>
      </div>

      {/* Track List Block */}
      <div
        style={{
          gridColumn: '4 / 5',
          gridRow: '3 / 5',
          backgroundColor: '#e2aa59',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
            fontWeight: 800,
            fontSize: '1.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          <span>TOP TRACKS</span>
          <span>↓</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className="track-item-hover"
              onMouseEnter={() => setHoveredTrack(index)}
              onMouseLeave={() => setHoveredTrack(null)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: hoveredTrack === index ? '1rem 0 1rem 0.5rem' : '1rem 0',
                borderBottom: '3px solid #050505',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'padding 0.1s',
                backgroundColor: hoveredTrack === index ? '#050505' : 'transparent',
              }}
            >
              <span style={{ color: hoveredTrack === index ? '#e2aa59' : '#050505' }}>
                {track.id} ■ {track.name}
              </span>
              <span style={{ color: hoveredTrack === index ? '#e2aa59' : '#050505' }}>
                {track.time}
              </span>
            </div>
          ))}
          <div
            className="track-item-hover"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '1rem 0',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <span>►► LOAD MORE</span>
          </div>
        </div>
      </div>

      {/* Feature Sub Blocks */}
      <div
        style={{
          gridColumn: '2 / 4',
          gridRow: '4 / 5',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
          backgroundColor: '#050505',
          padding: 0,
        }}
      >
        {/* Green Stats Block */}
        <div
          style={{
            backgroundColor: '#4b8260',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: '1.5rem',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              ...customStyles.massiveText,
              fontSize: fontSizeClamp('3rem', '7vw', '8rem'),
              textAlign: 'right',
              lineHeight: 0.7,
            }}
          >
            99
          </div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>
            NEW ENTRIES
            <br />
            THIS WEEK
          </div>
        </div>

        {/* Pink Dark Status Block */}
        <div
          style={{
            backgroundColor: '#eea5bc',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: '1.5rem',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: '1rem',
              textAlign: 'center',
              borderBottom: '2px solid #050505',
              paddingBottom: '0.5rem',
            }}
          >
            SYSTEM STATUS
          </div>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              marginTop: 'auto',
            }}
          >
            <div
              style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '50%',
                border: '4px solid #050505',
                backgroundColor: 'transparent',
              }}
            />
            <div
              style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '50%',
                border: '4px solid #050505',
                backgroundColor: '#050505',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
