// Pilota automatico (rivali e auto-pilota di fine gara). Modulo puro.
//
// - profilo di velocità massima per ogni campione della pista (curvatura + frenata anticipata)
// - linea di gara approssimata (taglia le curve verso l'interno)
// - inseguimento di un punto davanti all'auto (pure pursuit) per lo sterzo
// - evita le auto davanti, usa il nitro sui rettilinei

import { pointAt } from './track-data.js';
import { clamp, wrapAngle, maxYawRate } from './car-physics.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dati precalcolati che dipendono solo da pista + specifica auto (condivisi da tutti i rivali). */
export function buildTrackProfile(track, spec) {
  const n = track.count;
  const ks = new Float64Array(n);
  const W = 9;
  for (let i = 0; i < n; i++) {
    let acc = 0, w = 0;
    for (let k = -W; k <= W; k++) {
      const ww = W + 1 - Math.abs(k);
      acc += track.curvS[(i + k + n) % n] * ww; w += ww;
    }
    ks[i] = acc / w;
  }
  const lineOffset = new Float32Array(n);
  const laneW = new Float32Array(n);
  const vmax = new Float32Array(n);
  const aLat = spec.latGrip * 0.86;
  for (let i = 0; i < n; i++) {
    lineOffset[i] = clamp(-ks[i] * 380, -5.4, 5.4);
    const k = Math.abs(track.curvS[i]);
    laneW[i] = 1 / (1 + 45 * Math.abs(ks[i]));
    const kEff = Math.max(k * 0.92, 1e-4);
    // v²·k = aLat·(1 + d·(v/70)²)  →  v = sqrt(aLat / (k − aLat·d/70²))
    const den = kEff - (aLat * (spec.downforce ?? 0)) / 4900;
    vmax[i] = den > 1e-6 ? Math.min(spec.topSpeed * 1.02, Math.sqrt(aLat / den)) : spec.topSpeed * 1.02;
  }
  // frenata anticipata: la velocità in i deve permettere di scendere a vmax[i+1]
  const aBrk = spec.brake * 0.6;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = n - 1; i >= 0; i--) {
      const nx = vmax[(i + 1) % n];
      const lim = Math.sqrt(nx * nx + 2 * aBrk * track.step);
      if (lim < vmax[i]) vmax[i] = lim;
    }
  }
  // rettilineo davanti (per usare il nitro): nessuna curva significativa nei prossimi ~110 m
  const straight = new Uint8Array(n);
  const look = Math.round(110 / track.step);
  for (let i = 0; i < n; i++) {
    let ok = 1;
    for (let k = 0; k <= look; k += 2) {
      if (vmax[(i + k) % n] < spec.topSpeed * 0.93) { ok = 0; break; }
    }
    straight[i] = ok;
  }
  return { lineOffset, laneW, vmax, straight };
}

export function createAI(track, profile, cfg = {}, seed = 1) {
  return {
    track, profile,
    skill: cfg.skill ?? 0.92,
    aggression: cfg.aggression ?? 0.5,
    lane: cfg.lane ?? 0,
    lineStrength: cfg.lineStrength ?? 0.85,
    paceMul: 1,
    avoid: 0,
    steer: 0,
    nitroOn: false,
    stuck: 0,
    rand: mulberry32(seed),
    wantRespawn: false,
    _pt: {},
  };
}

function at(arr, track, s) {
  const n = track.count;
  let i = Math.floor(s / track.step) % n;
  if (i < 0) i += n;
  return arr[i];
}

/**
 * Calcola gli input per un'auto controllata dall'AI.
 * info: nearestOnTrack del veicolo. others: [{ car, info }] degli altri veicoli.
 */
export function aiControl(ai, car, info, dt, others, active = true) {
  const track = ai.track, prof = ai.profile;
  const hw = track.halfWidth;
  const speed = Math.max(car.speed, 0.1);
  const vf = car.vf;

  // --- evitamento delle auto davanti
  let desiredAvoid = 0;
  let capSpeed = Infinity;
  const L = track.length;
  for (const o of others) {
    let ds = o.info.s - info.s;
    if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    const dd = o.info.d - info.d;
    const reach = 9 + 0.55 * speed;
    if (ds > 0.5 && ds < reach && Math.abs(dd) < 2.7) {
      // spostati dal lato con più spazio
      let dir = dd > 0 ? -1 : 1;
      if (Math.abs(dd) < 0.25) dir = info.d > 0 ? -1 : 1;
      const room = dir > 0 ? (hw - 2.4 - info.d) : (info.d + hw - 2.4);
      if (room < 1.2) dir = -dir;
      desiredAvoid = dir * clamp(3.3 - Math.abs(dd) * 0.8, 1.2, 3.2) * (0.6 + 0.8 * ai.aggression);
      if (ds < 7 && Math.abs(dd) < 1.9) capSpeed = Math.min(capSpeed, Math.max(o.car.vf * 0.97 + ds * 0.7 - 2, 8));
      break;
    }
  }
  ai.avoid += (desiredAvoid - ai.avoid) * (1 - Math.exp(-(desiredAvoid ? 2.8 : 1.4) * dt));

  // --- punto da inseguire
  const Ld = clamp(7 + 0.42 * speed, 9, 38);
  const sT = info.s + Ld;
  const off = clamp(
    at(prof.lineOffset, track, sT) * ai.lineStrength + ai.lane * at(prof.laneW, track, sT) + ai.avoid,
    -(hw - 2.6), hw - 2.6
  );
  const pt = pointAt(track, sT, off, ai._pt);
  const dx = pt.x - car.x, dz = pt.z - car.z;
  const dist = Math.max(Math.hypot(dx, dz), 4);
  const alpha = wrapAngle(Math.atan2(dx, dz) - car.heading);
  const wNeed = (2 * Math.sin(alpha) / dist) * Math.max(vf, 2);
  const wMax = Math.max(maxYawRate(car.spec, Math.max(vf, 2), car.surfaceGrip), 0.06);
  let steer = clamp(-wNeed / wMax, -1, 1);
  if (vf < 0) steer = -steer;
  ai.steer += (steer - ai.steer) * (1 - Math.exp(-14 * dt));

  // --- velocità obiettivo
  const sBrake = info.s + speed * 0.28;
  let vt = at(prof.vmax, track, sBrake) * ai.skill * ai.paceMul;
  vt = Math.min(vt, capSpeed);
  if (Math.abs(alpha) > 0.7) vt = Math.min(vt, 16); // molto fuori traiettoria: rallenta

  let throttle = 0, brake = 0;
  const err = vt - vf;
  if (!active) { brake = 1; }
  else if (vf < -1) { throttle = 1; }
  else if (err > 0) { throttle = clamp(0.25 + err * 0.5, 0, 1); }
  else if (err < -1.6) { brake = clamp((-err - 1.0) * 0.16, 0, 1); }
  if (Math.abs(car.vl) > 3.2) throttle *= 0.35;
  if (Math.abs(ai.steer) > 0.85 && vf > 25) throttle *= 0.7;

  // --- nitro sui rettilinei
  if (ai.nitroOn) {
    if (car.nitro < 10 || !at(prof.straight, track, info.s) || throttle < 0.9) ai.nitroOn = false;
  } else if (active && throttle > 0.9 && car.nitro > 55 && at(prof.straight, track, info.s) && vf > 22) {
    if (ai.rand() < ai.aggression * 1.1 * dt) ai.nitroOn = true;
  }

  // --- bloccato?
  if (active && car.speed < 1.6 && !(car.reversing)) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 2.6) { ai.wantRespawn = true; ai.stuck = 0; }

  return { throttle, brake, steer: ai.steer, handbrake: false, nitro: ai.nitroOn };
}
