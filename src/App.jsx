import { useState, useCallback, useRef, useEffect } from 'react';
import ChampionSearch from './components/ChampionSearch.jsx';
import ChampionPanel from './components/ChampionPanel.jsx';
import YouTubePlayer from './components/YouTubePlayer.jsx';
import TrackList from './components/TrackList.jsx';
import LandingHero from './components/LandingHero.jsx';
import KofiLink from './components/KofiLink.jsx';
import { champions } from '../data/champions.js';
import songBank from '../data/song-bank.json';
import extraSongs from '../data/champion-extra-songs.json';
import { pickPlaylist } from './lib/playlist.js';
import { championSplashUrl, getRoster } from './lib/dataDragon.js';

function championIdFromUrl() {
  return new URLSearchParams(window.location.search).get('champion');
}

export default function App() {
  const [champion, setChampion] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [notice, setNotice] = useState(null);
  const playerRef = useRef(null);
  const championRef = useRef(null);
  championRef.current = champion;

  function applyChampion(champ) {
    setChampion(champ);
    setTracks(pickPlaylist(champ.name, champions, songBank, extraSongs));
    setCurrentIndex(0);
    setNotice(null);
  }

  // Makes champion pages linkable/bookmarkable/back-button-able: read
  // ?champion=<id> on load and whenever the user navigates with browser
  // back/forward, rather than always dropping back to the search screen.
  useEffect(() => {
    function syncFromUrl() {
      const id = championIdFromUrl();
      if (!id) {
        setChampion(null);
        return;
      }
      getRoster()
        .then(roster => {
          const champ = roster.find(c => c.id === id);
          if (champ) applyChampion(champ);
          else setChampion(null);
        })
        .catch(() => {});
    }
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectChampion(champ) {
    applyChampion(champ);
    const url = new URL(window.location.href);
    url.searchParams.set('champion', champ.id);
    window.history.pushState({}, '', url);
  }

  function handleBackToSearch() {
    setChampion(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('champion');
    window.history.pushState({}, '', url);
  }

  function handleReshuffle() {
    if (!champion) return;
    setTracks(pickPlaylist(champion.name, champions, songBank, extraSongs));
    setCurrentIndex(0);
  }

  const handlePlaylistEnded = useCallback(() => {
    const current = championRef.current;
    if (!current) return;
    setTracks(pickPlaylist(current.name, champions, songBank, extraSongs));
    setCurrentIndex(0);
    setNotice('Playlist finished — shuffled a new one. Press play to keep going.');
  }, []);

  const handleUnavailable = useCallback(track => {
    setNotice(`Skipped "${track.title}" — not available for embedding`);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  if (!champion) {
    return (
      <div className="app app--landing">
        <LandingHero onSelect={handleSelectChampion} />
      </div>
    );
  }

  return (
    <div
      className="app app--player"
      style={{ backgroundImage: `url(${championSplashUrl(champion.id)})` }}
    >
      <div className="app-bg-overlay" />
      <header className="app-header">
        <button className="app-logo" onClick={handleBackToSearch}>
          Champion Music
        </button>
        <ChampionSearch onSelect={handleSelectChampion} />
        <KofiLink className="kofi-link--header" />
      </header>

      <ChampionPanel champion={champion} onReshuffle={handleReshuffle} />
      <main className="app-main">
        <div className="player-column">
          <YouTubePlayer
            ref={playerRef}
            tracks={tracks}
            onIndexChange={setCurrentIndex}
            onTrackUnavailable={handleUnavailable}
            onPlaylistEnded={handlePlaylistEnded}
          />
          {notice && <div className="notice">{notice}</div>}
        </div>
        <TrackList
          tracks={tracks}
          currentIndex={currentIndex}
          onSelect={i => playerRef.current?.playAt(i)}
        />
      </main>
    </div>
  );
}
