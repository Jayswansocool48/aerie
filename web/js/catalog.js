// Every wallpaper you can pick, in one list, for the hub and Aerie Studio.
import { api, normalizeConfig } from './config.js';
import { libraryItems } from './library.js';

export const KIND_LABEL = {
  model: '3D scene', image: 'Picture', video: 'Video', web: 'Web', url: 'Web site', scene: 'Wallpaper Engine scene', look: '3D look',
};
export const KIND_ICON = { model: 'cube', image: 'image', video: 'video', web: 'globe', url: 'globe', scene: 'wallpaper', look: 'sparkle' };

/** [{key, choice, title, kind, source, preview, tagline, item}] — the scenes that come with Aerie
 *  first, then yours, then Steam Workshop ones, then your editable 3D look. */
export async function allWallpapers(fresh = false) {
  const items = await libraryItems(fresh);
  const list = items.map(it => ({
    key: it.id, choice: { type: 'library', id: it.id }, title: it.title, kind: it.type, source: it.source,
    preview: it.previewUrl, tagline: it.tagline || it.description || '', item: it, rating: it.rating,
  }));
  list.push({ key: 'scene', choice: { type: 'scene' }, title: 'My 3D look', kind: 'look', source: 'aerie',
    preview: '', tagline: 'Shapes, widgets, particles and light you design in Aerie Studio' });
  return list;
}

export function sourceLabel(w) {
  return { default: 'Aerie', steam: 'Steam Workshop', 'wallpaper-engine': 'Wallpaper Engine', lively: 'Lively', url: 'Web', file: 'Yours', folder: 'Yours', aerie: 'Aerie' }[w.source] || 'Yours';
}

/** The choice that is showing now (resolving "the first scene that comes with Aerie"). */
export function currentKey(cfg, list) {
  const c = cfg.wallpaper || { type: 'default' };
  if (c.type === 'scene') return 'scene';
  if (c.type === 'default') return list.find(w => w.source === 'default')?.key || 'scene';
  return c.id;
}

/** Loads the newest setup, changes it with fn(cfg), saves it and tells every screen. */
export async function patchConfig(fn) {
  const cfg = normalizeConfig(await api.loadConfig());
  await fn(cfg);
  await api.saveConfig(cfg);
  await api.shell('config-changed');
  return cfg;
}

/** A placeholder picture for wallpapers without one: a soft gradient by kind. */
export function placeholderStyle(w) {
  const hues = { model: [250, 320], image: [200, 260], video: [330, 20], web: [160, 220], url: [160, 220], scene: [280, 340], look: [20, 300] };
  const [a, b] = hues[w.kind] || [230, 300];
  let n = 0;
  for (const ch of w.key) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${(a + n % 40)} 55% 38%), hsl(${(b + n % 40) % 360} 60% 28%))`;
}
