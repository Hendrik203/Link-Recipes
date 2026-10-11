// ---------- Daten (werden im Browser/Handy gespeichert) ----------
// Ohne sync.js (reine Browser-Version): immer bearbeiten, kein Abgleich über GitHub
if (typeof canEdit === 'undefined') { var canEdit = () => true; }

// Alle Seiten unter demselben NAME.github.io teilen sich den Browser-Speicher. Damit eine zweite
// Rezepte-Seite (ohne sync.js) nicht dieselben Rezepte zeigt, bekommt sie einen eigenen Speicherplatz
// pro Repository-Namen. Die Sync-Version behält den bisherigen Speicherplatz (deine Rezepte bleiben).
const SCOPE = (typeof REPO !== 'undefined' && REPO) ? '' : '-lokal-' + (location.pathname.split('/').filter(Boolean)[0] || 'root');
const KEY = 'rezepte-v1' + SCOPE;
const VIEW_KEY = 'rezepte-view' + SCOPE;
let state = load();
let active = 'Alle';
let view = 'list';                 // 'list' = ganze Videos, 'tiles' = Kacheln
try { view = localStorage.getItem(VIEW_KEY) || 'list'; } catch (e) {}
let openId = null;                 // Rezept, das in der Kachel-Ansicht gerade geöffnet ist

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.tabs) && Array.isArray(s.items)) {
      // Alte Einträge mit riesigem Titel kürzen
      s.items.forEach(i => {
        if (i.title && i.title.length > 80) i.title = shortTitle(i.title);
      });
      return s;
    }
  } catch (e) {}
  return { tabs: ['Hauptgerichte', 'Snacks', 'Süßes'], items: [] };
}
function saveLocal() { localStorage.setItem(KEY, JSON.stringify(state)); }
// Nach jeder Änderung: im Browser speichern und (falls freigeschaltet) in die Datei auf GitHub (sync.js)
function save() {
  saveLocal();
  if (typeof onLocalChange === 'function') onLocalChange();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3000);
}

// Aus der langen TikTok-Beschreibung einen kurzen Titel machen
function shortTitle(text) {
  let t = String(text || '').split('#')[0].trim();
  const emoji = t.search(/\p{Extended_Pictographic}/u);   // meist steht der Name vor dem ersten Emoji
  if (emoji >= 3) t = t.slice(0, emoji).trim();
  else {
    const sentence = t.search(/[.!?]\s/);
    if (sentence > 3) t = t.slice(0, sentence).trim();
  }
  if (t.length > 60) t = t.slice(0, 57).trim() + '…';
  return t;
}

// ---------- Link analysieren ----------
async function analyze(url) {
  let m;
  if (/tiktok\.com/i.test(url)) {
    const info = { kind: 'tiktok', id: null, title: '', note: '', author: '' };
    info.photo = /\/photo\//i.test(url);   // Foto-Beiträge zum Wischen
    m = url.match(/\/(?:video|photo)\/(\d+)/);
    if (m) info.id = m[1];
    // TikTok oEmbed: liefert Beschreibung, Autor, Vorschaubild und auch bei Kurzlinks die Video-ID
    const j = await tiktokOembed(url);
    if (j) {
      info.title = shortTitle(j.title);       // kurzer Titel für die Überschrift (Notizen bleiben frei)
      info.author = j.author_name || '';
      info.thumb = j.thumbnail_url || '';
      // Auch bei Kurzlinks erkennen, ob es ein Foto-Beitrag ist
      if (/\/photo\//i.test(j.html || '') || /photo/i.test(j.embed_type || '')) info.photo = true;
      const mm = (j.html || '').match(/data-video-id="(\d+)"/);
      if (mm) info.id = mm[1];
    }
    if (!info.title) info.title = 'TikTok-Beitrag';   // Titel kann man später selbst ändern
    if (!info.id) info.kind = 'link';
    return info;
  }
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i))) {
    return { kind: 'youtube', id: m[1], short: /shorts\//i.test(url), title: 'YouTube-Video', note: '', author: '' };
  }
  if ((m = url.match(/instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i))) {
    return { kind: 'instagram', id: (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2], title: 'Instagram-Beitrag', note: '', author: '' };
  }
  if ((m = url.match(/pinterest\.[a-z.]+\/pin\/(\d+)/i))) {
    return { kind: 'pinterest', id: m[1], title: 'Pinterest-Pin', note: '', author: '' };
  }
  if (/pin\.it\//i.test(url) || /pinterest\./i.test(url))
    return { kind: 'link', id: null, title: 'Pinterest-Link', note: '', author: '' };
  return { kind: 'link', id: null, title: '', note: '', author: '' };
}
// info.id ist die Video-ID, gespeichert wird sie als "vid"

// 1 = anzeigen, 0 = ausblenden
const TT_PLAYER_OPTIONS = 'controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0';

function embedHTML(it) {
  // Kleiner Link unter Instagram/Pinterest, falls die Einbettung bei einem Beitrag nicht angezeigt wird
  const openLink = `<a class="embedlink" href="${esc(it.url)}" target="_blank" rel="noopener">Wird nichts angezeigt? Link öffnen ↗</a>`;

  if (it.kind === 'tiktok') {
    // Foto-Beiträge (zum Wischen) brauchen das normale Embed, der schlanke Player kann nur Videos
    if (it.photo || /\/photo\//i.test(it.url))
      return `<div class="video"><iframe class="tt-photo" loading="lazy" allowfullscreen src="https://www.tiktok.com/embed/v2/${esc(it.vid)}"></iframe></div>`;
    // Schlanker TikTok-Player: nur Video + Play/Pause, ohne Profil, Likes, Kommentare, Beschreibung
    return `<div class="video"><iframe class="tt" loading="lazy" allowfullscreen allow="encrypted-media; fullscreen" src="https://www.tiktok.com/player/v1/${esc(it.vid)}?${TT_PLAYER_OPTIONS}"></iframe></div>`;
  }
  if (it.kind === 'youtube')
    return `<div class="video"><iframe class="yt ${it.short ? 'short' : ''}" loading="lazy" allowfullscreen src="https://www.youtube.com/embed/${esc(it.vid)}"></iframe></div>`;
  if (it.kind === 'instagram')
    return `<div class="video"><iframe class="ig" loading="lazy" allowfullscreen src="https://www.instagram.com/${esc(it.vid)}/embed"></iframe></div>${openLink}`;
  if (it.kind === 'pinterest')
    return `<div class="video"><iframe class="pin" loading="lazy" src="https://assets.pinterest.com/ext/embed.html?id=${esc(it.vid)}"></iframe></div>${openLink}`;
  return `<a class="linkbtn" href="${esc(it.url)}" target="_blank" rel="noopener">🔗 Link öffnen</a>`;
}

// ---------- Rendering ----------
function render() {
  // Ohne Freischaltung (z. B. bei Mama) nur ansehen: Eingabe- und Bearbeiten-Knöpfe werden ausgeblendet
  document.body.classList.toggle('readonly', !canEdit());
  // Dropdown zum Hinzufügen
  const sel = document.getElementById('tabSelect');
  const keep = sel.value;
  sel.innerHTML = state.tabs.map(t => `<option>${esc(t)}</option>`).join('');
  sel.value = (active !== 'Alle' && state.tabs.includes(active)) ? active : (state.tabs.includes(keep) ? keep : state.tabs[0]);

  // Tabs
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = ['Alle', ...state.tabs].map(t =>
    `<button class="tab ${t === active ? 'active' : ''}" data-tab="${esc(t)}">${esc(t)}${t === 'Alle' ? ' (' + state.items.length + ')' : ' (' + state.items.filter(i => i.tab === t).length + ')'}</button>`
  ).join('') + `<button class="tab" id="newTab">＋</button>`;

  // Tab-Werkzeuge
  const tools = document.getElementById('tabtools');
  tools.innerHTML = active === 'Alle'
    ? `<button id="shareBtn">📤 Sammlung teilen (Link kopieren)</button>`
    : `<button id="renameTab">✏️ Umbenennen</button><button id="deleteTab" class="danger">🗑 Tab löschen</button><button id="shareBtn">📤 Sammlung teilen</button>`;

  tools.insertAdjacentHTML('afterbegin', `<button id="viewBtn">${view === 'list' ? '▦ Kachel-Ansicht' : '☰ Listen-Ansicht'}</button>`);

  // Liste
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const items = state.items.filter(i =>
    (active === 'Alle' || i.tab === active) &&
    (!q || [i.title, i.note, i.author, i.tab].join(' ').toLowerCase().includes(q))
  );
  const list = document.getElementById('list');
  if (!items.length) {
    list.innerHTML = q
      ? `<div class="empty">Nichts gefunden für „${esc(q)}" 🤷</div>`
      : `<div class="empty">${canEdit() ? 'Noch nichts da. Füge oben einen Link ein 👆' : 'Hier gibt es noch keine Rezepte.'}</div>`;
    return;
  }
  const ro = canEdit() ? '' : 'readonly';
  const dis = canEdit() ? '' : 'disabled';
  const cardHTML = it => `
    <div class="item" data-id="${it.id}">
      <h2>${esc(it.title || 'Ohne Titel')}</h2>
      <span class="badge">${esc(it.tab)}</span>
      ${embedHTML(it)}
      <details>
        <summary>Infos &amp; Link</summary>
        <div class="info">
          <div><small>Link</small><br><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a></div>
          ${it.author ? `<div><small>Von</small><br>${esc(it.author)}</div>` : ''}
          <div><small>Titel</small><br><input class="f-title" value="${esc(it.title)}" ${ro}></div>
          <div><small>Notizen / Rezept</small><br><textarea class="f-note" ${ro}>${esc(it.note)}</textarea></div>
          <div class="row">
            <select class="f-tab" ${dis}>${state.tabs.map(t => `<option ${t === it.tab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
            <button class="f-del danger">Löschen</button>
          </div>
        </div>
      </details>
    </div>`;

  const tileHTML = it => {
    const src = it.thumb || (it.kind === 'youtube' ? `https://img.youtube.com/vi/${it.vid}/hqdefault.jpg` : '');
    return `<div class="tile" data-open="${it.id}">
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();refreshThumb('${it.id}')">` : ''}
      <div class="tile-title">${esc(it.title || 'Ohne Titel')}</div>
    </div>`;
  };

  if (view === 'tiles') {
    list.innerHTML = `<div class="grid">${items.map(tileHTML).join('')}</div>`;
    // Fehlende Vorschaubilder nachladen
    state.items.forEach(i => { if (i.kind === 'tiktok' && !i.thumb) refreshThumb(i.id); });
  } else {
    list.innerHTML = items.map(cardHTML).join('');
  }
}

// Vorschaubild (nochmal) von TikTok holen – die Bild-Links laufen nach einiger Zeit ab
const thumbTried = new Set();
async function refreshThumb(id) {
  if (thumbTried.has(id)) return;
  thumbTried.add(id);
  const it = state.items.find(i => i.id === id);
  if (!it || it.kind !== 'tiktok') return;
  const j = await tiktokOembed(it.url);
  if (j && j.thumbnail_url) { it.thumb = j.thumbnail_url; save(); render(); }
}

// Fragt TikTok nach Infos zu einem Link. Bei Foto-Beiträgen wird zusätzlich
// die Video-Schreibweise des Links probiert, falls TikTok die Foto-Variante ablehnt.
async function tiktokOembed(url) {
  const variants = [url];
  if (/\/photo\//i.test(url)) variants.push(url.replace(/\/photo\//i, '/video/'));
  for (const u of variants) {
    try {
      const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(u));
      if (r.ok) {
        const j = await r.json();
        if (j && (j.title || j.thumbnail_url || j.html)) return j;
      }
    } catch (e) {}
  }
  return null;
}

// ---------- Events ----------
document.getElementById('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('urlInput');
  const url = input.value.trim();
  if (!url) return;
  if (state.items.some(i => i.url === url)) { toast('Den Link gibt es schon.'); return; }
  const btn = document.getElementById('addBtn');
  btn.disabled = true; btn.textContent = 'Lade…';
  const info = await analyze(url);
  if (info.kind === 'link' && /tiktok\.com/i.test(url))
    toast('TikTok-Video konnte nicht eingebettet werden – als Link gespeichert. Probier den langen Link (aus dem Browser).');
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch (e) {}
  state.items.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url, kind: info.kind, vid: info.id, short: info.short || false, photo: info.photo || false, thumb: info.thumb || '',
    title: info.title || hostname, author: info.author, note: info.note || '',
    tab: document.getElementById('tabSelect').value || state.tabs[0]
  });
  save(); input.value = '';
  btn.disabled = false; btn.textContent = 'Hinzufügen';
  render();
});

// Suche: filtert Titel, Notizen und Autor im gerade gewählten Reiter
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { openId = null; render(); }, 200);
});

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'newTab') {
    const name = (prompt('Name des neuen Tabs:') || '').trim();
    if (!name) return;
    if (name === 'Alle' || state.tabs.includes(name)) return toast('Den Namen gibt es schon.');
    state.tabs.push(name); active = name; save(); render();
  } else if (b.dataset.tab) { active = b.dataset.tab; openId = null; render(); }
});

document.getElementById('tabtools').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'renameTab') {
    const name = (prompt('Neuer Name:', active) || '').trim();
    if (!name || name === active) return;
    if (name === 'Alle' || state.tabs.includes(name)) return toast('Den Namen gibt es schon.');
    state.tabs = state.tabs.map(t => t === active ? name : t);
    state.items.forEach(i => { if (i.tab === active) i.tab = name; });
    active = name; save(); render();
  } else if (b.id === 'deleteTab') {
    if (!confirm(`Tab "${active}" löschen? Die Rezepte wandern nach "Sonstiges".`)) return;
    const used = state.items.some(i => i.tab === active);
    state.tabs = state.tabs.filter(t => t !== active);
    if (used) {
      if (!state.tabs.includes('Sonstiges')) state.tabs.push('Sonstiges');
      state.items.forEach(i => { if (i.tab === active) i.tab = 'Sonstiges'; });
    }
    active = 'Alle'; save(); render();
  } else if (b.id === 'viewBtn') {
    view = view === 'list' ? 'tiles' : 'list';
    openId = null;
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
    render();
  } else if (b.id === 'shareBtn') {
    const link = await shareLink();
    try { await navigator.clipboard.writeText(link); toast(`Link kopiert (${link.length} Zeichen). Schick ihn z. B. per WhatsApp.`); }
    catch (err) { prompt('Link kopieren:', link); }
  }
});

document.getElementById('list').addEventListener('input', e => {
  const card = e.target.closest('.item'); if (!card) return;
  const it = state.items.find(i => i.id === card.dataset.id);
  if (!it) return;
  if (e.target.classList.contains('f-note')) it.note = e.target.value;
  if (e.target.classList.contains('f-title')) it.title = e.target.value;
  save();
});
document.getElementById('list').addEventListener('change', e => {
  const card = e.target.closest('.item'); if (!card) return;
  const it = state.items.find(i => i.id === card.dataset.id);
  if (it && e.target.classList.contains('f-tab')) { it.tab = e.target.value; save(); render(); }
});
// Kachel angetippt: zur Listen-Ansicht wechseln und direkt zu diesem Rezept springen.
// (Die Einstellung wird nicht gespeichert – beim nächsten Öffnen ist wieder die Kachel-Ansicht da.)
function showRecipe(id) {
  view = 'list';
  render();
  const el = document.querySelector(`.item[data-id="${id}"]`);
  if (!el) return;
  const d = el.querySelector('details');
  if (d) d.open = true;                       // Infos gleich aufklappen (zum Umbenennen)
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
}

document.getElementById('list').addEventListener('click', e => {
  const tile = e.target.closest('.tile');
  if (tile) { showRecipe(tile.dataset.open); return; }
  if (!e.target.classList.contains('f-del')) return;
  if (!confirm('Dieses Rezept löschen?')) return;
  const id = e.target.closest('.item').dataset.id;
  state.items = state.items.filter(i => i.id !== id);
  openId = null;
  save(); render();
});

// ---------- Teilen per Link (alle Daten stecken im Link, kein Server nötig) ----------
// Der Link ist so klein wie möglich: Tracking-Teile der Adressen fallen weg,
// nur das Nötigste wird gespeichert und das Ganze wird zusätzlich komprimiert.

function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64ToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function runStream(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// Adresse kürzen: bei TikTok/Instagram den Tracking-Teil nach "?" und das "https://" weglassen
function shortUrl(u) {
  if (/(tiktok|instagram|pinterest)\./i.test(u)) u = u.split('?')[0];
  return u.replace(/^https?:\/\//i, '');
}
function longUrl(u) { return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

// Alles, was sich ohne Internet direkt aus der Adresse ablesen lässt
function detectSync(url) {
  let m;
  if (/tiktok\.com/i.test(url)) {
    m = url.match(/\/(?:video|photo)\/(\d+)/);
    return { kind: 'tiktok', vid: m ? m[1] : null, photo: /\/photo\//i.test(url), short: false };
  }
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i)))
    return { kind: 'youtube', vid: m[1], photo: false, short: /shorts\//i.test(url) };
  if ((m = url.match(/instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i)))
    return { kind: 'instagram', vid: (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2], photo: false, short: false };
  if ((m = url.match(/pinterest\.[a-z.]+\/pin\/(\d+)/i)))
    return { kind: 'pinterest', vid: m[1], photo: false, short: false };
  return { kind: 'link', vid: null, photo: false, short: false };
}

async function shareLink() {
  const rows = state.items.map(i => {
    const d = detectSync(i.url);
    const row = [
      shortUrl(i.url), i.title || '', i.note || '', state.tabs.indexOf(i.tab),
      (i.vid && i.vid !== d.vid) ? i.vid : '',     // nur wenn die ID nicht in der Adresse steckt (Kurzlinks)
      (i.photo && !d.photo) ? 1 : 0
    ];
    while (row.length > 4 && !row[row.length - 1]) row.pop();
    return row;
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ t: state.tabs, i: rows }));
  const base = location.origin + location.pathname;
  if (canCompress) {
    try { return base + '#z=' + bytesToB64(await runStream(bytes, new CompressionStream('deflate-raw'))); } catch (e) {}
  }
  return base + '#u=' + bytesToB64(bytes);
}

// Kompaktes Format wieder in normale Rezepte umwandeln
function expand(d) {
  const tabs = d.t || [];
  return {
    tabs,
    items: (d.i || []).map(([u, title, note, ti, vid, photo]) => {
      const url = longUrl(u);
      const det = detectSync(url);
      const v = vid || det.vid;
      return {
        url, vid: v, short: det.short, photo: !!photo || det.photo,
        kind: (det.kind === 'tiktok' && !v) ? 'link' : det.kind,
        title: title || '', author: '', note: note || '',
        tab: tabs[ti] || tabs[0] || 'Sonstiges'
      };
    })
  };
}

async function importFromHash() {
  const m = location.hash.match(/^#([zud])=(.+)$/);
  if (!m) return false;
  if (!canEdit()) {                       // nur ansehen: die Rezepte kommen aus der Datei auf GitHub
    history.replaceState(null, '', location.pathname);
    return false;
  }
  try {
    let data;
    if (m[1] === 'd') {
      // altes Link-Format (aus früheren Versionen)
      data = JSON.parse(new TextDecoder().decode(b64ToBytes(m[2])));
    } else {
      let bytes = b64ToBytes(m[2]);
      if (m[1] === 'z') bytes = await runStream(bytes, new DecompressionStream('deflate-raw'));
      data = expand(JSON.parse(new TextDecoder().decode(bytes)));
    }
    let added = 0;
    (data.tabs || []).forEach(t => { if (!state.tabs.includes(t)) state.tabs.push(t); });
    (data.items || []).forEach(i => {
      if (!i.url || state.items.some(x => x.url === i.url)) return;
      if (!state.tabs.includes(i.tab)) state.tabs.push(i.tab);
      state.items.push({ ...i, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }); added++;
    });
    save();
    toast(added ? `${added} Rezept(e) übernommen 🎉` : 'Alles schon vorhanden.');
  } catch (e) { toast('Der geteilte Link ist kaputt.'); }
  history.replaceState(null, '', location.pathname);
  return true;
}

// ---------- Nach-oben-Knopf (erscheint, sobald man ein Stück nach unten gescrollt hat) ----------
const toTopBtn = document.getElementById('toTop');
if (toTopBtn) {
  window.addEventListener('scroll', () => toTopBtn.classList.toggle('show', window.scrollY > 500), { passive: true });
  toTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

render();
importFromHash().then(imported => { if (imported) render(); }).then(() => { if (typeof initSync === 'function') initSync(); });
