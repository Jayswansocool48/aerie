// Your wallpaper library (imported, Steam Workshop and the scenes that come with Aerie),
// fetched from Aerie and kept for a few seconds.
import { api } from './config.js';

let cache = null;
let time = 0;

export async function libraryItems(fresh = false) {
  if (fresh || !cache || Date.now() - time > 5000) {
    cache = await api.wallpapers();
    time = Date.now();
  }
  return cache;
}

export function forgetLibrary() { cache = null; }
