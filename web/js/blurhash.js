// BlurHash (blurha.sh): a wallpaper's preview squeezed into ~30 characters. The library stores
// one per wallpaper; while the real preview loads, you see a soft blur of its colors.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

const enc83 = (v, len) => { let s = ''; for (let i = 1; i <= len; i++) s += CHARS[Math.floor(v / 83 ** (len - i)) % 83]; return s; };
const dec83 = s => [...s].reduce((v, c) => v * 83 + CHARS.indexOf(c), 0);
const toLinear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = v => { v = Math.max(0, Math.min(1, v)); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };
const signPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

/** Encode RGBA pixels (width × height) with cx × cy components. */
export function encode(pixels, width, height, cx = 4, cy = 3) {
  const factors = [];
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const norm = i === 0 && j === 0 ? 1 : 2;
      let r = 0, g = 0, b = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const basis = norm * Math.cos(Math.PI * i * x / width) * Math.cos(Math.PI * j * y / height);
          const p = 4 * (y * width + x);
          r += basis * toLinear(pixels[p]); g += basis * toLinear(pixels[p + 1]); b += basis * toLinear(pixels[p + 2]);
        }
      }
      const s = 1 / (width * height);
      factors.push([r * s, g * s, b * s]);
    }
  }
  const [dc, ...ac] = factors;
  let hash = enc83((cx - 1) + (cy - 1) * 9, 1);
  let maxAc = 1;
  if (ac.length) {
    const actual = Math.max(...ac.flat().map(Math.abs));
    const q = Math.max(0, Math.min(82, Math.floor(actual * 166 - 0.5)));
    maxAc = (q + 1) / 166;
    hash += enc83(q, 1);
  } else hash += enc83(0, 1);
  hash += enc83((toSrgb(dc[0]) << 16) + (toSrgb(dc[1]) << 8) + toSrgb(dc[2]), 4);
  for (const f of ac) {
    const q = v => Math.max(0, Math.min(18, Math.floor(signPow(v / maxAc, 0.5) * 9 + 9.5)));
    hash += enc83(q(f[0]) * 19 * 19 + q(f[1]) * 19 + q(f[2]), 2);
  }
  return hash;
}

/** Decode a hash into RGBA pixels. */
export function decode(hash, width, height) {
  const size = dec83(hash[0]);
  const cy = Math.floor(size / 9) + 1, cx = (size % 9) + 1;
  const maxAc = (dec83(hash[1]) + 1) / 166;
  const colors = [];
  for (let i = 0; i < cx * cy; i++) {
    if (i === 0) {
      const v = dec83(hash.slice(2, 6));
      colors.push([toLinear(v >> 16), toLinear((v >> 8) & 255), toLinear(v & 255)]);
    } else {
      const v = dec83(hash.slice(4 + i * 2, 6 + i * 2));
      const d = q => signPow((q - 9) / 9, 2) * maxAc;
      colors.push([d(Math.floor(v / 361)), d(Math.floor(v / 19) % 19), d(v % 19)]);
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < cy; j++) {
        for (let i = 0; i < cx; i++) {
          const basis = Math.cos(Math.PI * x * i / width) * Math.cos(Math.PI * y * j / height);
          const c = colors[i + j * cx];
          r += c[0] * basis; g += c[1] * basis; b += c[2] * basis;
        }
      }
      const p = 4 * (y * width + x);
      out[p] = toSrgb(r); out[p + 1] = toSrgb(g); out[p + 2] = toSrgb(b); out[p + 3] = 255;
    }
  }
  return out;
}

const cache = new Map();
/** A small data: URL of the blurred colors, to use as a placeholder background. */
export function blurUrl(hash) {
  if (!hash || hash.length < 6) return '';
  if (cache.has(hash)) return cache.get(hash);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 18;
    c.getContext('2d').putImageData(new ImageData(decode(hash, 32, 18), 32, 18), 0, 0);
    url = c.toDataURL();
  } catch { /* bad hash */ }
  cache.set(hash, url);
  return url;
}

/** Work out the hash of a loaded <img> (same-origin previews only). */
export function hashImage(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 18;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 18);
    return encode(ctx.getImageData(0, 0, 32, 18).data, 32, 18);
  } catch { return ''; }
}
