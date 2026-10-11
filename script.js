// ---------- Daten (werden im Browser/Handy gespeichert) ----------
const KEY = 'rezepte-v1';
let state = load();
let active = 'Alle';
let view = 'list';                 // 'list' = ganze Videos, 'tiles' = Kacheln
try { view = localStorage.getItem('rezepte-view') || 'list'; } catch (e) {}
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
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

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
    return { kind: 'youtube', id: m[1], short: /shorts\//i.test(url), title: '', note: '', author: '' };
  }
  if ((m = url.match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i))) {
    return { kind: 'instagram', id: (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2], title: '', note: '', author: '' };
  }
  return { kind: 'link', id: null, title: '', note: '', author: '' };
}
// info.id ist die Video-ID, gespeichert wird sie als "vid"

// 1 = anzeigen, 0 = ausblenden
const TT_PLAYER_OPTIONS = 'controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0';

function embedHTML(it) {
  if (it.kind === 'tiktok')
    // Foto-Beiträge (zum Wischen) brauchen das normale Embed, der schlanke Player kann nur Videos
    if (it.photo || /\/photo\//i.test(it.url))
      return `<div class="video"><iframe class="tt-photo" loading="lazy" allowfullscreen src="https://www.tiktok.com/embed/v2/${esc(it.vid)}"></iframe></div>`;
    // Schlanker TikTok-Player: nur Video + Play/Pause, ohne Profil, Likes, Kommentare, Beschreibung
    return `<div class="video"><iframe class="tt" loading="lazy" allowfullscreen allow="encrypted-media; fullscreen" src="https://www.tiktok.com/player/v1/${esc(it.vid)}?${TT_PLAYER_OPTIONS}"></iframe></div>`;
  if (it.kind === 'youtube')
    return `<div class="video"><iframe class="yt ${it.short ? 'short' : ''}" loading="lazy" allowfullscreen src="https://www.youtube.com/embed/${esc(it.vid)}"></iframe></div>`;
  if (it.kind === 'instagram')
    return `<div class="video"><iframe class="ig" loading="lazy" allowfullscreen src="https://www.instagram.com/${esc(it.vid)}/embed"></iframe></div>`;
  return `<a class="linkbtn" href="${esc(it.url)}" target="_blank" rel="noopener">🔗 Link öffnen</a>`;
}

// ---------- Rendering ----------
function render() {
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
  const items = state.items.filter(i => active === 'Alle' || i.tab === active);
  const list = document.getElementById('list');
  if (!items.length) {
    list.innerHTML = `<div class="empty">Noch nichts da. Füge oben einen Link ein 👆</div>`;
    return;
  }
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
          <div><small>Titel</small><br><input class="f-title" value="${esc(it.title)}"></div>
          <div><small>Notizen / Rezept</small><br><textarea class="f-note">${esc(it.note)}</textarea></div>
          <div class="row">
            <select class="f-tab">${state.tabs.map(t => `<option ${t === it.tab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
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
    const open = items.find(i => i.id === openId);
    list.innerHTML = `<div class="grid">${items.map(tileHTML).join('')}</div>` +
      (open ? `<div class="modal"><div class="modal-card"><button class="modal-close">✕ Schließen</button>${cardHTML(open)}</div></div>` : '');
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
    try { localStorage.setItem('rezepte-view', view); } catch (e) {}
    render();
  } else if (b.id === 'shareBtn') {
    const link = shareLink();
    try { await navigator.clipboard.writeText(link); toast('Link kopiert! Schick ihn z. B. per WhatsApp.'); }
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
document.getElementById('list').addEventListener('click', e => {
  const tile = e.target.closest('.tile');
  if (tile) { openId = tile.dataset.open; render(); return; }
  if (e.target.classList.contains('modal-close') || e.target.classList.contains('modal')) {
    openId = null; render(); return;
  }
  if (!e.target.classList.contains('f-del')) return;
  if (!confirm('Dieses Rezept löschen?')) return;
  const id = e.target.closest('.item').dataset.id;
  state.items = state.items.filter(i => i.id !== id);
  openId = null;
  save(); render();
});

// ---------- Teilen per Link (alle Daten stecken im Link, kein Server nötig) ----------
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(b64) {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function shareLink() {
  const data = { tabs: state.tabs, items: state.items.map(i => ({ url: i.url, kind: i.kind, vid: i.vid, short: i.short, photo: i.photo, title: i.title, author: i.author, note: i.note, tab: i.tab })) };
  return location.origin + location.pathname + '#d=' + toB64(JSON.stringify(data));
}
function importFromHash() {
  const m = location.hash.match(/^#d=(.+)$/);
  if (!m) return;
  try {
    const data = JSON.parse(fromB64(m[1]));
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
}

importFromHash();
render();
