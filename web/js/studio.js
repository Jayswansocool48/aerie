// Aerie Studio: your wallpaper library, finding and making wallpapers, widgets, the lock screen and
// settings, in a normal window. The preview on the right shows exactly what your desktop will show.
import { api, normalizeConfig } from './config.js';
import { installCommandMenu } from './command.js';
import { h, icon, kbd } from './icons.js';
import { KIND_ICON, KIND_LABEL } from './kinds.js';
import { animate, installCssSprings, place, SPRINGS } from './motion.js';
import { installSquircles } from './squircle.js';
import { flushToasts, toast } from './toast.js';
import { createKeys, createPage, editItem, stageAdd } from './studio/create.js';
import { discoverPage } from './studio/discover.js';
import { addSite, details, libraryKeys, libraryPage, pick, select, uploadFiles } from './studio/library.js';
import { lockPage } from './studio/lock.js';
import { settingsPage } from './studio/settings.js';
import { currentItem, onPreview, previewItem, refreshList, S, saving, sendConfig, setOverride } from './studio/state.js';
import { selectWidget, widgetsPage } from './studio/widgets.js';

installCssSprings();
installSquircles();

const PAGES = [
  ['library', 'Library', 'ライブラリ', 'wallpaper', 'Your wallpapers: pictures, videos, 2D, 3D, shaders, web and Wallpaper Engine'],
  ['discover', 'Discover', '発見', 'compass', 'Free pictures, skies and 3D models from the internet'],
  ['create', 'Create', '作成', 'brush', 'Make a wallpaper with the AI, or build one yourself'],
  ['widgets', 'Widgets', 'ウィジェット', 'widgets', 'Clocks, notes, music and more over your wallpaper'],
  ['lock', 'Lock screen', 'ロック', 'lock', 'Your live wallpaper when the computer is locked'],
  ['settings', 'Settings', '設定', 'settings', 'Pausing, sound, online content, updates and privacy'],
];
const $ = s => document.querySelector(s);
const pageEl = $('#page');
const frame = $('#preview');
let page = new URLSearchParams(location.search).get('page') || 'library';

// ---- the preview --------------------------------------------------------------------------------
frame.src = `index.html?mode=preview&monitor=0${location.hash}`;
function fitPreview() { frame.style.transform = `scale(${$('.pv-frame').clientWidth / 1600})`; }
new ResizeObserver(fitPreview).observe($('.pv-frame'));
document.addEventListener('preview-label', () => {
  const now = currentItem();
  const shown = S.override ? null : S.previewItem;
  $('#pv-label').textContent = S.override ? 'Your edits, live' : shown && shown.id !== now?.id ? 'Preview, not in use yet' : now ? `In use: ${now.title}` : 'Your desktop';
});
onPreview(m => {
  if (m.type === 'select-widget' && m.id) { selectWidget(m.id); go('widgets'); }
  if (m.type === 'widget-changed') { const w = S.cfg.widgets.find(x => x.id === m.id); if (w) { Object.assign(w, m.patch); clearTimeout(go.t); go.t = setTimeout(() => import('./studio/state.js').then(s => s.save()), 450); } }
});

// ---- pages ------------------------------------------------------------------------------------
function nav() {
  $('#nav').replaceChildren(...PAGES.map(([key, label, kana, ico], i) => h('button.pill', {
    role: 'tab', 'aria-selected': String(key === page), tabIndex: key === page ? 0 : -1, 'data-page': key,
    title: `${label} (Ctrl+${i + 1})`, 'aria-keyshortcuts': `Control+${i + 1}`, onclick: () => go(key),
    onpointerenter: () => prefetch(key), onfocus: () => prefetch(key),
    onkeydown: e => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const next = PAGES[(i + d + PAGES.length) % PAGES.length][0];
      go(next);
      requestAnimationFrame(() => $(`#nav [data-page="${next}"]`)?.focus());
    },
  }, h('span', { html: icon(ico) }), label, h('span.kana', {}, kana))), h('span.tab-ind'));
  requestAnimationFrame(moveIndicator);
}

// the line under the tabs slides to the page you picked (a spring, so it can change course midway)
function moveIndicator() {
  const on = $('#nav [aria-selected="true"]'), ind = $('#nav .tab-ind');
  if (!on || !ind) return;
  const box = $('#nav').getBoundingClientRect(), r = on.getBoundingClientRect();
  ind.style.width = `${r.width - 20}px`; // width follows a CSS transition sampled from the same spring
  animate(ind, { x: r.left - box.left + 10 }, { config: SPRINGS.snappy });
}

// pre-rendering: while your pointer rests on a page's name, Studio fetches what that page needs
const warm = {};
const PREFETCH = { library: () => refreshList(), lock: () => api.lockStatus(), settings: () => api.audio() };
function prefetch(key) {
  if (key === page || warm[key] || !PREFETCH[key]) return;
  warm[key] = PREFETCH[key]().catch(() => null);
  setTimeout(() => { delete warm[key]; }, 8000);
}

function go(key) {
  if (!PAGES.some(p => p[0] === key)) key = 'library';
  const from = PAGES.findIndex(p => p[0] === page), to = PAGES.findIndex(p => p[0] === key);
  if (key !== page) {
    flushToasts();
    if (page === 'create') setOverride(null);
    if (key !== 'library') { S.selected = null; previewItem(null); }
    S.editWidgets = key === 'widgets';
  }
  const change = () => {
    page = key;
    nav();
    render();
    $('#main').scrollTop = 0;
    sendConfig();
  };
  // view transitions where the engine has them; otherwise the page slides in on a spring
  if (document.startViewTransition && from !== to) document.startViewTransition(change);
  else {
    change();
    if (from !== to) { place(pageEl, { y: (to > from ? 1 : -1) * 12, opacity: 0 }); animate(pageEl, { y: 0, opacity: 1 }, { config: SPRINGS.snappy }); }
  }
}

function render() {
  const [, label, , , sub] = PAGES.find(p => p[0] === page);
  $('#title').textContent = label;
  $('#subtitle').textContent = sub;
  $('#tools').replaceChildren();
  pageEl.replaceChildren();
  document.body.dataset.page = page;
  ({
    library: () => libraryPage(pageEl, $('#tools'), go),
    discover: () => discoverPage(pageEl),
    create: () => createPage(pageEl, $('#tools')),
    widgets: () => widgetsPage(pageEl),
    lock: () => lockPage(pageEl),
    settings: () => settingsPage(pageEl),
  })[page]();
  if (page !== 'discover') details();
}

// ---- drag and drop to import ----------------------------------------------------------------------
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

// ---- keyboard: Ctrl+K searches everything, Ctrl+1…6 opens a page ------------------------------
const commands = installCommandMenu(() => [
  ...PAGES.map(([key, label, , ico, sub], i) => ({ label, group: 'Pages', icon: ico, hint: `Ctrl+${i + 1}`, keywords: sub, order: i, run: () => go(key) })),
  { label: 'Add a file…', group: 'Library', icon: 'upload', hint: 'Ctrl+O', keywords: 'import picture video glb blender shader glsl gif', order: 20, run: () => pick(false) },
  { label: 'Add a folder or Wallpaper Engine project…', group: 'Library', icon: 'folder', hint: 'Ctrl+Shift+O', keywords: 'import zip lively steam', order: 21, run: () => pick(true) },
  { label: 'Add a web site…', group: 'Library', icon: 'globe', hint: 'Ctrl+L', keywords: 'url page', order: 22, run: addSite },
  { label: 'Ask the AI for a wallpaper', group: 'Create', icon: 'robot', keywords: 'assistant generate draw find', order: 25, run: () => go('create') },
  { label: 'Find free pictures', group: 'Discover', icon: 'image', keywords: 'openverse photo art', order: 26, run: () => go('discover') },
  { label: 'Try the lock screen (no locking)', group: 'Actions', icon: 'eye', order: 31, run: async () => { const r = await api.previewLock(); toast(r.ok ? 'Showing a preview. Press Esc to close it.' : 'Couldn\'t open the preview'); } },
  { label: 'Check for updates', group: 'Actions', icon: 'refresh', keywords: 'upgrade version', order: 32, run: () => go('settings') },
  ...S.list.slice(0, 120).map(w => ({ label: w.title, group: 'Wallpapers', icon: KIND_ICON[w.type] || 'wallpaper', keywords: KIND_LABEL[w.type] || '', order: 40,
    run: () => { if (page !== 'library') go('library'); setTimeout(() => select(w), 50); } })),
], { placeholder: 'Search pages, actions and wallpapers…' });
$('#cmd').append(h('span', { html: icon('search') }), h('span', {}, 'Search'), kbd('Ctrl+K'));
$('#cmd').addEventListener('click', () => commands.open());

addEventListener('keydown', e => {
  if (commands.isOpen()) return;
  if (page === 'create' && createKeys(e)) return;
  if (page === 'library' && !e.ctrlKey && libraryKeys(e)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (/^[1-6]$/.test(k) && PAGES[+k - 1]) { e.preventDefault(); go(PAGES[+k - 1][0]); }
  else if (k === 'o') { e.preventDefault(); pick(e.shiftKey); }
  else if (k === 'l') { e.preventDefault(); addSite(); }
});
addEventListener('resize', moveIndicator);

// ---- start ----------------------------------------------------------------------------------------
window.studio = {
  go,
  edit: w => editItem(w),
  stageAdd: what => stageAdd(what),
};
window.aeriePage = {
  async configChanged() {
    // something else (the desktop's menu) changed the setup: pick it up unless we're mid-edit
    if (saving()) return;
    S.cfg = normalizeConfig(await api.loadConfig());
    await refreshList();
    if (!document.activeElement || document.activeElement === document.body) render();
    sendConfig(true);
  },
};

(async function start() {
  S.cfg = normalizeConfig(await api.loadConfig());
  [S.apps] = await Promise.all([api.apps(), refreshList()]);
  const info = await api.installInfo();
  $('#foot').textContent = `Aerie ${info.version || ''}`;
  nav();
  go(page);
  sendConfig(true);
})();
