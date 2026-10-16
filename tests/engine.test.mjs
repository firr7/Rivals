// Test della sintesi del motore: loop finiti, senza clipping, senza scatti alla giunzione, livello coerente.
import { renderEngineLoop, layerWeights, ENGINE_LAYER_RPM } from '../js/engine-synth.js';

const sr = 44100;
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FALLITO:', msg); } };

const layers = ENGINE_LAYER_RPM.map((r, i) => renderEngineLoop(sr, r, i + 1));
for (const L of layers) {
  let peak = 0, e = 0, finite = true, maxStep = 0;
  for (let i = 0; i < L.data.length; i++) {
    const v = L.data[i];
    if (!Number.isFinite(v)) finite = false;
    peak = Math.max(peak, Math.abs(v)); e += v * v;
    const w = L.data[(i + 1) % L.data.length];
    maxStep = Math.max(maxStep, Math.abs(w - v));
  }
  const rms = Math.sqrt(e / L.data.length);
  console.log(`rpm ${L.rpm.toFixed(0).padStart(5)}  ${(L.data.length / sr).toFixed(2)} s  picco ${peak.toFixed(2)}  rms ${rms.toFixed(3)}  salto max ${maxStep.toFixed(2)}`);
  check(finite, `valori non finiti a ${L.rpm}`);
  check(peak < 1.0, `clipping a ${L.rpm}`);
  check(Math.abs(rms - 0.3) < 0.02, `livello incoerente a ${L.rpm}`);
  check(maxStep < 0.9, `scatto alla giunzione/campioni a ${L.rpm}`);
  check(Math.abs(L.rpm / ENGINE_LAYER_RPM[layers.indexOf(L)] - 1) < 0.01, `regime effettivo lontano dal target a ${L.rpm}`);
}

// pesi: somma di potenza costante e continuità
const rpms = layers.map((l) => l.rpm);
let prev = null, maxJump = 0;
for (let r = 700; r <= 9000; r += 5) {
  const w = layerWeights(rpms, r);
  const p = w.reduce((a, b) => a + b * b, 0);
  check(Math.abs(p - 1) < 1e-6, `potenza dei pesi != 1 a ${r}`);
  if (prev) for (let i = 0; i < w.length; i++) maxJump = Math.max(maxJump, Math.abs(w[i] - prev[i]));
  prev = w;
}
check(maxJump < 0.05, `pesi discontinui (${maxJump.toFixed(3)})`);
console.log(fail ? `\n${fail} controlli falliti` : '\nOK engine');
process.exit(fail ? 1 : 0);
