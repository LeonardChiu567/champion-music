export default function TrackList({ tracks, currentIndex, onSelect }) {
  if (tracks.length === 0) return null;
  return (
    <ol className="track-list">
      {tracks.map((track, i) => (
        <li
          key={`${track.videoId}-${i}`}
          className={i === currentIndex ? 'active' : ''}
          onClick={() => onSelect(i)}
        >
          <span className="track-index">{i + 1}</span>
          <div className="track-info">
            <span className="track-title">{track.title}</span>
            <span className="track-artist">{track.artist}</span>
          </div>
          <a
            className="track-external"
            href={`https://www.youtube.com/watch?v=${track.videoId}`}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            aria-label="Open on YouTube"
          >
            ↗
          </a>
        </li>
      ))}
    </ol>
  );
}
