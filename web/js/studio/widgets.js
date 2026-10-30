// Studio → Widgets: clocks, notes, music and more on top of your wallpaper. Drag them in the
// preview to move them; every widget's settings are here.
import { api, CARD_STYLES, clone, defaultWidget, FONTS, uid, WIDGET_GROUPS, WIDGET_TYPES } from '../config.js';
import { h, icon } from '../icons.js';
import { toast } from '../toast.js';
import { color, row, section, seg, select, slider, pct, text, toggle } from './forms.js';
import { changed, S, sendPreview } from './state.js';

const TIMEZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
const MOTIONS = { parallax: 'Drift with the wallpaper', still: 'Stay still', '3d': 'Turn in space' };
let selectedId = null;

export function widgetsPage(pageEl) {
  const cfg = S.cfg;
  const c = () => changed();
  const rerender = () => { changed(); window.studio.go('widgets'); };
  const add = { type: 'clock' };
  const pick = h('select.input', { 'aria-label': 'Widget to add', onchange: e => { add.type = e.target.value; } },
    ...Object.entries(WIDGET_GROUPS).map(([group, types]) => h('optgroup', { label: group }, ...Object.entries(types).map(([k, v]) => h('option', { value: k }, v)))));
  const list = h('ul.widget-list');
  for (const w of cfg.widgets) {
    list.append(h('li', {}, h('button.btn.ghost', { 'aria-pressed': String(w.id === selectedId), onclick: () => { selectedId = w.id === selectedId ? null : w.id; sendPreview({ type: 'select-widget', id: selectedId }); window.studio.go('widgets'); } },
      h('span', {}, WIDGET_TYPES[w.type] + (w.type === 'text' ? `: ${w.settings.text.slice(0, 18)}` : '')), w.visible === false ? h('small.muted', {}, 'hidden') : '')));
  }
  if (!cfg.widgets.length) list.append(h('li.empty', {}, 'No widgets. Your wallpaper has the screen to itself.'));
  pageEl.append(section('Your widgets', 'ウィジェット',
    h('div.add-row', {}, pick, h('button.btn.primary', { onclick: () => {
      const w = defaultWidget(add.type);
      Object.assign(w, freeSpot(cfg.widgets, w));
      if (w.type === 'dock') { w.x = Math.round((100 - (w.w / 1600) * 100) / 2); w.y = 86; }
      cfg.widgets.push(w);
      selectedId = w.id;
      rerender();
    } }, h('span', { html: icon('plus') }), 'Add')),
    list,
    h('p.small.muted', {}, 'Drag widgets in the preview to move them; drag the corner to resize; hold Shift to snap. On the desktop: right-click → Move widgets.')));

  const w = cfg.widgets.find(x => x.id === selectedId);
  if (w) {
    const s = section(WIDGET_TYPES[w.type], 'この', ...widgetSettings(w, c, rerender));
    const look = section('Placement and look', '',
      row('Card', '', select(w, 'cardStyle', { '': 'Same as other widgets', ...CARD_STYLES }, c, 'Card')),
      row('Show the card behind it', '', toggle(w, 'card', c, 'Show the card')),
      row('Moves', '', select(w, 'motion', { '': 'Same as other widgets', ...MOTIONS }, c, 'Moves')),
      slider(w, 'depth', { min: 0, max: 1.5, step: 0.05, fmt: v => (+v).toFixed(2), onInput: c, label: 'Depth', hint: 'how much it drifts' }),
      slider(w, 'w', { min: 80, max: 1600, step: 5, fmt: v => v + ' px', onInput: c, label: 'Width' }),
      slider(w, 'h', { min: 40, max: 1000, step: 5, fmt: v => v + ' px', onInput: c, label: 'Height' }),
      row('Accent', 'This widget only', color(w.style, 'accent', c, cfg.theme.accent, 'Accent')),
      row('Text color', 'This widget only', color(w.style, 'text', c, cfg.theme.text, 'Text color')),
      h('div.acts', {},
        h('button.btn.small', { onclick: () => { move(cfg.widgets, w, 1); rerender(); } }, 'Bring forward'),
        h('button.btn.small', { onclick: () => { move(cfg.widgets, w, -1); rerender(); } }, 'Send back'),
        h('button.btn.small', { onclick: () => { w.visible = w.visible === false; rerender(); } }, w.visible === false ? 'Show' : 'Hide'),
        h('button.btn.small', { onclick: () => { const d = { ...clone(w), id: uid(), x: w.x + 2, y: w.y + 2 }; cfg.widgets.push(d); selectedId = d.id; rerender(); } }, 'Duplicate'),
        h('button.btn.small.danger', { onclick: () => {
          const at = cfg.widgets.indexOf(w);
          cfg.widgets.splice(at, 1);
          selectedId = null;
          rerender();
          toast(`Removed the ${WIDGET_TYPES[w.type].toLowerCase()}`, { undo: () => { cfg.widgets.splice(at, 0, w); selectedId = w.id; rerender(); } });
        } }, 'Remove')));
    pageEl.append(s, look);
  }

  const th = cfg.theme;
  pageEl.append(section('Widget style', 'スタイル',
    row('Card', '', seg(th, 'cardStyle', CARD_STYLES, c, 'Card')),
    row('Font', '', select(th, 'font', FONTS, c, 'Font')),
    row('Accent', '', color(th, 'accent', c, '#00bba7', 'Accent')),
    row('Text', '', color(th, 'text', c, '#e4edee', 'Text')),
    row('Card color', '', color(th, 'widgetBg', c, '#061415', 'Card color')),
    slider(th, 'widgetOpacity', { min: 0, max: 1, step: 0.05, fmt: pct, onInput: c, label: 'Card opacity' }),
    slider(th, 'radius', { min: 0, max: 32, step: 1, fmt: v => v + ' px', onInput: c, label: 'Corner roundness' }),
    slider(th, 'iconSize', { min: 24, max: 96, step: 2, fmt: v => v + ' px', onInput: c, label: 'App icon size' }),
    row('Thin edge', '', toggle(th, 'border', c, 'Thin edge')),
    row('Soft shadow', '', toggle(th, 'shadow', c, 'Soft shadow')),
    row('Text shadow', 'Keeps text readable on bright wallpapers', toggle(th, 'textShadow', c, 'Text shadow')),
    row('Lean toward the mouse', '', toggle(th, 'tilt', c, 'Lean toward the mouse')),
    row('Widgets', '', seg(th, 'widgetMotion', MOTIONS, c, 'Widget motion')),
    row('Float in when Aerie starts', '', toggle(th, 'entrance', c, 'Float in')),
    contrastNote(th)));
}

function contrastNote(th) {
  const ratio = contrast(th.text, th.widgetBg);
  if (ratio >= 4.5 || th.widgetOpacity < 0.3 || th.cardStyle === 'clear') return '';
  return h('p.warn', {}, `Text may be hard to read on the cards (contrast ${ratio.toFixed(1)}:1; aim for 4.5:1 or more).`);
}

function widgetSettings(w, c, cr) {
  const st = w.settings;
  switch (w.type) {
    case 'clock': return [row('Analog face', '', toggle(st, 'analog', cr, 'Analog face')), row('Format', '', seg(st, 'format', { 24: '24-hour', 12: '12-hour' }, c)),
      row('Seconds', '', toggle(st, 'seconds', c, 'Seconds')), slider(st, 'size', { min: 0, max: 220, step: 2, fmt: v => (v ? v + ' px' : 'fit'), onInput: c, label: 'Digit size' })];
    case 'date': return [row('Long format', '', toggle(st, 'long', c, 'Long format'))];
    case 'greeting': return [row('Your name', 'Blank uses your account name', text(st, 'name', { onChange: c }))];
    case 'system': return ['cpu', 'memory', 'disk', 'battery', 'network'].map(k =>
      row({ cpu: 'CPU', memory: 'Memory', disk: 'Disk', battery: 'Battery', network: 'Network speed' }[k], '', toggle(st, k, c)));
    case 'apps': return [row('Layout', '', seg(st, 'layout', { grid: 'Grid', list: 'List' }, c)), slider(st, 'columns', { min: 2, max: 10, step: 1, onInput: c, label: 'Columns' }),
      row('Search box', '', toggle(st, 'search', c)), row('Category tabs', '', toggle(st, 'categories', c)), row('App names', '', toggle(st, 'labels', c)),
      row('Order', '', seg(st, 'sort', { name: 'A–Z', recent: 'Recently used' }, c)),
      h('button.btn.small', { onclick: async () => { S.apps = await api.refreshApps(); toast('App list updated'); } }, 'Rescan installed apps')];
    case 'favorites': return [row('App names', '', toggle(st, 'labels', c)), h('p.small.muted', {}, 'Leave empty to show the apps you starred in the launcher.'), appsPicker(st, c)];
    case 'dock': return [slider(st, 'iconSize', { min: 32, max: 96, step: 2, fmt: v => v + ' px', onInput: c, label: 'Icon size' }),
      row('Magnify on hover', '', toggle(st, 'magnify', c)), row('"All apps" button', '', toggle(st, 'drawerButton', c)),
      h('p.small.muted', {}, 'Leave the list empty to show the apps you starred in the launcher.'), appsPicker(st, c)];
    case 'search': return [row('Placeholder', '', text(st, 'placeholder', { onChange: c })),
      row('Web search', 'Opens in your browser', select(st, 'web', { none: 'Apps only', duckduckgo: 'Also offer DuckDuckGo' }, c))];
    case 'links': return [listEditor(st, 'items', [['label', 'Name'], ['url', 'https://…']], { label: '', url: 'https://' }, null, c, cr)];
    case 'worldclock': return [row('Format', '', seg(st, 'format', { 24: '24-hour', 12: '12-hour' }, c)),
      listEditor(st, 'zones', [['label', 'Place'], ['tz', 'Time zone']], { label: 'Paris', tz: 'Europe/Paris' }, TIMEZONES, c, cr)];
    case 'countdown': return [row('Counting down to', '', text(st, 'label', { onChange: c })),
      row('Date and time', '', h('input.input', { type: 'datetime-local', value: st.date || '', onchange: e => { st.date = e.target.value; c(); } }))];
    case 'timer': return [slider(st, 'minutes', { min: 1, max: 90, step: 1, fmt: v => v + ' min', onInput: c, label: 'Focus' }),
      slider(st, 'breakMinutes', { min: 1, max: 30, step: 1, fmt: v => v + ' min', onInput: c, label: 'Break' })];
    case 'graph': return [row('Shows', '', seg(st, 'metric', { cpu: 'CPU', memory: 'Memory', network: 'Network' }, c))];
    case 'nowplaying': return [row('Album art', '', toggle(st, 'art', c)), row('Play controls', '', toggle(st, 'controls', c)),
      h('p.small.muted', {}, 'Works with players that support the standard Linux media controls (Spotify, browsers, Rhythmbox, VLC…).')];
    case 'moon': return [row('Phase name and %', '', toggle(st, 'labels', c))];
    case 'notes': return [h('p.small.muted', {}, 'Type straight into the note on your desktop. It saves by itself.')];
    case 'todo': return [row('Title', '', text(st, 'title', { onChange: c })), h('p.small.muted', {}, 'Add tasks right on your desktop: type and press Enter.'),
      h('button.btn.small', { onclick: () => { st.items = st.items.filter(i => !i.done); cr(); } }, 'Clear finished tasks')];
    case 'quote': return st.source === 'custom'
      ? [row('Text', '', seg(st, 'source', { builtin: 'Rotating ideas', custom: 'My own' }, cr)), row('Quote', '', text(st, 'text', { onChange: c, max: 400 })), row('By', 'Optional', text(st, 'author', { onChange: c }))]
      : [row('Text', '', seg(st, 'source', { builtin: 'Rotating ideas', custom: 'My own' }, cr)), slider(st, 'minutes', { min: 1, max: 240, step: 1, fmt: v => v + ' min', onInput: c, label: 'Change every' })];
    case 'calendar': return [row('Week starts on', '', seg(st, 'weekStart', { 0: 'Sunday', 1: 'Monday' }, c))];
    case 'text': return [row('Text', '', text(st, 'text', { onChange: c, max: 300 })), slider(st, 'size', { min: 12, max: 200, step: 1, fmt: v => v + ' px', onInput: c, label: 'Size' }),
      slider(st, 'weight', { min: 100, max: 900, step: 100, onInput: c, label: 'Weight' }), row('Align', '', seg(st, 'align', { left: 'Left', center: 'Center', right: 'Right' }, c))];
    case 'image': return [upload(st.url ? 'Replace picture' : 'Choose a picture', async files => { st.url = await api.upload(files[0]); cr(); }),
      row('Description', 'Read out by screen readers', text(st, 'alt', { onChange: c })), row('Fit', '', seg(st, 'fit', { cover: 'Fill', contain: 'Fit inside' }, c))];
    case 'slideshow': return [
      h('div.thumbs', {}, ...st.images.map((url, i) => h('figure', {}, h('img', { src: url, alt: `Photo ${i + 1}` }),
        h('button.icon-btn', { 'aria-label': `Remove photo ${i + 1}`, html: icon('close'), onclick: () => { st.images.splice(i, 1); cr(); } })))),
      upload('Add photos', async files => { for (const f of files) st.images.push(await api.upload(f)); cr(); }, true),
      slider(st, 'seconds', { min: 3, max: 120, step: 1, fmt: v => v + ' s', onInput: c, label: 'Seconds per photo' }),
      row('Fit', '', seg(st, 'fit', { cover: 'Fill', contain: 'Fit inside' }, c))];
    default: return [];
  }
}

function upload(label, onFiles, multiple = false) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple, hidden: true, onchange: () => { if (input.files.length) onFiles([...input.files]).catch(e => toast(e.message)); } });
  return h('span', {}, h('button.btn.small', { onclick: () => input.click() }, label), input);
}

function appsPicker(st, c) {
  const filter = h('input.input', { type: 'search', placeholder: 'Find an app', 'aria-label': 'Find an app to add' });
  const ul = h('ul.check-list');
  const fill = () => {
    const q = filter.value.toLowerCase();
    ul.replaceChildren(...S.apps.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 200).map(a => h('li', {}, h('label.check', {},
      h('input', { type: 'checkbox', checked: st.apps.includes(a.id), onchange: e => { st.apps = e.target.checked ? [...st.apps, a.id] : st.apps.filter(x => x !== a.id); c(); } }), a.name))));
  };
  filter.addEventListener('input', fill);
  fill();
  return h('div.apps-picker', {}, filter, ul);
}

function listEditor(st, key, fields, blank, suggestions, c, cr) {
  const listId = suggestions ? 'tz-' + uid() : '';
  return h('div.mini-list', {},
    suggestions ? h('datalist', { id: listId }, ...suggestions.map(s => h('option', { value: s }))) : '',
    ...st[key].map((item, i) => h('div.mini-row', {},
      ...fields.map(([f, ph]) => h('input.input', { type: f === 'url' ? 'url' : 'text', placeholder: ph, value: item[f] || '', 'aria-label': `${ph} ${i + 1}`, list: f === 'tz' && listId ? listId : null,
        oninput: e => { item[f] = e.target.value; c(); } })),
      h('button.icon-btn', { 'aria-label': `Remove item ${i + 1}`, html: icon('close'), onclick: () => { st[key].splice(i, 1); cr(); } }))),
    h('button.btn.small', { onclick: () => { st[key].push({ ...blank }); cr(); } }, 'Add'));
}

function move(arr, w, dir) {
  const i = arr.indexOf(w), j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

/** First place on a 1600×900 screen where a new widget doesn't cover another one. */
function freeSpot(widgets, w) {
  const W = 1600, H = 900;
  const rect = o => ({ l: (o.x / 100) * W, t: (o.y / 100) * H, r: (o.x / 100) * W + o.w, b: (o.y / 100) * H + o.h });
  const taken = widgets.filter(o => o.visible !== false).map(rect);
  for (let y = 6; y <= 80; y += 4) {
    for (let x = 3; x <= 85; x += 3) {
      const r = rect({ x, y, w: w.w, h: w.h });
      if (r.r > W - 16 || r.b > H - 16) continue;
      if (!taken.some(t => r.l < t.r + 16 && r.r + 16 > t.l && r.t < t.b + 16 && r.b + 16 > t.t)) return { x, y };
    }
  }
  return { x: 30, y: 30 };
}

function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const selectWidget = id => { selectedId = id; };
