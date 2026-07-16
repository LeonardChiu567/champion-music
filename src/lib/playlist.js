// Gathers a champion's candidate songs — 5 artists x top 5 songs each, plus
// any hand-picked champion-specific bonus tracks — deduped by videoId, then
// shuffled and returns 12 for playback.
export function buildSongPool(championName, champions, songBank, extraSongs = {}) {
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
  for (const song of extraSongs[championName] || []) {
    if (seenIds.has(song.videoId)) continue;
    seenIds.add(song.videoId);
    pool.push(song);
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

export function pickPlaylist(championName, champions, songBank, extraSongs = {}, count = 12) {
  const pool = buildSongPool(championName, champions, songBank, extraSongs);
  return shuffle(pool).slice(0, count);
}
