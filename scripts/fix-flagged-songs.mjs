// Surgically replaces only the flagged-bad song slots for artists identified
// by the oEmbed channel audit (see scratchpad audit scripts), instead of
// re-fetching all 5 slots. Keeps any already-good songs in place.
//
// Usage:
//   node scripts/fix-flagged-songs.mjs --input <path-to-flagged-json> [--limit N] [--only "Artist A,Artist B"]
//
// <flagged-json> is a { "Artist Name": [videoId, ...] } map of bad video IDs
// to replace for that artist (built from the CSV audit).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
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
if (!API_KEY) { console.error('Missing YOUTUBE_API_KEY in .env'); process.exit(1); }

const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
const INPUT_PATH = inputIdx !== -1 ? args[inputIdx + 1] : null;
if (!INPUT_PATH) { console.error('Usage: --input <flagged.json>'); process.exit(1); }
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 90;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1].split(',').map(s => s.trim()) : null;

const SUSPECT_TITLE_RE = /\b(mix|compilation|full album|album|live|greatest hits|hour|hours|playlist|megamix|discography)\b/i;
const MAX_DURATION_SEC = 600;

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
function norm(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function channelMatchesArtist(channelTitle, artist) {
  const c = norm(channelTitle);
  const a = norm(artist);
  if (!c || !a) return false;
  return c.includes(a) || a.includes(c);
}
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
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class DailyQuotaExhaustedError extends Error {}
async function fetchWithRetry(url, { retries = 4, baseDelayMs = 3000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    const bodyText = await res.text();
    if (bodyText.includes('defaultSearchListPerDayPerProject') || bodyText.includes('PerDayPerProject')) {
      throw new DailyQuotaExhaustedError('Daily search.list quota exhausted.');
    }
    if (attempt >= retries) return { ok: false, status: 429, text: async () => bodyText };
    await sleep(baseDelayMs * 2 ** attempt);
  }
}
async function searchArtist(artist) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', artist);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '10');
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
  for (const it of json.items || []) out[it.id] = parseISODuration(it.contentDetails.duration);
  return out;
}
function loadJSON(p, fallback) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; }
function saveJSON(p, obj) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

async function main() {
  const flaggedMap = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
  const songBank = loadJSON(SONG_BANK_PATH, {});
  const reviewNeeded = loadJSON(REVIEW_PATH, {});

  let artists = Object.keys(flaggedMap);
  if (ONLY) artists = artists.filter(a => ONLY.includes(a));

  console.log(`Artists with flagged slots to fix: ${artists.length}`);

  let processed = 0;
  const summary = [];
  for (const artist of artists) {
    if (processed >= LIMIT) {
      console.log(`\nHit --limit ${LIMIT}. ${artists.length - processed} artists remain.`);
      break;
    }
    const current = songBank[artist];
    if (!current) { console.log(`SKIP ${artist}: not in song-bank.json`); processed++; continue; }

    const badVideoIds = new Set(flaggedMap[artist]);
    const badIndices = [];
    current.forEach((s, i) => { if (badVideoIds.has(s.videoId)) badIndices.push(i); });
    if (badIndices.length === 0) { console.log(`SKIP ${artist}: no matching bad slots found (already fixed?)`); processed++; continue; }

    const goodVideoIds = new Set(current.filter(s => !badVideoIds.has(s.videoId)).map(s => s.videoId));

    try {
      const results = await searchArtist(artist);
      const durations = await fetchDurations(results.map(r => r.videoId));

      const clean = results.filter(r => {
        const dur = durations[r.videoId] || 0;
        return dur > 0 && dur <= MAX_DURATION_SEC
          && !SUSPECT_TITLE_RE.test(r.title)
          && channelMatchesArtist(r.channelTitle, artist)
          && !goodVideoIds.has(r.videoId)
          && !badVideoIds.has(r.videoId);
      });

      const seenTitles = new Set(current.filter(s => !badVideoIds.has(s.videoId)).map(s => normalizeTitle(s.title, artist)));
      const distinctClean = [];
      for (const r of clean) {
        const key = normalizeTitle(r.title, artist);
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        distinctClean.push(r);
      }

      const needed = badIndices.length;
      if (distinctClean.length >= needed) {
        const replacements = distinctClean.slice(0, needed);
        badIndices.forEach((slotIdx, i) => {
          current[slotIdx] = { title: replacements[i].title, videoId: replacements[i].videoId };
        });
        console.log(`OK   ${artist} -> replaced ${needed} slot(s)`);
        summary.push({ artist, status: 'fixed', replaced: needed });
      } else if (distinctClean.length > 0) {
        // Partial: fill what we can, flag the rest.
        distinctClean.forEach((r, i) => {
          current[badIndices[i]] = { title: r.title, videoId: r.videoId };
        });
        const stillBad = badIndices.slice(distinctClean.length).map(i => current[i]);
        reviewNeeded[artist] = {
          reason: `${needed - distinctClean.length} slot(s) still need manual picks after auto-fix (only ${distinctClean.length} clean official-channel candidates found)`,
          candidates: results.map(r => ({ title: r.title, videoId: r.videoId, channelTitle: r.channelTitle })),
        };
        console.log(`PART ${artist} -> replaced ${distinctClean.length}/${needed}, ${needed - distinctClean.length} still bad, sent to review-needed.json`);
        summary.push({ artist, status: 'partial', replaced: distinctClean.length, stillBad: needed - distinctClean.length });
      } else {
        reviewNeeded[artist] = {
          reason: `${needed} slot(s) need manual picks (no clean official-channel candidates found via search)`,
          candidates: results.map(r => ({ title: r.title, videoId: r.videoId, channelTitle: r.channelTitle })),
        };
        console.log(`FAIL ${artist} -> 0 clean candidates, sent to review-needed.json`);
        summary.push({ artist, status: 'failed', replaced: 0 });
      }

      saveJSON(SONG_BANK_PATH, songBank);
      saveJSON(REVIEW_PATH, reviewNeeded);
    } catch (err) {
      if (err instanceof DailyQuotaExhaustedError) {
        console.log(`\nDaily quota exhausted after ${processed} artist(s) this run.`);
        break;
      }
      console.error(`ERROR ${artist}: ${err.message}`);
      summary.push({ artist, status: 'error', message: err.message });
    }
    processed++;
    await sleep(400);
  }

  console.log(`\nDone. Processed ${processed} artist(s) this run.`);
  writeFileSync(path.join(ROOT, 'scripts', '.last-fix-summary.json'), JSON.stringify(summary, null, 2));
}

main();
