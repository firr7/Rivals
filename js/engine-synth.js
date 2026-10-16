// Sintesi del motore (modulo puro: nessuna dipendenza da WebAudio, testabile in Node).
//
// Invece di oscillatori continui (che suonano "elettrici") il motore è costruito come un vero
// V8 a 4 tempi: 8 scoppi ogni 2 giri d'albero. Ogni scoppio è un impulso di pressione
// (tonfo grave + breve "sbuffo" di rumore) con ampiezza e istante leggermente diversi da cilindro
// a cilindro (da qui il borbottio, soprattutto al minimo); gli impulsi attraversano lo scarico,
// modellato con due risonatori a ritardo smorzati, e vengono saturati dolcemente.
// Si generano così alcuni cicli in loop a regimi diversi, che il gioco mescola e ritona in tempo reale.

/** Regimi (giri/min) dei cicli precalcolati. */
export const ENGINE_LAYER_RPM = [900, 1500, 2300, 3300, 4600, 6100, 7800];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// peso relativo dei cilindri (nessun motore è perfettamente uniforme)
const CYL_GAIN = [1.0, 0.9, 1.06, 0.95, 1.03, 0.88, 1.05, 0.97];

/**
 * Genera un loop continuo del motore a ~`rpmTarget` giri/min.
 * Ritorna { data: Float32Array, rpm } dove `rpm` è il regime effettivo del loop
 * (la lunghezza è un numero intero di campioni, quindi può differire di poco dal target).
 */
export function renderEngineLoop(sr, rpmTarget, seed = 1) {
  const rnd = mulberry32(seed * 9973 + Math.round(rpmTarget));
  const cycleT = 120 / rpmTarget;                       // un ciclo = 2 giri
  const M = Math.max(2, Math.round(0.85 / cycleT));     // cicli nel loop (~0,85 s)
  const N = Math.round(M * cycleT * sr);
  const rpm = (120 * M * sr) / N;
  const tFire = N / sr / (M * 8);                       // intervallo medio tra due scoppi (s)

  // più regolare ad alto regime, più "grumoso" al minimo
  const lump = 1 - Math.min(1, Math.max(0, (rpm - 900) / 4500));
  const uneven = 0.035 + 0.075 * lump;                  // asimmetria tra le due bancate
  const jitter = 0.012 + 0.05 * lump;
  const ampVar = 0.06 + 0.2 * lump;

  // nuclei degli impulsi
  const thumpLen = Math.round(0.045 * sr);
  const thump = new Float32Array(thumpLen);
  for (let i = 0; i < thumpLen; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.0085);
    thump[i] = (Math.sin(2 * Math.PI * 58 * t) + 0.45 * Math.sin(2 * Math.PI * 151 * t + 0.6)) * env;
  }
  const barkLen = Math.round(0.007 * sr);

  const x = new Float32Array(N);
  const add = (pos, amp, bark) => {
    const p0 = Math.floor(pos);
    for (let i = 0; i < thumpLen; i++) x[(p0 + i) % N] += thump[i] * amp;
    let lp = 0;
    for (let i = 0; i < barkLen; i++) {
      lp += 0.55 * ((rnd() * 2 - 1) - lp);              // rumore filtrato
      x[(p0 + i) % N] += lp * Math.exp(-i / (0.0022 * sr)) * amp * bark;
    }
  };
  const barkAmt = 0.55 + 0.35 * (1 - lump);
  for (let c = 0; c < M; c++) {
    for (let j = 0; j < 8; j++) {
      const bank = j % 2 === 0 ? -uneven : uneven;
      const t = (c * 8 + j + bank + (rnd() * 2 - 1) * jitter) * tFire;
      const a = CYL_GAIN[j] * (1 + (rnd() * 2 - 1) * ampVar);
      add(t * sr + N * 4, a, barkAmt);                  // +N*4: evita indici negativi
    }
  }

  // scarico: due risonatori a ritardo con smorzamento (passate sul segnale ripetuto due volte)
  const comb = (src, delay, g, damp) => {
    const out = new Float32Array(N);
    const buf = new Float32Array(N * 2);
    let fb = 0;
    const hist = new Float32Array(delay);
    let h = 0;
    for (let n = 0; n < N * 2; n++) {
      const v = src[n % N] + g * hist[h];
      fb += damp * (v - fb);
      hist[h] = fb;
      h = (h + 1) % delay;
      buf[n] = v;
    }
    for (let n = 0; n < N; n++) out[n] = buf[N + n];
    return out;
  };
  const c1 = comb(x, Math.round(sr * 0.0036), 0.52, 0.42);
  const c2 = comb(x, Math.round(sr * 0.0057), 0.44, 0.35);
  const y = new Float32Array(N);
  for (let n = 0; n < N; n++) y[n] = x[n] * 0.7 + c1[n] * 0.55 + c2[n] * 0.45;

  // timbro: passa-basso a due poli che si apre col regime + passa-alto leggero (niente DC)
  const fc = 1100 + rpm * 0.5;
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  const ah = 1 - Math.exp((-2 * Math.PI * 38) / sr);
  const shape = (inp) => {
    const o = new Float32Array(N);
    let l1 = inp[N - 1] * 0.2, l2 = l1, hp = 0;
    for (let k = 0; k < 2; k++) {
      for (let n = 0; n < N; n++) {
        l1 += a * (inp[n] - l1); l2 += a * (l1 - l2);
        hp += ah * (l2 - hp);
        o[n] = l2 - hp;
      }
    }
    return o;
  };
  const z = shape(y);

  // saturazione morbida (ruggito) e normalizzazione del livello
  let peak = 1e-6;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(z[n]));
  const drive = 1.7;
  const data = new Float32Array(N);
  let e = 0;
  for (let n = 0; n < N; n++) {
    const v = Math.tanh((z[n] / peak) * drive) / Math.tanh(drive);
    data[n] = v; e += v * v;
  }
  const g = 0.3 / Math.sqrt(e / N);
  for (let n = 0; n < N; n++) data[n] *= g;
  return { data, rpm };
}

/** Pesi di mescolanza dei loop (crossfade equal-power in scala logaritmica) per il regime `rpm`. */
export function layerWeights(layerRpms, rpm) {
  const n = layerRpms.length;
  const w = new Array(n).fill(0);
  const lr = Math.log(rpm);
  if (lr <= Math.log(layerRpms[0])) { w[0] = 1; return w; }
  if (lr >= Math.log(layerRpms[n - 1])) { w[n - 1] = 1; return w; }
  for (let i = 0; i < n - 1; i++) {
    const a = Math.log(layerRpms[i]), b = Math.log(layerRpms[i + 1]);
    if (lr >= a && lr <= b) {
      const x = (lr - a) / (b - a);
      w[i] = Math.cos(x * Math.PI / 2);
      w[i + 1] = Math.sin(x * Math.PI / 2);
      return w;
    }
  }
  return w;
}
