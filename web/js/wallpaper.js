// Shows the chosen wallpaper behind the widgets. Pictures and videos are plain elements; 3D models
// (Blender .glb), shaders, 2D parallax, Wallpaper Engine scenes and 3D stages have their own
// players. Web wallpapers and web sites run in their own sandboxed view underneath this page
// (the Aerie app puts it there), so for those this layer stays see-through.
import { api, itemFor } from './config.js';
import { libraryItems } from './library.js';
import { ModelScene } from './modelscene.js';
import { ParallaxView } from './parallax.js';
import { ShaderView } from './shaderview.js';
import { StageView } from './stage.js';

export { forgetLibrary, libraryItems } from './library.js';
export { itemFor };

const folderOf = url => url.slice(0, url.lastIndexOf('/') + 1);

export class WallpaperLayer {
  constructor(el, { onShaderError, onReady } = {}) {
    this.el = el;
    this.kind = null;
    this.key = '';
    this.player = null;
    this.paused = false;
    this.onShaderError = onShaderError;
    this.onReady = onReady;
  }

  /** Shows `choice` with `settings` (fit, speed, props…). Returns its kind ('none' if nothing to show). */
  async show(choice, settings = {}, { fresh = false, override, item: given } = {}) {
    const item = given !== undefined ? given : itemFor(choice, await libraryItems());
    const kind = item ? item.type : (choice?.type === 'default' ? 'none' : 'missing');
    const key = JSON.stringify([kind, item?.id, override ? override.version : 0]);
    this.settings = settings;
    if (key !== this.key || fresh) {
      const token = this.token = {};
      this.clear();
      this.key = key;
      this.kind = kind;
      this.item = item;
      try {
        await this.build(kind, item, settings, override);
      } catch (err) {
        if (token === this.token) this.showProblem(err.message || 'This wallpaper could not be shown.');
      }
      if (token !== this.token) return this.kind;
      this.onReady?.(kind, item);
    }
    this.applySettings(settings);
    this.el.dataset.kind = kind;
    this.el.hidden = (kind === 'web' || kind === 'url') && document.documentElement.dataset.mode === 'desktop';
    return kind;
  }

  async build(kind, item, settings, override) {
    if (kind === 'image') return this.showImage(item);
    if (kind === 'video') return this.showVideo(item);
    if (kind === 'missing') return this.showProblem('This wallpaper isn\'t in your library any more. Pick another one in Aerie Studio.');
    if (kind === 'web' || kind === 'url') {
      // web wallpapers play in their own sandboxed view under this page; here (Studio's preview,
      // the lock screen) show their picture instead
      if (document.documentElement.dataset.mode !== 'desktop' && item?.previewUrl) this.showImage({ fileUrl: item.previewUrl });
      return null;
    }
    if (kind === 'none') return this.showProblem('Pick a wallpaper in Aerie Studio.', true);
    const box = document.createElement('div');
    box.className = 'wall-fill';
    this.el.appendChild(box);
    if (kind === 'model') {
      const model = this.player = new ModelScene(box);
      model.setPaused(this.paused);
      this.showProblem('Loading the 3D scene…', true);
      await model.load(item.fileUrl);
      this.clearNote();
    } else if (kind === 'shader') {
      const view = this.player = new ShaderView(box, { onError: msg => { this.showProblem('The shader has an error:\n' + msg); this.onShaderError?.(msg, item); } });
      const code = override?.code ?? await (await api.wallpaperFile(item.fileUrl)).text();
      view.apply({ fps: settings.fps });
      view.load(code, override?.properties || item.properties, override?.audio ?? item.audio);
      view.setPaused(this.paused);
    } else if (kind === 'parallax') {
      const view = this.player = new ParallaxView(box);
      const spec = override?.spec || await (await api.wallpaperFile(item.fileUrl)).json();
      view.loadSpec(spec, folderOf(item.fileUrl));
      view.setPaused(this.paused);
    } else if (kind === 'scene') {
      const view = this.player = new ParallaxView(box);
      this.showProblem('Opening this scene for the first time…', true);
      const info = await api.scene(item.id);
      this.clearNote();
      view.loadWeScene(info, item.id);
      view.setPaused(this.paused);
    } else if (kind === 'stage') {
      const view = this.player = new StageView(box, { onStatus: msg => (msg ? this.showProblem(msg, true) : this.clearNote()) });
      const spec = override?.spec || await (await api.wallpaperFile(item.fileUrl)).json();
      view.setPaused(this.paused);
      await view.load(spec);
    }
    return null;
  }

  clear() {
    this.player?.dispose?.();
    this.player = null;
    this.media = null;
    for (const v of this.el.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); }
    this.el.replaceChildren();
  }

  showImage(item) {
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

  showProblem(text, soft = false) {
    this.clearNote();
    const p = document.createElement('p');
    p.className = 'wall-note' + (soft ? ' soft' : '');
    p.textContent = text;
    this.el.appendChild(p);
  }

  clearNote() { this.el.querySelector('.wall-note')?.remove(); }

  applySettings(s) {
    const m = this.media;
    if (m) {
      m.style.objectFit = { cover: 'cover', fit: 'contain', stretch: 'fill', center: 'none' }[s.fit] || 'cover';
      if (m.tagName === 'VIDEO') {
        m.playbackRate = Math.max(0.25, Math.min(3, s.speed || 1));
        m.muted = !s.sound;
        m.volume = Math.max(0, Math.min(1, (s.volume ?? 50) / 100));
      }
    }
    this.player?.apply?.({ motion: s.motion ?? 1, speed: s.speed ?? 1, exposure: s.exposure ?? 1, background: s.background || '',
      shadows: s.shadows !== false, fps: s.fps || 60, quality: s.quality ?? 1, props: s.props || {} });
  }

  setPaused(on) {
    this.paused = on;
    this.player?.setPaused(on);
    for (const v of this.el.querySelectorAll('video')) { if (on) v.pause(); else v.play().catch(() => null); }
  }

  /** A JPEG of what's showing now (for a library preview), or null. */
  async snapshot(width = 640) {
    if (this.player?.drawTo) {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = Math.round(width * 9 / 16);
      this.player.drawTo(c.getContext('2d'), c.width, c.height);
      return new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));
    }
    const src = this.el.querySelector('canvas') || this.media;
    if (!src) return null;
    const w = src.width || src.videoWidth || src.naturalWidth, h = src.height || src.videoHeight || src.naturalHeight;
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * 9 / 16);
    const s = Math.max(c.width / w, c.height / h);
    c.getContext('2d').drawImage(src, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));
  }
}
