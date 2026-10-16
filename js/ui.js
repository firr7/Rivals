// Interfaccia: schermate, HUD (tachimetro e minimappa disegnati su canvas), opzioni, garage.

import { fmtTime } from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);

export const OPTIONS = [
  { key: 'quality', label: 'GRAFICA', type: 'seg', values: [['auto', 'AUTO'], ['low', 'BASSA'], ['medium', 'MEDIA'], ['high', 'ALTA']] },
  { key: 'difficulty', label: 'DIFFICOLTÀ', type: 'seg', values: [['easy', 'FACILE'], ['normal', 'NORMALE'], ['hard', 'DIFFICILE']] },
  { key: 'laps', label: 'GIRI', type: 'seg', values: [[1, '1'], [2, '2'], [3, '3'], [5, '5']] },
  { key: 'musicVolume', label: 'MUSICA', type: 'range' },
  { key: 'sfxVolume', label: 'EFFETTI', type: 'range' },
  { key: 'autoGas', label: 'ACCELERAZIONE AUTOMATICA', type: 'switch' },
  { key: 'steerSens', label: 'SENSIBILITÀ STERZO', type: 'seg', values: [[0.7, 'MORBIDA'], [1, 'NORMALE'], [1.4, 'PRONTA']] },
  { key: 'steerAssist', label: 'ASSISTENZA STERZO', type: 'switch' },
  { key: 'units', label: 'UNITÀ DI VELOCITÀ', type: 'seg', values: [['kmh', 'KM/H'], ['mph', 'MPH']] },
  { key: 'touchControls', label: 'CONTROLLI TOUCH', type: 'seg', values: [['auto', 'AUTO'], ['on', 'SÌ'], ['off', 'NO']] },
  { key: 'showFps', label: 'MOSTRA FPS', type: 'switch' },
];

// ---------------------------------------------------------------------------
// Tachimetro
// ---------------------------------------------------------------------------

class Gauge {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.W = canvas.width;
    this.start = Math.PI * 0.75;
    this.sweep = Math.PI * 1.5;
    this.bg = this._bg();
    this.flash = 0;
  }

  _bg() {
    const W = this.W, c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    const cx = W / 2, R = W * 0.46;
    const rg = g.createRadialGradient(cx, cx, R * 0.2, cx, cx, R * 1.08);
    rg.addColorStop(0, 'rgba(16,12,22,0.55)'); rg.addColorStop(0.85, 'rgba(10,8,16,0.8)'); rg.addColorStop(1, 'rgba(10,8,16,0.2)');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cx, R * 1.07, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,150,60,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cx, R * 1.06, this.start - 0.05, this.start + this.sweep + 0.05); g.stroke();
    // tacche
    for (let i = 0; i <= 80; i++) {
      const a = this.start + this.sweep * (i / 80);
      const major = i % 10 === 0;
      const r0 = R * (major ? 0.70 : 0.75), r1 = R * 0.80;
      g.strokeStyle = i >= 68 ? '#ff5a3c' : (major ? '#ffffff' : 'rgba(255,255,255,0.45)');
      g.lineWidth = major ? 3.5 : 1.6;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
      if (major) {
        const rr = R * 0.58;
        g.fillStyle = i >= 70 ? '#ff7a62' : '#e9e2da';
        g.font = '700 22px Orbitron, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i / 10), cx + Math.cos(a) * rr, cx + Math.sin(a) * rr);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.font = '700 13px Rajdhani, sans-serif'; g.textAlign = 'center';
    g.fillText('x1000 RPM', cx, cx + R * 0.68);
    return c;
  }

  draw({ speed, unit, rpm, gear, reversing, nitro, redline }) {
    const g = this.g, W = this.W, cx = W / 2, R = W * 0.46;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.bg, 0, 0);
    // segmenti dei giri motore
    const N = 40, gap = 0.012;
    const seg = this.sweep / N;
    for (let j = 0; j < N; j++) {
      const a0 = this.start + seg * j + gap, a1 = this.start + seg * (j + 1) - gap;
      const lit = ((j + 1) / N) * 8000 <= rpm + 100;
      let col;
      if (j >= 33) col = lit ? '#ff3b2a' : 'rgba(255,59,42,0.16)';
      else if (j >= 26) col = lit ? '#ffc02a' : 'rgba(255,190,40,0.14)';
      else col = lit ? '#ff9a2a' : 'rgba(255,255,255,0.1)';
      g.strokeStyle = col; g.lineWidth = 15;
      if (lit) { g.shadowColor = col; g.shadowBlur = 12; } else g.shadowBlur = 0;
      g.beginPath(); g.arc(cx, cx, R * 0.93, a0, a1); g.stroke();
    }
    g.shadowBlur = 0;
    // spia nitro attorno al bordo interno quando attivo
    if (nitro) {
      g.strokeStyle = 'rgba(110,200,255,0.85)'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, cx, R * 1.06, this.start, this.start + this.sweep); g.stroke();
    }
    // velocità digitale
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(255,140,40,0.7)'; g.shadowBlur = 14;
    g.font = 'italic 900 84px Orbitron, sans-serif';
    g.fillText(String(Math.round(speed)), cx, cx + 6);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,200,140,0.9)';
    g.font = '700 20px Orbitron, sans-serif';
    g.fillText(unit, cx, cx + 54);
    // marcia
    const gl = reversing ? 'R' : (speed < 1.5 ? 'N' : String(gear));
    g.fillStyle = redline ? '#ff5a3c' : '#ffb347';
    g.font = 'italic 900 46px Orbitron, sans-serif';
    g.fillText(gl, cx, cx - 62);
  }
}

// ---------------------------------------------------------------------------
// Minimappa
// ---------------------------------------------------------------------------

class Minimap {
  constructor(canvas, track) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.track = track;
    this.setTrack(track);
  }

  setTrack(track) {
    this.track = track;
    const { minX, maxX, minZ, maxZ } = track.bounds;
    const pad = 26;
    const sx = (this.W - pad * 2) / (maxX - minX), sz = (this.H - pad * 2) / (maxZ - minZ);
    this.scale = Math.min(sx, sz);
    this.ox = (this.W - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = (this.H - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,8,16,0.5)';
    g.beginPath(); g.roundRect ? g.roundRect(4, 4, this.W - 8, this.H - 8, 22) : g.rect(4, 4, this.W - 8, this.H - 8); g.fill();
    const path = new Path2D();
    for (let i = 0; i < track.count; i += 2) {
      const x = track.px[i] * this.scale + this.ox, y = track.pz[i] * this.scale + this.oz;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 16; g.stroke(path);
    g.strokeStyle = '#6f6a72'; g.lineWidth = 9; g.stroke(path);
    g.strokeStyle = '#bdb6ae'; g.lineWidth = 5; g.stroke(path);
    // traguardo
    const x0 = track.px[0] * this.scale + this.ox, y0 = track.pz[0] * this.scale + this.oz;
    const nx = track.nx[0], nz = track.nz[0];
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x0 - nx * 11, y0 - nz * 11); g.lineTo(x0 + nx * 11, y0 + nz * 11); g.stroke();
    this.bg = c;
  }

  draw(cars) {
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    g.drawImage(this.bg, 0, 0);
    // prima i rivali, poi il giocatore in cima
    const sorted = cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const c of sorted) {
      const x = c.x * this.scale + this.ox, y = c.z * this.scale + this.oz;
      if (c.isPlayer) {
        const dx = Math.sin(c.heading), dy = Math.cos(c.heading);
        g.save(); g.translate(x, y); g.rotate(Math.atan2(dy, dx) - Math.PI / 2);
        g.fillStyle = '#ff7a1a'; g.strokeStyle = '#fff'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, 13); g.lineTo(-9, -9); g.lineTo(0, -4); g.lineTo(9, -9); g.closePath(); g.fill(); g.stroke();
        g.restore();
      } else {
        g.fillStyle = c.color; g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 3;
        g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.stroke();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// UI principale
// ---------------------------------------------------------------------------

export class UI {
  constructor({ onAction, onOption, sfx }) {
    this.onAction = onAction; this.onOption = onOption;
    this.sfx = sfx || { click() {}, hover() {}, back() {} };
    this.last = {};
    this.gauge = new Gauge($('#gauge'));
    this.minimap = null;
    this.navEnabled = true;
    this._toastT = 0;
    this._bind();
  }

  _bind() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      this.sfx[act === 'back' || act === 'close-options' || act === 'close-controls' ? 'back' : 'click']();
      this.onAction(act, el);
    });
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('.mbtn, .swatch, .arrow');
      if (el && el !== this._hoverEl && e.pointerType === 'mouse') { this._hoverEl = el; this.sfx.hover(); }
    });
    document.addEventListener('keydown', (e) => {
      if (!this.navEnabled) return;
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      const btns = this._navButtons();
      if (!btns.length) return;
      let i = btns.findIndex((b) => b.classList.contains('focus'));
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const d = e.code === 'ArrowDown' ? 1 : -1;
        i = i < 0 ? (d > 0 ? 0 : btns.length - 1) : (i + d + btns.length) % btns.length;
        btns.forEach((b) => b.classList.remove('focus'));
        btns[i].classList.add('focus');
        this.sfx.hover();
      } else {
        const target = i >= 0 ? btns[i] : btns.find((b) => b.classList.contains('primary')) || btns[0];
        if (target) { e.preventDefault(); target.click(); }
      }
    });
  }

  _topScreen() {
    const order = ['screen-controls', 'screen-options', 'screen-results', 'screen-pause', 'screen-garage', 'screen-menu'];
    for (const id of order) { const el = document.getElementById(id); if (el && el.classList.contains('show')) return el; }
    return null;
  }

  _navButtons() {
    const top = this._topScreen();
    if (!top) return [];
    const sel = top.id === 'screen-garage' ? '.mbtn.go, .back' : '.mbtn';
    return [...top.querySelectorAll(sel)].filter((b) => !b.disabled && !b.hidden);
  }

  clearFocus() { document.querySelectorAll('.mbtn.focus').forEach((b) => b.classList.remove('focus')); }

  // ---------------------------------------------------------------- schermate
  show(id) { const el = document.getElementById(id); if (el) el.classList.add('show'); this.clearFocus(); }
  hide(id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); this.clearFocus(); }
  isShown(id) { const el = document.getElementById(id); return !!el && el.classList.contains('show'); }
  only(ids) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', ids.includes(el.id));
    this.clearFocus();
  }

  setLoading(p, text) {
    $('#loading-bar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('#loading-text').textContent = text;
  }
  endLoading() { document.body.classList.remove('booting'); $('#screen-loading').classList.remove('show'); }

  toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- menu
  setMenuRecords(rec, unit) {
    $('#menu-records').innerHTML =
      `<span>MIGLIOR GIRO<b>${fmtTime(rec.bestLap)}</b></span>` +
      `<span>VITTORIE<b>${rec.wins}</b></span><span>GARE<b>${rec.races}</b></span>`;
  }
  setVersion(v) { $('#ver').textContent = v; }
  setOnline(on) { $('#net-status').textContent = on ? 'online' : 'offline'; }

  // ---------------------------------------------------------------- garage
  buildGarage(car, track, selectedColor, onColor) {
    $('#car-name').textContent = car.name;
    $('#car-tag').textContent = car.tagline;
    const labels = { speed: 'VELOCITÀ', accel: 'ACCELERAZIONE', handling: 'TENUTA', nitro: 'NITRO' };
    $('#car-stats').innerHTML = Object.entries(car.stats).map(([k, v]) =>
      `<div class="stat"><span>${labels[k] || k}</span><div class="meter">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
    const box = $('#car-colors');
    box.innerHTML = '';
    car.colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === selectedColor ? ' sel' : '');
      b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name);
      b.addEventListener('click', () => {
        box.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
        b.classList.add('sel');
        this.sfx.click();
        onColor(i);
      });
      box.appendChild(b);
    });
    $('#map-name').textContent = track.name;
    $('#map-info').textContent = `${(track.length / 1000).toFixed(2)} km`;
  }

  // ---------------------------------------------------------------- opzioni
  buildOptions(settings) {
    const root = $('#opts-list');
    root.innerHTML = '';
    for (const o of OPTIONS) {
      const row = document.createElement('div'); row.className = 'opt';
      const lab = document.createElement('label'); lab.textContent = o.label; row.appendChild(lab);
      if (o.type === 'seg') {
        const seg = document.createElement('div'); seg.className = 'seg';
        for (const [val, text] of o.values) {
          const b = document.createElement('button'); b.textContent = text;
          if (String(settings[o.key]) === String(val)) b.classList.add('on');
          b.addEventListener('click', () => {
            seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
            this.sfx.click(); this.onOption(o.key, val);
          });
          seg.appendChild(b);
        }
        row.appendChild(seg);
      } else if (o.type === 'range') {
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = 0; inp.max = 100; inp.value = Math.round(settings[o.key] * 100);
        inp.addEventListener('input', () => this.onOption(o.key, inp.value / 100));
        inp.addEventListener('change', () => this.sfx.click());
        row.appendChild(inp);
      } else {
        const sw = document.createElement('button'); sw.className = 'switch' + (settings[o.key] ? ' on' : ''); sw.setAttribute('aria-label', o.label);
        sw.addEventListener('click', () => { sw.classList.toggle('on'); this.sfx.click(); this.onOption(o.key, sw.classList.contains('on')); });
        row.appendChild(sw);
      }
      root.appendChild(row);
    }
    const reset = document.createElement('div'); reset.className = 'opt';
    reset.innerHTML = '<label>RECORD</label>';
    const rb = document.createElement('button'); rb.className = 'danger'; rb.textContent = 'AZZERA RECORD E STATISTICHE';
    rb.addEventListener('click', () => { this.sfx.click(); this.onOption('__resetRecords', true); rb.textContent = 'FATTO'; });
    reset.appendChild(rb); root.appendChild(reset);
  }

  // ---------------------------------------------------------------- HUD
  initMinimap(track) {
    if (!this.minimap) this.minimap = new Minimap($('#minimap'), track);
    else this.minimap.setTrack(track);
  }

  setHudStatic(total, laps) {
    $('#hud-total').textContent = `/${total}`;
    $('#hud-laps').textContent = `/${laps}`;
    this.last = {};
  }

  _set(id, text) {
    if (this.last[id] === text) return;
    this.last[id] = text;
    $('#' + id).textContent = text;
  }

  updateHud(s) {
    this._set('hud-pos', String(s.place));
    $('.hud-pos').classList.toggle('first', s.place === 1);
    this._set('hud-lap', String(s.lap));
    this._set('hud-time', fmtTime(s.time));
    this._set('hud-laptime', fmtTime(s.lapTime));
    this._set('hud-best', fmtTime(s.bestLap));
    const nf = $('#nitro-fill');
    nf.style.transform = `scaleX(${Math.max(0.0001, s.nitro / 100)})`;
    const nb = nf.parentElement;
    nb.classList.toggle('active', !!s.nitroActive);
    nb.classList.toggle('low', !!s.nitroLock);
    this.gauge.draw({
      speed: s.speedDisplay, unit: s.unit, rpm: s.rpm, gear: s.gear, reversing: s.reversing, nitro: s.nitroActive, redline: s.rpm > 7500,
    });
    if (this.minimap) this.minimap.draw(s.cars);
    $('#hud-wrong').classList.toggle('show', !!s.wrongWay);
    if (s.fps != null) this._set('hud-fps', s.showFps ? `${Math.round(s.fps)} FPS` : '');
  }

  message(text, cls = '', sub = '') {
    const root = $('#hud-center');
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    while (root.children.length > 2) root.firstChild.remove();
    root.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  hudToast(text, cls = '') {
    const root = $('#hud-toast');
    const d = document.createElement('div');
    d.className = 't ' + cls; d.textContent = text;
    const wrap = document.createElement('div'); wrap.appendChild(d);
    while (root.children.length > 2) root.firstChild.remove();
    root.appendChild(wrap);
    setTimeout(() => wrap.remove(), 2500);
  }

  // ---------------------------------------------------------------- risultati
  showResults({ place, total, rows, badges, title }) {
    const ord = ['', '1°', '2°', '3°', '4°', '5°', '6°'];
    const t = $('#res-title');
    t.textContent = title || `${ord[place] || place + '°'} POSTO`;
    t.classList.toggle('win', place === 1);
    $('#res-sub').textContent = place === 1 ? 'VITTORIA!' : 'GARA CONCLUSA';
    $('#res-badges').innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
    $('#res-body').innerHTML = rows.map((r) =>
      `<tr class="${r.me ? 'me' : ''}"><td>${r.place}</td><td>${r.name}</td><td>${r.time}</td><td>${r.best}</td></tr>`).join('');
  }
}
