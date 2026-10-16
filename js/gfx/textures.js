// Texture procedurali generate con canvas 2D (nessun file immagine da scaricare).

import * as THREE from '../three.js';
import { mulberry32 } from '../ai.js';

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = true, srgb = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function addNoise(g, w, h, amount, seed = 1) {
  const rnd = mulberry32(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Strada: 4 corsie. U = larghezza (0..1), V = lunghezza (tile da 12 m)
// ---------------------------------------------------------------------------
export function roadTexture(aniso = 8) {
  const W = 512, H = 512;
  const [c, g] = mk(W, H);
  const rnd = mulberry32(11);
  g.fillStyle = '#2d2d33';
  g.fillRect(0, 0, W, H);
  // macchie di asfalto più chiaro/scuro
  for (let i = 0; i < 380; i++) {
    const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 34;
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v + 8},${0.015 + rnd() * 0.035})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd() * 0.8), rnd() * 3, 0, 6.3); g.fill();
  }
  // tracce delle ruote (più scure) e centro corsia leggermente più chiaro
  for (const cx of [0.125, 0.375, 0.625, 0.875]) {
    for (const off of [-0.035, 0.035]) {
      const gx = (cx + off) * W;
      const grad = g.createLinearGradient(gx - 22, 0, gx + 22, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(gx - 22, 0, 44, H);
    }
  }
  // crepe e rattoppi
  g.strokeStyle = 'rgba(8,8,10,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = rnd() * W, y = rnd() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.2) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(20,20,24,${0.35 + rnd() * 0.2})`;
    g.fillRect(rnd() * W, rnd() * H, 30 + rnd() * 60, 18 + rnd() * 40);
  }
  addNoise(g, W, H, 16, 3);

  // segnaletica
  const line = (x0, w, y0, y1, color) => { g.fillStyle = color; g.fillRect(x0, y0, w, y1 - y0); };
  const white = 'rgba(232,232,228,0.92)', yellow = 'rgba(240,190,40,0.92)';
  // bordi
  line(0.030 * W, 0.012 * W, 0, H, white);
  line(0.958 * W, 0.012 * W, 0, H, white);
  // centro: doppia linea gialla
  line(0.488 * W - 2, 0.007 * W, 0, H, yellow);
  line(0.505 * W - 2, 0.007 * W, 0, H, yellow);
  // corsie tratteggiate (3 m pieni / 3 m vuoti su 12 m)
  for (const lx of [0.25, 0.75]) {
    line(lx * W - 3, 0.010 * W, 0, 0.125 * H * 2 * 0.5, white);
    line(lx * W - 3, 0.010 * W, 0.5 * H, 0.75 * H, white);
  }
  // usura della vernice
  g.globalCompositeOperation = 'destination-out';
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(45,45,51,${0.2 + rnd() * 0.5})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 5);
  }
  addNoise(g, W, H, 10, 5);
  return toTexture(c, { aniso });
}

export function kerbTexture(aniso = 8) {
  const [c, g] = mk(64, 256);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#e9e9e6' : '#cf1d22';
    g.fillRect(0, i * 64, 64, 64);
  }
  addNoise(g, 64, 256, 18, 8);
  return toTexture(c, { aniso });
}

export function wallTexture(aniso = 8) {
  const W = 512, H = 128;
  const [c, g] = mk(W, H);
  const rnd = mulberry32(21);
  g.fillStyle = '#8c8984'; g.fillRect(0, 0, W, H);
  // fascia scura in basso (sporco)
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, 'rgba(25,22,20,0.75)'); grad.addColorStop(0.45, 'rgba(25,22,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // fascia catarifrangente rossa/bianca in alto
  const bandY = 10, bandH = 26;
  for (let x = 0; x < W; x += 32) {
    g.fillStyle = (x / 32) % 2 ? '#e9e6df' : '#c8202a';
    g.beginPath(); g.moveTo(x, bandY + bandH); g.lineTo(x + 14, bandY); g.lineTo(x + 46, bandY); g.lineTo(x + 32, bandY + bandH); g.closePath(); g.fill();
  }
  g.save(); g.beginPath(); g.rect(0, bandY, W, bandH); g.restore();
  // giunti dei blocchi
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < W; x += 128) g.fillRect(x, 0, 2, H);
  // graffi/colpi
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '10,10,10' : '230,230,225'},${0.04 + rnd() * 0.12})`;
    g.fillRect(rnd() * W, 40 + rnd() * 88, 2 + rnd() * 26, 1 + rnd() * 3);
  }
  addNoise(g, W, H, 22, 9);
  return toTexture(c, { aniso });
}

export function sidewalkTexture(aniso = 8) {
  const [c, g] = mk(256, 256);
  g.fillStyle = '#58565c'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  addNoise(g, 256, 256, 24, 12);
  return toTexture(c, { aniso });
}

export function groundTexture(aniso = 8) {
  const [c, g] = mk(512, 512);
  const rnd = mulberry32(31);
  g.fillStyle = '#23212a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 500; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.01 + rnd() * 0.03})`;
    g.beginPath(); g.arc(rnd() * 512, rnd() * 512, 5 + rnd() * 40, 0, 6.3); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  addNoise(g, 512, 512, 14, 14);
  return toTexture(c, { aniso });
}

// ---------------------------------------------------------------------------
// Facciate dei palazzi: atlante 4 stili x (8 colonne x 32 piani) + mappa emissiva
// ---------------------------------------------------------------------------
export const ATLAS = { tiles: 4, cols: 8, rows: 32, cell: 32 };

export function windowAtlas(aniso = 8) {
  const { tiles, cols, rows, cell } = ATLAS;
  const W = tiles * cols * cell, H = rows * cell;
  const [c, g] = mk(W, H);
  const [ce, ge] = mk(W, H);
  const rnd = mulberry32(41);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const litCols = ['#ffd990', '#ffe9b8', '#fff3d6', '#bfe6ff', '#ffb36a', '#ffc77a'];

  for (let t = 0; t < tiles; t++) {
    const x0 = t * cols * cell;
    g.fillStyle = ['#6d6f78', '#4f5766', '#7a736c', '#5d6064'][t];
    g.fillRect(x0, 0, cols * cell, H);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = x0 + col * cell, y = r * cell;
        const lit = rnd() < [0.34, 0.5, 0.28, 0.16][t];
        const lc = litCols[Math.floor(rnd() * litCols.length)];
        let wx, wy, ww, wh;
        if (t === 0) { wx = x + 7; wy = y + 8; ww = 18; wh = 17; }          // appartamenti
        else if (t === 1) { wx = x + 1; wy = y + 6; ww = 30; wh = 19; }      // uffici a nastro
        else if (t === 2) { wx = x + 10; wy = y + 10; ww = 12; wh = 12; }    // finestrelle fitte
        else { wx = x + 5; wy = y + 5; ww = 22; wh = 22; }                   // industriale
        // vetro spento (riflette il tramonto in alto)
        const gr = g.createLinearGradient(0, wy, 0, wy + wh);
        gr.addColorStop(0, 'rgb(70,70,92)'); gr.addColorStop(1, 'rgb(22,26,38)');
        g.fillStyle = lit ? lc : gr;
        g.fillRect(wx, wy, ww, wh);
        if (lit) { ge.fillStyle = lc; ge.fillRect(wx, wy, ww, wh); }
        // cornice
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(wx, wy + wh, ww, 2);
        if (t === 1) { g.fillRect(wx + 15, wy, 1, wh); }
        if (t === 0 || t === 3) { g.fillRect(wx + ww / 2, wy, 1, wh); }
      }
    }
    // marcapiani ogni 4 piani
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let r = 0; r < rows; r += 4) g.fillRect(x0, r * cell + cell - 3, cols * cell, 3);
  }
  // tetto: pixel scuri in basso a destra
  g.fillStyle = '#2b2b30'; g.fillRect(W - 12, H - 12, 12, 12);
  ge.fillStyle = '#000'; ge.fillRect(W - 12, H - 12, 12, 12);
  addNoise(g, W, H, 10, 17);
  return {
    map: toTexture(c, { repeat: false, aniso }),
    emissive: toTexture(ce, { repeat: false, aniso }),
  };
}

// ---------------------------------------------------------------------------
// Sprite / decal
// ---------------------------------------------------------------------------
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,200,120,0.45)', size = 128) {
  const [c, g] = mk(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, mid);
  gr.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return toTexture(c, { repeat: false, mip: false });
}

export function smokeTexture() {
  const [c, g] = mk(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false, mip: false });
}

export function sparkTexture() {
  const [c, g] = mk(32, 32);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,230,1)');
  gr.addColorStop(0.3, 'rgba(255,190,70,0.9)');
  gr.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return toTexture(c, { repeat: false, mip: false });
}

/** Fascio luminoso dei fari: sfumato lungo l'asse V (vicino -> lontano) e trasversale. */
export function beamTexture() {
  const [c, g] = mk(128, 256);
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, 'rgba(255,240,205,0.9)');
  gr.addColorStop(0.5, 'rgba(255,230,180,0.28)');
  gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
  g.globalCompositeOperation = 'destination-in';
  const gx = g.createLinearGradient(0, 0, 128, 0);
  gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.5, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gx; g.fillRect(0, 0, 128, 256);
  // dissolvenza anche sul bordo vicino all'auto: niente rettangolo netto sull'asfalto
  const gy = g.createLinearGradient(0, 256, 0, 0);
  gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.16, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gy; g.fillRect(0, 0, 128, 256);
  return toTexture(c, { repeat: false, mip: false });
}

export function flameTexture() {
  const [c, g] = mk(64, 128);
  const gx = g.createLinearGradient(0, 128, 0, 0);
  gx.addColorStop(0, 'rgba(210,235,255,1)');
  gx.addColorStop(0.25, 'rgba(90,160,255,0.95)');
  gx.addColorStop(0.7, 'rgba(40,80,255,0.4)');
  gx.addColorStop(1, 'rgba(20,40,255,0)');
  g.fillStyle = gx; g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'destination-in';
  const gy = g.createLinearGradient(0, 0, 64, 0);
  gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.5, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gy; g.fillRect(0, 0, 64, 128);
  return toTexture(c, { repeat: false, mip: false });
}

export function chevronTexture(dir = 1) {
  const [c, g] = mk(128, 128);
  g.fillStyle = '#f2c20f'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(5, 5, 118, 118);
  g.strokeStyle = '#111'; g.lineWidth = 15; g.lineCap = 'butt'; g.lineJoin = 'miter';
  for (const off of [-24, 14]) {
    g.beginPath();
    if (dir > 0) { g.moveTo(40 + off, 24); g.lineTo(80 + off, 64); g.lineTo(40 + off, 104); }
    else { g.moveTo(88 - off, 24); g.lineTo(48 - off, 64); g.lineTo(88 - off, 104); }
    g.stroke();
  }
  addNoise(g, 128, 128, 10, 23);
  return toTexture(c, { aniso: 4 });
}

export function checkerTexture() {
  const [c, g] = mk(128, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#161618';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  addNoise(g, 128, 128, 12, 29);
  return toTexture(c, { aniso: 8 });
}

export function bannerTexture(text, sub = '') {
  const [c, g] = mk(1024, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#16141c'); gr.addColorStop(1, '#0a090e');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 256);
  // scacchi sul bordo
  for (let i = 0; i < 64; i++) {
    g.fillStyle = i % 2 ? '#f4f4f0' : '#161618'; g.fillRect(i * 16, 0, 16, 16);
    g.fillStyle = i % 2 ? '#161618' : '#f4f4f0'; g.fillRect(i * 16, 16, 16, 16);
    g.fillStyle = i % 2 ? '#f4f4f0' : '#161618'; g.fillRect(i * 16, 224, 16, 16);
    g.fillStyle = i % 2 ? '#161618' : '#f4f4f0'; g.fillRect(i * 16, 240, 16, 16);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 108px Orbitron, Rajdhani, Arial Black, sans-serif';
  g.shadowColor = '#ff7a1a'; g.shadowBlur = 30;
  g.fillStyle = '#ffb066'; g.fillText(text, 512, 112);
  g.shadowBlur = 0;
  g.fillStyle = '#fff'; g.fillText(text, 512, 112);
  if (sub) {
    g.font = '700 38px Rajdhani, Arial, sans-serif';
    g.fillStyle = '#ff9a3a'; g.fillText(sub, 512, 190);
  }
  return toTexture(c, { repeat: false, aniso: 8 });
}

export function billboardTexture(title, sub, hue = 20) {
  const [c, g] = mk(512, 256);
  const gr = g.createLinearGradient(0, 0, 512, 256);
  gr.addColorStop(0, `hsl(${hue},85%,14%)`); gr.addColorStop(1, `hsl(${(hue + 40) % 360},80%,8%)`);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = `hsl(${hue},100%,60%)`; g.lineWidth = 6; g.strokeRect(10, 10, 492, 236);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = `hsl(${hue},100%,55%)`; g.shadowBlur = 22;
  g.font = '900 70px Orbitron, Arial Black, sans-serif';
  g.fillStyle = `hsl(${hue},100%,78%)`; g.fillText(title, 256, 100);
  g.shadowBlur = 8;
  g.font = '700 34px Rajdhani, Arial, sans-serif';
  g.fillStyle = '#fff'; g.fillText(sub, 256, 178);
  return toTexture(c, { repeat: false, aniso: 8 });
}
