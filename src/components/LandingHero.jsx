import { useEffect, useState } from 'react';
import { getRoster, championSplashUrl } from '../lib/dataDragon.js';
import ChampionSearch from './ChampionSearch.jsx';
import KofiLink from './KofiLink.jsx';

export default function LandingHero({ onSelect }) {
  const [bgUrl, setBgUrl] = useState(null);

  useEffect(() => {
    // Purely decorative — if this fails, the hero just falls back to its
    // plain background color. The search box (which handles its own error
    // state) is what actually matters if Data Dragon is unreachable.
    getRoster()
      .then(roster => {
        const champ = roster[Math.floor(Math.random() * roster.length)];
        setBgUrl(championSplashUrl(champ.id));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="landing-hero" style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}>
      <div className="landing-bg-overlay" />
      <KofiLink className="kofi-link--landing" />

      <h1 className="landing-title">Champion Music</h1>
      <p className="landing-subtitle">Playlist for each champion.</p>
      <ChampionSearch onSelect={onSelect} size="large" autoFocus />
    </div>
  );
}
