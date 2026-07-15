const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

let versionPromise = null;
export function getLatestVersion() {
  if (!versionPromise) {
    versionPromise = fetch(`${DDRAGON_BASE}/api/versions.json`)
      .then(res => res.json())
      .then(versions => versions[0])
      // Clear the cache on failure so a later retry actually re-fetches
      // instead of replaying the same rejected promise forever.
      .catch(err => { versionPromise = null; throw err; });
  }
  return versionPromise;
}

let rosterPromise = null;
// Live champion.json, not a static list, so newly-released champions show up
// without a code change as long as they also have an entry in data/champions.js.
export function getRoster() {
  if (!rosterPromise) {
    rosterPromise = getLatestVersion()
      .then(async version => {
        const res = await fetch(`${DDRAGON_BASE}/cdn/${version}/data/en_US/champion.json`);
        const json = await res.json();
        return Object.values(json.data)
          .map(c => ({ id: c.id, name: c.name, title: c.title, iconFull: c.image.full }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch(err => { rosterPromise = null; throw err; });
  }
  return rosterPromise;
}

export function championIconUrl(version, iconFull) {
  return `${DDRAGON_BASE}/cdn/${version}/img/champion/${iconFull}`;
}

export function championSplashUrl(championId, skinNum = 0) {
  return `${DDRAGON_BASE}/cdn/img/champion/splash/${championId}_${skinNum}.jpg`;
}
