// Sound for wallpapers that react to music. The Aerie app pushes about 30 frames a second while a
// sound-reactive wallpaper is showing (see aerie/audio.py): Wallpaper Engine's 128 bars, and the
// bytes of Shadertoy's 512×2 audio texture (spectrum, then waveform).

const state = {
  bars: new Float32Array(128),
  texture: new Uint8Array(1024),
  time: 0,           // when the last frame came (performance.now())
  version: 0,        // goes up with every frame, so players know when to upload the texture
};
const listeners = new Set();

window.__aerieAudio = (bars, b64) => {
  if (Array.isArray(bars)) state.bars.set(bars.slice(0, 128));
  if (typeof b64 === 'string' && b64) {
    const raw = atob(b64);
    const n = Math.min(raw.length, 1024);
    for (let i = 0; i < n; i++) state.texture[i] = raw.charCodeAt(i);
  }
  state.time = performance.now();
  state.version++;
  for (const cb of listeners) { try { cb(state); } catch { /* one bad listener shouldn't stop the others */ } }
};

/** True while sound frames are arriving (none for a second = silence or off). */
export const hearing = () => performance.now() - state.time < 1000;

/** Average level of a band range (0..1), both ears. 0-63 are the left ear, low to high. */
export function level(from = 0, to = 8) {
  if (!hearing()) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += state.bars[i] + state.bars[i + 64];
  return sum / ((to - from) * 2);
}

export const bass = () => level(0, 7);
export const audioState = () => state;
export function onAudio(cb) { listeners.add(cb); return () => listeners.delete(cb); }
