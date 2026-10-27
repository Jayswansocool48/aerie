// Your wallpaper library (imported, Steam Workshop and the scenes that come with Aerie),
// fetched from Aerie and kept for a few seconds. The last list also stays in this browser's
// storage, so a page can show it at once and refresh it in the background (stale-while-revalidate).
import { api } from './config.js';

const STORE = 'aerie-library';
let cache = null;
let time = 0;

export async function libraryItems(fresh = false) {
  if (fresh || !cache || Date.now() - time > 5000) {
    cache = await api.wallpapers();
    time = Date.now();
    try {
      const text = JSON.stringify(cache);
      if (text.length < 400000) localStorage.setItem(STORE, text);
    } catch { /* storage full or blocked: the cache is only a convenience */ }
  }
  return cache;
}

/** The library as Aerie last saw it, without waiting (null if there is none yet). */
export function cachedLibrary() {
  if (cache) return cache;
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
}

export function forgetLibrary() { cache = null; }
