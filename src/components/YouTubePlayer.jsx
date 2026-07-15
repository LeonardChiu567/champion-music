import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}
function SkipPreviousIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="6" y="5" width="2" height="14" />
      <path d="M18 5v14L8 12z" />
    </svg>
  );
}
function SkipNextIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M6 5v14l10-7z" />
      <rect x="16" y="5" width="2" height="14" />
    </svg>
  );
}
function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z" />
      <path d="M14 4.45v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}
function VolumeMuteIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H4v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

let ytApiPromise = null;
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise(resolve => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }
  return ytApiPromise;
}

// Embed gotcha (see CLAUDE.md): some official videos have embedding disabled
// by the label and throw an onError; we handle that by skipping to the next
// track. Autoplay gotcha: browsers block a fresh loadVideoById() from
// autoplaying once a track ends naturally (no user gesture at that point),
// so instead of loading tracks one at a time, the whole shuffled set is
// handed to the player as a native playlist (cuePlaylist) and YouTube's own
// prev/next/auto-advance keep it as one continuous, already-engaged playback
// session that browsers don't gate the same way a fresh load would be.
//
// Track-row clicks live outside this component (in TrackList/App), so they
// jump via an imperative handle (playAt) called directly inside the click
// handler — a real gesture, same as the prev/next buttons below — rather
// than round-tripping through a currentIndex prop, which raced with the
// cuePlaylist call right after mount and could wedge the player.
const YouTubePlayer = forwardRef(function YouTubePlayer(
  { tracks, onIndexChange, onTrackUnavailable, onPlaylistEnded },
  ref
) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const tracksRef = useRef(tracks);
  const onIndexChangeRef = useRef(onIndexChange);
  const onTrackUnavailableRef = useRef(onTrackUnavailable);
  const onPlaylistEndedRef = useRef(onPlaylistEnded);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);

  tracksRef.current = tracks;
  onIndexChangeRef.current = onIndexChange;
  onTrackUnavailableRef.current = onTrackUnavailable;
  onPlaylistEndedRef.current = onPlaylistEnded;

  function syncIndexFromPlayer() {
    const idx = playerRef.current?.getPlaylistIndex?.();
    if (typeof idx === 'number' && idx >= 0) onIndexChangeRef.current(idx);
  }

  useEffect(() => {
    let destroyed = false;
    loadYouTubeAPI().then(YT => {
      if (destroyed) return;
      playerRef.current = new YT.Player(containerRef.current, {
        height: '100%',
        width: '100%',
        playerVars: { rel: 0 },
        events: {
          onReady: () => {
            const player = playerRef.current;
            const startVolume = player?.getVolume?.();
            if (typeof startVolume === 'number') setVolume(startVolume);
            setMuted(!!player?.isMuted?.());
            setReady(true);
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              syncIndexFromPlayer();
            } else if (e.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            } else if (e.data === YT.PlayerState.CUED) {
              syncIndexFromPlayer();
            } else if (e.data === YT.PlayerState.ENDED) {
              // Individual track-to-track advances within a playing playlist
              // never reach ENDED (YouTube handles those internally) — this
              // only fires once the very last track finishes. Without
              // handling it the player would just go silent forever, so
              // hand back to the parent to cue a fresh shuffle.
              setIsPlaying(false);
              onPlaylistEndedRef.current?.();
            }
          },
          onError: () => {
            const idx = playerRef.current?.getPlaylistIndex?.();
            const badTrack = typeof idx === 'number' ? tracksRef.current[idx] : undefined;
            if (badTrack) onTrackUnavailableRef.current?.(badTrack);
            playerRef.current?.nextVideo?.();
          },
        },
      });
    });
    return () => {
      destroyed = true;
      playerRef.current?.destroy?.();
    };
  }, []);

  // A new (or reshuffled) track list gets cued as a fresh playlist, starting
  // at index 0. Cueing (not loading) keeps this from fighting the autoplay
  // gotcha on first selection.
  useEffect(() => {
    if (!ready || !playerRef.current || tracks.length === 0) return;
    playerRef.current.cuePlaylist(tracks.map(t => t.videoId), 0);
  }, [ready, tracks]);

  // Watchdog: YouTube embeds can occasionally report PLAYING while actually
  // stuck (buffering hiccup, ad interstitial, etc.) without ever firing
  // onError. If getCurrentTime() hasn't advanced for ~10s, nudge playVideo()
  // again; if that doesn't unstick it within another 5s, skip the track.
  useEffect(() => {
    if (!isPlaying) return;
    let lastTime = null;
    let stalls = 0;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getPlayerState) return;
      if (player.getPlayerState() !== 1 /* YT.PlayerState.PLAYING */) {
        lastTime = null;
        stalls = 0;
        return;
      }
      const curTime = player.getCurrentTime?.();
      if (typeof curTime !== 'number') return;
      if (lastTime !== null && curTime <= lastTime + 0.5) {
        stalls++;
        if (stalls === 1) player.playVideo?.();
        else if (stalls >= 2) {
          player.nextVideo?.();
          stalls = 0;
        }
      } else {
        stalls = 0;
      }
      lastTime = curTime;
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  useImperativeHandle(ref, () => ({
    playAt(index) {
      playerRef.current?.playVideoAt(index);
    },
  }));

  function togglePlay() {
    if (!playerRef.current) return;
    if (isPlaying) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  }

  function prev() {
    playerRef.current?.previousVideo?.();
  }

  function next() {
    playerRef.current?.nextVideo?.();
  }

  function toggleMute() {
    const player = playerRef.current;
    if (!player) return;
    if (muted || volume === 0) {
      const restored = volume === 0 ? 50 : volume;
      player.unMute();
      player.setVolume(restored);
      setVolume(restored);
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }

  function handleVolumeChange(e) {
    const value = Number(e.target.value);
    const player = playerRef.current;
    setVolume(value);
    player?.setVolume(value);
    if (value === 0) {
      player?.mute();
      setMuted(true);
    } else {
      player?.unMute();
      setMuted(false);
    }
  }

  return (
    <div className="youtube-player">
      <div className="youtube-player-frame-wrap">
        <div className="youtube-player-frame" ref={containerRef} />
      </div>
      <div className="youtube-player-controls">
        <div className="transport-group">
          <button onClick={prev} aria-label="Previous track" className="transport-btn">
            <SkipPreviousIcon />
          </button>
          <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="play-btn">
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button onClick={next} aria-label="Next track" className="transport-btn">
            <SkipNextIcon />
          </button>
        </div>
        <div className="volume-control">
          <button
            onClick={toggleMute}
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
            className="transport-btn"
          >
            {muted || volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
          </button>
          <input
            type="range"
            className="volume-slider"
            min="0"
            max="100"
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
});

export default YouTubePlayer;
