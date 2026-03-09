"use client";

import React, { useState } from 'react';

const customStyles = {
  root: {
    backgroundColor: '#f2f2f2',
    color: '#000000',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  navZone: {
    width: '320px',
    padding: '2rem 2rem 2rem 3rem',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  brand: {
    fontSize: '3.5rem',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '-0.05em',
    lineHeight: 0.8,
    marginBottom: '3rem',
    transform: 'scaleY(1.1)',
    transformOrigin: 'top left',
  },
  navList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  navItemBase: {
    fontSize: '1.125rem',
    textTransform: 'uppercase',
    marginBottom: '0.4rem',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  navItemInactive: {
    opacity: 0.6,
  },
  navItemActive: {
    opacity: 1,
  },
  mainZone: {
    flex: 1,
    padding: '2rem 4rem 2rem 0',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  searchContainer: {
    marginBottom: '4rem',
    position: 'relative',
  },
  searchInput: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid #000000',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: '4rem',
    fontWeight: 400,
    letterSpacing: '-0.03em',
    color: '#000000',
    paddingBottom: '0.5rem',
    borderRadius: 0,
    outline: 'none',
  },
  resultsHeader: {
    fontSize: '1rem',
    textTransform: 'uppercase',
    marginBottom: '1rem',
  },
  resultList: {
    display: 'flex',
    flexDirection: 'column',
    borderTop: '2px solid #000000',
  },
  resultItem: {
    borderBottom: '2px solid #000000',
    padding: '1.5rem 0 1rem 0',
    textDecoration: 'none',
    color: '#000000',
    display: 'block',
    transition: 'background-color 0.15s',
    cursor: 'pointer',
  },
  resultItemHover: {
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  itemTop: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  },
  itemTitle: {
    fontSize: '2.25rem',
    fontWeight: 400,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  itemSubtitle: {
    fontSize: '2.25rem',
    fontWeight: 400,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  itemMeta: {
    fontSize: '1.125rem',
    fontWeight: 400,
  },
  itemBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  itemData: {
    fontSize: '2.75rem',
    fontWeight: 400,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  itemAction: {
    fontSize: '1.125rem',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  arrow: {
    fontFamily: 'monospace',
    fontSize: '1.2em',
    lineHeight: 0,
    position: 'relative',
    top: '-1px',
  },
};

const navItems = [
  { label: 'Search', key: 'search' },
  { label: 'Playlists', key: 'playlists' },
  { label: 'Artists', key: 'artists' },
  { label: 'Albums', key: 'albums' },
  { label: 'History', key: 'history' },
];

const allResults = [
  {
    id: 1,
    title: 'Selected Ambient Works',
    subtitle: '/ 85-92',
    meta: '(Album)',
    data: '1992',
    action: 'View',
    artist: 'Aphex Twin',
  },
  {
    id: 2,
    title: 'Windowlicker',
    subtitle: null,
    meta: '(EP)',
    data: '1999',
    action: 'Play',
    artist: 'Aphex Twin',
  },
  {
    id: 3,
    title: 'Alberto Balsalm',
    subtitle: null,
    meta: '(Track)',
    data: '05:11',
    action: 'Play',
    artist: 'Aphex Twin',
  },
  {
    id: 4,
    title: 'Richard D. James Album',
    subtitle: null,
    meta: '(Album)',
    data: '1996',
    action: 'View',
    artist: 'Aphex Twin',
  },
  {
    id: 5,
    title: 'Avril 14th',
    subtitle: null,
    meta: '(Track)',
    data: '02:05',
    action: 'Play',
    artist: 'Aphex Twin',
  },
  {
    id: 6,
    title: 'Come to Daddy',
    subtitle: null,
    meta: '(EP)',
    data: '1997',
    action: 'Play',
    artist: 'Aphex Twin',
  },
  {
    id: 7,
    title: 'Syro',
    subtitle: null,
    meta: '(Album)',
    data: '2014',
    action: 'View',
    artist: 'Aphex Twin',
  },
  {
    id: 8,
    title: 'Drukqs',
    subtitle: null,
    meta: '(Album)',
    data: '2001',
    action: 'View',
    artist: 'Aphex Twin',
  },
];

const ResultItem = ({ item }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href="#"
      style={{
        ...customStyles.resultItem,
        ...(hovered ? customStyles.resultItemHover : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => e.preventDefault()}
    >
      <div style={customStyles.itemTop}>
        <span style={customStyles.itemTitle}>{item.title}</span>
        {item.subtitle && (
          <span style={customStyles.itemSubtitle}>{item.subtitle}</span>
        )}
        <span style={customStyles.itemMeta}>{item.meta}</span>
      </div>
      <div style={customStyles.itemBottom}>
        <span style={customStyles.itemData}>{item.data}</span>
        <span style={customStyles.itemAction}>
          {item.action} <span style={customStyles.arrow}>→</span>
        </span>
      </div>
    </a>
  );
};

const NavItem = ({ label, isActive, onClick, extraStyle }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <li
      style={{
        ...customStyles.navItemBase,
        ...(isActive || hovered
          ? customStyles.navItemActive
          : customStyles.navItemInactive),
        ...extraStyle,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </li>
  );
};

const App = () => {
  const [activeNav, setActiveNav] = useState('search');
  const [searchValue, setSearchValue] = useState('Aphex Twin');
  const [searchFocused, setSearchFocused] = useState(false);

  const filteredResults = allResults.filter((item) => {
    if (!searchValue.trim()) return true;
    const q = searchValue.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.artist.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q))
    );
  });

  return (
      <div style={customStyles.root}>
        <nav style={customStyles.navZone}>
          <div style={customStyles.brand}>
            SOUND
            <br />
            FINDER
          </div>
          <ul style={customStyles.navList}>
            {navItems.map((item) => (
              <NavItem
                key={item.key}
                label={item.label}
                isActive={activeNav === item.key}
                onClick={() => setActiveNav(item.key)}
              />
            ))}
            <NavItem
              label="Settings"
              isActive={activeNav === 'settings'}
              onClick={() => setActiveNav('settings')}
              extraStyle={{ marginTop: '2rem' }}
            />
          </ul>
        </nav>

        <main style={customStyles.mainZone}>
          <div style={customStyles.searchContainer}>
            <input
              type="text"
              style={{
                ...customStyles.searchInput,
                borderBottomWidth: searchFocused ? '4px' : '2px',
                marginBottom: searchFocused ? '-2px' : '0',
              }}
              value={searchValue}
              placeholder="Search..."
              onChange={(e) => setSearchValue(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>

          {activeNav === 'search' && (
            <>
              <div style={customStyles.resultsHeader}>
                {searchValue.trim()
                  ? `Top Results`
                  : 'All Music'}
              </div>
              <div style={customStyles.resultList}>
                {filteredResults.length > 0 ? (
                  filteredResults.map((item) => (
                    <ResultItem key={item.id} item={item} />
                  ))
                ) : (
                  <div
                    style={{
                      padding: '3rem 0',
                      fontSize: '1.5rem',
                      opacity: 0.4,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    No results found.
                  </div>
                )}
              </div>
            </>
          )}

          {activeNav === 'playlists' && (
            <>
              <div style={customStyles.resultsHeader}>Playlists</div>
              <div style={customStyles.resultList}>
                {['Electronic Essentials', 'Ambient Journeys', 'Late Night Sessions', 'IDM Classics'].map((pl, i) => (
                  <a
                    key={i}
                    href="#"
                    style={customStyles.resultItem}
                    onClick={(e) => e.preventDefault()}
                  >
                    <div style={customStyles.itemTop}>
                      <span style={customStyles.itemTitle}>{pl}</span>
                    </div>
                    <div style={customStyles.itemBottom}>
                      <span style={customStyles.itemData}>{10 + i * 3} tracks</span>
                      <span style={customStyles.itemAction}>Open <span style={customStyles.arrow}>→</span></span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}

          {activeNav === 'artists' && (
            <>
              <div style={customStyles.resultsHeader}>Artists</div>
              <div style={customStyles.resultList}>
                {['Aphex Twin', 'Boards of Canada', 'Autechre', 'Burial', 'Four Tet'].map((artist, i) => (
                  <a
                    key={i}
                    href="#"
                    style={customStyles.resultItem}
                    onClick={(e) => e.preventDefault()}
                  >
                    <div style={customStyles.itemTop}>
                      <span style={customStyles.itemTitle}>{artist}</span>
                    </div>
                    <div style={customStyles.itemBottom}>
                      <span style={customStyles.itemData}>{3 + i} albums</span>
                      <span style={customStyles.itemAction}>View <span style={customStyles.arrow}>→</span></span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}

          {activeNav === 'albums' && (
            <>
              <div style={customStyles.resultsHeader}>Albums</div>
              <div style={customStyles.resultList}>
                {allResults.filter(r => r.meta === '(Album)').map((item) => (
                  <ResultItem key={item.id} item={item} />
                ))}
              </div>
            </>
          )}

          {activeNav === 'history' && (
            <>
              <div style={customStyles.resultsHeader}>Recently Played</div>
              <div style={customStyles.resultList}>
                {[...allResults].reverse().slice(0, 5).map((item) => (
                  <ResultItem key={item.id} item={item} />
                ))}
              </div>
            </>
          )}

          {activeNav === 'settings' && (
            <>
              <div style={customStyles.resultsHeader}>Settings</div>
              <div style={customStyles.resultList}>
                {['Audio Quality', 'Notifications', 'Privacy', 'Account', 'About'].map((setting, i) => (
                  <a
                    key={i}
                    href="#"
                    style={customStyles.resultItem}
                    onClick={(e) => e.preventDefault()}
                  >
                    <div style={customStyles.itemTop}>
                      <span style={customStyles.itemTitle}>{setting}</span>
                    </div>
                    <div style={customStyles.itemBottom}>
                      <span style={{ ...customStyles.itemData, fontSize: '1.25rem', opacity: 0.5 }}>Configure</span>
                      <span style={customStyles.itemAction}>Open <span style={customStyles.arrow}>→</span></span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
  );
};

export default App;
