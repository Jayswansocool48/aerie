// Plays a GLSL shader as a live wallpaper.
//
// Shadertoy shaders (a mainImage function) get Shadertoy's inputs: iResolution, iTime, iTimeDelta,
// iFrame, iMouse (smoothed pointer, in pixels), iDate, iChannel0-3 (256×256 noise; iChannel0 is the
// 512×2 audio texture when the shader has a "// aerie: audio" line). glslsandbox-style shaders
// (their own main(), uniforms time / resolution / mouse) work too.
// Settings come from annotated uniforms (see aerie/wallpapers.py shader_properties).
import { audioState, hearing } from './audio.js';

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const VERT1 = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

function shadertoySource(code) {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform vec3 iChannelResolution[4];
uniform float iChannelTime[4];
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
out vec4 aerieColor;
#line 1
${code}
void main() {
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, gl_FragCoord.xy);
  aerieColor = vec4(c.rgb, 1.0);
}`;
}

/** Line numbers in errors point at your code (the lines Aerie adds come before "#line 1"). */
function readableError(log) {
  return String(log || '').split('\n').filter(Boolean).slice(0, 8).join('\n').replace(/\u0000/g, '');
}

function hexToVec3(hex) {
  const n = parseInt(String(hex || '#ffffff').slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class ShaderView {
  constructor(container, { onError } = {}) {
    this.el = container;
    this.onError = onError;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'shader-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);
    const opts = { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
    this.gl = this.canvas.getContext('webgl2', opts);
    this.webgl1 = false;
    if (!this.gl) { this.gl = this.canvas.getContext('webgl', opts); this.webgl1 = true; }
    this.settings = { speed: 1, quality: 1, fps: 60, props: {} };
    this.properties = {};
    this.paused = false;
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.start = performance.now();
    this.time = 0;
    this.frame = 0;
    this.onMove = e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    window.addEventListener('pointermove', this.onMove);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Compiles `code`. Returns '' when it works, or the compile error (also sent to onError). */
  load(code, properties = {}, audio = false) {
    const gl = this.gl;
    if (!gl) return this.fail('Your graphics driver has WebGL turned off, so shaders can\'t run.');
    this.properties = properties || {};
    this.audio = !!audio;
    const sandbox = !/\bmainImage\s*\(/.test(code);
    let frag, vert;
    if (sandbox) {
      frag = /^\s*#version\s+300\s+es/.test(code) ? code : (/precision\s+\w+p\s+float/.test(code) ? code : 'precision highp float;\n' + code);
      vert = /^\s*#version\s+300\s+es/.test(code) ? VERT : VERT1;
    } else {
      if (this.webgl1) return this.fail('This shader needs WebGL 2, which your graphics driver doesn\'t offer.');
      frag = shadertoySource(code);
      vert = VERT;
    }
    const vs = this.compile(gl.VERTEX_SHADER, vert);
    const fs = this.compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return this.fail(this.lastError || 'The shader didn\'t compile.');
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return this.fail(readableError(gl.getProgramInfoLog(prog)));
    if (this.prog) gl.deleteProgram(this.prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.u = name => gl.getUniformLocation(prog, name);
    this.makeTextures();
    this.start = performance.now();
    this.time = 0;
    this.frame = 0;
    this.resize();
    this.error = '';
    return '';
  }

  compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      this.lastError = readableError(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  fail(message) {
    this.error = message;
    this.prog = null;
    this.onError?.(message);
    return message;
  }

  makeTextures() {
    const gl = this.gl;
    // noise like Shadertoy's "RGBA Noise", from a fixed seed so a shader looks the same every time
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    const noise = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = rnd();
    this.textures = [0, 1, 2, 3].map(() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    });
    if (this.audio && !this.webgl1) {
      const t = this.textures[0];
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1024));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.audioVersion = -1;
    }
  }

  /** settings: speed (time scale), quality (0.25-1 of the screen's pixels), fps, props {uniform: value} */
  apply(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    this.resize();
  }

  setPaused(on) {
    this.paused = on;
    this.last = 0;
  }

  resize() {
    const q = Math.max(0.25, Math.min(1, Number(this.settings.quality) || 1));
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round((this.el.clientWidth || innerWidth) * dpr * q));
    const h = Math.max(1, Math.round((this.el.clientHeight || innerHeight) * dpr * q));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.scale = w / (this.el.clientWidth || innerWidth);
    if (this.paused) this.draw(0); // keep a sharp still frame
  }

  loop(ms) {
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused || !this.prog || document.hidden) return;
    const fps = this.settings.fps || 60;
    if (this.last && ms - this.last < 1000 / fps - 2) return;
    const dt = this.last ? Math.min(0.1, (ms - this.last) / 1000) : 1 / fps;
    this.last = ms;
    this.time += dt * Math.max(0, Number(this.settings.speed ?? 1));
    this.draw(dt);
  }

  draw(dt) {
    const gl = this.gl, u = this.u;
    if (!this.prog) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    const W = this.canvas.width, H = this.canvas.height;
    const m = this.mouse;
    m.sx += (m.x * this.scale - m.sx) * 0.08;
    m.sy += ((innerHeight - m.y) * this.scale - m.sy) * 0.08;
    const now = new Date();
    const set = (name, fn, ...v) => { const loc = u(name); if (loc) gl[fn](loc, ...v); };
    set('iResolution', 'uniform3f', W, H, 1);
    set('iTime', 'uniform1f', this.time);
    set('iTimeDelta', 'uniform1f', dt);
    set('iFrameRate', 'uniform1f', this.settings.fps || 60);
    set('iFrame', 'uniform1i', this.frame++);
    set('iMouse', 'uniform4f', m.sx, m.sy, 0, 0);
    set('iDate', 'uniform4f', now.getFullYear(), now.getMonth(), now.getDate(),
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000);
    set('iSampleRate', 'uniform1f', 44100);
    // glslsandbox names
    set('time', 'uniform1f', this.time);
    set('resolution', 'uniform2f', W, H);
    set('mouse', 'uniform2f', m.sx / W, m.sy / H);
    // your settings
    for (const [name, p] of Object.entries(this.properties)) {
      const v = this.settings.props?.[name] ?? p.value;
      if (p.type === 'color') set(p.uniform || name, 'uniform3f', ...hexToVec3(v));
      else if (p.type === 'bool') set(p.uniform || name, 'uniform1i', v ? 1 : 0);
      else set(p.uniform || name, 'uniform1f', Number(v));
    }
    // textures (and the sound, when the shader asked for it)
    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      set('iChannel' + i, 'uniform1i', i);
    }
    if (this.audio && !this.webgl1) {
      const a = audioState();
      if (a.version !== this.audioVersion) {
        this.audioVersion = a.version;
        gl.activeTexture(gl.TEXTURE0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RED, gl.UNSIGNED_BYTE, hearing() ? a.texture : new Uint8Array(1024));
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('resize', this.onResize);
    const gl = this.gl;
    if (gl) {
      for (const t of this.textures || []) gl.deleteTexture(t);
      if (this.prog) gl.deleteProgram(this.prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.el.replaceChildren();
  }
}
