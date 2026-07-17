import { useState, useEffect, useMemo, useRef } from 'react';
import { getRoster, getLatestVersion, championIconUrl } from '../lib/dataDragon.js';

export default function ChampionSearch({ onSelect, size = 'default', autoFocus = false }) {
  const [roster, setRoster] = useState([]);
  const [version, setVersion] = useState(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  function loadRoster() {
    setLoadError(false);
    getLatestVersion().then(setVersion).catch(() => setLoadError(true));
    getRoster().then(setRoster).catch(() => setLoadError(true));
  }

  useEffect(() => {
    loadRoster();
  }, []);

  const matches = useMemo(() => {
    // Strip apostrophes so "kaisa"/"ksante" find "Kai'Sa"/"K'Sante" without
    // the player needing to type the exact punctuation.
    const stripApostrophes = s => s.replace(/['’]/g, '');
    const q = stripApostrophes(query.trim().toLowerCase());
    if (!q) return [];
    return roster
      .filter(c => stripApostrophes(c.name.toLowerCase()).startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, query]);

  function selectChampion(champ) {
    onSelect(champ);
    setQuery(champ.name);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectChampion(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={`champion-search champion-search--${size}`}>
      <input
        type="text"
        placeholder="Search a champion..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="Search for a champion"
        autoFocus={autoFocus}
      />
      {open && matches.length > 0 && (
        <ul className="champion-search-results">
          {matches.map((champ, i) => (
            <li
              key={champ.id}
              className={i === activeIndex ? 'active' : ''}
              onMouseDown={() => selectChampion(champ)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {version && <img src={championIconUrl(version, champ.iconFull)} alt="" />}
              <span>{champ.name}</span>
            </li>
          ))}
        </ul>
      )}
      {open && loadError && (
        <div className="champion-search-error">
          <span>Couldn't load champions.</span>
          <button type="button" onMouseDown={e => { e.preventDefault(); loadRoster(); }}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
