// Plays a 3D stage: a free Poly Haven sky (HDRI) lighting the scene and showing behind it, and
// Poly Haven models placed on the ground (stage.json, made in Studio or by the AI). The camera
// frames everything, orbits slowly and leans toward the mouse.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { RGBELoader } from '../vendor/addons/RGBELoader.js';
import { api } from './config.js';
import { bass } from './audio.js';

const deg = THREE.MathUtils.degToRad;

/** The local address of a Poly Haven asset, downloading it first if you allowed online content. */
async function assetUrl(kind, id, res) {
  const have = await api.polyhavenLocal(kind, id, res).catch(() => ({ url: '' }));
  if (have.url) return have.url;
  if (!have.online) throw new Error('This 3D scene needs files that aren\'t downloaded. Turn on online content in Studio → Discover.');
  return api.polyhavenFetch(kind, id, res);
}

export class StageView {
  constructor(container, { onStatus } = {}) {
    this.el = container;
    this.onStatus = onStatus;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'model-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 2000);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.par = new THREE.Vector2();
    this.settings = { motion: 1, speed: 1, exposure: 1, fps: 60 };
    this.paused = false;
    this.t = 0;
    this.onMove = e => this.pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    window.addEventListener('pointermove', this.onMove);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.renderer.setAnimationLoop(t => this.frame(t));
  }

  async load(spec) {
    this.spec = spec;
    const token = this.token = {};
    this.root.clear();
    this.moving = [];
    const sky = spec.sky || {};
    // sky: the HDRI lights everything and is the background
    if (sky.hdri) {
      this.onStatus?.('Loading the sky…');
      try {
        const url = await assetUrl('hdris', sky.hdri, sky.res || '2k');
        const tex = await new RGBELoader().loadAsync(url);
        if (token !== this.token) return;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.envTex?.dispose();
        this.envTex = tex;
        this.scene.environment = tex;
        this.scene.background = tex;
      } catch (err) {
        this.onStatus?.(err.message || 'The sky could not be loaded.');
        this.scene.background = new THREE.Color(sky.color || '#4a6a8a');
      }
    } else {
      this.scene.background = new THREE.Color(sky.color || '#4a6a8a');
      this.scene.environment = null;
      this.root.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    }
    this.applySky();
    // a sun for shadows, roughly from above
    const sun = new THREE.DirectionalLight(0xffffff, this.scene.environment ? 0.9 : 2.2);
    sun.position.set(6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 60 });
    sun.shadow.bias = -0.0004;
    this.root.add(sun);
    const ground = spec.ground || {};
    if (ground.show !== false) {
      const g = new THREE.Mesh(new THREE.CircleGeometry(60, 64),
        new THREE.MeshStandardMaterial({ color: ground.color || '#3d4a3a', roughness: 0.95, metalness: 0 }));
      g.rotation.x = -Math.PI / 2;
      g.receiveShadow = ground.shadows !== false;
      this.root.add(g);
    }
    const fog = spec.fog || {};
    this.scene.fog = fog.color && fog.density > 0 ? new THREE.FogExp2(fog.color, fog.density) : null;
    // models
    const loader = new GLTFLoader();
    const models = spec.models || [];
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      this.onStatus?.(`Loading ${m.name || m.asset} (${i + 1} of ${models.length})…`);
      try {
        const url = await assetUrl('models', m.asset, m.res || '1k');
        const gltf = await loader.loadAsync(url);
        if (token !== this.token) return;
        const obj = gltf.scene;
        obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const holder = new THREE.Group();
        holder.add(obj);
        holder.position.set(...m.position);
        holder.rotation.set(deg(m.rotation[0]), deg(m.rotation[1]), deg(m.rotation[2]));
        holder.scale.setScalar(m.scale || 1);
        holder.userData = { spin: m.spin || 0, bob: m.bob || 0, baseY: m.position[1], phase: i * 1.3 };
        this.root.add(holder);
        if (m.spin || m.bob) this.moving.push(holder);
      } catch (err) {
        this.onStatus?.(`Couldn't load ${m.name || m.asset}: ${err.message || err}`);
      }
    }
    this.frameCamera();
    this.onStatus?.('');
  }

  applySky() {
    const sky = this.spec?.sky || {};
    this.scene.backgroundRotation?.set(0, deg(sky.rotation || 0), 0);
    this.scene.environmentRotation?.set(0, deg(sky.rotation || 0), 0);
    this.scene.backgroundBlurriness = sky.blur || 0;
    this.renderer.toneMappingExposure = (sky.exposure || 1) * (this.settings.exposure ?? 1);
  }

  /** Puts the camera where it sees every model (or where stage.json says, when auto is off). */
  frameCamera() {
    const cam = this.spec.camera || {};
    this.camera.fov = cam.fov || 45;
    if (cam.auto !== false && this.root.children.some(o => o.isGroup)) {
      const box = new THREE.Box3();
      for (const o of this.root.children) if (o.isGroup) box.expandByObject(o);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(0.5, size.length() / 2);
      const dist = radius / Math.sin(deg(this.camera.fov) / 2) * 0.9;
      this.target = new THREE.Vector3(center.x, Math.max(0.3, center.y * 0.8), center.z);
      this.base = new THREE.Vector3(center.x, center.y + radius * 0.35 + 0.4, center.z + dist);
    } else {
      this.target = new THREE.Vector3(...(cam.target || [0, 1, 0]));
      this.base = new THREE.Vector3(...(cam.position || [0, 1.6, 6]));
    }
    this.camera.updateProjectionMatrix();
  }

  apply(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.spec) this.applySky();
  }

  setPaused(on) {
    this.paused = on;
    if (!on) this.clock.getDelta();
  }

  resize() {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(ms) {
    if (!this.base || this.paused || document.hidden) return;
    const fps = this.settings.fps || 60;
    if (ms - (this.last || 0) < 1000 / fps - 2) return;
    this.last = ms;
    const dt = Math.min(0.1, this.clock.getDelta()) * Math.max(0, this.settings.speed ?? 1);
    this.t += dt;
    const reduce = document.documentElement.classList.contains('reduce-motion');
    for (const o of this.moving) {
      const u = o.userData;
      if (u.spin && !reduce) o.rotation.y += u.spin * Math.PI * 2 / 60 * dt;
      if (u.bob && !reduce) o.position.y = u.baseY + Math.sin(this.t * 1.2 + u.phase) * u.bob * 0.25 + bass() * u.bob * 0.1;
    }
    // orbit: a sky on its own turns all the way round (orbit = turns per minute); with models the
    // camera swings gently, up to 20° each side, at the same pace
    const orbit = reduce ? 0 : (this.spec.camera?.orbit || 0);
    const off = this.base.clone().sub(this.target);
    const phase = this.t * orbit * Math.PI * 2 / 60;
    const angle = this.moving !== undefined && this.root.children.some(o => o.isGroup) ? Math.sin(phase) * deg(20) : phase;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.par.lerp(this.pointer, 0.05);
    const strength = (this.settings.motion ?? 1) * (this.spec.camera?.parallax ?? 1) * (reduce ? 0 : 1);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.camera.translateX(this.par.x * 0.3 * strength);
    this.camera.translateY(this.par.y * 0.15 * strength);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.token = null;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse(o => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
    });
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.el.replaceChildren();
  }
}
