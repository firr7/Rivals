// Input unificato: tastiera, gamepad e controlli touch su schermo.

import { clamp, smoothstep } from './car-physics.js';

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false, drift: false };
    this.pointers = new Map();
    this.edges = { camera: false, pause: false, mute: false, reset: false, confirm: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, reset: false };
    this.autoGas = false;
    this.steerAssist = true;
    this.steerSens = 1;      // 0.7 morbido · 1 normale · 1.4 pronto: velocità con cui lo sterzo digitale sale/torna al centro
    this.usingTouch = false;
    this.enabled = true;
    this.padPrev = [];
    this._steer = 0;
    this.touchRoot = null;
  }

  attach(touchRoot) {
    window.addEventListener('keydown', (e) => this._key(e, true), { passive: false });
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this._releaseTouch(); });
    if (touchRoot) this._attachTouch(touchRoot);
  }

  _key(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    if (this.enabled && PREVENT.has(e.code)) e.preventDefault();
    const code = e.code;
    if (down) {
      if (!e.repeat) {
        if (code === 'KeyC') this.edges.camera = true;
        else if (code === 'Escape' || code === 'KeyP') this.edges.pause = true;
        else if (code === 'KeyM') this.edges.mute = true;
        else if (code === 'KeyR') this.edges.reset = true;
        else if (code === 'Enter' || code === 'NumpadEnter') this.edges.confirm = true;
      }
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  _attachTouch(root) {
    this.touchRoot = root;
    const press = (btn, el, id, down) => {
      this.touch[btn] = down;
      el.classList.toggle('on', down);
      if (down) this.pointers.set(id, { btn, el }); else this.pointers.delete(id);
    };
    root.querySelectorAll('[data-k]').forEach((el) => {
      const btn = el.dataset.k;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignora */ }
        press(btn, el, e.pointerId, true);
      });
      const up = (e) => { press(btn, el, e.pointerId, false); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    const pauseBtn = root.querySelector('[data-pause]');
    if (pauseBtn) pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.edges.pause = true; });
  }

  _releaseTouch() {
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
    this.pointers.clear();
    if (this.touchRoot) this.touchRoot.querySelectorAll('[data-k].on').forEach((el) => el.classList.remove('on'));
  }

  consume(name) {
    const v = this.edges[name];
    this.edges[name] = false;
    return v;
  }

  clearEdges() { for (const k of Object.keys(this.edges)) this.edges[k] = false; }

  _pad() {
    const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Aggiorna lo stato; `speed` (m/s) serve per attenuare lo sterzo digitale alle alte velocità. */
  update(dt, speed = 0) {
    const k = this.keys;
    let throttle = 0, brake = 0, steerTarget = 0, hb = false, nitro = false;
    let analogSteer = null;

    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('ArrowLeft') || k.has('KeyA')) steerTarget -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steerTarget += 1;
    if (k.has('Space')) hb = true;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN') || k.has('KeyE')) nitro = true;

    const t = this.touch;
    if (t.gas) throttle = 1;
    if (t.brake) brake = 1;
    if (t.left) steerTarget -= 1;
    if (t.right) steerTarget += 1;
    if (t.drift) hb = true;
    if (t.nitro) nitro = true;

    const pad = this._pad();
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const ax = dz(pad.axes[0] || 0);
      if (ax !== 0) analogSteer = ax;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.04) throttle = Math.max(throttle, rt);
      if (lt > 0.04) brake = Math.max(brake, lt);
      if (pad.buttons[0] && pad.buttons[0].pressed) nitro = true;
      if (pad.buttons[5] && pad.buttons[5].pressed) nitro = true;
      if ((pad.buttons[1] && pad.buttons[1].pressed) || (pad.buttons[2] && pad.buttons[2].pressed)) hb = true;
      if (pad.buttons[12] && pad.buttons[12].pressed) throttle = 1;
      if (pad.buttons[13] && pad.buttons[13].pressed) brake = 1;
      if (pad.buttons[14] && pad.buttons[14].pressed) steerTarget -= 1;
      if (pad.buttons[15] && pad.buttons[15].pressed) steerTarget += 1;
      const pressedNow = pad.buttons.map((b) => b && b.pressed);
      const edge = (i) => pressedNow[i] && !this.padPrev[i];
      if (edge(3)) this.edges.camera = true;
      if (edge(9)) this.edges.pause = true;
      if (edge(4)) this.edges.reset = true;
      if (edge(0)) this.edges.confirm = true;
      this.padPrev = pressedNow;
    }

    if (this.autoGas && !brake) throttle = 1;

    // sterzo: digitale con rampa dipendente dalla velocità, analogico diretto
    const sp = smoothstep(8, 70, speed);
    let steer;
    const sens = clamp(this.steerSens || 1, 0.5, 2);
    if (analogSteer !== null && steerTarget === 0) {
      // curva progressiva: piccole correzioni dolci, fondo corsa pieno
      const a = Math.abs(analogSteer);
      steer = Math.sign(analogSteer) * (0.55 * a + 0.45 * a * a);
      this._steer += (steer - this._steer) * (1 - Math.exp(-18 * sens * dt));
    } else {
      const rise = (8.0 - 3.5 * sp) * sens;
      const fall = (10.5 - 3.0 * sp) * sens;
      const rate = steerTarget !== 0 && Math.sign(steerTarget) === Math.sign(this._steer || steerTarget) ? rise : fall;
      const target = clamp(steerTarget, -1, 1) * (this.steerAssist ? 1 - 0.08 * sp : 1);
      const d = target - this._steer;
      const maxStep = rate * dt;
      this._steer += clamp(d, -maxStep, maxStep);
    }
    const s = this.state;
    s.throttle = throttle; s.brake = brake; s.steer = clamp(this._steer, -1, 1);
    s.handbrake = hb; s.nitro = nitro;
    s.reset = this.consume('reset');
    return s;
  }

  reset() {
    this.keys.clear();
    this._releaseTouch();
    this._steer = 0;
    this.clearEdges();
  }
}
