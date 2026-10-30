// Plays 2D layered wallpapers: your own (parallax.json, made in Studio or drawn by the AI) and
// Wallpaper Engine scenes (their picture layers, placed where the scene puts them).
// Each layer shifts with the mouse by its depth; layers can also drift sideways (clouds), sway
// gently, and pulse with the music's bass. All motion runs on critically damped springs, so the
// layers follow the mouse smoothly and you can change direction at any time.
import { bass } from './audio.js';

const reduce = () => document.documentElement.classList.contains('reduce-motion');

export class ParallaxView {
  constructor(container) {
    this.el = container;
    this.stage = document.createElement('div');
    this.stage.className = 'px-stage';
    container.appendChild(this.stage);
    this.pointer = { x: 0, y: 0 };
    this.pos = { x: 0, y: 0, vx: 0, vy: 0 };
    this.paused = false;
    this.settings = { motion: 1, speed: 1, fps: 60 };
    this.layers = [];
    this.onMove = e => { this.pointer.x = e.clientX / innerWidth * 2 - 1; this.pointer.y = e.clientY / innerHeight * 2 - 1; };
    window.addEventListener('pointermove', this.onMove);
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** spec: parallax.json; base: the URL folder its files are in (ends with "/"). */
  loadSpec(spec, base) {
    this.mode = 'own';
    this.spec = spec;
    this.stage.replaceChildren();
    const bg2 = spec.background2 || '';
    this.stage.style.background = bg2 ? `linear-gradient(180deg, ${spec.background}, ${bg2})` : spec.background || '#1d2b3a';
    this.layers = (spec.layers || []).filter(l => !l.hidden).map((l, i) => {
      const url = l.file.startsWith('/') ? l.file : base + l.file.split('/').map(encodeURIComponent).join('/');
      let node;
      if (l.scroll && l.repeat !== false) {
        node = document.createElement('div');
        node.className = 'px-strip';
        for (let k = 0; k < 3; k++) node.appendChild(Object.assign(document.createElement('img'), { src: url, alt: '', draggable: false }));
      } else {
        node = Object.assign(document.createElement('img'), { src: url, alt: '', draggable: false, className: 'px-layer' });
      }
      node.style.zIndex = String(i + 1);
      node.style.opacity = l.opacity ?? 1;
      this.stage.appendChild(node);
      const layer = { node, l, offset: 0, phase: i * 1.7 };
      const img = node.tagName === 'IMG' ? node : node.firstChild;
      img.addEventListener('load', () => { layer.nw = img.naturalWidth; layer.nh = img.naturalHeight; this.layout(); }, { once: true });
      return layer;
    });
    this.layout();
  }

  /** info: the scene description from /api/wallpapers/scene (Wallpaper Engine). */
  loadWeScene(info, itemId) {
    this.mode = 'we';
    this.scene = info;
    this.stage.replaceChildren();
    this.stage.style.background = info.clear || '#000';
    this.layers = info.layers.map((l, i) => {
      const node = document.createElement(l.video ? 'video' : 'img');
      node.className = 'px-layer';
      node.src = `/wp/${itemId}/${encodeURIComponent(l.src)}`;
      if (l.video) Object.assign(node, { loop: true, muted: true, autoplay: true, playsInline: true });
      else node.alt = '';
      node.style.opacity = l.alpha;
      node.style.zIndex = String(i + 1);
      if (l.tint && l.tint.some(c => c < 0.98)) node.style.filter = `brightness(${(l.tint[0] + l.tint[1] + l.tint[2]) / 3})`;
      this.stage.appendChild(node);
      return { node, l: { ...l, depth: Math.hypot(...(l.depth || [0, 0])) / Math.SQRT2 }, we: l };
    });
    this.layout();
  }

  layout() {
    const W = innerWidth, H = innerHeight;
    if (this.mode === 'we' && this.scene) {
      const { width: SW, height: SH } = this.scene;
      const s = Math.max(W / SW, H / SH) * 1.04; // a little extra so edges never show while layers move
      const ox = (W - SW * s) / 2, oy = (H - SH * s) / 2;
      for (const { node, we } of this.layers) {
        Object.assign(node.style, {
          left: `${ox + (we.x - we.w / 2) * s}px`, top: `${oy + (SH - we.y - we.h / 2) * s}px`,
          width: `${we.w * s}px`, height: `${we.h * s}px`,
        });
      }
      return;
    }
    const strength = (this.spec?.parallax ?? 1) * (this.settings.motion ?? 1);
    for (const layer of this.layers) {
      const { node, l } = layer;
      const nw = layer.nw || 1920, nh = layer.nh || 1080;
      const over = 1 + 0.06 * l.depth * strength; // room to move without showing an edge
      let w, h;
      if (l.fit === 'cover') { const s = Math.max(W / nw, H / nh) * over * l.scale; w = nw * s; h = nh * s; }
      else if (l.fit === 'width') { w = W * over * l.scale; h = nh * (w / nw); }
      else if (l.fit === 'contain') { const s = Math.min(W / nw, H / nh) * l.scale; w = nw * s; h = nh * s; }
      else { w = nw * l.scale; h = nh * l.scale; }
      const left = (W - w) / 2 + (l.x / 100) * W;
      const top = (l.align === 'top' ? 0 : l.align === 'center' ? (H - h) / 2 : H - h) + (l.y / 100) * H;
      layer.w = w;
      if (node.classList.contains('px-strip')) {
        Object.assign(node.style, { top: `${top}px`, height: `${h}px`, left: `${-w}px` });
        for (const img of node.children) Object.assign(img.style, { width: `${w}px`, height: `${h}px` });
      } else {
        Object.assign(node.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
      }
    }
  }

  apply(settings) {
    this.settings = { ...this.settings, ...settings };
    this.layout();
  }

  setPaused(on) {
    this.paused = on;
    this.last = 0;
    for (const v of this.stage.querySelectorAll('video')) { if (on) v.pause(); else v.play().catch(() => null); }
  }

  loop(ms) {
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused || document.hidden || !this.layers.length) return;
    const fps = this.settings.fps || 60;
    if (this.last && ms - this.last < 1000 / fps - 2) return;
    const dt = this.last ? Math.min(0.05, (ms - this.last) / 1000) : 1 / 60;
    this.last = ms;
    // a critically damped spring pulls the view toward the mouse (interruptible: it keeps its velocity)
    const delay = this.mode === 'we' ? (this.scene?.parallaxDelay || 0.1) : (this.spec?.smoothing ?? 0.08);
    const k = Math.min(400, 6 / Math.max(0.01, delay) ** 2 * 0.02), c = 2 * Math.sqrt(k);
    const p = this.pos, tx = reduce() ? 0 : this.pointer.x, ty = reduce() ? 0 : this.pointer.y;
    p.vx += (k * (tx - p.x) - c * p.vx) * dt; p.x += p.vx * dt;
    p.vy += (k * (ty - p.y) - c * p.vy) * dt; p.y += p.vy * dt;
    const speed = Math.max(0, this.settings.speed ?? 1);
    const pulse = bass();
    if (this.mode === 'we') {
      const amount = (this.scene.parallax ? this.scene.parallaxAmount : 0.15) * (this.settings.motion ?? 1) * (this.scene.parallaxMouse ?? 1);
      for (const { node, we } of this.layers) {
        const dx = -p.x * (we.depth?.[0] || 0) * amount * 24, dy = -p.y * (we.depth?.[1] || 0) * amount * 24;
        node.style.transform = `translate(${dx}px, ${dy}px) rotate(${-(we.rotation || 0)}rad)`;
      }
      return;
    }
    const strength = (this.spec?.parallax ?? 1) * (this.settings.motion ?? 1);
    const t = ms / 1000;
    for (const layer of this.layers) {
      const { node, l } = layer;
      const dx = -p.x * l.depth * strength * innerWidth * 0.025;
      const dy = -p.y * l.depth * strength * innerHeight * 0.02;
      const sway = l.sway && !reduce() ? Math.sin(t * 0.6 * speed + layer.phase) * l.sway * 8 : 0;
      const scale = l.react ? 1 + pulse * l.react * 0.06 : 1;
      if (node.classList.contains('px-strip')) {
        if (!reduce()) layer.offset = (layer.offset + l.scroll * speed * dt) % (layer.w || innerWidth);
        node.style.transform = `translate(${dx + layer.offset}px, ${dy + sway}px) scale(${scale})`;
      } else {
        node.style.transform = `translate(${dx}px, ${dy + sway}px) scale(${scale})`;
      }
    }
  }

  /** Draws the layers as they are now onto a 2D canvas context (for a library preview). */
  drawTo(ctx, W, H) {
    const box = this.stage.getBoundingClientRect();
    const sx = W / (box.width || innerWidth), sy = H / (box.height || innerHeight);
    const bg = this.spec?.background || this.scene?.clear || '#1d2b3a';
    if (this.spec?.background2) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bg);
      g.addColorStop(1, this.spec.background2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    for (const img of this.stage.querySelectorAll('img, video')) {
      const r = img.getBoundingClientRect();
      try { ctx.drawImage(img, (r.left - box.left) * sx, (r.top - box.top) * sy, r.width * sx, r.height * sy); } catch { /* not loaded */ }
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('resize', this.onResize);
    for (const v of this.stage.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
    this.el.replaceChildren();
  }
}
