// The lock screen page. Your password goes straight to the lock screen program (which checks it
// with the system, like at login); it never goes over the network or into any file.
import { api, normalizeConfig, MONITOR } from './config.js';
import { icon } from './icons.js';
import { libraryItems } from './library.js';
import { animate, installCssSprings, SPRINGS } from './motion.js';
import { installSquircles } from './squircle.js';

installCssSprings();
installSquircles();

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const PREVIEW = params.get('preview') === '1';
const post = msg => { try { window.webkit.messageHandlers.aerie.postMessage(msg); } catch { /* not inside Aerie */ } };
let cfg;
let clock24 = false;
let restTimer;

$('#go').innerHTML = icon('arrowRight');
$('#sleep').innerHTML = icon('sleep');
$('#power').innerHTML = icon('power');
$('#preview-tag').hidden = !PREVIEW;

// the wallpaper, drawn by the desktop page in its lock mode (no widgets)
$('#wall').src = `index.html?mode=lock&monitor=${MONITOR}${location.hash}`;

function tick() {
  const now = new Date();
  $('#time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !clock24 }).replace(/\s?[AP]M$/i, '');
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// after 20 s without input only the clock stays; any key or mouse move brings the rest back
function rest(on) {
  if (document.body.classList.contains('resting') === on) return;
  document.body.classList.toggle('resting', on);
  animate($('#form'), { opacity: on ? 0 : 1, y: on ? 10 : 0 }, { config: SPRINGS.gentle });
  animate($('#bar'), { opacity: on ? 0 : 1 }, { config: SPRINGS.gentle });
}
function wake() {
  rest(false);
  clearTimeout(restTimer);
  restTimer = setTimeout(() => { if (!$('#password').value) rest(true); }, 20000);
}

addEventListener('keydown', e => {
  wake();
  if (PREVIEW && e.key === 'Escape') post({ type: 'close-preview' });
  if (document.activeElement !== $('#password') && e.key.length === 1) $('#password').focus();
});
addEventListener('pointermove', wake);
addEventListener('pointerdown', () => { wake(); $('#password').focus(); });

$('#form').addEventListener('submit', e => {
  e.preventDefault();
  const pw = $('#password').value;
  if (!pw) return;
  $('#form').classList.remove('wrong');
  $('#form').classList.add('checking');
  $('#status').textContent = 'Checking…';
  post({ type: 'unlock', password: pw });
  $('#password').value = ''; // typing during the check starts a fresh try
  if (!window.webkit?.messageHandlers?.aerie) setTimeout(() => window.lockScreen.failed('Not running inside Aerie'), 400);
});

$('#sleep').addEventListener('click', () => post({ type: 'power', action: 'sleep' }));
$('#power').addEventListener('click', () => {
  if ($('#power').dataset.armed) { post({ type: 'power', action: 'shutdown' }); return; }
  $('#power').dataset.armed = '1';
  $('#status').textContent = 'Click the power button again to shut down';
  setTimeout(() => { delete $('#power').dataset.armed; if ($('#status').textContent.startsWith('Click')) $('#status').textContent = ''; }, 4000);
});

window.lockScreen = {
  failed(message) {
    const f = $('#form');
    f.classList.remove('checking');
    f.classList.add('wrong');
    // the shake: a spring at rest, kicked sideways, rings out by itself
    animate($('.pw'), { x: 0 }, { config: SPRINGS.bouncy, velocity: { x: 520 } });
    $('#status').textContent = message || 'Wrong password';
    $('#password').focus();
  },
  success() {
    $('#form').classList.remove('checking');
    $('#form').classList.add('ok');
    animate($('#form'), { scale: 0.94, opacity: 0 }, { config: SPRINGS.snappy });
    $('#status').textContent = '';
    $('#password').value = '';
  },
  woke() { tick(); wake(); $('#password').focus(); },
};

async function nowPlaying() {
  const np = await api.nowPlaying();
  const box = $('#np');
  if (!cfg.general.lockScreen.media || !np?.active) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren();
  const art = np.hasArt ? Object.assign(document.createElement('img'), { src: '/now-playing-art?t=' + encodeURIComponent(np.title), alt: '' }) : Object.assign(document.createElement('div'), { className: 'art' });
  const t = document.createElement('div');
  t.className = 't';
  t.innerHTML = '<b></b><small></small>';
  t.querySelector('b').textContent = np.title;
  t.querySelector('small').textContent = np.artist || np.player || '';
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', np.playing ? 'Pause' : 'Play');
  btn.innerHTML = icon(np.playing ? 'pause' : 'play');
  btn.addEventListener('click', async () => { await api.playerControl('play-pause'); setTimeout(nowPlaying, 300); });
  box.append(art, t, btn);
}

async function battery() {
  const s = await api.system();
  const b = $('#battery');
  b.hidden = !(cfg.general.lockScreen.battery && s?.battery);
  if (!b.hidden) b.textContent = `${s.battery.percent}%${s.battery.status === 'Charging' ? ', charging' : ''}`;
}

(async function start() {
  cfg = normalizeConfig(await api.loadConfig());
  const o = cfg.general.lockScreen;
  const info = await api.lockInfo();
  clock24 = !!info.clock24;
  $('#name').textContent = info.name || '';
  const av = $('#avatar');
  if (info.avatar) av.style.backgroundImage = 'url("/lock-avatar")';
  else av.textContent = (info.name || '?').trim()[0]?.toUpperCase() || '';
  $('#time').hidden = !o.clock;
  $('#date').hidden = !o.date;
  if (o.message) { $('#message').hidden = false; $('#message').textContent = o.message; }
  document.body.style.setProperty('--dim', o.dim ?? 0.25);
  if (o.blur) { $('#wall').style.filter = `blur(${o.blur}px)`; $('#wall').style.transform = 'scale(1.04)'; }
  $('#sleep').hidden = $('#power').hidden = !o.power;
  // web wallpapers run underneath this page (in their own sandbox), so let them show through
  const choice = (cfg.screens && cfg.screens[String(MONITOR)]) || cfg.wallpaper;
  const items = choice?.type === 'library' || choice?.type === 'default' ? await libraryItems() : [];
  const item = choice?.type === 'default' ? items.find(i => i.source === 'default') : items.find(i => i.id === choice?.id);
  if (item && (item.type === 'web' || item.type === 'url')) document.body.classList.add('web-wallpaper');
  tick();
  setInterval(tick, 1000);
  nowPlaying();
  setInterval(nowPlaying, 4000);
  battery();
  setInterval(battery, 30000);
  wake();
  $('#password').focus();
  post({ type: 'ready' });
  if (params.get('keys')) addEventListener('keydown', e => post({ type: 'key', key: e.key.length === 1 ? 'char' : e.key }), true);
})();
