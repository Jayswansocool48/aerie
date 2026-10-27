// The desktop: your wallpaper with widgets on top. Customizing happens in Aerie Studio and the
// hub, not here. The same page also draws the preview inside Studio (?mode=preview) and the
// wallpaper behind the lock screen (?mode=lock, no widgets).
import { api, defaultWidget, MONITOR, normalizeConfig, STANDALONE, wallpaperFor, wallpaperSettings, WIDGET_TYPES } from './config.js';
import { QuickMenu } from './quickmenu.js';
import { installCssSprings } from './motion.js';
import { AppDrawer } from './drawer.js';
import { SceneView } from './scene.js';
import { SoundEngine } from './sound.js';
import { WidgetLayer } from './widgets.js';
import { itemFor, libraryItems, settingsKey, WallpaperLayer } from './wallpaper.js';

installCssSprings(); // CSS transitions here follow sampled spring curves

const MODE = new URLSearchParams(location.search).get('mode') || 'desktop'; // desktop · preview · lock
const $ = sel => document.querySelector(sel);
let cfg;
let saveTimer;
let kind = 'scene';
const sound = new SoundEngine();
document.documentElement.dataset.mode = MODE;

const scene = new SceneView($('#scene'), {
  onSelect: id => { scene.select(id); widgets.select(null); toStudio({ type: 'select-object', id }); },
  onObjectMoved: (id, patch) => {
    const o = cfg.objects.find(x => x.id === id);
    if (!o) return;
    Object.assign(o, patch);
    if (MODE === 'preview') toStudio({ type: 'object-moved', id, patch });
    else changed();
  },
  onAction: click => {
    if (MODE !== 'desktop') return;
    if (click.type === 'app' && click.value) launch(click.value);
    if (click.type === 'url' && /^https?:\/\//i.test(click.value)) window.open(click.value, '_blank', 'noopener');
    if (click.type === 'drawer') drawer.show();
  },
  onPanoramaError: () => toast('Could not load that 360° picture'),
});

const wall = new WallpaperLayer($('#wall'));

const widgets = new WidgetLayer($('#widgets'), {
  onSelect: id => { widgets.select(id); scene.select(null); toStudio({ type: 'select-widget', id }); },
  onChange: (id, patch, opts = {}) => {
    const w = cfg.widgets.find(x => x.id === id);
    if (!w) return;
    Object.assign(w, patch);
    if (!opts.silent) widgets.apply(cfg);
    if (MODE === 'preview') toStudio({ type: 'widget-changed', id, patch });
    else scheduleSave();
  },
  onLaunchError: msg => { sound.play('error'); toast(msg); },
  onLaunched: id => { sound.play('launch'); rememberLaunch(id); },
  onChime: () => sound.play('chime'),
  onOpenDrawer: () => drawer.show(),
  onTogglePin: id => togglePin(id),
});

const drawer = new AppDrawer($('#drawer'), {
  getApps: () => widgets.loadApps(),
  launch: id => launch(id),
  onOpen: () => { sound.play('open'); api.shell('front'); updatePause(); },
  onClose: () => { sound.play('close'); api.shell('back'); updatePause(); },
});

function toStudio(msg) { if (MODE === 'preview' && window.parent !== window) window.parent.postMessage({ aerie: true, ...msg }, location.origin); }

function changed() {
  applyAll();
  scheduleSave();
}

async function applyAll() {
  applyTheme(cfg);
  const choice = wallpaperFor(cfg, MONITOR);
  const items = choice.type === 'scene' ? [] : await libraryItems();
  const item = itemFor(choice, items);
  const settings = wallpaperSettings(cfg, settingsKey(choice, item));
  settings.fps = cfg.general.fps;
  kind = await wall.show(choice, settings);
  const is3d = kind === 'scene';
  document.body.dataset.wallpaper = kind;
  // the 3D look only runs while it's the wallpaper
  $('#bg').hidden = !is3d;
  $('#scene').hidden = !is3d;
  if (is3d) { applyBackground(cfg.scene); scene.apply(cfg); }
  scene.setPaused(!is3d || paused);
  const o = is3d ? cfg.scene.overlay || {} : {};
  $('#vignette').style.opacity = o.vignette ?? 0;
  $('#grain').style.opacity = o.grain ?? 0;
  if (MODE !== 'lock') widgets.apply(cfg);
  if (MODE === 'desktop') sound.configure(cfg.general.sound, is3d ? cfg.scene.sound : 'none', MONITOR === 0, cfg.scene.soundFile);
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
  if (res.ok) { sound.play('launch'); rememberLaunch(id); } else { sound.play('error'); toast('Could not open that app'); }
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
  sound.play(on ? 'toggleOff' : 'toggleOn');
  toast(on ? 'Unpinned from the dock' : 'Pinned to the dock');
}

// ---- look -----------------------------------------------------------------
const FONT_STACKS = {
  sans: 'Outfit, "Fira Sans", "Noto Sans", system-ui, sans-serif',
  serif: '"Noto Serif", "DejaVu Serif", Georgia, serif',
  mono: '"Fira Mono", "JetBrains Mono", "Noto Sans Mono", monospace',
  rounded: '"Nunito", "Comfortaa", Outfit, system-ui, sans-serif',
  display: '"Dela Gothic One", Outfit, system-ui, sans-serif',
  thin: 'Outfit, "Fira Sans", "Noto Sans", system-ui, sans-serif',
};

function applyTheme(c) {
  const t = c.theme, root = document.documentElement, r = root.style;
  r.setProperty('--font', FONT_STACKS[t.font] || FONT_STACKS.sans);
  r.setProperty('--font-weight', t.font === 'thin' ? '200' : t.font === 'display' ? '400' : '300');
  r.setProperty('--accent', t.accent);
  r.setProperty('--text', t.text);
  r.setProperty('--card', hexToRgba(t.widgetBg, t.widgetOpacity));
  r.setProperty('--card-solid', hexToRgba(t.widgetBg, Math.max(0.85, t.widgetOpacity)));
  r.setProperty('--blur', t.blur + 'px');
  r.setProperty('--radius', t.radius + 'px');
  r.setProperty('--icon', t.iconSize + 'px');
  r.setProperty('--edge', t.border ? 'rgba(255,255,255,.16)' : 'transparent');
  r.setProperty('--shadow', t.shadow ? '0 20px 60px rgba(0,0,0,.35)' : 'none');
  r.setProperty('--glow', t.glow ? `0 0 18px ${t.accent}` : 'none');
  r.setProperty('--text-shadow', t.textShadow ? '0 2px 12px rgba(0,0,0,.35)' : 'none');
  const reduce = c.general.reducedMotion === 'on' || (c.general.reducedMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.classList.toggle('reduce-motion', reduce);
  root.classList.toggle('no-entrance', !t.entrance);
}

function applyBackground(s) {
  const bg = s.background;
  const el = $('#bg');
  const video = $('#bg-video');
  el.style.background = '';
  el.dataset.type = bg.type;
  for (const [k, v] of Object.entries({ '--dim': bg.dim || 0, '--c1': bg.color1, '--c2': bg.color2, '--c3': bg.color3, '--speed': `${(28 / Math.max(0.1, bg.speed || 1)).toFixed(1)}s` })) {
    el.style.setProperty(k, v);
  }
  if (bg.type === 'gradient') el.style.background = `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})`;
  else if (bg.type === 'color') el.style.background = bg.color1;
  else if (bg.type === 'image' && bg.image) el.style.background = `center / cover no-repeat url("${bg.image}")`;
  if (bg.type === 'video' && bg.video) {
    if (video.getAttribute('src') !== bg.video) video.src = bg.video;
    video.hidden = false;
    video.play().catch(() => null);
  } else {
    video.hidden = true;
    video.pause();
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Film grain texture, made once in code (no image files).
(function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 40;
  }
  g.putImageData(img, 0, 0);
  $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
})();

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
  sound.play('open');
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
  sound.play('close');
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
  const library = await libraryItems();
  const scenes = library.filter(i => i.source === 'default' || i.type === 'model').slice(0, 10);
  const recent = library.filter(i => i.source !== 'default' && i.type !== 'model').slice(0, 8);
  items.push(
    { label: 'Open the hub', hint: 'Super+D', run: () => api.shell('hub') },
    { label: 'Aerie Studio…', hint: 'Ctrl+E', run: () => api.shell('studio') },
    '-',
    {
      label: 'Wallpaper', items: [
        ...scenes.map(i => ({ label: i.title, run: () => setWallpaper({ type: 'library', id: i.id }) })),
        ...(scenes.length ? ['-'] : []),
        ...recent.map(i => ({ label: i.title, run: () => setWallpaper({ type: 'library', id: i.id }) })),
        ...(recent.length ? ['-'] : []),
        { label: 'My 3D look', run: () => setWallpaper({ type: 'scene' }) },
        { label: 'More wallpapers…', run: () => api.shell('hub', 'wallpaper') },
      ],
    },
    { label: 'Add a widget', items: QUICK_WIDGETS.map(type => ({ label: WIDGET_TYPES[type], run: () => addWidgetAt(type, at) })) },
    { label: 'Move widgets', hint: 'Alt+drag', run: startArranging },
    { label: 'All apps', hint: 'Ctrl+Space', run: () => drawer.show() },
    '-',
    { label: manualPause ? 'Resume animation' : 'Pause animation', run: () => { manualPause = !manualPause; updatePause(); } },
    { label: cfg.general.sound.muted ? 'Unmute sounds' : 'Mute sounds', run: () => { cfg.general.sound.muted = !cfg.general.sound.muted; changed(); toast(cfg.general.sound.muted ? 'Sounds muted' : 'Sounds on'); } },
    '-',
    { label: 'Quit Aerie', run: () => { if (confirm('Quit Aerie? Your normal wallpaper comes back.')) api.shell('quit'); } },
  );
  sound.play('click');
  menu.show(e.clientX, e.clientY, items, w ? WIDGET_TYPES[w.type] : '');
});

function setWallpaper(choice) {
  document.body.classList.add('switching');
  setTimeout(() => {
    cfg.wallpaper = choice;
    if (cfg.screens) delete cfg.screens[String(MONITOR)];
    changed();
    requestAnimationFrame(() => document.body.classList.remove('switching'));
    sound.play('success');
  }, 280);
}

function addWidgetAt(type, at) {
  const w = defaultWidget(type);
  w.x = Math.max(0, Math.min(96 - (w.w / innerWidth) * 100, at.x));
  w.y = Math.max(0, Math.min(96 - (w.h / innerHeight) * 100, at.y));
  cfg.widgets.push(w);
  changed();
  sound.play('success');
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
let pauseReason = '';
let pauseOverridden = false; // ...but the mouse is on the wallpaper, so it can't be covered
let manualPause = false;     // paused from the right-click menu
let paused = false;
function updatePause() {
  const now = (manualPause || (pauseWanted && !pauseOverridden)) && !drawer.open && !arranging;
  if (now === paused) return;
  paused = now;
  scene.setPaused(now || kind !== 'scene');
  wall.setPaused(now);
  sound.setPaused(now);
  document.body.classList.toggle('paused', now);
  const video = $('#bg-video');
  if (!video.hidden) { if (now) video.pause(); else video.play().catch(() => null); }
}

// widgets drift with the camera
(function parallaxLoop() {
  requestAnimationFrame(parallaxLoop);
  if (paused || !cfg) return;
  const p = kind === 'scene' ? scene.pointerSmooth : wall.par;
  const k = cfg.camera.mode === 'fixed' && kind === 'scene' ? 0 : (kind === 'scene' ? cfg.camera.strength ?? 1 : 0.6);
  widgets.updateParallax(p.x * k, (kind === 'scene' ? p.y : -p.y) * k);
})();

// ---- interface sounds -----------------------------------------------------------------
$('#widgets').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.closest('.app') && !b.classList.contains('app')) sound.play(b.classList.contains('app-star') ? 'toggleOn' : 'click');
});
$('#drawer').addEventListener('click', e => { if (e.target.closest('.app-cat')) sound.play('click'); });
let lastHover = null;
document.addEventListener('pointerover', e => {
  const app = e.target.closest?.('#widgets .app, #drawer .drawer-app');
  if (app && app !== lastHover) sound.play('hover');
  lastHover = app;
});

// Fade the soundscape out while music or a video is playing (checked only while ambient sound is on).
setInterval(async () => {
  const s = cfg?.general.sound;
  if (MODE !== 'desktop' || MONITOR !== 0 || !s?.ambient || !s.pauseForMusic || cfg.scene.sound === 'none' || STANDALONE) { sound.duck(false); return; }
  const np = await api.nowPlaying();
  sound.duck(np?.active && np.playing);
}, 5000);

window.aerie = {
  setPaused(on, reason = '') { pauseWanted = !!on; pauseReason = reason; pauseOverridden = false; updatePause(); },
  openDrawer: () => drawer.show(),
  arrange: () => startArranging(),
  async reloadConfig() {
    const saved = await api.loadConfig();
    if (saved) { cfg = normalizeConfig(saved); await libraryItems(true); applyAll(); }
  },
  /** Snapshot helpers for the lock screen picture and previews. */
  kind: () => kind,
};

// Aerie Studio drives its preview through messages
window.addEventListener('message', e => {
  if (MODE !== 'preview' || e.origin !== location.origin || !e.data?.aerie) return;
  const m = e.data;
  if (m.type === 'config') { cfg = normalizeConfig(m.config); if (m.fresh) libraryItems(true).then(applyAll); else applyAll(); }
  if (m.type === 'edit') { scene.setEditMode(!!m.on); widgets.setEditMode(!!m.on); widgets.apply(cfg); }
  if (m.type === 'select-object') scene.select(m.id);
  if (m.type === 'select-widget') widgets.select(m.id);
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
    setTimeout(() => toast('Welcome to Aerie! Press Super+D for the hub, or right-click the desktop'), 1200);
  }
})();

