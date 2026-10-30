// Studio → Settings: how Aerie behaves, sound and online content, your library, updates,
// privacy, credits and uninstalling.
import { api, defaultConfig, normalizeConfig, STANDALONE } from '../config.js';
import { h } from '../icons.js';
import { toast } from '../toast.js';
import { notice, row, section, select, toggle } from './forms.js';
import { changed, refreshList, S, save } from './state.js';

export async function settingsPage(pageEl) {
  const g = S.cfg.general;
  const c = () => changed();
  const auto = { on: await api.autostart() };
  pageEl.append(section('Behavior', '動作',
    row('Pause the wallpaper', 'Nothing moves or redraws while paused, so games and apps get your computer\'s full speed',
      select(g, 'pauseWhen', { maximized: 'When a window is maximized', focused: 'While I use any app', never: 'Never' }, c, 'Pause the wallpaper')),
    row('Frame rate limit', '', select(g, 'fps', { 30: '30 fps (saves battery)', 60: '60 fps', 120: '120 fps', 240: '240 fps' }, c, 'Frame rate limit')),
    row('Reduce motion', 'No drifting, orbiting or swaying', select(g, 'reducedMotion', { system: 'Follow the system setting', on: 'Always', off: 'Never' }, c, 'Reduce motion')),
    row('Open all apps from a hot corner', '', select(g, 'drawerCorner', { none: 'Off', 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' }, c, 'Hot corner')),
    row('Start Aerie when I log in', '', toggle(auto, 'on', async on => { auto.on = await api.setAutostart(on).catch(() => !on); }, 'Start Aerie when I log in'))));

  const audio = await api.audio();
  pageEl.append(section('Sound reactions', '音',
    row('Let wallpapers react to music', 'Wallpapers marked "Reacts to music" listen to what your speakers play. Never the microphone; nothing is recorded or sent anywhere.',
      toggle(g, 'audioReactive', c, 'Let wallpapers react to music')),
    !audio.available ? notice('warn', 'Not available yet', audio.why || 'Sound reactions need python3-numpy and parec or pw-record.') :
      h('p.small.muted', {}, audio.running ? 'Listening now (a sound-reactive wallpaper is showing).' : 'Ready. It only listens while a sound-reactive wallpaper is showing and not paused.')));

  pageEl.append(section('Online content', 'オンライン',
    row('Search Openverse and Poly Haven', 'Used by Discover, and by the AI to find art and build 3D scenes. Off: Aerie never goes online by itself.',
      toggle(g, 'online', c, 'Online content')),
    h('p.small.muted', {}, 'What you already added keeps working offline either way.')));

  pageEl.append(section('Library', 'ライブラリ',
    row('Show wallpapers marked "Mature"', 'Wallpaper Engine wallpapers rated for adults stay hidden unless you turn this on', toggle(g, 'showMature', c, 'Show mature wallpapers')),
    row('Hidden wallpapers', 'Bring back the Workshop and Aerie wallpapers you hid', h('button.btn.small', { onclick: async () => { await api.unhideWallpapers(); await refreshList(); toast('They\'re back in your library'); } }, 'Show them again')),
    row('Cached files', 'Extracted Wallpaper Engine scenes and search thumbnails; Aerie makes them again when needed',
      h('button.btn.small', { onclick: async () => { await api.clearCache(); toast('Cache cleared'); } }, 'Clear the cache'))));

  const area = h('textarea.input.code', { rows: 5, spellcheck: false, 'aria-label': 'Your setup as text', value: JSON.stringify(S.cfg, null, 1) });
  pageEl.append(section('Back up or share your setup', '', h('p.small.muted', {}, 'Your wallpaper choice, widgets and settings as text. Wallpapers themselves stay in your library and aren\'t included.'), area,
    h('div.acts', {},
      h('button.btn.small', { onclick: async () => { try { await navigator.clipboard.writeText(area.value); toast('Copied'); } catch { area.select(); } } }, 'Copy'),
      h('button.btn.small', { onclick: () => { try { Object.assign(S.cfg, normalizeConfig(JSON.parse(area.value))); changed(true); toast('Setup loaded'); } catch { toast('That text isn\'t an Aerie setup'); } } }, 'Load from text'),
      h('button.btn.small.ghost', { onclick: () => {
        const before = JSON.stringify(S.cfg);
        Object.assign(S.cfg, defaultConfig());
        changed(true);
        toast('Back to the default setup', { undo: () => { Object.assign(S.cfg, JSON.parse(before)); changed(true); } });
      } }, 'Reset to default'))));

  const status = h('p.small.muted', {}, 'Checking the version…');
  const upRow = h('div.acts');
  const check = h('button.btn', { onclick: async () => {
    check.disabled = true;
    check.textContent = 'Checking…';
    const res = await api.update().catch(e => ({ ok: false, message: e.message }));
    status.textContent = res.message;
    check.disabled = false;
    check.textContent = 'Check for updates';
    if (res.updated) upRow.append(h('button.btn.primary', { onclick: () => api.restart() }, 'Restart now'));
  } }, 'Check for updates');
  upRow.append(check);
  api.installInfo().then(info => {
    status.textContent = `Version ${info.version || '?'}` + (!info.installed ? ' · running from the source folder' : info.canUpdate ? ' · updates also show up in the COSMIC Store' : ' · built on this computer: run ./install.sh again to update');
  });
  pageEl.append(section('Updates', '更新', status, upRow));

  pageEl.append(section('Privacy', 'プライバシー',
    h('p.small', {}, 'Aerie has no accounts, ads, tracking or analytics. Your setup and wallpapers stay on this computer, in ~/.config/aerie and ~/.local/share/aerie. It goes online only for: Discover and the AI\'s searches (when you turn on online content), the AI you chose, web site wallpapers you add, and update checks you start. Details: PRIVACY.md.'),
    h('div.acts', {}, h('button.btn.danger', { onclick: async () => {
      if (!confirm('Delete your setup, your imported and made wallpapers, downloads, AI keys and the login autostart? This can\'t be undone.')) return;
      await api.deleteData().catch(() => null);
      Object.assign(S.cfg, defaultConfig());
      await save();
      await refreshList();
      toast('All Aerie data deleted');
      window.studio.go('settings');
    } }, 'Delete all my Aerie data'))));

  pageEl.append(section('About and credits', '情報',
    h('ul.plain.small', {},
      h('li', {}, 'Aerie: a free, open-source live wallpaper app for Pop!_OS COSMIC. Terms, privacy and refund policy: TERMS.md and PRIVACY.md, included with the app and on GitHub.'),
      h('li', {}, '3D: three.js (MIT). Desktop layer: gtk4-layer-shell (MIT). Icons: Phosphor (MIT). Fonts: Outfit and JetBrains Mono (SIL Open Font License).'),
      h('li', {}, 'Look: the Teal Mist theme by serafimcloud, and patterns from Filter Grid (ddoemonn) and Slider (halaska-studio), all from 21st.dev.'),
      h('li', {}, 'Wallpapers that come with Aerie: Anime Sky (shader by ProfesorShader, CC0), Rolling Hills (art by Kenney, CC0), Earth at Night (NASA, public domain), Dolomites (Benjamin Voros, CC0).')),
    h('div.acts', {}, h('button.btn', { onclick: () => api.shell('quit') }, 'Quit Aerie'))));

  pageEl.append(section('Uninstall', 'アンインストール',
    h('p.small', {}, 'Removes Aerie completely: the app, its icon, your setup, your wallpapers and downloads, AI keys, the login autostart and the lock screen switch. Your password is asked for, like any app removal.'),
    h('div.acts', {}, h('button.btn.danger', { disabled: STANDALONE, onclick: async () => {
      if (!confirm('Uninstall Aerie and delete all of its data? This can\'t be undone.')) return;
      toast('Uninstalling…');
      const res = await api.uninstall().catch(e => ({ ok: false, message: e.message }));
      toast(res.message || (res.ok ? 'Aerie was uninstalled.' : 'Uninstall failed'));
    } }, 'Uninstall Aerie'))));
}
