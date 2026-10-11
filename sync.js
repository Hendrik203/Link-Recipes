// ===== Abgleich über eine Datei (recipes.json) im GitHub-Repository =====
// Läuft die Seite auf GitHub Pages (https://NAME.github.io/REPO/), liegen die Rezepte in der
// Datei recipes.json im selben Repository:
//   - Lesen darf jeder (die Seite holt sich die Datei beim Öffnen und alle paar Minuten neu).
//   - Schreiben geht nur mit einem GitHub-Token, der nur auf dem eigenen Gerät gespeichert wird.
// Auf anderen Adressen (z. B. lokal geöffnete Datei) läuft alles wie vorher nur im Browser.

const FILE = 'recipes.json';

const REPO = (() => {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = (first && !/\.html?$/i.test(first)) ? first : m[1] + '.github.io';
  return { owner: m[1], repo };
})();

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let token = LS.get('rezepte-token') || '';
let lastSha = null;        // Version der Datei auf GitHub, die wir zuletzt gesehen haben
let lastSynced = null;     // Inhalt der Datei beim letzten Abgleich (Vergleichsstand)
let dirty = false;         // es gibt Änderungen, die noch nicht auf GitHub sind
let pushing = false;
let localVersion = 0;      // zählt lokale Änderungen
let pushTimer = null;
let syncStatus = '';
try { lastSynced = JSON.parse(LS.get('rezepte-base')); } catch (e) { lastSynced = null; }

// Darf bearbeitet werden? (Ohne GitHub-Adresse immer, sonst nur mit Token)
function canEdit() { return !REPO || !!token; }
function idleStatus() { return token ? 'Synchronisiert ✓' : 'Nur ansehen'; }

// ---------- kleine Helfer ----------
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === 'object') {
    const o = {};
    Object.keys(x).sort().forEach(k => { o[k] = sortKeys(x[k]); });
    return o;
  }
  return x;
}
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

// Stand ohne Vorschaubilder (die laufen ab und werden pro Gerät neu geholt)
function snap(s) {
  return { tabs: [...s.tabs], items: s.items.map(i => { const { thumb, ...rest } = i; return rest; }) };
}
function normalize(d) {
  return {
    tabs: Array.isArray(d && d.tabs) ? d.tabs : [],
    items: Array.isArray(d && d.items) ? d.items.filter(i => i && i.id && i.url) : []
  };
}
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function authError(msg) { const e = new Error(msg); e.code = 'auth'; return e; }

// ---------- GitHub-Zugriff ----------
const apiUrl = () => `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${FILE}`;
function apiHeaders() {
  const h = { 'Accept': 'application/vnd.github+json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function fetchRemote() {
  const r = await fetch(apiUrl(), { headers: apiHeaders(), cache: 'no-cache' });
  if (r.status === 404) return { missing: true };
  if (r.status === 401) throw authError('Token ungültig');
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const j = await r.json();
  return { sha: j.sha, data: normalize(JSON.parse(b64ToUtf8(j.content || ''))) };
}

async function putRemote(data, sha) {
  const body = { message: 'Rezepte aktualisiert', content: utf8ToB64(JSON.stringify({ v: 1, ...data }, null, 1)) };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl(), {
    method: 'PUT',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (r.status === 401 || r.status === 403 || r.status === 404) throw authError('Keine Berechtigung (' + r.status + ')');
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const j = await r.json();
  return { sha: j.content.sha };
}

// ---------- Änderungen zusammenführen ----------
// base = Stand beim letzten Abgleich, local = unser aktueller Stand, remote = aktuelle Datei auf GitHub.
// Es werden nur MEINE Änderungen (neu, geändert, gelöscht) auf den GitHub-Stand angewendet,
// so gehen Änderungen von einem anderen Gerät nicht verloren.
function mergeChanges(base, local, remote) {
  const b = new Map(base.items.map(i => [i.id, i]));
  const l = new Map(local.items.map(i => [i.id, i]));
  const res = new Map(remote.items.map(i => [i.id, i]));
  const urls = new Set(remote.items.map(i => i.url));
  const added = [];

  for (const it of local.items) {
    const old = b.get(it.id);
    if (!old) {                                   // neu bei mir
      if (!urls.has(it.url)) { added.push(it); urls.add(it.url); }
    } else if (!same(old, it)) {                  // bei mir geändert
      if (res.has(it.id)) res.set(it.id, it);
    }
  }
  for (const id of b.keys()) if (!l.has(id)) res.delete(id);   // bei mir gelöscht

  const items = [...added, ...res.values()];
  const removedTabs = base.tabs.filter(t => !local.tabs.includes(t));
  const addedTabs = local.tabs.filter(t => !base.tabs.includes(t));
  const tabs = remote.tabs.filter(t => !removedTabs.includes(t));
  addedTabs.forEach(t => { if (!tabs.includes(t)) tabs.push(t); });
  items.forEach(i => { if (!tabs.includes(i.tab)) tabs.push(i.tab); });
  return { tabs, items };
}

// Stand von GitHub in die Seite übernehmen (Vorschaubilder dieses Geräts behalten)
function applyRemote(data) {
  const thumbs = new Map(state.items.filter(i => i.thumb).map(i => [i.id, i.thumb]));
  state = {
    tabs: data.tabs.length ? [...data.tabs] : state.tabs,
    items: data.items.map(i => thumbs.has(i.id) ? { ...i, thumb: thumbs.get(i.id) } : { ...i })
  };
  if (active !== 'Alle' && !state.tabs.includes(active)) active = 'Alle';
  openId = null;
  saveLocal();
}

// ---------- Speichern ----------
// Wird von save() in script.js nach jeder Änderung aufgerufen
function onLocalChange() {
  if (!REPO || !token) return;
  if (!dirty && lastSynced && same(snap(state), lastSynced)) return;   // z. B. nur ein Vorschaubild
  localVersion++;
  dirty = true;
  LS.set('rezepte-dirty', '1');
  setStatus('Änderungen werden gespeichert…');
  schedulePush(1500);
}
function schedulePush(ms) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, ms);
}

async function pushNow() {
  if (!REPO || !token) return;
  if (pushing) { schedulePush(800); return; }
  pushing = true;
  setStatus('Speichere…');
  const version = localVersion;
  const startSnap = snap(state);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rem = await fetchRemote();
      const base = lastSynced || { tabs: [], items: [] };
      const out = rem.missing ? startSnap : mergeChanges(base, startSnap, rem.data);
      if (!rem.missing && same(out, rem.data)) {      // nichts zu speichern
        lastSha = rem.sha;
        finishPush(version, startSnap, rem.data);
        return;
      }
      const res = await putRemote(out, rem.missing ? null : rem.sha);
      if (res.conflict) continue;                      // jemand war schneller: nochmal mit neuem Stand
      lastSha = res.sha;
      finishPush(version, startSnap, out);
      return;
    }
    throw new Error('Konflikt – bitte später nochmal');
  } catch (e) {
    handleSyncError(e);
  } finally {
    pushing = false;
  }
}

function finishPush(version, startSnap, out) {
  LS.set('rezepte-migrated', '1');
  if (localVersion === version) {
    // währenddessen nichts geändert: den Stand von GitHub übernehmen
    lastSynced = out;
    LS.set('rezepte-base', JSON.stringify(out));
    dirty = false;
    LS.del('rezepte-dirty');
    if (!same(out, snap(state))) { applyRemote(out); render(); }
    setStatus('Gespeichert ✓');
  } else {
    // währenddessen weiter bearbeitet: nochmal speichern
    lastSynced = startSnap;
    LS.set('rezepte-base', JSON.stringify(startSnap));
    dirty = true;
    schedulePush(500);
  }
}

// ---------- Neues von GitHub holen ----------
async function refreshFromRemote() {
  if (!REPO || pushing || dirty) return;
  const a = document.activeElement;
  // nicht stören, während gerade in ein Feld getippt wird (Suche ausgenommen)
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'searchInput') return;
  try {
    const rem = await fetchRemote();
    if (rem.missing) { setStatus(idleStatus()); return; }
    if (rem.sha === lastSha) { setStatus(idleStatus()); return; }
    lastSha = rem.sha;
    lastSynced = rem.data;
    LS.set('rezepte-base', JSON.stringify(rem.data));
    if (!same(snap(state), rem.data)) { applyRemote(rem.data); render(); }
    setStatus(idleStatus());
  } catch (e) {
    handleSyncError(e);
  }
}

function handleSyncError(e) {
  if (e && e.code === 'auth') {
    if (token) {
      clearToken();
      toast('Der Token funktioniert nicht oder darf nicht ins Repository schreiben.');
    }
    setStatus(idleStatus());
    renderSyncBar();
    render();
    return;
  }
  setStatus('Keine Verbindung zu GitHub' + (e && e.message ? ' (' + e.message + ')' : ''));
}

// ---------- Anzeige oben ----------
function setStatus(msg) {
  syncStatus = msg;
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = msg;
}
function renderSyncBar() {
  const el = document.getElementById('syncbar');
  if (!el) return;
  if (!REPO) { el.innerHTML = ''; return; }
  el.innerHTML = `<span id="syncStatus">${esc(syncStatus)}</span> ` +
    (token ? `<button id="lockBtn">Abmelden</button>` : `<button id="unlockBtn">🔑 Bearbeiten freischalten</button>`);
}

function clearToken() {
  token = '';
  LS.del('rezepte-token');
  dirty = false;
  LS.del('rezepte-dirty');
}

async function unlock() {
  const t = (prompt('GitHub-Token einfügen (wird nur auf diesem Gerät gespeichert):') || '').trim();
  if (!t) return;
  token = t;
  LS.set('rezepte-token', t);
  LS.del('rezepte-migrated');
  lastSynced = null;                   // erste Übertragung: vorhandene Rezepte dieses Geräts hochladen
  dirty = true;
  renderSyncBar();
  render();
  await pushNow();
}
function lock() {
  if (!confirm('Auf diesem Gerät abmelden? Danach kannst du hier nur noch ansehen.')) return;
  clearToken();
  setStatus(idleStatus());
  renderSyncBar();
  render();
  refreshFromRemote();
}

async function initSync() {
  renderSyncBar();
  if (!REPO) return;
  document.getElementById('syncbar').addEventListener('click', e => {
    if (e.target.id === 'unlockBtn') unlock();
    if (e.target.id === 'lockBtn') lock();
  });
  setStatus('Lade…');
  const needsPush = token && (LS.get('rezepte-dirty') === '1' || LS.get('rezepte-migrated') !== '1');
  if (needsPush) { dirty = true; await pushNow(); }
  else await refreshFromRemote();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromRemote();
  });
  setInterval(() => { if (document.visibilityState === 'visible') refreshFromRemote(); }, 120000);
}
