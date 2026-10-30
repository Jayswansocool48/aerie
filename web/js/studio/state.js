// What every Studio page shares: your setup (cfg), the library, saving, and the live preview.
import { api, clone, STANDALONE } from '../config.js';
import { forgetLibrary, libraryItems } from '../library.js';
import { toast } from '../toast.js';

export const S = {
  cfg: null,
  list: [],
  apps: [],
  selected: null,     // the library item you clicked (shown in the preview, not in use yet)
  previewItem: null,  // what the preview shows instead of your wallpaper (a selection or something you edit)
  override: null,     // unsaved edits the preview shows live: { id, version, code | spec, properties, audio }
  editWidgets: false,
  previewReady: false,
};

let saveTimer = null;
const frame = () => document.getElementById('preview');

export function changed(fresh = false) {
  sendConfig(fresh);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 450);
}

export const saving = () => !!saveTimer;

export async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (STANDALONE) return;
  try {
    await api.saveConfig(S.cfg);
    await api.shell('config-changed', null);
  } catch { toast('Could not save your changes'); }
}

export async function refreshList() {
  forgetLibrary();
  S.list = await libraryItems(true);
  return S.list;
}

/** The item your desktop shows now (on the first screen). */
export function currentItem() {
  const c = S.cfg?.wallpaper || { type: 'default' };
  if (c.type === 'library' || c.id) return S.list.find(i => i.id === c.id) || null;
  return S.list.find(i => i.source === 'default') || null;
}

export function sendPreview(msg) { frame()?.contentWindow?.postMessage({ aerie: true, ...msg }, location.origin); }

export function sendConfig(fresh = false, reload = false) {
  if (!S.previewReady || !S.cfg) return;
  const shown = clone(S.cfg);
  if (S.previewItem) { shown.wallpaper = { type: 'library', id: S.previewItem.id }; shown.screens = {}; }
  sendPreview({ type: 'config', config: shown, fresh, reload });
  sendPreview({ type: 'edit', on: S.editWidgets });
  document.dispatchEvent(new CustomEvent('preview-label'));
}

/** Shows `item` in the preview (null: your own wallpaper again). */
export function previewItem(item, { fresh = false } = {}) {
  S.previewItem = item;
  sendConfig(fresh);
}

/** Shows unsaved edits live in the preview (shader code, layer or 3D layout). */
export function setOverride(override) {
  S.override = override ? { ...override, version: (S.override?.version || 0) + 1 } : null;
  sendPreview({ type: 'override', override: S.override });
}

// the preview tells Studio what it shows; Studio listens to sound for it when it reacts to music
const listeners = new Set();
export function onPreview(cb) { listeners.add(cb); return () => listeners.delete(cb); }
let soundOn = false;
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data?.aerie) return;
  const m = e.data;
  if (m.type === 'ready') {
    S.previewReady = true;
    sendConfig(true);
    if (S.override) sendPreview({ type: 'override', override: S.override }); // edits sent before the preview loaded
  }
  if (m.type === 'shown') {
    const want = !!m.audio;
    if (want !== soundOn) { soundOn = want; api.shell('studio-sound', want ? 'on' : 'off'); }
    maybeSnapshot(m.id);
  }
  for (const cb of listeners) cb(m);
});
// sound frames from the Aerie app go straight on to the preview
window.__aerieAudio = (bars, tex) => { try { frame()?.contentWindow?.__aerieAudio?.(bars, tex); } catch { /* preview reloading */ } };

// wallpapers you made (or imported) without a preview get one from the first time they show
const asked = new Set();
function maybeSnapshot(id) {
  const item = S.list.find(i => i.id === id);
  if (!item || item.previewUrl || !item.editable && !['shader', 'parallax', 'stage', 'model', 'scene'].includes(item.type) || asked.has(id)) return;
  asked.add(id);
  setTimeout(() => sendPreview({ type: 'snapshot', id, width: 640 }), item.type === 'stage' || item.type === 'model' ? 4000 : 1600);
}
onPreview(async m => {
  if (m.type !== 'snapshot' || !m.blob) return;
  const saved = await api.savePreview(m.id, m.blob);
  if (saved) { await refreshList(); document.dispatchEvent(new CustomEvent('library-changed')); }
});
