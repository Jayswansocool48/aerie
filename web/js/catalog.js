// Every wallpaper you can pick, in one list, for the hub and Aerie Studio.
import { api, normalizeConfig } from './config.js';
import { cachedLibrary, libraryItems } from './library.js';
import { blurUrl, hashImage } from './blurhash.js';
import { icon } from './icons.js';
import { animate, place, SPRINGS } from './motion.js';

export const KIND_LABEL = {
  model: '3D scene', image: 'Picture', video: 'Video', web: 'Web', url: 'Web site', scene: 'Wallpaper Engine scene', look: '3D look',
};
export const KIND_ICON = { model: 'cube', image: 'image', video: 'video', web: 'globe', url: 'globe', scene: 'wallpaper', look: 'cube' };

/** [{key, choice, title, kind, source, preview, tagline, item}]: the scenes that come with Aerie
 *  first, then yours, then Steam Workshop ones, then your editable 3D look. */
export async function allWallpapers(fresh = false) {
  return toList(await libraryItems(fresh));
}

/** The last list Aerie showed you (instant), or null. Refresh it with allWallpapers(true). */
export function cachedWallpapers() {
  const items = cachedLibrary();
  return items ? toList(items) : null;
}

function toList(items) {
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

/** A flat placeholder color for wallpapers without a preview, by kind (no gradients). */
export function placeholderStyle(w) {
  const tones = { model: '#2c3a3f', image: '#3d3326', video: '#43281f', web: '#2f3a2a', url: '#2f3a2a', scene: '#3a2e36', look: '#3b2a1f' };
  return tones[w.kind] || '#2d2822';
}

/**
 * A wallpaper's preview picture. Until the picture loads you see its BlurHash (a soft blur of its
 * colors); the picture then fades in on a spring. The first time a preview loads, Aerie works out
 * its BlurHash and keeps it in the library for next time.
 */
export function previewEl(w, cls = 'thumb') {
  const box = document.createElement('div');
  box.className = cls + ' pv-img';
  const blur = blurUrl(w.item?.blurhash);
  box.style.background = blur ? `center / cover no-repeat url("${blur}")` : placeholderStyle(w);
  if (!w.preview) {
    box.classList.add('ph');
    box.innerHTML = icon(KIND_ICON[w.kind] || 'wallpaper');
    return box;
  }
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.style.opacity = '0';
  img.addEventListener('load', () => {
    if (w.item && !w.item.blurhash && img.naturalWidth) {
      const hash = hashImage(img);
      if (hash) { w.item.blurhash = hash; api.updateWallpaper(w.key, { blurhash: hash }).catch(() => null); }
    }
    if (blur) { place(img, { opacity: 0 }); animate(img, { opacity: 1 }, { config: SPRINGS.gentle }); } else img.style.opacity = '1';
  }, { once: true });
  img.src = w.preview;
  box.append(img);
  return box;
}

/** Start loading a preview before you need it (the next cards in a carousel, a page you hover). */
const warmed = new Set();
export function prefetchPreview(w) {
  if (!w?.preview || warmed.has(w.preview)) return;
  warmed.add(w.preview);
  const img = new Image();
  img.decoding = 'async';
  img.src = w.preview;
}
