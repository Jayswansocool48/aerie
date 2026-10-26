// Widgets: cards floating over the 3D scene, each at its own depth so they move with the camera.
import { APP_CATEGORIES, api } from './config.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const QUOTES = [
  'Small steps every day add up to big things.',
  'Make it work, make it right, make it beautiful.',
  'Finish the level before you redesign the game.',
  'Rest is part of the work.',
  'Curiosity is the best tutorial.',
  'Ship it, then polish it.',
  'Every expert was once a beginner who kept going.',
  'Today is a good day to build something.',
  'Focus on the next frame, not the whole animation.',
  'Bugs are just puzzles with bad manners.',
  'Done is a feature.',
  'Be kind to future you: leave good notes.',
  'Simple things, done well.',
  'The best way to learn is to make something.',
  'Breathe in, plan; breathe out, build.',
];
const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  next: '<path d="M6 6l9 6-9 6zM16 6h2v12h-2z"/>', prev: '<path d="M18 6l-9 6 9 6zM6 6h2v12H6z"/>',
  grid: '<path d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  reset: '<path d="M12 5a7 7 0 1 1-7 7h2a5 5 0 1 0 5-5v3L8 6l4-4z"/>', x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const svg = (name, label = '') => `<svg viewBox="0 0 24 24" class="ico" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} fill="currentColor">${ICONS[name]}</svg>`;

export class WidgetLayer {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.cb = callbacks; // onSelect, onChange, onLaunchError, onLaunched, onOpenDrawer, onTogglePin, onChime
    this.nodes = new Map();
    this.editMode = false;
    this.selectedId = null;
    this.apps = [];
    this.appsLoaded = false;
    this.system = null;
    this.history = { cpu: [], memory: [], down: [], up: [] };
    this.player = null;
    this.timers = new Map();   // widget id -> { left, total, running, phase }
    this.slides = new Map();   // widget id -> index
    setInterval(() => this.tick(), 1000);
    setInterval(() => this.pollSystem(), 2000);
    setInterval(() => this.pollPlayer(), 2000);
  }

  apply(cfg) {
    const first = !this.cfg;
    this.cfg = cfg;
    const keep = new Set(cfg.widgets.map(w => w.id));
    for (const [id, node] of this.nodes) if (!keep.has(id)) { node.remove(); this.nodes.delete(id); }
    cfg.widgets.forEach((w, i) => {
      let node = this.nodes.get(w.id);
      if (!node) {
        node = document.createElement('section');
        node.dataset.id = w.id;
        node.tabIndex = -1;
        this.bindNode(node);
        if (cfg.theme.entrance && first) node.style.animationDelay = `${120 + i * 70}ms`;
        node.classList.add('entering');
        node.addEventListener('animationend', e => { if (e.animationName === 'rise') node.classList.remove('entering'); });
        setTimeout(() => node.classList.remove('entering'), 2500);
        this.nodes.set(w.id, node);
      }
      // keep the stacking order the same as the list, without re-inserting (that restarts animations)
      if (this.root.children[i] !== node) this.root.insertBefore(node, this.root.children[i] || null);
      this.renderWidget(node, w);
    });
    const types = new Set(cfg.widgets.map(w => w.type));
    if (['apps', 'favorites', 'dock', 'search'].some(t => types.has(t))) this.loadApps();
    if (types.has('system') || types.has('graph')) this.pollSystem();
    if (types.has('nowplaying')) this.pollPlayer();
  }

  async loadApps(force = false) {
    if (this.appsLoaded && !force) return this.apps;
    this.appsLoaded = true;
    this.apps = force ? await api.refreshApps() : await api.apps();
    for (const w of this.cfg.widgets) {
      if (['apps', 'favorites', 'dock', 'search'].includes(w.type)) this.renderWidget(this.nodes.get(w.id), w);
    }
    return this.apps;
  }

  setEditMode(on) {
    this.editMode = on;
    this.root.classList.toggle('editing', on);
    if (!on) this.select(null);
  }

  select(id) {
    this.selectedId = id;
    for (const [wid, node] of this.nodes) node.classList.toggle('selected', wid === id);
  }

  updateParallax(px, py) {
    if (!this.cfg) return;
    const reduce = document.documentElement.classList.contains('reduce-motion');
    const orbit = this.cfg.camera?.mode === 'orbit';
    for (const w of this.cfg.widgets) {
      const node = this.nodes.get(w.id);
      if (!node) continue;
      const motion = this.editMode || reduce ? 'still' : (w.motion || this.cfg.theme.widgetMotion || 'parallax');
      const shift = motion === 'still' ? 0 : w.depth * 60;
      const set = (k, v) => { if (node.style.getPropertyValue(k) !== v) node.style.setProperty(k, v); };
      set('--px', `${(-px * shift).toFixed(1)}px`);
      set('--py', `${(py * shift * 0.6).toFixed(1)}px`);
      if (motion === '3d') {
        // Turn the card in space as the camera moves, like the panels of a game's 3D menu:
        // cards off to the side face the middle a little, and everything sways with the mouse.
        const cx = w.x / 100 + w.w / 2 / innerWidth - 0.5, cy = w.y / 100 + w.h / 2 / innerHeight - 0.5;
        const k = orbit ? 1.6 : 1;
        set('--cry', `${(-cx * 22 + px * 14 * k).toFixed(2)}deg`);
        set('--crx', `${(cy * 14 - py * 9 * k).toFixed(2)}deg`);
        set('--pz', `${(w.depth * 24).toFixed(0)}px`);
      } else {
        set('--cry', '0deg');
        set('--crx', '0deg');
        set('--pz', '0px');
      }
    }
  }

  // ---- rendering ------------------------------------------------------
  renderWidget(node, w) {
    if (!node) return;
    const style = !w.card ? 'clear' : (w.cardStyle || this.cfg.theme.cardStyle || 'frosted');
    const entering = node.classList.contains('entering');
    node.className = `widget widget-${w.type} card-${style}` + (this.selectedId === w.id ? ' selected' : '') + (entering ? ' entering' : '');
    node.hidden = w.visible === false;
    node.style.left = w.x + '%';
    node.style.top = w.y + '%';
    node.style.width = w.w + 'px';
    node.style.height = w.h + 'px';
    node.setAttribute('aria-label', labelFor(w));
    const s = w.style || {};
    node.style.setProperty('--w-accent', s.accent || 'var(--accent)');
    node.style.color = s.text || '';
    node.replaceChildren(this.bodyFor(w));
    if (this.editMode) {
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      node.appendChild(handle);
    }
    this.updateDynamic(node, w);
  }

  bodyFor(w) {
    const el = div('widget-body');
    const st = w.settings;
    switch (w.type) {
      case 'clock':
        el.innerHTML = st.analog
          ? `<svg class="analog" viewBox="0 0 100 100" role="img" aria-label="Analog clock"><circle cx="50" cy="50" r="46"/>${ticks()}<line class="h" x1="50" y1="50" x2="50" y2="28"/><line class="m" x1="50" y1="50" x2="50" y2="14"/><line class="s" x1="50" y1="56" x2="50" y2="10"/><circle class="pin" cx="50" cy="50" r="2.5"/></svg>`
          : `<div class="time"></div><div class="ampm"></div>`;
        if (st.size) el.querySelector('.time')?.style.setProperty('font-size', st.size + 'px');
        break;
      case 'date': el.innerHTML = '<div class="date"></div>'; break;
      case 'greeting': el.innerHTML = '<div class="greet"></div>'; break;
      case 'system':
        el.innerHTML = ['cpu', 'memory', 'disk', 'battery'].filter(k => st[k]).map(k =>
          `<div class="meter" data-k="${k}"><div class="meter-top"><span>${{ cpu: 'CPU', memory: 'Memory', disk: 'Disk', battery: 'Battery' }[k]}</span><b>–</b></div><div class="bar" role="progressbar" aria-label="${k}" aria-valuemin="0" aria-valuemax="100"><i></i></div></div>`).join('')
          + (st.network ? '<div class="net-row"><span>↓ <b class="down">–</b></span><span>↑ <b class="up">–</b></span></div>' : '');
        break;
      case 'apps': return this.appsBody(w);
      case 'favorites': return this.favoritesBody(w);
      case 'dock': return this.dockBody(w);
      case 'search': return this.searchBody(w);
      case 'notes': {
        const ta = document.createElement('textarea');
        ta.className = 'notes';
        ta.placeholder = 'Write something…';
        ta.setAttribute('aria-label', 'Notes');
        ta.value = st.text || '';
        let timer;
        ta.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => this.cb.onChange?.(w.id, { settings: { ...w.settings, text: ta.value } }, { silent: true }), 500);
        });
        el.appendChild(ta);
        break;
      }
      case 'todo': return this.todoBody(w);
      case 'calendar': el.appendChild(calendar(st.weekStart)); break;
      case 'text': {
        const p = div('label', st.text);
        p.style.fontSize = st.size + 'px';
        p.style.textAlign = st.align;
        p.style.fontWeight = st.weight || 600;
        el.appendChild(p);
        break;
      }
      case 'image':
        if (st.url) {
          const img = document.createElement('img');
          img.src = st.url; img.alt = st.alt || ''; img.style.objectFit = st.fit;
          el.appendChild(img);
        } else el.innerHTML = '<div class="empty">Pick an image in Aerie Studio → Widgets</div>';
        break;
      case 'slideshow': {
        if (!st.images.length) { el.innerHTML = '<div class="empty">Add photos in Aerie Studio → Widgets</div>'; break; }
        st.images.forEach((url, i) => {
          const img = document.createElement('img');
          img.src = url; img.alt = ''; img.style.objectFit = st.fit;
          img.className = 'slide' + (i === (this.slides.get(w.id) || 0) % st.images.length ? ' on' : '');
          el.appendChild(img);
        });
        break;
      }
      case 'links': {
        el.classList.add('links');
        if (!st.items.length) el.innerHTML = '<div class="empty">Add links in Aerie Studio → Widgets</div>';
        for (const item of st.items) {
          const b = document.createElement('button');
          b.className = 'link';
          b.innerHTML = `<span class="link-dot" aria-hidden="true">${escapeHtml((item.label || '?').slice(0, 1))}</span><span class="link-label"></span>`;
          b.querySelector('.link-label').textContent = item.label || item.url;
          b.title = item.url;
          b.addEventListener('click', () => { if (!this.editMode && /^https?:\/\//i.test(item.url)) window.open(item.url, '_blank', 'noopener'); });
          el.appendChild(b);
        }
        break;
      }
      case 'worldclock':
        el.classList.add('world');
        el.innerHTML = st.zones.map((z, i) => `<div class="zone" data-i="${i}"><span class="zone-name"></span><span class="zone-time"></span><span class="zone-day"></span></div>`).join('')
          || '<div class="empty">Add places in Aerie Studio → Widgets</div>';
        st.zones.forEach((z, i) => { el.querySelector(`[data-i="${i}"] .zone-name`).textContent = z.label; });
        break;
      case 'countdown':
        el.innerHTML = '<div class="cd-label"></div><div class="cd-time" aria-live="off"></div>';
        el.querySelector('.cd-label').textContent = st.label;
        break;
      case 'timer': return this.timerBody(w);
      case 'graph':
        el.innerHTML = `<div class="graph-top"><span class="graph-name">${{ cpu: 'CPU', memory: 'Memory', network: 'Network' }[st.metric]}</span><b class="graph-val">–</b></div><canvas class="graph" aria-hidden="true"></canvas>`;
        break;
      case 'nowplaying': return this.playerBody(w);
      case 'moon':
        el.innerHTML = '<svg class="moon-svg" viewBox="0 0 100 100" role="img" aria-label="Moon phase"><defs><radialGradient id="mg" cx="40%" cy="35%"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#d6d3c4"/></radialGradient></defs><circle cx="50" cy="50" r="40" class="moon-dark"/><path class="moon-lit" fill="url(#mg)"/></svg><div class="moon-name"></div><div class="moon-pct"></div>';
        if (!st.labels) el.querySelectorAll('.moon-name,.moon-pct').forEach(n => n.remove());
        break;
      case 'quote':
        el.innerHTML = '<blockquote class="quote-text"></blockquote><div class="quote-by"></div>';
        break;
    }
    return el;
  }

  // ---- apps ---------------------------------------------------------------
  pinnedApps(own, suggest = false) {
    const ids = own && own.length ? own : (this.cfg.general.pinned || []);
    const picked = ids.map(id => this.apps.find(a => a.id === id)).filter(Boolean);
    return picked.length || !suggest ? picked : this.suggestedApps();
  }

  /** Until you pin your own, the dock shows one app of each everyday kind. */
  suggestedApps() {
    const kinds = ['FileManager', 'WebBrowser', 'TerminalEmulator', 'TextEditor', 'Development', 'Game', 'Settings'];
    const out = [];
    for (const kind of kinds) {
      const app = this.apps.find(a => a.categories.includes(kind) && !out.includes(a));
      if (app) out.push(app);
    }
    for (const a of this.apps) if (out.length < 5 && !out.includes(a)) out.push(a);
    return out.slice(0, 7);
  }

  appsBody(w) {
    const st = w.settings;
    const el = div('widget-body apps');
    let category = 'all';
    let query = '';
    const grid = div(st.layout === 'list' ? 'app-list' : 'app-grid');
    grid.style.setProperty('--cols', st.columns);
    grid.setAttribute('role', 'list');
    const recent = this.cfg.general.recent || [];
    const fill = () => {
      let list = this.apps.filter(a => (category === 'all' || a.categories.includes(category))
        && (!query || a.name.toLowerCase().includes(query) || a.comment.toLowerCase().includes(query)));
      if (st.sort === 'recent') list = [...list].sort((a, b) => rank(recent, a.id) - rank(recent, b.id));
      grid.replaceChildren(...list.map(a => this.appButton(a, { label: st.labels, star: true, row: st.layout === 'list' })));
      if (!list.length) grid.innerHTML = `<div class="empty">${this.apps.length ? 'No apps match' : 'Loading apps…'}</div>`;
      return list;
    };
    if (st.search) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'app-search';
      search.placeholder = 'Search apps';
      search.setAttribute('aria-label', 'Search apps');
      let current = [];
      search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); current = fill(); });
      search.addEventListener('keydown', e => { if (e.key === 'Enter' && current[0]) this.launch(current[0].id); });
      el.appendChild(search);
    }
    if (st.categories) {
      const present = new Set(this.apps.flatMap(a => a.categories));
      const tabs = div('app-cats');
      tabs.setAttribute('role', 'tablist');
      for (const [key, label] of Object.entries(APP_CATEGORIES)) {
        if (key !== 'all' && !present.has(key)) continue;
        const t = document.createElement('button');
        t.className = 'app-cat' + (key === category ? ' on' : '');
        t.textContent = label;
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(key === category));
        t.addEventListener('click', () => {
          category = key;
          tabs.querySelectorAll('.app-cat').forEach(n => { n.classList.toggle('on', n === t); n.setAttribute('aria-selected', String(n === t)); });
          fill();
        });
        tabs.appendChild(t);
      }
      el.appendChild(tabs);
    }
    el.appendChild(grid);
    fill();
    return el;
  }

  favoritesBody(w) {
    const el = div('widget-body favorites');
    el.setAttribute('role', 'list');
    const picked = this.pinnedApps(w.settings.apps);
    if (!picked.length) el.innerHTML = `<div class="empty">${this.editMode ? 'Choose apps in Aerie Studio' : 'Star apps in the launcher to pin them here'}</div>`;
    else el.replaceChildren(...picked.map(a => this.appButton(a, { label: w.settings.labels })));
    return el;
  }

  dockBody(w) {
    const st = w.settings;
    const el = div('widget-body dock');
    el.style.setProperty('--dock-icon', st.iconSize + 'px');
    el.setAttribute('role', 'list');
    const picked = this.pinnedApps(st.apps, true);
    const items = picked.map(a => this.appButton(a, { label: false, tip: true }));
    if (st.drawerButton) {
      const b = document.createElement('button');
      b.className = 'app drawer-btn';
      b.setAttribute('aria-label', 'All apps');
      b.title = 'All apps';
      b.innerHTML = `<span class="drawer-ico">${svg('grid')}</span>`;
      b.addEventListener('click', () => { if (!this.editMode) this.cb.onOpenDrawer?.(); });
      if (items.length) items.push(div('dock-sep'));
      items.push(b);
    }
    if (!picked.length && !st.drawerButton) el.innerHTML = '<div class="empty">Star apps in the launcher to pin them</div>';
    else el.replaceChildren(...items);
    if (st.magnify) {
      el.addEventListener('pointermove', e => {
        if (this.editMode) return;
        for (const b of el.querySelectorAll('.app')) {
          const r = b.getBoundingClientRect();
          const d = Math.abs(e.clientX - (r.left + r.width / 2));
          b.style.setProperty('--mag', (1 + Math.max(0, 1 - d / 140) * 0.45).toFixed(3));
        }
      });
      el.addEventListener('pointerleave', () => el.querySelectorAll('.app').forEach(b => b.style.setProperty('--mag', 1)));
    }
    return el;
  }

  searchBody(w) {
    const el = div('widget-body search');
    const box = div('search-box');
    box.innerHTML = svg('search');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = w.settings.placeholder || 'Search apps…';
    input.setAttribute('aria-label', 'Search apps');
    const results = div('search-results');
    results.setAttribute('role', 'listbox');
    let list = [];
    const show = () => {
      const q = input.value.trim().toLowerCase();
      list = q ? this.apps.filter(a => a.name.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q)).slice(0, 6) : [];
      results.replaceChildren(...list.map(a => this.appButton(a, { label: true, row: true })));
      if (q && w.settings.web === 'duckduckgo') {
        const web = document.createElement('button');
        web.className = 'app row web-search';
        web.textContent = `Search the web for “${input.value.trim()}”`;
        web.addEventListener('click', () => window.open('https://duckduckgo.com/?q=' + encodeURIComponent(input.value.trim()), '_blank', 'noopener'));
        results.appendChild(web);
      }
      results.hidden = !results.children.length;
    };
    input.addEventListener('input', show);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && list[0]) { this.launch(list[0].id); input.value = ''; show(); }
      if (e.key === 'Escape') { input.value = ''; show(); }
    });
    results.hidden = true;
    box.appendChild(input);
    el.append(box, results);
    return el;
  }

  appButton(app, { label = true, star = false, row = false, tip = false } = {}) {
    const b = document.createElement('button');
    b.className = 'app' + (row ? ' row' : '');
    b.setAttribute('role', 'listitem');
    b.title = app.comment || app.name;
    b.setAttribute('aria-label', `Open ${app.name}`);
    const icon = document.createElement(app.hasIcon ? 'img' : 'span');
    if (app.hasIcon) {
      icon.src = '/icon/' + encodeURIComponent(app.id);
      icon.alt = '';
      icon.loading = 'lazy';
      icon.draggable = false;
    } else {
      icon.className = 'app-fallback';
      icon.textContent = app.name.slice(0, 1);
      icon.setAttribute('aria-hidden', 'true');
    }
    b.appendChild(icon);
    if (label) b.appendChild(span('app-name', app.name));
    if (tip) b.appendChild(span('app-tip', app.name));
    if (star) {
      const pinned = (this.cfg.general.pinned || []).includes(app.id);
      const s = document.createElement('span');
      s.className = 'app-star' + (pinned ? ' on' : '');
      s.setAttribute('role', 'button');
      s.setAttribute('aria-label', pinned ? `Unpin ${app.name}` : `Pin ${app.name} to the dock`);
      s.title = pinned ? 'Unpin' : 'Pin to dock';
      s.innerHTML = svg('star');
      s.addEventListener('click', e => { e.stopPropagation(); if (!this.editMode) this.cb.onTogglePin?.(app.id); });
      b.appendChild(s);
    }
    b.addEventListener('click', () => { if (!this.editMode) this.launch(app.id, b); });
    return b;
  }

  async launch(id, button) {
    button?.classList.add('launching');
    setTimeout(() => button?.classList.remove('launching'), 700);
    const res = await api.launch(id);
    if (!res.ok) this.cb.onLaunchError?.('Could not open that app');
    else this.cb.onLaunched?.(id);
  }

  // ---- to-do, timer, player ------------------------------------------------
  todoBody(w) {
    const st = w.settings;
    const el = div('widget-body todo');
    el.appendChild(div('todo-title', st.title || 'To do'));
    const ul = document.createElement('ul');
    ul.className = 'todo-list';
    const save = items => this.cb.onChange?.(w.id, { settings: { ...w.settings, items } }, { silent: true });
    const draw = () => {
      ul.replaceChildren(...st.items.map(item => {
        const li = document.createElement('li');
        li.className = item.done ? 'done' : '';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = item.done;
        box.setAttribute('aria-label', item.text);
        box.addEventListener('change', () => { item.done = box.checked; li.className = item.done ? 'done' : ''; save(st.items); });
        const del = document.createElement('button');
        del.className = 'todo-del';
        del.setAttribute('aria-label', `Remove ${item.text}`);
        del.innerHTML = svg('x');
        del.addEventListener('click', () => { st.items = st.items.filter(i => i !== item); save(st.items); draw(); });
        li.append(box, span('todo-text', item.text), del);
        return li;
      }));
    };
    const add = document.createElement('input');
    add.className = 'todo-add';
    add.placeholder = 'Add a task and press Enter';
    add.setAttribute('aria-label', 'New task');
    add.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      st.items = [...st.items, { id: Math.random().toString(36).slice(2, 8), text: add.value.trim(), done: false }];
      add.value = '';
      save(st.items);
      draw();
    });
    draw();
    el.append(ul, add);
    return el;
  }

  timerBody(w) {
    const st = w.settings;
    if (!this.timers.has(w.id)) this.timers.set(w.id, { phase: 'focus', total: st.minutes * 60, left: st.minutes * 60, running: false });
    const el = div('widget-body timer');
    el.innerHTML = `
      <div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fg" cx="50" cy="50" r="44" pathLength="100"/></svg>
      <div class="ring-text"><div class="t-left" aria-live="polite"></div><div class="t-phase"></div></div></div>
      <div class="t-buttons"><button class="t-go" aria-label="Start"></button><button class="t-reset" aria-label="Reset">${svg('reset')}</button></div>`;
    el.querySelector('.t-go').addEventListener('click', () => {
      const t = this.timers.get(w.id);
      t.running = !t.running;
      this.updateDynamic(this.nodes.get(w.id), w);
    });
    el.querySelector('.t-reset').addEventListener('click', () => {
      this.timers.set(w.id, { phase: 'focus', total: st.minutes * 60, left: st.minutes * 60, running: false });
      this.updateDynamic(this.nodes.get(w.id), w);
    });
    return el;
  }

  playerBody(w) {
    const el = div('widget-body player');
    el.innerHTML = `<div class="np-art"><img alt="" hidden><span class="np-note" aria-hidden="true">♪</span></div>
      <div class="np-info"><div class="np-title">Nothing playing</div><div class="np-artist"></div>
      <div class="np-bar"><i></i></div>
      <div class="np-buttons">
        <button data-a="previous" aria-label="Previous">${svg('prev')}</button>
        <button data-a="play-pause" class="np-play" aria-label="Play or pause">${svg('play')}</button>
        <button data-a="next" aria-label="Next">${svg('next')}</button></div></div>`;
    if (!w.settings.controls) el.querySelector('.np-buttons').remove();
    if (!w.settings.art) el.querySelector('.np-art').remove();
    el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async () => {
      if (this.editMode) return;
      await api.playerControl(b.dataset.a);
      setTimeout(() => this.pollPlayer(true), 250);
    }));
    return el;
  }

  // ---- live data ------------------------------------------------------------
  tick() {
    if (!this.cfg) return;
    for (const w of this.cfg.widgets) {
      if (w.type === 'timer') this.tickTimer(w);
      if (w.type === 'slideshow') this.tickSlides(w);
      if (['clock', 'date', 'greeting', 'worldclock', 'countdown', 'timer', 'moon', 'quote'].includes(w.type)) {
        this.updateDynamic(this.nodes.get(w.id), w);
      }
    }
  }

  tickTimer(w) {
    const t = this.timers.get(w.id);
    if (!t || !t.running) return;
    t.left -= 1;
    if (t.left > 0) return;
    this.cb.onChime?.();
    const focus = t.phase === 'focus';
    const mins = focus ? w.settings.breakMinutes : w.settings.minutes;
    Object.assign(t, { phase: focus ? 'break' : 'focus', total: mins * 60, left: mins * 60 });
    this.nodes.get(w.id)?.classList.add('flash');
    setTimeout(() => this.nodes.get(w.id)?.classList.remove('flash'), 1600);
  }

  tickSlides(w) {
    const n = w.settings.images.length;
    if (n < 2) return;
    const now = Math.floor(Date.now() / 1000);
    if (now % Math.max(3, w.settings.seconds) !== 0) return;
    const i = ((this.slides.get(w.id) || 0) + 1) % n;
    this.slides.set(w.id, i);
    this.nodes.get(w.id)?.querySelectorAll('.slide').forEach((img, k) => img.classList.toggle('on', k === i));
  }

  async pollSystem() {
    if (!this.cfg || document.hidden || !this.cfg.widgets.some(w => w.type === 'system' || w.type === 'graph')) return;
    this.system = await api.system();
    if (this.system) {
      const push = (k, v) => { this.history[k].push(v); if (this.history[k].length > 60) this.history[k].shift(); };
      push('cpu', this.system.cpu);
      push('memory', this.system.memory?.percent ?? 0);
      push('down', this.system.network?.down ?? 0);
      push('up', this.system.network?.up ?? 0);
    }
    for (const w of this.cfg.widgets) if (w.type === 'system' || w.type === 'graph') this.updateDynamic(this.nodes.get(w.id), w);
  }

  async pollPlayer(force = false) {
    if (!this.cfg || (document.hidden && !force) || !this.cfg.widgets.some(w => w.type === 'nowplaying')) return;
    this.player = await api.nowPlaying();
    for (const w of this.cfg.widgets) if (w.type === 'nowplaying') this.updateDynamic(this.nodes.get(w.id), w);
  }

  updateDynamic(node, w) {
    if (!node) return;
    const now = new Date();
    const st = w.settings;
    const q = sel => node.querySelector(sel);
    switch (w.type) {
      case 'clock': {
        if (st.analog) {
          const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
          const set = (cls, deg) => q('.' + cls)?.setAttribute('transform', `rotate(${deg} 50 50)`);
          set('h', h * 30); set('m', m * 6); set('s', s * 6);
          const sec = q('.s'); if (sec) sec.style.display = st.seconds ? '' : 'none';
        } else {
          let h = now.getHours();
          const ampm = h >= 12 ? 'PM' : 'AM';
          if (st.format === '12') h = h % 12 || 12;
          const hh = st.format === '12' ? String(h) : pad(h);
          const t = `${hh}<span class="colon">:</span>${pad(now.getMinutes())}` + (st.seconds ? `<small>:${pad(now.getSeconds())}</small>` : '');
          const el = q('.time');
          if (el && el.innerHTML !== t) el.innerHTML = t;
          const ap = q('.ampm'); if (ap) ap.textContent = st.format === '12' ? ampm : '';
        }
        break;
      }
      case 'date': {
        const el = q('.date');
        if (el) el.textContent = now.toLocaleDateString(undefined, st.long ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
        break;
      }
      case 'greeting': {
        const h = now.getHours();
        const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        const name = st.name || this.system?.user || '';
        const el = q('.greet');
        if (el) el.textContent = name ? `${part}, ${capitalize(name)}` : part;
        break;
      }
      case 'system': {
        if (!this.system) break;
        const v = {
          cpu: [this.system.cpu, `${Math.round(this.system.cpu)}%`],
          memory: this.system.memory && [this.system.memory.percent, `${gb(this.system.memory.used)} / ${gb(this.system.memory.total)}`],
          disk: this.system.disk && [this.system.disk.percent, `${Math.round(this.system.disk.percent)}%`],
          battery: this.system.battery && [this.system.battery.percent, `${this.system.battery.percent}% ${this.system.battery.status === 'Charging' ? '⚡' : ''}`],
        };
        for (const meter of node.querySelectorAll('.meter')) {
          const val = v[meter.dataset.k];
          meter.hidden = !val;
          if (!val) continue;
          meter.querySelector('b').textContent = val[1];
          meter.querySelector('i').style.width = Math.min(100, val[0]) + '%';
          meter.querySelector('.bar').setAttribute('aria-valuenow', Math.round(val[0]));
          meter.classList.toggle('hot', val[0] > 85 && meter.dataset.k !== 'battery');
          meter.classList.toggle('low', val[0] < 15 && meter.dataset.k === 'battery');
        }
        if (this.system.network && q('.down')) { q('.down').textContent = rate(this.system.network.down); q('.up').textContent = rate(this.system.network.up); }
        break;
      }
      case 'graph': this.drawGraph(node, w); break;
      case 'worldclock':
        st.zones.forEach((z, i) => {
          const row = q(`[data-i="${i}"]`);
          if (!row) return;
          try {
            row.querySelector('.zone-time').textContent = now.toLocaleTimeString(undefined, { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: st.format === '12' });
            const day = now.toLocaleDateString(undefined, { timeZone: z.tz, weekday: 'short' });
            row.querySelector('.zone-day').textContent = day;
          } catch { row.querySelector('.zone-time').textContent = '—'; }
        });
        break;
      case 'countdown': {
        const target = new Date(st.date).getTime();
        let s = Math.max(0, Math.floor((target - now.getTime()) / 1000));
        const el = q('.cd-time');
        if (!el) break;
        if (Number.isNaN(target)) { el.textContent = 'Pick a date'; break; }
        if (s === 0) { el.textContent = 'It’s here! 🎉'; break; }
        const d = Math.floor(s / 86400); s %= 86400;
        el.innerHTML = `${d ? `<span><b>${d}</b>d</span>` : ''}<span><b>${Math.floor(s / 3600)}</b>h</span><span><b>${pad(Math.floor((s % 3600) / 60))}</b>m</span><span><b>${pad(s % 60)}</b>s</span>`;
        break;
      }
      case 'timer': {
        const t = this.timers.get(w.id);
        if (!t) break;
        q('.t-left').textContent = `${Math.floor(t.left / 60)}:${pad(t.left % 60)}`;
        q('.t-phase').textContent = t.phase === 'focus' ? 'Focus' : 'Break';
        q('.ring-fg').style.strokeDashoffset = (100 - (t.left / t.total) * 100).toFixed(2);
        const go = q('.t-go');
        go.innerHTML = svg(t.running ? 'pause' : 'play');
        go.setAttribute('aria-label', t.running ? 'Pause' : 'Start');
        node.classList.toggle('break', t.phase === 'break');
        break;
      }
      case 'nowplaying': {
        const p = this.player;
        const title = q('.np-title'), artist = q('.np-artist');
        if (!p || !p.available) { title.textContent = 'Now playing'; artist.textContent = 'No music player found'; break; }
        if (!p.active) { title.textContent = 'Nothing playing'; artist.textContent = 'Play something in Spotify, a browser or any player'; break; }
        title.textContent = p.title;
        artist.textContent = [p.artist, p.player].filter(Boolean).join(' · ');
        const play = q('.np-play'); if (play) play.innerHTML = svg(p.playing ? 'pause' : 'play');
        const bar = q('.np-bar i'); if (bar) bar.style.width = p.length ? `${Math.min(100, (p.position / p.length) * 100)}%` : '0%';
        const img = q('.np-art img');
        if (img) {
          const key = p.hasArt ? `${p.title}|${p.artist}` : '';
          if (img.dataset.key !== key) {
            img.dataset.key = key;
            img.hidden = !p.hasArt;
            if (p.hasArt) img.src = '/now-playing-art?k=' + encodeURIComponent(key);
          }
        }
        node.classList.toggle('playing', !!p.playing);
        break;
      }
      case 'moon': {
        const { phase, illum, name } = moonPhase(now);
        q('.moon-lit')?.setAttribute('d', moonPath(phase));
        if (q('.moon-name')) q('.moon-name').textContent = name;
        if (q('.moon-pct')) q('.moon-pct').textContent = `${Math.round(illum * 100)}% lit`;
        break;
      }
      case 'quote': {
        let text = st.text, by = st.author;
        if (st.source !== 'custom' || !text) {
          const slot = Math.floor(now.getTime() / 60000 / Math.max(1, st.minutes));
          text = QUOTES[slot % QUOTES.length]; by = '';
        }
        const el = q('.quote-text');
        if (el && el.textContent !== text) { el.textContent = text; q('.quote-by').textContent = by ? `— ${by}` : ''; }
        break;
      }
    }
  }

  drawGraph(node, w) {
    const canvas = node.querySelector('canvas.graph');
    if (!canvas) return;
    const metric = w.settings.metric;
    const series = metric === 'network' ? [this.history.down, this.history.up] : [this.history[metric]];
    const val = node.querySelector('.graph-val');
    const last = arr => arr[arr.length - 1] ?? 0;
    if (val) val.textContent = metric === 'network' ? `↓ ${rate(last(this.history.down))}  ↑ ${rate(last(this.history.up))}` : `${Math.round(last(series[0]))}%`;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const accent = getComputedStyle(node).getPropertyValue('--w-accent').trim() || '#ff9e3d';
    const max = metric === 'network' ? Math.max(1024, ...series.flat()) : 100;
    series.forEach((data, si) => {
      if (data.length < 2) return;
      const pts = data.map((v, i) => [(i / 59) * W + (W - ((data.length - 1) / 59) * W), H - 4 - (v / max) * (H - 10)]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = si ? 'rgba(255,255,255,.55)' : accent;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.stroke();
      if (si === 0) {
        g.lineTo(pts[pts.length - 1][0], H); g.lineTo(pts[0][0], H); g.closePath();
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, accent + '55'); grad.addColorStop(1, accent + '00');
        g.fillStyle = grad;
        g.fill();
      }
    });
  }

  // ---- edit-mode dragging and hover tilt ----------------------------------------
  bindNode(node) {
    node.addEventListener('pointermove', e => {
      if (this.editMode || !this.cfg?.theme.tilt) return;
      const r = node.getBoundingClientRect();
      const amt = this.cfg.theme.tiltAmount;
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      node.style.setProperty('--rx', `${(-fy + 0.5) * amt}deg`);
      node.style.setProperty('--ry', `${(fx - 0.5) * amt}deg`);
      node.style.setProperty('--gx', `${(fx * 100).toFixed(1)}%`);
      node.style.setProperty('--gy', `${(fy * 100).toFixed(1)}%`);
      node.classList.add('tilting');
    });
    node.addEventListener('pointerleave', () => {
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
      node.classList.remove('tilting');
    });
    node.addEventListener('pointerdown', e => {
      // In the editor or "Move widgets" mode, or anytime with Alt held down: drag to move.
      if (e.button !== 0 || !(this.editMode || e.altKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = node.dataset.id;
      if (this.editMode) this.cb.onSelect?.(id);
      const w = this.cfg.widgets.find(x => x.id === id);
      const resizing = this.editMode && e.target.classList.contains('resize-handle');
      node.classList.add('dragging');
      const start = { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, ww: w.w, wh: w.h };
      node.setPointerCapture(e.pointerId);
      const move = ev => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (resizing) {
          node.style.width = Math.max(80, start.ww + dx) + 'px';
          node.style.height = Math.max(40, start.wh + dy) + 'px';
        } else {
          node.style.left = snap(clamp(start.wx + (dx / innerWidth) * 100, -5, 98), ev.shiftKey) + '%';
          node.style.top = snap(clamp(start.wy + (dy / innerHeight) * 100, -5, 98), ev.shiftKey) + '%';
        }
      };
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        node.classList.remove('dragging');
        const patch = resizing
          ? { w: Math.round(parseFloat(node.style.width)), h: Math.round(parseFloat(node.style.height)) }
          : { x: round1(parseFloat(node.style.left)), y: round1(parseFloat(node.style.top)) };
        this.cb.onChange?.(id, patch);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  }
}

// ---- helpers -------------------------------------------------------------------
function calendar(weekStart = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() - weekStart + 7) % 7;
  const wrap = div('calendar');
  const head = div('cal-title', now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  const grid = div('cal-grid');
  grid.setAttribute('role', 'grid');
  for (let i = 0; i < 7; i++) grid.appendChild(span('dow', DAYS[(i + weekStart) % 7].slice(0, 2)));
  for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('span'));
  for (let d = 1; d <= days; d++) {
    const c = span('', String(d));
    if (d === now.getDate()) { c.className = 'today'; c.setAttribute('aria-current', 'date'); }
    grid.appendChild(c);
  }
  wrap.append(head, grid);
  return wrap;
}

/** Moon phase from the mean synodic month, counted from a known new moon (Jan 6, 2000). */
function moonPhase(date) {
  const synodic = 29.530588853;
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic / synodic; // 0 new → 0.5 full → 1 new
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { phase, illum, name: names[Math.round(phase * 8) % 8] };
}

/** SVG path of the lit part of the moon for a phase 0..1. */
function moonPath(phase) {
  const r = 40, cx = 50, cy = 50;
  const k = Math.cos(phase * 2 * Math.PI);            // terminator ellipse width factor
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const outer = waxing ? 1 : 0;                       // which half of the disc is lit
  const inner = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0); // which way the shadow edge bulges
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${inner} ${cx} ${cy - r} Z`;
}

function ticks() {
  let s = '';
  for (let i = 0; i < 12; i++) s += `<line class="tick" x1="50" y1="8" x2="50" y2="${i % 3 ? 12 : 15}" transform="rotate(${i * 30} 50 50)"/>`;
  return s;
}

function labelFor(w) {
  const names = { clock: 'Clock', date: 'Date', greeting: 'Greeting', system: 'System monitor', apps: 'App launcher', favorites: 'Favorite apps', notes: 'Notes', calendar: 'Calendar', text: 'Text', image: w.settings?.alt || 'Image', dock: 'Dock', search: 'Search', links: 'Quick links', worldclock: 'World clocks', countdown: 'Countdown', timer: 'Focus timer', graph: 'Live graph', nowplaying: 'Now playing', moon: 'Moon phase', todo: 'To-do list', quote: 'Quote', slideshow: 'Photo slideshow' };
  return names[w.type] || 'Widget';
}

function div(cls, text) { const d = document.createElement('div'); if (cls) d.className = cls; if (text !== undefined) d.textContent = text; return d; }
function span(cls, text) { const d = document.createElement('span'); if (cls) d.className = cls; if (text !== undefined) d.textContent = text; return d; }
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rank = (list, id) => { const i = list.indexOf(id); return i < 0 ? 999 : i; };
const pad = n => String(n).padStart(2, '0');
const gb = b => (b / 1073741824).toFixed(1) + ' GB';
const rate = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : b > 1024 ? Math.round(b / 1024) + ' KB/s' : b + ' B/s';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snap = (v, on) => (on ? Math.round(v / 2) * 2 : v);
const round1 = v => Math.round(v * 10) / 10;
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
