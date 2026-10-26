// Settings model (defaults for every option) and the small API client that talks to the local server.
import { PRESETS } from './presets.js';

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const TOKEN = hash.get('token') || sessionStorageGet('aerie-token') || '';
sessionStorageSet('aerie-token', TOKEN);
export const MONITOR = Number(params.get('monitor') || 0);
export const STANDALONE = !TOKEN; // opened without the app (e.g. a plain file) — keep working, just without saving

function sessionStorageGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function sessionStorageSet(key, value) { try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ } }

export const uid = () => Math.random().toString(36).slice(2, 10);

export const SHAPES = {
  cube: 'Cube', sphere: 'Sphere', torus: 'Ring donut', knot: 'Torus knot', icosahedron: 'Crystal',
  octahedron: 'Diamond', dodecahedron: 'Gem', cone: 'Pyramid', cylinder: 'Pillar', ring: 'Halo', capsule: 'Capsule',
  tree: 'Tree', pine: 'Pine tree', rock: 'Rock', tower: 'City tower', lantern: 'Paper lantern',
  model: 'My 3D model (.glb)',
};
export const MATERIALS = {
  standard: 'Matte', glossy: 'Glossy', metal: 'Metal', glass: 'Glass', toon: 'Cartoon', wireframe: 'Wireframe',
  emissive: 'Glowing', holo: 'Hologram',
};
export const BACKGROUNDS = {
  gradient: 'Gradient', aurora: 'Aurora (animated)', mesh: 'Flowing colors (animated)', color: 'Solid color',
  panorama: '360° sky or photo (look around)', image: 'Image', video: 'Video (loops)', transparent: 'See-through (show COSMIC wallpaper)',
};
export const PARTICLE_STYLES = {
  dust: 'Floating dust', stars: 'Twinkling stars', fireflies: 'Fireflies', snow: 'Snow', rain: 'Rain', bubbles: 'Bubbles', petals: 'Falling petals',
};
export const CARD_STYLES = {
  frosted: 'Frosted glass', liquid: 'Liquid glass', solid: 'Solid', outline: 'Outline', neon: 'Neon edge', clear: 'No card',
};
export const FONTS = {
  sans: 'Clean (sans)', serif: 'Classic (serif)', mono: 'Code (mono)', rounded: 'Rounded', display: 'Game title', thin: 'Thin & airy',
};

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

export function defaultObject(shape = 'icosahedron') {
  return {
    id: uid(), name: SHAPES[shape] || 'Object', shape, model: '', visible: true,
    color: '#ff9e3d', material: 'glossy', glow: 0.0,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1,
    spin: { enabled: true, x: 0.1, y: 0.35, z: 0 },
    float: { enabled: true, amount: 0.15, speed: 0.6 },
    interact: { dragRotate: true, hover: 'grow', lookAtMouse: false },
    click: { type: 'none', value: '' },
  };
}

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
    font: 'sans', accent: '#ff9e3d', text: '#f5f3ff', widgetBg: '#141022', widgetOpacity: 0.55,
    cardStyle: 'frosted', blur: 18, radius: 20, border: true, shadow: true, tilt: true, tiltAmount: 8,
    glow: false, iconSize: 48, entrance: true, textShadow: true,
    widgetMotion: 'parallax', // parallax: drift with the camera · still: stay put · 3d: turn in space like a game menu
  };
}

export function defaultScene() {
  return {
    background: {
      type: 'gradient', color1: '#0b1020', color2: '#2a1240', color3: '#0e3a4a', angle: 160, image: '', video: '', dim: 0, speed: 1,
      panorama: '', blur: 0, brightness: 1, lighting: 1, rotation: 0, credit: '', libraryId: '',
    },
    fog: { enabled: true, color: '#120d24', density: 0.035 },
    particles: { enabled: true, style: 'dust', count: 900, color: '#ffd7a3', size: 0.05, speed: 0.2 },
    floor: { enabled: false, color: '#ff9e3d' },
    light: { ambient: 0.45, color: '#ffffff', intensity: 2.2, rim: '#7f5cff' },
    overlay: { vignette: 0.35, grain: 0.04 },
    sound: 'none', // the ambient soundscape that goes with this scene (plays only if turned on in Settings)
    soundFile: '', // your own looping sound, when sound is 'custom'
    field: { type: 'none', count: 1400, wind: 1, ground: '#3d5a1e' }, // a field of flowers or grass
  };
}

export function defaultConfig() {
  // a fresh start: the first Blender scene that comes with Aerie (or the Lavender Dusk 3D look
  // if there are none), with a clock and the date
  const look = PRESETS['Lavender Dusk'].build();
  return normalizeConfig({
    ...look, general: defaultGeneral(), wallpaper: { type: 'default' },
    widgets: [defaultWidget('clock'), Object.assign(defaultWidget('date'), { y: 26 })].map(w => Object.assign(w, { card: false, x: 5 })),
    theme: { ...look.theme, font: 'display', cardStyle: 'liquid', accent: '#ff8fb1', text: '#ffffff', widgetBg: '#1a1f44', widgetOpacity: 0.32 },
  });
}

/** Which wallpaper a screen shows: its own choice, or the one for all screens. */
export function wallpaperFor(cfg, monitor = MONITOR) {
  return (cfg.screens && cfg.screens[String(monitor)]) || cfg.wallpaper || { type: 'default' };
}

/** Your settings for one wallpaper (its own options, fit, speed and sound). */
export function wallpaperSettings(cfg, key) {
  return deepMerge({ props: {}, fit: 'cover', speed: 1, sound: false, volume: 50, motion: 1, exposure: 1, background: '', shadows: true },
    (cfg.wallpaperProps || {})[key] || {});
}

function defaultGeneral() {
  return {
    reducedMotion: 'system', fps: 60, editorHint: true, drawerCorner: 'none', recent: [],
    sound: {
      ui: true, pack: 'glass', volume: 0.4, hover: false, ambient: false, ambientVolume: 0.35, pauseForMusic: true, muted: false,
      custom: { click: '', open: '', launch: '', notify: '', chime: '' }, // your own sound files
    },
    myLooks: [], // looks you saved: { id, name, thumb, data }
    welcomed: false,
    lock: { source: 'scene', widgets: false, darken: 0.15, message: '', messagePos: 'bottom' }, // how the lock screen picture is made
    matchTaskbar: 'ask',
    pauseWhen: 'maximized', // maximized · focused · never
    libraryConsent: false,
    hub: { hotEdge: true, tabs: ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power'], lastTab: 'controls', showMature: false },
    clipboard: { enabled: false },
    lockScreen: { clock: true, date: true, media: true, battery: true, blur: 0, dim: 0.25, message: '', power: true },
  };
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return defaultConfig();
  const base = {
    version: 4,
    wallpaper: { type: 'scene' }, // a config from before wallpapers existed keeps its 3D scene
    screens: {},
    wallpaperProps: {},
    scene: defaultScene(),
    camera: { mode: 'parallax', strength: 1, smoothing: 0.06, fov: 50, distance: 9, drift: true },
    theme: defaultTheme(),
    general: defaultGeneral(),
  };
  const merged = deepMerge(base, raw);
  merged.version = 4;
  merged.objects = (raw.objects || []).map(o => deepMerge(defaultObject(o.shape), o));
  merged.widgets = (raw.widgets || []).map(w => {
    const d = defaultWidget(w.type);
    const m = deepMerge(d, w);
    m.settings = deepMerge(d.settings, w.settings || {});
    return m;
  });
  return merged;
}

/** A preset applied on top of the person's general settings. */
export function presetConfig(name, general) {
  return normalizeConfig({ ...PRESETS[name].build(), general });
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

export const api = {
  loadConfig: () => call('GET', '/api/config').then(d => d.config).catch(() => null),
  saveConfig: cfg => call('PUT', '/api/config', cfg),
  apps: () => call('GET', '/api/apps').then(d => d.apps).catch(() => []),
  refreshApps: () => call('POST', '/api/apps/refresh').then(d => d.apps).catch(() => []),
  launch: id => call('POST', '/api/launch', { id }).catch(() => ({ ok: false })),
  system: () => call('GET', '/api/system').catch(() => null),
  upload: file => call('POST', '/api/media', file, { 'X-Filename': encodeURIComponent(file.name) }).then(d => d.url),
  autostart: () => call('GET', '/api/autostart').then(d => d.enabled).catch(() => false),
  setAutostart: enabled => call('POST', '/api/autostart', { enabled }).then(d => d.enabled),
  deleteData: () => call('POST', '/api/delete-data'),
  uninstall: () => call('POST', '/api/uninstall'),
  installInfo: () => call('POST', '/api/install-info').catch(() => ({ installed: false, canUpdate: false, version: '' })),
  update: () => call('POST', '/api/update'),
  restart: () => call('POST', '/api/restart'),
  shell: (action, extra) => call('POST', '/api/shell', { action, monitor: MONITOR, extra }).catch(() => null),
  wallpapers: () => call('GET', '/api/wallpapers').then(d => d.items).catch(() => []),
  steam: () => call('GET', '/api/wallpapers/steam').catch(() => ({ steam: false, count: 0 })),
  scene: id => call('GET', '/api/wallpapers/scene?id=' + encodeURIComponent(id)),
  importPath: path => call('POST', '/api/wallpapers/import', { path }),
  pickWallpaper: folder => call('POST', '/api/wallpapers/pick', { folder }),
  uploadWallpaper: file => call('POST', '/api/wallpapers/upload', file, { 'X-Filename': encodeURIComponent(file.name) }),
  addUrl: (url, title) => call('POST', '/api/wallpapers/url', { url, title }),
  removeWallpaper: id => call('POST', '/api/wallpapers/remove', { id }),
  updateWallpaper: (id, changes) => call('POST', '/api/wallpapers/update', { id, ...changes }),
  unhideWallpapers: () => call('POST', '/api/wallpapers/unhide'),
  controls: () => call('GET', '/api/controls').catch(() => ({})),
  setControl: (name, value) => call('POST', '/api/controls', { name, value }),
  power: action => call('POST', '/api/power', { action }),
  stats: () => call('GET', '/api/stats').catch(() => null),
  speedtest: () => call('POST', '/api/speedtest'),
  clipboard: (q = '', kind = 'all') => call('GET', `/api/clipboard?q=${encodeURIComponent(q)}&kind=${kind}`).catch(() => ({ items: [], available: false })),
  clipAction: (action, id, extra = {}) => call('POST', '/api/clipboard', { action, id, ...extra }),
  clipboardAccess: on => call('POST', '/api/system/clipboard-access', { on }),
  lockStatus: () => call('GET', '/api/lock/status').catch(() => ({})),
  lockInfo: () => call('GET', '/api/lock/info').catch(() => ({ name: '' })),
  setLockEnabled: on => call('POST', '/api/lock/enable', { on }),
  removeLockSwitch: () => call('POST', '/api/lock/remove-switch'),
  previewLock: () => call('POST', '/api/lock/preview'),
  hubShortcuts: () => call('GET', '/api/hub/shortcuts').catch(() => ({ installed: false })),
  setHubShortcuts: on => call('POST', '/api/hub/shortcuts', { on }),
  library: kind => call('GET', '/api/library?kind=' + encodeURIComponent(kind)).then(d => d.items),
  libraryFetch: (kind, id, resolution) => call('POST', '/api/library/fetch', { kind, id, resolution }).then(d => d.url),
  lockscreen: () => call('GET', '/api/lockscreen').catch(() => ({ current: null })),
  setLockscreen: req => call('POST', '/api/lockscreen', { monitor: MONITOR, ...req }),
  setAvatar: url => call('POST', '/api/avatar', { url }),
  lockNow: () => call('POST', '/api/lock-now').catch(() => ({ ok: false })),
  assistant: () => call('GET', '/api/assistant'),
  assistantSettings: changes => call('POST', '/api/assistant/settings', changes),
  ollamaModels: () => call('GET', '/api/assistant/ollama-models').catch(() => ({ models: [] })),
  assistantChat: (messages, context) => call('POST', '/api/assistant/chat', { messages, context }),
  thumbnail: () => call('POST', '/api/thumbnail', { monitor: MONITOR }).then(d => d.url),
  cosmicLook: () => call('GET', '/api/cosmic-look').catch(() => ({ available: false })),
  setCosmicLook: changes => call('POST', '/api/cosmic-look', changes),
  restoreCosmicLook: () => call('POST', '/api/cosmic-look/restore'),
  nowPlaying: () => call('GET', '/api/now-playing').catch(() => ({ available: false })),
  playerControl: action => call('POST', '/api/now-playing', { action }).catch(() => ({ ok: false })),
};
