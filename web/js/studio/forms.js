// Small building blocks for Studio's pages: sections, rows, switches, sliders, segmented
// buttons, filter chips and the property form used by Wallpaper Engine, Lively and shaders.
import { h, icon } from '../icons.js';
import { animate, place, SPRINGS } from '../motion.js';

export function section(title, kana, ...kids) {
  return h('section.st-section', {}, h('h2', {}, title, kana ? h('span.kana', {}, kana) : ''), ...kids);
}

export function row(label, hint, control) {
  return h('label.rowf', {}, h('div', {}, h('b', {}, label), hint ? h('small', {}, hint) : ''), control);
}

export function notice(kind, title, text, ...actions) {
  const ico = { info: 'info', warn: 'warning', good: 'check', steam: 'steam', cube: 'cube', online: 'globe' }[kind] || 'info';
  return h('div.notice.' + kind, { 'data-sq': 12 }, h('span', { html: icon(ico) }),
    h('div', {}, title ? h('h3', {}, title) : '', h('p', {}, text), actions.length ? h('div.acts', {}, ...actions) : ''));
}

export function toggle(obj, key, onChange, label) {
  return h('input.switch', { type: 'checkbox', role: 'switch', checked: !!obj[key], 'aria-label': label || null,
    onchange: e => { obj[key] = e.target.checked; onChange?.(e.target.checked); } });
}

/** A labelled slider with its value in mono on the right (pattern from halaska-studio's Slider). */
export function slider(obj, key, { min = 0, max = 1, step = 0.01, fmt = v => v, onInput, label, hint } = {}) {
  const out = h('output', {}, fmt(Number(obj[key] ?? min)));
  const input = h('input.slider', { type: 'range', min, max, step, value: obj[key] ?? min, 'aria-label': label || null });
  const fill = () => {
    input.style.setProperty('--fill', ((input.value - min) / (max - min) * 100) + '%');
    out.textContent = fmt(+input.value);
  };
  fill();
  input.addEventListener('input', () => { obj[key] = +input.value; fill(); onInput?.(+input.value); });
  if (!label) return h('span.inline-range', {}, input, out);
  return h('div.field-range', {}, h('div.top', {}, h('span', {}, label, hint ? h('small', {}, ' · ' + hint) : ''), out), input);
}

export function seg(obj, key, options, onChange, label) {
  const box = h('div.seg', { role: 'group', 'aria-label': label || null });
  const paint = () => box.replaceChildren(...Object.entries(options).map(([v, text]) => h('button', {
    type: 'button', 'aria-pressed': String(String(obj[key]) === v),
    onclick: e => { e.preventDefault(); obj[key] = typeof obj[key] === 'number' ? +v : v; paint(); onChange?.(obj[key]); },
  }, text)));
  paint();
  return box;
}

export function select(obj, key, options, onChange, label) {
  return h('select.input', { 'aria-label': label || null, onchange: e => { obj[key] = typeof obj[key] === 'number' ? +e.target.value : e.target.value; onChange?.(obj[key]); } },
    ...Object.entries(options).map(([v, t]) => h('option', { value: v, selected: String(obj[key]) === v }, t)));
}

export function color(obj, key, onInput, fallback = '#ffffff', label) {
  return h('input', { type: 'color', value: obj[key] || fallback, 'aria-label': label || null, oninput: e => { obj[key] = e.target.value; onInput?.(); } });
}

export function text(obj, key, { placeholder = '', onChange, max = 200, label } = {}) {
  return h('input.input', { value: obj[key] ?? '', placeholder, maxlength: max, 'aria-label': label || null,
    onchange: e => { obj[key] = e.target.value; onChange?.(e.target.value); } });
}

/**
 * Filter chips with live counts, a radio group you move through with the arrow keys
 * (adapted from ddoemonn's Filter Grid on 21st.dev).
 * filters: [{id, label, match(item)}]
 */
export function filterChips(filters, items, active, onSelect, label) {
  const box = h('div.filter', { role: 'radiogroup', 'aria-label': label });
  const chips = filters.map((f, i) => {
    const count = items.filter(f.match).length;
    const on = f.id === active;
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(on), tabIndex: on ? 0 : -1, 'data-id': f.id,
      onclick: () => onSelect(f.id),
      onkeydown: e => {
        const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = move ? (i + move + filters.length) % filters.length : e.key === 'Home' ? 0 : e.key === 'End' ? filters.length - 1 : null;
        if (to === null) return;
        e.preventDefault();
        onSelect(filters[to].id);
        requestAnimationFrame(() => box.querySelector(`[data-id="${filters[to].id}"]`)?.focus());
      },
    }, h('span', {}, f.label, h('span.count', {}, String(count))), h('span.sr', {}, `, ${count} of ${items.length}`));
  });
  box.append(...chips);
  return box;
}

/** Grid cells spring in when a filter changes (layout stays put; only new cells move). */
export function springIn(nodes) {
  nodes.forEach((n, i) => {
    if (i > 24) return;
    place(n, { y: 8, opacity: 0, scale: 0.98 });
    setTimeout(() => animate(n, { y: 0, opacity: 1, scale: 1 }, { config: SPRINGS.snappy }), i * 14);
  });
}

/** Wallpaper Engine / Lively / shader settings as controls, respecting their show-if conditions. */
export function propRows(props, values, onChange) {
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
  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(onChange, 120); };
  return Object.entries(props).filter(([, p]) => p.type !== 'group' && visible(p)).map(([k, p]) => {
    const set = v => { values[k] = v; onChange(); };
    if (p.type === 'slider') {
      const o = { v: +value(k) };
      const step = p.step || (p.max - p.min) / 100 || 0.01;
      return slider(o, 'v', { min: p.min, max: p.max, step, label: p.label, fmt: v => (step < 1 ? (+v).toFixed(2) : v),
        onInput: v => { values[k] = v; later(); } });
    }
    let control;
    if (p.type === 'bool') control = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!value(k), onchange: e => set(e.target.checked) });
    else if (p.type === 'combo') {
      control = h('select.input', { onchange: e => set(p.options.find(x => String(x.value) === e.target.value)?.value) },
        ...(p.options || []).map(o => h('option', { value: String(o.value), selected: String(o.value) === String(value(k)) }, o.label)));
    } else if (p.type === 'color') {
      control = h('input', { type: 'color', value: weToHex(value(k)), oninput: e => { values[k] = (p.lively || p.uniform) ? e.target.value : hexToWe(e.target.value); later(); } });
    } else control = h('input.input', { value: value(k) ?? '', onchange: e => set(e.target.value) });
    return row(p.label, '', control);
  });
}

export const weToHex = v => {
  if (typeof v === 'string' && v.startsWith('#')) return v;
  const parts = String(v || '1 1 1').split(/\s+/).map(Number);
  return '#' + parts.slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x || 0)) * 255).toString(16).padStart(2, '0')).join('');
};
export const hexToWe = hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

export const pct = v => Math.round(v * 100) + '%';
export const times = v => (+v).toFixed(2).replace(/\.?0+$/, '') + '×';
