// Plays a 3D scene made in Blender (exported as glTF: .glb or .gltf) as a live wallpaper.
// Uses the scene's own camera, lights and animations; adds gentle mouse parallax.
//
// Optional settings you can put on the Blender *scene* as Custom Properties (export with
// "Include → Custom Properties" on): aerie_background ("#rrggbb"), aerie_parallax (0–2),
// aerie_exposure (0.2–3), aerie_shadows (0 or 1). See docs/BLENDER.md.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { DRACOLoader } from '../vendor/addons/DRACOLoader.js';
import { MeshoptDecoder } from '../vendor/addons/meshopt_decoder.module.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';

let draco = null;
function loader() {
  const l = new GLTFLoader();
  draco ||= new DRACOLoader().setDecoderPath('vendor/addons/draco/').setDecoderConfig({ type: 'wasm' });
  l.setDRACOLoader(draco);
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

export class ModelScene {
  constructor(container) {
    this.el = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'model-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping; // Blender's default look since 4.0
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.par = new THREE.Vector2();
    this.settings = { motion: 1, speed: 1, exposure: 1, background: '', shadows: true, fps: 60 };
    this.paused = false;
    this.onMove = e => this.pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    window.addEventListener('pointermove', this.onMove);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.renderer.setAnimationLoop(t => this.frame(t));
  }

  /** Loads a .glb/.gltf. Returns {cameras, animations, lights} or throws with a readable message. */
  async load(url) {
    let gltf;
    try {
      gltf = await loader().loadAsync(url);
    } catch (err) {
      throw new Error('This 3D scene could not be opened: ' + (err?.message || err));
    }
    if (this.disposed) return null;
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('This file has no scene in it.');
    this.scene.add(root);
    this.root = root;
    this.extras = { ...(gltf.scene?.userData || {}), ...(gltf.asset?.extras || {}) };

    // lights: the file's own, or a soft default so it isn't black
    let lights = 0;
    root.traverse(o => {
      if (o.isLight) {
        lights++;
        if (o.isDirectionalLight || o.isSpotLight) {
          o.castShadow = true;
          o.shadow.mapSize.set(2048, 2048);
          o.shadow.bias = -0.0005;
        }
      }
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    if (!lights) {
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.5);
      sun.position.set(5, 10, 6);
      this.scene.add(sun);
    }
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = lights ? 0.35 : 0.8;

    // camera: the first one in the file, or one that frames everything
    root.updateMatrixWorld(true);
    if (gltf.cameras?.length && gltf.cameras[0].isPerspectiveCamera) {
      this.camera = gltf.cameras[0];
      this.baseFov = this.camera.fov;
      this.baseAspect = this.camera.aspect || 16 / 9;
    } else {
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length() || 10;
      const center = box.getCenter(new THREE.Vector3());
      this.camera = new THREE.PerspectiveCamera(40, 16 / 9, size / 200, size * 20);
      this.camera.position.copy(center).add(new THREE.Vector3(0, size * 0.18, size * 0.95));
      this.camera.lookAt(center);
      this.scene.add(this.camera);
      this.baseFov = 40;
      this.baseAspect = 16 / 9;
    }

    // animations: all of them, looping (make loops seamless in Blender: same first and last frame)
    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
    }
    this.apply(this.settings);
    this.resize();
    return { cameras: gltf.cameras?.length || 0, animations: gltf.animations?.length || 0, lights };
  }

  /** settings: motion (parallax), speed (animations), exposure, background ('' = the file's), shadows, fps */
  apply(settings) {
    this.settings = { ...this.settings, ...settings };
    const x = this.extras || {};
    const s = this.settings;
    this.renderer.toneMappingExposure = (s.exposure ?? 1) * (Number(x.aerie_exposure) || 1);
    const bg = s.background || x.aerie_background || '';
    this.scene.background = /^#[0-9a-f]{6}$/i.test(bg) ? new THREE.Color(bg) : null;
    this.renderer.setClearColor(0x0b0f1e, 1);
    const shadows = s.shadows !== false && x.aerie_shadows !== 0;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    if (this.mixer) this.mixer.timeScale = Math.max(0, s.speed ?? 1);
  }

  setPaused(on) {
    this.paused = on;
    if (!on) this.clock.getDelta(); // don't jump ahead after a pause
  }

  resize() {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      const aspect = w / h;
      this.camera.aspect = aspect;
      // keep what the Blender camera frames side to side, even on narrower screens
      this.camera.fov = aspect < this.baseAspect
        ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) * this.baseAspect / aspect))
        : this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  frame(ms) {
    if (!this.camera || this.paused || document.hidden) return;
    const fps = this.settings.fps || 60;
    if (ms - (this.last || 0) < 1000 / fps - 2) return;
    this.last = ms;
    const dt = Math.min(0.1, this.clock.getDelta());
    this.mixer?.update(dt);
    // parallax: nudge the camera a little toward the mouse, then put it back for the animation
    const strength = (this.settings.motion ?? 1) * (Number(this.extras?.aerie_parallax) || 1);
    this.par.lerp(this.pointer, 0.05);
    const cam = this.camera;
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    if (strength > 0) {
      cam.updateMatrixWorld();
      const dist = 6;
      const target = new THREE.Vector3(0, 0, -dist).applyMatrix4(cam.matrixWorld);
      cam.translateX(this.par.x * 0.25 * strength);
      cam.translateY(this.par.y * 0.12 * strength);
      cam.updateMatrixWorld();
      cam.lookAt(target); // keeps looking at the same spot, so near things shift more than far ones
    }
    this.renderer.render(this.scene, cam);
    cam.position.copy(pos);
    cam.quaternion.copy(quat);
  }

  dispose() {
    this.disposed = true;
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
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.el.replaceChildren();
  }
}
