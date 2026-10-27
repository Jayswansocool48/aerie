// Spring physics for every moving part of Aerie's interface.
//
// Each spring is a damped harmonic oscillator solved in closed form (stiffness, damping, mass),
// so the position at any time comes straight from the formula instead of a fixed easing curve.
// A spring keeps its velocity: when you send it a new target mid-flight, it bends toward the new
// target from where it is, at the speed it has, so you can interrupt or reverse any animation.

export const SPRINGS = {
  snappy: { stiffness: 520, damping: 38, mass: 1 },   // menus, buttons, toggles
  panel: { stiffness: 300, damping: 30, mass: 1 },    // the hub, sheets, pages
  gentle: { stiffness: 170, damping: 26, mass: 1 },   // fades, toasts
  bouncy: { stiffness: 380, damping: 18, mass: 1 },   // the wrong-password shake
  flow: { stiffness: 210, damping: 28, mass: 1 },     // the wallpaper carousel
};

let reduce = false;
try {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  reduce = mq.matches;
  mq.addEventListener?.('change', e => { reduce = e.matches; });
} catch { /* no matchMedia */ }
export const reducedMotion = () => reduce || document.documentElement.classList.contains('reduce-motion');

/**
 * The closed-form solution of m·x'' + c·x' + k·x = 0 for displacement x0 and velocity v0.
 * Returns (t) => [displacement, velocity] at t seconds.
 */
export function solve({ stiffness: k, damping: c, mass: m = 1 }, x0, v0) {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const A = x0, B = (v0 + zeta * w0 * x0) / wd;
    return t => {
      const e = Math.exp(-zeta * w0 * t), cos = Math.cos(wd * t), sin = Math.sin(wd * t);
      const x = e * (A * cos + B * sin);
      const v = e * ((B * wd - zeta * w0 * A) * cos - (A * wd + zeta * w0 * B) * sin);
      return [x, v];
    };
  }
  if (zeta === 1) {
    const B = v0 + w0 * x0;
    return t => {
      const e = Math.exp(-w0 * t);
      return [(x0 + B * t) * e, (B - w0 * (x0 + B * t)) * e];
    };
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
  const C2 = (v0 - r1 * x0) / (r2 - r1), C1 = x0 - C2;
  return t => {
    const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
    return [C1 * e1 + C2 * e2, C1 * r1 * e1 + C2 * r2 * e2];
  };
}

/** One animated number. `to()` retargets it, keeping its current position and velocity. */
export class Spring {
  constructor(value, onUpdate, config = SPRINGS.panel) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.config = config;
    this.onUpdate = onUpdate;
    this.frame = 0;
    this.done = null;
  }

  to(target, { config, velocity, from } = {}) {
    if (config) this.config = config;
    if (from !== undefined) this.value = from;
    if (velocity !== undefined) this.velocity = velocity;
    this.target = target;
    if (reducedMotion()) { this.set(target); return Promise.resolve(); }
    this.curve = solve(this.config, this.value - target, this.velocity);
    this.start = performance.now();
    if (!this.frame) this.frame = requestAnimationFrame(t => this.step(t));
    return new Promise(res => { this.resolvers = [...(this.resolvers || []), res]; });
  }

  /** Jump to a value with no motion (also used while you drag something). */
  set(value, velocity = 0) {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.value = this.target = value;
    this.velocity = velocity;
    this.onUpdate(value);
    this.settle();
  }

  step(now) {
    const t = Math.max(0, (now - this.start) / 1000);
    const [x, v] = this.curve(t);
    this.value = this.target + x;
    this.velocity = v;
    const scale = Math.max(1, Math.abs(this.target));
    if (Math.abs(x) < 0.0005 * scale + 0.001 && Math.abs(v) < 0.01 * scale + 0.01) {
      this.value = this.target;
      this.velocity = 0;
      this.frame = 0;
      this.onUpdate(this.value);
      this.settle();
      return;
    }
    this.onUpdate(this.value);
    this.frame = requestAnimationFrame(t2 => this.step(t2));
  }

  settle() {
    const r = this.resolvers || [];
    this.resolvers = [];
    for (const f of r) f();
  }

  get moving() { return !!this.frame; }
}

// ---- springs on elements ---------------------------------------------------------------------
// animate(el, {y: 0, opacity: 1, scale: 1}) moves those properties on springs. Calling it again
// mid-flight retargets the same springs, so the motion never jumps.
const PROPS = { x: 0, y: 0, scale: 1, rotate: 0, rotateY: 0, z: 0, opacity: 1 };
const states = new WeakMap();

function render(el, s) {
  const v = s.values;
  el.style.transform = `translate3d(${v.x}px, ${v.y}px, ${v.z}px) rotateY(${v.rotateY}deg) rotate(${v.rotate}deg) scale(${v.scale})`;
  el.style.opacity = String(Math.max(0, Math.min(1, v.opacity)));
}

function stateFor(el, initial = {}) {
  let s = states.get(el);
  if (!s) {
    s = { values: { ...PROPS, ...initial }, springs: {}, raf: 0 };
    states.set(el, s);
  }
  return s;
}

function schedule(el, s) {
  if (s.raf) return;
  s.raf = requestAnimationFrame(() => { s.raf = 0; render(el, s); });
}

/** Set properties right away (no motion). */
export function place(el, props) {
  const s = stateFor(el);
  for (const [k, v] of Object.entries(props)) {
    s.values[k] = v;
    s.springs[k]?.set(v);
  }
  render(el, s);
}

/** Spring the given properties to new values. Resolves when they all come to rest. */
export function animate(el, props, { config = SPRINGS.panel, from, velocity = {} } = {}) {
  const s = stateFor(el, from);
  if (from) { Object.assign(s.values, from); render(el, s); }
  return Promise.all(Object.entries(props).map(([k, target]) => {
    let sp = s.springs[k];
    if (!sp) sp = s.springs[k] = new Spring(s.values[k] ?? PROPS[k], v => { s.values[k] = v; schedule(el, s); }, config);
    if (from && k in from) sp.set(from[k]);
    return sp.to(target, { config, velocity: velocity[k] });
  }));
}

/** The current value of an animated property (for drags that grab a moving element). */
export const current = (el, key) => stateFor(el).values[key];
export const velocityOf = (el, key) => stateFor(el).springs[key]?.velocity || 0;

// ---- springs for CSS-only details ----------------------------------------------------------------
// A few small parts (the switch knob, focus rings) move in CSS. They still use this spring: we
// sample the same closed-form solution into a CSS linear() timing function and its duration.
export function cssSpring(config = SPRINGS.snappy, samples = 40) {
  const curve = solve(config, -1, 0);
  let end = 0.05;
  while (end < 3) { const [x, v] = curve(end); if (Math.abs(x) < 0.001 && Math.abs(v) < 0.01) break; end += 0.02; }
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push((1 + curve(end * i / samples)[0]).toFixed(4));
  pts[samples] = '1.0000'; // at rest: exactly on target
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(end * 1000) };
}

export function installCssSprings(root = document.documentElement) {
  for (const [name, cfg] of Object.entries({ snappy: SPRINGS.snappy, gentle: SPRINGS.gentle })) {
    const { easing, duration } = cssSpring(cfg);
    if (!CSS.supports?.('transition-timing-function', easing)) continue;
    root.style.setProperty(`--spring-${name}`, easing);
    root.style.setProperty(`--spring-${name}-ms`, duration + 'ms');
  }
}
