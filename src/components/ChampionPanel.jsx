export default function ChampionPanel({ champion, onReshuffle }) {
  if (!champion) return null;
  return (
    <div className="champion-panel">
      <h1>{champion.name}</h1>
      {champion.title && <p className="champion-title">{champion.title}</p>}
      <button className="reshuffle-btn" onClick={onReshuffle}>
        Reshuffle
      </button>
    </div>
  );
}
