// The design assistant, page side: tells the AI what can be changed, and applies its answer.
// The AI can only ask for the changes listed here; every value is checked before it's used,
// and everything it does can be undone in one click.
import {
  BACKGROUNDS, CARD_STYLES, clone, defaultObject, defaultWidget, FONTS, MATERIALS, PARTICLE_STYLES, presetConfig, SHAPES, WIDGET_TYPES,
} from './config.js';
import { PRESETS } from './presets.js';
import { SOUNDSCAPES } from './sound.js';
import { TASKBAR_LAYOUTS } from './taskbar.js';

const COLOR = { type: 'color' };
const num = (min, max) => ({ type: 'number', min, max });
const BOOL = { type: 'bool' };
const oneOf = values => ({ type: 'enum', values });

const BG_TYPES = Object.keys(BACKGROUNDS).filter(t => !['image', 'video', 'panorama', 'transparent'].includes(t));
const FIELDS = ['none', 'sunflowers', 'wildflowers', 'grass', 'lavender', 'pines', 'water', 'dunes'];

/** Every setting the assistant may change, with what values are allowed. */
export const PATHS = {
  'scene.background.type': oneOf(BG_TYPES),
  'scene.background.color1': COLOR, 'scene.background.color2': COLOR, 'scene.background.color3': COLOR,
  'scene.background.angle': num(0, 360), 'scene.background.speed': num(0.1, 3),
  'scene.particles.enabled': BOOL, 'scene.particles.style': oneOf(Object.keys(PARTICLE_STYLES)),
  'scene.particles.count': num(0, 3000), 'scene.particles.color': COLOR, 'scene.particles.size': num(0.01, 0.2), 'scene.particles.speed': num(0, 2),
  'scene.fog.enabled': BOOL, 'scene.fog.color': COLOR, 'scene.fog.density': num(0, 0.15),
  'scene.floor.enabled': BOOL, 'scene.floor.color': COLOR,
  'scene.light.ambient': num(0, 2), 'scene.light.color': COLOR, 'scene.light.intensity': num(0, 6), 'scene.light.rim': COLOR,
  'scene.overlay.vignette': num(0, 1), 'scene.overlay.grain': num(0, 0.2),
  'scene.field.type': oneOf(FIELDS), 'scene.field.count': num(200, 4000), 'scene.field.wind': num(0, 3), 'scene.field.ground': COLOR,
  'scene.sound': oneOf(Object.keys(SOUNDSCAPES).filter(s => s !== 'custom')),
  'camera.mode': oneOf(['parallax', 'orbit', 'fixed']), 'camera.strength': num(0, 3), 'camera.fov': num(25, 90),
  'camera.distance': num(4, 25), 'camera.drift': BOOL,
  'theme.font': oneOf(Object.keys(FONTS)), 'theme.cardStyle': oneOf(Object.keys(CARD_STYLES)),
  'theme.accent': COLOR, 'theme.text': COLOR, 'theme.widgetBg': COLOR, 'theme.widgetOpacity': num(0, 1),
  'theme.blur': num(0, 48), 'theme.radius': num(0, 40), 'theme.glow': BOOL, 'theme.shadow': BOOL, 'theme.border': BOOL,
  'theme.tilt': BOOL, 'theme.widgetMotion': oneOf(['parallax', 'still', '3d']),
};
const ASSISTANT_SHAPES = Object.keys(SHAPES).filter(s => s !== 'model');

function describe(spec) {
  if (spec.type === 'enum') return spec.values.map(v => JSON.stringify(v)).join('|');
  if (spec.type === 'number') return `number ${spec.min}..${spec.max}`;
  return spec.type === 'bool' ? 'true|false' : '"#rrggbb"';
}

let WALLPAPERS = [];
/** Wallpapers the assistant may switch to (titles and kinds only). */
export function setWallpaperChoices(items) {
  WALLPAPERS = (items || []).filter(i => i.rating !== 'mature').slice(0, 60).map(i => ({ id: i.id, title: i.title, kind: i.type }));
}

/** What the AI needs to know: the allowed changes, and the current desktop (no personal content). */
export function buildContext(cfg) {
  const scene = clone(cfg.scene);
  for (const k of ['image', 'video', 'panorama']) if (scene.background[k]) scene.background[k] = '(a picture)';
  delete scene.soundFile;
  const desk = {
    scene, camera: cfg.camera, theme: cfg.theme,
    widgets: cfg.widgets.map(w => ({ type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, ...(w.visible === false ? { hidden: true } : {}) })),
    objects: cfg.objects.map(o => ({ name: o.name, shape: o.shape, material: o.material, color: o.color, position: o.position, scale: o.scale, glow: o.glow })),
  };
  return [
    'OPERATIONS (items of "changes"):',
    '{"op":"set","path":<path>,"value":<value>}   paths and allowed values:',
    ...Object.entries(PATHS).map(([p, spec]) => `  ${p}: ${describe(spec)}`),
    `{"op":"preset","name":${Object.keys(PRESETS).map(n => JSON.stringify(n)).join('|')}}   (replaces the whole scene; use first, then adjust)`,
    `{"op":"addWidget","type":${Object.keys(WIDGET_TYPES).map(t => JSON.stringify(t)).join('|')},"x":0-100,"y":0-100}`,
    '{"op":"moveWidget","type":<type>,"x":0-100,"y":0-100}   {"op":"removeWidget","type":<type>}',
    `{"op":"addObject","shape":${ASSISTANT_SHAPES.map(s => JSON.stringify(s)).join('|')},"material":${Object.keys(MATERIALS).map(m => JSON.stringify(m)).join('|')},"color":"#rrggbb","x":-6..6,"y":-3..3,"z":-8..2,"scale":0.2..4,"glow":0..2,"spin":true|false}`,
    '{"op":"removeObject","name":<name>}   {"op":"removeObject","all":true}',
    `{"op":"wallpaper","id":<id>}   (switch to one of these wallpapers: ${JSON.stringify(WALLPAPERS)}; the 3D objects, particles, lighting and fog only show with "preset" looks)`,
    `{"op":"cosmic","layout":${Object.keys(TASKBAR_LAYOUTS).map(l => JSON.stringify(l)).join('|')},"dark":true|false,"frostedWindows":true|false}   (the real COSMIC panel/dock/theme; only if asked; any field optional)`,
    'Widget types: ' + Object.entries(WIDGET_TYPES).map(([k, v]) => `${k} (${v})`).join(', '),
    'Screen layout tip: keep widgets from overlapping; the area around x 30-70, y 25-75 is where 3D objects usually sit.',
    '',
    'CURRENT DESKTOP:',
    JSON.stringify(desk),
  ].join('\n');
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

function valid(spec, value) {
  if (spec.type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
  if (spec.type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (spec.type === 'enum') return spec.values.includes(value) ? value : undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : undefined;
}
const pct = v => Math.min(95, Math.max(0, Number(v) || 0));
const between = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

const LABELS = {
  'scene.background': 'background', 'scene.particles': 'particles', 'scene.fog': 'fog', 'scene.floor': 'floor grid',
  'scene.light': 'lighting', 'scene.overlay': 'finishing touches', 'scene.field': 'ground cover', 'scene.sound': 'soundscape',
  camera: 'camera', theme: 'widget style',
};

/**
 * Applies the AI's changes to cfg (in place). Returns { done: [plain-language lines], cosmic, skipped }.
 * cosmic is a change for COSMIC itself, returned so the person can approve it first.
 */
export function applyChanges(cfg, changes) {
  const done = new Set();
  let cosmic = null;
  let skipped = 0;
  for (const c of Array.isArray(changes) ? changes : []) {
    if (!c || typeof c !== 'object') { skipped++; continue; }
    switch (c.op) {
      case 'preset': {
        if (!PRESETS[c.name]) { skipped++; break; }
        Object.assign(cfg, presetConfig(c.name, cfg.general), { presetName: c.name, wallpaper: { type: 'scene' }, screens: {}, wallpaperProps: cfg.wallpaperProps || {} });
        done.add(`switched to ${c.name}`);
        break;
      }
      case 'set': {
        const spec = PATHS[c.path];
        const value = spec && valid(spec, c.value);
        if (value === undefined) { skipped++; break; }
        if (getPath(cfg, c.path) === value) break;
        setPath(cfg, c.path, value);
        const group = Object.keys(LABELS).find(k => c.path.startsWith(k));
        done.add(`changed the ${LABELS[group] || c.path.split('.').pop()}`);
        break;
      }
      case 'wallpaper': {
        const pick = (WALLPAPERS || []).find(w => w.id === c.id);
        if (!pick) { skipped++; break; }
        cfg.wallpaper = { type: 'library', id: pick.id };
        cfg.screens = {};
        done.add(`set the wallpaper to ${pick.title}`);
        break;
      }
      case 'addWidget': {
        if (!WIDGET_TYPES[c.type]) { skipped++; break; }
        const w = defaultWidget(c.type);
        Object.assign(w, { x: pct(c.x), y: pct(c.y) });
        cfg.widgets.push(w);
        done.add(`added a ${WIDGET_TYPES[c.type].toLowerCase()} widget`);
        break;
      }
      case 'moveWidget': {
        const w = cfg.widgets.find(x => x.type === c.type);
        if (!w) { skipped++; break; }
        Object.assign(w, { x: pct(c.x), y: pct(c.y), visible: true });
        done.add(`moved the ${WIDGET_TYPES[c.type].toLowerCase()} widget`);
        break;
      }
      case 'removeWidget': {
        const before = cfg.widgets.length;
        cfg.widgets = cfg.widgets.filter(w => w.type !== c.type);
        if (cfg.widgets.length !== before) done.add(`removed the ${(WIDGET_TYPES[c.type] || c.type).toLowerCase()} widget`);
        break;
      }
      case 'addObject': {
        if (!ASSISTANT_SHAPES.includes(c.shape)) { skipped++; break; }
        const o = defaultObject(c.shape);
        if (MATERIALS[c.material]) o.material = c.material;
        if (valid(COLOR, c.color)) o.color = c.color;
        o.position = { x: between(c.x, -6, 6, 2), y: between(c.y, -3, 3, 0), z: between(c.z, -8, 2, -1) };
        o.scale = between(c.scale, 0.2, 4, 1);
        o.glow = between(c.glow, 0, 2, 0);
        if (c.spin === false) o.spin.enabled = false;
        cfg.objects.push(o);
        done.add(`added a ${SHAPES[c.shape].toLowerCase()}`);
        break;
      }
      case 'removeObject': {
        const before = cfg.objects.length;
        cfg.objects = c.all ? [] : cfg.objects.filter(o => o.name !== c.name);
        if (cfg.objects.length !== before) done.add(c.all ? 'removed the 3D objects' : `removed ${c.name}`);
        break;
      }
      case 'cosmic': {
        const next = {};
        if (TASKBAR_LAYOUTS[c.layout]) next.layout = c.layout;
        if (typeof c.dark === 'boolean') next.isDark = c.dark;
        if (typeof c.frostedWindows === 'boolean') next.frostedWindows = c.frostedWindows;
        if (Object.keys(next).length) cosmic = { ...(cosmic || {}), ...next };
        else skipped++;
        break;
      }
      default: skipped++;
    }
  }
  return { done: [...done], cosmic, skipped };
}

/** COSMIC change from the assistant, in the form the server takes. */
export function cosmicChanges(c) {
  const out = {};
  if (c.layout) {
    const { name, tagline, ...layout } = clone(TASKBAR_LAYOUTS[c.layout]);
    Object.assign(out, layout);
  }
  if (c.isDark !== undefined) out.isDark = c.isDark;
  if (c.frostedWindows !== undefined) out.frostedWindows = c.frostedWindows;
  return out;
}

export function describeCosmic(c) {
  const bits = [];
  if (c.layout) bits.push(`use the "${TASKBAR_LAYOUTS[c.layout].name}" taskbar layout`);
  if (c.isDark !== undefined) bits.push(c.isDark ? 'switch COSMIC to dark mode' : 'switch COSMIC to light mode');
  if (c.frostedWindows !== undefined) bits.push(c.frostedWindows ? 'turn on frosted glass windows' : 'turn off frosted glass windows');
  return bits.join(', ');
}

export const SUGGESTIONS = [
  'Make it feel cozy and warm',
  'Calm, minimal and dark',
  'A neon city at night',
  'Add a clock and a to-do list, top left',
  'Make my widgets easier to read',
  'Surprise me with something new',
];
