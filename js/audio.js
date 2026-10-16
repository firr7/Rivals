// Audio sintetizzato con WebAudio: motore, derapate, vento, impatti, interfaccia e musica.
// Nessun file audio da scaricare: tutto è generato in tempo reale (ottimo per una PWA offline).

import { ENGINE_LAYER_RPM, renderEngineLoop, layerWeights } from './engine-synth.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Una "voce" di motore: mescola in tempo reale i loop precalcolati più vicini al regime richiesto,
 * ritonandoli con la velocità di riproduzione. Le sorgenti si avviano solo quando servono.
 */
class EngineVoice {
  constructor(ctx, layers, dest) {
    this.ctx = ctx; this.layers = layers;
    this.out = ctx.createGain(); this.out.connect(dest);
    this.slots = layers.map(() => ({ src: null, g: null }));
    this.rpms = layers.map((l) => l.rpm);
  }

  update(rpm, t, tc = 0.04) {
    const w = layerWeights(this.rpms, clamp(rpm, this.rpms[0] * 0.75, this.rpms[this.rpms.length - 1] * 1.18));
    for (let i = 0; i < w.length; i++) {
      const slot = this.slots[i], L = this.layers[i];
      if (w[i] > 0.004) {
        if (!slot.src) {
          const src = this.ctx.createBufferSource();
          src.buffer = L.buf; src.loop = true;
          src.playbackRate.value = rpm / L.rpm;
          const g = this.ctx.createGain(); g.gain.value = 0;
          src.connect(g); g.connect(this.out);
          src.start(0, Math.random() * L.buf.duration);
          slot.src = src; slot.g = g;
        }
        slot.src.playbackRate.setTargetAtTime(rpm / L.rpm, t, tc);
        slot.g.gain.setTargetAtTime(w[i], t, 0.03);
      } else if (slot.src) {
        slot.g.gain.setTargetAtTime(0, t, 0.03);
        try { slot.src.stop(t + 0.2); } catch { /* già fermo */ }
        slot.src = null; slot.g = null;
      }
    }
  }

  stopAll() {
    for (const slot of this.slots) {
      if (slot.src) { try { slot.src.stop(); } catch { /* già fermo */ } slot.src = null; slot.g = null; }
    }
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicVol = 0.45;
    this.sfxVol = 0.8;
    this.engineOn = false;
    this.music = { timer: null, mode: null, step: 0, next: 0, bpm: 128 };
    this.rivals = [];
  }

  get ready() { return !!this.ctx; }

  /** Va chiamato dentro un gesto utente (click/touch/tasto). */
  unlock() {
    if (!this.ctx) this._create();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.setVolumes(this.musicVol, this.sfxVol);

    // buffer di rumore bianco condiviso
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this._buildEngine();
    this._buildRivals(3);
    this._buildEngineLoops();
  }

  /** Genera i loop del motore a pezzi (uno per ciclo di eventi) per non bloccare il primo tocco. */
  _buildEngineLoops() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const layers = [];
    let i = 0;
    const step = () => {
      if (this.ctx !== ctx) return;
      if (i < ENGINE_LAYER_RPM.length) {
        const { data, rpm } = renderEngineLoop(sr, ENGINE_LAYER_RPM[i], i + 1);
        const buf = ctx.createBuffer(1, data.length, sr);
        buf.copyToChannel(data, 0);
        layers.push({ buf, rpm });
        i++;
        setTimeout(step, 0);
      } else {
        this.engineLayers = layers;
        this.voice = new EngineVoice(ctx, layers, this.engLP);
        this.rivals.forEach((r) => { r.voice = new EngineVoice(ctx, layers, r.in); });
      }
    };
    setTimeout(step, 0);
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.muted ? 0 : music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.muted ? 0 : sfx, t, 0.05);
  }

  setMuted(m) { this.muted = m; this.setVolumes(this.musicVol, this.sfxVol); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  _noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  _buildEngine() {
    const c = this.ctx;
    const out = this.engineOut = c.createGain(); out.gain.value = 0; out.connect(this.sfx);
    // i loop del motore (EngineVoice) entrano in questo filtro, che si apre/chiude col gas
    const lp = this.engLP = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 0.7;
    lp.connect(out);
    // ruggito dell'aspirazione
    const nz = this._noise(); const nbp = c.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 800; nbp.Q.value = 0.8;
    this.intake = c.createGain(); this.intake.gain.value = 0;
    nz.connect(nbp); nbp.connect(this.intake); this.intake.connect(out);
    this.intakeBP = nbp; nz.start();
    // sibilo della turbina nitro: leggero, accompagnato soprattutto dal soffio d'aria
    this.turb = c.createOscillator(); this.turb.type = 'triangle'; this.turb.frequency.value = 1100;
    this.turbGain = c.createGain(); this.turbGain.gain.value = 0;
    this.turb.connect(this.turbGain); this.turbGain.connect(this.sfx); this.turb.start();
    const wz = this._noise(); const wbp = c.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 2400; wbp.Q.value = 0.5;
    this.whoosh = c.createGain(); this.whoosh.gain.value = 0;
    wz.connect(wbp); wbp.connect(this.whoosh); this.whoosh.connect(this.sfx); wz.start();
    // stridio gomme
    const sz = this._noise(); const sbp = c.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 2300; sbp.Q.value = 7;
    this.squeal = c.createGain(); this.squeal.gain.value = 0;
    sz.connect(sbp); sbp.connect(this.squeal); this.squeal.connect(this.sfx); this.squealBP = sbp; sz.start();
    // vento
    const vz = this._noise(); const vlp = c.createBiquadFilter(); vlp.type = 'lowpass'; vlp.frequency.value = 400;
    this.wind = c.createGain(); this.wind.gain.value = 0;
    vz.connect(vlp); vlp.connect(this.wind); this.wind.connect(this.sfx); this.windLP = vlp; vz.start();
    // sterrato / erba
    const rz = this._noise(); const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 220;
    this.rumble = c.createGain(); this.rumble.gain.value = 0;
    rz.connect(rlp); rlp.connect(this.rumble); this.rumble.connect(this.sfx); rz.start();
    // sfregamento sui muri
    const cz = this._noise(); const cbp = c.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 1500; cbp.Q.value = 1.4;
    this.scrape = c.createGain(); this.scrape.gain.value = 0;
    cz.connect(cbp); cbp.connect(this.scrape); this.scrape.connect(this.sfx); cz.start();
  }

  _buildRivals(n) {
    const c = this.ctx;
    for (let i = 0; i < n; i++) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      lp.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.sfx); } else g.connect(this.sfx);
      this.rivals.push({ in: lp, g, pan, lp, voice: null, awake: false, sleepAt: 0 });
    }
  }

  // -------------------------------------------------------------------------
  // Motore
  // -------------------------------------------------------------------------

  startEngine() { this.engineOn = true; }
  stopEngine() {
    this.engineOn = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const p of [this.engineOut, this.turbGain, this.whoosh, this.squeal, this.wind, this.rumble, this.scrape]) p.gain.setTargetAtTime(0, t, 0.08);
    for (const r of this.rivals) r.g.gain.setTargetAtTime(0, t, 0.08);
    // dopo la dissolvenza ferma le sorgenti per non consumare CPU in pausa/menu
    clearTimeout(this._stopTimer);
    this._stopTimer = setTimeout(() => {
      if (this.engineOn) return;
      if (this.voice) this.voice.stopAll();
      for (const r of this.rivals) { if (r.voice) r.voice.stopAll(); r.awake = false; }
    }, 400);
  }

  /** s: { rpm, throttle, speed, nitro, drift, offroad, scrape, brake } */
  updateEngine(s) {
    if (!this.ctx || !this.engineOn) return;
    const c = this.ctx, t = c.currentTime;
    const rpm = clamp(s.rpm, 800, 8200);
    // a gas aperto lo scarico "apre" (più armoniche e più volume); a gas chiuso è più scuro e basso
    const load = 0.3 + 0.7 * s.throttle;
    if (this.voice) this.voice.update(rpm, t);
    this.engLP.frequency.setTargetAtTime(500 + rpm * 0.2 + load * (900 + rpm * 0.55), t, 0.05);
    this.engineOut.gain.setTargetAtTime(0.2 + 0.26 * load, t, 0.05);
    this.intake.gain.setTargetAtTime(0.01 + 0.085 * s.throttle * (rpm / 8000), t, 0.06);
    this.intakeBP.frequency.setTargetAtTime(450 + rpm * 0.22, t, 0.06);
    const n = s.nitro ? 1 : 0;
    this.turbGain.gain.setTargetAtTime(0.012 * n, t, 0.15);
    this.turb.frequency.setTargetAtTime(900 + s.speed * 9 + n * 400, t, 0.15);
    this.whoosh.gain.setTargetAtTime(0.16 * n, t, 0.1);
    this.squeal.gain.setTargetAtTime(0.16 * clamp(s.drift, 0, 1), t, 0.05);
    this.squealBP.frequency.setTargetAtTime(1900 + 800 * clamp(s.drift, 0, 1) + s.speed * 6, t, 0.08);
    const sp = clamp(s.speed / 75, 0, 1);
    this.wind.gain.setTargetAtTime(0.02 + 0.18 * sp * sp, t, 0.1);
    this.windLP.frequency.setTargetAtTime(300 + sp * 1800, t, 0.1);
    this.rumble.gain.setTargetAtTime(s.offroad ? 0.22 * clamp(s.speed / 30, 0, 1) : 0, t, 0.08);
    this.scrape.gain.setTargetAtTime(0.2 * clamp(s.scrape, 0, 1), t, 0.04);
  }

  /** list: [{ rpm, dist, pan }] (massimo 3). */
  updateRivals(list) {
    if (!this.ctx || !this.engineOn) return;
    const t = this.ctx.currentTime;
    this.rivals.forEach((r, i) => {
      const d = list[i];
      if (!r.voice) return;
      if (!d) {
        r.g.gain.setTargetAtTime(0, t, 0.1);
        if (r.awake) { r.awake = false; r.sleepAt = t + 0.6; }
        else if (r.sleepAt && t > r.sleepAt) { r.voice.stopAll(); r.sleepAt = 0; }
        return;
      }
      r.awake = true; r.sleepAt = 0;
      r.voice.update(clamp(d.rpm, 800, 8200), t, 0.06);
      r.lp.frequency.setTargetAtTime(500 + d.rpm * 0.25, t, 0.08);
      r.g.gain.setTargetAtTime(0.42 / (1 + (d.dist / 16) * (d.dist / 16)), t, 0.08);
      if (r.pan) r.pan.pan.setTargetAtTime(clamp(d.pan, -1, 1), t, 0.08);
    });
  }

  // -------------------------------------------------------------------------
  // Effetti one-shot
  // -------------------------------------------------------------------------

  _tone(freq, dur, { type = 'sine', vol = 0.2, slide = null, attack = 0.005, when = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _burst(dur, { freq = 800, q = 1, type = 'bandpass', vol = 0.3, when = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = this._noise(false);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfx);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  crash(intensity) {
    const i = clamp(intensity / 22, 0.1, 1);
    this._burst(0.25 + i * 0.4, { freq: 500 + 500 * (1 - i), q: 0.6, type: 'lowpass', vol: 0.4 + 0.5 * i });
    this._burst(0.12, { freq: 2600, q: 1, vol: 0.15 * i });
    this._tone(110, 0.3, { type: 'sine', vol: 0.5 * i + 0.1, slide: 40 });
  }
  shift() { this._burst(0.05, { freq: 1600, q: 3, vol: 0.08 }); }
  backfire() { this._burst(0.09, { freq: 450, q: 0.7, type: 'lowpass', vol: 0.3 }); this._tone(90, 0.08, { type: 'square', vol: 0.06, slide: 50 }); }
  nitroStart() { this._burst(0.5, { freq: 3000, q: 0.5, vol: 0.18 }); this._tone(300, 0.4, { type: 'sawtooth', vol: 0.05, slide: 1200 }); }
  count(n) { this._tone(n === 0 ? 880 : 520, n === 0 ? 0.55 : 0.2, { type: 'square', vol: n === 0 ? 0.13 : 0.1 }); }
  lap() { this._tone(660, 0.18, { type: 'triangle', vol: 0.18 }); this._tone(990, 0.28, { type: 'triangle', vol: 0.18, when: 0.12 }); }
  finish(win) {
    const seq = win ? [523, 659, 784, 1047, 1319] : [440, 523, 659, 784];
    seq.forEach((f, i) => this._tone(f, 0.35, { type: 'triangle', vol: 0.2, when: i * 0.11 }));
  }
  place(up) { this._tone(up ? 880 : 330, 0.12, { type: 'triangle', vol: 0.1 }); if (up) this._tone(1175, 0.14, { type: 'triangle', vol: 0.1, when: 0.09 }); }
  uiClick() { this._tone(620, 0.09, { type: 'square', vol: 0.07, slide: 380 }); }
  uiHover() { this._tone(980, 0.04, { type: 'sine', vol: 0.035 }); }
  uiBack() { this._tone(420, 0.1, { type: 'square', vol: 0.06, slide: 260 }); }
  respawn() { this._tone(200, 0.3, { type: 'sine', vol: 0.12, slide: 700 }); }
  warning() { this._tone(740, 0.12, { type: 'square', vol: 0.06 }); this._tone(740, 0.12, { type: 'square', vol: 0.06, when: 0.18 }); }

  // -------------------------------------------------------------------------
  // Musica sequenziata (synthwave): menu rilassato, gara più intensa
  // -------------------------------------------------------------------------

  startMusic(mode) {
    if (!this.ctx) return;
    const m = this.music;
    if (m.mode === mode && m.timer) return;
    this.stopMusic();
    m.mode = mode; m.step = 0; m.bpm = mode === 'race' ? 138 : 100;
    m.next = this.ctx.currentTime + 0.15;
    m.timer = setInterval(() => this._schedule(), 30);
  }

  stopMusic() {
    const m = this.music;
    if (m.timer) clearInterval(m.timer);
    m.timer = null; m.mode = null;
  }

  _schedule() {
    const c = this.ctx, m = this.music;
    if (!c || c.state !== 'running') { m.next = (c ? c.currentTime : 0) + 0.1; return; }
    const dur = 60 / m.bpm / 4;
    while (m.next < c.currentTime + 0.2) {
      this._step(m.step, m.next, dur, m.mode === 'race');
      m.next += dur; m.step++;
    }
  }

  _step(step, t, dur, race) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    // Am - F - C - G
    const roots = [45, 41, 48, 43];
    const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
    const root = roots[bar], chord = chords[bar];
    const bus = this.musicBus;
    // batteria
    if (race ? (s % 4 === 0) : (s === 0 || s === 8 || s === 10)) this._kick(t, bus);
    if (s === 4 || s === 12) this._snare(t, bus);
    if (race ? true : s % 2 === 0) this._hat(t, bus, s % 4 === 2, race ? 0.05 : 0.03);
    // basso
    if (race) {
      if (s % 2 === 0 || s % 4 === 3) this._synth(t, mtof(root + (s % 8 === 6 ? 12 : 0)), dur * 1.8, { type: 'sawtooth', vol: 0.11, cutoff: 520, bus });
    } else if (s === 0 || s === 6 || s === 10) {
      this._synth(t, mtof(root), dur * 3.5, { type: 'sawtooth', vol: 0.1, cutoff: 420, bus });
    }
    // arpeggio
    const arpOrder = [0, 1, 2, 1, 0, 2, 1, 2];
    if (race ? true : s % 2 === 0) {
      const note = chord[arpOrder[(race ? s : s / 2) % 8]] + 12;
      this._synth(t, mtof(note), dur * 1.6, { type: 'square', vol: race ? 0.035 : 0.03, cutoff: 2400, bus, attack: 0.004 });
    }
    // pad lungo a inizio battuta
    if (s === 0) for (const n of chord) this._synth(t, mtof(n + 12), dur * 15, { type: 'sawtooth', vol: 0.02, cutoff: 1100, bus, attack: 0.25 });
    // melodia nelle battute 2 e 4 (solo gara)
    if (race && (bar === 1 || bar === 3) && (s === 0 || s === 3 || s === 8 || s === 11)) {
      this._synth(t, mtof(chord[2] + 24 - (s > 4 ? 2 : 0)), dur * 2.4, { type: 'sawtooth', vol: 0.04, cutoff: 3200, bus });
    }
  }

  _synth(t, freq, dur, { type = 'sawtooth', vol = 0.1, cutoff = 1200, bus, attack = 0.008 }) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.Q.value = 3;
    f.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.35, 80), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _kick(t, bus) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.25);
  }
  _snare(t, bus) {
    this._burst(0.14, { freq: 1900, q: 0.8, vol: 0.2, when: t - this.ctx.currentTime, bus });
    const c = this.ctx; const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.12);
  }
  _hat(t, bus, open, vol) {
    this._burst(open ? 0.12 : 0.04, { freq: 7500, q: 0.7, type: 'highpass', vol, when: t - this.ctx.currentTime, bus });
  }
}
