// Shows the chosen wallpaper behind the widgets: a Blender 3D scene (.glb), a picture, a video,
// a Wallpaper Engine scene (its picture layers, with mouse parallax), or nothing at all for web
// wallpapers (those run in their own sandboxed view underneath this page). Aerie's own editable
// 3D look is drawn by scene.js; this only says when to show it.
import { api } from './config.js';
import { libraryItems } from './library.js';
import { ModelScene } from './modelscene.js';

export { forgetLibrary, libraryItems } from './library.js';

/** The library item a choice points to ('default' = the first scene that comes with Aerie). */
export function itemFor(choice, items) {
  if (choice?.type === 'default') return items.find(i => i.source === 'default') || null;
  if (choice?.type === 'library') return items.find(i => i.id === choice.id) || null;
  return null;
}

/** What kind of wallpaper a choice is: 'scene' (the editable 3D look), 'model' (Blender), 'image',
 *  'video', 'wescene', 'web' or 'url'. */
export function kindOf(choice, item) {
  if (!choice || choice.type === 'scene') return 'scene';
  if (choice.type === 'default' && !item) return 'scene'; // no Blender scenes yet: the 3D look
  if (!item) return 'missing';
  return item.type === 'scene' ? 'wescene' : item.type;
}

/** The key your settings for a wallpaper are saved under. */
export function settingsKey(choice, item) {
  return item ? item.id : 'scene';
}

export class WallpaperLayer {
  constructor(el) {
    this.el = el;
    this.kind = null;
    this.key = '';
    this.model = null;
    this.paused = false;
    this.pointer = { x: 0, y: 0 };
    this.par = { x: 0, y: 0 };
    window.addEventListener('pointermove', e => {
      this.pointer.x = e.clientX / innerWidth * 2 - 1;
      this.pointer.y = e.clientY / innerHeight * 2 - 1;
    });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /** Shows `choice` ({type, name|id, options}) with `settings` (fit, speed, sound…). Returns its kind. */
  async show(choice, settings = {}) {
    const items = choice && choice.type !== 'scene' ? await libraryItems() : [];
    const item = itemFor(choice, items);
    const kind = kindOf(choice, item);
    const key = JSON.stringify([kind, item?.id]);
    this.settings = settings;
    if (key !== this.key) {
      this.clear();
      this.key = key;
      this.kind = kind;
      this.item = item;
      if (kind === 'model') await this.showModel(item);
      else if (kind === 'image') this.showImage(item, settings);
      else if (kind === 'video') this.showVideo(item, settings);
      else if (kind === 'wescene') await this.showWeScene(item);
      else if (kind === 'missing') this.showMissing();
    }
    this.applySettings(settings);
    this.el.dataset.kind = kind;
    this.el.hidden = !['model', 'image', 'video', 'wescene', 'missing'].includes(kind);
    return kind;
  }

  clear() {
    this.model?.dispose();
    this.model = null;
    this.media = null;
    for (const v of this.el.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
    this.el.replaceChildren();
    this.layers = null;
  }

  async showModel(item) {
    const box = document.createElement('div');
    box.className = 'wall-fill';
    this.el.appendChild(box);
    const model = this.model = new ModelScene(box);
    model.setPaused(this.paused);
    this.showProblem('Loading the 3D scene…', true);
    try {
      this.modelInfo = await model.load(item.fileUrl);
      this.el.querySelector('.wall-note')?.remove();
    } catch (err) {
      if (this.model === model) this.showProblem(err.message);
    }
  }

  showImage(item, settings) {
    const img = document.createElement('img');
    img.className = 'wall-media';
    img.alt = '';
    img.src = item.fileUrl;
    this.el.appendChild(img);
    this.media = img;
  }

  showVideo(item) {
    const v = document.createElement('video');
    v.className = 'wall-media';
    v.src = item.fileUrl;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('aria-hidden', 'true');
    v.addEventListener('error', () => this.showProblem('This video can\'t play. Installing "gstreamer1.0-libav" adds most video formats.'));
    this.el.appendChild(v);
    this.media = v;
    if (!this.paused) v.play().catch(() => null);
  }

  async showWeScene(item) {
    const stage = document.createElement('div');
    stage.className = 'we-stage';
    this.el.appendChild(stage);
    let info;
    try {
      this.showProblem('Opening this scene for the first time…', true);
      info = await api.scene(item.id);
    } catch (err) {
      this.showProblem(err.message || 'Aerie couldn\'t read this scene.');
      return;
    }
    this.el.querySelector('.wall-note')?.remove();
    stage.style.background = info.clear || '#000';
    this.scene = info;
    this.layers = info.layers.map(l => {
      const node = document.createElement(l.video ? 'video' : 'img');
      node.className = 'we-layer';
      node.src = `/wp/${item.id}/${encodeURIComponent(l.src)}`;
      if (l.video) Object.assign(node, { loop: true, muted: true, autoplay: true, playsInline: true });
      node.style.opacity = l.alpha;
      if (l.tint && l.tint.some(c => c < 0.98)) node.style.filter = `brightness(${(l.tint[0] + l.tint[1] + l.tint[2]) / 3})`;
      stage.appendChild(node);
      return { node, l };
    });
    this.layoutScene();
    this.onResize ||= () => this.layoutScene();
    window.addEventListener('resize', this.onResize);
  }

  /** Places the layers like Wallpaper Engine: its scene has its own size, scaled to cover the screen. */
  layoutScene() {
    if (!this.layers || !this.scene) return;
    const { width: W, height: H } = this.scene;
    const s = Math.max(innerWidth / W, innerHeight / H);
    const ox = (innerWidth - W * s) / 2, oy = (innerHeight - H * s) / 2;
    for (const { node, l } of this.layers) {
      Object.assign(node.style, {
        left: `${ox + (l.x - l.w / 2) * s}px`, top: `${oy + (H - l.y - l.h / 2) * s}px`,
        width: `${l.w * s}px`, height: `${l.h * s}px`,
      });
      node.dataset.rot = l.rotation || 0;
    }
  }

  showMissing() {
    this.showProblem('This wallpaper isn\'t in your library any more. Pick another one in the hub (Super+D) or Aerie Studio.');
  }

  showProblem(text, soft = false) {
    this.el.querySelector('.wall-note')?.remove();
    const p = document.createElement('p');
    p.className = 'wall-note' + (soft ? ' soft' : '');
    p.textContent = text;
    this.el.appendChild(p);
  }

  applySettings(settings) {
    const m = this.media;
    if (m) {
      m.style.objectFit = { cover: 'cover', fit: 'contain', stretch: 'fill', center: 'none' }[settings.fit] || 'cover';
      if (m.tagName === 'VIDEO') {
        m.playbackRate = Math.max(0.25, Math.min(3, settings.speed || 1));
        m.muted = !settings.sound;
        m.volume = Math.max(0, Math.min(1, (settings.volume ?? 50) / 100));
      }
    }
    this.model?.apply({ motion: settings.motion ?? 1, speed: settings.speed ?? 1, exposure: settings.exposure ?? 1,
      background: settings.background || '', shadows: settings.shadows !== false, fps: settings.fps || 60 });
  }

  setPaused(on) {
    this.paused = on;
    this.model?.setPaused(on);
    for (const v of this.el.querySelectorAll('video')) { if (on) v.pause(); else v.play().catch(() => null); }
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (this.paused || !this.layers || !this.scene) return;
    // Wallpaper Engine's camera parallax: deeper layers move more with the mouse
    const k = Math.min(1, 0.02 / Math.max(0.02, this.scene.parallaxDelay || 0.1));
    this.par.x += (this.pointer.x - this.par.x) * k;
    this.par.y += (this.pointer.y - this.par.y) * k;
    const amount = (this.scene.parallax ? this.scene.parallaxAmount : 0.15) * (this.settings?.motion ?? 1) * (this.scene.parallaxMouse ?? 1);
    for (const { node, l } of this.layers) {
      const dx = -this.par.x * (l.depth?.[0] || 0) * amount * 24, dy = -this.par.y * (l.depth?.[1] || 0) * amount * 24;
      node.style.transform = `translate(${dx}px, ${dy}px) rotate(${-(l.rotation || 0)}rad)`;
    }
  }
}
