// Reads data/champions.js, extracts the unique artist list, and for each artist
// not already in data/song-bank.json, queries the YouTube Data API v3 for their
// top music videos. Clean results go straight into song-bank.json; artists whose
// top results look like mixes/compilations/live sets get flagged into
// data/review-needed.json for hand curation instead (see CLAUDE.md).
//
// Usage:
//   node scripts/fetch-songs.mjs                # process until daily quota budget runs out
//   node scripts/fetch-songs.mjs --limit 50      # cap this run to 50 artists
//   node scripts/fetch-songs.mjs --force         # re-fetch artists already in song-bank.json
//   node scripts/fetch-songs.mjs --only "Artist A,Artist B"
//
// Each artist costs ~101 quota units (100 for search.list + 1 for videos.list).
// Free daily quota is 10,000 units, so budget for ~99 artists/day.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHAMPIONS_PATH = path.join(ROOT, 'data', 'champions.js');
const SONG_BANK_PATH = path.join(ROOT, 'data', 'song-bank.json');
const REVIEW_PATH = path.join(ROOT, 'data', 'review-needed.json');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const API_KEY = env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.error('Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 90;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1].split(',').map(s => s.trim()) : null;
// Comma-separated video IDs to skip (e.g. known embed-blocked ones), so a
// --force re-fetch reaches for the next candidate instead of re-picking them.
const EXCLUDE_IDS = new Set((process.env.EXCLUDE_VIDEO_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

const SUSPECT_TITLE_RE = /\b(mix|compilation|full album|album|live|greatest hits|hour|hours|playlist|megamix|discography)\b/i;
const MAX_DURATION_SEC = 600; // 10 minutes

const HTML_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#039': "'" };
function decodeHTMLEntities(str) {
  return str.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Normalizes a title for de-duplication: strips artist prefixes, "(Official ...)"
// tags, and punctuation/case differences so re-uploads of the same song collapse
// to one entry instead of filling multiple slots with the same track.
function normalizeTitle(title, artist) {
  let t = title.toLowerCase();
  t = t.replace(new RegExp(`^${artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-:]\\s*`, 'i'), '');
  t = t.replace(/\((official( music)? video|official audio|official lyric video|audio|lyrics?|remastered[^)]*|4k[^)]*|hd)\)/gi, '');
  t = t.replace(/\b(ft\.?|feat\.?|featuring)\s+.+$/i, '');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  return t;
}

function parseISODuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class DailyQuotaExhaustedError extends Error {}

// Retries on 429 with exponential backoff for transient burst limits. But
// YouTube reports the real per-day search.list cap (defaultSearchListPerDayPerProject)
// with the same 429 status — that one never clears until the daily reset, so we
// detect it from the response body and fail fast instead of burning through
// retry backoff (and the rest of the queue) for nothing.
async function fetchWithRetry(url, { retries = 4, baseDelayMs = 3000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    const bodyText = await res.text();
    if (bodyText.includes('defaultSearchListPerDayPerProject') || bodyText.includes('PerDayPerProject')) {
      throw new DailyQuotaExhaustedError('Daily search.list quota exhausted for this project.');
    }
    if (attempt >= retries) {
      // Re-create a response-like object since we already consumed the body.
      return { ok: false, status: 429, text: async () => bodyText };
    }
    const wait = baseDelayMs * 2 ** attempt;
    console.log(`  (429 rate-limited, retrying in ${Math.round(wait / 1000)}s...)`);
    await sleep(wait);
  }
}

async function searchArtist(artist) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', artist);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '10'); // Music
  url.searchParams.set('order', 'viewCount');
  url.searchParams.set('maxResults', '25');
  url.searchParams.set('key', API_KEY);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`search.list failed for "${artist}": ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.items || []).map(it => ({
    videoId: it.id.videoId,
    title: decodeHTMLEntities(it.snippet.title),
    channelTitle: decodeHTMLEntities(it.snippet.channelTitle || ''),
  }));
}

// Catches loose keyword-overlap search mismatches (e.g. a "Slipknot" video
// surfacing for a "Pantera" search) by requiring the uploader's channel name
// to actually contain the artist name (or vice versa). Won't catch tribute/
// cover acts whose name happens to contain the real artist's name, but stops
// the more common wrong-artist false matches.
function channelMatchesArtist(channelTitle, artist) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = norm(channelTitle);
  const a = norm(artist);
  if (!c || !a) return true; // fail open if data is missing
  return c.includes(a) || a.includes(c);
}

async function fetchDurations(videoIds) {
  if (videoIds.length === 0) return {};
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', API_KEY);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`videos.list failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const out = {};
  for (const it of json.items || []) {
    out[it.id] = parseISODuration(it.contentDetails.duration);
  }
  return out;
}

function loadJSON(p, fallback) {
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveJSON(p, obj) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

async function main() {
  const { champions } = await import(`file://${CHAMPIONS_PATH.replace(/\\/g, '/')}`);
  const allArtists = [...new Set(Object.values(champions).flat())].sort();
  console.log(`Total unique artists in roster: ${allArtists.length}`);

  const songBank = loadJSON(SONG_BANK_PATH, {});
  const reviewNeeded = loadJSON(REVIEW_PATH, {});

  let queue = allArtists.filter(a => a !== '_note');
  if (ONLY) {
    queue = queue.filter(a => ONLY.includes(a));
  } else if (!FORCE) {
    queue = queue.filter(a => !songBank[a] && !reviewNeeded[a]);
  }

  console.log(`Artists to process this run: ${Math.min(queue.length, LIMIT)} (of ${queue.length} remaining)`);

  let processed = 0;
  for (const artist of queue) {
    if (processed >= LIMIT) {
      console.log(`\nHit --limit ${LIMIT}. Stopping. ${queue.length - processed} artists still remain — run again (tomorrow, if quota is exhausted) to continue.`);
      break;
    }
    try {
      const results = await searchArtist(artist);
      const durations = await fetchDurations(results.map(r => r.videoId));

      const clean = results.filter(r => {
        const dur = durations[r.videoId] || 0;
        return dur > 0 && dur <= MAX_DURATION_SEC && !SUSPECT_TITLE_RE.test(r.title) && channelMatchesArtist(r.channelTitle, artist) && !EXCLUDE_IDS.has(r.videoId);
      });

      // De-dupe by normalized song title so re-uploads/alt versions of the same
      // track don't consume more than one of the 5 slots.
      const seenTitles = new Set();
      const distinctClean = [];
      for (const r of clean) {
        const key = normalizeTitle(r.title, artist);
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        distinctClean.push(r);
      }

      if (distinctClean.length >= 5) {
        songBank[artist] = distinctClean.slice(0, 5).map(r => ({ title: r.title, videoId: r.videoId }));
        delete reviewNeeded[artist];
        console.log(`OK   ${artist} -> ${distinctClean.length} distinct clean candidates, kept top 5`);
      } else {
        reviewNeeded[artist] = {
          reason: distinctClean.length === 0 ? 'no clean results (all flagged as mix/compilation/live/long, or duplicates)' : `only ${distinctClean.length} distinct clean result(s), need 5`,
          candidates: results.map(r => ({ title: r.title, videoId: r.videoId, durationSec: durations[r.videoId] || null, suspect: (durations[r.videoId] || 0) > MAX_DURATION_SEC || SUSPECT_TITLE_RE.test(r.title) })),
        };
        console.log(`FLAG ${artist} -> only ${distinctClean.length} distinct clean candidates, sent to review-needed.json`);
      }

      // Save after every artist so an interrupted run doesn't lose progress.
      saveJSON(SONG_BANK_PATH, songBank);
      saveJSON(REVIEW_PATH, reviewNeeded);
    } catch (err) {
      if (err instanceof DailyQuotaExhaustedError) {
        console.log(`\nDaily search.list quota exhausted after ${processed} artist(s) this run. Stopping — run again after the daily reset to continue.`);
        break;
      }
      console.error(`ERROR ${artist}: ${err.message}`);
    }
    processed++;
    await sleep(400); // small pacing gap to avoid tripping the burst rate limit
  }

  console.log(`\nDone this run. Processed ${processed} artist(s).`);
  console.log(`song-bank.json now has ${Object.keys(songBank).length} artists.`);
  console.log(`review-needed.json has ${Object.keys(reviewNeeded).length} artists awaiting manual picks.`);
}

main();
