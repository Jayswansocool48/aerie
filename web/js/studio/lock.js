// Studio → Lock screen: your live wallpaper on the lock screen (optional; it changes a system file).
import { api } from '../config.js';
import { h, icon } from '../icons.js';
import { toast } from '../toast.js';
import { notice, row, section, slider, pct, toggle } from './forms.js';
import { changed, S } from './state.js';

export async function lockPage(pageEl) {
  const st = await api.lockStatus();
  const opts = S.cfg.general.lockScreen;
  const c = () => changed();
  const sw = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!st.enabled, 'aria-label': 'Use Aerie as my lock screen' });
  sw.addEventListener('change', async () => {
    sw.disabled = true;
    if (sw.checked) toast('Asking for your password to install the lock screen switch…');
    try {
      const res = await api.setLockEnabled(sw.checked);
      toast(res.message);
      if (!res.ok) sw.checked = !sw.checked;
    } catch (e) { toast(e.message); sw.checked = !sw.checked; }
    window.studio.go('lock');
  });
  pageEl.append(h('div.big-toggle', { 'data-sq': 14 }, h('div.ico', { html: icon('lock') }),
    h('div', {}, h('h3', {}, 'Use Aerie as my lock screen'), h('p', {}, st.enabled ? 'On. Your live wallpaper shows when you lock the computer.' : 'Off. You get COSMIC\'s own lock screen.')), sw));
  if (!st.installed) pageEl.append(notice('warn', 'Install Aerie first', 'The lock screen only works when Aerie is installed (not when it runs from its source folder).'));
  if (st.fellBack) pageEl.append(notice('warn', 'COSMIC\'s lock screen took over', 'Aerie\'s lock screen stopped working several times in a row, so COSMIC\'s own one is used until you log in again. Run "aerie-lock --preview" in a terminal to see what went wrong, or check ~/.cache/aerie-lock.log.'));
  pageEl.append(h('div.acts', {},
    h('button.btn', { onclick: async () => { const r = await api.previewLock(); toast(r.ok ? 'Showing a preview (press Esc to close it)' : 'Could not open the preview'); } }, h('span', { html: icon('eye') }), 'Try it (no locking)'),
    h('button.btn', { onclick: () => api.lockNow() }, h('span', { html: icon('lock') }), 'Lock now')));
  pageEl.append(section('What it shows', '表示',
    row('Clock', '', toggle(opts, 'clock', c, 'Clock')),
    row('Date', '', toggle(opts, 'date', c, 'Date')),
    row('What\'s playing', 'Title, artist and play/pause', toggle(opts, 'media', c, 'What\'s playing')),
    row('Battery', 'On laptops', toggle(opts, 'battery', c, 'Battery')),
    row('Sleep and power buttons', '', toggle(opts, 'power', c, 'Sleep and power buttons')),
    slider(opts, 'dim', { min: 0, max: 0.8, step: 0.05, fmt: pct, onInput: c, label: 'Darken the wallpaper', hint: 'easier to read the clock' }),
    slider(opts, 'blur', { min: 0, max: 30, step: 1, fmt: v => v + ' px', onInput: c, label: 'Blur the wallpaper' }),
    row('Message', 'Under the clock (optional)', h('input.input', { value: opts.message || '', maxlength: 120, onchange: e => { opts.message = e.target.value; c(); } }))));
  pageEl.append(section('How it works', '仕組み',
    h('ul.plain', {},
      h('li', {}, 'COSMIC starts its lock screen program in every session. Turning this on sets that program aside (with dpkg-divert, so COSMIC updates keep working) and puts a small switch in its place. You confirm this once with your password.'),
      h('li', {}, 'The switch starts Aerie\'s lock screen only for people who turned it on. Everyone else, and the login screen, get COSMIC\'s own lock screen as before.'),
      h('li', {}, 'Your password is checked by the system (PAM), the same way as at login. Aerie never stores it.'),
      h('li', {}, 'If Aerie\'s lock screen crashes, the screen stays locked and it restarts. After 3 failures COSMIC\'s own lock screen takes over.'),
      h('li', {}, 'Web wallpapers show their own page behind the lock screen; everything else plays just like on your desktop.'),
      h('li', {}, 'Turning it off brings COSMIC\'s lock screen back right away. Uninstalling Aerie removes the switch.')),
    st.switch ? h('div', {}, h('button.btn.danger', { onclick: async () => { const r = await api.removeLockSwitch(); toast(r.message); window.studio.go('lock'); } }, 'Remove the system switch completely')) : ''));
}
