// The hub: quick controls, today, stats, clipboard history, apps, wallpapers and power,
// in a panel that drops down from the top of the screen (Super+D).
//
// Everything that moves here moves on springs (motion.js): the panel, the tab underline, the
// wallpaper carousel. Drag the panel up, or press Esc, to close it. Ctrl+K searches everything.
import { api, normalizeConfig, STANDALONE } from './config.js';
import { allWallpapers, cachedWallpapers, currentKey, KIND_LABEL, patchConfig, prefetchPreview, previewEl, sourceLabel } from './catalog.js';
import { installCommandMenu } from './command.js';
import { fmtBytes, fmtRate, fmtUptime, h, icon, kbd, skeleton } from './icons.js';
import { animate, installCssSprings, place, Spring, SPRINGS } from './motion.js';
import { installSquircles } from './squircle.js';
import { flushToasts, toast } from './toast.js';

const TABS = [
  ['controls', 'Controls', '操作', 'sliders'], ['today', 'Today', '今日', 'timer'], ['stats', 'Stats', '統計', 'cpu'],
  ['clipboard', 'Clipboard', 'クリップボード', 'clipboard'], ['apps', 'Apps', 'アプリ', 'grid'], ['wallpaper', 'Wallpaper', '壁紙', 'wallpaper'],
  ['power', 'Power', '電源', 'power'],
];
const $ = s => document.querySelector(s);
const body = $('#body');
const panel = $('#panel');
const backdrop = $('#backdrop');
let cfg = null;
let tab = 'controls';
let timers = [];
let isOpen = false;
const post = msg => { try { window.webkit.messageHandlers.aerie.postMessage(msg); } catch { /* opened in a browser */ } };

installCssSprings();
installSquircles();

// Last answers from Aerie, so a tab shows something at once and refreshes in the background.
const cache = {};
async function fresh(name, load) {
  const value = await load();
  if (value) cache[name] = value;
  return value;
}

// ---- frame ---------------------------------------------------------------------------------
$('#studio').innerHTML = icon('sliders');
$('#close').innerHTML = icon('close');
$('#cmd').append(h('span', { html: icon('search') }), kbd('Ctrl+K'));
$('#studio').addEventListener('click', openStudio);
$('#close').addEventListener('click', close);
$('#cmd').addEventListener('click', () => commands.open());
backdrop.addEventListener('pointerdown', close);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !commands.isOpen()) { e.preventDefault(); close(); }
  if (e.ctrlKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); const t = visibleTabs()[+e.key - 1]; if (t) show(t[0]); }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const vis = visibleTabs(), i = vis.findIndex(t => t[0] === tab); show(vis[(i + (e.shiftKey ? vis.length - 1 : 1)) % vis.length][0]); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openStudio(); }
});

function openStudio() {
  post({ type: 'studio', page: tab === 'wallpaper' ? 'library' : null });
  if (STANDALONE || !window.webkit) location.href = 'studio.html' + location.hash;
}

// the underline under the current tab slides (and stretches) to the next one: a shared element
const ind = h('span.tab-ind', { 'aria-hidden': 'true' });
const indX = new Spring(0, v => { ind.style.transform = `translateX(${v}px)`; }, SPRINGS.snappy);
const indW = new Spring(0, v => { ind.style.width = `${v}px`; }, SPRINGS.snappy);
function moveIndicator(jump = false) {
  const btn = $('#tabs [aria-selected="true"]');
  if (!btn) return;
  const x = btn.offsetLeft + 12, w = btn.offsetWidth - 24;
  if (jump || !indW.value) { indX.set(x); indW.set(w); } else { indX.to(x); indW.to(w); }
}

function renderTabs() {
  const nav = $('#tabs');
  const vis = visibleTabs();
  nav.replaceChildren(...vis.map(([key, label], i) => h('button.pill', {
    role: 'tab', 'aria-selected': String(key === tab), tabindex: key === tab ? 0 : -1, title: `${label} (Ctrl+${i + 1})`,
    'aria-keyshortcuts': `Control+${i + 1}`, onclick: () => show(key), onpointerenter: () => prefetchTab(key),
    onkeydown: e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const j = vis.findIndex(t => t[0] === tab);
      show(vis[(j + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length][0]);
      nav.querySelector('[aria-selected="true"]')?.focus();
    },
  }, label)), ind);
}

function visibleTabs() {
  const want = cfg?.general.hub?.tabs;
  return TABS.filter(([k]) => !want || want.includes(k));
}

// warm up what a tab needs while your pointer is on its name (pre-rendering the next screen)
function prefetchTab(key) {
  if (key === 'apps' && !cache.apps) fresh('apps', api.apps);
  if (key === 'wallpaper') allWallpapers().then(list => list.slice(0, 6).forEach(prefetchPreview)).catch(() => null);
  if (key === 'stats' && !cache.stats) fresh('stats', api.stats);
  if (key === 'clipboard' && !cache.clip) fresh('clip', () => api.clipboard());
}

function show(key, { jump = false } = {}) {
  if (!TABS.some(t => t[0] === key)) key = 'controls';
  const from = TABS.findIndex(t => t[0] === tab), to = TABS.findIndex(t => t[0] === key);
  tab = key;
  for (const t of timers) clearInterval(t);
  timers = [];
  renderTabs();
  moveIndicator(jump);
  $('#kana').textContent = TABS[to][2];
  const view = h('div.view');
  body.replaceChildren(view);
  ({ controls, today, stats, clipboard, apps, wallpaper, power })[key](view);
  if (!jump) {
    place(view, { x: (to >= from ? 1 : -1) * 18, opacity: 0 });
    animate(view, { x: 0, opacity: 1 }, { config: SPRINGS.snappy });
  }
  try { localStorage.setItem('aerie-hub-tab', key); } catch { /* not kept */ }
}

function every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); }

// ---- opening, closing and dragging the panel ---------------------------------------------------
const closedY = () => -(panel.offsetHeight + 40);
function setBackdrop(y) { backdrop.style.opacity = String(Math.max(0, Math.min(1, 1 + y / Math.max(1, panel.offsetHeight)))); }
const panelY = new Spring(-1000, y => { panel.style.transform = `translateY(${y}px)`; setBackdrop(y); }, SPRINGS.panel);

function close() {
  if (!isOpen) return;
  post({ type: 'close' });
  slideAway();
}

async function slideAway(velocity) {
  isOpen = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  flushToasts();
  await panelY.to(closedY(), { velocity, config: SPRINGS.snappy });
  if (!isOpen) post({ type: 'closed' });
}

// drag the panel up to put it away (swipe-to-dismiss); let go early and it springs back
let drag = null;
function startDrag(e) {
  if (e.button !== 0 || e.target.closest('button:not(.hub-grip), input, a, [role="tab"]')) return;
  drag = { y0: e.clientY, start: panelY.value, samples: [[performance.now(), panelY.value]] };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function moveDrag(e) {
  if (!drag) return;
  let y = drag.start + (e.clientY - drag.y0);
  if (y > 0) y = Math.sqrt(y) * 3; // pulling down stretches a little and no further
  panelY.set(y);
  drag.samples.push([performance.now(), y]);
  if (drag.samples.length > 6) drag.samples.shift();
}
function endDrag() {
  if (!drag) return;
  const s = drag.samples, [t0, y0] = s[0], [t1, y1] = s[s.length - 1];
  const v = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0;
  drag = null;
  if (panelY.value < -panel.offsetHeight * 0.3 || v < -900) { post({ type: 'close' }); slideAway(v); } else panelY.to(0, { velocity: v });
}
for (const el of [$('#grip'), $('.hub-head')]) {
  el.addEventListener('pointerdown', startDrag);
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}
$('#grip').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } });

window.hub = {
  async open(which) {
    cfg = normalizeConfig(await api.loadConfig());
    const wasOpen = isOpen;
    isOpen = true;
    let last = null;
    try { last = localStorage.getItem('aerie-hub-tab'); } catch { /* not kept */ }
    show(which || (TABS.some(t => t[0] === last) ? last : 'controls'), { jump: !wasOpen });
    if (!wasOpen && !panelY.moving) panelY.set(closedY());
    panelY.to(0, { config: SPRINGS.panel });
    setTimeout(() => (body.querySelector('[autofocus]') || $('#tabs [aria-selected="true"]'))?.focus(), 60);
  },
  closing() { if (isOpen) slideAway(); },
};
window.aeriePage = { async configChanged() { cfg = normalizeConfig(await api.loadConfig()); } };

// ---- Ctrl+K ------------------------------------------------------------------------------------
const commands = installCommandMenu(() => [
  ...visibleTabs().map(([key, label, , ico], i) => ({ label, group: 'Hub', icon: ico, hint: `Ctrl+${i + 1}`, order: i, run: () => show(key) })),
  { label: 'Open Aerie Studio', group: 'Actions', icon: 'sliders', hint: 'Ctrl+,', order: 20, run: openStudio },
  { label: 'Add wallpapers', group: 'Actions', icon: 'plus', keywords: 'import wallpaper engine file', order: 21, run: () => post({ type: 'studio', page: 'library' }) },
  { label: 'Lock the screen', group: 'Actions', icon: 'lock', order: 22, run: () => { close(); api.power('lock'); } },
  { label: 'Sleep', group: 'Actions', icon: 'sleep', order: 23, run: () => { close(); api.power('sleep'); } },
  { label: 'Run a speed test', group: 'Actions', icon: 'bolt', keywords: 'internet network', order: 24, run: () => { show('stats'); api.speedtest().catch(() => null); } },
  { label: 'Close the hub', group: 'Actions', icon: 'close', hint: 'Esc', order: 30, run: close },
  ...(cachedWallpapers() || []).slice(0, 60).map(w => ({ label: w.title, group: 'Wallpapers', icon: 'wallpaper', keywords: 'wallpaper ' + (KIND_LABEL[w.kind] || ''), order: 40, run: () => useWallpaper(w) })),
], { placeholder: 'Search tabs, actions and wallpapers…' });

async function useWallpaper(w) {
  const before = cfg.wallpaper, beforeScreens = cfg.screens;
  cfg = await patchConfig(c => { c.wallpaper = w.choice; c.screens = {}; });
  toast(`${w.title} is your wallpaper now`, {
    undo: async () => { cfg = await patchConfig(c => { c.wallpaper = before; c.screens = beforeScreens || {}; }); if (tab === 'wallpaper') show('wallpaper', { jump: true }); },
  });
}

// ---- Controls ------------------------------------------------------------------------------
function controls(view) {
  const tiles = h('div.tiles');
  const sliders = h('div.side');
  const media = h('div.media', { 'data-sq': 16 });
  view.append(h('div.controls', {}, h('div.side', {}, tiles, sliders), h('div.side', {}, media)));
  const pending = {};

  const tile = (name, label, sub, on, ico, offIco) => h('button.tile' + (name in pending ? '.pending' : ''), {
    'data-sq': 14, 'aria-pressed': String(!!on),
    onclick: async e => {
      // optimistic: flip it now, then confirm with the system (or put it back and say why)
      if (name in pending) return;
      pending[name] = !on;
      const btn = e.currentTarget;
      btn.setAttribute('aria-pressed', String(!on));
      btn.querySelector('.ti').innerHTML = icon(!on || !offIco ? ico : offIco);
      try {
        const s = await api.setControl(name, !on);
        delete pending[name];
        paint(s);
      } catch (err) {
        delete pending[name];
        toast(`${label}: ${err.message || 'that didn\'t work'}`);
        paint(cache.controls);
      }
    },
  }, h('span.ti', { html: icon(on || !offIco ? ico : offIco) }), h('span', {}, h('b', {}, label), h('small', {}, sub)));

  function paint(s) {
    if (!s) return;
    cache.controls = s;
    const t = [];
    const v = (name, real) => (name in pending ? pending[name] : real);
    if (s.wifi) t.push(tile('wifi', 'Wi-Fi', s.wifi.on ? (s.wifi.name || 'On') : 'Off', v('wifi', s.wifi.on), 'wifi', 'wifiOff'));
    if (s.bluetooth) t.push(tile('bluetooth', 'Bluetooth', s.bluetooth.on ? (s.bluetooth.name || 'On') : 'Off', v('bluetooth', s.bluetooth.on), 'bluetooth'));
    if (s.audio) t.push(tile('mute', 'Sound', s.audio.muted ? 'Muted' : (s.audio.name || 'On'), v('mute', !s.audio.muted), 'speaker', 'mute'));
    t.push(tile('dnd', 'Do not disturb', s.dnd ? 'On, no pop-ups' : 'Off', v('dnd', s.dnd), 'bellOff', 'bell'));
    if (s.dark !== null && s.dark !== undefined) t.push(tile('dark', 'Dark mode', s.dark ? 'On' : 'Off', v('dark', s.dark), 'moon', 'sun'));
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
    input.addEventListener('input', () => { fill(); clearTimeout(t); t = setTimeout(() => api.setControl(name, +input.value).catch(() => toast(`Couldn't change the ${label.toLowerCase()}`)), 80); });
    return h('label.slider-row', {}, h('span', { html: icon(ico) }), input, out);
  }

  async function player() {
    const np = await api.nowPlaying();
    media.classList.toggle('playing', !!np?.playing);
    if (!np?.active) {
      media.replaceChildren(h('div.art', { html: icon('music') }), h('div', {}, h('h3', {}, 'Nothing playing'), h('div.who', {}, 'Music and videos you play show up here.')));
      return;
    }
    const art = np.hasArt ? h('img.art', { src: '/now-playing-art?t=' + encodeURIComponent(np.title), alt: `Cover of ${np.title}` }) : h('div.art', { html: icon('music') });
    const btn = (action, ico, label, cls = 'icon-btn') => h('button.' + cls, { 'aria-label': label, title: label, html: icon(ico), onclick: async () => { await api.playerControl(action); setTimeout(player, 250); } });
    media.replaceChildren(art, h('div', { style: { minWidth: 0 } },
      h('div.small.muted', {}, np.player || ''), h('h3', {}, np.title), h('div.who', {}, np.artist || np.album || ''),
      h('div.ctrl', {}, btn('previous', 'prev', 'Previous'), btn('play-pause', np.playing ? 'pause' : 'play', np.playing ? 'Pause' : 'Play', 'play'), btn('next', 'next', 'Next'),
        h('div.wave', { 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: { animationDelay: `${(i * 0.13) % 1}s` } }))))));
  }

  if (cache.controls) paint(cache.controls); else tiles.append(skeleton('cards', 6));
  every(3000, async () => paint(await api.controls()));
  every(2500, player);
}

// ---- Today -----------------------------------------------------------------------------------
let focus = { total: 25 * 60, left: 25 * 60, running: false, at: 0 };
function today(view) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = h('div.week', {}, ...Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return h('div.day' + (d.toDateString() === now.toDateString() ? '.now' : ''), {}, h('small', {}, d.toLocaleDateString(undefined, { weekday: 'short' })), h('b', {}, d.getDate()));
  }));
  const clock = h('time.bigclock');
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
    if (focus.running && left <= 0) { focus.running = false; focus.left = focus.total; toast('Focus time is up. Take a break.'); }
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
  const save = () => patchConfig(c => { c.general.today = { todos: todos() }; }).catch(() => toast('Couldn\'t save your to-dos'));
  function paintTodos() {
    list.replaceChildren(...(todos().length ? todos().map(t => h('div.todo' + (t.done ? '.done' : ''), {},
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': t.text, onchange: e => { t.done = e.target.checked; paintTodos(); save(); } }),
      h('span', {}, t.text),
      h('button.icon-btn', { 'aria-label': 'Delete ' + t.text, title: 'Delete', html: icon('trash'), onclick: () => {
        const at = todos().indexOf(t);
        cfg.general.today.todos = todos().filter(x => x !== t);
        paintTodos();
        save();
        toast(`Deleted "${t.text}"`, { undo: () => { todos().splice(at, 0, t); paintTodos(); save(); } });
      } }),
    )) : [h('p.muted.small', {}, 'Nothing to do yet. Add something below.')]));
  }
  const add = () => { const text = input.value.trim(); if (!text) return; todos().push({ id: Date.now().toString(36), text, done: false }); input.value = ''; paintTodos(); save(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  paintTodos();

  view.append(h('div.today', {},
    h('div.side', {}, h('div', {}, clock, date), week, h('div.card.focus', { 'data-sq': 14 }, ring, h('div.side', {}, h('h3', {}, 'Focus timer'), presets, h('div', {}, startBtn, ' ', h('button.btn.ghost', { onclick: () => { focus.left = focus.total; focus.running = false; paintFocus(); } }, 'Reset'))))),
    h('div.card', { 'data-sq': 14 }, h('h3', {}, 'To do'), list, h('div.add-row', {}, input, h('button.btn.mint', { onclick: add, 'aria-label': 'Add to-do', title: 'Add (Enter)', html: icon('plus') }))),
  ));
}

// ---- Stats ---------------------------------------------------------------------------------
function stats(view) {
  const rings = h('div.rings');
  const apps = h('div.applist');
  const facts = h('div.facts');
  const speed = h('div.speed', { 'data-sq': 14 });
  view.append(h('div.stats', {}, rings, h('div', {}, h('h3', {}, 'Top apps by memory'), apps)), facts, speed);
  const ring = (p, label, sub, color) => h('div', {}, h('div.ring', { role: 'img', 'aria-label': `${label} ${Math.round(p || 0)}%`, style: { '--p': Math.round(p || 0), '--c': color } }, h('div', {}, h('b', {}, Math.round(p || 0) + '%'), h('small', {}, sub || ''))), h('div.lbl', {}, label));
  const paint = s => {
    if (!s) return;
    rings.replaceChildren(
      ring(s.cpu, 'CPU', s.temperature ? s.temperature + '°C' : '', 'var(--ochre)'),
      s.gpu ? ring(s.gpu.percent, 'Graphics', s.gpu.memTotal ? fmtBytes(s.gpu.memUsed) : '', 'var(--accent)') : ring(s.disk?.percent, 'Disk', fmtBytes(s.disk?.used), 'var(--accent)'),
      ring(s.memory?.percent, 'Memory', `${fmtBytes(s.memory?.used)}`, 'var(--moss)'),
    );
    const top = s.apps?.[0]?.memory || 1;
    apps.replaceChildren(...(s.apps || []).map(a => h('div.approw', {}, h('span', {}, a.name), h('span.muted.small', {}, fmtBytes(a.memory)), h('div.bar', {}, h('i', { style: { width: (a.memory / top * 100) + '%' } })))));
    facts.replaceChildren(
      fact('Download', fmtRate(s.network?.down)), fact('Upload', fmtRate(s.network?.up)),
      fact('Up for', fmtUptime(s.uptime || 0)), fact(s.battery ? 'Battery' : 'Disk free', s.battery ? `${s.battery.percent}%${s.battery.status === 'Charging' ? ', charging' : ''}` : fmtBytes((s.disk?.total || 0) - (s.disk?.used || 0))),
    );
    const sp = s.speed || {};
    const r = sp.result;
    speed.replaceChildren(
      h('span', { html: icon('bolt') }),
      h('div', {}, h('div.small.muted', {}, 'Internet speed'), h('div', {}, r ? h('span', {}, h('b', {}, r.down), ' Mbps down   ', h('b', {}, r.up), ' Mbps up   ', h('span.muted.tnum', {}, r.ping + ' ms')) : h('span.muted', {}, sp.running ? 'Testing ' + (sp.stage || '') + '…' : sp.error || 'Not tested yet'))),
      h('button.btn.mint', { style: { marginLeft: 'auto' }, disabled: !!sp.running, onclick: async () => { await api.speedtest(); toast('Testing your connection with speed.cloudflare.com…'); } }, sp.running ? 'Testing…' : 'Run speed test'),
    );
  };
  if (cache.stats) paint(cache.stats); else { rings.append(skeleton('cards', 3)); apps.append(skeleton('rows', 5)); }
  every(2000, async () => paint(await fresh('stats', api.stats)));
}
const fact = (label, value) => h('div.fact', {}, h('small', {}, label), h('b', {}, value));

// ---- Clipboard -----------------------------------------------------------------------------
function clipboard(view) {
  let kind = 'all', query = '', selected = null, data = cache.clip || null;
  const hiddenIds = new Set(); // deleted, waiting for the undo toast to go away
  const list = h('div.clip-list', { role: 'listbox', 'aria-label': 'Clipboard history' });
  const box = h('div.view', { 'aria-live': 'polite' });
  const actions = h('div', { style: { display: 'flex', gap: '8px' } });
  const search = h('input.input', { type: 'search', placeholder: 'Search your clipboard…', 'aria-label': 'Search clipboard', autofocus: true });
  const chips = h('div.chips', {}, ...[['all', 'All'], ['text', 'Text'], ['image', 'Pictures'], ['link', 'Links']].map(([k, label]) => h('button.chip', { 'aria-pressed': String(k === kind), onclick: e => { kind = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget)); load(); } }, label)));
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = search.value; load(); }, 150); });
  view.append(h('div.clip', {}, h('div.clip-left', {}, h('div.clip-top', {}, h('label.search', {}, h('span', { html: icon('search') }), search)), chips, list), h('div.clip-preview', {}, box, actions)));

  function paint() {
    if (!data) { list.replaceChildren(skeleton('rows', 7)); return; }
    if (!cfg.general.clipboard?.enabled) return off();
    if (data.problem) box.textContent = data.problem;
    const items = data.items.filter(i => !hiddenIds.has(i.id));
    list.replaceChildren(...(items.length ? items.map(it => h('button.clip-item', {
      role: 'option', 'aria-selected': String(selected === it.id), onclick: () => { selected = it.id; paint(); },
      ondblclick: () => copy(it), title: 'Double-click or Enter to copy',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); copy(it); } if (e.key === 'Delete') remove(it); },
    }, h('span.k', { html: icon(it.kind === 'image' ? 'image' : it.kind === 'link' ? 'link' : 'text') }),
    h('span.t', {}, it.kind === 'image' ? `Picture ${it.w ? `${it.w}×${it.h}` : ''}` : it.text.slice(0, 200)),
    h('small', {}, (it.pinned ? 'Pinned · ' : '') + ago(it.time)))) : [h('div.empty', { html: icon('clipboard') + '<div>Things you copy will show up here.</div>' })]));
    const it = items.find(i => i.id === selected) || items[0];
    if (it && !selected) selected = it.id;
    preview(it);
  }
  async function load() {
    data = await fresh('clip', () => api.clipboard(query, kind));
    paint();
  }
  function preview(it) {
    if (!it) { box.replaceChildren(); actions.replaceChildren(); return; }
    box.replaceChildren(it.kind === 'image' ? h('img', { src: '/clip/' + it.file, alt: 'Copied picture' }) : document.createTextNode(it.text));
    actions.replaceChildren(
      h('button.btn.mint', { onclick: () => copy(it), title: 'Copy (Enter)' }, h('span', { html: icon('copy') }), 'Copy'),
      h('button.btn', { onclick: async () => {
        it.pinned = !it.pinned; paint(); // optimistic
        try { await api.clipAction('pin', it.id, { on: it.pinned }); } catch { it.pinned = !it.pinned; paint(); toast('Couldn\'t pin that'); }
      } }, it.pinned ? 'Unpin' : 'Pin'),
      h('button.btn.danger', { onclick: () => remove(it), title: 'Delete (Del)' }, 'Delete', kbd('Del')),
      h('button.btn.ghost', { style: { marginLeft: 'auto' }, onclick: clearAll }, 'Clear all'),
    );
  }
  function remove(it) {
    hiddenIds.add(it.id);
    selected = null;
    paint();
    toast('Deleted from your clipboard history', {
      undo: () => { hiddenIds.delete(it.id); selected = it.id; paint(); },
      commit: () => api.clipAction('delete', it.id).then(() => hiddenIds.delete(it.id)),
    });
  }
  function clearAll() {
    const gone = data.items.filter(i => !i.pinned).map(i => i.id);
    gone.forEach(id => hiddenIds.add(id));
    selected = null;
    paint();
    toast(`Cleared ${gone.length} item${gone.length === 1 ? '' : 's'}. Pinned ones stay.`, {
      undo: () => { gone.forEach(id => hiddenIds.delete(id)); paint(); },
      commit: () => api.clipAction('clear').then(load),
    });
  }
  async function copy(it) {
    await api.clipAction('copy', it.id);
    toast('Copied. Paste it anywhere.');
  }
  function off() {
    const wrap = view.querySelector('.clip');
    if (!wrap) return;
    wrap.replaceWith(h('div.empty', {},
      h('span', { html: icon('clipboard') }),
      h('h3', {}, 'Clipboard history is off'),
      h('p', { style: { maxWidth: '52ch' } }, 'Turn it on and Aerie keeps the last 200 things you copy (text and pictures) on this computer only, so you can copy them again later. Aerie skips anything a password manager marks as secret. You can clear it any time.'),
      data.available ? h('button.btn.primary', { onclick: async () => {
        cfg = await patchConfig(c => { c.general.clipboard = { enabled: true }; });
        await api.clipAction('enable', '', { on: true });
        show('clipboard', { jump: true });
      } }, 'Turn on clipboard history') : h('p.muted', {}, 'It needs the wl-clipboard package. Open a terminal and run: sudo apt install wl-clipboard'),
    ));
  }
  paint();
  every(3000, () => { if (!document.activeElement?.closest('.clip-preview')) load(); });
}
function ago(t) {
  const s = Date.now() / 1000 - t;
  return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
}

// ---- Apps -----------------------------------------------------------------------------------
async function apps(view) {
  const grid = h('div.apps-grid');
  const search = h('input.input', { type: 'search', placeholder: 'Search apps…', 'aria-label': 'Search apps', autofocus: true });
  view.append(h('div.apps-top', {}, h('label.search', {}, h('span', { html: icon('search') }), search)), grid);
  let all = cache.apps || [];
  const launch = async a => { const r = await api.launch(a.id); if (r.ok) close(); else toast('Couldn\'t open ' + a.name); };
  const paint = () => {
    if (!all.length) { grid.replaceChildren(skeleton('apps', 12)); return; }
    const q = search.value.trim().toLowerCase();
    const shown = all.filter(a => !q || a.name.toLowerCase().includes(q) || (a.comment || '').toLowerCase().includes(q));
    grid.replaceChildren(...shown.map(a => h('button.app', { onclick: () => launch(a), title: a.comment || a.name },
      a.hasIcon ? h('img', { src: '/icon/' + encodeURIComponent(a.id), alt: '', loading: 'lazy' }) : h('span.noicon', { 'aria-hidden': 'true' }, a.name[0]),
      h('span', {}, a.name))));
    if (!shown.length) grid.append(h('div.empty', {}, 'No app matches that.'));
  };
  search.addEventListener('input', paint);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') grid.querySelector('.app')?.click(); });
  paint();
  search.focus();
  all = await fresh('apps', api.apps) || all;
  if (view.isConnected) paint();
}

// ---- Wallpaper (cover flow) ---------------------------------------------------------------------
async function wallpaper(view) {
  const flow = h('div.flow', { tabindex: 0, role: 'listbox', 'aria-label': 'Wallpapers (arrow keys to browse, Enter to use)' });
  const filters = [['all', 'All'], ['aerie', 'Aerie scenes'], ['mine', 'Yours'], ['steam', 'Workshop']];
  let filter = 'all';
  const chips = h('div.chips', {}, ...filters.map(([k, label]) => h('button.chip', { 'aria-pressed': String(k === filter), onclick: e => {
    filter = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget)); build(true);
  } }, label)));
  const count = h('span.muted.small.tnum');
  const status = h('span.updating', { hidden: true }, 'Updating');
  view.append(h('div.wp-top', {}, chips, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, status, count,
    h('button.btn.small', { onclick: () => post({ type: 'studio', page: 'library' }) }, h('span', { html: icon('plus') }), 'Add wallpapers'))),
  flow, h('div.flow-hint', {}, h('span', {}, kbd('←'), ' ', kbd('→'), ' browse'), h('span', {}, kbd('Enter'), ' use'), h('span', {}, 'drag or scroll to flip')));
  const showMature = cfg.general.hub?.showMature;
  let all = (cachedWallpapers() || []).filter(w => showMature || w.rating !== 'mature');
  let list = [], cards = [];
  const cur = () => currentKey(cfg, all);
  const pos = new Spring(0, layout, SPRINGS.flow);
  let target = 0;
  let drag = null, moved = false;

  function filtered() {
    return all.filter(w => filter === 'all' || (filter === 'aerie' ? w.source === 'default' || w.kind === 'look' : filter === 'steam' ? w.source === 'steam' : !['default', 'steam', 'aerie'].includes(w.source)));
  }

  function build(reset) {
    const keep = list[target]?.key;
    list = filtered();
    count.textContent = `${list.length} wallpaper${list.length === 1 ? '' : 's'}`;
    flow.replaceChildren();
    cards = [];
    if (!list.length) {
      flow.append(all.length ? h('div.empty', { html: icon('wallpaper') + '<div>No wallpapers here yet. Add some in Aerie Studio.</div>' }) : skeleton('cards', 1));
      return;
    }
    const i = reset ? list.findIndex(w => w.key === cur()) : list.findIndex(w => w.key === keep);
    target = Math.max(0, i);
    cards = list.map((w, idx) => {
      const card = h('button.flow-card', {
        role: 'option', 'aria-label': `${w.title}, ${KIND_LABEL[w.kind] || ''}`, 'data-sq': 18, tabindex: -1,
        onclick: () => { if (moved) return; if (idx === target) use(w); else goTo(idx); },
      }, previewEl(w, 'pv'), h('span.tag', {}, sourceLabel(w) + ' · ' + (KIND_LABEL[w.kind] || '')),
      w.key === cur() ? h('span.inuse', {}, 'In use') : '',
      h('span.cap', {}, h('b', {}, w.title), w.tagline ? h('small', {}, w.tagline) : ''), h('span.shade'));
      flow.append(card);
      return card;
    });
    flow.append(h('button.icon-btn.flow-nav.l', { 'aria-label': 'Previous wallpaper', title: 'Previous (←)', html: icon('arrowLeft'), onclick: () => goTo(target - 1) }),
      h('button.icon-btn.flow-nav.r', { 'aria-label': 'Next wallpaper', title: 'Next (→)', html: icon('arrowRight'), onclick: () => goTo(target + 1) }));
    pos.set(target);
    mark();
  }

  // every card's place comes from one number: where the carousel is (a spring)
  function layout(p) {
    cards.forEach((card, i) => {
      const o = i - p, a = Math.abs(o), k = Math.min(a, 1), sgn = Math.sign(o);
      if (a > 4.6) { card.style.visibility = 'hidden'; return; }
      card.style.visibility = 'visible';
      card.style.transform = `translateX(${o * 230 + sgn * k * 120}px) translateZ(${-260 * k}px) rotateY(${-sgn * 42 * k}deg)`;
      card.style.zIndex = String(100 - Math.round(a * 10));
      card.style.opacity = String(a > 3.6 ? Math.max(0, 4.6 - a) : 1);
      card.lastChild.style.opacity = String(0.38 * k);
    });
  }

  function mark() {
    cards.forEach((c, i) => c.setAttribute('aria-selected', String(i === target)));
    for (let d = -2; d <= 2; d++) prefetchPreview(list[target + d]); // the next pictures load before you get there
  }

  function goTo(i, velocity) {
    target = Math.max(0, Math.min(list.length - 1, i));
    mark();
    pos.to(target, { velocity });
  }

  flow.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(target + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(target - 1); }
    if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    if (e.key === 'End') { e.preventDefault(); goTo(list.length - 1); }
    if (e.key === 'Enter' && list[target]) use(list[target]);
  });
  let wheel = 0;
  flow.addEventListener('wheel', e => { e.preventDefault(); wheel += e.deltaY + e.deltaX; if (Math.abs(wheel) > 60) { goTo(target + Math.sign(wheel)); wheel = 0; } }, { passive: false });

  // drag the cards sideways; let go and they keep their speed and settle on the nearest one
  flow.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.flow-nav')) return;
    drag = { x0: e.clientX, p0: pos.value, samples: [[performance.now(), pos.value]] };
    moved = false;
  });
  flow.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) { moved = true; flow.setPointerCapture(e.pointerId); }
    const p = Math.max(-0.4, Math.min(list.length - 0.6, drag.p0 - dx / 260));
    pos.set(p);
    drag.samples.push([performance.now(), p]);
    if (drag.samples.length > 6) drag.samples.shift();
  });
  const release = () => {
    if (!drag) return;
    const s = drag.samples, [t0, p0] = s[0], [t1, p1] = s[s.length - 1];
    drag = null;
    if (!moved) return;
    const v = t1 > t0 ? ((p1 - p0) / (t1 - t0)) * 1000 : 0;
    goTo(Math.round(pos.value + v * 0.18), v);
    setTimeout(() => { moved = false; }, 0);
  };
  flow.addEventListener('pointerup', release);
  flow.addEventListener('pointercancel', release);

  async function use(w) {
    const before = cfg.wallpaper, beforeScreens = cfg.screens;
    cfg = await patchConfig(c => { c.wallpaper = w.choice; c.screens = {}; });
    toast(`${w.title} is your wallpaper now`, {
      undo: async () => { cfg = await patchConfig(c => { c.wallpaper = before; c.screens = beforeScreens || {}; }); build(true); },
    });
    build(false);
  }

  build(true);
  flow.focus();
  // stale-while-revalidate: show the last list at once, then fetch the newest
  status.hidden = false;
  all = (await allWallpapers(true)).filter(w => showMature || w.rating !== 'mature');
  status.hidden = true;
  if (view.isConnected) build(!cards.length);
}

// ---- Power ------------------------------------------------------------------------------------
function power(view) {
  const confirmable = new Set(['restart', 'shutdown', 'logout']);
  let armed = null;
  const items = [['lock', 'Lock', 'lock'], ['sleep', 'Sleep', 'sleep'], ['restart', 'Restart', 'restart'], ['shutdown', 'Shut down', 'power'], ['logout', 'Log out', 'logout']];
  const box = h('div.power');
  const paint = () => box.replaceChildren(...items.map(([action, label, ico]) => h('button.pbtn' + (armed === action ? '.confirm' : ''), {
    'data-sq': 16,
    onclick: async () => {
      if (confirmable.has(action) && armed !== action) { armed = action; paint(); box.querySelector('.confirm')?.focus(); setTimeout(() => { if (armed === action) { armed = null; paint(); } }, 4000); return; }
      close();
      try { await api.power(action); } catch (e) { toast(e.message); }
    },
  }, h('span', { html: icon(ico) }), label, armed === action ? h('small', {}, 'Press again to confirm') : '')));
  paint();
  view.append(box);
  box.querySelector('button').focus();
}

post({ type: 'ready' });
if (new URLSearchParams(location.search).get('keys')) addEventListener('keydown', e => post({ type: 'key', key: e.key === ' ' ? 'space' : e.key.length === 1 ? 'char' : e.key }), true);

// opened directly in a browser (testing): show it right away
if (!window.webkit?.messageHandlers?.aerie) window.hub.open(new URLSearchParams(location.search).get('tab'));
