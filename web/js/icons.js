// Small line icons (24×24, drawn here, no icon font) used by the hub and Aerie Studio.
const P = {
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  wifiOff: 'M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.6M14 10a10 10 0 0 1 5 2.5M2 9a15 15 0 0 1 4.5-2.9M10.7 5.1A15 15 0 0 1 22 9M12 19.5h.01',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  bellOff: 'M3 3l18 18M6 16V11a6 6 0 0 1 1.2-3.6M10 4.3A6 6 0 0 1 18 11v4M4 18h14M10 21h4',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  next: 'M5 4l10 8-10 8zM18 4v16',
  prev: 'M19 4L9 12l10 8zM6 4v16',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5zM14 3h4l-4 4h4',
  restart: 'M4 4v6h6M20 12a8 8 0 0 1-14.6 4.5M4.3 10A8 8 0 0 1 20 9',
  power: 'M12 2v10M5.6 6.6a9 9 0 1 0 12.8 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pin: 'M15 3l6 6-4 1-4 4 1 5-2 2-4-5-5 5M10 10l-4-1 2-2',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  text: 'M5 6h14M5 11h14M5 16h9',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3',
  chip: 'M4 7h16v10H4zM8 17v3M16 17v3M8 4v3M16 4v3',
  memory: 'M3 8h18v8H3zM7 8v8M11 8v8M15 8v8M19 16v3M5 16v3',
  down: 'M12 4v14M6 12l6 6 6-6',
  up: 'M12 20V6M6 12l6-6 6 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  calendar: 'M4 6h16v15H4zM4 10h16M9 3v5M15 3v5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  wallpaper: 'M3 5h18v14H3zM3 15l5-4 4 3 4-4 5 5',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  folder: 'M3 6h6l2 2h10v11H3z',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  steam: 'M12 3a9 9 0 0 0-8.9 7.7l4.8 2a2.6 2.6 0 0 1 1.6-.4l2.2-3.2a3.5 3.5 0 1 1 3.5 3.5l-3.2 2.3a2.6 2.6 0 0 1-5.2.4L3.4 13.8A9 9 0 1 0 12 3z',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z',
  sparkle: 'M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  widgets: 'M4 4h9v6H4zM15 4h5v6h-5zM4 12h5v8H4zM11 12h9v8h-9z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  arrowLeft: 'M15 5l-7 7 7 7',
  arrowRight: 'M9 5l7 7-7 7',
  heart: 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z',
  thermo: 'M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0zM12 9v7',
  timer: 'M12 6a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM12 10v4l2.5 1.5M9.5 2h5',
  disk: 'M4 5h16v14H4zM4 14h16M8 17h.01',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};

export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.info}"/></svg>`;
}

/** A DOM helper: h('div.card', {onclick}, 'text', child…) */
export function h(tag, attrs = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export function fmtBytes(n) {
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function fmtRate(n) { return n == null ? '–' : fmtBytes(n) + '/s'; }

export function fmtUptime(s) {
  const d = Math.floor(s / 86400), hh = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`;
}
