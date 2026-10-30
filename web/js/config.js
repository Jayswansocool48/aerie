// Settings model (defaults for every option) and the small API client that talks to the local server.

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
// the per-run key comes in the address fragment and stays in memory only (never in browser storage);
// pages pass the fragment on to the pages they open
const TOKEN = hash.get('token') || '';
export const MONITOR = Number(params.get('monitor') || 0);
export const STANDALONE = !TOKEN; // opened without the app (e.g. a plain file): keep working, just without saving

try { sessionStorage.removeItem('aerie-token'); } catch { /* storage unavailable */ } // older versions kept it there

export const uid = () => Math.random().toString(36).slice(2, 10);

export const CARD_STYLES = { solid: 'Solid', outline: 'Outline', clear: 'No card' };
export const FONTS = { sans: 'Outfit', thin: 'Outfit Light', mono: 'JetBrains Mono', serif: 'Serif (system)' };

export const WIDGET_GROUPS = {
  'Time': { clock: 'Clock', date: 'Date', worldclock: 'World clocks', countdown: 'Countdown', calendar: 'Calendar', timer: 'Focus timer' },
  'Apps': { dock: 'Dock', apps: 'App launcher', favorites: 'Favorite apps', search: 'Search', links: 'Quick links' },
  'Info': { system: 'System monitor', graph: 'Live graph', nowplaying: 'Now playing', moon: 'Moon phase' },
  'Personal': { greeting: 'Greeting', notes: 'Notes', todo: 'To-do list', quote: 'Quote', text: 'Text label', image: 'Image', slideshow: 'Photo slideshow' },
};
export const WIDGET_TYPES = Object.assign({}, ...Object.values(WIDGET_GROUPS));

export const APP_CATEGORIES = {
  all: 'All', Game: 'Games', Development: 'Develop', Graphics: 'Graphics', Network: 'Internet',
  AudioVideo: 'Media', Office: 'Office', System: 'System', Utility: 'Utilities',
};

export const WIDGET_SIZES = {
  clock: [320, 150], date: [300, 90], greeting: [420, 90], system: [300, 210], apps: [560, 460],
  favorites: [420, 96], notes: [300, 240], calendar: [300, 300], text: [360, 90], image: [300, 220],
  dock: [560, 92], search: [520, 64], links: [320, 200], worldclock: [340, 190], countdown: [320, 140],
  timer: [280, 230], graph: [320, 150], nowplaying: [380, 130], moon: [220, 220], todo: [300, 280],
  quote: [460, 150], slideshow: [360, 240],
};

export function defaultWidget(type = 'clock') {
  const [w, h] = WIDGET_SIZES[type] || [300, 160];
  const base = { id: uid(), type, x: 6, y: 8, w, h, depth: 0.4, visible: true, card: true, cardStyle: '', motion: '', style: {} };
  const settings = {
    clock: { format: '24', seconds: false, analog: false, size: 0 },
    date: { long: true },
    greeting: { name: '' },
    system: { cpu: true, memory: true, disk: true, battery: true, network: false },
    apps: { columns: 5, search: true, layout: 'grid', labels: true, categories: true, sort: 'name' },
    favorites: { apps: [], labels: false },
    notes: { text: '' },
    calendar: { weekStart: 0 },
    text: { text: 'Hello, desktop', size: 40, align: 'left', weight: 600 },
    image: { url: '', alt: '', fit: 'cover' },
    dock: { apps: [], magnify: true, iconSize: 52, labels: false, drawerButton: true },
    search: { placeholder: 'Search apps…', web: 'none' },
    links: { items: [{ label: 'GitHub', url: 'https://github.com' }, { label: 'Pop!_OS', url: 'https://system76.com/pop' }] },
    worldclock: { format: '24', zones: [{ label: 'New York', tz: 'America/New_York' }, { label: 'London', tz: 'Europe/London' }, { label: 'Tokyo', tz: 'Asia/Tokyo' }] },
    countdown: { label: 'New Year', date: `${new Date().getFullYear() + 1}-01-01T00:00` },
    timer: { minutes: 25, breakMinutes: 5 },
    graph: { metric: 'cpu' },
    nowplaying: { art: true, controls: true },
    moon: { labels: true },
    todo: { title: 'To do', items: [] },
    quote: { source: 'builtin', text: '', author: '', minutes: 30 },
    slideshow: { images: [], seconds: 12, fit: 'cover' },
  };
  return { ...base, settings: settings[type] || {} };
}

export function defaultTheme() {
  return {
    font: 'sans', accent: '#00bba7', text: '#e4edee', widgetBg: '#061415', widgetOpacity: 0.78,
    cardStyle: 'solid', blur: 0, radius: 14, border: true, shadow: true, tilt: false, tiltAmount: 6,
    glow: false, iconSize: 48, entrance: true, textShadow: true,
    widgetMotion: 'parallax', // parallax: drift with the wallpaper · still: stay put · 3d: turn in space
  };
}

export function defaultConfig() {
  // a fresh start: the first wallpaper that comes with Aerie, with a clock and the date
  return normalizeConfig({
    wallpaper: { type: 'default' },
    widgets: [defaultWidget('clock'), Object.assign(defaultWidget('date'), { y: 26 })].map(w => Object.assign(w, { card: false, x: 5 })),
  });
}

/** Which wallpaper a screen shows: its own choice, or the one for all screens. */
export function wallpaperFor(cfg, monitor = MONITOR) {
  return (cfg.screens && cfg.screens[String(monitor)]) || cfg.wallpaper || { type: 'default' };
}

/** The library item a choice points to ('default' = the first wallpaper that comes with Aerie). */
export function itemFor(choice, items) {
  if (choice?.type === 'library' || (choice?.type === 'default' && choice.id)) return items.find(i => i.id === choice.id) || null;
  if (choice?.type === 'default') return items.find(i => i.source === 'default') || null;
  return null;
}

/** Your settings for one wallpaper (its own options, fit, speed and sound). */
export function wallpaperSettings(cfg, key) {
  return deepMerge({ props: {}, fit: 'cover', speed: 1, sound: false, volume: 50, motion: 1, exposure: 1, background: '', shadows: true,
    quality: 1, react: true },
    (cfg.wallpaperProps || {})[key] || {});
}

function defaultGeneral() {
  return {
    reducedMotion: 'system', fps: 60, drawerCorner: 'none', recent: [], pinned: [],
    welcomed: false,
    pauseWhen: 'maximized', // maximized · focused · never
    online: false,          // Openverse and Poly Haven in Studio (off until you turn it on)
    audioReactive: true,    // wallpapers that react to sound may listen to your speakers
    showMature: false,
    lockScreen: { clock: true, date: true, media: true, battery: true, blur: 0, dim: 0.25, message: '', power: true },
  };
}

const OLD_CARDS = { frosted: 'solid', liquid: 'solid', neon: 'outline' };

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return defaultConfig();
  raw = { ...raw };
  // Aerie 2.x: the editable 3D look and its presets are gone; those setups get the default wallpaper
  if (raw.wallpaper?.type === 'scene') raw.wallpaper = { type: 'default' };
  for (const [k, v] of Object.entries(raw.screens || {})) if (v?.type === 'scene') delete raw.screens[k];
  for (const k of ['scene', 'objects', 'camera', 'presetName']) delete raw[k];
  if (raw.general && raw.general.online === undefined && raw.general.libraryConsent !== undefined) raw.general.online = !!raw.general.libraryConsent;
  const base = { version: 5, wallpaper: { type: 'default' }, screens: {}, wallpaperProps: {}, theme: defaultTheme(), general: defaultGeneral() };
  const merged = deepMerge(base, raw);
  merged.version = 5;
  for (const k of ['sound', 'myLooks', 'lock', 'matchTaskbar', 'libraryConsent', 'hub', 'clipboard', 'editorHint']) delete merged.general[k];
  merged.theme.cardStyle = OLD_CARDS[merged.theme.cardStyle] || (CARD_STYLES[merged.theme.cardStyle] ? merged.theme.cardStyle : 'solid');
  if (!FONTS[merged.theme.font]) merged.theme.font = 'sans';
  merged.widgets = (raw.widgets || []).map(w => {
    const d = defaultWidget(w.type);
    const m = deepMerge(d, w);
    m.settings = deepMerge(d.settings, w.settings || {});
    if (OLD_CARDS[m.cardStyle]) m.cardStyle = OLD_CARDS[m.cardStyle];
    return m;
  });
  return merged;
}

export function deepMerge(target, source) {
  if (Array.isArray(source)) return source.slice();
  if (!source || typeof source !== 'object') return source === undefined ? target : source;
  const out = Array.isArray(target) ? [] : { ...(target || {}) };
  for (const [k, v] of Object.entries(source)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && target && typeof target[k] === 'object'
      ? deepMerge(target[k], v) : (Array.isArray(v) ? v.slice() : v);
  }
  return out;
}

export const clone = v => JSON.parse(JSON.stringify(v));

// ---- API -----------------------------------------------------------------
async function call(method, path, body, extraHeaders = {}) {
  if (STANDALONE) throw new Error('offline');
  const res = await fetch(path, {
    method,
    headers: { 'X-Aerie-Token': TOKEN, ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// Idempotency keys: one key per thing you asked for (this file, this web address…). A double
// click or a retry sends the same key, and the server answers it once. After a success the key
// is dropped, so asking again later (say, re-adding a file you removed) is a new request.
const intents = new Map();
async function once(intent, method, path, body, headers = {}) {
  let key = intents.get(intent);
  if (!key) intents.set(intent, key = (crypto.randomUUID?.() || uid() + uid() + uid()));
  const res = await call(method, path, body, { ...headers, 'Idempotency-Key': key });
  intents.delete(intent);
  return res;
}

export const api = {
  loadConfig: () => call('GET', '/api/config').then(d => d.config).catch(() => null),
  saveConfig: cfg => call('PUT', '/api/config', cfg),
  apps: () => call('GET', '/api/apps').then(d => d.apps).catch(() => []),
  refreshApps: () => call('POST', '/api/apps/refresh').then(d => d.apps).catch(() => []),
  launch: id => once('launch:' + id, 'POST', '/api/launch', { id }).catch(() => ({ ok: false })),
  system: () => call('GET', '/api/system').catch(() => null),
  upload: file => once(`media:${file.name}:${file.size}:${file.lastModified}`, 'POST', '/api/media', file, { 'X-Filename': encodeURIComponent(file.name) }).then(d => d.url),
  autostart: () => call('GET', '/api/autostart').then(d => d.enabled).catch(() => false),
  setAutostart: enabled => call('POST', '/api/autostart', { enabled }).then(d => d.enabled),
  deleteData: () => call('POST', '/api/delete-data'),
  uninstall: () => call('POST', '/api/uninstall'),
  installInfo: () => call('POST', '/api/install-info').catch(() => ({ installed: false, canUpdate: false, version: '' })),
  update: () => call('POST', '/api/update'),
  restart: () => call('POST', '/api/restart'),
  shell: (action, extra) => call('POST', '/api/shell', { action, monitor: MONITOR, extra }).catch(() => null),
  // your wallpaper library
  wallpapers: () => call('GET', '/api/wallpapers').then(d => d.items).catch(() => []),
  steam: () => call('GET', '/api/wallpapers/steam').catch(() => ({ steam: false, count: 0 })),
  scene: id => call('GET', '/api/wallpapers/scene?id=' + encodeURIComponent(id)),
  importPath: path => once('import:' + path, 'POST', '/api/wallpapers/import', { path }),
  pickWallpaper: folder => once('pick', 'POST', '/api/wallpapers/pick', { folder }),
  uploadWallpaper: file => once(`upload:${file.name}:${file.size}:${file.lastModified}`, 'POST', '/api/wallpapers/upload', file, { 'X-Filename': encodeURIComponent(file.name) }),
  addUrl: (url, title) => once('url:' + url, 'POST', '/api/wallpapers/url', { url, title }),
  removeWallpaper: id => call('POST', '/api/wallpapers/remove', { id }),
  updateWallpaper: (id, changes) => call('POST', '/api/wallpapers/update', { id, ...changes }),
  unhideWallpapers: () => call('POST', '/api/wallpapers/unhide'),
  // making wallpapers
  createShader: (title, code) => once('shader:' + title + code.length, 'POST', '/api/wallpapers/shader', { title, code }).then(d => d.item),
  updateShader: (id, code) => call('POST', '/api/wallpapers/shader', { id, code }).then(d => d.item),
  createParallax: (title, spec) => once('parallax:' + title, 'POST', '/api/wallpapers/parallax', { title, spec }).then(d => d.item),
  createStage: (title, spec) => once('stage:' + title, 'POST', '/api/wallpapers/stage', { title, spec }).then(d => d.item),
  saveSpec: (id, spec) => call('POST', '/api/wallpapers/spec', { id, spec }).then(d => d.item),
  uploadLayer: (id, file) => once(`layer:${id}:${file.name}:${file.size}`, 'POST', '/api/wallpapers/layer?id=' + encodeURIComponent(id), file,
    { 'X-Filename': encodeURIComponent(file.name) }).then(d => d.file),
  savePreview: (id, blob) => call('POST', '/api/wallpapers/preview?id=' + encodeURIComponent(id), blob).then(d => d.item).catch(() => null),
  wallpaperFile: async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('not found'); return r; },
  // online content (only after you allowed it)
  openverse: (q, page = 1) => call('GET', `/api/openverse?q=${encodeURIComponent(q)}&page=${page}`).then(d => d.items),
  openverseImport: id => once('ov:' + id, 'POST', '/api/openverse/import', { id }).then(d => d.item),
  polyhaven: (kind, q = '') => call('GET', `/api/polyhaven?kind=${kind}&q=${encodeURIComponent(q)}`).then(d => d.items),
  polyhavenSky: id => once('sky:' + id, 'POST', '/api/polyhaven/sky', { id }).then(d => d.item),
  polyhavenLocal: (kind, id, res) => call('GET', `/api/polyhaven/local?kind=${kind}&id=${encodeURIComponent(id)}&res=${res}`),
  polyhavenFetch: (kind, id, res) => call('POST', '/api/polyhaven/fetch', { kind, id, res }).then(d => d.url),
  clearCache: () => call('POST', '/api/cache/clear'),
  // the AI
  assistant: () => call('GET', '/api/assistant'),
  assistantSettings: changes => call('POST', '/api/assistant/settings', changes),
  ollamaModels: () => call('GET', '/api/assistant/ollama-models').catch(() => ({ models: [] })),
  create: (prompt, mode, revise) => once('ai:' + mode + prompt + (revise?.id || ''), 'POST', '/api/assistant/create', { prompt, mode, revise }).then(d => d.job),
  job: id => call('GET', '/api/assistant/job?id=' + encodeURIComponent(id)),
  // sound and the lock screen
  audio: () => call('GET', '/api/audio').catch(() => ({ available: false })),
  lockStatus: () => call('GET', '/api/lock/status').catch(() => ({})),
  lockInfo: () => call('GET', '/api/lock/info').catch(() => ({ name: '' })),
  setLockEnabled: on => call('POST', '/api/lock/enable', { on }),
  removeLockSwitch: () => call('POST', '/api/lock/remove-switch'),
  previewLock: () => call('POST', '/api/lock/preview'),
  lockNow: () => call('POST', '/api/lock/now').catch(() => ({ ok: false })),
  nowPlaying: () => call('GET', '/api/now-playing').catch(() => ({ available: false })),
  playerControl: action => call('POST', '/api/now-playing', { action }).catch(() => ({ ok: false })),
};
