// Continuous ("squircle") corners. A CSS border-radius is a circular arc, so the curvature jumps
// where the arc meets the straight edge. These corners follow a superellipse (|x|^4 + |y|^4 = 1)
// instead: the edge eases into the curve with no visible joint.
//
// Any element with data-sq="<radius>" gets the shape as its clip-path, plus a hairline edge, a
// focus ring and a "selected" edge drawn on the same curve (CSS outlines would follow the old arc).

const N = 4;             // superellipse exponent
const EXTENT = 1.55;     // a squircle corner starts curving earlier than a circle of the same radius
const STEPS = 10;        // points per corner

function corner(cx, cy, e, sx, sy, startAngle) {
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const th = startAngle + (i / STEPS) * (Math.PI / 2);
    const c = Math.cos(th), s = Math.sin(th);
    pts.push([cx + sx * e * Math.pow(Math.abs(c), 2 / N), cy + sy * e * Math.pow(Math.abs(s), 2 / N)]);
  }
  return pts;
}

/** The outline of a w×h squircle-cornered rectangle, as an SVG path. */
export function squirclePath(w, h, r, inset = 0) {
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const e = Math.max(0, Math.min(r * EXTENT, (x1 - x0) / 2, (y1 - y0) / 2));
  const pts = [
    ...corner(x1 - e, y0 + e, e, 1, -1, 0).reverse(),          // top right: from the top edge down
    ...corner(x1 - e, y1 - e, e, 1, 1, 0),                      // bottom right
    ...corner(x0 + e, y1 - e, e, -1, 1, 0).reverse(),           // bottom left
    ...corner(x0 + e, y0 + e, e, -1, -1, 0),                    // top left
  ];
  // clockwise from the end of the top edge; the closing Z draws the top edge itself
  return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z';
}

const svg = (w, h, d, color, width) => `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/></svg>`)}")`;

let colors = null;
function palette() {
  if (!colors) {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    colors = { edge: get('--line-2', 'rgba(255,255,255,.16)'), focus: get('--focus', '#e8a24a'), on: get('--accent', '#e8573f') };
  }
  return colors;
}

function shape(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const key = `${w}x${h}`;
  if (el._sqKey === key) return;
  el._sqKey = key;
  const r = parseFloat(el.dataset.sq) || 16;
  el.style.clipPath = `path('${squirclePath(w, h, r)}')`;
  const c = palette();
  el.style.setProperty('--sq-edge', el.dataset.sqEdge === 'none' ? 'none' : svg(w, h, squirclePath(w, h, r, 0.5), c.edge, 1));
  el.style.setProperty('--sq-focus', svg(w, h, squirclePath(w, h, r, 1.5), c.focus, 3));
  el.style.setProperty('--sq-on', svg(w, h, squirclePath(w, h, r, 1), c.on, 2));
}

let ro = null;
const seen = new WeakSet();
function watch(el) {
  if (seen.has(el)) return;
  seen.add(el);
  el.classList.add('sq');
  ro ||= new ResizeObserver(entries => { for (const e of entries) shape(e.target); });
  ro.observe(el);
}

export function installSquircles(root = document.body) {
  if (!CSS.supports?.('clip-path', "path('M0 0L1 0L1 1Z')")) return;
  document.documentElement.classList.add('squircles');
  root.querySelectorAll('[data-sq]').forEach(watch);
  new MutationObserver(list => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.dataset?.sq) watch(n);
        n.querySelectorAll?.('[data-sq]').forEach(watch);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}
