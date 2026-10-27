// Right-click the desktop for quick actions, without opening Aerie Studio.
// Keyboard: the menu takes focus, arrows move, Enter picks, Esc closes.
//
// Submenus use a "safe triangle": while your pointer heads diagonally from an item toward its open
// submenu, crossing other items on the way doesn't close it.
import { animate, place, SPRINGS } from './motion.js';

const sign = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
function inTriangle(p, a, b, c) {
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export class QuickMenu {
  constructor(root) {
    this.root = root;
    this.root.setAttribute('role', 'menu');
    this.root.hidden = true;
    this.openItem = null;   // the item whose submenu is showing
    this.trail = null;      // where the pointer was when it left that item
    this.wait = 0;
    addEventListener('pointerdown', e => { if (!this.root.hidden && !this.root.contains(e.target)) this.hide(); }, true);
    addEventListener('blur', () => this.hide());
    this.root.addEventListener('keydown', e => this.keys(e));
    this.root.addEventListener('pointermove', e => this.track(e));
  }

  /** items: [{label, hint?, run?, items?: [...], danger?, checked?}] or '-' for a divider */
  show(x, y, items, title) {
    this.root.replaceChildren();
    this.openItem = null;
    if (title) this.root.appendChild(el('div', 'qm-title', title));
    this.fill(this.root, items);
    this.root.hidden = false;
    const r = this.root.getBoundingClientRect();
    this.root.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    this.root.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    this.root.style.transformOrigin = `${x <= innerWidth - r.width - 8 ? 'left' : 'right'} top`;
    place(this.root, { y: -6, scale: 0.97, opacity: 0 });
    animate(this.root, { y: 0, scale: 1, opacity: 1 }, { config: SPRINGS.snappy });
    this.root.querySelector('button')?.focus();
  }

  fill(box, items) {
    for (const item of items) {
      if (item === '-') { box.appendChild(el('div', 'qm-sep')); continue; }
      const b = el('button', 'qm-item' + (item.danger ? ' danger' : '') + (item.items ? ' has-sub' : ''));
      b.type = 'button';
      b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (item.checked !== undefined) b.setAttribute('aria-checked', String(!!item.checked));
      b.append(el('span', 'qm-label', item.label));
      if (item.hint) b.append(el('kbd', 'qm-hint', item.hint));
      if (item.items) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        const sub = el('div', 'qm-sub');
        sub.setAttribute('role', 'menu');
        this.fill(sub, item.items);
        b.appendChild(sub);
        b.addEventListener('click', e => { if (e.target === b || b.firstChild.contains(e.target)) this.toggleSub(b); });
      } else {
        b.addEventListener('click', e => { e.stopPropagation(); this.hide(); item.run?.(); });
      }
      box.appendChild(b);
    }
  }

  openSub(b) {
    if (this.openItem === b) return;
    this.closeSub();
    this.openItem = b;
    b.classList.add('open');
    b.setAttribute('aria-expanded', 'true');
    const sub = b.querySelector(':scope > .qm-sub');
    sub.classList.remove('left');
    if (sub.getBoundingClientRect().right > innerWidth - 8) sub.classList.add('left');
    place(sub, { x: sub.classList.contains('left') ? 6 : -6, opacity: 0 });
    animate(sub, { x: 0, opacity: 1 }, { config: SPRINGS.snappy });
  }

  closeSub() {
    clearTimeout(this.wait);
    const b = this.openItem;
    if (!b) return;
    this.openItem = null;
    b.classList.remove('open');
    b.setAttribute('aria-expanded', 'false');
  }

  toggleSub(b) { if (this.openItem === b) this.closeSub(); else this.openSub(b); }

  track(e, settled = false) {
    const p = { x: e.clientX, y: e.clientY };
    this.last = p;
    const item = e.target?.closest?.('.qm-item');
    const open = this.openItem;
    if (!item) return;
    if (open && (item === open || open.contains(item))) { this.trail = p; clearTimeout(this.wait); return; }
    if (!settled && open && item.parentElement === open.parentElement && this.trail && this.towardSub(p)) {
      // heading for the open submenu: give the pointer a moment to get there
      clearTimeout(this.wait);
      this.wait = setTimeout(() => {
        // after the pause, act on wherever the pointer is now
        const { x, y } = this.last;
        this.track({ clientX: x, clientY: y, target: document.elementFromPoint(x, y) }, true);
      }, 150);
      this.trail = p;
      return;
    }
    if (item.parentElement !== this.root && !item.closest('.qm-sub')) return;
    if (open && item.parentElement === open.parentElement) this.closeSub();
    if (item.classList.contains('has-sub') && item.parentElement === this.root) this.openSub(item);
    this.trail = p;
  }

  towardSub(p) {
    const sub = this.openItem?.querySelector(':scope > .qm-sub');
    if (!sub) return false;
    const r = sub.getBoundingClientRect();
    const x = sub.classList.contains('left') ? r.right : r.left;
    return inTriangle(p, this.trail, { x, y: r.top - 8 }, { x, y: r.bottom + 8 });
  }

  keys(e) {
    const buttons = [...this.root.querySelectorAll('button')].filter(b => b.offsetParent);
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); this.hide(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) {
      e.preventDefault();
      this.openSub(document.activeElement);
      document.activeElement.querySelector('.qm-sub button')?.focus();
    } else if (e.key === 'ArrowLeft') {
      const parent = document.activeElement?.closest('.has-sub.open');
      if (parent) { e.preventDefault(); this.closeSub(); parent.focus(); }
    }
  }

  hide() { this.closeSub(); this.root.hidden = true; }
  get open() { return !this.root.hidden; }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
