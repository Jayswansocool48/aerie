// Toasts: short notes at the bottom of the screen. A toast for something you deleted carries an
// Undo button; the delete only happens for real once the toast goes away.
import { animate, place, SPRINGS } from './motion.js';
import { h } from './icons.js';

let box = null;
let current = null;

function container() {
  if (!box) {
    box = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  return box;
}

/**
 * toast('Saved') or toast('Removed "Rain"', { undo: () => …, commit: () => … }).
 * With undo, `commit` runs when the toast leaves without you pressing Undo.
 */
export function toast(message, { undo, commit, ms } = {}) {
  if (current) current.dismiss(true);
  const el = h('div.toast', {}, h('span', {}, message));
  let done = false, timer = 0;
  const dismiss = async (fast = false) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (current?.el === el) current = null;
    if (commit) Promise.resolve().then(commit).catch(() => null);
    if (fast) { el.remove(); return; }
    await animate(el, { y: 24, opacity: 0, scale: 0.96 }, { config: SPRINGS.snappy });
    el.remove();
  };
  if (undo) {
    el.append(h('button.toast-undo', {
      type: 'button', 'aria-keyshortcuts': 'Control+Z',
      onclick: () => { commit = null; undo(); dismiss(); },
    }, 'Undo', h('kbd', {}, 'Ctrl+Z')));
  }
  container().append(el);
  place(el, { y: 28, opacity: 0, scale: 0.96 });
  animate(el, { y: 0, opacity: 1, scale: 1 }, { config: SPRINGS.gentle });
  timer = setTimeout(() => dismiss(), ms || (undo ? 6000 : 3200));
  current = { el, dismiss, undo: undo ? () => el.querySelector('.toast-undo')?.click() : null };
  return current;
}

// Ctrl+Z presses Undo on the visible toast
addEventListener('keydown', e => {
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && current?.undo && !e.target.closest?.('input, textarea')) {
    e.preventDefault();
    current.undo();
  }
});

// a page that closes (the hub hiding) commits any pending delete right away
addEventListener('pagehide', () => current?.dismiss(true));
export const flushToasts = () => current?.dismiss(true);
