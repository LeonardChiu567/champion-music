// Gathers a champion's ~25 candidate songs (5 artists x top 5 songs each),
// deduped by videoId, then shuffles and returns 12 for playback.
export function buildSongPool(championName, champions, songBank) {
  const artists = champions[championName] || [];
  const seenIds = new Set();
  const pool = [];
  for (const artist of artists) {
    for (const song of songBank[artist] || []) {
      if (seenIds.has(song.videoId)) continue;
      seenIds.add(song.videoId);
      pool.push({ ...song, artist });
    }
  }
  return pool;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickPlaylist(championName, champions, songBank, count = 12) {
  const pool = buildSongPool(championName, champions, songBank);
  return shuffle(pool).slice(0, count);
}
