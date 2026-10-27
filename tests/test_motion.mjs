// Checks the spring solver, the squircle outline and BlurHash (run with: node tests/test_motion.mjs).
import assert from 'node:assert/strict';
import { solve, SPRINGS, cssSpring } from '../web/js/motion.js';
import { squirclePath } from '../web/js/squircle.js';
import { encode, decode } from '../web/js/blurhash.js';

// a spring released from a displacement comes to rest at its target
for (const [name, cfg] of Object.entries(SPRINGS)) {
  const curve = solve(cfg, -100, 0);
  const [x0, v0] = curve(0);
  assert.ok(Math.abs(x0 + 100) < 1e-9 && Math.abs(v0) < 1e-9, `${name} starts where it was let go`);
  const [x, v] = curve(3);
  assert.ok(Math.abs(x) < 0.5 && Math.abs(v) < 5, `${name} settles within 3 s (x=${x}, v=${v})`);
}
// velocity is the derivative of position (checked numerically), for all three damping cases
for (const cfg of [SPRINGS.bouncy, { stiffness: 100, damping: 20, mass: 1 }, { stiffness: 100, damping: 40, mass: 1 }]) {
  const curve = solve(cfg, 50, 300);
  for (const t of [0.05, 0.2, 0.6]) {
    const h = 1e-5, dx = (curve(t + h)[0] - curve(t - h)[0]) / (2 * h);
    assert.ok(Math.abs(dx - curve(t)[1]) < 1e-3 * Math.max(1, Math.abs(dx)), `velocity matches at t=${t}`);
  }
  assert.equal(curve(0)[1], 300, 'keeps the velocity you give it');
}
// a spring kicked from rest (the wrong-password shake) swings and comes back
const shake = solve(SPRINGS.bouncy, 0, 520);
assert.ok(shake(0.05)[0] > 5, 'the shake moves');
assert.ok(Math.abs(shake(2)[0]) < 0.5, 'the shake rings out');
// the CSS curve sampled from a spring starts at 0 and ends at 1
const css = cssSpring(SPRINGS.snappy);
assert.match(css.easing, /^linear\(0\.0000, .* 1\.0000\)$/);
assert.ok(css.duration > 100 && css.duration < 2000);

// squircle outline: closed, inside the box, touching all four edges
const d = squirclePath(200, 100, 16);
assert.ok(d.startsWith('M') && d.endsWith('Z'));
const pts = d.slice(1, -1).split('L').map(p => p.split(' ').map(Number));
for (const [x, y] of pts) assert.ok(x >= -0.01 && x <= 200.01 && y >= -0.01 && y <= 100.01, 'inside the box');
assert.ok(pts.some(([, y]) => y === 0) && pts.some(([, y]) => y === 100) && pts.some(([x]) => x === 0) && pts.some(([x]) => x === 200));

// BlurHash: encoding a two-color picture and decoding it keeps its colors roughly
const w = 32, h = 18, px = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) { const left = i % w < w / 2; px.set(left ? [220, 90, 60, 255] : [20, 40, 80, 255], i * 4); }
const hash = encode(px, w, h);
assert.equal(hash.length, 4 + 2 * (4 * 3 - 1) + 2, 'hash length for 4×3 components');
const out = decode(hash, w, h);
const at = (x, y) => [...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
assert.ok(at(2, 9)[0] > at(29, 9)[0] + 60, 'left stays redder than right');
assert.ok(at(29, 9)[2] > at(2, 9)[2], 'right stays bluer');
console.log('motion, squircle and blurhash: ok');
