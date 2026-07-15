# Champion Music

A League of Legends champion music selector — search a champion, get a
playlist tuned to their vibe, played through an embedded YouTube player.
Original curation, not copied from mood.gg. See `../CLAUDE.md` for the
full project handoff (vision, gotchas, data, next steps).

## Run locally

```bash
npm install
npm run dev
```

Open the printed `http://localhost...` URL. **Do not** open `index.html`
directly via `file://` — the YouTube player requires a real HTTP origin
or it throws error 153.

## Build

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

## Populate the song bank

```bash
cp .env.example .env   # then fill in YOUTUBE_API_KEY
npm run fetch-songs
```

Resumable — safe to re-run across multiple days if you hit the YouTube
Data API's ~100 search requests/day cap. See `scripts/fetch-songs.mjs`
and `data/review-needed.json` for artists that need hand curation.

## Structure

```
data/            champion -> artists, artist -> songs (source data)
scripts/         song-bank fetcher
src/
  lib/           Data Dragon roster/splash fetching, playlist shuffling
  components/    search, splash panel, YouTube player, track list
```
