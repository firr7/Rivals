// Geometria della pista: spline chiusa campionata a passo costante.
// Modulo puro (nessun DOM / three.js) così può essere testato in Node.
//
// Convenzioni (identiche per fisica e rendering):
//   - piano di gioco = (x, z), y è l'altezza
//   - heading ψ: vettore avanti f = (sin ψ, cos ψ); ψ crescente = curva a SINISTRA
//   - normale destra della pista n = (-tz, tx)
//   - offset laterale d > 0  => a destra della linea centrale
//   - curvatura κ = dψ/ds > 0 => curva a sinistra

/** @typedef {{ x:number, z:number }} V2 */

// Punti di controllo [x, z] in metri del circuito "Downtown Run".
// Il rettilineo di partenza corre lungo +x e la linea del traguardo è vicino a (0, 0).
const DOWNTOWN_POINTS = [
  [-120, 0], [60, 0], [240, 0], [310, 0], [370, -20], [430, 8], [495, 30], [550, 78], [588, 155],
  [570, 260], [490, 330], [380, 340], [300, 290], [270, 205], [215, 150],
  [130, 150], [75, 210], [95, 300], [165, 370], [180, 470], [120, 555],
  [10, 590], [-110, 570], [-195, 500], [-215, 400], [-175, 310],
  [-210, 215], [-235, 110], [-200, 40],
];

export const TRACKS = {
  downtown: {
    id: 'downtown',
    name: 'DOWNTOWN RUN',
    width: 19,            // larghezza carreggiata (m)
    wallGap: 1.6,         // distanza muro dal bordo carreggiata (m)
    step: 3,              // passo di campionamento (m)
    startRef: [0, 0],     // il campione più vicino diventa la linea del traguardo
    points: DOWNTOWN_POINTS,
  },
};

// ---------------------------------------------------------------------------
// Spline Catmull-Rom centripeta (Barry–Goldman) per curva chiusa 2D
// ---------------------------------------------------------------------------

function lerp2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function crSegment(p0, p1, p2, p3, u) {
  const d = (a, b) => Math.max(Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5), 1e-4);
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = lerp2(p0, p1, (t - t0) / (t1 - t0));
  const a2 = lerp2(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerp2(p2, p3, (t - t2) / (t3 - t2));
  const b1 = lerp2(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerp2(a2, a3, (t - t1) / (t3 - t1));
  return lerp2(b1, b2, (t - t1) / (t2 - t1));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Costruisce la pista a partire dalla definizione.
 * Il campionamento parte dal primo punto di controllo spostato in modo che
 * l'indice 0 coincida con la linea di partenza/arrivo (punto (0,0) del tracciato).
 */
export function buildTrack(def = TRACKS.downtown) {
  const cp = def.points;
  const n = cp.length;

  // 1) campionamento fitto della spline
  const dense = [];
  const sub = 48;
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
    for (let k = 0; k < sub; k++) dense.push(crSegment(p0, p1, p2, p3, k / sub));
  }
  // 2) lunghezza cumulativa e ricampionamento a passo costante
  const m = dense.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = dense[i], b = dense[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const total = cum[m];
  const count = Math.max(64, Math.round(total / def.step));
  const step = total / count;
  let px = new Float64Array(count), pz = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (j < m - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = (target - cum[j]) / seg;
    const a = dense[j], b = dense[(j + 1) % m];
    px[i] = a[0] + (b[0] - a[0]) * f;
    pz[i] = a[1] + (b[1] - a[1]) * f;
  }

  // 3) leggero smoothing per eliminare micro-spigoli (mantiene la forma)
  for (let pass = 0; pass < 3; pass++) {
    const nx2 = new Float64Array(count), nz2 = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count, b = (i + 1) % count;
      nx2[i] = px[i] * 0.5 + (px[a] + px[b]) * 0.25;
      nz2[i] = pz[i] * 0.5 + (pz[a] + pz[b]) * 0.25;
    }
    px = nx2; pz = nz2;
  }

  // 4) allinea l'indice 0 al punto più vicino a cp[1] (inizio rettilineo) → linea del traguardo
  //    Usiamo il punto (0,0) se presente nella definizione come origine del traguardo.
  const startRef = def.startRef || [0, 0];
  let best = 0, bd = Infinity;
  for (let i = 0; i < count; i++) {
    const dd = Math.hypot(px[i] - startRef[0], pz[i] - startRef[1]);
    if (dd < bd) { bd = dd; best = i; }
  }
  if (best !== 0) {
    const rx = new Float64Array(count), rz = new Float64Array(count);
    for (let i = 0; i < count; i++) { rx[i] = px[(i + best) % count]; rz[i] = pz[(i + best) % count]; }
    px = rx; pz = rz;
  }

  // 5) tangenti, normali, curvatura, heading
  const tx = new Float64Array(count), tz = new Float64Array(count);
  const nxv = new Float64Array(count), nzv = new Float64Array(count);
  const heading = new Float64Array(count);
  const curv = new Float64Array(count);
  const sArr = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 1 + count) % count, b = (i + 1) % count;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz;
    nxv[i] = -dz; nzv[i] = dx;
    heading[i] = Math.atan2(dx, dz);
    sArr[i] = i * step;
  }
  for (let i = 0; i < count; i++) {
    const a = (i - 2 + count) % count, b = (i + 2) % count;
    curv[i] = wrapAngle(heading[b] - heading[a]) / (4 * step);
  }
  // curvatura smussata (media mobile) per il profilo di velocità AI
  const curvS = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let acc = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const ww = 4 - Math.abs(k); acc += curv[(i + k + count) % count] * ww; w += ww; }
    curvS[i] = acc / w;
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
  }

  const halfWidth = def.width / 2;
  return {
    id: def.id,
    name: def.name,
    width: def.width,
    halfWidth,
    wallOffset: halfWidth + (def.wallGap ?? 1.6),
    step,
    count,
    length: step * count,
    px, pz, tx, tz, nx: nxv, nz: nzv, heading, curv, curvS, s: sArr,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/** Indice circolare. */
export function wrapIndex(track, i) {
  const n = track.count;
  return ((i % n) + n) % n;
}

/**
 * Proiezione di un punto sulla pista. Se `hint` è dato cerca solo in una finestra
 * attorno all'indice (molto più veloce e stabile nelle sovrapposizioni vicine).
 * Ritorna indice del campione, offset laterale firmato `d` (+ a destra), e s continuo.
 */
export function nearestOnTrack(track, x, z, hint = -1, window = 40) {
  const n = track.count;
  let bestI = 0, bestD2 = Infinity;
  if (hint < 0) {
    for (let i = 0; i < n; i++) {
      const dx = x - track.px[i], dz = z - track.pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
  } else {
    for (let k = -window; k <= window; k++) {
      const i = wrapIndex(track, hint + k);
      const dx = x - track.px[i], dz = z - track.pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
  }
  // raffina con la proiezione sul segmento tra campioni adiacenti
  const i0 = bestI, i1 = wrapIndex(track, bestI + 1), im = wrapIndex(track, bestI - 1);
  let idx = i0, frac = 0;
  const proj = (a, b) => {
    const sx = track.px[b] - track.px[a], sz = track.pz[b] - track.pz[a];
    const l2 = sx * sx + sz * sz || 1;
    return ((x - track.px[a]) * sx + (z - track.pz[a]) * sz) / l2;
  };
  const fNext = proj(i0, i1);
  if (fNext > 0) { idx = i0; frac = Math.min(fNext, 1); }
  else {
    const fPrev = proj(im, i0);
    if (fPrev < 1) { idx = im; frac = Math.max(fPrev, 0); } else { idx = i0; frac = 0; }
  }
  const a = idx, b = wrapIndex(track, idx + 1);
  const cx = track.px[a] + (track.px[b] - track.px[a]) * frac;
  const cz = track.pz[a] + (track.pz[b] - track.pz[a]) * frac;
  const tx = track.tx[a] + (track.tx[b] - track.tx[a]) * frac;
  const tz = track.tz[a] + (track.tz[b] - track.tz[a]) * frac;
  const tl = Math.hypot(tx, tz) || 1;
  const ntx = tx / tl, ntz = tz / tl;
  const d = (x - cx) * (-ntz) + (z - cz) * ntx;
  return {
    index: idx,
    frac,
    s: (idx + frac) * track.step,
    d,
    cx, cz, tx: ntx, tz: ntz,
    nx: -ntz, nz: ntx,
  };
}

/** Punto sulla linea centrale alla distanza s (con wrap) + offset laterale opzionale. */
export function pointAt(track, s, offset = 0, out = {}) {
  const L = track.length;
  let u = ((s % L) + L) % L;
  const f = u / track.step;
  const a = Math.floor(f) % track.count, b = (a + 1) % track.count;
  const fr = f - Math.floor(f);
  const cx = track.px[a] + (track.px[b] - track.px[a]) * fr;
  const cz = track.pz[a] + (track.pz[b] - track.pz[a]) * fr;
  let tx = track.tx[a] + (track.tx[b] - track.tx[a]) * fr;
  let tz = track.tz[a] + (track.tz[b] - track.tz[a]) * fr;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  out.x = cx + -tz * offset;
  out.z = cz + tx * offset;
  out.cx = cx; out.cz = cz;
  out.tx = tx; out.tz = tz;
  out.nx = -tz; out.nz = tx;
  out.heading = Math.atan2(tx, tz);
  out.curv = track.curvS[a] + (track.curvS[b] - track.curvS[a]) * fr;
  return out;
}

/** Diagnostica: distanza minima tra tratti non adiacenti e raggio minimo di curva. */
export function analyzeTrack(track) {
  const n = track.count;
  const minArc = 180; // tratti più lontani di così (lungo la pista) sono "non adiacenti"
  let minGap = Infinity, gapI = 0, gapJ = 0;
  const skip = Math.ceil(minArc / track.step);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      const arc = Math.min(j - i, n - (j - i)) * track.step;
      if (arc < minArc) continue;
      const d = Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]);
      if (d < minGap) { minGap = d; gapI = i; gapJ = j; }
    }
  }
  let maxK = 0, maxKi = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.abs(track.curvS[i]);
    if (k > maxK) { maxK = k; maxKi = i; }
  }
  return {
    length: track.length,
    samples: n,
    minGap, gapI, gapJ,
    minRadius: maxK > 0 ? 1 / maxK : Infinity,
    minRadiusAt: maxKi,
  };
}
