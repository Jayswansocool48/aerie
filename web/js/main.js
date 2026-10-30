// The desktop: your wallpaper with widgets on top. Choosing and making wallpapers happens in Aerie
// Studio. The same page also draws the preview inside Studio (?mode=preview) and the wallpaper
// behind the lock screen (?mode=lock, no widgets).
import { api, defaultWidget, MONITOR, normalizeConfig, STANDALONE, wallpaperFor, wallpaperSettings, WIDGET_TYPES } from './config.js';
import { QuickMenu } from './quickmenu.js';
import { installCssSprings } from './motion.js';
import { AppDrawer } from './drawer.js';
import { WidgetLayer } from './widgets.js';
import { itemFor, libraryItems, WallpaperLayer } from './wallpaper.js';
import './audio.js';

installCssSprings(); // CSS transitions here follow sampled spring curves

const MODE = new URLSearchParams(location.search).get('mode') || 'desktop'; // desktop · preview · lock
const $ = sel => document.querySelector(sel);
let cfg;
let saveTimer;
let kind = 'none';
let override = null; // Studio's unsaved edits (shader code, layer layout…), shown live in its preview
document.documentElement.dataset.mode = MODE;

const wall = new WallpaperLayer($('#wall'), {
  onShaderError: (message, item) => toStudio({ type: 'shader-error', message, id: item?.id }),
  onReady: (k, item) => toStudio({ type: 'shown', kind: k, id: item?.id, audio: !!item?.audio }),
});

const widgets = new WidgetLayer($('#widgets'), {
  onSelect: id => { widgets.select(id); toStudio({ type: 'select-widget', id }); },
  onChange: (id, patch, opts = {}) => {
    const w = cfg.widgets.find(x => x.id === id);
    if (!w) return;
    Object.assign(w, patch);
    if (!opts.silent) widgets.apply(cfg);
    if (MODE === 'preview') toStudio({ type: 'widget-changed', id, patch });
    else scheduleSave();
  },
  onLaunchError: msg => toast(msg),
  onLaunched: id => rememberLaunch(id),
  onChime: () => null,
  onOpenDrawer: () => drawer.show(),
  onTogglePin: id => togglePin(id),
});

const drawer = new AppDrawer($('#drawer'), {
  getApps: () => widgets.loadApps(),
  launch: id => launch(id),
  onOpen: () => { api.shell('front'); updatePause(); },
  onClose: () => { api.shell('back'); updatePause(); },
});

function toStudio(msg) { if (MODE === 'preview' && window.parent !== window) window.parent.postMessage({ aerie: true, ...msg }, location.origin); }

function changed() {
  applyAll();
  scheduleSave();
}

async function applyAll(fresh = false) {
  applyTheme(cfg);
  let choice = wallpaperFor(cfg, MONITOR);
  const items = await libraryItems();
  let item = itemFor(choice, items);
  // Studio is editing something: show that instead (a saved wallpaper, or a draft not saved yet)
  if (override) {
    if (override.id === 'draft') item = { id: 'draft', type: override.kind, title: 'Draft', properties: override.properties || {}, audio: !!override.audio, fileUrl: '' };
    else item = items.find(i => i.id === override.id) || item;
    choice = { type: 'library', id: item?.id };
  }
  const settings = wallpaperSettings(cfg, item?.id || 'none');
  settings.fps = cfg.general.fps;
  kind = await wall.show(choice, settings, { fresh, override: override && override.id === item?.id ? override : null, item });
  document.body.dataset.wallpaper = kind;
  if (MODE !== 'lock') widgets.apply(cfg);
}

function scheduleSave() {
  if (STANDALONE || MODE !== 'desktop') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api.saveConfig(cfg);
      api.shell('config-changed');
    } catch { toast('Could not save your changes'); }
  }, 600);
}

// ---- apps -------------------------------------------------------------------
async function launch(id) {
  const res = await api.launch(id);
  if (res.ok) rememberLaunch(id); else toast('Could not open that app');
}

function rememberLaunch(id) {
  cfg.general.recent = [id, ...(cfg.general.recent || []).filter(x => x !== id)].slice(0, 12);
  scheduleSave();
}

function togglePin(id) {
  const pinned = cfg.general.pinned || [];
  const on = pinned.includes(id);
  cfg.general.pinned = on ? pinned.filter(x => x !== id) : [...pinned, id];
  widgets.apply(cfg);
  scheduleSave();
  toast(on ? 'Unpinned from the dock' : 'Pinned to the dock');
}

// ---- widget style -------------------------------------------------------------
const FONT_STACKS = {
  sans: 'Outfit, "Noto Sans", system-ui, sans-serif',
  thin: 'Outfit, "Noto Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Noto Sans Mono", monospace',
  serif: '"Noto Serif", "DejaVu Serif", Georgia, serif',
};

function applyTheme(c) {
  const t = c.theme, root = document.documentElement, r = root.style;
  r.setProperty('--font', FONT_STACKS[t.font] || FONT_STACKS.sans);
  r.setProperty('--font-weight', t.font === 'thin' ? '200' : '300');
  r.setProperty('--accent', t.accent);
  r.setProperty('--text', t.text);
  r.setProperty('--card', hexToRgba(t.widgetBg, t.widgetOpacity));
  r.setProperty('--card-solid', hexToRgba(t.widgetBg, Math.max(0.85, t.widgetOpacity)));
  r.setProperty('--radius', t.radius + 'px');
  r.setProperty('--icon', t.iconSize + 'px');
  r.setProperty('--edge', t.border ? 'rgba(228, 237, 238, .12)' : 'transparent');
  r.setProperty('--shadow', t.shadow ? '0 4px 10px rgba(0, 0, 0, .12)' : 'none');
  r.setProperty('--glow', 'none');
  r.setProperty('--text-shadow', t.textShadow ? '0 1px 6px rgba(0, 0, 0, .35)' : 'none');
  const reduce = c.general.reducedMotion === 'on' || (c.general.reducedMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.classList.toggle('reduce-motion', reduce);
  root.classList.toggle('no-entrance', !t.entrance);
}

function hexToRgba(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---- moving widgets right on the desktop -------------------------------------------
let arranging = false;
function startArranging() {
  if (arranging) return;
  arranging = true;
  drawer.hide();
  api.shell('front');
  widgets.setEditMode(true);
  widgets.apply(cfg);
  document.body.classList.add('arranging');
  $('#arrange-bar').hidden = false;
  $('#arrange-bar button').focus();
  updatePause();
}
function stopArranging() {
  if (!arranging) return;
  arranging = false;
  widgets.setEditMode(false);
  widgets.apply(cfg);
  document.body.classList.remove('arranging');
  $('#arrange-bar').hidden = true;
  api.shell('back');
  updatePause();
}
$('#arrange-bar button').addEventListener('click', stopArranging);

// ---- right-click the desktop: quick actions ------------------------------------------
const menu = new QuickMenu($('#quickmenu'));
const QUICK_WIDGETS = ['clock', 'date', 'notes', 'todo', 'nowplaying', 'system', 'calendar', 'timer', 'dock', 'search', 'quote', 'moon'];

window.addEventListener('contextmenu', async e => {
  if (MODE !== 'desktop' || e.target.closest('#drawer, #quickmenu, input, textarea')) return;
  e.preventDefault();
  const node = e.target.closest('.widget');
  const w = node && cfg.widgets.find(x => x.id === node.dataset.id);
  const at = { x: Math.round((e.clientX / innerWidth) * 1000) / 10, y: Math.round((e.clientY / innerHeight) * 1000) / 10 };
  const items = [];
  if (w) {
    items.push(
      { label: 'Widget settings…', run: () => api.shell('studio', 'widgets') },
      { label: 'Hide this widget', run: () => { w.visible = false; changed(); toast('Hidden. Show it again in Aerie Studio → Widgets.'); } },
      { label: 'Remove this widget', danger: true, run: () => removeWidget(w) },
      '-',
    );
  }
  const library = (await libraryItems()).filter(i => cfg.general.showMature || i.rating === 'everyone');
  const current = itemFor(wallpaperFor(cfg, MONITOR), library);
  const favorites = library.filter(i => i.favorite).slice(0, 8);
  const recent = library.filter(i => !i.favorite).slice(0, 10);
  const pick = i => ({ label: i.title, hint: i.id === current?.id ? 'Now' : '', run: () => setWallpaper({ type: 'library', id: i.id }) });
  items.push(
    { label: 'Aerie Studio…', hint: 'Ctrl+E', run: () => api.shell('studio') },
    { label: 'Make a wallpaper…', run: () => api.shell('studio', 'create') },
    '-',
    {
      label: 'Wallpaper', items: [
        ...favorites.map(pick),
        ...(favorites.length ? ['-'] : []),
        ...recent.map(pick),
        '-',
        { label: 'Random wallpaper', run: () => { const pool = library.filter(i => i.id !== current?.id); if (pool.length) setWallpaper({ type: 'library', id: pool[Math.floor(Math.random() * pool.length)].id }); } },
        { label: 'All wallpapers…', run: () => api.shell('studio', 'library') },
      ],
    },
    { label: 'Add a widget', items: QUICK_WIDGETS.map(type => ({ label: WIDGET_TYPES[type], run: () => addWidgetAt(type, at) })) },
    { label: 'Move widgets', hint: 'Alt+drag', run: startArranging },
    { label: 'All apps', hint: 'Ctrl+Space', run: () => drawer.show() },
    '-',
    { label: manualPause ? 'Resume the wallpaper' : 'Pause the wallpaper', run: () => { manualPause = !manualPause; updatePause(); } },
    '-',
    { label: 'Quit Aerie', run: () => api.shell('quit') },
  );
  menu.show(e.clientX, e.clientY, items, w ? WIDGET_TYPES[w.type] : '');
});

function setWallpaper(choice) {
  document.body.classList.add('switching');
  setTimeout(() => {
    cfg.wallpaper = choice;
    if (cfg.screens) delete cfg.screens[String(MONITOR)];
    changed();
    requestAnimationFrame(() => document.body.classList.remove('switching'));
  }, 280);
}

function addWidgetAt(type, at) {
  const w = defaultWidget(type);
  w.x = Math.max(0, Math.min(96 - (w.w / innerWidth) * 100, at.x));
  w.y = Math.max(0, Math.min(96 - (w.h / innerHeight) * 100, at.y));
  cfg.widgets.push(w);
  changed();
  toast(`${WIDGET_TYPES[type]} added. Hold Alt and drag to move it.`);
}

let lastRemoved = null;
function removeWidget(w) {
  lastRemoved = { w, index: cfg.widgets.indexOf(w) };
  cfg.widgets = cfg.widgets.filter(x => x !== w);
  changed();
  toast('Widget removed. Press Ctrl+Z to bring it back.');
}

let toastTimer;
function toast(msg) {
  if (MODE === 'lock') return;
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('pop');
  void t.offsetWidth;
  t.classList.add('pop');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---- keyboard -------------------------------------------------------------------
window.addEventListener('keydown', e => {
  if (MODE !== 'desktop') return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); api.shell('studio'); }
  else if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); drawer.open ? drawer.hide() : drawer.show(); }
  else if (e.key === 'Escape' && arranging) { e.preventDefault(); stopArranging(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && lastRemoved && !typing) {
    e.preventDefault();
    cfg.widgets.splice(Math.min(lastRemoved.index, cfg.widgets.length), 0, lastRemoved.w);
    lastRemoved = null;
    changed();
    toast('Widget is back');
  }
});

let cornerTimer;
window.addEventListener('pointermove', e => {
  // The mouse can only reach the wallpaper where nothing covers it, so a pause here is a mistake.
  if (pauseWanted && !pauseOverridden && !manualPause) {
    pauseOverridden = true;
    updatePause();
    api.shell('pause-overridden');
  }
  const corner = cfg?.general.drawerCorner;
  if (MODE !== 'desktop' || !corner || corner === 'none' || drawer.open) return;
  const top = e.clientY < 6, bottom = e.clientY > innerHeight - 6, left = e.clientX < 6, right = e.clientX > innerWidth - 6;
  const hit = { 'top-left': top && left, 'top-right': top && right, 'bottom-left': bottom && left, 'bottom-right': bottom && right }[corner];
  if (hit && !cornerTimer) cornerTimer = setTimeout(() => { drawer.show(); cornerTimer = null; }, 180);
  if (!hit && cornerTimer) { clearTimeout(cornerTimer); cornerTimer = null; }
});

// ---- pausing while you use an app (told by the desktop app, per screen) ----------------
let pauseWanted = false;     // the desktop app says a window covers this screen
let pauseOverridden = false; // ...but the mouse is on the wallpaper, so it can't be covered
let manualPause = false;     // paused from the right-click menu
let paused = false;
function updatePause() {
  const now = (manualPause || (pauseWanted && !pauseOverridden)) && !drawer.open && !arranging;
  if (now === paused) return;
  paused = now;
  wall.setPaused(now);
  document.body.classList.toggle('paused', now);
}

// widgets drift a little with the mouse, like the wallpaper behind them
const par = { x: 0, y: 0 }, ptr = { x: 0, y: 0 };
window.addEventListener('pointermove', e => { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; });
(function parallaxLoop() {
  requestAnimationFrame(parallaxLoop);
  if (paused || !cfg) return;
  par.x += (ptr.x - par.x) * 0.06;
  par.y += (ptr.y - par.y) * 0.06;
  widgets.updateParallax(par.x * 0.6, -par.y * 0.6);
})();

window.aerie = {
  setPaused(on) { pauseWanted = !!on; pauseOverridden = false; updatePause(); },
  openDrawer: () => drawer.show(),
  arrange: () => startArranging(),
  async reloadConfig() {
    const saved = await api.loadConfig();
    if (saved) { cfg = normalizeConfig(saved); await libraryItems(true); applyAll(); }
  },
  kind: () => kind,
};

// Aerie Studio drives its preview through messages
window.addEventListener('message', async e => {
  if (MODE !== 'preview' || e.origin !== location.origin || !e.data?.aerie) return;
  const m = e.data;
  if (m.type === 'config') {
    cfg = normalizeConfig(m.config);
    if (m.fresh) await libraryItems(true);
    applyAll(!!m.reload);
  }
  if (m.type === 'override') { override = m.override; applyAll(true); }
  if (m.type === 'edit') { widgets.setEditMode(!!m.on); widgets.apply(cfg); }
  if (m.type === 'select-widget') widgets.select(m.id);
  if (m.type === 'pause') wall.setPaused(!!m.on);
  if (m.type === 'snapshot') {
    const blob = await wall.snapshot(m.width || 640);
    toStudio({ type: 'snapshot', id: m.id, blob });
  }
});

// ---- start ----------------------------------------------------------------
(async function start() {
  if (MODE === 'preview') {
    document.body.dataset.monitor = MONITOR;
    toStudio({ type: 'ready' });
    return; // Studio sends the setup to show
  }
  cfg = normalizeConfig(await api.loadConfig());
  await applyAll();
  document.body.dataset.monitor = MONITOR;
  if (MODE === 'desktop' && !cfg.general.welcomed && MONITOR === 0 && !STANDALONE) {
    cfg.general.welcomed = true;
    scheduleSave();
    setTimeout(() => toast('Welcome to Aerie. Right-click the desktop, or open Aerie Studio to pick a wallpaper.'), 1200);
  }
})();
