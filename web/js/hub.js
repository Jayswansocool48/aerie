// The hub: quick controls, today, stats, clipboard history, apps, wallpapers and power,
// in a panel that drops down from the top of the screen (Super+D).
import { api, normalizeConfig, STANDALONE } from './config.js';
import { allWallpapers, currentKey, KIND_ICON, KIND_LABEL, patchConfig, placeholderStyle, sourceLabel } from './catalog.js';
import { fmtBytes, fmtRate, fmtUptime, h, icon } from './icons.js';

const TABS = [
  ['controls', 'Controls', '操作'], ['today', 'Today', '今日'], ['stats', 'Stats', '統計'], ['clipboard', 'Clipboard', 'クリップボード'],
  ['apps', 'Apps', 'アプリ'], ['wallpaper', 'Wallpaper', '壁紙'], ['power', 'Power', '電源'],
];
const $ = s => document.querySelector(s);
const body = $('#body');
let cfg = null;
let tab = 'controls';
let timers = [];
const post = msg => { try { window.webkit.messageHandlers.aerie.postMessage(msg); } catch { /* opened in a browser */ } };

// ---- frame ---------------------------------------------------------------------------------
$('#studio').innerHTML = icon('sliders');
$('#close').innerHTML = icon('close');
$('#studio').addEventListener('click', () => { post({ type: 'studio', page: tab === 'wallpaper' ? 'library' : null }); if (STANDALONE || !window.webkit) location.href = 'studio.html' + location.hash; });
$('#close').addEventListener('click', close);
$('#backdrop').addEventListener('pointerdown', close);
addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  if (e.ctrlKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); show(TABS[+e.key - 1][0]); }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const i = TABS.findIndex(t => t[0] === tab); show(TABS[(i + (e.shiftKey ? 6 : 1)) % 7][0]); }
});

function renderTabs() {
  const nav = $('#tabs');
  nav.replaceChildren(...visibleTabs().map(([key, label]) => h('button.pill', {
    role: 'tab', 'aria-selected': String(key === tab), tabindex: key === tab ? 0 : -1, onclick: () => show(key),
    onkeydown: e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const vis = visibleTabs(), i = vis.findIndex(t => t[0] === tab);
      show(vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length][0]);
      nav.querySelector('[aria-selected="true"]')?.focus();
    },
  }, label)));
}

function visibleTabs() {
  const want = cfg?.general.hub?.tabs;
  return TABS.filter(([k]) => !want || want.includes(k));
}

function show(key) {
  tab = key;
  for (const t of timers) clearInterval(t);
  timers = [];
  renderTabs();
  $('#kana').textContent = TABS.find(t => t[0] === key)[2];
  body.replaceChildren();
  ({ controls, today, stats, clipboard, apps, wallpaper, power })[key]();
  try { localStorage.setItem('aerie-hub-tab', key); } catch { /* not kept */ }
}

function every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function close() {
  document.body.classList.remove('open');
  document.body.classList.add('closing');
  for (const t of timers) clearInterval(t);
  timers = [];
  post({ type: 'close' });
}

window.hub = {
  async open(which) {
    cfg = normalizeConfig(await api.loadConfig());
    document.body.classList.remove('closing');
    let last = null;
    try { last = localStorage.getItem('aerie-hub-tab'); } catch { /* not kept */ }
    show(which || (TABS.some(t => t[0] === last) ? last : 'controls'));
    requestAnimationFrame(() => document.body.classList.add('open'));
    setTimeout(() => (body.querySelector('[autofocus]') || $('#tabs [aria-selected="true"]'))?.focus(), 60);
  },
  closing() { document.body.classList.remove('open'); document.body.classList.add('closing'); },
};
window.aeriePage = { async configChanged() { cfg = normalizeConfig(await api.loadConfig()); } };

// ---- Controls ------------------------------------------------------------------------------
function controls() {
  const tiles = h('div.tiles');
  const sliders = h('div.side');
  const media = h('div.media');
  body.append(h('div.controls', {}, h('div.side', {}, tiles, sliders), h('div.side', {}, media)));
  let busy = false;
  const tile = (name, label, sub, on, ico, offIco) => h('button.tile', {
    'aria-pressed': String(!!on), onclick: async () => {
      if (busy) return;
      busy = true;
      try { paint(await api.setControl(name, !on)); } catch (e) { toast(e.message); }
      busy = false;
    },
  }, h('span.ti', { html: icon(on || !offIco ? ico : offIco) }), h('span', {}, h('b', {}, label), h('small', {}, sub)));

  function paint(s) {
    if (!s) return;
    const t = [];
    if (s.wifi) t.push(tile('wifi', 'Wi-Fi', s.wifi.on ? (s.wifi.name || 'On') : 'Off', s.wifi.on, 'wifi', 'wifiOff'));
    if (s.bluetooth) t.push(tile('bluetooth', 'Bluetooth', s.bluetooth.on ? (s.bluetooth.name || 'On') : 'Off', s.bluetooth.on, 'bluetooth'));
    if (s.audio) t.push(tile('mute', 'Sound', s.audio.muted ? 'Muted' : (s.audio.name || 'On'), !s.audio.muted, 'speaker', 'mute'));
    t.push(tile('dnd', 'Do not disturb', s.dnd ? 'On — no pop-ups' : 'Off', s.dnd, 'bellOff', 'bell'));
    if (s.dark !== null && s.dark !== undefined) t.push(tile('dark', 'Dark mode', s.dark ? 'On' : 'Off', s.dark, 'moon', 'sun'));
    tiles.replaceChildren(...t);
    const rows = [];
    if (s.audio) rows.push(slider('volume', s.audio.volume, s.audio.muted ? 'mute' : 'speaker', 'Volume', 150));
    if (s.brightness) rows.push(slider('brightness', s.brightness.value, 'sun', 'Brightness', 100));
    if (!rows.length && !s.wifi && !s.audio) rows.push(h('p.muted.small', {}, 'Wi-Fi, sound and brightness controls appear here on Pop!_OS.'));
    if (!sliders.contains(document.activeElement)) sliders.replaceChildren(...rows);
  }

  function slider(name, value, ico, label, max) {
    const out = h('output', {}, value + '%');
    const input = h('input.slider', { type: 'range', min: name === 'brightness' ? 1 : 0, max, value, 'aria-label': label });
    const fill = () => { input.style.setProperty('--fill', (input.value / max * 100) + '%'); out.textContent = input.value + '%'; };
    fill();
    let t;
    input.addEventListener('input', () => { fill(); clearTimeout(t); t = setTimeout(() => api.setControl(name, +input.value).catch(() => null), 80); });
    return h('label.slider-row', {}, h('span', { html: icon(ico) }), input, out);
  }

  async function player() {
    const np = await api.nowPlaying();
    media.classList.toggle('playing', !!np?.playing);
    if (!np?.active) {
      media.replaceChildren(h('div.art', { html: icon('music') }), h('div', {}, h('h3', {}, 'Nothing playing'), h('div.who', {}, 'Music and videos you play show up here.')));
      return;
    }
    const art = np.hasArt ? h('img.art', { src: '/now-playing-art?t=' + encodeURIComponent(np.title), alt: '' }) : h('div.art', { html: icon('music') });
    const btn = (action, ico, label, cls = 'icon-btn') => h('button.' + cls, { 'aria-label': label, html: icon(ico), onclick: async () => { await api.playerControl(action); setTimeout(player, 250); } });
    media.replaceChildren(art, h('div', { style: { minWidth: 0 } },
      h('div.small.muted', {}, np.player || ''), h('h3', {}, np.title), h('div.who', {}, np.artist || np.album || ''),
      h('div.ctrl', {}, btn('previous', 'prev', 'Previous'), btn('play-pause', np.playing ? 'pause' : 'play', np.playing ? 'Pause' : 'Play', 'play'), btn('next', 'next', 'Next'),
        h('div.wave', { 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: { animationDelay: `${(i * 0.13) % 1}s` } }))))));
  }

  every(3000, async () => paint(await api.controls()));
  every(2500, player);
}

// ---- Today -----------------------------------------------------------------------------------
let focus = { total: 25 * 60, left: 25 * 60, running: false, at: 0 };
function today() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = h('div.week', {}, ...Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return h('div.day' + (d.toDateString() === now.toDateString() ? '.now' : ''), {}, h('small', {}, d.toLocaleDateString(undefined, { weekday: 'short' })), h('b', {}, d.getDate()));
  }));
  const clock = h('div.bigclock');
  const date = h('div.muted', {}, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  every(1000, tick);

  // focus timer
  const ring = h('div.ring', {}, h('div', {}, h('b'), h('small', {}, 'focus')));
  const startBtn = h('button.btn.primary', { onclick: () => {
    if (focus.running) { focus.left = remaining(); focus.running = false; } else { focus.at = Date.now(); focus.running = true; }
    paintFocus();
  } });
  const remaining = () => Math.max(0, focus.running ? focus.left - (Date.now() - focus.at) / 1000 : focus.left);
  function paintFocus() {
    const left = remaining();
    if (focus.running && left <= 0) { focus.running = false; focus.left = focus.total; toast('Focus time is up — take a break!'); }
    const m = Math.floor(left / 60), s = Math.floor(left % 60);
    ring.querySelector('b').textContent = `${m}:${String(s).padStart(2, '0')}`;
    ring.style.setProperty('--p', 100 - (left / focus.total) * 100);
    startBtn.textContent = focus.running ? 'Pause' : left < focus.total ? 'Resume' : 'Start';
  }
  const presets = h('div.presets', {}, ...[5, 15, 25, 45, 60].map(m => h('button.chip', { 'aria-pressed': String(focus.total === m * 60), onclick: e => {
    focus = { total: m * 60, left: m * 60, running: false, at: 0 };
    for (const c of presets.children) c.setAttribute('aria-pressed', String(c === e.currentTarget));
    paintFocus();
  } }, m + ' min')));
  every(500, paintFocus);

  // to-dos (kept in your Aerie setup)
  const list = h('div.todo-list');
  const input = h('input.input', { placeholder: 'Add a to-do…', 'aria-label': 'New to-do', autofocus: true });
  const todos = () => (cfg.general.today ||= { todos: [] }).todos;
  const save = () => patchConfig(c => { c.general.today = { todos: todos() }; }).catch(() => toast('Could not save'));
  function paintTodos() {
    list.replaceChildren(...(todos().length ? todos().map(t => h('div.todo' + (t.done ? '.done' : ''), {},
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': t.text, onchange: e => { t.done = e.target.checked; paintTodos(); save(); } }),
      h('span', {}, t.text),
      h('button.icon-btn', { 'aria-label': 'Delete ' + t.text, html: icon('trash'), onclick: () => { cfg.general.today.todos = todos().filter(x => x !== t); paintTodos(); save(); } }),
    )) : [h('p.muted.small', {}, 'Nothing to do yet. Add something below.')]));
  }
  const add = () => { const text = input.value.trim(); if (!text) return; todos().push({ id: Date.now().toString(36), text, done: false }); input.value = ''; paintTodos(); save(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  paintTodos();

  body.append(h('div.today', {},
    h('div.side', {}, h('div', {}, clock, date), week, h('div.card.focus', {}, ring, h('div.side', {}, h('h3', {}, 'Focus timer'), presets, h('div', {}, startBtn, ' ', h('button.btn.ghost', { onclick: () => { focus.left = focus.total; focus.running = false; paintFocus(); } }, 'Reset'))))),
    h('div.card', {}, h('h3', {}, 'To do'), list, h('div.add-row', {}, input, h('button.btn.mint', { onclick: add, 'aria-label': 'Add to-do', html: icon('plus') }))),
  ));
}

// ---- Stats ---------------------------------------------------------------------------------
function stats() {
  const rings = h('div.rings');
  const apps = h('div.applist');
  const facts = h('div.facts');
  const speed = h('div.speed');
  body.append(h('div.stats', {}, rings, h('div', {}, h('h3', {}, 'Top apps · memory'), apps)), facts, speed);
  const ring = (p, label, sub, color) => h('div', {}, h('div.ring', { style: { '--p': Math.round(p || 0), '--c': color } }, h('div', {}, h('b', {}, Math.round(p || 0) + '%'), h('small', {}, sub || ''))), h('div.lbl', {}, label));
  every(2000, async () => {
    const s = await api.stats();
    if (!s) return;
    rings.replaceChildren(
      ring(s.cpu, 'CPU', s.temperature ? s.temperature + '°C' : '', 'var(--mint)'),
      s.gpu ? ring(s.gpu.percent, 'Graphics', s.gpu.memTotal ? fmtBytes(s.gpu.memUsed) : '', 'var(--sakura)') : ring(s.disk?.percent, 'Disk', fmtBytes(s.disk?.used), 'var(--sakura)'),
      ring(s.memory?.percent, 'Memory', `${fmtBytes(s.memory?.used)}`, 'var(--lav)'),
    );
    const top = s.apps?.[0]?.memory || 1;
    apps.replaceChildren(...(s.apps || []).map(a => h('div.approw', {}, h('span', {}, a.name), h('span.muted.small', {}, fmtBytes(a.memory)), h('div.bar', {}, h('i', { style: { width: (a.memory / top * 100) + '%' } })))));
    facts.replaceChildren(
      fact('Download', fmtRate(s.network?.down)), fact('Upload', fmtRate(s.network?.up)),
      fact('Up for', fmtUptime(s.uptime || 0)), fact(s.battery ? 'Battery' : 'Disk free', s.battery ? `${s.battery.percent}% ${s.battery.status === 'Charging' ? '⚡' : ''}` : fmtBytes((s.disk?.total || 0) - (s.disk?.used || 0))),
    );
    const sp = s.speed || {};
    const r = sp.result;
    speed.replaceChildren(
      h('span', { html: icon('bolt') }),
      h('div', {}, h('div.small.muted', {}, 'Internet speed'), h('div', {}, r ? h('span', {}, h('b', {}, r.down), ' Mbps ↓   ', h('b', {}, r.up), ' Mbps ↑   ', h('span.muted', {}, r.ping + ' ms')) : h('span.muted', {}, sp.running ? 'Testing ' + (sp.stage || '') + '…' : sp.error || 'Not tested yet'))),
      h('button.btn.mint', { style: { marginLeft: 'auto' }, disabled: !!sp.running, onclick: async () => { await api.speedtest(); toast('Testing your connection (uses speed.cloudflare.com)…'); } }, sp.running ? 'Testing…' : 'Run speed test'),
    );
  });
}
const fact = (label, value) => h('div.fact', {}, h('small', {}, label), h('b', {}, value));

// ---- Clipboard -----------------------------------------------------------------------------
function clipboard() {
  let kind = 'all', query = '', selected = null, data = { items: [] };
  const list = h('div.clip-list', { role: 'listbox', 'aria-label': 'Clipboard history' });
  const view = h('div.view');
  const actions = h('div', { style: { display: 'flex', gap: '8px' } });
  const search = h('input.input', { type: 'search', placeholder: 'Search your clipboard…', 'aria-label': 'Search clipboard', autofocus: true });
  const chips = h('div.chips', {}, ...[['all', 'All'], ['text', 'Text'], ['image', 'Images'], ['link', 'Links']].map(([k, label]) => h('button.chip', { 'aria-pressed': String(k === kind), onclick: e => { kind = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget)); load(); } }, label)));
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = search.value; load(); }, 150); });
  body.append(h('div.clip', {}, h('div.clip-left', {}, h('div.clip-top', {}, h('label.search', {}, h('span', { html: icon('search') }), search)), chips, list), h('div.clip-preview', {}, view, actions)));

  async function load() {
    data = await api.clipboard(query, kind);
    if (!cfg.general.clipboard?.enabled) return off();
    if (data.problem) view.textContent = data.problem;
    list.replaceChildren(...(data.items.length ? data.items.map(it => h('button.clip-item', {
      role: 'option', 'aria-selected': String(selected === it.id), onclick: () => { selected = it.id; load(); },
      ondblclick: () => copy(it),
    }, h('span.k', { html: icon(it.kind === 'image' ? 'image' : it.kind === 'link' ? 'link' : 'text') }),
    h('span.t', {}, it.kind === 'image' ? `Picture ${it.w ? `${it.w}×${it.h}` : ''}` : it.text.slice(0, 200)),
    h('small', {}, (it.pinned ? '★ ' : '') + ago(it.time)))) : [h('div.empty', { html: icon('clipboard') + '<div>Things you copy will show up here.</div>' })]));
    const it = data.items.find(i => i.id === selected) || data.items[0];
    if (it && !selected) selected = it.id;
    preview(it);
  }
  function preview(it) {
    if (!it) { view.replaceChildren(); actions.replaceChildren(); return; }
    view.replaceChildren(it.kind === 'image' ? h('img', { src: '/clip/' + it.file, alt: 'Copied picture' }) : document.createTextNode(it.text));
    actions.replaceChildren(
      h('button.btn.mint', { onclick: () => copy(it) }, h('span', { html: icon('copy') }), 'Copy'),
      h('button.btn', { onclick: async () => { await api.clipAction('pin', it.id, { on: !it.pinned }); load(); } }, it.pinned ? 'Unpin' : 'Pin'),
      h('button.btn.danger', { onclick: async () => { await api.clipAction('delete', it.id); selected = null; load(); } }, 'Delete'),
      h('button.btn.ghost', { style: { marginLeft: 'auto' }, onclick: async () => { if (confirm('Clear your clipboard history? Pinned items stay.')) { await api.clipAction('clear'); load(); } } }, 'Clear all'),
    );
  }
  async function copy(it) {
    await api.clipAction('copy', it.id);
    toast('Copied — paste it anywhere');
  }
  function off() {
    const box = body.querySelector('.clip');
    if (!box) return;
    box.replaceWith(h('div.empty', {},
      h('span', { html: icon('clipboard') }),
      h('h3', {}, 'Clipboard history is off'),
      h('p', { style: { maxWidth: '52ch' } }, 'When it\'s on, Aerie keeps the last 200 things you copy (text and pictures) on this computer only, so you can copy them again later. Things password managers mark as secret are never kept. You can clear it any time.'),
      data.available ? h('button.btn.primary', { onclick: async () => {
        cfg = await patchConfig(c => { c.general.clipboard = { enabled: true }; });
        await api.clipAction('enable', '', { on: true });
        show('clipboard');
      } }, 'Turn on clipboard history') : h('p.muted', {}, 'It needs the wl-clipboard package: open a terminal and run  sudo apt install wl-clipboard'),
    ));
  }
  load();
  every(3000, () => { if (!document.activeElement?.closest('.clip-preview')) load(); });
}
function ago(t) {
  const s = Date.now() / 1000 - t;
  return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
}

// ---- Apps -----------------------------------------------------------------------------------
async function apps() {
  const grid = h('div.apps-grid');
  const search = h('input.input', { type: 'search', placeholder: 'Search apps…', 'aria-label': 'Search apps', autofocus: true });
  body.append(h('div.apps-top', {}, h('label.search', {}, h('span', { html: icon('search') }), search)), grid);
  const all = await api.apps();
  const launch = async a => { const r = await api.launch(a.id); if (r.ok) close(); else toast('Could not open ' + a.name); };
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const shown = all.filter(a => !q || a.name.toLowerCase().includes(q) || (a.comment || '').toLowerCase().includes(q));
    grid.replaceChildren(...shown.map(a => h('button.app', { onclick: () => launch(a), title: a.comment || a.name },
      a.hasIcon ? h('img', { src: '/icon/' + encodeURIComponent(a.id), alt: '', loading: 'lazy' }) : h('span.noicon', {}, a.name[0]),
      h('span', {}, a.name))));
  };
  search.addEventListener('input', paint);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') grid.querySelector('.app')?.click(); });
  paint();
  search.focus();
}

// ---- Wallpaper (cover flow) ---------------------------------------------------------------------
async function wallpaper() {
  const flow = h('div.flow', { tabindex: 0, role: 'listbox', 'aria-label': 'Wallpapers (use the arrow keys, Enter to use)' });
  const filters = [['all', 'All'], ['aerie', 'Aerie scenes'], ['mine', 'Yours'], ['steam', 'Workshop']];
  let filter = 'all';
  const chips = h('div.chips', {}, ...filters.map(([k, label]) => h('button.chip', { 'aria-pressed': String(k === filter), onclick: e => {
    filter = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget)); paint(true);
  } }, label)));
  const count = h('span.muted.small');
  body.append(h('div.wp-top', {}, chips, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, count,
    h('button.btn.small', { onclick: () => post({ type: 'studio', page: 'library' }) }, h('span', { html: icon('plus') }), 'Add wallpapers'))),
  flow, h('div.flow-hint', {}, '← → to browse · Enter or click to use · scroll to flip'));
  const showMature = cfg.general.hub?.showMature;
  let all = (await allWallpapers(true)).filter(w => showMature || w.rating !== 'mature');
  let list = [], index = 0;
  const cur = () => currentKey(cfg, all);
  function pick() {
    list = all.filter(w => filter === 'all' || (filter === 'aerie' ? w.source === 'default' || w.kind === 'look' : filter === 'steam' ? w.source === 'steam' : !['default', 'steam', 'aerie'].includes(w.source)));
    count.textContent = `${list.length} wallpaper${list.length === 1 ? '' : 's'}`;
  }
  function paint(reset) {
    pick();
    if (reset) index = Math.max(0, list.findIndex(w => w.key === cur()));
    index = Math.min(index, Math.max(0, list.length - 1));
    flow.replaceChildren();
    if (!list.length) { flow.append(h('div.empty', { html: icon('wallpaper') + '<div>No wallpapers here yet. Add some in Aerie Studio.</div>' })); return; }
    list.forEach((w, i) => {
      const off = i - index;
      if (Math.abs(off) > 4) return;
      const card = h('button.flow-card' + (w.key === cur() ? '.current' : ''), {
        role: 'option', 'aria-selected': String(off === 0), 'aria-label': `${w.title} (${KIND_LABEL[w.kind] || ''})`,
        style: {
          transform: `translateX(${off * 230 + Math.sign(off) * 120}px) translateZ(${off ? -260 : 0}px) rotateY(${off ? -Math.sign(off) * 42 : 0}deg)`,
          zIndex: 20 - Math.abs(off), opacity: Math.abs(off) > 3 ? 0 : 1, filter: off ? 'brightness(.65)' : 'none',
        },
        onclick: () => (off === 0 ? use(w) : (index = i, paint())),
      }, w.preview ? h('img', { src: w.preview, alt: '', loading: 'lazy' }) : h('div.ph', { style: { background: placeholderStyle(w) }, html: icon(KIND_ICON[w.kind] || 'wallpaper') }),
      h('span.tag', {}, sourceLabel(w) + ' · ' + (KIND_LABEL[w.kind] || '')),
      h('span.cap', {}, h('b', {}, w.title), w.tagline ? h('small', {}, w.tagline) : ''));
      flow.append(card);
    });
    flow.append(h('button.icon-btn.flow-nav.l', { 'aria-label': 'Previous wallpaper', html: icon('arrowLeft'), onclick: () => move(-1) }),
      h('button.icon-btn.flow-nav.r', { 'aria-label': 'Next wallpaper', html: icon('arrowRight'), onclick: () => move(1) }));
  }
  const move = d => { index = Math.max(0, Math.min(list.length - 1, index + d)); paint(); };
  flow.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter' && list[index]) use(list[index]);
  });
  let wheel = 0;
  flow.addEventListener('wheel', e => { e.preventDefault(); wheel += e.deltaY + e.deltaX; if (Math.abs(wheel) > 60) { move(Math.sign(wheel)); wheel = 0; } }, { passive: false });
  async function use(w) {
    cfg = await patchConfig(c => { c.wallpaper = w.choice; c.screens = {}; });
    toast(`${w.title} is your wallpaper now`);
    paint();
  }
  paint(true);
  flow.focus();
}

// ---- Power ------------------------------------------------------------------------------------
function power() {
  const confirmable = new Set(['restart', 'shutdown', 'logout']);
  let armed = null;
  const items = [['lock', 'Lock', 'lock'], ['sleep', 'Sleep', 'sleep'], ['restart', 'Restart', 'restart'], ['shutdown', 'Shut down', 'power'], ['logout', 'Log out', 'logout']];
  const box = h('div.power');
  const paint = () => box.replaceChildren(...items.map(([action, label, ico]) => h('button.pbtn' + (armed === action ? '.confirm' : ''), {
    onclick: async () => {
      if (confirmable.has(action) && armed !== action) { armed = action; paint(); setTimeout(() => { if (armed === action) { armed = null; paint(); } }, 4000); return; }
      close();
      try { await api.power(action); } catch (e) { toast(e.message); }
    },
  }, h('span', { html: icon(ico) }), label, armed === action ? h('small', {}, 'Click again to confirm') : '')));
  paint();
  body.append(box);
  box.querySelector('button').focus();
}

post({ type: 'ready' });

// opened directly in a browser (testing): show it right away
if (!window.webkit?.messageHandlers?.aerie) window.hub.open(new URLSearchParams(location.search).get('tab'));
