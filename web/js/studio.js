// Aerie Studio: your wallpaper library, importing, and every setting, in a normal window.
// A live preview on the right shows your desktop as it will look.
import { api, clone, normalizeConfig, STANDALONE, wallpaperFor, wallpaperSettings } from './config.js';
import { allWallpapers, currentKey, KIND_ICON, KIND_LABEL, placeholderStyle, sourceLabel } from './catalog.js';
import { Editor } from './editor.js';
import { fmtBytes, h, icon } from './icons.js';
import { forgetLibrary } from './library.js';

const PAGES = [
  ['library', 'Library', 'ライブラリ', 'grid', 'Every wallpaper you have — pick one, or add your own'],
  ['wallpaper', 'This wallpaper', '壁紙', 'sliders', 'Settings for the wallpaper you are using'],
  ['look', '3D look', '立体', 'sparkle', 'Design your own 3D scene: shapes, particles, light and sound'],
  ['widgets', 'Widgets', 'ウィジェット', 'widgets', 'Clocks, to-dos, music and more, right on your desktop'],
  ['assistant', 'Assistant', 'アシスタント', 'sparkle', 'Describe what you want, and the AI designs it'],
  ['desktop', 'Desktop', 'デスクトップ', 'desktop', 'Your real COSMIC panel, dock, glass and windows'],
  ['lock', 'Lock screen', 'ロック画面', 'lock', 'Your live wallpaper when the computer is locked'],
  ['hub', 'Hub', 'ハブ', 'keyboard', 'The panel that drops down from the top of the screen'],
  ['settings', 'Settings', '設定', 'settings', 'Pausing, sounds, updates, privacy and uninstalling'],
];
const ICON_FOR = Object.fromEntries(PAGES.map(p => [p[0], p[3]]));
ICON_FOR.look = 'cube';
const $ = s => document.querySelector(s);
const pageEl = $('#page');
const frame = $('#preview');
let cfg = null;
let page = new URLSearchParams(location.search).get('page') || 'library';
let saveTimer = null;
let list = [];
let selected = null; // the library card you clicked (previewed, not yet in use)
let libFilter = 'all';
let libQuery = '';
let previewReady = false;

// ---- the editor (sections for the 3D look, widgets, desktop, assistant and settings) ---------
let apps = [];
const editorCallbacks = {
  onChange: () => changed(),
  onClose: () => {},
  onSelectObject: id => sendPreview({ type: 'select-object', id }),
  onSelectWidget: id => sendPreview({ type: 'select-widget', id }),
  getApps: () => apps,
  loadApps: async () => { apps = await api.apps(); return apps; },
  refreshApps: async () => { apps = await api.refreshApps(); return apps; },
  toast,
  sound: () => {},
  pauseStatus: () => '',
  lockscreenFromScene: async () => {
    try { await api.setLockscreen({ source: 'scene', widgets: !!cfg.general.lock?.widgets }); toast('COSMIC lock screen picture updated'); return true; } catch (e) { toast('Could not set it: ' + e.message); return false; }
  },
  previewSound: () => toast('Sounds play on the desktop'),
  saveNow: () => save(),
  transition: fn => { fn(); return Promise.resolve(); },
};
const editorBox = h('div.st-editor.panel');
const editor = new Editor(editorBox, editorCallbacks, { embedded: true });

// ---- saving -------------------------------------------------------------------------------
function changed(fresh = false) {
  sendConfig(fresh);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 450);
}

async function save() {
  clearTimeout(saveTimer);
  if (STANDALONE) return;
  try {
    await api.saveConfig(cfg);
    await api.shell('config-changed');
  } catch { toast('Could not save your changes'); }
}

// ---- live preview -----------------------------------------------------------------------------
frame.src = `index.html?mode=preview&monitor=0${location.hash}`;
function sendPreview(msg) { frame.contentWindow?.postMessage({ aerie: true, ...msg }, location.origin); }
function sendConfig(fresh = false) {
  if (!previewReady || !cfg) return;
  const shown = clone(cfg);
  if (selected && page === 'library') { shown.wallpaper = selected.choice; shown.screens = {}; }
  sendPreview({ type: 'config', config: shown, fresh });
  sendPreview({ type: 'edit', on: page === 'look' || page === 'widgets' });
  const w = selected && page === 'library' ? selected : list.find(x => x.key === currentKey(cfg, list));
  $('#pv-label').textContent = selected && page === 'library' && selected.key !== currentKey(cfg, list) ? 'Previewing — not in use yet' : (w ? 'In use: ' + w.title : 'Your desktop');
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data?.aerie) return;
  const m = e.data;
  if (m.type === 'ready') { previewReady = true; sendConfig(true); }
  if (m.type === 'select-object') { if (page !== 'look') go('look'); editor.selectedObject = m.id; editor.selectedWidget = null; editor.render(); }
  if (m.type === 'select-widget') { if (page !== 'widgets') go('widgets'); editor.selectedWidget = m.id; editor.selectedObject = null; editor.render(); }
  if (m.type === 'object-moved') { const o = cfg.objects.find(x => x.id === m.id); if (o) { Object.assign(o, m.patch); changed(); editor.render(); } }
  if (m.type === 'widget-changed') { const w = cfg.widgets.find(x => x.id === m.id); if (w) { Object.assign(w, m.patch); clearTimeout(saveTimer); saveTimer = setTimeout(save, 450); } }
});
function fitPreview() {
  const box = $('.pv-frame');
  frame.style.transform = `scale(${box.clientWidth / 1600})`;
}
new ResizeObserver(fitPreview).observe($('.pv-frame'));

// ---- frame ---------------------------------------------------------------------------------
function nav() {
  $('#nav').replaceChildren(...PAGES.map(([key, label, kana]) => h('button', {
    'aria-current': key === page ? 'page' : null, onclick: () => go(key), html: icon(ICON_FOR[key]),
  }, h('b', {}, label), h('span.kana', {}, kana))));
}

function go(key) {
  if (!PAGES.some(p => p[0] === key)) key = 'library';
  if (page !== key && key !== 'library') selected = null;
  page = key;
  nav();
  render();
  $('#main').scrollTop = 0;
  sendConfig();
}

function render() {
  const [, label, , , sub] = PAGES.find(p => p[0] === page);
  $('#title').textContent = label;
  $('#subtitle').textContent = sub;
  $('#tools').replaceChildren();
  pageEl.replaceChildren();
  ({ library, wallpaper, look: () => editorPage('look'), widgets: () => editorPage('widgets'), assistant: () => editorPage('assistant'),
    desktop: () => editorPage('desktop'), lock, hub, settings })[page]();
  details();
}

function editorPage(tab) {
  editor.tab = tab;
  editor.cfg = cfg;
  editor.library = null;
  pageEl.append(editorBox);
  if (tab === 'look' && wallpaperFor(cfg, 0).type !== 'scene') {
    pageEl.prepend(notice('info', 'Your 3D look isn\'t your wallpaper right now', 'You can still edit it here. Use it as your wallpaper to see it on your desktop.',
      h('button.btn.primary', { onclick: () => use({ choice: { type: 'scene' }, title: 'My 3D look', key: 'scene' }) }, 'Use my 3D look')));
  }
  editor.render();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function notice(kind, title, text, ...actions) {
  const ico = { info: 'info', warn: 'info', good: 'check', steam: 'steam', cube: 'cube' }[kind] || 'info';
  return h('div.notice.' + kind, {}, h('span', { html: icon(ico) }), h('div', {}, h('h3', {}, title), h('p', {}, text), actions.length ? h('div.acts', {}, ...actions) : ''));
}

function section(title, kana, ...kids) {
  return h('section.st-section', {}, h('h2', {}, title, kana ? h('span.kana', {}, kana) : ''), ...kids);
}

function row(label, hint, control) {
  return h('label.rowf', {}, h('div', {}, h('b', {}, label), hint ? h('small', {}, hint) : ''), control);
}

function switchFor(obj, key, onChange) {
  return h('input.switch', { type: 'checkbox', role: 'switch', checked: !!obj[key], onchange: e => { obj[key] = e.target.checked; onChange?.(e.target.checked); } });
}

function sliderFor(obj, key, min, max, step, onInput, fmt = v => v) {
  const out = h('output.small.muted', {}, fmt(obj[key]));
  const input = h('input.slider', { type: 'range', min, max, step, value: obj[key] });
  const fill = () => { input.style.setProperty('--fill', ((input.value - min) / (max - min) * 100) + '%'); out.textContent = fmt(+input.value); };
  fill();
  input.addEventListener('input', () => { obj[key] = +input.value; fill(); onInput?.(); });
  return h('span', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '260px' } }, input, out);
}

function segFor(obj, key, options, onChange) {
  const box = h('div.seg', { role: 'group' });
  const paint = () => box.replaceChildren(...Object.entries(options).map(([v, label]) => h('button', {
    type: 'button', 'aria-pressed': String(String(obj[key]) === v), onclick: e => { e.preventDefault(); obj[key] = typeof obj[key] === 'number' ? +v : v; paint(); onChange?.(); },
  }, label)));
  paint();
  return box;
}

// ---- Library -----------------------------------------------------------------------------------
async function library() {
  $('#tools').append(
    h('button.btn', { onclick: () => pick(false) }, h('span', { html: icon('upload') }), 'Add a file…'),
    h('button.btn', { onclick: () => pick(true) }, h('span', { html: icon('folder') }), 'Add a folder…'),
    h('button.btn', { onclick: addSite }, h('span', { html: icon('globe') }), 'Add a web site…'),
  );
  const search = h('input.input', { type: 'search', placeholder: 'Search your wallpapers…', value: libQuery, 'aria-label': 'Search wallpapers' });
  const filters = [['all', 'All'], ['aerie', 'Aerie scenes'], ['model', '3D scenes'], ['image', 'Pictures'], ['video', 'Videos'], ['web', 'Web'], ['steam', 'Wallpaper Engine']];
  const chips = h('div.chips', {}, ...filters.map(([k, label]) => h('button.chip', { 'aria-pressed': String(libFilter === k), onclick: e => {
    libFilter = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget)); paintGrid();
  } }, label)));
  const body = h('div.st-page');
  pageEl.append(h('div.lib-bar', {}, h('label.search', {}, h('span', { html: icon('search') }), search), chips), body);
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { libQuery = search.value; paintGrid(); }, 120); });

  list = await allWallpapers(true);
  const steam = await api.steam();
  const keys = await api.hubShortcuts();
  if (!keys.installed && !STANDALONE) {
    body.before(notice('info', 'Open the hub with Super+D', 'The hub drops down from the top of the screen with quick controls, stats, clipboard history, apps and wallpapers. Turn on the shortcut to open it from anywhere (you can also push the mouse to the top middle of the screen).',
      h('button.btn.primary', { onclick: async e => { await api.setHubShortcuts(true); toast('Super+D now opens the hub'); e.target.closest('.notice').remove(); } }, 'Turn on Super+D'),
      h('button.btn.ghost', { onclick: () => api.shell('hub') }, 'Open the hub now')));
  }

  function card(w) {
    const inUse = w.key === currentKey(cfg, list);
    return h('button.wp', {
      'aria-pressed': String(selected?.key === w.key), title: w.title,
      onclick: () => { selected = w; paintGrid(); details(); sendConfig(); },
      ondblclick: () => use(w),
    }, w.preview ? h('img.thumb', { src: w.preview, alt: '', loading: 'lazy' }) : h('div.ph', { style: { background: placeholderStyle(w) }, html: icon(KIND_ICON[w.kind] || 'wallpaper') }),
    h('span.badge', {}, KIND_LABEL[w.kind] || ''), inUse ? h('span.inuse', {}, 'In use') : '',
    h('span.meta', {}, h('b', {}, w.title), h('small', {}, sourceLabel(w))));
  }

  function paintGrid() {
    const q = libQuery.trim().toLowerCase();
    const match = w => (!q || w.title.toLowerCase().includes(q) || (w.tagline || '').toLowerCase().includes(q))
      && (libFilter === 'all' || (libFilter === 'aerie' ? w.source === 'default' || w.kind === 'look'
        : libFilter === 'steam' ? ['steam', 'wallpaper-engine'].includes(w.source) : libFilter === 'web' ? ['web', 'url'].includes(w.kind) : w.kind === libFilter))
      && (cfg.general.hub?.showMature || w.rating !== 'mature');
    const groups = [
      ['Aerie scenes', 'シーン', list.filter(w => (w.source === 'default' || w.kind === 'look') && match(w))],
      ['Yours', 'あなたの', list.filter(w => !['default', 'steam', 'aerie'].includes(w.source) && match(w))],
      ['Steam Workshop', 'ワークショップ', list.filter(w => w.source === 'steam' && match(w))],
    ];
    body.replaceChildren();
    if (!list.some(w => w.source === 'default') && (libFilter === 'all' || libFilter === 'aerie') && !q) {
      body.append(notice('cube', 'Aerie\'s own scenes go here', 'Scenes made in Blender come with Aerie as its default themes. Until they are added, your 3D look is the default. You can import any Blender scene yourself: in Blender use File → Export → glTF 2.0 (.glb), then "Add a file…" here.'));
    }
    for (const [title, kana, items] of groups) {
      if (!items.length) continue;
      body.append(section(title, kana, h('div.lib-grid', {}, ...items.map(card))));
    }
    if (libFilter === 'all' || libFilter === 'steam') body.append(steamNotice(steam));
    if (!groups.some(g => g[2].length)) body.prepend(h('div.empty', { html: icon('wallpaper') + '<div>Nothing matches. Try another filter, or add your own wallpapers.</div>' }));
  }
  paintGrid();
}

function steamNotice(steam) {
  if (steam.count) {
    return notice('good', `Found ${steam.count} Wallpaper Engine wallpaper${steam.count === 1 ? '' : 's'} from Steam`,
      'Wallpapers you subscribe to in the Steam Workshop show up here by themselves. Video, web and picture wallpapers play like in Wallpaper Engine; scene wallpapers show their picture layers with mouse depth (their shader effects only run in Wallpaper Engine itself).');
  }
  return notice('steam', 'Use your Wallpaper Engine wallpapers',
    steam.steam
      ? 'Steam is installed, but no Wallpaper Engine wallpapers were found. Install Wallpaper Engine in Steam (it needs Proton: right-click it → Properties → Compatibility), then subscribe to wallpapers in its Workshop; they appear here by themselves.'
      : 'If you own Wallpaper Engine on Steam, install Steam, then Wallpaper Engine (with Proton) and subscribe to wallpapers — they appear here by themselves. You can also add a Wallpaper Engine folder (with project.json) or a .zip with "Add a folder…".',
    h('button.btn.small', { onclick: () => pick(true) }, 'Add a Wallpaper Engine folder…'));
}

async function pick(folder) {
  if (STANDALONE || !window.webkit) {
    const input = h('input', { type: 'file', multiple: true });
    input.onchange = () => uploadFiles([...input.files]);
    input.click();
    return;
  }
  toast(folder ? 'Choose a wallpaper folder…' : 'Choose a file…');
  try {
    const res = await api.pickWallpaper(folder);
    if (res.cancelled) return;
    added(res.item);
  } catch (e) { toast(e.message); }
}

async function uploadFiles(files) {
  for (const f of files) {
    toast(`Adding ${f.name} (${fmtBytes(f.size)})…`);
    try { added((await api.uploadWallpaper(f)).item); } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
}

function added(item) {
  forgetLibrary();
  toast(`Added "${item.title}"`);
  selected = { key: item.id, choice: { type: 'library', id: item.id }, title: item.title, kind: item.type, source: item.source, item, preview: item.previewUrl };
  if (page === 'library') render(); else go('library');
  sendConfig(true);
}

async function addSite() {
  const url = prompt('Web address to use as your wallpaper (it loads live, so it needs the internet):', 'https://');
  if (!url || url === 'https://') return;
  try { added((await api.addUrl(url)).item); } catch (e) { toast(e.message); }
}

async function use(w) {
  cfg.wallpaper = w.choice;
  cfg.screens = {};
  changed(true);
  await save();
  toast(`${w.title} is your wallpaper now`);
  selected = null;
  if (page === 'library') render();
}

// the details of the selected wallpaper, under the preview
function details() {
  const box = $('#details');
  box.replaceChildren();
  const w = page === 'library' ? selected : null;
  if (!w) {
    const cur = list.find(x => x.key === currentKey(cfg || {}, list));
    box.append(h('p.small.muted', {}, cur ? `Your wallpaper: ${cur.title}.` : ''),
      h('div.acts', {}, h('button.btn.small', { onclick: () => api.shell('hub') }, h('span', { html: icon('keyboard') }), 'Open the hub'),
        h('button.btn.small', { onclick: () => go('wallpaper') }, 'Wallpaper settings')));
    return;
  }
  const inUse = w.key === currentKey(cfg, list);
  const canRemove = w.item && w.source !== 'default';
  box.append(
    h('h2', {}, w.title),
    h('div.tags', {}, h('span.tag', {}, KIND_LABEL[w.kind] || ''), h('span.tag', {}, sourceLabel(w)), ...(w.item?.tags || []).slice(0, 4).map(t => h('span.tag', {}, t))),
    w.tagline ? h('p', {}, w.tagline) : '',
    h('div.acts', {},
      inUse ? h('button.btn.mint', { disabled: true }, h('span', { html: icon('check') }), 'In use') : h('button.btn.primary', { onclick: () => use(w) }, 'Use as my wallpaper'),
      inUse ? h('button.btn', { onclick: () => go('wallpaper') }, 'Settings') : '',
      w.item && w.source !== 'default' ? h('button.btn.ghost', { onclick: async () => {
        const name = prompt('New name:', w.title);
        if (name) { await api.updateWallpaper(w.key, { title: name }); forgetLibrary(); selected.title = name; render(); }
      } }, 'Rename') : '',
      canRemove ? h('button.btn.danger', { onclick: async () => {
        const steam = w.source === 'steam';
        if (!confirm(steam ? `Hide "${w.title}" from Aerie? (To delete it, unsubscribe in Steam.)` : `Remove "${w.title}" from your library? Its copy in Aerie is deleted.`)) return;
        await api.removeWallpaper(w.key);
        if (inUse) { cfg.wallpaper = { type: 'default' }; changed(true); }
        selected = null; forgetLibrary(); render(); toast(steam ? 'Hidden' : 'Removed');
      } }, w.source === 'steam' ? 'Hide' : 'Remove') : ''),
    w.kind === 'url' ? h('p.small', {}, 'Web sites load live from the internet and run as your wallpaper. Their own privacy policy applies.') : '',
    w.kind === 'web' ? h('p.small', {}, 'Web wallpapers run in a sandbox: they can\'t see your files, Aerie\'s settings or your browser.') : '',
  );
}

// ---- This wallpaper ----------------------------------------------------------------------------
async function wallpaper() {
  list = list.length ? list : await allWallpapers();
  const choice = wallpaperFor(cfg, 0);
  const key = currentKey(cfg, list);
  const w = list.find(x => x.key === key);
  if (!w || w.kind === 'look') {
    pageEl.append(notice('info', 'Your wallpaper is your 3D look', 'Change it on the 3D look page, or pick another wallpaper in the Library.',
      h('button.btn', { onclick: () => go('look') }, 'Edit my 3D look'), h('button.btn', { onclick: () => go('library') }, 'Library')));
    return;
  }
  const s = (cfg.wallpaperProps ||= {})[key] ||= {};
  const set = wallpaperSettings(cfg, key);
  Object.assign(s, { ...set, ...s });
  const save2 = () => changed();
  pageEl.append(h('div.notice', {}, w.preview ? h('img', { src: w.preview, alt: '', style: { width: '160px', borderRadius: '12px', aspectRatio: '16/9', objectFit: 'cover' } }) : h('span', { html: icon(KIND_ICON[w.kind]) }),
    h('div', {}, h('h3', {}, w.title), h('p', {}, `${KIND_LABEL[w.kind]} · ${sourceLabel(w)}`), h('div.acts', {}, h('button.btn.small', { onclick: () => go('library') }, 'Change wallpaper')))));
  const rows = [];
  if (w.kind === 'model') {
    rows.push(
      row('Mouse depth', 'How much the camera follows your mouse', sliderFor(s, 'motion', 0, 2, 0.1, save2, v => Math.round(v * 100) + '%')),
      row('Animation speed', 'For scenes with animations', sliderFor(s, 'speed', 0, 3, 0.1, save2, v => v.toFixed(1) + '×')),
      row('Brightness', 'Exposure', sliderFor(s, 'exposure', 0.2, 3, 0.05, save2, v => v.toFixed(2))),
      row('Shadows', 'Turn off on slower computers', switchFor(s, 'shadows', save2)),
      row('Background color', 'Leave empty to use the scene\'s own', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('input', { type: 'color', value: s.background || '#0b0f1e', oninput: e => { s.background = e.target.value; save2(); } }),
        h('button.btn.small', { onclick: () => { s.background = ''; save2(); render(); } }, 'Scene\'s own'))),
    );
  }
  if (w.kind === 'image' || w.kind === 'video') rows.push(row('Fit', '', segFor(s, 'fit', { cover: 'Fill', fit: 'Fit', stretch: 'Stretch', center: 'Center' }, save2)));
  if (w.kind === 'video') {
    rows.push(
      row('Speed', '', sliderFor(s, 'speed', 0.25, 2, 0.05, save2, v => v.toFixed(2) + '×')),
      row('Play its sound', 'Off by default', switchFor(s, 'sound', () => { save2(); render(); })),
    );
    if (s.sound) rows.push(row('Volume', '', sliderFor(s, 'volume', 0, 100, 1, save2, v => v + '%')));
  }
  if (w.kind === 'scene') rows.push(row('Mouse depth', 'How much the layers move with your mouse', sliderFor(s, 'motion', 0, 2, 0.1, save2, v => Math.round(v * 100) + '%')));
  if (w.kind === 'web' || w.kind === 'url') rows.push(row('Play its sound', 'Off by default', switchFor(s, 'sound', save2)));
  if (rows.length) pageEl.append(section('Playback', '再生', ...rows));
  const props = w.item?.properties || {};
  if (Object.keys(props).length) {
    s.props ||= {};
    const box = h('div.st-section');
    const paint = () => box.replaceChildren(h('h2', {}, 'Its own settings', h('span.kana', {}, '設定')), ...propRows(props, s.props, () => { save2(); paint(); }));
    paint();
    pageEl.append(box);
  }
  if (w.kind === 'scene') pageEl.append(notice('info', 'About Wallpaper Engine scenes', 'Aerie shows a scene\'s picture layers with Wallpaper Engine\'s mouse parallax. Its shader effects, particles and scripts only run inside Wallpaper Engine itself.'));
  if (choice.type === 'default') pageEl.append(h('p.small.muted', {}, 'This is Aerie\'s default scene.'));
}

/** Wallpaper Engine / Lively "user properties" as controls, respecting their show-if conditions. */
function propRows(props, values, onChange) {
  const value = k => (k in values ? values[k] : props[k].value);
  const visible = p => {
    if (!p.condition) return true;
    // conditions look like "showclock.value == true" or "style.value == 2"
    const m = /^\s*(\w+)\.value\s*(==|!=|===|!==)\s*(.+?)\s*$/.exec(p.condition);
    if (!m || !(m[1] in props)) return true;
    let want = m[3].replace(/^['"]|['"]$/g, '');
    const got = value(m[1]);
    want = want === 'true' ? true : want === 'false' ? false : isNaN(+want) ? want : +want;
    const eq = String(got) === String(want);
    return m[2].startsWith('!') ? !eq : eq;
  };
  return Object.entries(props).filter(([, p]) => p.type !== 'group' && visible(p)).map(([k, p]) => {
    const set = v => { values[k] = v; onChange(); };
    let control;
    if (p.type === 'bool') control = h('input.switch', { type: 'checkbox', checked: !!value(k), onchange: e => set(e.target.checked) });
    else if (p.type === 'slider') {
      const o = { v: +value(k) };
      control = sliderFor(o, 'v', p.min, p.max, p.step || 1, () => { values[k] = o.v; clearTimeout(propRows.t); propRows.t = setTimeout(onChange, 150); }, v => (p.step < 1 ? v.toFixed(2) : v));
    } else if (p.type === 'combo') control = h('select.input', { style: { maxWidth: '260px' }, onchange: e => set(p.options.find(x => String(x.value) === e.target.value)?.value) },
      ...(p.options || []).map(o => h('option', { value: String(o.value), selected: String(o.value) === String(value(k)) }, o.label)));
    else if (p.type === 'color') control = h('input', { type: 'color', value: weToHex(value(k)), oninput: e => set(p.lively ? e.target.value : hexToWe(e.target.value)) });
    else control = h('input.input', { style: { maxWidth: '260px' }, value: value(k) ?? '', onchange: e => set(e.target.value) });
    return row(p.label, '', control);
  });
}
const weToHex = v => {
  if (typeof v === 'string' && v.startsWith('#')) return v;
  const parts = String(v || '1 1 1').split(/\s+/).map(Number);
  return '#' + parts.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x || 0)) * 255).toString(16).padStart(2, '0')).join('');
};
const hexToWe = hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

// ---- Lock screen ---------------------------------------------------------------------------------
async function lock() {
  const st = await api.lockStatus();
  const opts = cfg.general.lockScreen;
  const toggle = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!st.enabled, 'aria-label': 'Use Aerie as my lock screen' });
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    if (toggle.checked) toast('Asking for your password to install the lock screen switch…');
    try {
      const res = await api.setLockEnabled(toggle.checked);
      toast(res.message);
      if (!res.ok) toggle.checked = !toggle.checked;
    } catch (e) { toast(e.message); toggle.checked = !toggle.checked; }
    render();
  });
  pageEl.append(h('div.big-toggle', {}, h('div.ico', { html: icon('lock') }),
    h('div', {}, h('h3', {}, 'Use Aerie as my lock screen'), h('p', {}, st.enabled ? 'On — your live wallpaper shows when the computer is locked.' : 'Off — COSMIC\'s own lock screen is used.')), toggle));
  if (!st.installed) pageEl.append(notice('warn', 'Install Aerie first', 'The lock screen only works when Aerie is installed (not when running from its source folder).'));
  if (st.fellBack) pageEl.append(notice('warn', 'COSMIC\'s lock screen took over', 'Aerie\'s lock screen stopped working several times in a row, so COSMIC\'s own one is used until you log in again. Run "aerie-lock --preview" in a terminal to see what went wrong, or check ~/.cache/aerie-lock.log.'));
  pageEl.append(h('div.acts', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    h('button.btn', { onclick: async () => { const r = await api.previewLock(); toast(r.ok ? 'Showing a preview (press Esc to close it)' : 'Could not open the preview'); } }, h('span', { html: icon('eye') }), 'Try it (no locking)'),
    h('button.btn', { onclick: () => api.power('lock') }, h('span', { html: icon('lock') }), 'Lock now'),
  ));
  pageEl.append(section('What it shows', '表示',
    row('Clock', '', switchFor(opts, 'clock', () => changed())),
    row('Date', '', switchFor(opts, 'date', () => changed())),
    row('What\'s playing', 'Title, artist and play/pause', switchFor(opts, 'media', () => changed())),
    row('Battery', 'On laptops', switchFor(opts, 'battery', () => changed())),
    row('Sleep and power buttons', '', switchFor(opts, 'power', () => changed())),
    row('Darken the wallpaper', 'Makes the clock and password box easier to read', sliderFor(opts, 'dim', 0, 0.8, 0.05, () => changed(), v => Math.round(v * 100) + '%')),
    row('Blur the wallpaper', '', sliderFor(opts, 'blur', 0, 30, 1, () => changed(), v => v + 'px')),
    row('Message', 'Shown under the clock (optional)', h('input.input', { style: { maxWidth: '300px' }, value: opts.message || '', maxlength: 120, onchange: e => { opts.message = e.target.value; changed(); } })),
  ));
  pageEl.append(section('How it works', '仕組み',
    h('ul.plain', {},
      h('li', {}, 'COSMIC starts its lock screen program in every session. Turning this on sets that program aside (with dpkg-divert, so COSMIC updates keep working) and puts a small switch in its place. You confirm this once with your password.'),
      h('li', {}, 'The switch starts Aerie\'s lock screen only for people who turned it on. Everyone else, and the login screen, get COSMIC\'s own lock screen as before.'),
      h('li', {}, 'Your password is checked by the system (PAM), the same way as at login. Aerie never stores it.'),
      h('li', {}, 'If Aerie\'s lock screen crashes, the screen stays locked and it restarts. After 3 failures COSMIC\'s own lock screen takes over.'),
      h('li', {}, 'Turning it off brings COSMIC\'s lock screen back right away. Uninstalling Aerie removes the switch.'),
    ),
    st.switch ? h('div', {}, h('button.btn.danger', { onclick: async () => { const r = await api.removeLockSwitch(); toast(r.message); render(); } }, 'Remove the system switch completely')) : '',
  ));
  const cosmicBox = h('div.st-editor.panel');
  const cosmicEditor = new Editor(cosmicBox, editorCallbacks, { embedded: true });
  cosmicEditor.cfg = cfg;
  cosmicEditor.tab = 'cosmiclock';
  pageEl.append(section('COSMIC\'s lock screen picture', 'COSMIC', h('p.muted', { style: { margin: 0 } }, 'Used when the Aerie lock screen is off, and on the login screen.'), cosmicBox));
  cosmicEditor.render();
}

// ---- Hub ------------------------------------------------------------------------------------------
async function hub() {
  const g = cfg.general;
  const sc = await api.hubShortcuts();
  const short = { on: sc.installed };
  pageEl.append(h('div.big-toggle', {}, h('div.ico', { html: icon('keyboard') }),
    h('div', {}, h('h3', {}, 'Super+D opens the hub'), h('p', {}, 'Also Super+Shift+W for wallpapers. Added to COSMIC\'s own custom shortcuts.')),
    switchFor(short, 'on', async on => { try { const r = await api.setHubShortcuts(on); toast(r.installed ? 'Shortcuts added' : 'Shortcuts removed'); } catch (e) { toast(e.message); } })));
  pageEl.append(h('div', {}, h('button.btn.primary', { onclick: () => api.shell('hub') }, 'Open the hub now')));
  pageEl.append(section('Opening it', '開く',
    row('Push the mouse to the top middle', 'Opens the hub when your mouse rests at the very top of the screen, in the middle', switchFor(g.hub, 'hotEdge', () => changed())),
  ));
  const tabs = [['controls', 'Controls'], ['today', 'Today'], ['stats', 'Stats'], ['clipboard', 'Clipboard'], ['apps', 'Apps'], ['wallpaper', 'Wallpaper'], ['power', 'Power']];
  pageEl.append(section('Tabs', 'タブ', ...tabs.map(([k, label]) => {
    const o = { on: g.hub.tabs.includes(k) };
    return row(label, '', switchFor(o, 'on', on => { g.hub.tabs = tabs.map(t => t[0]).filter(t => (t === k ? on : g.hub.tabs.includes(t))); if (!g.hub.tabs.length) g.hub.tabs = ['wallpaper']; changed(); }));
  })));
  const clip = await api.clipboard();
  pageEl.append(section('Clipboard history', 'クリップボード',
    row('Keep a clipboard history', 'The last 200 things you copy, on this computer only. Secrets from password managers are never kept.',
      switchFor(g.clipboard, 'enabled', async on => { changed(); await api.clipAction('enable', '', { on }); })),
    !clip.available ? notice('warn', 'Needs wl-clipboard', 'Open a terminal and run: sudo apt install wl-clipboard') : '',
    clip.problem ? notice('warn', 'Clipboard history isn\'t working yet', clip.problem,
      h('button.btn.small', { onclick: async () => { const r = await api.clipboardAccess(true); toast(r.message); } }, 'Let apps see the clipboard (asks for your password)')) : '',
    h('div', {}, h('button.btn.danger.small', { onclick: async () => { if (confirm('Delete your whole clipboard history, pinned items too?')) { await api.clipAction('clear', '', { all: true }); toast('Clipboard history cleared'); } } }, 'Clear clipboard history')),
  ));
  pageEl.append(section('Wallpapers', '壁紙',
    row('Show wallpapers marked "Mature"', 'Wallpaper Engine wallpapers rated for adults are hidden unless you turn this on', switchFor(g.hub, 'showMature', () => changed())),
  ));
}

// ---- Settings -------------------------------------------------------------------------------------
function settings() {
  editorPage('settings');
  pageEl.append(section('Library', 'ライブラリ',
    row('Hidden Workshop wallpapers', 'Show the Steam Workshop wallpapers you hid again', h('button.btn.small', { onclick: async () => { await api.unhideWallpapers(); forgetLibrary(); toast('They\'re back in your library'); } }, 'Show them again')),
  ));
}

// ---- drag and drop to import ------------------------------------------------------------------------
$('#drop-icon').innerHTML = icon('upload');
let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) uploadFiles(files);
});

// ---- start ----------------------------------------------------------------------------------------
window.studio = { go };
window.aeriePage = {
  async configChanged() {
    // something else (the hub, the desktop) changed the setup: pick it up unless we're mid-edit
    if (saveTimer) return;
    cfg = normalizeConfig(await api.loadConfig());
    editor.cfg = cfg;
    forgetLibrary();
    list = await allWallpapers(true);
    if (!document.activeElement || document.activeElement === document.body) render();
    sendConfig(true);
  },
};

(async function start() {
  cfg = normalizeConfig(await api.loadConfig());
  editor.setConfig(cfg);
  apps = await api.apps();
  list = await allWallpapers(true);
  const info = await api.installInfo();
  $('#foot').textContent = `Aerie ${info.version || ''} · saves automatically`;
  nav();
  go(page);
  sendConfig(true);
})();
