// The command menu: Ctrl+K opens a search box over every page and action. Type a few letters,
// pick with the arrow keys and Enter.
import { animate, place, SPRINGS } from './motion.js';
import { h, icon } from './icons.js';

/** Scores how well `q` matches `text` (letters in order); 0 means no match. */
function score(q, text) {
  if (!q) return 1;
  text = text.toLowerCase();
  const at = text.indexOf(q);
  if (at === 0) return 100;
  if (at > 0) return 60 - Math.min(at, 30);
  let i = 0, gaps = 0, last = -1;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) { if (last >= 0) gaps += j - last - 1; last = j; i++; }
  }
  return i === q.length ? Math.max(1, 30 - gaps) : 0;
}

/**
 * installCommandMenu(() => [{ label, group, hint, icon, keywords, run }])
 * Returns { open, close }.
 */
export function installCommandMenu(getCommands, { placeholder = 'Search pages and actions…' } = {}) {
  let el = null, items = [], active = 0, lastFocus = null;
  const input = h('input.cmdk-input', { type: 'text', placeholder, 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cmdk-list', autocomplete: 'off', spellcheck: false });
  const list = h('div.cmdk-list', { id: 'cmdk-list', role: 'listbox', 'aria-label': 'Results' });
  const scrim = h('div.cmdk-scrim', { onpointerdown: () => close() });
  const panel = h('div.cmdk', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command menu', 'data-sq': 18 },
    h('label.cmdk-top', {}, h('span', { html: icon('search') }), input, h('kbd', {}, 'Esc')), list);

  function paint() {
    const q = input.value.trim().toLowerCase();
    items = getCommands()
      .map(c => ({ c, s: Math.max(score(q, c.label), score(q, (c.keywords || '') + ' ' + (c.group || '')) * 0.6) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map(x => x.c);
    if (!q) items.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    active = Math.min(active, Math.max(0, items.length - 1));
    let group = null;
    const rows = [];
    items.forEach((c, i) => {
      if (!q && c.group !== group) { group = c.group; rows.push(h('div.cmdk-group', { role: 'presentation' }, group || '')); }
      rows.push(h('div.cmdk-item', {
        role: 'option', id: 'cmdk-' + i, 'aria-selected': String(i === active),
        onpointermove: () => { if (active !== i) { active = i; mark(); } },
        onclick: () => run(c),
      }, h('span.cmdk-ico', { html: icon(c.icon || 'arrowRight') }), h('span.cmdk-label', {}, c.label), c.hint ? h('kbd', {}, c.hint) : ''));
    });
    if (!items.length) rows.push(h('div.cmdk-empty', {}, 'No matches. Try another word.'));
    list.replaceChildren(...rows);
    mark();
  }

  function mark() {
    list.querySelectorAll('.cmdk-item').forEach((r, i) => r.setAttribute('aria-selected', String(i === active)));
    const row = list.querySelector(`#cmdk-${active}`);
    row?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', row ? row.id : '');
  }

  function run(c) {
    close(true);
    setTimeout(() => c.run(), 0);
  }

  function open() {
    if (el) { input.select(); return; }
    lastFocus = document.activeElement;
    el = h('div.cmdk-layer', {}, scrim, panel);
    document.body.append(el);
    input.value = '';
    active = 0;
    paint();
    place(panel, { y: -14, scale: 0.97, opacity: 0 });
    place(scrim, { opacity: 0 });
    animate(panel, { y: 0, scale: 1, opacity: 1 }, { config: SPRINGS.snappy });
    animate(scrim, { opacity: 1 }, { config: SPRINGS.gentle });
    input.focus();
  }

  async function close(keepFocus = false) {
    if (!el) return;
    const gone = el;
    el = null;
    animate(scrim, { opacity: 0 }, { config: SPRINGS.snappy });
    await animate(panel, { y: -10, scale: 0.98, opacity: 0 }, { config: SPRINGS.snappy });
    gone.remove();
    if (!keepFocus) lastFocus?.focus?.();
  }

  input.addEventListener('input', () => { active = 0; paint(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) run(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); el ? close() : open(); }
  }, true);
  return { open, close, isOpen: () => !!el };
}
