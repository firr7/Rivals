// Mondo 3D: renderer, luci, cielo, pista, città, auto, effetti e post-processing.

import * as THREE from '../three.js';
import { QUALITY } from '../config.js';
import { pointAt } from '../track-data.js';
import { createSky, createEnvMap, SUN_DIR } from './sky.js';
import { buildTrackMeshes } from './track-mesh.js';
import { buildCity } from './city.js';
import { buildCarModel } from './car-model.js';
import { ParticleSystem, SkidMarks, FinalShader } from './fx.js';
import { CameraRig } from './camera.js';
import * as TX from './textures.js';

function disposeGroup(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of ['map', 'emissiveMap', 'normalMap']) if (m[k]) m[k].dispose();
        m.dispose();
      }
    }
  });
}

const FOG_COLOR = new THREE.Color().setRGB(0.72, 0.34, 0.17);

// ---------------------------------------------------------------------------
// Vista di un'auto
// ---------------------------------------------------------------------------

class CarView {
  constructor(world, { color, id }) {
    this.world = world;
    this.id = id;
    this.model = buildCarModel({ color, envMap: world.envMap, fancy: world.q.fancyCars });
    this.root = this.model.root;
    this.root.traverse((o) => { if (o.isMesh && o.castShadow !== undefined) o.castShadow = world.q.shadows; });
    // fascio dei fari a terra
    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(6.5, 15).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: world.tex.beam, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    beam.position.set(0, 0.03, 9.3);
    beam.renderOrder = 3;
    this.root.add(beam);
    // ombra finta a terra
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 5.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: world.tex.blob, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    );
    blob.position.set(0, 0.02, 0);
    blob.renderOrder = 1;
    this.root.add(blob);
    this.pitch = 0; this.roll = 0;
    this.pop = 0; this.prevThrottle = 0; this.flick = 0;
    this.wheelRot = 0;
    this.root.visible = false;
    world.scene.add(this.root);
  }

  setColor(hex) { this.model.mats.paint.color.set(hex); }

  update(dt, car) {
    const m = this.model;
    this.root.visible = true;
    this.root.position.set(car.x, 0.03, car.z);
    this.root.rotation.y = car.heading;
    // rollio e beccheggio
    const tp = THREE.MathUtils.clamp(-car.accLong * 0.0042, -0.05, 0.05);
    const tr = THREE.MathUtils.clamp(car.accLat * 0.0036, -0.075, 0.075);
    const k = 1 - Math.exp(-9 * dt);
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    m.body.rotation.x = this.pitch;
    m.body.rotation.z = this.roll;
    // ruote
    this.wheelRot = car.wheelRot;
    for (const w of m.wheels) {
      w.spin.rotation.x = this.wheelRot;
      if (w.front) w.pivot.rotation.y = -car.steerAngle;
    }
    // luci freno
    const braking = car.brake > 0.05 || car.reversing;
    m.mats.tail.color.setRGB(braking ? 4.0 : 0.9, braking ? 0.15 : 0.03, braking ? 0.12 : 0.03);
    // nitro e backfire
    this.flick += dt * 60;
    const fl = 0.85 + 0.3 * Math.sin(this.flick * 1.7) * Math.sin(this.flick * 0.9 + 1.0);
    for (const f of m.flames) {
      f.visible = car.nitroActive;
      if (car.nitroActive) f.scale.set(0.9 + Math.random() * 0.3, 0.9 + Math.random() * 0.3, 2.4 * fl + Math.random() * 0.8);
    }
    const lift = this.prevThrottle > 0.8 && car.throttle < 0.1 && car.speed > 22;
    if (lift && car.rpm > 4800) this.pop = 0.1 + Math.random() * 0.05;
    if (car.shifted === 1 && car.rpm > 3500 && car.throttle > 0.6) this.pop = Math.max(this.pop, 0.07);
    this.prevThrottle = car.throttle;
    this.pop = Math.max(0, this.pop - dt);
    for (const p of m.pops) {
      p.visible = this.pop > 0;
      if (this.pop > 0) p.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.9);
    }
  }

  dispose() {
    this.world.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

// ---------------------------------------------------------------------------

export class World {
  constructor(canvas, track, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.track = track;
    this.time = 0;
    this.views = new Map();
    this.qualityName = quality;
    this.q = this._qualityFor(quality);
    this.dynScale = 1;
    this.perf = { acc: 0, frames: 0, fps: 60, lastAdjust: 0 };
    this.autoQuality = false;
    this.flashV = 0;
    this.fxBlur = 0;
    this.cityGroup = null;

    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false,
    });
    renderer.setClearColor(0x120a10, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00135);
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 1900);
    this.rig = new CameraRig(this.camera);

    this.tex = { beam: TX.beamTexture(), blob: this._blobTexture(), smoke: TX.smokeTexture(), spark: TX.sparkTexture() };
  }

  _qualityFor(name) {
    const base = QUALITY[name] || QUALITY.medium;
    return { ...base, fancyCars: name !== 'low', msaa: name === 'low' ? 0 : 4 };
  }

  _blobTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 64, 4, 32, 64, 62);
    rg.addColorStop(0, 'rgba(0,0,0,0.85)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.38)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.translate(32, 64); g.scale(0.52, 1); g.translate(-32, -64);
    g.fillStyle = rg; g.fillRect(-40, 0, 140, 128); g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async init() {
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('900 64px Orbitron'), document.fonts.load('700 40px Orbitron'),
          document.fonts.load('700 34px Rajdhani'),
        ]);
      } catch { /* ignora */ }
    }
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.aniso = aniso;
    this.envMap = createEnvMap(this.renderer);

    // luci
    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.60, 0.30), 3.1);
    this.sun.position.copy(SUN_DIR).multiplyScalar(200);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(1.0, 0.55, 0.38), new THREE.Color().setRGB(0.12, 0.09, 0.15), 1.7);
    this.scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(new THREE.Color().setRGB(0.35, 0.42, 0.85), 0.55);
    this.fill.position.set(-SUN_DIR.x, 0.4, -SUN_DIR.z).multiplyScalar(100);
    this.scene.add(this.fill);

    // cielo
    this.sky = createSky();
    this.scene.add(this.sky);

    // pista, città
    this.trackGroup = buildTrackMeshes(this.track, { envMap: this.envMap, aniso });
    this.scene.add(this.trackGroup);
    this._buildCity();

    // particelle e segni gomme
    this.smoke = new ParticleSystem({ max: 260, texture: this.tex.smoke, drag: 1.2, gravity: -0.15 });
    this.sparks = new ParticleSystem({ max: 200, texture: this.tex.spark, additive: true, drag: 0.4, gravity: 9 });
    this.dust = new ParticleSystem({ max: 120, texture: this.tex.smoke, drag: 1.6, gravity: -0.1 });
    this.skid = new SkidMarks(900);
    this.scene.add(this.smoke.mesh, this.sparks.mesh, this.dust.mesh, this.skid.mesh);

    this._applyShadowSetup();
    this._buildComposer();
    this.resize();
  }

  _buildCity() {
    if (this.cityGroup) { this.scene.remove(this.cityGroup); disposeGroup(this.cityGroup); }
    this.cityGroup = buildCity(this.track, this.q, { aniso: this.aniso });
    this.scene.add(this.cityGroup);
  }

  _applyShadowSetup() {
    const on = this.q.shadows;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    if (on) {
      const s = this.sun.shadow;
      s.mapSize.set(2048, 2048);
      const cam = s.camera;
      cam.left = -34; cam.right = 34; cam.top = 34; cam.bottom = -34; cam.near = 5; cam.far = 420;
      cam.updateProjectionMatrix();
      s.bias = -0.0004; s.normalBias = 0.06;
    }
    const road = this.trackGroup.getObjectByName('road');
    if (road) { road.receiveShadow = on; road.material.needsUpdate = true; }
    for (const v of this.views.values()) v.root.traverse((o) => { if (o.isMesh) o.castShadow = on && !o.material?.transparent; });
    this.scene.traverse((o) => { if (o.material) { for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.needsUpdate = true; } });
  }

  _buildComposer() {
    const r = this.renderer;
    if (this.composer) { this.composer.dispose(); }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new THREE.EffectComposer(r, rt);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (this.q.bloom) {
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.55, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new THREE.OutputPass());
    this.finalPass = new THREE.ShaderPass(FinalShader);
    this.finalPass.uniforms.uSamples.value = this.q.radialBlur ? 9 : 5;
    this.composer.addPass(this.finalPass);
  }

  // -------------------------------------------------------------------------

  setQuality(name, { rebuild = true } = {}) {
    const prev = this.q;
    this.qualityName = name;
    this.q = this._qualityFor(name);
    if (!this.cityGroup) return;
    this._applyShadowSetup();
    if (rebuild && (prev.buildings !== this.q.buildings || prev.lamps !== this.q.lamps)) this._buildCity();
    if (prev.bloom !== this.q.bloom || prev.msaa !== this.q.msaa) this._buildComposer();
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * this.dynScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
    if (this.finalPass) this.finalPass.uniforms.uAspect.value = w / h;
    this.drawH = h * dpr;
  }

  /** Adegua la risoluzione di rendering in base agli FPS (solo con qualità automatica). */
  perfTick(dt) {
    const p = this.perf;
    p.acc += dt; p.frames++;
    if (p.acc >= 1.2) {
      p.fps = p.frames / p.acc; p.acc = 0; p.frames = 0;
      if (this.autoQuality) {
        const prev = this.dynScale;
        if (p.fps < 44 && this.dynScale > 0.55) this.dynScale = Math.max(0.55, this.dynScale - 0.12);
        else if (p.fps < 36 && this.dynScale <= 0.55 && this.qualityName !== 'low') {
          this.setQuality(this.qualityName === 'high' ? 'medium' : 'low'); this.dynScale = 0.75;
        } else if (p.fps > 58 && this.dynScale < 1) this.dynScale = Math.min(1, this.dynScale + 0.06);
        if (prev !== this.dynScale) this.resize();
      }
    }
    return p.fps;
  }

  // -------------------------------------------------------------------------
  // Auto
  // -------------------------------------------------------------------------

  setCars(list) {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.skid.clear();
    for (const c of list) this.views.set(c.id, new CarView(this, c));
  }

  getView(id) { return this.views.get(id); }

  /** Posizione della griglia/showcase a una certa distanza dal traguardo. */
  showcaseSpot(sAhead = 24, d = 0) { return pointAt(this.track, sAhead, d, {}); }

  updateCars(dt, cars, playerId) {
    const sparksOn = this.q.particles > 0;
    for (const rc of cars) {
      const v = this.views.get(rc.id);
      if (!v) continue;
      const car = rc.car;
      v.update(dt, car);
      const hide = rc.isPlayer && this.rig.hidesOwnCar;
      v.root.visible = !hide;
      const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
      // ruote posteriori in coordinate mondo
      const wheelPos = [];
      for (const lx of [0.84, -0.84]) {
        const lz = -1.32;
        wheelPos.push([car.x + lx * ch + lz * sh, car.z - lx * sh + lz * ch]);
      }
      // segni gomme + fumo
      let a = 0;
      if (car.drift > 0.18) a = Math.max(a, car.drift);
      if (car.brake > 0.85 && car.speed > 26) a = Math.max(a, 0.45);
      if (car.wheelspin > 0.3) a = Math.max(a, car.wheelspin * 0.75);
      if (car.handbrake && car.speed > 8) a = Math.max(a, 0.7);
      for (let w = 0; w < 2; w++) {
        this.skid.add(rc.id * 2 + w, wheelPos[w][0], wheelPos[w][1], a);
        if (a > 0.25 && sparksOn) {
          const n = (this.q.particles / 220) * 55 * a * dt;
          let cnt = Math.floor(n); if (Math.random() < n - cnt) cnt++;
          for (let i = 0; i < cnt; i++) {
            this.smoke.emit(
              wheelPos[w][0] + (Math.random() - 0.5) * 0.3, 0.2, wheelPos[w][1] + (Math.random() - 0.5) * 0.3,
              car.vx * 0.22 + (Math.random() - 0.5) * 1.2, 0.7 + Math.random() * 1.1, car.vz * 0.22 + (Math.random() - 0.5) * 1.2,
              0.9 + Math.random() * 0.7, 0.9, 3.6 + Math.random() * 1.8, 0.82, 0.82, 0.84, 0.5 * Math.min(1, a + 0.2));
          }
        }
        // polvere fuori dalla carreggiata
        if (car.surfaceDrag > 0 && car.speed > 9 && sparksOn && Math.random() < dt * 28) {
          this.dust.emit(wheelPos[w][0], 0.15, wheelPos[w][1], (Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5, 0.9, 0.7, 2.6, 0.55, 0.45, 0.35, 0.35);
        }
      }
      // scintille dal muro
      if ((car.scrape > 0 || car.impact > 2.5) && sparksOn) {
        const side = rc.info && rc.info.d < 0 ? -1 : 1;
        const nx = rc.info ? rc.info.nx * side : 0, nz = rc.info ? rc.info.nz * side : 0;
        const n = (car.scrape * 70 + car.impact * 14) * dt;
        let cnt = Math.floor(n); if (Math.random() < n - cnt) cnt++;
        for (let i = 0; i < cnt; i++) {
          const px = car.x + nx * 0.95 + (Math.random() - 0.5) * 2.4 * Math.sin(car.heading), pz = car.z + nz * 0.95 + (Math.random() - 0.5) * 2.4 * Math.cos(car.heading);
          this.sparks.emit(px, 0.2 + Math.random() * 0.5, pz,
            -car.vx * 0.15 + (Math.random() - 0.5) * 6 - nx * 3, 1.5 + Math.random() * 3.5, -car.vz * 0.15 + (Math.random() - 0.5) * 6 - nz * 3,
            0.35 + Math.random() * 0.4, 0.28, 0.12, 1.0, 0.7, 0.3, 1.0);
        }
      }
    }
  }

  clearEffects() {
    this.skid.clear();
    for (const ps of [this.smoke, this.sparks, this.dust]) ps.age.fill(1e9);
  }

  flash(v) { this.flashV = Math.min(0.5, this.flashV + v); }

  // -------------------------------------------------------------------------

  /**
   * ctx: { mode, car, nitro, introProgress, orbit, cars (race.cars), playerId, speedFx }
   */
  frame(dt, ctx) {
    this.time += dt;
    if (ctx.cars) this.updateCars(dt, ctx.cars, ctx.playerId);
    this.rig.setMode(ctx.mode);
    this.rig.update(dt, ctx);

    const cam = this.camera;
    this.sky.position.copy(cam.position);
    this.sky.material.uniforms.time.value = this.time;

    // il sole (e le sue ombre) seguono il punto di interesse
    const focus = ctx.car ? { x: ctx.car.x, z: ctx.car.z } : (ctx.orbit ? ctx.orbit.target : { x: 0, z: 0 });
    this.sun.position.set(focus.x + SUN_DIR.x * 200, SUN_DIR.y * 200, focus.z + SUN_DIR.z * 200);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.target.updateMatrixWorld();

    // particelle
    const uScale = (this.drawH || 720) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const ps of [this.smoke, this.sparks, this.dust]) { ps.material.uniforms.uScale.value = uScale; ps.update(dt); }
    this.skid.flush();

    // effetti schermo
    const fp = this.finalPass.uniforms;
    const speed = ctx.car ? ctx.car.speed : 0;
    let blurT = 0;
    if (this.q.radialBlur && (ctx.mode === 'race' || ctx.mode === 'intro')) {
      blurT = THREE.MathUtils.smoothstep(speed, 42, 78) * 0.34 + (ctx.nitro ? 0.5 : 0);
    }
    this.fxBlur += (blurT - this.fxBlur) * (1 - Math.exp(-6 * dt));
    fp.uBlur.value = this.fxBlur;
    fp.uAberr.value = ctx.nitro ? 0.0045 : this.fxBlur * 0.003;
    fp.uTime.value = this.time;
    this.flashV = Math.max(0, this.flashV - dt * 2.2);
    fp.uFlash.value = this.flashV;
    if (this.bloom) this.bloom.strength = 0.62 + (ctx.nitro ? 0.22 : 0);

    this.composer.render(dt);
  }
}
