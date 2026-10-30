// Studio → Library: every wallpaper you have, filtered like Wallpaper Engine's browser, with the
// selected one's details and settings under the preview.
import { api, STANDALONE, wallpaperSettings } from '../config.js';
import { creditLine, prefetchPreview, previewEl } from '../catalog.js';
import { fmtBytes, h, icon, kbd, skeleton } from '../icons.js';
import { FILTERS, KIND_ICON, KIND_LABEL, SOURCES, sourceLabel } from '../kinds.js';
import { cachedLibrary } from '../library.js';
import { toast } from '../toast.js';
import { filterChips, propRows, row, section, seg, slider, springIn, pct, times, toggle } from './forms.js';
import { changed, currentItem, previewItem, refreshList, S, save } from './state.js';

const view = { type: 'all', source: 'any', query: '', sort: 'added', favorites: false };
const hidden = new Set(); // removed, waiting for the undo toast to go away
let grid = null;
let steam = { count: 0, steam: false };

export async function libraryPage(pageEl, toolsEl, go) {
  toolsEl.append(
    h('button.btn', { onclick: () => pick(false), title: 'Add a file (Ctrl+O)' }, h('span', { html: icon('upload') }), 'Add a file…', kbd('Ctrl+O')),
    h('button.btn', { onclick: () => pick(true), title: 'Add a folder (Ctrl+Shift+O)' }, h('span', { html: icon('folder') }), 'Add a folder…'),
    h('button.btn', { onclick: addSite, title: 'Add a web site (Ctrl+L)' }, h('span', { html: icon('globe') }), 'Add a web site…'),
  );
  const rail = h('aside.lib-rail', { 'aria-label': 'Filters' });
  const main = h('div.lib-main');
  pageEl.append(h('div.lib-layout', {}, rail, main));
  const search = h('input.input', { type: 'search', placeholder: 'Search your wallpapers', value: view.query, 'aria-label': 'Search wallpapers' });
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { view.query = search.value; paint(); }, 120); });
  const status = h('span.updating', { hidden: true }, 'Updating');
  const sort = h('select.input.sort', { 'aria-label': 'Sort by', onchange: e => { view.sort = e.target.value; paint(); } },
    ...Object.entries({ added: 'Recently added', name: 'Name', kind: 'Kind' }).map(([v, label]) => h('option', { value: v, selected: view.sort === v }, label)));
  const count = h('span.small.muted.tnum');
  grid = h('div.lib-grid', { role: 'listbox', 'aria-label': 'Wallpapers' });
  main.append(h('div.lib-bar', {}, h('label.search', {}, h('span', { html: icon('search') }), search), count, status, sort), grid);

  function paintRail() {
    const items = visibleBase();
    rail.replaceChildren(
      h('h3.rail-h', {}, 'Type'),
      filterChips(FILTERS, items, view.type, id => { view.type = id; paintRail(); paint(true); }, 'Type of wallpaper'),
      h('h3.rail-h', {}, 'From'),
      filterChips(SOURCES, items, view.source, id => { view.source = id; paintRail(); paint(true); }, 'Where it came from'),
      h('label.rowf.compact', {}, h('div', {}, h('b', {}, 'Favorites only')), toggle(view, 'favorites', () => paint(true), 'Favorites only')),
      steamNote(),
      h('p.rules', {}, 'Only add wallpapers you made or have the right to use. They stay on this computer.'),
    );
  }

  // stale-while-revalidate: draw the last list you saw (or skeleton tiles) right away
  const shown = S.list.length ? S.list : cachedLibrary();
  if (shown?.length) { S.list = shown; paintRail(); paint(); } else grid.append(skeleton('tiles', 8));
  status.hidden = false;
  [, steam] = await Promise.all([refreshList(), api.steam()]);
  status.hidden = true;
  if (!grid.isConnected) return;
  paintRail();
  paint();

  function paint(animateIn = false) {
    const q = view.query.trim().toLowerCase();
    const f = FILTERS.find(x => x.id === view.type), src = SOURCES.find(x => x.id === view.source);
    let items = visibleBase().filter(w => f.match(w) && src.match(w) && (!view.favorites || w.favorite) &&
      (!q || `${w.title} ${w.tagline || ''} ${(w.tags || []).join(' ')}`.toLowerCase().includes(q)));
    items = sortItems(items);
    count.textContent = `${items.length} wallpaper${items.length === 1 ? '' : 's'}`;
    const cards = items.map(card);
    grid.replaceChildren(...cards);
    if (!items.length) {
      grid.append(h('div.empty', { html: icon('wallpaper') }, h('p', {}, S.list.length ? 'Nothing matches. Try another filter.' : 'Your library is empty. Add a wallpaper, or find one in Discover.'),
        h('div.acts', {}, h('button.btn', { onclick: () => pick(false) }, 'Add a file…'), h('button.btn', { onclick: () => go('discover') }, 'Discover'))));
    }
    if (animateIn) springIn(cards);
  }
  document.addEventListener('library-changed', () => { if (grid.isConnected) { paintRail(); paint(); details(); } });
  window.studioLibrary = { paint, paintRail };
}

function visibleBase() {
  return S.list.filter(w => !hidden.has(w.id) && (S.cfg.general.showMature || w.rating !== 'mature'));
}

function sortItems(items) {
  const by = {
    added: (a, b) => (a.source === 'default') - (b.source === 'default') || (b.added || 0) - (a.added || 0) || (a.order ?? 99) - (b.order ?? 99),
    name: (a, b) => a.title.localeCompare(b.title),
    kind: (a, b) => (KIND_LABEL[a.type] || '').localeCompare(KIND_LABEL[b.type] || '') || a.title.localeCompare(b.title),
  }[view.sort];
  return items.slice().sort(by);
}

function card(w) {
  const inUse = w.id === currentItem()?.id;
  return h('button.wp', {
    type: 'button', role: 'option', 'data-id': w.id, 'aria-selected': String(S.selected?.id === w.id), 'data-sq': 12,
    title: `${w.title} (double-click or Enter to use)`,
    onclick: () => select(w),
    ondblclick: () => use(w),
    onpointerenter: () => prefetchPreview(w),
  }, previewEl(w, 'thumb'),
  h('span.badge', {}, h('span', { html: icon(KIND_ICON[w.type] || 'wallpaper') }), KIND_LABEL[w.type] || ''),
  h('span.marks', {}, w.audio ? h('span', { title: 'Reacts to music', html: icon('waveform') }) : '', w.favorite ? h('span.fav', { title: 'Favorite', html: icon('heartFill') }) : ''),
  h('span.meta', {}, h('b', {}, w.title), h('small', {}, sourceLabel(w), inUse ? h('span.inuse', {}, 'In use') : '')));
}

export function select(w) {
  S.selected = w;
  for (const c of grid?.querySelectorAll('.wp') || []) c.setAttribute('aria-selected', String(c.dataset.id === w?.id));
  previewItem(w, { fresh: false });
  details();
  grid?.querySelector(`.wp[data-id="${CSS.escape(w?.id || '')}"]`)?.focus();
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
    if (!res.cancelled) added(res.item);
  } catch (e) { toast(e.message); }
}

export async function uploadFiles(files) {
  for (const f of files) {
    toast(`Adding ${f.name} (${fmtBytes(f.size)})…`);
    try { added((await api.uploadWallpaper(f)).item); } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
}

export async function added(item) {
  toast(`Added "${item.title}"`);
  await refreshList();
  const w = S.list.find(i => i.id === item.id) || item;
  window.studio?.go('library');
  window.studioLibrary?.paintRail();
  window.studioLibrary?.paint();
  select(w);
}

async function addSite() {
  const url = prompt('Web address to use as your wallpaper (it loads live, so it needs the internet):', 'https://');
  if (!url || url === 'https://') return;
  try { added((await api.addUrl(url)).item); } catch (e) { toast(e.message); }
}

export async function use(w) {
  S.cfg.wallpaper = { type: 'library', id: w.id };
  S.cfg.screens = {};
  S.selected = null;
  previewItem(null);
  changed(true);
  await save();
  toast(`${w.title} is your wallpaper now`);
  window.studioLibrary?.paint();
  details();
}

/** The details of the selected wallpaper (or the one in use), under the preview. */
export function details() {
  const box = document.getElementById('details');
  if (!box) return;
  box.replaceChildren();
  if (document.body.dataset.page === 'create') {
    box.append(h('p.small.muted', {}, 'The preview shows what you make or edit, live. Save it to add it to your library; then use it as your wallpaper from there.'));
    return;
  }
  const w = S.selected || currentItem();
  if (!w) { box.append(h('p.small.muted', {}, 'Pick a wallpaper to see it here.')); return; }
  const inUse = w.id === currentItem()?.id;
  const ownFile = !['default', 'steam'].includes(w.source);
  box.append(
    h('div.d-head', {},
      h('div', {}, h('h2', {}, w.title), h('p.small.muted', {}, `${KIND_LABEL[w.type] || ''} · ${sourceLabel(w)}`)),
      h('button.icon-btn', { 'aria-pressed': String(!!w.favorite), title: w.favorite ? 'Remove from favorites' : 'Add to favorites',
        html: icon(w.favorite ? 'heartFill' : 'heart'), onclick: () => favorite(w) })),
    w.tagline || w.description ? h('p.small', {}, w.tagline || w.description) : '',
    creditLine(w.credit, h) || '',
    h('div.acts', {},
      inUse ? h('button.btn', { disabled: true }, h('span', { html: icon('check') }), 'In use')
        : h('button.btn.primary', { onclick: () => use(w) }, 'Use as wallpaper', kbd('Enter')),
      w.editable || (w.source === 'default' && ['shader', 'parallax', 'stage'].includes(w.type))
        ? h('button.btn', { onclick: () => window.studio.edit(w) }, h('span', { html: icon('pencil') }), w.editable ? 'Edit' : 'Edit a copy') : '',
      ownFile && w.source !== 'url' ? h('button.btn.ghost', { onclick: () => rename(w) }, 'Rename') : '',
      h('button.btn.danger', { onclick: () => removeWallpaper(w), title: 'Remove (Delete)' },
        w.source === 'steam' || w.source === 'default' ? 'Hide' : 'Remove')),
    settingsFor(w),
  );
  if (w.type === 'url') box.append(h('p.small.muted', {}, 'Web sites load live from the internet. Their own privacy policy applies.'));
  if (w.type === 'web') box.append(h('p.small.muted', {}, 'Web wallpapers play on your desktop in a sandbox: they can\'t see your files, Aerie\'s settings or your browser. The preview here shows their picture.'));
  if (w.type === 'scene') box.append(h('p.small.muted', {}, 'Aerie shows a Wallpaper Engine scene\'s picture layers with its mouse depth. Its effects, particles and scripts only run in Wallpaper Engine.'));
}

/** Per-wallpaper settings (saved for that wallpaper, shown live in the preview). */
function settingsFor(w) {
  const all = (S.cfg.wallpaperProps ||= {});
  const s = all[w.id] ||= {};
  Object.assign(s, { ...wallpaperSettings(S.cfg, w.id), ...s });
  const save2 = () => changed();
  const rows = [];
  const motion = label => slider(s, 'motion', { min: 0, max: 2, step: 0.05, fmt: pct, onInput: save2, label });
  const speed = (label, max = 3) => slider(s, 'speed', { min: 0, max, step: 0.05, fmt: times, onInput: save2, label });
  if (w.type === 'image' || w.type === 'video') rows.push(row('Fit', '', seg(s, 'fit', { cover: 'Fill', fit: 'Fit', stretch: 'Stretch', center: 'Center' }, save2, 'Fit')));
  if (w.type === 'video') {
    rows.push(speed('Speed', 2), row('Play its sound', '', toggle(s, 'sound', () => { save2(); details(); }, 'Play its sound')));
    if (s.sound) rows.push(slider(s, 'volume', { min: 0, max: 100, step: 1, fmt: v => v + '%', onInput: save2, label: 'Volume' }));
  }
  if (w.type === 'model') {
    rows.push(motion('Mouse depth'), speed('Animation speed'),
      slider(s, 'exposure', { min: 0.2, max: 3, step: 0.05, fmt: v => (+v).toFixed(2), onInput: save2, label: 'Brightness' }),
      row('Shadows', 'Turn off on slower computers', toggle(s, 'shadows', save2, 'Shadows')));
  }
  if (w.type === 'stage') rows.push(motion('Mouse depth'), speed('Motion speed'),
    slider(s, 'exposure', { min: 0.2, max: 3, step: 0.05, fmt: v => (+v).toFixed(2), onInput: save2, label: 'Brightness' }));
  if (w.type === 'parallax' || w.type === 'scene') rows.push(motion('Mouse depth'));
  if (w.type === 'parallax') rows.push(speed('Drift speed'));
  if (w.type === 'shader') rows.push(speed('Speed'),
    slider(s, 'quality', { min: 0.25, max: 1, step: 0.05, fmt: pct, onInput: save2, label: 'Sharpness', hint: 'lower is lighter on your computer' }));
  if (w.type === 'web' || w.type === 'url') rows.push(row('Play its sound', '', toggle(s, 'sound', save2, 'Play its sound')));
  if (w.audio) rows.push(row('React to music', 'Listens to what your speakers play', toggle(s, 'react', save2, 'React to music')));
  const props = w.properties || {};
  const out = h('div.d-settings');
  if (rows.length) out.append(section('Settings', '設定', ...rows));
  if (Object.keys(props).length) {
    s.props ||= {};
    const box = h('div');
    const paint = () => box.replaceChildren(...propRows(props, s.props, () => { save2(); paint(); }));
    paint();
    out.append(section(w.type === 'shader' ? 'Shader settings' : 'Its own settings', 'オプション', box,
      h('button.btn.small.ghost', { onclick: () => { s.props = {}; save2(); details(); } }, 'Reset to its defaults')));
  }
  return out;
}

async function favorite(w) {
  // optimistic: the heart fills at once; it empties again if Aerie can't save it
  w.favorite = !w.favorite;
  details();
  window.studioLibrary?.paint();
  try { await api.updateWallpaper(w.id, { favorite: w.favorite }); } catch { w.favorite = !w.favorite; details(); window.studioLibrary?.paint(); toast('Couldn\'t save that'); }
}

async function rename(w) {
  const name = (prompt('New name:', w.title) || '').trim();
  if (!name || name === w.title) return;
  const old = w.title;
  w.title = name;
  details();
  window.studioLibrary?.paint();
  try { await api.updateWallpaper(w.id, { title: name }); } catch { w.title = old; details(); window.studioLibrary?.paint(); toast('Couldn\'t rename it'); }
}

/** Remove (or hide) a wallpaper. It disappears now; Aerie deletes it once the undo toast goes away. */
export function removeWallpaper(w) {
  const hideOnly = w.source === 'steam' || w.source === 'default';
  const inUse = w.id === currentItem()?.id;
  const before = { wallpaper: S.cfg.wallpaper, screens: S.cfg.screens };
  const tiles = [...document.querySelectorAll('.wp')];
  const at = tiles.findIndex(t => t.dataset.id === w.id);
  const hadFocus = document.activeElement === tiles[at];
  const next = (tiles[at + 1] || tiles[at - 1])?.dataset.id;
  hidden.add(w.id);
  window.studioLibrary?.paint();
  window.studioLibrary?.paintRail();
  // keep your place: focus moves to the tile beside the one you removed
  if (hadFocus && next) document.querySelector(`.wp[data-id="${CSS.escape(next)}"]`)?.focus();
  if (S.selected?.id === w.id) { S.selected = null; previewItem(null); }
  if (inUse) { S.cfg.wallpaper = { type: 'default' }; S.cfg.screens = {}; changed(true); }
  details();
  toast(hideOnly ? `Hid "${w.title}". Settings → Library brings it back.` : `Removed "${w.title}"`, {
    undo: () => {
      hidden.delete(w.id);
      window.studioLibrary?.paint();
      window.studioLibrary?.paintRail();
      if (inUse) { Object.assign(S.cfg, before); changed(true); }
    },
    commit: async () => {
      try { await api.removeWallpaper(w.id); hidden.delete(w.id); await refreshList(); } catch { hidden.delete(w.id); window.studioLibrary?.paint(); toast(`Couldn't remove "${w.title}"`); }
    },
  });
}

function steamNote() {
  if (steam.count) return h('p.small.muted.rail-note', {}, `Found ${steam.count} Wallpaper Engine wallpaper${steam.count === 1 ? '' : 's'} in your Steam Workshop.`);
  return h('div.rail-note', {}, h('p.small.muted', {}, steam.steam
    ? 'Steam is here, but no Wallpaper Engine wallpapers yet. Subscribe to some in its Workshop and they show up here.'
    : 'Own Wallpaper Engine? Install it in Steam (with Proton); your Workshop wallpapers show up here. Or add a Wallpaper Engine folder or .zip.'),
  h('button.btn.small', { onclick: () => pick(true) }, 'Add a Wallpaper Engine folder…'));
}

export function libraryKeys(e) {
  if (!S.selected || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select')) return false;
  if (e.key === 'Delete') { e.preventDefault(); removeWallpaper(S.selected); return true; }
  if (e.key === 'Enter' && !e.target.closest?.('button:not(.wp)')) { e.preventDefault(); use(S.selected); return true; }
  return false;
}

export { pick, addSite };
