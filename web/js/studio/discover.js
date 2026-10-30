// Studio → Discover: free wallpapers from the internet. Public-domain pictures from Openverse and
// CC0 skies and 3D models from Poly Haven. Nothing goes online until you turn it on here.
import { api } from '../config.js';
import { h, icon, skeleton } from '../icons.js';
import { toast } from '../toast.js';
import { notice, springIn } from './forms.js';
import { added } from './library.js';
import { changed, S, save } from './state.js';

const TABS = [
  ['pictures', 'Pictures', 'image', 'Openverse'],
  ['skies', '360° skies', 'sun', 'Poly Haven'],
  ['models', '3D models', 'cube', 'Poly Haven'],
];
const state = { tab: 'pictures', q: { pictures: 'mountain lake', skies: '', models: '' }, page: 1, results: [], picked: null };

export function discoverPage(pageEl) {
  if (!S.cfg.general.online) {
    pageEl.append(h('div.consent', { 'data-sq': 14 },
      h('span.ico', { html: icon('globe') }),
      h('div', {},
        h('h2', {}, 'Find free wallpapers online'),
        h('p', {}, 'Search public-domain pictures on Openverse, and free 360° skies and 3D models on Poly Haven, then add them to your library with their credits.'),
        h('ul.plain', {},
          h('li', {}, 'Your search words go to Openverse (run by the WordPress Foundation) or Poly Haven. Pictures you add download from the site that hosts them, often Flickr or Wikimedia Commons.'),
          h('li', {}, 'Aerie sends no account, name or other data, and keeps what you add on this computer.'),
          h('li', {}, 'Everything you can add here is CC0 or public domain, free for any use.'),
          h('li', {}, 'You can turn this off again in Settings. Things you added keep working offline.')),
        h('div.acts', {}, h('button.btn.primary', { onclick: () => { S.cfg.general.online = true; changed(); save().then(() => window.studio.go('discover')); } }, 'Turn on online content')))));
    return;
  }
  const tabs = h('div.pills.disc-tabs', { role: 'tablist', 'aria-label': 'What to find' }, ...TABS.map(([k, label, ico, src]) => h('button.pill', {
    role: 'tab', 'aria-selected': String(state.tab === k), tabIndex: state.tab === k ? 0 : -1,
    onclick: () => { state.tab = k; state.page = 1; state.picked = null; window.studio.go('discover'); },
    onkeydown: e => {
      const i = TABS.findIndex(t => t[0] === state.tab), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      state.tab = TABS[(i + d + TABS.length) % TABS.length][0];
      window.studio.go('discover');
      requestAnimationFrame(() => document.querySelector('.disc-tabs [aria-selected="true"]')?.focus());
    },
  }, h('span', { html: icon(ico) }), label, h('small.muted', {}, src))));
  const input = h('input.input', { type: 'search', value: state.q[state.tab], placeholder: state.tab === 'pictures' ? 'Search pictures: sunset beach, aurora, forest…' : 'Search Poly Haven: sunset, forest, studio, chair…', 'aria-label': 'Search' });
  const grid = h('div.disc-grid');
  const more = h('button.btn', { hidden: true, onclick: () => { state.page++; run(true); } }, 'More results');
  const form = h('form.disc-search', { onsubmit: e => { e.preventDefault(); state.q[state.tab] = input.value.trim(); state.page = 1; run(); } },
    h('label.search', {}, h('span', { html: icon('search') }), input), h('button.btn.primary', { type: 'submit' }, 'Search'));
  const credit = state.tab === 'pictures'
    ? h('p.small.muted', {}, 'Pictures from Openverse, only CC0 and public domain. Credits stay with each picture.')
    : h('p.small.muted', {}, 'Skies and models from Poly Haven (polyhaven.com), all CC0.');
  pageEl.append(tabs, form, credit, grid, more);

  async function run(append = false) {
    if (!append) grid.replaceChildren(skeleton('tiles', 9));
    more.hidden = true;
    try {
      const q = state.q[state.tab];
      const items = state.tab === 'pictures' ? await api.openverse(q || 'landscape', state.page) : await api.polyhaven(state.tab === 'skies' ? 'hdris' : 'models', q);
      state.results = append ? state.results.concat(items) : items;
      paint(append ? items : state.results, append);
      more.hidden = state.tab !== 'pictures' || items.length < 20 || state.page >= 12;
    } catch (e) {
      grid.replaceChildren(notice('warn', 'Couldn\'t search right now', e.message || 'Are you online?'));
    }
  }

  function paint(items, append) {
    const cards = items.slice(0, 120).map(tile);
    if (!append) grid.replaceChildren(...cards); else grid.append(...cards);
    if (!state.results.length) grid.replaceChildren(h('div.empty', { html: icon('search') }, h('p', {}, 'Nothing found. Try other words.')));
    springIn(cards);
  }

  function tile(r) {
    const src = state.tab === 'pictures' ? `/openverse-thumb/${r.id}` : `/polyhaven-thumb/${encodeURIComponent(r.id)}`;
    const meta = state.tab === 'pictures' ? `${r.creator || 'Unknown'} · ${r.license === 'cc0' ? 'CC0' : 'Public domain'}` : (r.authors || []).join(', ') || 'Poly Haven';
    return h('button.wp.disc', { type: 'button', 'data-sq': 12, 'aria-pressed': String(state.picked?.id === r.id), onclick: () => pickResult(r, src) },
      h('div.thumb.pv-img', {}, h('img', { src, alt: r.title || r.name || '', loading: 'lazy' })),
      h('span.meta', {}, h('b', {}, r.title || r.name), h('small', {}, meta)));
  }

  function pickResult(r, thumb) {
    state.picked = r;
    for (const t of grid.querySelectorAll('.wp')) t.setAttribute('aria-pressed', String(t.querySelector('b')?.textContent === (r.title || r.name)));
    const box = document.getElementById('details');
    box.replaceChildren(
      h('img.disc-big', { src: thumb, alt: r.title || r.name }),
      h('h2', {}, r.title || r.name),
      state.tab === 'pictures'
        ? h('p.credit', {}, `${r.creator ? 'By ' + r.creator + ' · ' : ''}${r.license === 'cc0' ? 'CC0' : 'Public Domain Mark'} · ${r.source || 'Openverse'}${r.width ? ` · ${r.width}×${r.height}` : ''}`,
          r.page ? h('a', { href: r.page, target: '_blank', rel: 'noopener' }, ' Source') : '')
        : h('p.credit', {}, `${(r.authors || []).join(', ') || 'Poly Haven'} · CC0 · Poly Haven`,
          h('a', { href: `https://polyhaven.com/a/${r.id}`, target: '_blank', rel: 'noopener' }, ' Source')),
      h('div.acts', {}, ...actions(r)),
    );
  }

  function actions(r) {
    if (state.tab === 'pictures') {
      return [h('button.btn.primary', { onclick: async e => { busy(e.currentTarget, 'Downloading…'); try { added(await api.openverseImport(r.id)); } catch (err) { toast(err.message); } done(e); } }, h('span', { html: icon('download') }), 'Add to my library')];
    }
    if (state.tab === 'skies') {
      return [
        h('button.btn.primary', { onclick: async e => { busy(e.currentTarget, 'Downloading the sky…'); try { added(await api.polyhavenSky(r.id)); } catch (err) { toast(err.message); } done(e); } }, 'Use as a 360° sky wallpaper'),
        h('button.btn', { onclick: () => window.studio.stageAdd({ sky: r }) }, 'Use in a 3D scene'),
      ];
    }
    return [h('button.btn.primary', { onclick: () => window.studio.stageAdd({ model: r }) }, h('span', { html: icon('plus') }), 'Add to a 3D scene')];
  }

  const busy = (b, label) => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = label; };
  const done = e => { const b = e.target.closest('button'); if (b) { b.disabled = false; b.textContent = b.dataset.label; } };
  run();
}
