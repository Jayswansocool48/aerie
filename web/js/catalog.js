// Library items as Studio and the menus show them: previews with BlurHash placeholders.
import { api } from './config.js';
import { blurUrl, hashImage } from './blurhash.js';
import { icon } from './icons.js';
import { KIND_ICON } from './kinds.js';
import { animate, place, SPRINGS } from './motion.js';

/** A flat placeholder color for wallpapers without a preview, by kind (no gradients). */
const TONES = { model: '#12302f', stage: '#12302f', image: '#0f2a33', video: '#1d2633', web: '#16282a', url: '#16282a',
  scene: '#1c2a24', shader: '#141f33', parallax: '#173027' };

/**
 * A wallpaper's preview picture. Until the picture loads you see its BlurHash (a soft blur of its
 * colors); the picture then fades in on a spring. The first time a preview loads, Aerie works out
 * its BlurHash and keeps it in the library for next time.
 */
export function previewEl(w, cls = 'thumb') {
  const box = document.createElement('div');
  box.className = cls + ' pv-img';
  const blur = blurUrl(w.blurhash);
  box.style.background = blur ? `center / cover no-repeat url("${blur}")` : (TONES[w.type] || '#12302f');
  if (!w.previewUrl) {
    box.classList.add('ph');
    box.innerHTML = icon(KIND_ICON[w.type] || 'wallpaper');
    return box;
  }
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.style.opacity = '0';
  img.addEventListener('load', () => {
    if (!w.blurhash && img.naturalWidth) {
      const hash = hashImage(img);
      if (hash) { w.blurhash = hash; api.updateWallpaper(w.id, { blurhash: hash }).catch(() => null); }
    }
    if (blur) { place(img, { opacity: 0 }); animate(img, { opacity: 1 }, { config: SPRINGS.gentle }); } else img.style.opacity = '1';
  }, { once: true });
  img.addEventListener('error', () => { box.classList.add('ph'); box.innerHTML = icon(KIND_ICON[w.type] || 'wallpaper'); }, { once: true });
  img.src = w.previewUrl;
  box.append(img);
  return box;
}

/** Start loading a preview before you need it (a tile you hover). */
const warmed = new Set();
export function prefetchPreview(w) {
  if (!w?.previewUrl || warmed.has(w.previewUrl)) return;
  warmed.add(w.previewUrl);
  const img = new Image();
  img.decoding = 'async';
  img.src = w.previewUrl;
}

/** "Anime Style Sky Shader by ProfesorShader · CC0" with a link to where it came from. */
export function creditLine(credit, h) {
  if (!credit) return null;
  const who = [credit.title, credit.author ? 'by ' + credit.author : ''].filter(Boolean).join(' ');
  const bits = [who, credit.license, credit.source].filter(Boolean).join(' · ');
  return h('p.credit', {}, bits, credit.url ? h('a', { href: credit.url, target: '_blank', rel: 'noopener' }, ' Source') : '');
}
