// Studio → Create: make wallpapers. Ask the AI (it finds art, draws 2D scenes, writes shaders or
// builds 3D scenes from Poly Haven), or build them yourself: a shader, a 2D parallax scene from
// your own pictures, or a 3D scene. Everything shows live in the preview before you save.
import { api, clone } from '../config.js';
import { h, icon, kbd, skeleton } from '../icons.js';
import { KIND_LABEL } from '../kinds.js';
import { toast } from '../toast.js';
import { color, filterChips, notice, row, section, seg, select, slider, pct, toggle } from './forms.js';
import { added, use } from './library.js';
import { onPreview, previewItem, refreshList, S, setOverride } from './state.js';

const TOOLS = [
  ['ai', 'Ask the AI', 'robot', 'Describe a wallpaper; the AI finds, draws, codes or builds it'],
  ['shader', 'Shader', 'code', 'GLSL code that draws every frame (Shadertoy style)'],
  ['parallax', '2D parallax', 'layers', 'Your pictures as layers that move with the mouse'],
  ['stage', '3D scene', 'mountains', 'A Poly Haven sky with 3D models placed around'],
];
const MODES = [
  { id: 'auto', label: 'Let the AI choose', match: () => true },
  { id: 'find', label: 'Find art', match: () => true },
  { id: 'draw', label: 'Draw 2D', match: () => true },
  { id: 'shader', label: 'Shader', match: () => true },
  { id: '3d', label: '3D scene', match: () => true },
  { id: 'paint', label: 'Paint (image AI)', match: () => true },
];
const STARTER = `// A starting point: soft waves of color. Change it and press Ctrl+Enter.
// Settings: add "// aerie: slider|color|bool" after a uniform and it shows up in Studio.
uniform vec3 uColorA;  // aerie: color #0b4f5c "Deep color"
uniform vec3 uColorB;  // aerie: color #3fc1b0 "Light color"
uniform float uSpeed;  // aerie: slider 0 2 0.5 "Speed"

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float t = iTime * uSpeed;
  float w = sin(uv.x * 6.0 + t) * 0.5 + sin(uv.y * 4.0 - t * 0.7) * 0.5;
  vec3 col = mix(uColorA, uColorB, smoothstep(-0.8, 0.8, w + uv.y - 0.5));
  fragColor = vec4(col, 1.0);
}
`;

const st = {
  tool: 'ai', mode: 'auto', prompt: '', job: null, result: null, sendCurrent: true, autoFix: true,
  edit: null,       // the wallpaper being edited: { item, kind, code | spec, title, dirty }
};

export function createPage(pageEl, toolsEl) {
  const nav = h('nav.create-nav', { 'aria-label': 'Ways to make a wallpaper' }, ...TOOLS.map(([k, label, ico, sub]) => h('button.create-tool', {
    type: 'button', 'aria-current': st.tool === k ? 'page' : null, 'data-sq': 12,
    onclick: () => { st.tool = k; if (k !== st.edit?.kind) st.edit = null; window.studio.go('create'); },
  }, h('span.ico', { html: icon(ico) }), h('span', {}, h('b', {}, label), h('small', {}, sub)))));
  const body = h('div.create-body');
  pageEl.append(h('div.create-layout', {}, nav, body));
  ({ ai: aiTool, shader: shaderTool, parallax: parallaxTool, stage: stageTool })[st.tool](body, toolsEl);
}

/** Open a wallpaper in its editor (from the Library). Bundled ones get edited as a copy. */
export async function editItem(w) {
  const kind = w.type;
  if (!['shader', 'parallax', 'stage'].includes(kind)) return;
  const res = await api.wallpaperFile(w.fileUrl);
  const data = kind === 'shader' ? await res.text() : await res.json();
  st.tool = kind;
  st.edit = { item: w.editable ? w : null, kind, title: w.editable ? w.title : w.title + ' (my copy)', dirty: !w.editable,
    code: kind === 'shader' ? data : undefined, spec: kind === 'shader' ? undefined : data,
    base: w.fileUrl.slice(0, w.fileUrl.lastIndexOf('/') + 1), copyOf: w.editable ? null : w };
  window.studio.go('create');
}

/** From Discover: put a Poly Haven sky or model into the 3D scene you're building. */
export function stageAdd({ sky, model }) {
  if (st.tool !== 'stage' || !st.edit || st.edit.kind !== 'stage') {
    st.tool = 'stage';
    st.edit = { item: null, kind: 'stage', title: 'My 3D scene', dirty: true, spec: blankStage() };
  }
  const spec = st.edit.spec;
  if (sky) spec.sky = { ...spec.sky, hdri: sky.id, name: sky.name };
  if (model) spec.models.push(newModel(model, spec.models.length));
  st.edit.dirty = true;
  window.studio.go('create');
  toast(sky ? `Sky: ${sky.name}` : `Added ${model.name}`);
}

// ---- Ask the AI -------------------------------------------------------------------------------
async function aiTool(body) {
  const ai = await api.assistant().catch(() => ({ provider: '', hasKey: {} }));
  const ready = !!ai.provider;
  const area = h('textarea.input.ai-prompt', { rows: 3, placeholder: 'A quiet lake at dusk with fireflies · neon rain on a city street · a cozy reading nook with plants · calm waves that pulse with my music',
    'aria-label': 'Describe your wallpaper', value: st.prompt, oninput: e => { st.prompt = e.target.value; },
    onkeydown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } } });
  const modes = () => filterChips(MODES.filter(m => m.id !== 'paint' || ai.canPaint), [], st.mode, id => { st.mode = id; modesBox.replaceChildren(modes()); }, 'What the AI makes');
  const modesBox = h('div', {}, modes());
  for (const c of modesBox.querySelectorAll('.count')) c.remove();
  const progress = h('div.ai-progress', { 'aria-live': 'polite' });
  const result = h('div.ai-result');
  body.append(
    section('Describe your wallpaper', 'AI', area, modesBox,
      h('div.acts', {}, h('button.btn.primary', { onclick: go, disabled: !ready && st.mode !== 'find' }, h('span', { html: icon('robot') }), 'Make it', kbd('Ctrl+Enter')),
        !ready ? h('span.small.muted', {}, 'Choose an AI below first (finding art works without one).') : ''),
      h('p.small.muted', {}, 'The AI gets only what you type here (and, when you ask it to change a wallpaper it made, that wallpaper\'s code or layout). Finding art and 3D scenes also search Openverse and Poly Haven.')),
    progress, result, aiSettings(ai));
  if (st.job) follow(st.job, progress, result);
  else if (st.result) showResult(st.result, result);

  async function go() {
    if (!st.prompt.trim()) { area.focus(); return; }
    try {
      st.result = null;
      st.job = await api.create(st.prompt, st.mode);
      follow(st.job, progress, result);
    } catch (e) { progress.replaceChildren(notice('warn', 'Couldn\'t start', e.message)); }
  }
}

async function follow(jobId, progress, result) {
  progress.replaceChildren(skeleton('rows', 2));
  for (;;) {
    let job;
    try { job = await api.job(jobId); } catch { break; }
    if (!progress.isConnected) return;
    progress.replaceChildren(h('ol.steps', {}, ...job.steps.map((s, i) => h('li', { class: i === job.steps.length - 1 && job.state === 'running' ? 'now' : 'done' }, s))));
    if (job.state === 'done') { st.job = null; st.result = job.result; showResult(job.result, result); return; }
    if (job.state === 'failed') { st.job = null; progress.append(notice('warn', 'That didn\'t work', job.error)); return; }
    await new Promise(r => setTimeout(r, 900));
  }
}

async function showResult(res, box) {
  box.replaceChildren();
  if (res.kind === 'find') {
    const grid = h('div.disc-grid');
    for (const r of res.results) {
      grid.append(h('div.wp.disc', { 'data-sq': 12 },
        h('div.thumb.pv-img', {}, h('img', { src: `/openverse-thumb/${r.id}`, alt: r.title, loading: 'lazy' })),
        h('span.meta', {}, h('b', {}, r.title), h('small', {}, `${r.creator || 'Unknown'} · ${r.license === 'cc0' ? 'CC0' : 'Public domain'}`)),
        h('button.btn.small', { onclick: async e => { e.currentTarget.disabled = true; try { added(await api.openverseImport(r.id)); } catch (err) { toast(err.message); e.target.disabled = false; } } }, 'Add')));
    }
    box.append(section(`Public-domain pictures for “${res.title}”`, '', h('p.small.muted', {}, 'Searched Openverse for: ' + res.queries.join(' · ')), grid));
    return;
  }
  await refreshList();
  const item = S.list.find(i => i.id === res.item.id) || res.item;
  previewItem(item, { fresh: true });
  const revise = h('textarea.input', { rows: 2, placeholder: 'Change it: slower clouds, warmer colors, add a bench by the tree…', 'aria-label': 'Change it' });
  const canRevise = item.type === 'shader' || item.type === 'stage';
  box.append(section(`Made: ${item.title}`, KIND_LABEL[item.type],
    h('p.small.muted', {}, 'It\'s in your library and playing in the preview.'),
    h('div.acts', {},
      h('button.btn.primary', { onclick: () => use(item) }, 'Use as wallpaper'),
      ['shader', 'parallax', 'stage'].includes(item.type) ? h('button.btn', { onclick: () => editItem(item) }, h('span', { html: icon('pencil') }), 'Edit it yourself') : ''),
    canRevise ? h('div.revise', {}, revise,
      h('label.check', {}, h('input', { type: 'checkbox', checked: st.sendCurrent, onchange: e => { st.sendCurrent = e.target.checked; } }),
        `Send this ${item.type === 'shader' ? 'shader\'s code' : 'scene\'s layout'} to the AI with my request`),
      h('div.acts', {}, h('button.btn', { onclick: async () => {
        if (!st.sendCurrent) { toast('The AI needs the current version to change it. Tick the box, or ask for a new wallpaper.'); return; }
        try { st.job = await api.create(revise.value, 'auto', { id: item.id }); follow(st.job, box.previousElementSibling, box); } catch (e) { toast(e.message); }
      } }, 'Change it'))) : ''));
  if (res.check && item.type === 'shader') watchCompile(item, box);
}

/** A shader the AI wrote that doesn't compile goes back to the AI once, with the error. */
function watchCompile(item, box) {
  const off = onPreview(async m => {
    if (m.type === 'shader-error' && m.id === item.id) {
      off();
      if (!st.autoFix || !st.sendCurrent) { box.append(notice('warn', 'The shader has an error', m.message)); return; }
      box.prepend(notice('info', 'Fixing a compile error', 'The AI is fixing its shader…'));
      try { st.job = await api.create('', 'shader', { id: item.id, error: m.message }); follow(st.job, box.previousElementSibling, box); } catch (e) { toast(e.message); }
    }
    if (m.type === 'shown' && m.id === item.id) setTimeout(off, 4000);
  });
}

function aiSettings(ai) {
  const box = h('details.ai-settings', { open: !ai.provider });
  const s = { provider: ai.provider || '', ollamaUrl: ai.ollamaUrl, models: { ...ai.models } };
  const keys = { claude: '', openai: '' };
  const paint = () => {
    const inner = [
      row('AI', 'Ollama runs on this computer; Claude and ChatGPT need an API key and send your words to Anthropic or OpenAI',
        seg(s, 'provider', { '': 'Off', ollama: 'Ollama', claude: 'Claude', openai: 'ChatGPT' }, async () => { await saveAi({ provider: s.provider }); paint(); }, 'AI')),
    ];
    if (s.provider === 'ollama') {
      const models = h('select.input', { 'aria-label': 'Ollama model', onchange: e => saveAi({ models: { ollama: e.target.value } }) }, h('option', { value: '' }, 'Loading your models…'));
      api.ollamaModels().then(r => {
        models.replaceChildren(h('option', { value: '' }, r.models.length ? 'Choose a model' : (r.error || 'No models found. Run: ollama pull llama3.1')),
          ...r.models.map(m => h('option', { value: m, selected: m === s.models.ollama }, m)));
      });
      inner.push(row('Model', 'A bigger model draws and codes better', models),
        row('Ollama address', '', h('input.input', { value: s.ollamaUrl, onchange: e => saveAi({ ollamaUrl: e.target.value }) })));
    }
    for (const p of ['claude', 'openai']) {
      if (s.provider !== p && !(p === 'openai' && ai.hasKey.openai)) continue;
      inner.push(
        row(p === 'claude' ? 'Claude API key' : 'OpenAI API key', ai.hasKey[p] ? 'Saved on this computer (only you can read it)' : 'Kept on this computer, never shown to pages',
          h('span.key-row', {}, h('input.input', { type: 'password', autocomplete: 'off', placeholder: ai.hasKey[p] ? '••••••••' : 'Paste your key', 'aria-label': 'API key', oninput: e => { keys[p] = e.target.value; } }),
            h('button.btn.small', { onclick: async () => { await saveAi({ keys: { [p]: keys[p] } }); toast('Key saved'); } }, 'Save'),
            ai.hasKey[p] ? h('button.btn.small.ghost', { onclick: async () => { await saveAi({ keys: { [p]: '' } }); toast('Key removed'); } }, 'Forget') : '')),
        row('Model', '', h('input.input', { value: s.models[p], onchange: e => saveAi({ models: { [p]: e.target.value } }) })));
    }
    if (ai.hasKey.openai) inner.push(row('Image model', 'For "Paint": OpenAI\'s image model paints a picture from your words', h('input.input', { value: s.models.openaiImage || 'gpt-image-1', onchange: e => saveAi({ models: { openaiImage: e.target.value } }) })));
    box.replaceChildren(h('summary', {}, h('span', { html: icon('settings') }), 'AI settings'), ...inner);
  };
  async function saveAi(changes) {
    try { Object.assign(ai, await api.assistantSettings(changes)); Object.assign(s, { provider: ai.provider, models: { ...ai.models } }); } catch (e) { toast(e.message); }
  }
  paint();
  return box;
}

// ---- Shader -----------------------------------------------------------------------------------
function shaderTool(body, toolsEl) {
  const ed = st.edit?.kind === 'shader' ? st.edit : (st.edit = { item: null, kind: 'shader', title: 'My shader', code: STARTER, dirty: true });
  const title = h('input.input', { value: ed.title, 'aria-label': 'Name', oninput: e => { ed.title = e.target.value; ed.dirty = true; } });
  const code = h('textarea.input.code', { rows: 24, spellcheck: false, value: ed.code, 'aria-label': 'Shader code',
    oninput: e => { ed.code = e.target.value; ed.dirty = true; },
    onkeydown: e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('  ', s, code.selectionEnd, 'end'); ed.code = code.value; }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveShader(); }
    } });
  const errors = h('pre.errors', { hidden: true, role: 'status' });
  toolsEl.append(h('button.btn', { onclick: run }, h('span', { html: icon('play') }), 'Run', kbd('Ctrl+Enter')),
    h('button.btn.primary', { onclick: saveShader }, 'Save', kbd('Ctrl+S')));
  body.append(section('Shader', 'GLSL',
    row('Name', '', title), code, errors,
    h('p.small.muted', {}, 'Shadertoy style: write mainImage(out vec4 fragColor, in vec2 fragCoord). You get iTime, iResolution, iMouse, iFrame, iDate and iChannel0-3 (noise). Start the first line with "// aerie: audio" and iChannel0 becomes the sound your speakers play.'),
    h('div.acts', {}, h('button.btn.ghost', { onclick: () => { code.value = ed.code = STARTER; run(); } }, 'Start over'),
      h('button.btn.ghost', { onclick: fixWithAi }, h('span', { html: icon('robot') }), 'Fix with AI'))));
  const off = onPreview(m => {
    if (!errors.isConnected) { off(); return; }
    if (m.type === 'shader-error') { errors.hidden = false; errors.textContent = m.message; }
    if (m.type === 'shown') errors.hidden = true;
  });
  run();

  function run() {
    errors.hidden = true;
    const audio = /\/\/\s*aerie:\s*audio\b/.test(ed.code);
    setOverride({ id: ed.item?.id || 'draft', kind: 'shader', code: ed.code, properties: parseProps(ed.code), audio });
  }
  async function saveShader() {
    try {
      const item = ed.item ? await api.updateShader(ed.item.id, ed.code) : await api.createShader(ed.title || 'My shader', ed.code);
      ed.item = item;
      ed.dirty = false;
      await refreshList();
      toast(`Saved "${item.title}"`);
      setOverride(null);
      previewItem(S.list.find(i => i.id === item.id) || item, { fresh: true });
    } catch (e) { toast(e.message); }
  }
  async function fixWithAi() {
    if (!ed.item) { toast('Save it first, then the AI can fix it.'); return; }
    st.tool = 'ai';
    try { st.job = await api.create('', 'shader', { id: ed.item.id, error: errors.textContent }); window.studio.go('create'); } catch (e) { toast(e.message); }
  }
}

/** The same "// aerie:" settings the app reads, worked out here so drafts get their controls too. */
function parseProps(code) {
  const out = {};
  const re = /^\s*uniform\s+(float|vec3|bool|int)\s+(\w+)\s*;\s*\/\/\s*aerie:\s*(slider|color|bool)\s*(.*)$/gm;
  let m, n = 0;
  while ((m = re.exec(code)) && n < 24) {
    const [, glsl, name, type, rest] = m;
    const label = (/"([^"]{1,80})"/.exec(rest) || [])[1] || name;
    const nums = rest.replace(/"[^"]*"/g, '').trim().split(/\s+/).filter(Boolean);
    const p = { type, label, uniform: name, glsl, order: n++ };
    if (type === 'slider') Object.assign(p, { min: +nums[0] || 0, max: +(nums[1] ?? 1), value: +(nums[2] ?? 0.5) });
    else if (type === 'color') p.value = /^#[0-9a-f]{6}$/i.test(nums[0]) ? nums[0] : '#ffffff';
    else p.value = nums[0] !== '0';
    out[name] = p;
  }
  return out;
}

// ---- 2D parallax ------------------------------------------------------------------------------
function parallaxTool(body, toolsEl) {
  const ed = st.edit?.kind === 'parallax' ? st.edit : (st.edit = { item: null, kind: 'parallax', title: 'My 2D scene', dirty: true,
    spec: { background: '#6fc6ee', background2: '#d6f0fa', parallax: 1, smoothing: 0.08, layers: [] } });
  const spec = ed.spec;
  let picked = 0;
  toolsEl.append(h('button.btn.primary', { onclick: saveParallax }, 'Save', kbd('Ctrl+S')));
  const layersBox = h('ol.layers', { 'aria-label': 'Layers, far to near' });
  const layerSettings = h('div');
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => addLayers([...fileInput.files]) });
  body.append(
    section('2D parallax scene', '視差',
      row('Name', '', h('input.input', { value: ed.title, oninput: e => { ed.title = e.target.value; ed.dirty = true; } })),
      row('Sky colors', 'Top and bottom, behind every layer', h('span.pair', {}, color(spec, 'background', live, '#6fc6ee', 'Top color'), color(spec, 'background2', live, '#d6f0fa', 'Bottom color'))),
      slider(spec, 'parallax', { min: 0, max: 3, step: 0.05, fmt: pct, onInput: live, label: 'Mouse depth' }),
      slider(spec, 'smoothing', { min: 0.02, max: 0.4, step: 0.01, fmt: v => (+v).toFixed(2) + 's', onInput: live, label: 'Follow delay' })),
    section('Layers', 'レイヤー', h('p.small.muted', {}, 'Far to near. PNG or WebP pictures with see-through parts work best. Use the arrows to change the order.'),
      layersBox, h('div.acts', {}, h('button.btn', { onclick: () => fileInput.click() }, h('span', { html: icon('plus') }), 'Add pictures…'), fileInput)),
    layerSettings);
  paintLayers();
  live();

  function paintLayers() {
    layersBox.replaceChildren(...spec.layers.map((l, i) => h('li.layer-row', { 'aria-current': i === picked ? 'true' : null },
      h('button.btn.ghost.small', { onclick: () => { picked = i; paintLayers(); }, 'aria-label': `Edit ${l.name}` },
        h('img', { src: layerUrl(l), alt: '' }), h('span', {}, l.name), h('small.muted', {}, `depth ${(+l.depth).toFixed(2)}`)),
      h('button.icon-btn', { title: 'Further back', 'aria-label': 'Further back', html: icon('up'), disabled: i === 0, onclick: () => move(i, -1) }),
      h('button.icon-btn', { title: 'Nearer', 'aria-label': 'Nearer', html: icon('caretDown'), disabled: i === spec.layers.length - 1, onclick: () => move(i, 1) }),
      h('button.icon-btn', { title: l.hidden ? 'Show' : 'Hide', 'aria-label': l.hidden ? 'Show layer' : 'Hide layer', html: icon(l.hidden ? 'eyeOff' : 'eye'), onclick: () => { l.hidden = !l.hidden; paintLayers(); live(); } }),
      h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove layer', html: icon('trash'), onclick: () => removeLayer(i) }))));
    if (!spec.layers.length) layersBox.append(h('li.empty', {}, 'No layers yet. Add a few pictures, far to near.'));
    const l = spec.layers[picked];
    layerSettings.replaceChildren(l ? section(`Layer: ${l.name}`, '',
      slider(l, 'depth', { min: 0, max: 1, step: 0.01, fmt: v => (+v).toFixed(2), onInput: live, label: 'Depth', hint: '0 far, 1 near' }),
      row('Fit', '', seg(l, 'fit', { cover: 'Fill', width: 'Full width', contain: 'Fit', none: 'Actual size' }, live, 'Fit')),
      row('Sits at', '', seg(l, 'align', { top: 'Top', center: 'Middle', bottom: 'Bottom' }, live, 'Sits at')),
      slider(l, 'x', { min: -50, max: 50, step: 0.5, fmt: v => v + '%', onInput: live, label: 'Move sideways' }),
      slider(l, 'y', { min: -50, max: 50, step: 0.5, fmt: v => v + '%', onInput: live, label: 'Move up or down' }),
      slider(l, 'scale', { min: 0.2, max: 3, step: 0.01, fmt: pct, onInput: live, label: 'Size' }),
      slider(l, 'opacity', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: live, label: 'Opacity' }),
      slider(l, 'scroll', { min: -120, max: 120, step: 1, fmt: v => v + ' px/s', onInput: v => { l.repeat = v !== 0; live(); }, label: 'Drift', hint: 'clouds, mist' }),
      slider(l, 'sway', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: live, label: 'Gentle bob' }),
      slider(l, 'react', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: live, label: 'Pulse with the bass', hint: 'reacts to music' }),
    ) : '');
  }
  function move(i, d) { const [l] = spec.layers.splice(i, 1); spec.layers.splice(i + d, 0, l); picked = i + d; ed.dirty = true; paintLayers(); live(); }
  function removeLayer(i) {
    const [l] = spec.layers.splice(i, 1);
    picked = Math.max(0, Math.min(picked, spec.layers.length - 1));
    ed.dirty = true; paintLayers(); live();
    toast(`Removed ${l.name}`, { undo: () => { spec.layers.splice(i, 0, l); paintLayers(); live(); } });
  }
  async function ensureItem() {
    if (ed.item) return ed.item;
    ed.item = await api.createParallax(ed.title || 'My 2D scene', { background: spec.background, background2: spec.background2, layers: [] });
    ed.base = ed.item.fileUrl.slice(0, ed.item.fileUrl.lastIndexOf('/') + 1);
    // a copy of a bundled scene: bring its layer files along
    if (ed.copyOf) {
      for (const l of spec.layers) {
        const blob = await (await api.wallpaperFile(layerUrl(l, ed.copyOf.fileUrl.slice(0, ed.copyOf.fileUrl.lastIndexOf('/') + 1)))).blob();
        l.file = await api.uploadLayer(ed.item.id, new File([blob], l.file.split('/').pop()));
      }
      ed.copyOf = null;
    }
    return ed.item;
  }
  async function addLayers(files) {
    try {
      const item = await ensureItem();
      for (const f of files) {
        toast(`Adding ${f.name}…`);
        const file = await api.uploadLayer(item.id, f);
        spec.layers.push({ file, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), depth: Math.min(1, spec.layers.length * 0.2), fit: 'cover', align: 'bottom',
          x: 0, y: 0, scale: 1, opacity: 1, scroll: 0, repeat: false, sway: 0, react: 0, hidden: false });
      }
      picked = spec.layers.length - 1;
      ed.dirty = true;
      paintLayers();
      await saveParallax(true);
    } catch (e) { toast(e.message); }
  }
  function live() {
    ed.dirty = true;
    setOverride({ id: ed.item?.id || 'draft', kind: 'parallax', spec: { ...clone(spec), layers: spec.layers.map(l => ({ ...l, file: absolute(l) })) } });
  }
  function absolute(l) { return l.file.startsWith('/') ? l.file : layerUrl(l); }
  function layerUrl(l, base = ed.base || ed.copyOf?.fileUrl?.slice(0, ed.copyOf.fileUrl.lastIndexOf('/') + 1)) {
    return base ? base + l.file.split('/').map(encodeURIComponent).join('/') : '';
  }
  async function saveParallax(quiet = false) {
    try {
      const item = await ensureItem();
      const saved = await api.saveSpec(item.id, { ...spec, title: ed.title });
      ed.item = saved;
      ed.dirty = false;
      await refreshList();
      if (!quiet) toast(`Saved "${saved.title}"`);
      setOverride(null);
      previewItem(S.list.find(i => i.id === saved.id) || saved, { fresh: true });
    } catch (e) { toast(e.message); }
  }
}

// ---- 3D scene -------------------------------------------------------------------------------
const blankStage = () => ({ sky: { hdri: '', res: '2k', rotation: 0, exposure: 1, blur: 0, color: '#4a6a8a' }, models: [],
  camera: { auto: true, position: [0, 1.6, 6], target: [0, 1, 0], fov: 45, orbit: 0.03, parallax: 1 },
  ground: { show: true, color: '#3d4a3a', shadows: true }, fog: { color: '', density: 0 } });

function newModel(m, n) {
  const angle = (n % 6) / 6 * Math.PI * 2;
  const r = n === 0 ? 0 : 1.6 + Math.floor(n / 6) * 1.4;
  return { asset: m.id, name: m.name, res: '1k', position: [+(Math.sin(angle) * r).toFixed(2), 0, +(-Math.cos(angle) * r).toFixed(2)],
    rotation: [0, 0, 0], scale: 1, spin: 0, bob: 0 };
}

function stageTool(body, toolsEl) {
  const ed = st.edit?.kind === 'stage' ? st.edit : (st.edit = { item: null, kind: 'stage', title: 'My 3D scene', dirty: true, spec: blankStage() });
  const spec = ed.spec;
  let picked = 0;
  toolsEl.append(h('button.btn.primary', { onclick: saveStage }, 'Save', kbd('Ctrl+S')));
  if (!S.cfg.general.online) {
    body.append(notice('online', '3D scenes use Poly Haven', 'Skies and models download from Poly Haven. Turn on online content in Discover first.',
      h('button.btn', { onclick: () => window.studio.go('discover') }, 'Open Discover')));
  }
  const modelsBox = h('ol.layers', { 'aria-label': 'Models' });
  const modelSettings = h('div');
  const finder = h('div.finder');
  body.append(
    section('3D scene', '立体',
      row('Name', '', h('input.input', { value: ed.title, oninput: e => { ed.title = e.target.value; ed.dirty = true; } })),
      row('Sky', spec.sky.hdri ? `${spec.sky.name || spec.sky.hdri} · Poly Haven` : 'None yet: a plain color',
        h('span.pair', {}, h('button.btn.small', { onclick: () => find('hdris') }, 'Choose a sky…'), color(spec.sky, 'color', live, '#4a6a8a', 'Sky color without a sky picture'))),
      slider(spec.sky, 'rotation', { min: -180, max: 180, step: 1, fmt: v => v + '°', onInput: live, label: 'Turn the sky' }),
      slider(spec.sky, 'exposure', { min: 0.2, max: 3, step: 0.05, fmt: v => (+v).toFixed(2), onInput: live, label: 'Brightness' }),
      slider(spec.sky, 'blur', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: live, label: 'Blur the sky' }),
      row('Ground', '', h('span.pair', {}, toggle(spec.ground, 'show', live, 'Show the ground'), color(spec.ground, 'color', live, '#3d4a3a', 'Ground color'))),
      row('Fog', 'Leave the density at 0 for none', h('span.pair', {}, color(spec.fog, 'color', live, '#a8b8c8', 'Fog color'),
        slider(spec.fog, 'density', { min: 0, max: 0.1, step: 0.002, fmt: v => (+v).toFixed(3), onInput: live }))),
      slider(spec.camera, 'orbit', { min: 0, max: 0.5, step: 0.01, fmt: v => (+v).toFixed(2) + ' per min', onInput: live, label: 'Camera motion' }),
      slider(spec.camera, 'fov', { min: 20, max: 90, step: 1, fmt: v => v + '°', onInput: live, label: 'Field of view' }),
      slider(spec.camera, 'parallax', { min: 0, max: 3, step: 0.05, fmt: pct, onInput: live, label: 'Mouse depth' })),
    section('Models', 'モデル', modelsBox, h('div.acts', {}, h('button.btn', { onclick: () => find('models') }, h('span', { html: icon('plus') }), 'Add a model…')), finder),
    modelSettings);
  paintModels();
  live();

  function paintModels() {
    modelsBox.replaceChildren(...spec.models.map((m, i) => h('li.layer-row', { 'aria-current': i === picked ? 'true' : null },
      h('button.btn.ghost.small', { onclick: () => { picked = i; paintModels(); } }, h('span', { html: icon('cube') }), h('span', {}, m.name || m.asset)),
      h('button.icon-btn', { title: 'Copy', 'aria-label': 'Add another one', html: icon('copy'), onclick: () => { spec.models.push({ ...clone(m), position: [m.position[0] + 1, m.position[1], m.position[2]] }); picked = spec.models.length - 1; paintModels(); live(); } }),
      h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove model', html: icon('trash'), onclick: () => {
        const [gone] = spec.models.splice(i, 1); picked = Math.max(0, picked - 1); paintModels(); live();
        toast(`Removed ${gone.name}`, { undo: () => { spec.models.splice(i, 0, gone); paintModels(); live(); } });
      } }))));
    if (!spec.models.length) modelsBox.append(h('li.empty', {}, 'No models yet. Add some from Poly Haven.'));
    const m = spec.models[picked];
    if (!m) { modelSettings.replaceChildren(); return; }
    const pos = { x: m.position[0], y: m.position[1], z: m.position[2], ry: m.rotation[1] };
    const upd = () => { m.position = [pos.x, pos.y, pos.z]; m.rotation = [0, pos.ry, 0]; live(); };
    modelSettings.replaceChildren(section(`Model: ${m.name || m.asset}`, '',
      slider(pos, 'x', { min: -10, max: 10, step: 0.05, fmt: v => (+v).toFixed(2) + ' m', onInput: upd, label: 'Left / right' }),
      slider(pos, 'z', { min: -12, max: 4, step: 0.05, fmt: v => (+v).toFixed(2) + ' m', onInput: upd, label: 'Back / front' }),
      slider(pos, 'y', { min: 0, max: 5, step: 0.05, fmt: v => (+v).toFixed(2) + ' m', onInput: upd, label: 'Height' }),
      slider(pos, 'ry', { min: -180, max: 180, step: 1, fmt: v => v + '°', onInput: upd, label: 'Turn' }),
      slider(m, 'scale', { min: 0.1, max: 5, step: 0.05, fmt: pct, onInput: live, label: 'Size' }),
      slider(m, 'spin', { min: -2, max: 2, step: 0.05, fmt: v => (+v).toFixed(2) + ' turns/min', onInput: live, label: 'Spin' }),
      slider(m, 'bob', { min: 0, max: 1, step: 0.01, fmt: pct, onInput: live, label: 'Float', hint: 'also bounces with the bass' }),
      row('Detail', 'Higher looks sharper up close and downloads more', select(m, 'res', { '1k': '1K', '2k': '2K', '4k': '4K' }, live, 'Detail'))));
  }
  async function find(kind) {
    if (!S.cfg.general.online) { window.studio.go('discover'); return; }
    const input = h('input.input', { type: 'search', placeholder: kind === 'hdris' ? 'sunset, forest, studio…' : 'chair, tree, rock, lamp…', 'aria-label': 'Search Poly Haven' });
    const results = h('div.disc-grid.small');
    const search = async () => {
      results.replaceChildren(skeleton('tiles', 6));
      try {
        const items = await api.polyhaven(kind, input.value);
        results.replaceChildren(...items.slice(0, 48).map(r => h('button.wp.disc', { type: 'button', 'data-sq': 10, onclick: () => {
          if (kind === 'hdris') spec.sky = { ...spec.sky, hdri: r.id, name: r.name };
          else { spec.models.push(newModel(r, spec.models.length)); picked = spec.models.length - 1; }
          finder.replaceChildren();
          ed.dirty = true;
          window.studio.go('create');
        } }, h('div.thumb.pv-img', {}, h('img', { src: `/polyhaven-thumb/${encodeURIComponent(r.id)}`, alt: r.name, loading: 'lazy' })), h('span.meta', {}, h('b', {}, r.name)))));
      } catch (e) { results.replaceChildren(notice('warn', 'Couldn\'t search Poly Haven', e.message)); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    finder.replaceChildren(h('div.finder-head', {}, h('b', {}, kind === 'hdris' ? 'Choose a sky · Poly Haven' : 'Add a model · Poly Haven'),
      h('label.search', {}, h('span', { html: icon('search') }), input), h('button.btn.small.ghost', { onclick: () => finder.replaceChildren() }, 'Close')), results);
    input.focus();
    search();
  }
  let t;
  function live() {
    ed.dirty = true;
    clearTimeout(t);
    t = setTimeout(() => setOverride({ id: ed.item?.id || 'draft', kind: 'stage', spec: clone(spec) }), 250);
  }
  async function saveStage() {
    try {
      toast('Saving (downloading what the scene needs)…');
      const item = ed.item || await api.createStage(ed.title || 'My 3D scene', {});
      const saved = await api.saveSpec(item.id, { ...spec, title: ed.title });
      ed.item = saved;
      ed.dirty = false;
      await refreshList();
      toast(`Saved "${saved.title}"`);
      setOverride(null);
      previewItem(S.list.find(i => i.id === saved.id) || saved, { fresh: true });
    } catch (e) { toast(e.message); }
  }
}

export const createKeys = e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const b = [...document.querySelectorAll('#tools .btn.primary')].find(x => x.textContent.startsWith('Save'));
    if (b) { e.preventDefault(); b.click(); return true; }
  }
  return false;
};
