// Controller del gioco: macchina a stati (menu → garage → gara → risultati), loop principale.

import { GAME, CARS, QUALITY, KMH, MPH } from './config.js';
import { buildTrack, TRACKS } from './track-data.js';
import { createRace, stepRace, drainEvents } from './race.js';
import { makeCar } from './car-physics.js';
import { World } from './gfx/world.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Store, fmtTime } from './storage.js';

const $ = (s) => document.querySelector(s);

function detectQuality(renderer) {
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  let soft = false;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    soft = /swiftshader|llvmpipe|software|basic render/i.test(r);
  } catch { /* ignora */ }
  if (soft) return 'low';
  if (coarse) return (mem <= 3 || cores <= 4) ? 'low' : 'medium';
  return 'high';
}

export class Game {
  constructor() {
    this.settings = Store.settings;
    this.track = buildTrack(TRACKS.downtown);
    this.carDef = CARS[0];
    this.state = 'loading';
    this.race = null;
    this.audio = new AudioEngine();
    this.audio.musicVol = this.settings.musicVolume;
    this.audio.sfxVol = this.settings.sfxVolume;
    this.input = new Input();
    this.input.autoGas = this.settings.autoGas;
    this.input.steerAssist = this.settings.steerAssist;
    this.input.steerSens = Number(this.settings.steerSens) || 1;
    this.ui = new UI({
      onAction: (a, el) => this.onAction(a, el),
      onOption: (k, v) => this.onOption(k, v),
      sfx: {
        click: () => this.audio.uiClick(),
        hover: () => this.audio.uiHover(),
        back: () => this.audio.uiBack(),
      },
    });
    this.lastT = 0;
    this.fps = 60;
    this.touchSeen = false;
    this.nitroWas = false;
    this.finishTimer = 0;
    this.resultsShown = false;
    this.deferredInstall = null;
  }

  // -----------------------------------------------------------------------
  async init() {
    const ui = this.ui;
    ui.setVersion(GAME.version);
    ui.setLoading(0.05, 'Costruzione del circuito…');
    await new Promise((r) => setTimeout(r, 30));

    const canvas = $('#gl');
    this.world = new World(canvas, this.track, { quality: 'medium' });
    const urlQ = new URLSearchParams(location.search).get('quality');
    let q;
    if (urlQ && QUALITY[urlQ]) q = urlQ;
    else if (this.settings.quality !== 'auto') q = this.settings.quality;
    else q = detectQuality(this.world.renderer);
    this.world.autoQuality = this.settings.quality === 'auto' && !urlQ;
    this.world.setQuality(q);

    ui.setLoading(0.2, 'Accensione dei motori…');
    await new Promise((r) => setTimeout(r, 30));
    await this.world.init();
    ui.setLoading(0.85, 'Preparazione del garage…');
    await new Promise((r) => setTimeout(r, 30));

    // controlli e app
    this.input.attach($('#touch'));
    this._bindGlobal();
    this._applyTouchUi();
    ui.buildOptions(this.settings);
    ui.buildGarage(this.carDef, this.track, Store.garage.color, (i) => this.onColor(i));
    ui.setMenuRecords(Store.records);
    ui.initMinimap(this.track);
    this._setupShowcase();

    ui.setLoading(1, 'Pronto!');
    await new Promise((r) => setTimeout(r, 180));
    ui.endLoading();
    this.goMenu();
    this.lastT = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _bindGlobal() {
    window.addEventListener('resize', () => this.world.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.world.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend();
        if (this.state === 'racing' && this.race && this.race.phase !== 'finished') this.pause();
      } else { this.audio.resume(); this.lastT = performance.now(); }
    });
    const unlock = () => {
      this.audio.unlock();
      this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
      this._syncMusic();
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));
    window.addEventListener('touchstart', () => { if (!this.touchSeen) { this.touchSeen = true; this._applyTouchUi(); } }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    const fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (!fsOk) $('#btn-fullscreen').hidden = true;
  }

  _applyTouchUi() {
    const mode = this.settings.touchControls;
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const on = mode === 'on' || (mode === 'auto' && (coarse || this.touchSeen));
    document.body.classList.toggle('touch-ui', on);
  }

  _setupShowcase() {
    const spot = this.world.showcaseSpot(72, 0);
    this.spot = spot;
    const car = makeCar(this.carDef.physics, spot.x, spot.z, spot.heading);
    this.showRc = { id: 0, isPlayer: true, car, info: { d: 0, nx: 0, nz: 0 } };
  }

  get colorHex() { return this.carDef.colors[Store.garage.color]?.hex || this.carDef.colors[0].hex; }

  _showcaseCars() {
    this.world.setCars([{ id: 0, color: this.colorHex }]);
    this.world.clearEffects();
  }

  // -----------------------------------------------------------------------
  // Stati
  // -----------------------------------------------------------------------

  goMenu() {
    this.state = 'menu';
    this.race = null;
    this.audio.stopEngine();
    this._showcaseCars();
    this.ui.only(['screen-menu']);
    this.ui.setMenuRecords(Store.records);
    this.ui.navEnabled = true;
    this._syncMusic();
    $('#btn-install').hidden = !this.deferredInstall;
  }

  goGarage() {
    this.state = 'garage';
    this.ui.only(['screen-garage']);
    this.ui.buildGarage(this.carDef, this.track, Store.garage.color, (i) => this.onColor(i));
  }

  onColor(i) {
    Store.setGarage({ color: i });
    const v = this.world.getView(0);
    if (v) v.setColor(this.colorHex);
  }

  _syncMusic() {
    if (!this.audio.ready) return;
    const mode = (this.state === 'racing' || this.state === 'paused' || this.state === 'results') ? 'race' : 'menu';
    this.audio.startMusic(mode);
  }

  startRace() {
    const s = this.settings;
    const race = createRace({
      track: this.track, spec: this.carDef.physics,
      playerName: 'TU', playerColor: this.colorHex,
      rivalCount: GAME.rivals, laps: Number(s.laps) || GAME.laps, difficulty: s.difficulty,
      seed: (Date.now() & 0xffff) + 1,
    });
    this.race = race;
    this.world.setCars(race.cars.map((rc) => ({ id: rc.id, color: rc.color })));
    this.world.clearEffects();
    this.world.rig.view = 0;
    this.ui.setHudStatic(race.cars.length, race.laps);
    this.ui.initMinimap(this.track);
    this.ui.only(['hud', 'touch']);
    this.ui.navEnabled = false;
    this.input.reset();
    this.input.autoGas = s.autoGas;
    this.input.steerAssist = s.steerAssist;
    this.input.steerSens = Number(s.steerSens) || 1;
    this.state = 'racing';
    this.finishTimer = 0; this.resultsShown = false; this.nitroWas = false;
    this.lastCtx = null;
    this.audio.unlock();
    this.audio.startEngine();
    this._syncMusic();
    // piccolo promemoria dei comandi
    this.ui.hudToast(document.body.classList.contains('touch-ui') ? 'GAS per partire · NITRO sui rettilinei' : 'W/↑ gas · SHIFT nitro · SPAZIO drift · C visuale', '');
  }

  pause() {
    if (this.state !== 'racing') return;
    this.state = 'paused';
    this.audio.stopEngine();
    this.ui.show('screen-pause');
    this.ui.navEnabled = true;
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'racing';
    this.ui.hide('screen-pause');
    this.ui.navEnabled = false;
    this.input.reset();
    this.audio.startEngine();
    this.lastT = performance.now();
  }

  // -----------------------------------------------------------------------
  onAction(act, el) {
    this.audio.unlock();
    switch (act) {
      case 'play': this.goGarage(); break;
      case 'back': this.goMenu(); break;
      case 'race': this.startRace(); break;
      case 'options': this.ui.buildOptions(this.settings); this.ui.show('screen-options'); break;
      case 'close-options': this.ui.hide('screen-options'); break;
      case 'controls': this.ui.show('screen-controls'); break;
      case 'close-controls': this.ui.hide('screen-controls'); break;
      case 'resume': this.resume(); break;
      case 'restart': this.ui.hide('screen-pause'); this.startRace(); break;
      case 'rematch': this.ui.hide('screen-results'); this.startRace(); break;
      case 'quit': this.ui.hide('screen-pause'); this.ui.hide('screen-results'); this.goMenu(); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'install': this.install(); break;
      default: break;
    }
  }

  onOption(key, value) {
    const s = this.settings;
    if (key === '__resetRecords') { Store.resetRecords(); this.ui.setMenuRecords(Store.records); return; }
    Store.setSettings({ [key]: value });
    switch (key) {
      case 'quality': {
        const q = value === 'auto' ? detectQuality(this.world.renderer) : value;
        this.world.autoQuality = value === 'auto';
        this.world.dynScale = 1;
        this.world.setQuality(q);
        break;
      }
      case 'musicVolume': case 'sfxVolume': this.audio.setVolumes(s.musicVolume, s.sfxVolume); break;
      case 'autoGas': this.input.autoGas = !!value; break;
      case 'steerAssist': this.input.steerAssist = !!value; break;
      case 'steerSens': this.input.steerSens = Number(value) || 1; break;
      case 'touchControls': this._applyTouchUi(); break;
      default: break;
    }
  }

  toggleFullscreen() {
    const d = document, el = d.documentElement;
    const inFs = d.fullscreenElement || d.webkitFullscreenElement;
    if (inFs) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(el)).then(() => {
        try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch { /* ignora */ }
      }).catch(() => {});
    }
  }

  async install() {
    const ev = this.deferredInstall;
    if (!ev) return;
    ev.prompt();
    try { await ev.userChoice; } catch { /* ignora */ }
    this.deferredInstall = null;
    $('#btn-install').hidden = true;
  }

  setInstallEvent(ev) {
    this.deferredInstall = ev;
    if (this.state === 'menu') $('#btn-install').hidden = !ev;
  }

  // -----------------------------------------------------------------------
  // Loop
  // -----------------------------------------------------------------------

  _loop(t) {
    requestAnimationFrame((tt) => this._loop(tt));
    const dt = Math.min(Math.max((t - this.lastT) / 1000, 0), 0.1);
    this.lastT = t;
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * 0.05;
    this.world.perfTick(dt);
    if (this.input.consume('mute')) {
      const m = this.audio.toggleMute();
      this.ui.toast(m ? 'Audio disattivato' : 'Audio attivato', 1200);
    }

    switch (this.state) {
      case 'menu': this._frameShowcase(dt, 'menu'); break;
      case 'garage': this._frameShowcase(dt, 'garage'); break;
      case 'racing': this._frameRace(dt); break;
      case 'paused': this._framePaused(dt); break;
      case 'results': this._frameRace(dt, true); break;
      default: break;
    }
  }

  _frameShowcase(dt, mode) {
    this.input.clearEdges();
    const sp = this.spot;
    const orbit = mode === 'garage'
      ? { target: { x: sp.x, y: 0.62, z: sp.z }, radius: 9.8, height: 1.55, speed: 0.16, angle: 0.8, fov: 34, shift: 1.25 }
      : { target: { x: sp.x, y: 0.66, z: sp.z }, radius: 8.8, height: 2.1, speed: 0.06, angle: 0.55, fov: 42, shift: -2.3 };
    this.world.frame(dt, { mode, orbit, cars: [this.showRc], playerId: 0, car: null });
  }

  _framePaused(dt) {
    if (this.input.consume('pause')) { this.ui.sfx.back(); this.resume(); return; }
    this.input.clearEdges();
    if (this.lastCtx) this.world.frame(0, this.lastCtx);
  }

  _frameRace(dt, afterResults = false) {
    const race = this.race;
    if (!race) return;
    const player = race.player, car = player.car;

    if (!afterResults) {
      if (this.input.consume('pause')) { this.pause(); return; }
      if (this.input.consume('camera')) {
        const v = this.world.rig.toggleView();
        this.ui.hudToast(['VISUALE: INSEGUIMENTO', 'VISUALE: RAVVICINATA', 'VISUALE: PARAURTI'][v]);
      }
    } else {
      this.input.clearEdges();
    }
    const live = race.phase === 'running';
    const inputState = this.input.update(dt, car.speed);
    stepRace(race, dt, live ? inputState : { ...inputState, reset: false });

    this._handleEvents(drainEvents(race));
    this._updateAudio(race);

    // fotocamera
    let mode, introProgress = 0;
    if (race.phase === 'intro' || race.phase === 'countdown') {
      mode = 'intro';
      const total = 1.4 + GAME.countdownSeconds;
      const remain = Math.max(race.introTimer, 0) + Math.max(race.countdown, 0);
      introProgress = Math.min(1, Math.max(0, 1 - remain / total));
    } else if (race.phase === 'finished') mode = 'finish';
    else mode = 'race';

    const ctx = {
      mode, car, nitro: car.nitroActive, introProgress,
      cars: race.cars, playerId: player.id,
    };
    this.lastCtx = ctx;
    this.world.frame(dt, ctx);

    // risultati dopo il traguardo
    if (race.phase === 'finished' && !this.resultsShown) {
      this.finishTimer += dt;
      if (this.finishTimer > 3.4) this._showResults();
    }

    this._updateHud(race);
  }

  _updateHud(race) {
    const p = race.player, car = p.car;
    const unitK = this.settings.units === 'mph' ? MPH : KMH;
    const lapIdx = Math.min(p.prog.lapsDone + 1, race.laps);
    const live = race.phase === 'running' || race.phase === 'finished';
    const finishedT = p.prog.finished ? p.prog.finishTime : race.time;
    this.ui.updateHud({
      place: p.prog.place, lap: lapIdx,
      time: live ? finishedT : 0,
      lapTime: live && !p.prog.finished ? race.time - p.prog.lapStart : (p.prog.lapTimes.at(-1) ?? 0),
      bestLap: isFinite(p.prog.bestLap) ? p.prog.bestLap : null,
      speedDisplay: Math.abs(car.vf) * unitK, unit: this.settings.units === 'mph' ? 'MPH' : 'KM/H',
      rpm: car.rpm, gear: car.gear, reversing: car.reversing && car.vf < -0.5,
      nitro: car.nitro, nitroActive: car.nitroActive, nitroLock: car.nitroLock,
      wrongWay: race.playerWrongWay && race.phase === 'running',
      cars: race.cars.map((rc) => ({ x: rc.car.x, z: rc.car.z, heading: rc.car.heading, color: rc.color, isPlayer: rc.isPlayer })),
      fps: this.fps, showFps: this.settings.showFps,
    });
  }

  _handleEvents(events) {
    const race = this.race, ui = this.ui, audio = this.audio;
    for (const e of events) {
      switch (e.type) {
        case 'count': ui.message(String(e.n), 'count'); audio.count(e.n); break;
        case 'go': ui.message('VIA!', 'go'); audio.count(0); break;
        case 'lap': {
          if (!e.car.isPlayer) break;
          const rec = Store.noteLap(e.lapTime);
          audio.lap();
          const last = e.lap === race.laps;
          ui.message(last ? 'ULTIMO GIRO!' : `GIRO ${e.lap}/${race.laps}`, 'big', fmtTime(e.lapTime));
          if (rec) ui.hudToast('NUOVO RECORD SUL GIRO!', 'good');
          else if (e.best) ui.hudToast('MIGLIOR GIRO DELLA GARA', 'good');
          break;
        }
        case 'finish': {
          if (e.car.isPlayer) {
            const place = e.car.prog.place;
            ui.message('TRAGUARDO!', 'big', place === 1 ? 'HAI VINTO!' : `${place}° POSTO`);
            audio.finish(place === 1);
          }
          break;
        }
        case 'crash': {
          const involvesPlayer = e.kind === 'wall' ? e.car.isPlayer : (e.a.isPlayer || e.b.isPlayer);
          if (involvesPlayer) {
            audio.crash(e.intensity);
            this.world.rig.addImpact(Math.min(1, e.intensity / 18));
            if (e.intensity > 14) this.world.flash(0.12);
          }
          break;
        }
        case 'place':
          if (e.place < e.from) { ui.hudToast(`POSIZIONE GUADAGNATA: ${e.place}°`, 'good'); audio.place(true); }
          else if (e.place > e.from) { ui.hudToast(`SORPASSATO: ${e.place}°`, 'bad'); audio.place(false); }
          break;
        case 'respawn':
          if (e.car.isPlayer) { audio.respawn(); ui.hudToast('RIMESSO IN PISTA', ''); }
          break;
        default: break;
      }
    }
  }

  _updateAudio(race) {
    const a = this.audio;
    if (!a.ready) return;
    const car = race.player.car;
    if (car.nitroActive && !this.nitroWas) a.nitroStart();
    this.nitroWas = car.nitroActive;
    if (car.shifted === 1) { a.shift(); if (car.throttle > 0.7 && car.rpm > 3000 && Math.random() < 0.5) a.backfire(); }
    a.updateEngine({
      rpm: car.rpm, throttle: car.throttle, speed: car.speed, nitro: car.nitroActive,
      drift: car.drift, offroad: car.surfaceDrag > 1, scrape: car.scrape, brake: car.brake,
    });
    const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
    const list = [];
    for (const rc of race.cars) {
      if (rc.isPlayer || list.length >= 3) continue;
      const dx = rc.car.x - car.x, dz = rc.car.z - car.z;
      const dist = Math.hypot(dx, dz);
      const pan = (dx * -hz + dz * hx) / Math.max(dist, 6);
      list.push({ rpm: rc.car.rpm, dist, pan: -pan * -1 });
    }
    a.updateRivals(list);
  }

  _showResults() {
    const race = this.race;
    this.resultsShown = true;
    this.state = 'results';
    this.audio.stopEngine();
    const p = race.player;
    const L = race.track.length;
    const rows = race.standings.map((rc, i) => {
      let time;
      if (rc.prog.finished) time = fmtTime(rc.prog.finishTime);
      else {
        const remain = Math.max(0, race.laps * L - rc.prog.total);
        const avg = Math.max(30, (race.laps * L) / Math.max(race.time, 1));
        time = '~' + fmtTime(race.time + remain / avg);
      }
      return {
        place: i + 1, name: rc.name, me: rc.isPlayer, time,
        best: isFinite(rc.prog.bestLap) ? fmtTime(rc.prog.bestLap) : '--:--.--',
      };
    });
    const place = p.prog.place;
    const res = Store.addRaceResult({ place, time: p.prog.finishTime, bestLap: isFinite(p.prog.bestLap) ? p.prog.bestLap : null });
    const badges = [];
    if (place === 1) badges.push('VITTORIA');
    if (res.newBestLap) badges.push('NUOVO RECORD SUL GIRO');
    if (res.newBestRace) badges.push('NUOVO RECORD DI GARA');
    this.ui.hide('hud'); this.ui.hide('touch');
    this.ui.showResults({ place, total: race.cars.length, rows, badges });
    this.ui.show('screen-results');
    this.ui.navEnabled = true;
    this.ui.setMenuRecords(Store.records);
  }
}
