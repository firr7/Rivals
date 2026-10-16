// Camera: inseguimento (3 viste), intro di gara, orbita nei menu/garage e a fine gara.

import * as THREE from '../three.js';
import { wrapAngle } from '../car-physics.js';

const ease = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'menu';
    this.view = 0;                // 0 inseguimento, 1 ravvicinata, 2 paraurti
    this.pos = new THREE.Vector3(0, 3, -8);
    this.look = new THREE.Vector3();
    this.fov = 58;
    this.heading = 0;
    this.offset = new THREE.Vector3(0, 2, -6);
    this.elastic = 0;
    this.time = 0;
    this.impactShake = 0;
    this.trans = null;
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  toggleView() { this.view = (this.view + 1) % 3; return this.view; }
  get hidesOwnCar() { return this.mode === 'race' && this.view === 2; }

  setMode(mode) {
    if (mode === this.mode) return;
    this.trans = { t: 0, dur: mode === 'race' ? 0.6 : 1.1, fromPos: this.pos.clone(), fromLook: this.look.clone(), fromFov: this.fov };
    this.mode = mode;
  }

  addImpact(v) { this.impactShake = Math.min(1.2, this.impactShake + v); }

  /**
   * ctx: { car (fisica), nitro, introProgress, orbit:{target:Vector3, radius, height, speed, angle} }
   */
  update(dt, ctx) {
    this.time += dt;
    const car = ctx.car;
    const sp = car ? car.speed : 0;
    let tp = this._p, tl = this._l, tfov = 58;

    const chaseBase = () => {
      const velAng = Math.atan2(car.vx, car.vz);
      let desired = car.heading;
      if (sp > 9) desired = car.heading + wrapAngle(velAng - car.heading) * 0.5;
      this.heading += wrapAngle(desired - this.heading) * (1 - Math.exp(-5.5 * dt));
      const el = THREE.MathUtils.clamp(car.accLong * 0.14, -1.6, 2.2);
      this.elastic += (el - this.elastic) * (1 - Math.exp(-3.5 * dt));
      const near = this.view === 1;
      const dist = (near ? 4.5 : 6.5) + sp * 0.012 + (ctx.nitro ? 0.9 : 0) + this.elastic;
      const height = (near ? 1.55 : 2.15) + sp * 0.003;
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      return { fx, fz, dist, height };
    };

    if (this.mode === 'race' && car) {
      if (this.view === 2) {
        const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        tp.set(car.x + fx * 0.35, 1.0, car.z + fz * 0.35);
        tl.set(car.x + fx * 30, 0.9, car.z + fz * 30);
        tfov = 66 + Math.min(sp / 75, 1) * 16 + (ctx.nitro ? 8 : 0);
        this.heading = car.heading;
      } else {
        const { fx, fz, dist, height } = chaseBase();
        const targetOff = new THREE.Vector3(-fx * dist, height, -fz * dist);
        this.offset.lerp(targetOff, 1 - Math.exp(-16 * dt));
        tp.set(car.x + this.offset.x, this.offset.y, car.z + this.offset.z);
        tl.set(car.x + fx * 6, 1.0 + Math.min(sp * 0.004, 0.25), car.z + fz * 6);
        tfov = 60 + Math.min(sp / 75, 1) * 15 + (ctx.nitro ? 11 : 0);
      }
    } else if (this.mode === 'intro' && car) {
      const p = ease(ctx.introProgress ?? 0);
      const { fx, fz, dist, height } = chaseBase();
      const ang = (1 - p) * 2.6;
      const bx = -fx, bz = -fz;
      const rx = bx * Math.cos(ang) + bz * Math.sin(ang);
      const rz = -bx * Math.sin(ang) + bz * Math.cos(ang);
      const r = 8.5 * (1 - p) + dist * p;
      const h = 1.1 * (1 - p) + height * p;
      tp.set(car.x + rx * r, h, car.z + rz * r);
      tl.set(car.x + fx * 4 * p, 0.8 + 0.2 * p, car.z + fz * 4 * p);
      tfov = 52 + 8 * p;
      this.offset.set(tp.x - car.x, tp.y, tp.z - car.z);
      this.heading = car.heading;
    } else if (this.mode === 'finish' && car) {
      const a = this.time * 0.45;
      tp.set(car.x + Math.cos(a) * 9.5, 3.0, car.z + Math.sin(a) * 9.5);
      tl.set(car.x, 0.9, car.z);
      tfov = 55;
    } else {
      // menu / garage: orbita attorno a un punto
      const o = ctx.orbit;
      const a = (o.angle ?? 0) + this.time * (o.speed ?? 0.12);
      tp.set(o.target.x + Math.cos(a) * o.radius, o.height, o.target.z + Math.sin(a) * o.radius);
      tl.set(o.target.x, o.target.y ?? 0.7, o.target.z);
      if (o.shift) {
        // sposta il punto guardato di lato: l'auto appare a sinistra (shift > 0) o a destra (shift < 0)
        let dx = o.target.x - tp.x, dz = o.target.z - tp.z;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        tl.x += -dz * o.shift; tl.z += dx * o.shift;
      }
      tfov = o.fov ?? 45;
    }

    // transizione morbida tra le modalità
    let px = tp.x, py = tp.y, pz = tp.z, lx = tl.x, ly = tl.y, lz = tl.z, fv = tfov;
    if (this.trans) {
      this.trans.t += dt;
      const k = ease(this.trans.t / this.trans.dur);
      px = this.trans.fromPos.x + (tp.x - this.trans.fromPos.x) * k;
      py = this.trans.fromPos.y + (tp.y - this.trans.fromPos.y) * k;
      pz = this.trans.fromPos.z + (tp.z - this.trans.fromPos.z) * k;
      lx = this.trans.fromLook.x + (tl.x - this.trans.fromLook.x) * k;
      ly = this.trans.fromLook.y + (tl.y - this.trans.fromLook.y) * k;
      lz = this.trans.fromLook.z + (tl.z - this.trans.fromLook.z) * k;
      fv = this.trans.fromFov + (tfov - this.trans.fromFov) * k;
      if (this.trans.t >= this.trans.dur) this.trans = null;
    }
    this.pos.set(px, py, pz);
    this.look.set(lx, ly, lz);
    this.fov += (fv - this.fov) * (1 - Math.exp(-5 * dt));

    // vibrazione: velocità, nitro, impatti
    this.impactShake = Math.max(0, this.impactShake - dt * 2.4);
    const speedK = Math.min(sp / 75, 1);
    const amp = (this.mode === 'race' ? speedK * speedK * 0.02 + (ctx.nitro ? 0.035 : 0) : 0) + this.impactShake * 0.22;
    const t = this.time;
    const sx = (Math.sin(t * 41.3) + Math.sin(t * 23.7 + 1.3)) * 0.5 * amp;
    const sy = (Math.sin(t * 37.9 + 2.1) + Math.sin(t * 29.1)) * 0.5 * amp;

    const cam = this.camera;
    cam.position.set(this.pos.x + sx, Math.max(this.pos.y + sy, 0.45), this.pos.z);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
