// The editor panel: every setting for the look, scene, 3D objects, widgets, COSMIC itself and the app.
import {
  api, BACKGROUNDS, CARD_STYLES, clone, defaultConfig, defaultObject, defaultWidget, FONTS, MATERIALS, normalizeConfig,
  PARTICLE_STYLES, presetConfig, SHAPES, STANDALONE, uid, WIDGET_GROUPS, WIDGET_TYPES,
} from './config.js';
import { PRESETS } from './presets.js';
import { CUSTOM_SOUNDS, SOUND_PACKS, SOUNDSCAPES } from './sound.js';
import { appletName, layoutPreview, presetTaskbar, TASKBAR_LAYOUTS } from './taskbar.js';
import { applyChanges, buildContext, cosmicChanges, describeCosmic, setWallpaperChoices, SUGGESTIONS } from './assistant.js';

// The five places in the editor, each with a small icon (drawn as SVG paths).
const TABS = [
  ['looks', 'Looks', 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z'],
  ['assistant', 'Assistant', 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'],
  ['customize', 'Customize', 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6'],
  ['desktop', 'Desktop', 'M3 5h18v11H3zM8 20h8M12 16v4'],
  ['settings', 'Settings', 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4'],
];
const TAB_HINTS = {
  looks: 'Pick a look, or one you saved',
  assistant: 'Describe what you want, the AI designs it',
  customize: 'Background, widgets, 3D, scene and sound',
  desktop: 'Your COSMIC panel, dock, lock screen and windows',
  settings: 'Pausing, sounds, updates and privacy',
};
const TIMEZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();

export class Editor {
  constructor(panel, callbacks, opts = {}) {
    this.panel = panel;
    this.embedded = !!opts.embedded; // inside Aerie Studio: no header or tabs, Studio has its own
    this.cb = callbacks; // onChange(), onClose(), onSelectObject(id), onSelectWidget(id), getApps(), refreshApps(), toast(msg)
    this.tab = 'looks';
    this.selectedObject = null;
    this.selectedWidget = null;
    this.open = false;
    this.cosmic = null;
    this.cosmicTimer = null;
  }

  setConfig(cfg) { this.cfg = cfg; if (this.open) this.render(); }

  show() {
    this.open = true;
    this.panel.hidden = false;
    document.body.classList.add('editing');
    this.render();
    if (!this.cb.getApps().length) this.cb.loadApps?.().then(() => { if (this.open) this.render(); });
    this.panel.querySelector('.tab[aria-selected="true"]')?.focus();
  }

  hide() {
    this.open = false;
    this.panel.hidden = true;
    document.body.classList.remove('editing');
  }

  selectObject(id) {
    this.selectedObject = id;
    if (id) { this.tab = 'customize'; this.selectedWidget = null; OPEN.set('3D objects', true); }
    this.render();
  }

  selectWidget(id) {
    this.selectedWidget = id;
    if (id) { this.tab = 'customize'; this.selectedObject = null; OPEN.set('Widgets', true); }
    this.render();
  }

  /** Apply a change; `rerender` rebuilds the panel (for changes that show or hide controls). */
  commit(rerender = false) {
    this.cb.onChange();
    if (rerender) this.render();
  }

  // ---- layout ---------------------------------------------------------
  render() {
    if (this.embedded) return this.renderEmbedded();
    if (!this.open) return;
    const scrollTop = this.renderedTab === this.tab ? this.panel.querySelector('.panel-body')?.scrollTop || 0 : 0;
    this.renderedTab = this.tab;
    this.panel.replaceChildren();
    const header = el('header', 'panel-head');
    const brand = el('div', 'brand');
    const logo = document.createElement('img');
    logo.src = 'img/aerie.svg';
    logo.alt = '';
    const words = el('div', 'brand-words');
    words.append(el('h2', '', 'Aerie'), el('span', 'brand-sub', TAB_HINTS[this.tab] || ''));
    brand.append(logo, words);
    header.append(brand, button('Done', () => this.cb.onClose(), 'primary', 'Close (Esc)'));
    const tabs = el('nav', 'tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Editor sections');
    for (const [key, label, icon] of TABS) {
      const t = el('button', 'tab');
      t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg>`;
      t.appendChild(el('span', '', label));
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(this.tab === key));
      t.tabIndex = this.tab === key ? 0 : -1;
      t.addEventListener('click', () => { this.tab = key; this.library = null; this.render(); this.panel.querySelector('.tab[aria-selected="true"]')?.focus(); });
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = TABS.findIndex(([k]) => k === this.tab);
        this.tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
        this.render();
        this.panel.querySelector('.tab[aria-selected="true"]')?.focus();
      });
      tabs.appendChild(t);
    }
    const body = el('div', 'panel-body');
    body.setAttribute('role', 'tabpanel');
    body.dataset.tab = this.tab;
    CURRENT_TAB = this.tab;
    if (this.library) this.libraryView(body);
    else ({
      looks: () => this.looksTab(body),
      assistant: () => this.assistantTab(body),
      customize: () => { this.styleTab(body); this.widgetsTab(body); this.objectsTab(body); this.sceneTab(body); },
      desktop: () => this.cosmicTab(body),
      settings: () => this.settingsTab(body),
    })[this.tab]();
    const foot = el('footer', 'panel-foot', STANDALONE
      ? 'Preview mode: Aerie doesn\'t save changes here'
      : 'Saves automatically · Ctrl+E editor · Ctrl+Space all apps');
    this.panel.append(header, tabs, body, foot);
    body.scrollTop = scrollTop;
  }

  /** Inside Studio: one page's sections, straight into the page. */
  renderEmbedded() {
    this.open = true;
    const scroller = this.panel.closest('.st-main') || this.panel;
    const scrollTop = this.renderedTab === this.tab ? scroller.scrollTop : 0;
    this.renderedTab = this.tab;
    this.panel.replaceChildren();
    CURRENT_TAB = this.tab;
    const body = this.panel;
    if (this.library) this.libraryView(body);
    else ({
      look: () => { this.looksTab(body); this.styleParts(body, [0, 1]); this.objectsTab(body); this.sceneTab(body); },
      widgets: () => { this.widgetsTab(body); this.styleParts(body, [2]); },
      assistant: () => this.assistantTab(body),
      desktop: () => this.cosmicTab(body),
      settings: () => this.settingsTab(body),
      cosmiclock: () => { if (this.cosmic) this.lockscreenSection(body); else api.cosmicLook().then(l => { this.cosmic = l; if (this.tab === 'cosmiclock') this.render(); }); },
    })[this.tab]?.();
    scroller.scrollTop = scrollTop;
  }

  /** Some of the style sections: 0 background, 1 finishing touches, 2 widget style. */
  styleParts(body, which) {
    const tmp = el('div');
    this.styleTab(tmp);
    const parts = [...tmp.children];
    for (const i of which) if (parts[i]) body.appendChild(parts[i]);
  }

  // ---- Look ---------------------------------------------------------------
  looksTab(body) {
    if (!this.cfg.general.welcomed && !this.embedded) {
      const hi = section(body, 'Getting started');
      hi.append(
        el('p', 'note', 'Pick a look below to start. After that you rarely need this panel: right-click the desktop for quick actions (add widgets, change the look, pause, lock screen), and hold Alt to drag any widget around. Ctrl+E brings this panel back.'),
      );
    }
    this.myLooksSection(body);
    const presets = section(body, 'Looks');
    const grid = el('div', 'preset-grid');
    for (const [name, p] of Object.entries(PRESETS)) {
      const card = el('button', 'preset');
      card.type = 'button';
      card.setAttribute('aria-label', `Use the ${name} preset: ${p.tagline}`);
      const thumb = el('div', 'preset-thumb');
      thumb.style.background = `linear-gradient(135deg, ${p.swatch[0]} 0 55%, ${p.swatch[1]} 55%)`; // two flat swatches
      const pic = document.createElement('img');
      pic.alt = '';
      pic.loading = 'lazy';
      pic.src = `img/presets/${slug(name)}.jpg`;
      pic.addEventListener('error', () => pic.remove()); // fall back to the colors
      thumb.appendChild(pic);
      if (p.sky) thumb.appendChild(el('span', 'preset-badge', '360°'));
      const scape = (p.sound ??= p.build().scene.sound);
      if (scape && scape !== 'none') {
        const tag = el('span', 'preset-sound', '♪ ' + SOUNDSCAPES[scape]);
        tag.setAttribute('aria-hidden', 'true');
        thumb.appendChild(tag);
      }
      card.append(thumb, el('span', 'preset-name', name), el('span', 'preset-tag', p.tagline));
      card.addEventListener('click', () => this.applyPreset(name));
      grid.appendChild(card);
    }
    presets.appendChild(grid);
    const shuffle = el('div', 'row actions');
    shuffle.appendChild(button('Surprise me', () => {
      const names = Object.keys(PRESETS).filter(n => n !== this?.cfg?.presetName);
      this.applyPreset(names[Math.floor(Math.random() * names.length)]);
    }, '', 'Pick a random preset'));
    presets.appendChild(shuffle);
    presets.appendChild(el('p', 'hint', 'Each look can also restyle your real COSMIC panel and dock to match. You are asked first.'));
    const ask = section(body, 'Want something else?');
    ask.append(el('p', 'hint', 'Describe it and the assistant designs it for you, or fine-tune everything in Customize.'),
      button('Ask the assistant', () => { this.tab = 'assistant'; this.render(); }, 'primary'));
  }

  // ---- Customize: background and widget style ----------------------------------------
  styleTab(body) {
    const bg = this.cfg.scene.background;
    const s = section(body, 'Background');
    s.append(select('Type', bg, 'type', BACKGROUNDS, () => this.commit(true)));
    const two = { gradient: ['Top color', 'Bottom color'], aurora: ['Sky', 'Light 1', 'Light 2'], mesh: ['Color 1', 'Color 2', 'Color 3'], color: ['Color'] }[bg.type];
    if (two) two.forEach((label, i) => s.append(color(label, bg, `color${i + 1}`, () => this.commit())));
    if (bg.type === 'gradient') s.append(range('Angle', bg, 'angle', 0, 360, 1, () => this.commit(), '°'));
    if (bg.type === 'aurora' || bg.type === 'mesh') s.append(range('Movement speed', bg, 'speed', 0.1, 3, 0.1, () => this.commit(), '×'));
    if (bg.type === 'image' || bg.type === 'video') {
      s.append(upload(bg.type === 'image' ? 'Choose image' : 'Choose video', bg.type === 'image' ? 'image/*' : 'video/mp4,video/webm',
        async files => { bg[bg.type] = await this.upload(files[0]); this.commit(true); }));
      s.append(range('Darken', bg, 'dim', 0, 0.9, 0.05, () => this.commit()));
    }
    if (bg.type === 'panorama') {
      if (bg.credit) s.append(el('p', 'hint', bg.credit));
      else if (!bg.panorama) s.append(el('p', 'hint', 'Pick a free 360° sky from the online library, or use your own 360° photo (an equirectangular .jpg, .png or .hdr, like the ones phones and 360 cameras make).'));
      const row = el('div', 'row actions');
      row.append(
        button('Browse free 360° skies', () => this.openLibrary('hdris', (url, item) => {
          Object.assign(bg, { panorama: url, libraryId: item.id, credit: credit(item) });
          this.commit(true);
        }), 'primary'),
        upload('Use my own 360° photo', 'image/jpeg,image/png,image/webp,.hdr', async files => {
          Object.assign(bg, { panorama: await this.upload(files[0]), libraryId: '', credit: '' });
          this.commit(true);
        }),
      );
      s.append(row,
        range('Turn', bg, 'rotation', 0, 360, 1, () => this.commit(), '°'),
        range('Soft focus', bg, 'blur', 0, 0.4, 0.01, () => this.commit(), '', v => v < 0.01 ? 'sharp' : v < 0.15 ? 'a little' : 'dreamy'),
        range('Brightness', bg, 'brightness', 0.2, 2, 0.05, () => this.commit(), '×'),
        range('How much it lights the 3D objects', bg, 'lighting', 0, 2, 0.05, () => this.commit(), '×'),
        el('p', 'hint', 'Tip: set the camera to Orbit (Camera and mouse, below) to look further around the sky with your mouse.'),
      );
    }
    const o = this.cfg.scene.overlay;
    const fx = section(body, 'Finishing touches');
    fx.append(
      range('Vignette (dark edges)', o, 'vignette', 0, 1, 0.05, () => this.commit()),
      range('Film grain', o, 'grain', 0, 0.2, 0.01, () => this.commit()),
    );

    const th = this.cfg.theme;
    const t = section(body, 'Widget style');
    t.append(
      segmented('Card', th, 'cardStyle', CARD_STYLES, () => this.commit()),
      select('Font', th, 'font', FONTS, () => this.commit()),
      color('Accent', th, 'accent', () => this.commit()),
      color('Text', th, 'text', () => this.commit()),
      color('Card tint', th, 'widgetBg', () => this.commit()),
      range('Card opacity', th, 'widgetOpacity', 0, 1, 0.05, () => this.commit()),
      range('Glass blur', th, 'blur', 0, 48, 1, () => this.commit(), 'px'),
      range('Corner roundness', th, 'radius', 0, 40, 1, () => this.commit(), 'px'),
      range('App icon size', th, 'iconSize', 24, 96, 2, () => this.commit(), 'px'),
      toggle('Light edge', th, 'border', () => this.commit()),
      toggle('Drop shadow', th, 'shadow', () => this.commit()),
      toggle('Text shadow', th, 'textShadow', () => this.commit()),
      toggle('Glowing text', th, 'glow', () => this.commit()),
      toggle('3D tilt toward the mouse', th, 'tilt', () => this.commit()),
      range('Tilt amount', th, 'tiltAmount', 0, 25, 1, () => this.commit(), '°'),
      segmented('Widgets', th, 'widgetMotion', MOTIONS, () => this.commit()),
      el('p', 'hint', MOTION_HINT),
      toggle('Widgets float in when Aerie starts', th, 'entrance', () => this.commit()),
    );
    const contrast = contrastRatio(th.text, th.widgetBg);
    if (contrast < 4.5 && th.widgetOpacity > 0.3 && th.cardStyle !== 'clear') {
      t.appendChild(el('p', 'warn', `Text may be hard to read on cards (contrast ${contrast.toFixed(1)}:1, aim for 4.5:1 or more).`));
    }
  }

  // ---- your own saved looks -------------------------------------------------------
  myLooksSection(body) {
    const looks = this.cfg.general.myLooks ||= [];
    const s = section(body, 'My looks');
    if (looks.length) {
      const grid = el('div', 'preset-grid');
      for (const look of looks) {
        const card = el('div', 'preset my-look');
        const pick = el('button', 'my-look-pick');
        pick.type = 'button';
        pick.setAttribute('aria-label', `Use your look ${look.name}`);
        const thumb = el('div', 'preset-thumb');
        thumb.style.background = '#2d2822';
        if (look.thumb) { const img = document.createElement('img'); img.src = look.thumb; img.alt = ''; thumb.appendChild(img); }
        pick.append(thumb, el('span', 'preset-name', look.name), el('span', 'preset-tag', new Date(look.saved).toLocaleDateString()));
        pick.addEventListener('click', () => this.applyMyLook(look.id));
        const del = button('×', () => {
          const at = looks.indexOf(look);
          this.cfg.general.myLooks = looks.filter(l => l !== look);
          this.commit(true);
          this.cb.toast(`Deleted your look "${look.name}"`, { undo: () => { this.cfg.general.myLooks.splice(at, 0, look); this.commit(true); } });
        }, 'my-look-del');
        del.setAttribute('aria-label', `Delete ${look.name}`);
        card.append(pick, del);
        grid.appendChild(card);
      }
      s.appendChild(grid);
    } else {
      s.appendChild(el('p', 'hint', 'Made something you like? Save it here so you can come back to it after trying other looks.'));
    }
    const row = el('div', 'row actions');
    row.appendChild(button('Save this look', () => this.saveMyLook(), 'primary'));
    s.appendChild(row);
  }

  async saveMyLook() {
    const name = (prompt('Name this look:', `My look ${(this.cfg.general.myLooks?.length || 0) + 1}`) || '').trim();
    if (!name) return;
    const { scene, camera, objects, widgets, theme } = this.cfg;
    const look = { id: uid(), name: name.slice(0, 40), saved: Date.now(), thumb: '', data: clone({ scene, camera, objects, widgets, theme }) };
    this.cb.toast('Saving your look…');
    try { look.thumb = await api.thumbnail(); } catch { /* preview mode: no picture */ }
    (this.cfg.general.myLooks ||= []).unshift(look);
    this.commit(true);
    this.cb.sound?.('success');
    this.cb.toast(`Saved "${look.name}"`);
  }

  async applyMyLook(id) {
    const look = (this.cfg.general.myLooks || []).find(l => l.id === id);
    if (!look) return;
    const before = this.snapshot();
    const swap = () => {
      Object.assign(this.cfg, normalizeConfig({ ...clone(look.data), general: this.cfg.general, wallpaper: { type: 'scene' }, screens: {}, wallpaperProps: this.cfg.wallpaperProps }), { presetName: look.name });
      this.selectedObject = this.selectedWidget = null;
      this.commit(true);
    };
    if (this.cb.transition) await this.cb.transition(swap); else swap();
    this.cb.sound?.('success');
    this.cb.toast(`${look.name} applied`, { undo: () => this.restore(before) });
  }

  /** A copy of the whole setup, for Undo. */
  snapshot() { return clone(this.cfg); }

  restore(before) {
    for (const k of Object.keys(this.cfg)) delete this.cfg[k];
    Object.assign(this.cfg, clone(before));
    this.selectedObject = this.selectedWidget = null;
    this.commit(true);
  }

  /** Presets with a real 360° sky download it from the online library (once, with your OK). */
  async fetchPresetSky(name, sky) {
    const g = this.cfg.general;
    if (STANDALONE) return;
    if (!g.libraryConsent) {
      if (!confirm(`"${name}" looks best with a free 360° sky from Poly Haven (polyhaven.com, CC0). Download it now? (About 25 MB, once. Nothing about you is sent.)\n\nCancel keeps a simpler background.`)) return;
      g.libraryConsent = true;
      await this.cb.saveNow?.();
    }
    this.cb.toast('Downloading the 360° sky…');
    try {
      const url = await api.libraryFetch('hdris', sky.id, '4k');
      const bg = this.cfg.scene.background;
      if (this.cfg.presetName !== name) return; // switched to something else meanwhile
      Object.assign(bg, { type: 'panorama', panorama: url, libraryId: sky.id, credit: `${sky.name} · Poly Haven (CC0)` }, sky.look || {});
      this.commit(true);
      this.cb.toast(`${name}: 360° sky ready`);
    } catch (e) {
      this.cb.toast('Could not download the sky, so a simpler background is used: ' + e.message);
    }
  }

  /** Switches to a preset, and (if you agree) gives COSMIC's real taskbar the matching style. */
  async applyPreset(name) {
    const p = PRESETS[name];
    const before = this.snapshot();
    const swap = () => {
      Object.assign(this.cfg, presetConfig(name, this.cfg.general), { presetName: name, wallpaper: { type: 'scene' }, screens: {}, wallpaperProps: this.cfg.wallpaperProps || {} });
      this.selectedObject = this.selectedWidget = null;
      this.commit(true);
    };
    if (this.cb.transition) await this.cb.transition(swap); else swap();
    this.cb.sound?.('success');
    this.cb.toast(`${name} applied`, { undo: () => this.restore(before) });
    if (p.sky) await this.fetchPresetSky(name, p.sky);
    const mode = this.cfg.general.matchTaskbar;
    if (!p.taskbar || STANDALONE || mode === 'never') return;
    if (mode !== 'always' && !confirm(`Also restyle your real COSMIC panel and dock to match "${name}"?\n\nLayout: ${TASKBAR_LAYOUTS[p.taskbar.layout].name}. You can restore your original setup any time in the COSMIC tab.`)) return;
    try {
      const res = await api.setCosmicLook(presetTaskbar(p));
      this.cosmic = res.look;
      this.cb.toast(`${name} applied, taskbar too`);
    } catch (e) { this.cb.toast('Could not change COSMIC: ' + e.message); }
  }

  // ---- Scene ----------------------------------------------------------------
  sceneTab(body) {
    const cam = this.cfg.camera;
    const s = section(body, 'Camera and mouse');
    s.append(
      segmented('Mode', cam, 'mode', { parallax: 'Parallax', orbit: 'Orbit', fixed: 'Fixed' }, () => this.commit()),
      range('Strength', cam, 'strength', 0, 3, 0.05, () => this.commit()),
      range('Smoothness', cam, 'smoothing', 0.01, 0.3, 0.01, () => this.commit(), '', v => v < 0.05 ? 'floaty' : v > 0.15 ? 'snappy' : 'smooth'),
      range('Field of view', cam, 'fov', 25, 90, 1, () => this.commit(), '°'),
      range('Distance', cam, 'distance', 4, 25, 0.5, () => this.commit()),
      toggle('Gentle idle drift', cam, 'drift', () => this.commit()),
    );
    const sc = this.cfg.scene;
    const p = section(body, 'Particles');
    p.append(toggle('Show particles', sc.particles, 'enabled', () => this.commit(true)));
    if (sc.particles.enabled) {
      p.append(
        select('Style', sc.particles, 'style', PARTICLE_STYLES, () => this.commit()),
        range('Amount', sc.particles, 'count', 50, 3000, 50, () => this.commit()),
        color('Color', sc.particles, 'color', () => this.commit()),
        range('Size', sc.particles, 'size', 0.01, 0.2, 0.01, () => this.commit()),
        range('Speed', sc.particles, 'speed', 0, 2, 0.05, () => this.commit()),
      );
    }
    const l = section(body, 'Lighting');
    l.append(
      range('Ambient light', sc.light, 'ambient', 0, 2, 0.05, () => this.commit()),
      color('Main light', sc.light, 'color', () => this.commit()),
      range('Main light strength', sc.light, 'intensity', 0, 6, 0.1, () => this.commit()),
      color('Rim light', sc.light, 'rim', () => this.commit()),
    );
    const a = section(body, 'Atmosphere');
    a.append(toggle('Fog', sc.fog, 'enabled', () => this.commit(true)));
    if (sc.fog.enabled) a.append(color('Fog color', sc.fog, 'color', () => this.commit()), range('Fog thickness', sc.fog, 'density', 0, 0.15, 0.005, () => this.commit()));
    a.append(toggle('Moving floor grid', sc.floor, 'enabled', () => this.commit(true)));
    if (sc.floor.enabled) a.append(color('Grid color', sc.floor, 'color', () => this.commit()));
    const fld = section(body, 'Ground cover');
    fld.append(select('Field of', sc.field, 'type', { none: 'Nothing', sunflowers: 'Sunflowers', wildflowers: 'Wildflowers', grass: 'Tall grass', lavender: 'Lavender', pines: 'Pine forest', water: 'Ocean waves', dunes: 'Sand dunes' }, () => this.commit(true)));
    if (sc.field.type !== 'none') {
      fld.append(
        ...(['water', 'dunes'].includes(sc.field.type) ? [] : [range('How many', sc.field, 'count', 200, 4000, 100, () => this.commit())]),
        range(sc.field.type === 'water' ? 'Waves' : 'Wind', sc.field, 'wind', 0, 3, 0.1, () => this.commit(), '×'),
        color({ water: 'Water color', dunes: 'Sand color' }[sc.field.type] || 'Ground color', sc.field, 'ground', () => this.commit()),
        el('p', 'hint', 'They sway in the wind and stretch off into the distance. Fewer is faster on older computers.'),
      );
    }
    const snd = section(body, 'Soundscape');
    const gs = this.cfg.general.sound;
    snd.append(select('Ambient sound for this scene', sc, 'sound', SOUNDSCAPES, () => this.commit(true)));
    if (sc.sound === 'custom') {
      snd.append(
        el('p', 'hint', sc.soundFile ? 'Playing your file on a loop.' : 'Choose a sound or music file (MP3, OGG, WAV, FLAC, M4A). It loops while the scene is showing.'),
        upload(sc.soundFile ? 'Choose another file' : 'Choose a sound file', 'audio/*', async files => { sc.soundFile = await this.upload(files[0]); this.commit(true); }),
      );
    }
    if (!gs.ambient) {
      snd.append(el('p', 'hint', 'Ambient sound is off.'), button('Turn on ambient sound', () => { gs.ambient = true; this.commit(true); this.cb.toast('Ambient sound is on. Set the volume in Settings.'); }));
    } else {
      snd.append(range('Volume', gs, 'ambientVolume', 0, 1, 0.05, () => this.commit(), '', v => Math.round(v * 100) + '%'));
    }
  }

  // ---- 3D objects -------------------------------------------------------------
  objectsTab(body) {
    const list = section(body, '3D objects');
    const add = el('div', 'row add-row');
    const pick = document.createElement('select');
    pick.setAttribute('aria-label', 'Shape to add');
    for (const [k, v] of Object.entries(SHAPES)) pick.add(new Option(v, k));
    add.append(pick, button('Add', () => {
      const o = defaultObject(pick.value);
      if (o.shape === 'model') o.material = 'original';
      o.position = { x: rnd(-3, 3), y: rnd(-1.5, 1.5), z: rnd(-2, 0) };
      this.cfg.objects.push(o);
      this.selectedObject = o.id;
      this.commit(true);
    }, 'primary'));
    list.appendChild(add);
    const lib = el('div', 'row actions');
    lib.appendChild(button('Add a free 3D model from the online library', () => this.openLibrary('models', (url, item) => {
      const o = defaultObject('model');
      Object.assign(o, { model: url, material: 'original', name: item.name, scale: 1.4, position: { x: rnd(1, 3.5), y: rnd(-1, 0.5), z: rnd(-1.5, 0) } });
      o.spin = { enabled: true, x: 0, y: 0.25, z: 0 };
      this.cfg.objects.push(o);
      this.selectedObject = o.id;
      this.tab = 'customize';
      this.commit(true);
    })));
    list.appendChild(lib);
    list.appendChild(this.itemList(this.cfg.objects, this.selectedObject, id => { this.selectedObject = id; this.cb.onSelectObject(id); this.render(); }));
    list.appendChild(el('p', 'hint', 'Tip: while editing, drag an object to move it and scroll on it to resize.'));

    const o = this.cfg.objects.find(x => x.id === this.selectedObject);
    if (!o) return;
    const s = section(body, o.name || 'Object', { open: true, hint: 'The selected 3D object' });
    s.append(
      text('Name', o, 'name', () => this.commit(), () => this.render()),
      select('Shape', o, 'shape', SHAPES, () => { if (o.shape === 'model' && o.material !== 'original') o.material = 'original'; this.commit(true); }),
    );
    if (o.shape === 'model') {
      s.append(upload(o.model ? 'Replace 3D model' : 'Choose a .glb model', '.glb,.gltf', async files => { o.model = await this.upload(files[0]); this.commit(true); }));
      s.appendChild(el('p', 'hint', 'Self-contained .glb files work best (Blender: File → Export → glTF Binary).'));
    }
    s.append(
      select('Material', o, 'material', o.shape === 'model' ? { original: 'Keep model colors', ...MATERIALS } : MATERIALS, () => this.commit(true)),
      color('Color', o, 'color', () => this.commit()),
      range('Glow', o, 'glow', 0, 2, 0.05, () => this.commit()),
      range('Size', o, 'scale', 0.1, 6, 0.05, () => this.commit()),
    );
    const pos = section(body, 'Position and angle');
    pos.append(
      range('Left / right', o.position, 'x', -10, 10, 0.1, () => this.commit()),
      range('Down / up', o.position, 'y', -6, 6, 0.1, () => this.commit()),
      range('Far / near', o.position, 'z', -15, 5, 0.1, () => this.commit()),
      range('Tilt', o.rotation, 'x', -180, 180, 1, () => this.commit(), '°'),
      range('Turn', o.rotation, 'y', -180, 180, 1, () => this.commit(), '°'),
      range('Roll', o.rotation, 'z', -180, 180, 1, () => this.commit(), '°'),
    );
    const mot = section(body, 'Motion');
    mot.append(toggle('Spins by itself', o.spin, 'enabled', () => this.commit(true)));
    if (o.spin.enabled) {
      mot.append(
        range('Spin speed (tilt)', o.spin, 'x', -2, 2, 0.05, () => this.commit()),
        range('Spin speed (turn)', o.spin, 'y', -2, 2, 0.05, () => this.commit()),
        range('Spin speed (roll)', o.spin, 'z', -2, 2, 0.05, () => this.commit()),
      );
    }
    mot.append(toggle('Floats up and down', o.float, 'enabled', () => this.commit(true)));
    if (o.float.enabled) mot.append(range('Float height', o.float, 'amount', 0, 1, 0.01, () => this.commit()), range('Float speed', o.float, 'speed', 0.05, 3, 0.05, () => this.commit()));
    const it = section(body, 'Mouse');
    it.append(
      toggle('You can grab it and spin it', o.interact, 'dragRotate', () => this.commit()),
      select('When the mouse is over it', o.interact, 'hover', { none: 'Nothing', grow: 'Grow a little', spin: 'Spin faster' }, () => this.commit()),
      toggle('Turns to look at the mouse', o.interact, 'lookAtMouse', () => this.commit()),
      select('When clicked', o.click, 'type', { none: 'Nothing', app: 'Open an app', drawer: 'Open all apps', url: 'Open a website' }, () => this.commit(true)),
    );
    if (o.click.type === 'app') it.append(this.appSelect('App to open', o.click, 'value'));
    if (o.click.type === 'url') it.append(text('Website address', o.click, 'value', () => this.commit()));
    const actions = el('div', 'row actions');
    actions.append(
      button(o.visible === false ? 'Show' : 'Hide', () => { o.visible = o.visible === false; this.commit(true); }),
      button('Duplicate', () => {
        const copy = { ...clone(o), id: uid(), name: o.name + ' copy', position: { ...o.position, x: o.position.x + 1 } };
        this.cfg.objects.push(copy);
        this.selectedObject = copy.id;
        this.commit(true);
      }),
      button('Delete', () => {
        this.cfg.objects = this.cfg.objects.filter(x => x.id !== o.id);
        this.selectedObject = null;
        this.cb.onSelectObject(null);
        this.commit(true);
      }, 'danger'),
    );
    body.appendChild(actions);
  }

  // ---- Widgets ------------------------------------------------------------------
  widgetsTab(body) {
    const list = section(body, 'Widgets');
    const add = el('div', 'row add-row');
    const pick = document.createElement('select');
    pick.setAttribute('aria-label', 'Widget to add');
    for (const [group, types] of Object.entries(WIDGET_GROUPS)) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const [k, v] of Object.entries(types)) og.appendChild(new Option(v, k));
      pick.appendChild(og);
    }
    add.append(pick, button('Add', () => {
      const w = defaultWidget(pick.value);
      Object.assign(w, freeSpot(this.cfg.widgets, w));
      if (w.type === 'dock') { w.x = Math.round((100 - (w.w / innerWidth) * 100) / 2); w.y = 86; }
      this.cfg.widgets.push(w);
      this.selectedWidget = w.id;
      this.cb.onSelectWidget(w.id);
      this.commit(true);
    }, 'primary'));
    list.appendChild(add);
    list.appendChild(this.itemList(this.cfg.widgets.map(w => ({ ...w, name: WIDGET_TYPES[w.type] + (w.type === 'text' ? `: ${w.settings.text.slice(0, 18)}` : '') })),
      this.selectedWidget, id => { this.selectedWidget = id; this.cb.onSelectWidget(id); this.render(); }));
    list.appendChild(el('p', 'hint', 'Tip: drag widgets on the desktop to move them (hold Shift to snap), drag the orange corner to resize.'));

    const w = this.cfg.widgets.find(x => x.id === this.selectedWidget);
    if (!w) return;
    const s = section(body, WIDGET_TYPES[w.type], { open: true, hint: 'The selected widget' });
    this.widgetSettings(s, w);
    const look = section(body, 'Placement and look');
    look.append(
      select('Card style', w, 'cardStyle', { '': 'Same as other widgets', ...CARD_STYLES }, () => this.commit()),
      toggle('Show card behind it', w, 'card', () => this.commit()),
      select('Moves', w, 'motion', { '': 'Same as other widgets', ...MOTIONS }, () => this.commit()),
      range('Depth (how much it moves with the camera)', w, 'depth', 0, 1.5, 0.05, () => this.commit()),
      range('Width', w, 'w', 80, 1600, 5, () => this.commit(), 'px'),
      range('Height', w, 'h', 40, 1000, 5, () => this.commit(), 'px'),
      color('Accent (this widget)', w.style, 'accent', () => this.commit(), this.cfg.theme.accent),
      color('Text color (this widget)', w.style, 'text', () => this.commit(), this.cfg.theme.text),
    );
    const actions = el('div', 'row actions');
    const idx = this.cfg.widgets.indexOf(w);
    actions.append(
      button('Bring forward', () => { move(this.cfg.widgets, idx, 1); this.commit(true); }),
      button('Send back', () => { move(this.cfg.widgets, idx, -1); this.commit(true); }),
      button(w.visible === false ? 'Show' : 'Hide', () => { w.visible = w.visible === false; this.commit(true); }),
      button('Duplicate', () => { const c = { ...clone(w), id: uid(), x: w.x + 2, y: w.y + 2 }; this.cfg.widgets.push(c); this.selectedWidget = c.id; this.cb.onSelectWidget(c.id); this.commit(true); }),
      button('Delete', () => { this.cfg.widgets = this.cfg.widgets.filter(x => x.id !== w.id); this.selectedWidget = null; this.cb.onSelectWidget(null); this.commit(true); }, 'danger'),
    );
    body.appendChild(actions);
  }

  widgetSettings(s, w) {
    const st = w.settings;
    const c = () => this.commit();
    const cr = () => this.commit(true);
    switch (w.type) {
      case 'clock': s.append(
        toggle('Analog face', st, 'analog', cr),
        segmented('Format', st, 'format', { 24: '24-hour', 12: '12-hour' }, c),
        toggle('Show seconds', st, 'seconds', c),
        range('Digit size (0 = fit the card)', st, 'size', 0, 220, 2, c, 'px')); break;
      case 'date': s.append(toggle('Long format', st, 'long', c)); break;
      case 'greeting': s.append(text('Your name (blank = account name)', st, 'name', c)); break;
      case 'system': s.append(...['cpu', 'memory', 'disk', 'battery', 'network'].map(k =>
        toggle({ cpu: 'CPU', memory: 'Memory', disk: 'Disk', battery: 'Battery', network: 'Network speed' }[k], st, k, c))); break;
      case 'apps': s.append(
        segmented('Layout', st, 'layout', { grid: 'Grid', list: 'List' }, c),
        range('Columns', st, 'columns', 2, 10, 1, c),
        toggle('Search box', st, 'search', c),
        toggle('Category tabs', st, 'categories', c),
        toggle('App names', st, 'labels', c),
        segmented('Order', st, 'sort', { name: 'A–Z', recent: 'Recently used' }, c),
        el('p', 'hint', 'Hover an app and click its star to pin it to your dock and favorites.'),
        button('Rescan installed apps', async () => { await this.cb.refreshApps(); this.cb.toast('App list updated'); })); break;
      case 'favorites': s.append(toggle('App names', st, 'labels', c), el('p', 'hint', 'Leave empty to show the apps you starred in the launcher.'), this.appsPicker(st)); break;
      case 'dock': s.append(
        range('Icon size', st, 'iconSize', 32, 96, 2, c, 'px'),
        toggle('Magnify on hover', st, 'magnify', c),
        toggle('"All apps" button', st, 'drawerButton', c),
        el('p', 'hint', 'Leave the list empty to show the apps you starred in the launcher.'),
        this.appsPicker(st)); break;
      case 'search': s.append(
        text('Placeholder', st, 'placeholder', c),
        select('Web search', st, 'web', { none: 'Apps only', duckduckgo: 'Also offer DuckDuckGo' }, c),
        el('p', 'hint', 'Web searches open in your browser; Aerie itself never goes online.')); break;
      case 'links': s.append(this.listEditor(st, 'items', [['label', 'Name'], ['url', 'https://…']], { label: '', url: 'https://' })); break;
      case 'worldclock': s.append(
        segmented('Format', st, 'format', { 24: '24-hour', 12: '12-hour' }, c),
        this.listEditor(st, 'zones', [['label', 'Place'], ['tz', 'Time zone']], { label: 'Paris', tz: 'Europe/Paris' }, TIMEZONES)); break;
      case 'countdown': s.append(text('Counting down to', st, 'label', c), dateInput('Date and time', st, 'date', c)); break;
      case 'timer': s.append(range('Focus minutes', st, 'minutes', 1, 90, 1, c, ' min'), range('Break minutes', st, 'breakMinutes', 1, 30, 1, c, ' min'),
        el('p', 'hint', 'A soft chime plays when a focus or break period ends.')); break;
      case 'graph': s.append(segmented('Shows', st, 'metric', { cpu: 'CPU', memory: 'Memory', network: 'Network' }, c)); break;
      case 'nowplaying': s.append(toggle('Album art', st, 'art', c), toggle('Play controls', st, 'controls', c),
        el('p', 'hint', 'Works with any player that supports the standard Linux media controls (Spotify, browsers, Rhythmbox, VLC…).')); break;
      case 'moon': s.append(toggle('Phase name and %', st, 'labels', c)); break;
      case 'notes': s.append(el('p', 'hint', 'Type straight into the note on your desktop. It saves on its own.')); break;
      case 'todo': s.append(text('Title', st, 'title', c), el('p', 'hint', 'Add tasks right on your desktop: type and press Enter.'),
        button('Clear finished tasks', () => { st.items = st.items.filter(i => !i.done); cr(); })); break;
      case 'quote': s.append(segmented('Text', st, 'source', { builtin: 'Rotating ideas', custom: 'My own' }, cr));
        if (st.source === 'custom') s.append(text('Quote', st, 'text', c), text('By (optional)', st, 'author', c));
        else s.append(range('Change every', st, 'minutes', 1, 240, 1, c, ' min'));
        break;
      case 'calendar': s.append(segmented('Week starts on', st, 'weekStart', { 0: 'Sunday', 1: 'Monday' }, () => { st.weekStart = Number(st.weekStart); c(); })); break;
      case 'text': s.append(text('Text', st, 'text', c), range('Size', st, 'size', 12, 200, 1, c, 'px'), range('Weight', st, 'weight', 100, 900, 100, c),
        segmented('Align', st, 'align', { left: 'Left', center: 'Center', right: 'Right' }, c)); break;
      case 'image': s.append(upload(st.url ? 'Replace image' : 'Choose image', 'image/*', async files => { st.url = await this.upload(files[0]); cr(); }),
        text('Description for screen readers', st, 'alt', c),
        segmented('Fit', st, 'fit', { cover: 'Fill', contain: 'Fit inside' }, c)); break;
      case 'slideshow': {
        const thumbs = el('div', 'thumbs');
        st.images.forEach((url, i) => {
          const f = document.createElement('figure');
          const img = document.createElement('img'); img.src = url; img.alt = `Photo ${i + 1}`;
          const x = button('×', () => { st.images.splice(i, 1); cr(); });
          x.setAttribute('aria-label', `Remove photo ${i + 1}`);
          f.append(img, x);
          thumbs.appendChild(f);
        });
        s.append(thumbs, upload('Add photos', 'image/*', async files => {
          for (const f of files) st.images.push(await this.upload(f));
          cr();
        }, true), range('Seconds per photo', st, 'seconds', 3, 120, 1, c, 's'), segmented('Fit', st, 'fit', { cover: 'Fill', contain: 'Fit inside' }, c));
        break;
      }
    }
  }

  // ---- COSMIC ---------------------------------------------------------------------
  cosmicTab(body) {
    const intro = el('div', 'intro');
    body.appendChild(intro);
    intro.appendChild(el('p', 'note', 'These change COSMIC itself, not just Aerie: your actual panel and dock (layout, applets, pinned apps, look), frosted glass and window style. Your original setup is saved the first time, so you can always restore it at the bottom.'));
    if (!this.cosmic) {
      intro.appendChild(el('p', 'hint', 'Reading your COSMIC settings…'));
      api.cosmicLook().then(look => { this.cosmic = look; if (this.tab === 'desktop') this.render(); });
      return;
    }
    const look = this.cosmic;
    if (!look.available) {
      intro.appendChild(el('p', 'warn', STANDALONE ? 'Not available in preview mode.' : 'COSMIC settings were not found, so these options are off. They work on Pop!_OS with the COSMIC desktop.'));
      return;
    }
    const send = (changes, rerender = false) => {
      clearTimeout(this.cosmicTimer);
      const p = this.pendingCosmic || {};
      this.pendingCosmic = { ...p, ...changes, panel: { ...(p.panel || {}), ...(changes.panel || {}) }, dock: { ...(p.dock || {}), ...(changes.dock || {}) } };
      if (rerender) this.render();
      this.cosmicTimer = setTimeout(async () => {
        const pending = this.pendingCosmic; this.pendingCosmic = null;
        try {
          const res = await api.setCosmicLook(pending);
          this.cosmic = res.look;
        } catch (e) { this.cb.toast('Could not change COSMIC: ' + e.message); }
      }, 350);
    };
    const live = (key, sub, rerender) => () => send(sub ? { [sub]: { [key]: look[sub][key] } } : { [key]: look[key] }, rerender);

    // Layouts
    const lay = section(body, 'Taskbar layout');
    const grid = el('div', 'preset-grid tb-grid');
    const now = el('div', 'tb-now');
    now.append(layoutPreview(look), el('span', 'hint', 'Your taskbar now'));
    lay.appendChild(now);
    for (const [key, l] of Object.entries(TASKBAR_LAYOUTS)) {
      const card = el('button', 'preset tb-card');
      card.type = 'button';
      card.setAttribute('aria-label', `Use the ${l.name} taskbar layout: ${l.tagline}`);
      card.append(layoutPreview(l), el('span', 'preset-name', l.name), el('span', 'preset-tag', l.tagline));
      card.addEventListener('click', () => this.applyTaskbar(key));
      grid.appendChild(card);
    }
    lay.append(grid, el('p', 'hint', 'Changes your real COSMIC panel and dock right away. Your pinned apps stay as they are.'));

    // Each bar
    for (const [bar, label] of [['panel', 'Panel'], ['dock', 'Dock']]) {
      const b = look[bar];
      const g = section(body, label);
      g.append(toggle(bar === 'panel' ? 'Show the panel' : 'Show the dock', b, 'enabled', live('enabled', bar, true)));
      if (!b.enabled) continue;
      g.append(toggle('Look normal (solid, attached) while a window is maximized', b, 'normalOnMaximize', live('normalOnMaximize', bar)));
      const custom = (b.background || '').startsWith('#');
      const bgModel = { mode: custom ? 'Color' : b.background || 'ThemeDefault' };
      g.append(
        segmented('Position', b, 'anchor', { Top: 'Top', Bottom: 'Bottom', Left: 'Left', Right: 'Right' }, live('anchor', bar, true)),
        segmented('Size', b, 'size', { XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL' }, live('size', bar)),
        segmented('Color', bgModel, 'mode', { ThemeDefault: 'Theme', Dark: 'Dark', Light: 'Light', Color: 'Custom' }, () => {
          b.background = bgModel.mode === 'Color' ? (custom ? b.background : '#1d1b2e') : bgModel.mode;
          send({ [bar]: { background: b.background } }, true);
        }),
      );
      if (custom) g.append(color('Custom color', b, 'background', live('background', bar)));
      g.append(
        range('Opacity', b, 'opacity', 0, 1, 0.05, live('opacity', bar), '', v => Math.round(v * 100) + '%'),
        select('Auto-hide', b, 'autohide', { Never: 'Never', OnOverlap: 'When a window covers it', Always: 'Always' }, live('autohide', bar)),
        toggle('Floating (gap from screen edge)', b, 'floating', live('floating', bar)),
        toggle('Stretch to screen edges', b, 'stretch', live('stretch', bar)),
        range('Corner roundness', b, 'radius', 0, 32, 1, live('radius', bar), 'px'),
        range('Margin', b, 'margin', 0, 24, 1, live('margin', bar), 'px'),
        range('Padding', b, 'padding', 0, 16, 1, live('padding', bar), 'px'),
        range('Space between applets', b, 'spacing', 0, 16, 1, live('spacing', bar), 'px'),
      );
      g.appendChild(this.appletEditor(b, bar, send));
    }

    // Pinned apps
    if (look.dock.enabled || [...look.panel.left, ...look.panel.center, ...look.panel.right].includes('com.system76.CosmicAppList')) {
      const pin = section(body, 'Pinned apps');
      pin.appendChild(el('p', 'hint', 'The apps COSMIC keeps on your dock or taskbar, in order.'));
      pin.appendChild(this.pinnedEditor(look, send));
    }

    if (!this.embedded) this.lockscreenSection(body);

    const glass = section(body, 'Glass');
    glass.append(
      toggle('Frosted glass windows', look, 'frostedWindows', live('frostedWindows')),
      toggle('Frosted panel and dock', look, 'frostedPanel', live('frostedPanel')),
      toggle('Frosted menus and pop-ups', look, 'frostedApplets', live('frostedApplets')),
      toggle('Frosted system interface', look, 'frostedSystem', live('frostedSystem')),
      toggle('Keep glass when a window is maximized', look, 'frostedMaximized', live('frostedMaximized')),
      range('Blur strength', look, 'blur', 0, 13, 1, live('blur'), '', v => ['very light', 'very light', 'light', 'light', 'soft', 'soft', 'medium', 'medium', 'strong', 'strong', 'very strong', 'very strong', 'maximum', 'maximum'][v]),
      el('p', 'hint', 'Windows only look like glass when their app uses a see-through background (most COSMIC apps do).'),
    );
    const win = section(body, 'Windows');
    win.append(
      segmented('Corners', look, 'corners', { Round: 'Round', SlightlyRound: 'Slightly round', Square: 'Square' }, live('corners')),
      range('Gap between windows', look, 'gapInner', 0, 32, 1, live('gapInner'), 'px'),
      range('Gap at screen edges', look, 'gapOuter', 0, 32, 1, live('gapOuter'), 'px'),
      range('Active window border', look, 'activeHint', 0, 10, 1, live('activeHint'), 'px'),
      toggle('Dark mode', look, 'isDark', live('isDark')),
    );
    const r = section(body, 'Undo');
    r.append(
      el('p', 'hint', look.backedUp ? 'Your original COSMIC setup is saved.' : 'Nothing changed yet.'),
      button('Restore my original COSMIC look', async () => {
        if (!confirm('Put COSMIC back exactly how it was before Aerie changed it (panel, dock, pinned apps, glass and windows)?')) return;
        const res = await api.restoreCosmicLook().catch(() => null);
        this.cosmic = res?.look || this.cosmic;
        this.cb.toast(res?.ok ? 'COSMIC look restored' : 'There was nothing to restore');
        this.render();
      }),
    );
  }

  // ---- the design assistant ----------------------------------------------------------------
  assistantTab(body) {
    const ai = this.ai ||= { settings: null, chat: [], busy: false, setup: false, draft: '' };
    if (STANDALONE) {
      section(body, 'Assistant').appendChild(el('p', 'hint', 'The assistant works in the Aerie app, not in preview mode.'));
      return;
    }
    if (!ai.settings) {
      body.appendChild(el('p', 'hint', 'Loading…'));
      api.assistant().then(s => { ai.settings = s; ai.pick = s.provider || 'claude'; if (this.tab === 'assistant') this.render(); },
        () => { ai.settings = { provider: '', models: {}, hasKey: {} }; this.render(); });
      return;
    }
    if (!ai.settings.provider || ai.setup) this.assistantSetup(body, ai);
    else this.assistantChat(body, ai);
  }

  assistantSetup(body, ai) {
    const s = section(body, 'Choose your AI', { open: true, hint: 'It only helps design your desktop' });
    const choices = {
      claude: ['Claude', 'by Anthropic · great design taste', 'Needs an API key from console.anthropic.com (pay as you go).'],
      openai: ['ChatGPT', 'by OpenAI', 'Needs an API key from platform.openai.com (pay as you go).'],
      ollama: ['Ollama', 'free · private · on your computer', 'Install it from ollama.com, then download a model in a terminal, for example: ollama pull llama3.2'],
    };
    const grid = el('div', 'ai-choices');
    for (const [key, [name, sub]] of Object.entries(choices)) {
      const b = el('button', 'ai-choice' + (ai.pick === key ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(ai.pick === key));
      b.append(el('strong', '', name), el('span', '', sub));
      b.addEventListener('click', () => { ai.pick = key; this.render(); });
      grid.appendChild(b);
    }
    s.append(grid, el('p', 'hint', choices[ai.pick][2]));
    const form = { key: '', model: ai.settings.models?.[ai.pick] || '', url: ai.settings.ollamaUrl || 'http://127.0.0.1:11434' };
    if (ai.pick === 'ollama') {
      const pick = document.createElement('select');
      pick.setAttribute('aria-label', 'Ollama model');
      pick.add(new Option('Looking for your models…', ''));
      api.ollamaModels().then(r => {
        pick.replaceChildren();
        if (!r.models.length) pick.add(new Option(r.error ? 'Aerie can\'t reach Ollama. Is it running?' : 'No models yet. Run: ollama pull llama3.2', ''));
        for (const m of r.models) pick.add(new Option(m, m));
        pick.value = r.models.includes(form.model) ? form.model : (r.models[0] || '');
        form.model = pick.value;
      });
      pick.addEventListener('change', () => { form.model = pick.value; });
      s.append(text('Ollama address', form, 'url', () => {}), field('Model', pick),
        el('p', 'note', 'Private: with Ollama, nothing leaves your computer.'));
    } else {
      const key = document.createElement('input');
      key.type = 'password';
      key.autocomplete = 'off';
      key.placeholder = ai.settings.hasKey?.[ai.pick] ? 'Saved. Leave empty to keep it.' : 'Paste your API key';
      key.addEventListener('input', () => { form.key = key.value; });
      s.append(field('API key', key), text('Model', form, 'model', () => {}),
        el('p', 'note', `When you use ${choices[ai.pick][0]}, what you type and a short description of your desktop design (colors, widget types and positions, 3D shapes; never your notes, to-dos, names or files) are sent to ${ai.pick === 'claude' ? 'Anthropic' : 'OpenAI'}, and their terms apply. Your key is stored only on this computer, readable only by you.`));
    }
    const row = el('div', 'row actions');
    row.append(button('Save and start', async () => {
      const changes = { provider: ai.pick, models: { [ai.pick]: form.model } };
      if (ai.pick === 'ollama') changes.ollamaUrl = form.url;
      else if (form.key) changes.keys = { [ai.pick]: form.key };
      if (ai.pick !== 'ollama' && !form.key && !ai.settings.hasKey?.[ai.pick]) { this.cb.toast('Paste your API key first'); return; }
      if (ai.pick === 'ollama' && !form.model) { this.cb.toast('Pick a model first (or download one with Ollama)'); return; }
      try {
        ai.settings = await api.assistantSettings(changes);
        ai.setup = false;
        this.cb.sound?.('success');
        this.render();
      } catch (e) { this.cb.toast('Could not save: ' + e.message); }
    }, 'primary'));
    if (ai.settings.provider) row.append(button('Cancel', () => { ai.setup = false; this.render(); }));
    if (ai.pick !== 'ollama' && ai.settings.hasKey?.[ai.pick]) {
      row.append(button('Forget my key', async () => {
        ai.settings = await api.assistantSettings({ keys: { [ai.pick]: '' }, ...(ai.settings.provider === ai.pick ? { provider: '' } : {}) });
        this.cb.toast('Key removed from this computer');
        this.render();
      }, 'danger'));
    }
    s.appendChild(row);
  }

  assistantChat(body, ai) {
    const names = { claude: 'Claude', openai: 'ChatGPT', ollama: 'Ollama' };
    const wrap = el('div', 'ai');
    const head = el('div', 'ai-head');
    head.append(el('span', '', `${names[ai.settings.provider]} · ${ai.settings.models?.[ai.settings.provider] || ''}`),
      button('Change AI', () => { ai.setup = true; ai.pick = ai.settings.provider; this.render(); }, 'link'));
    const log = el('div', 'ai-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const bubble = (cls, text) => { const b = el('div', 'bubble ' + cls); if (text) b.appendChild(el('p', '', text)); log.appendChild(b); return b; };
    bubble('ai', 'Hi! Tell me how you’d like your desktop to look or feel, and I’ll design it. I can change the scene, colors, widgets, 3D objects and sounds, and you can undo anything.');
    if (!ai.chat.length) {
      const chips = el('div', 'chips ai-chips');
      for (const sug of SUGGESTIONS) chips.appendChild(button(sug, () => this.askAssistant(sug), 'chip-sug'));
      log.appendChild(chips);
    }
    ai.chat.forEach((m, i) => {
      if (m.role === 'user') { bubble('me', m.content); return; }
      if (m.role === 'error') { bubble('err', m.content); return; }
      const b = bubble('ai', m.content);
      if (m.done?.length) {
        const ul = el('ul', 'ai-done');
        for (const d of m.done) ul.appendChild(el('li', '', d));
        b.appendChild(ul);
        b.appendChild(m.undone ? el('p', 'hint', 'Undone.') : button('Undo', () => this.undoAssistant(i), 'small'));
      }
      if (m.cosmic && !m.cosmicDone) {
        const ask = el('div', 'ai-cosmic');
        ask.append(el('p', '', `It also suggests changing COSMIC itself: ${describeCosmic(m.cosmic)}.`),
          button('Apply to COSMIC', async () => {
            try {
              const res = await api.setCosmicLook(cosmicChanges(m.cosmic));
              this.cosmic = res.look;
              m.cosmicDone = true;
              this.cb.toast('COSMIC updated. Desktop → Undo puts it back.');
            } catch (e) { this.cb.toast('Could not change COSMIC: ' + e.message); }
            this.render();
          }, 'small'),
          button('No thanks', () => { m.cosmicDone = true; this.render(); }, 'small link'));
        b.appendChild(ask);
      }
    });
    if (ai.busy) bubble('ai typing', '').append(el('i'), el('i'), el('i'));
    const box = el('form', 'ai-input');
    const input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = 'e.g. “Make it feel like a rainy night in Tokyo”';
    input.setAttribute('aria-label', 'Message to the design assistant');
    input.value = ai.draft || '';
    input.addEventListener('input', () => { ai.draft = input.value; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); box.requestSubmit(); } });
    const send = button('Send', () => {}, 'primary');
    send.type = 'submit';
    send.disabled = ai.busy;
    box.append(input, send);
    box.addEventListener('submit', e => { e.preventDefault(); if (input.value.trim() && !ai.busy) this.askAssistant(input.value.trim()); });
    // what goes along with your message is your choice, and you can see it here
    const g = this.cfg.general;
    const share = document.createElement('input');
    share.type = 'checkbox';
    share.checked = g.assistantShare !== false;
    share.addEventListener('change', () => { g.assistantShare = share.checked; this.commit(); });
    const shareRow = el('label', 'ai-share');
    shareRow.append(share, el('span', '', ai.settings.provider === 'ollama'
      ? 'Send a short description of my desktop design (colors, widget types, 3D shapes) to Ollama on this computer'
      : `Send a short description of my desktop design (colors, widget types, 3D shapes) to ${names[ai.settings.provider]}. Never my notes, files or app list.`));
    wrap.append(head, log, box, shareRow, el('p', 'hint ai-foot', 'The assistant only helps design your desktop.'));
    body.appendChild(wrap);
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; if (!ai.busy) input.focus(); });
  }

  async askAssistant(textIn) {
    const ai = this.ai;
    ai.chat.push({ role: 'user', content: textIn });
    ai.draft = '';
    ai.busy = true;
    this.render();
    const history = ai.chat.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    try {
      setWallpaperChoices(await api.wallpapers());
      const res = await api.assistantChat(history, this.cfg.general.assistantShare === false ? '' : buildContext(this.cfg));
      const { scene, camera, objects, widgets, theme, presetName } = this.cfg;
      const snapshot = clone({ scene, camera, objects, widgets, theme, presetName });
      const result = applyChanges(this.cfg, res.changes);
      if (result.done.length) {
        this.selectedObject = this.selectedWidget = null;
        this.cb.onChange();
        this.cb.sound?.('success');
      }
      ai.chat.push({ role: 'assistant', content: res.reply, done: result.done, snapshot: result.done.length ? snapshot : null, cosmic: result.cosmic });
    } catch (e) {
      ai.chat.push({ role: 'error', content: e.message || 'Something went wrong' });
      this.cb.sound?.('error');
    }
    ai.busy = false;
    if (this.open && this.tab === 'assistant') this.render();
  }

  undoAssistant(i) {
    const m = this.ai.chat[i];
    if (!m?.snapshot) return;
    Object.assign(this.cfg, normalizeConfig({ ...clone(m.snapshot), general: this.cfg.general }), { presetName: m.snapshot.presetName });
    m.undone = true;
    this.commit(true);
    this.cb.toast('Undone');
  }

  // ---- online library (Poly Haven, CC0) --------------------------------------------
  openLibrary(kind, onPick) {
    this.library = { kind, onPick, query: '', shown: 48, resolution: kind === 'hdris' ? '4k' : '1k', busy: '' };
    this.render();
    this.panel.querySelector('.panel-body').scrollTop = 0;
  }

  libraryView(body) {
    const lib = this.library;
    const g = this.cfg.general;
    const head = section(body, lib.kind === 'hdris' ? 'Free 360° skies' : 'Free 3D models');
    head.appendChild(button('‹ Back', () => { this.library = null; this.render(); }));
    if (!g.libraryConsent) {
      head.append(
        el('p', 'note', 'The online library is Poly Haven (polyhaven.com), a free collection of 360° skies and 3D models that anyone may use for anything (CC0). To show it, Aerie connects to Poly Haven and downloads the list, small previews, and only the things you pick. Poly Haven sees an ordinary download request (your internet address and that it comes from Aerie); nothing else about you is sent. Without the library, Aerie stays offline.'),
        button('Show the library', async () => {
          g.libraryConsent = true;
          this.cb.onChange();
          await this.cb.saveNow?.();
          this.render();
        }, 'primary'),
      );
      return;
    }
    const cache = this.libraryItems ||= {};
    if (!cache[lib.kind]) {
      head.appendChild(el('p', 'hint', 'Loading the library…'));
      api.library(lib.kind).then(items => { cache[lib.kind] = items; }, e => { cache[lib.kind] = { error: e.message }; })
        .then(() => { if (this.library === lib) this.render(); });
      return;
    }
    if (cache[lib.kind].error) {
      head.append(el('p', 'warn', cache[lib.kind].error), button('Try again', () => { delete cache[lib.kind]; this.render(); }));
      return;
    }
    const tools = el('div', 'row add-row');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = lib.kind === 'hdris' ? 'Search: sunset, night, clouds, city…' : 'Search: plant, chair, statue…';
    search.value = lib.query;
    search.setAttribute('aria-label', 'Search the library');
    const quality = document.createElement('select');
    quality.setAttribute('aria-label', 'Quality');
    const qualities = lib.kind === 'hdris'
      ? { '2k': '2K · fast (~6 MB)', '4k': '4K · sharp (~25 MB)', '8k': '8K · sharpest (~100 MB)' }
      : { '1k': 'Normal textures', '2k': 'Detailed textures' };
    for (const [v, t] of Object.entries(qualities)) quality.add(new Option(t, v));
    quality.value = lib.resolution;
    quality.addEventListener('change', () => { lib.resolution = quality.value; });
    tools.append(search, quality);
    head.appendChild(tools);
    const grid = el('div', 'lib-grid');
    const fill = () => {
      const q = lib.query.trim().toLowerCase();
      const items = cache[lib.kind].filter(i => !q || i.name.toLowerCase().includes(q)
        || i.tags.some(t => t.includes(q)) || i.categories.some(c => c.includes(q)));
      grid.replaceChildren(...items.slice(0, lib.shown).map(item => {
        const b = el('button', 'lib-item' + (lib.busy === item.id ? ' busy' : ''));
        b.type = 'button';
        b.setAttribute('aria-label', `Use ${item.name}`);
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        img.src = '/library-thumb/' + encodeURIComponent(item.id);
        b.append(img, el('span', 'lib-name', item.name));
        b.addEventListener('click', async () => {
          if (lib.busy) return;
          lib.busy = item.id;
          b.classList.add('busy');
          this.cb.toast(`Downloading ${item.name}…`);
          try {
            const url = await api.libraryFetch(lib.kind, item.id, lib.resolution);
            this.library = null;
            lib.onPick(url, item);
            this.cb.sound?.('success');
            this.cb.toast(`${item.name} added`);
          } catch (e) {
            lib.busy = '';
            b.classList.remove('busy');
            this.cb.toast('Download failed: ' + e.message);
          }
        });
        return b;
      }));
      if (!items.length) grid.appendChild(el('p', 'hint', 'Nothing matches that search.'));
      more.hidden = items.length <= lib.shown;
    };
    const more = button('Show more', () => { lib.shown += 48; fill(); });
    search.addEventListener('input', () => { lib.query = search.value; lib.shown = 48; fill(); });
    head.append(grid, more, el('p', 'hint', 'From Poly Haven · CC0, free for any use. Downloads are kept on this computer.'));
    fill();
  }

  // ---- lock screen ------------------------------------------------------------------
  lockscreenSection(body) {
    const s = section(body, 'Lock screen');
    const lock = this.cfg.general.lock ||= { source: 'scene', widgets: false, darken: 0.15, message: '', messagePos: 'bottom' };
    const look = this.cosmic;
    s.appendChild(el('p', 'hint', 'COSMIC’s lock screen (and login screen) show your wallpaper picture, your profile picture and a clock. Design them here. The picture also becomes COSMIC’s wallpaper behind Aerie; Restore at the bottom of this tab puts everything back.'));

    // a preview that looks roughly like COSMIC's lock screen
    const preview = el('div', 'lock-preview');
    const pic = document.createElement('img');
    pic.alt = 'Your lock screen picture';
    pic.src = '/lockscreen-picture?' + Date.now();
    pic.addEventListener('error', () => { pic.remove(); preview.classList.add('empty'); });
    const now = new Date();
    const clock = el('div', 'lp-clock', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !look.clock24 }).replace(/\s?[AP]M$/i, ''));
    const date = el('div', 'lp-date', now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    const who = el('div', 'lp-user');
    who.append(el('i', 'lp-avatar'), el('span', 'lp-field', 'Password'));
    preview.append(pic, clock, date, who, el('span', 'lp-tag', 'Preview'));
    s.appendChild(preview);

    const saveAndRender = () => { this.cb.onChange(); };
    s.append(
      segmented('Picture', lock, 'source', { scene: 'This scene', picture: 'A picture I choose' }, () => { this.commit(true); }),
    );
    if (lock.source === 'scene') {
      s.append(
        toggle('Include my widgets', lock, 'widgets', saveAndRender),
        range('Darken (so the clock is easy to read)', lock, 'darken', 0, 0.7, 0.05, saveAndRender, '', v => Math.round(v * 100) + '%'),
        text('Message on the picture (optional)', lock, 'message', saveAndRender),
        segmented('Message position', lock, 'messagePos', { top: 'Top', middle: 'Middle', bottom: 'Bottom' }, saveAndRender),
      );
      const row = el('div', 'row actions');
      row.append(button('Set as my lock screen', async () => {
        if (await this.cb.lockscreenFromScene?.()) { this.cosmic = null; this.render(); }
      }, 'primary'));
      s.appendChild(row);
    } else {
      s.appendChild(upload('Choose a picture and set it', 'image/png,image/jpeg,image/webp', async files => {
        try {
          await api.setLockscreen({ source: 'image', url: await this.upload(files[0]) });
          this.cb.sound?.('success');
          this.cb.toast('Lock screen updated');
          this.render();
        } catch (e) { this.cb.toast('Could not set the lock screen: ' + e.message); }
      }));
    }
    const clockModel = { clock24: !!look.clock24 };
    s.append(
      segmented('Clock', clockModel, 'clock24', { false: '12-hour', true: '24-hour' }, async () => {
        const want = String(clockModel.clock24) === 'true';
        try { this.cosmic = (await api.setCosmicLook({ clock24: want })).look; this.render(); } catch (e) { this.cb.toast('Could not change the clock: ' + e.message); }
      }),
      el('p', 'hint', 'The clock setting is shared with the clock in your panel.'),
      upload('Change my profile picture…', 'image/png,image/jpeg,image/webp', async files => {
        try {
          const url = await this.upload(files[0]);
          const res = await api.setAvatar(url);
          if (!res.ok) throw new Error(res.error);
          this.cb.sound?.('success');
          this.cb.toast('Profile picture changed (lock and login screens)');
        } catch (e) { this.cb.toast('Could not change your picture: ' + e.message); }
      }),
    );
    const lockRow = el('div', 'row actions');
    lockRow.appendChild(button('Lock now to see it', async () => {
      const res = await api.lockNow();
      if (!res.ok) this.cb.toast('Press Super+Escape to lock the screen');
    }));
    s.appendChild(lockRow);
  }

  /** Applies a ready-made taskbar layout to COSMIC's real panel and dock. */
  async applyTaskbar(key, ask = true) {
    const l = TASKBAR_LAYOUTS[key];
    if (!l) return;
    if (ask && !confirm(`Change your COSMIC panel and dock to "${l.name}"? You can restore your original setup any time.`)) return;
    const { name, tagline, ...changes } = l;
    try {
      const res = await api.setCosmicLook(clone(changes));
      this.cosmic = res.look;
      this.cb.toast(`Taskbar: ${l.name}`);
      this.cb.sound?.('success');
    } catch (e) { this.cb.toast('Could not change COSMIC: ' + e.message); }
    if (this.open && this.tab === 'desktop') this.render();
  }

  /** The applets on one bar, in three zones, with move, remove and add. */
  appletEditor(b, bar, send) {
    const wrap = el('div', 'applets');
    const vertical = b.anchor === 'Left' || b.anchor === 'Right';
    const zones = [['left', vertical ? 'Top' : 'Left'], ['center', 'Middle'], ['right', vertical ? 'Bottom' : 'Right']];
    const applets = this.cosmic.applets || [];
    const save = () => send({ [bar]: { left: b.left, center: b.center, right: b.right } }, true);
    wrap.appendChild(el('h4', '', 'What’s on it'));
    zones.forEach(([zone, label], zi) => {
      const row = el('div', 'zone');
      row.appendChild(el('span', 'zone-label', label));
      const chips = el('div', 'chips');
      if (!b[zone].length) chips.appendChild(el('span', 'chip-empty', 'empty'));
      b[zone].forEach((id, i) => {
        const name = appletName(applets, id);
        const chip = el('span', 'chip');
        const back = button('‹', () => {
          b[zone].splice(i, 1);
          if (i > 0) b[zone].splice(i - 1, 0, id);
          else if (zi > 0) b[zones[zi - 1][0]].push(id);
          else b[zone].unshift(id);
          save();
        }, 'chip-btn');
        back.setAttribute('aria-label', `Move ${name} earlier`);
        const fwd = button('›', () => {
          b[zone].splice(i, 1);
          if (i < b[zone].length) b[zone].splice(i + 1, 0, id);
          else if (zi < 2) b[zones[zi + 1][0]].unshift(id);
          else b[zone].push(id);
          save();
        }, 'chip-btn');
        fwd.setAttribute('aria-label', `Move ${name} later`);
        const del = button('×', () => { b[zone].splice(i, 1); save(); }, 'chip-btn');
        del.setAttribute('aria-label', `Remove ${name}`);
        chip.append(back, el('span', '', name), fwd, del);
        chips.appendChild(chip);
      });
      row.appendChild(chips);
      wrap.appendChild(row);
    });
    const used = new Set([...b.left, ...b.center, ...b.right]);
    const free = applets.filter(a => !used.has(a.id));
    if (free.length) {
      const add = el('div', 'row add-row');
      const pick = document.createElement('select');
      pick.setAttribute('aria-label', `Applet to add to the ${bar}`);
      for (const a of free) pick.add(new Option(a.name, a.id));
      const where = document.createElement('select');
      where.setAttribute('aria-label', 'Where to add it');
      for (const [z, label] of zones) where.add(new Option(label, z));
      where.value = 'right';
      add.append(pick, where, button('Add', () => { b[where.value].push(pick.value); save(); }, 'primary'));
      wrap.appendChild(add);
    }
    return wrap;
  }

  /** COSMIC's pinned apps (the app list applet's favorites), with order and add/remove. */
  pinnedEditor(look, send) {
    const wrap = el('div', 'pinned');
    const apps = this.cb.getApps();
    const name = id => apps.find(a => a.id === id || a.id.toLowerCase() === id.toLowerCase())?.name || id;
    const icon = id => apps.find(a => a.id === id)?.hasIcon ? '/icon/' + encodeURIComponent(id) : null;
    const save = () => send({ pinned: look.pinned }, true);
    const ul = el('ul', 'pin-list');
    if (!look.pinned.length) ul.appendChild(el('li', 'empty', 'No pinned apps'));
    look.pinned.forEach((id, i) => {
      const li = el('li');
      const ic = icon(id);
      if (ic) { const img = document.createElement('img'); img.src = ic; img.alt = ''; li.appendChild(img); }
      li.appendChild(el('span', '', name(id)));
      const up = button('↑', () => { move(look.pinned, i, -1); save(); }, 'chip-btn');
      up.setAttribute('aria-label', `Move ${name(id)} up`);
      up.disabled = i === 0;
      const down = button('↓', () => { move(look.pinned, i, 1); save(); }, 'chip-btn');
      down.setAttribute('aria-label', `Move ${name(id)} down`);
      down.disabled = i === look.pinned.length - 1;
      const del = button('×', () => { look.pinned.splice(i, 1); save(); }, 'chip-btn');
      del.setAttribute('aria-label', `Unpin ${name(id)}`);
      li.append(up, down, del);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    const add = el('div', 'row add-row');
    const pick = document.createElement('select');
    pick.setAttribute('aria-label', 'App to pin');
    pick.add(new Option(apps.length ? 'Pin an app…' : 'Loading apps…', ''));
    for (const a of apps) if (!look.pinned.includes(a.id)) pick.add(new Option(a.name, a.id));
    add.append(pick, button('Pin', () => { if (pick.value) { look.pinned.push(pick.value); save(); } }, 'primary'));
    const row = el('div', 'row actions');
    row.append(button('Copy my Aerie dock pins', () => {
      const mine = this.cfg.general.pinned || [];
      if (!mine.length) { this.cb.toast('Star apps in the launcher first'); return; }
      look.pinned = [...new Set([...look.pinned, ...mine])];
      save();
    }));
    wrap.append(add, row);
    return wrap;
  }

  // ---- Settings ----------------------------------------------------------------------
  settingsTab(body) {
    const g = this.cfg.general;
    const s = section(body, 'Behavior');
    s.append(
      select('Reduce motion', g, 'reducedMotion', { system: 'Follow system setting', on: 'Always (no camera or spin motion)', off: 'Never' }, () => this.commit(true)),
      select('Frame rate limit', g, 'fps', { 30: '30 fps (saves battery)', 60: '60 fps', 120: '120 fps', 240: '240 fps' }, () => { g.fps = Number(g.fps); this.commit(); }),
      select('Pause the wallpaper', g, 'pauseWhen', {
        maximized: 'When a window is maximized',
        focused: 'While I use any app',
        never: 'Never',
      }, () => this.commit()),
      el('p', 'hint', 'While paused, nothing moves or redraws (and the soundscape stops), so games and apps get your computer’s full speed, like Wallpaper Engine. It never pauses while the editor or app drawer is open, or while your mouse is on the wallpaper.'),
      el('p', 'status-line', this.cb.pauseStatus?.() || ''),
      select('Open all apps from a hot corner', g, 'drawerCorner', { none: 'Off', 'top-left': 'Top-left', 'top-right': 'Top-right', 'bottom-left': 'Bottom-left', 'bottom-right': 'Bottom-right' }, () => this.commit()),
    );
    const auto = el('label', 'row toggle');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.disabled = STANDALONE;
    api.autostart().then(v => { box.checked = v; });
    box.addEventListener('change', async () => { box.checked = await api.setAutostart(box.checked).catch(() => !box.checked); });
    auto.append(el('span', '', 'Start Aerie when I log in'), box);
    s.appendChild(auto);

    const snd = section(body, 'Sound and presets');
    const gs = g.sound;
    snd.append(
      toggle('Mute all sounds', gs, 'muted', () => this.commit(true)),
      toggle('Interface sounds (clicks, opening apps, the drawer…)', gs, 'ui', () => this.commit(true)),
    );
    if (gs.ui) {
      snd.append(
        segmented('Sound style', gs, 'pack', SOUND_PACKS, () => { this.commit(); this.cb.sound?.('success'); }),
        range('Interface volume', gs, 'volume', 0, 1, 0.05, () => this.commit(), '', v => Math.round(v * 100) + '%'),
        toggle('Tiny tick when hovering apps', gs, 'hover', () => this.commit()),
      );
    }
    snd.append(toggle('Ambient soundscape (rain, fire, ocean… set per scene)', gs, 'ambient', () => this.commit(true)));
    if (gs.ambient) {
      snd.append(
        select('Soundscape', this.cfg.scene, 'sound', SOUNDSCAPES, () => this.commit()),
        range('Ambient volume', gs, 'ambientVolume', 0, 1, 0.05, () => this.commit(), '', v => Math.round(v * 100) + '%'),
        toggle('Fade out while music or video plays', gs, 'pauseForMusic', () => this.commit()),
        el('p', 'hint', 'Plays from your main screen only. Sound starts after your first click or key press on the desktop.'),
      );
    }
    const own = section(body, 'Your own sounds');
    own.appendChild(el('p', 'hint', 'Replace any interface sound with a file of your own (MP3, OGG, WAV, FLAC or M4A). Short sounds work best. For your own background sound, pick “My own sound file” under Scene → Soundscape.'));
    gs.custom ||= {};
    for (const [key, label] of Object.entries(CUSTOM_SOUNDS)) {
      const row = el('div', 'row own-sound');
      const name = el('span', '', label);
      const state = el('small', 'hint', gs.custom[key] ? 'your file' : 'built-in');
      const tools = el('div', 'own-tools');
      if (gs.custom[key]) {
        const play = button('▶', () => this.cb.previewSound?.(gs.custom[key]), 'chip-btn');
        play.setAttribute('aria-label', `Play your ${label.toLowerCase()} sound`);
        const clear = button('×', () => { gs.custom[key] = ''; this.commit(true); }, 'chip-btn');
        clear.setAttribute('aria-label', `Use the built-in ${label.toLowerCase()} sound`);
        tools.append(play, clear);
      }
      tools.appendChild(upload(gs.custom[key] ? 'Change' : 'Choose…', 'audio/*', async files => { gs.custom[key] = await this.upload(files[0]); this.commit(true); }));
      const left = el('div', 'own-name');
      left.append(name, state);
      row.append(left, tools);
      own.appendChild(row);
    }
    snd.append(select('When choosing a preset, also restyle the COSMIC taskbar', g, 'matchTaskbar', { ask: 'Ask me each time', always: 'Always', never: 'Never' }, () => this.commit()));

    const b = section(body, 'Back up or share your setup');
    const area = document.createElement('textarea');
    area.className = 'json';
    area.setAttribute('aria-label', 'Setup as text');
    area.value = JSON.stringify(this.cfg, null, 1);
    area.spellcheck = false;
    const row = el('div', 'row actions');
    row.append(
      button('Copy', async () => { try { await navigator.clipboard.writeText(area.value); this.cb.toast('Copied'); } catch { area.select(); } }),
      button('Load from text', () => {
        try {
          Object.assign(this.cfg, normalizeConfig(JSON.parse(area.value)));
          this.commit(true);
          this.cb.toast('Setup loaded');
        } catch { this.cb.toast('That text is not a valid Aerie setup'); }
      }),
      button('Reset to default', () => {
        const before = this.snapshot();
        Object.assign(this.cfg, defaultConfig());
        this.commit(true);
        this.cb.toast('Reset to the default look', { undo: () => this.restore(before) });
      }),
    );
    b.append(el('p', 'hint', 'Images and 3D models stay on this computer and are not included in the text.'), area, row);

    const up = section(body, 'Updates');
    const status = el('p', 'hint', 'Checking version…');
    const updateRow = el('div', 'row actions');
    const checkBtn = button('Check for updates', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      const res = await api.update().catch(e => ({ ok: false, message: e.message }));
      status.textContent = res.message;
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for updates';
      if (res.updated) updateRow.appendChild(button('Restart now', () => api.restart(), 'primary'));
    });
    updateRow.appendChild(checkBtn);
    up.append(status, updateRow);
    api.installInfo().then(info => {
      status.textContent = `Version ${info.version || '?'}` + (!info.installed
        ? ' · Running from the source folder.'
        : info.canUpdate
          ? ' · Updates also show up in the COSMIC Store.'
          : ' · Built on this computer: run ./install.sh again to update.');
    });

    const p = section(body, 'Privacy');
    p.append(
      el('p', 'hint', 'Aerie has no accounts, ads, tracking or analytics. It only goes online if you use the online library (Poly Haven), and then only to download what you pick. Your setup, pictures and models are stored only on this computer, in ~/.config/aerie and ~/.local/share/aerie.'),
      button('Delete all my Aerie data', async () => {
        if (!confirm('Delete your setup, uploaded images and 3D models, and the login autostart? Your original COSMIC look is restored too. This cannot be undone.')) return;
        await api.deleteData().catch(() => null);
        Object.assign(this.cfg, defaultConfig());
        this.cosmic = null;
        this.commit(true);
        this.cb.toast('All Aerie data deleted');
      }, 'danger'),
    );
    const lib = section(body, 'Online library');
    lib.append(
      toggle('Allow the online library (free 360° skies and 3D models from Poly Haven)', g, 'libraryConsent', () => this.commit()),
      el('p', 'hint', 'Off: Aerie never goes online. Things you already downloaded keep working either way.'),
    );
    const a = section(body, 'About');
    a.append(
      el('p', 'hint', 'Aerie: a free, open-source live wallpaper for Pop!_OS COSMIC. 3D by three.js, desktop layer by gtk4-layer-shell (both MIT). Privacy policy, terms and refund policy: PRIVACY.md and TERMS.md, included with the app and on GitHub.'),
      button('Quit Aerie', () => { if (confirm('Quit Aerie? Your normal wallpaper comes back.')) api.shell('quit'); }),
    );
    const u = section(body, 'Uninstall');
    u.append(
      el('p', 'hint', 'Removes Aerie completely: the app, its icon in your app list, your setup, uploaded images and 3D models, the login autostart, and any COSMIC look changes. Your password is asked for, like any app removal.'),
      button('Uninstall Aerie', async () => {
        if (!confirm('Uninstall Aerie and delete all of its data? This cannot be undone.')) return;
        this.cb.toast('Uninstalling…');
        const res = await api.uninstall().catch(e => ({ ok: false, message: e.message }));
        this.cb.toast(res.message || (res.ok ? 'Aerie was uninstalled.' : 'Uninstall failed'));
      }, 'danger'),
    );
  }

  // ---- pieces ---------------------------------------------------------------------------
  itemList(items, selected, onPick) {
    const ul = el('ul', 'item-list');
    if (!items.length) ul.appendChild(el('li', 'empty', 'Nothing here yet'));
    for (const item of items) {
      const li = el('li');
      const b = el('button', 'item' + (item.id === selected ? ' active' : '') + (item.visible === false ? ' hidden-item' : ''), item.name || item.id);
      b.setAttribute('aria-pressed', String(item.id === selected));
      b.addEventListener('click', () => onPick(item.id === selected ? null : item.id));
      li.appendChild(b);
      ul.appendChild(li);
    }
    return ul;
  }

  appSelect(label, obj, key) {
    const apps = this.cb.getApps();
    const opts = { '': apps.length ? 'Choose an app…' : 'Loading apps…' };
    for (const a of apps) opts[a.id] = a.name;
    return select(label, obj, key, opts, () => this.commit());
  }

  appsPicker(st) {
    const wrap = el('div', 'fav-picker');
    const apps = this.cb.getApps();
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = 'Find an app';
    filter.setAttribute('aria-label', 'Find an app to add');
    const ul = el('ul', 'check-list');
    const fill = () => {
      const q = filter.value.toLowerCase();
      ul.replaceChildren(...apps.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 200).map(a => {
        const li = el('li');
        const lab = el('label', 'row toggle');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = st.apps.includes(a.id);
        box.addEventListener('change', () => {
          st.apps = box.checked ? [...st.apps, a.id] : st.apps.filter(x => x !== a.id);
          this.cb.onChange();
        });
        lab.append(el('span', '', a.name), box);
        li.appendChild(lab);
        return li;
      }));
    };
    filter.addEventListener('input', fill);
    fill();
    wrap.append(filter, ul);
    return wrap;
  }

  /** Editable list of small records, e.g. links (label + url) or world clocks (place + time zone). */
  listEditor(st, key, fields, blank, suggestions) {
    const wrap = el('div', 'mini-list');
    const listId = suggestions ? 'tz-' + uid() : '';
    if (suggestions) {
      const dl = document.createElement('datalist');
      dl.id = listId;
      for (const s of suggestions) dl.appendChild(new Option(s));
      wrap.appendChild(dl);
    }
    st[key].forEach((item, i) => {
      const row = el('div', 'mini-row');
      for (const [f, ph] of fields) {
        const input = document.createElement('input');
        input.type = f === 'url' ? 'url' : 'text';
        input.placeholder = ph;
        input.value = item[f] || '';
        input.setAttribute('aria-label', `${ph} ${i + 1}`);
        if (f === 'tz' && listId) input.setAttribute('list', listId);
        input.addEventListener('input', () => { item[f] = input.value; this.commit(); });
        row.appendChild(input);
      }
      const del = button('×', () => { st[key].splice(i, 1); this.commit(true); });
      del.setAttribute('aria-label', `Remove item ${i + 1}`);
      row.appendChild(del);
      wrap.appendChild(row);
    });
    wrap.appendChild(button('Add', () => { st[key].push({ ...blank }); this.commit(true); }));
    return wrap;
  }

  async upload(file) {
    try {
      this.cb.toast('Adding ' + file.name + '…');
      const url = await api.upload(file);
      this.cb.toast('Added');
      return url;
    } catch (e) {
      if (STANDALONE) return URL.createObjectURL(file);
      this.cb.toast('Could not add that file: ' + e.message);
      throw e;
    }
  }
}

// ---- tiny form helpers ----------------------------------------------------
function el(tag, cls = '', textContent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (textContent !== undefined) n.textContent = textContent;
  return n;
}
// Sections fold open and closed; only the essentials start open, and your choices are remembered.
const OPEN = new Map();
let CURRENT_TAB = 'looks';
const START_OPEN = new Set(['Getting started', 'My looks', 'Looks', 'Want something else?', 'Assistant', 'Choose your AI',
  'Background', 'Taskbar layout', 'Behavior', 'Free 360° skies', 'Free 3D models']);
const SUMMARIES = {
  'Background': 'Colors, animated skies, 360° photos, images or video',
  'Finishing touches': 'Vignette and film grain',
  'Widget style': 'Glass cards, fonts, colors and 3D motion',
  'Widgets': 'Add, remove and arrange clocks, apps, notes…',
  '3D objects': 'Shapes and models that float and spin',
  'Camera and mouse': 'How the scene moves with your mouse',
  'Particles': 'Dust, stars, snow, rain, fireflies',
  'Lighting': 'Light and color on the 3D objects',
  'Atmosphere': 'Fog and the neon floor grid',
  'Ground cover': 'Flowers, grass, pine forest, ocean or sand dunes',
  'Soundscape': 'Background sound for this scene',
  'Taskbar layout': 'One-click layouts for the real panel and dock',
  'Panel': 'The COSMIC panel itself',
  'Dock': 'The COSMIC dock itself',
  'Pinned apps': 'Apps kept on your dock or taskbar',
  'Lock screen': 'Picture, message, clock and profile picture',
  'Glass': 'Frosted glass for windows and the panel',
  'Windows': 'Corners, gaps, borders, dark mode',
  'Undo': 'Put COSMIC back how it was',
  'Behavior': 'Pausing, frame rate, hot corner, start at login',
  'Sound and presets': 'Interface sounds, soundscape volume',
  'Your own sounds': 'Use your own sound files',
  'Online library': 'Free 360° skies and 3D models',
  'Back up or share your setup': 'Copy or load your setup as text',
  'Updates': 'Check for a newer Aerie',
  'Privacy': 'What Aerie stores, and deleting it',
  'About': 'Version, credits and quitting',
  'Uninstall': 'Remove Aerie completely',
};
function section(parent, title, opts = {}) {
  const key = CURRENT_TAB + ':' + title;
  const open = opts.open ?? OPEN.get(key) ?? OPEN.get(title) ?? START_OPEN.has(title);
  const s = document.createElement('details');
  s.className = 'group';
  s.open = open;
  const sum = el('summary');
  sum.append(el('h3', '', title));
  const hint = opts.hint ?? SUMMARIES[title];
  if (hint) sum.append(el('span', 'sum-hint', hint));
  s.addEventListener('toggle', () => { OPEN.set(key, s.open); OPEN.delete(title); });
  const inner = el('div', 'group-body');
  s.append(sum, inner);
  parent.appendChild(s);
  return inner;
}
function button(label, onClick, kind = '', title = '') {
  const b = el('button', 'btn ' + kind, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
let fieldCount = 0;
function field(label, control) {
  const row = el('div', 'row');
  const id = 'f' + (++fieldCount);
  control.id = id;
  const lab = el('label', '', label);
  lab.htmlFor = id;
  row.append(lab, control);
  return row;
}
function range(label, obj, key, min, max, step, onInput, unit = '', describe) {
  const row = el('div', 'row range');
  const id = 'f' + (++fieldCount);
  const lab = el('label', '', label);
  lab.htmlFor = id;
  const out = el('output', '');
  const show = v => { out.textContent = describe ? describe(v) : `${Number.isInteger(step) ? v : Number(v).toFixed(step < 0.01 ? 3 : 2)}${unit}`; };
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', id, min, max, step, value: obj[key] });
  input.addEventListener('input', () => { obj[key] = Number(input.value); show(obj[key]); onInput(); });
  show(obj[key]);
  const top = el('div', 'range-top');
  top.append(lab, out);
  row.append(top, input);
  return row;
}
function color(label, obj, key, onInput, fallback = '#ffffff') {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = obj[key] || fallback;
  input.addEventListener('input', () => { obj[key] = input.value; onInput(); });
  return field(label, input);
}
function toggle(label, obj, key, onChange) {
  const row = el('label', 'row toggle');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.setAttribute('role', 'switch');
  box.checked = !!obj[key];
  box.addEventListener('change', () => { obj[key] = box.checked; onChange(); });
  row.append(el('span', '', label), box);
  return row;
}
function select(label, obj, key, options, onChange) {
  const s = document.createElement('select');
  for (const [v, t] of Object.entries(options)) s.add(new Option(t, v));
  s.value = String(obj[key] ?? '');
  s.addEventListener('change', () => { obj[key] = s.value; onChange(); });
  return field(label, s);
}
function segmented(label, obj, key, options, onChange) {
  const row = el('div', 'row range');
  const top = el('div', 'range-top');
  top.appendChild(el('span', '', label));
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [v, t] of Object.entries(options)) {
    const b = el('button', '', t);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(String(obj[key]) === v));
    b.addEventListener('click', () => {
      obj[key] = typeof obj[key] === 'number' ? Number(v) : v;
      group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onChange();
    });
    group.appendChild(b);
  }
  row.append(top, group);
  return row;
}
function text(label, obj, key, onInput, onDone) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = obj[key] || '';
  input.addEventListener('input', () => { obj[key] = input.value; onInput(); });
  if (onDone) input.addEventListener('change', onDone);
  return field(label, input);
}
function dateInput(label, obj, key, onInput) {
  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.value = obj[key] || '';
  input.addEventListener('input', () => { obj[key] = input.value; onInput(); });
  return field(label, input);
}
function upload(label, accept, onFiles, multiple = false) {
  const wrap = el('label', 'btn upload', label);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]).catch(() => null); });
  wrap.appendChild(input);
  wrap.tabIndex = 0;
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  return wrap;
}
function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
/** First place on the screen where a new widget doesn't cover another one. */
function freeSpot(widgets, w) {
  const W = innerWidth, H = innerHeight;
  const rect = o => ({ l: (o.x / 100) * W, t: (o.y / 100) * H, r: (o.x / 100) * W + o.w, b: (o.y / 100) * H + o.h });
  const taken = widgets.filter(o => o.visible !== false).map(rect);
  for (let y = 6; y <= 80; y += 4) {
    for (let x = 3; x <= 85; x += 3) {
      const r = rect({ x, y, w: w.w, h: w.h });
      if (r.r > W - 16 || r.b > H - 16) continue;
      if (!taken.some(t => r.l < t.r + 16 && r.r + 16 > t.l && r.t < t.b + 16 && r.b + 16 > t.t)) return { x, y };
    }
  }
  return { x: rnd(20, 60), y: rnd(15, 55) };
}
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const MOTIONS = { parallax: 'Drift with camera', still: 'Stay still', '3d': '3D in space' };
const MOTION_HINT = 'Drift: cards float at their own depth as the camera moves. Still: they never move. 3D: they turn and lean in space like the panels of a game menu.';
function credit(item) {
  return `${item.name}${item.authors?.length ? ' by ' + item.authors.join(', ') : ''} · Poly Haven (CC0)`;
}
const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 10) / 10;

function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
