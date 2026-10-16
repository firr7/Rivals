// Fisica arcade dell'auto (modulo puro, testabile in Node).
//
// Idea: la velocità è memorizzata nel sistema mondo (vx, vz). A ogni passo la scomponiamo
// nel sistema dell'auto (avanti `vf`, laterale `vl`, + a destra), applichiamo forze motore/freni,
// la dinamica di imbardata comandata dallo sterzo e l'aderenza laterale limitata (cerchio d'aderenza).
// Lo slittamento (drift) nasce da solo quando la richiesta laterale supera l'aderenza disponibile
// o quando si usa il freno a mano.

const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// Velocità massima (m/s) per marcia: rapporto semplificato.
export const GEAR_MAX = [19, 31, 43, 55, 67, 88];
export const IDLE_RPM = 1000;
export const REDLINE_RPM = 8000;

export function makeCar(spec, x = 0, z = 0, heading = 0) {
  return {
    spec,
    x, z, heading,
    vx: 0, vz: 0,
    yawRate: 0,
    steerAngle: 0,       // angolo ruote anteriori per il rendering (rad, + = destra)
    vf: 0, vl: 0, speed: 0,
    rpm: IDLE_RPM, gear: 1, shiftTimer: 0, shifted: 0,
    throttle: 0, brake: 0, handbrake: false,
    nitro: 100, nitroActive: false, nitroLock: false,
    drift: 0, slipAngle: 0,
    accLong: 0, accLat: 0,
    wheelRot: 0,
    surfaceGrip: 1, surfaceDrag: 0,
    wheelspin: 0,
    impact: 0, scrape: 0,
    reversing: false,
  };
}

/** Aderenza laterale disponibile (m/s²) a velocità `v`: la deportanza la fa crescere col quadrato della velocità. */
export function latGripAt(spec, v, grip = 1) {
  const k = clamp(Math.abs(v) / 70, 0, 1.3);
  return spec.latGrip * grip * (1 + (spec.downforce ?? 0) * k * k);
}

/** Velocità angolare massima ottenibile (rad/s) a velocità `v`, limitata da geometria e aderenza. */
export function maxYawRate(spec, v, grip = 1) {
  const a = Math.abs(v);
  const wGeom = (a / spec.wheelbase) * Math.tan(spec.maxSteer);
  const wGrip = (0.98 * latGripAt(spec, a, grip)) / Math.max(a, 4);
  // tetto alla rotazione: a bassa velocità l'auto non deve ruotare su sé stessa
  const w = Math.min(wGeom, wGrip, spec.maxYaw ?? 1.0);
  return w / (1 + 0.06 * Math.pow(a / 70, 2));
}

function updateGearbox(car, vf, throttle, dt) {
  car.shiftTimer = Math.max(0, car.shiftTimer - dt);
  car.shifted = 0;
  const v = Math.max(0, vf);
  let g = car.gear;
  if (g < 6 && v > GEAR_MAX[g - 1] * 0.96) {
    g++; car.shiftTimer = 0.16; car.shifted = 1;
  } else if (g > 1 && v < GEAR_MAX[g - 2] * 0.7) {
    g--; car.shifted = -1;
  }
  car.gear = g;
  const frac = v / GEAR_MAX[g - 1];
  let target = IDLE_RPM + (REDLINE_RPM - IDLE_RPM - 300) * Math.min(frac, 1.04);
  // a gas tolto l'auto "respira" un po' più in basso
  if (throttle < 0.05 && v > 3) target -= 350;
  const k = car.shiftTimer > 0 ? 18 : 11;
  car.rpm += (target - car.rpm) * (1 - Math.exp(-k * dt));
  car.rpm = clamp(car.rpm, IDLE_RPM * 0.85, REDLINE_RPM);
}

/**
 * Avanza la simulazione di `dt` secondi.
 * input: { throttle 0..1, brake 0..1, steer -1..1 (+ destra), handbrake bool, nitro bool }
 * Le impostazioni di superficie vanno scritte in car.surfaceGrip / car.surfaceDrag prima della chiamata.
 */
export function stepCar(car, input, dt) {
  const s = car.spec;
  const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
  const rx = -hz, rz = hx;
  const vf0 = car.vx * hx + car.vz * hz;
  let vf = vf0;
  let vl = car.vx * rx + car.vz * rz;
  const speed = Math.hypot(car.vx, car.vz);

  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  const hb = !!input.handbrake;
  car.throttle = throttle; car.brake = brake; car.handbrake = hb;

  // ---------------- Nitro ----------------
  if (car.nitro <= 0.01) car.nitroLock = true;
  else if (car.nitro >= 22) car.nitroLock = false;
  car.nitroActive = !!input.nitro && throttle > 0.05 && !car.nitroLock && car.nitro > 0 && vf > 2.5;
  if (car.nitroActive) car.nitro = Math.max(0, car.nitro - 24 * dt);
  else if (speed > 14) car.nitro = Math.min(100, car.nitro + (1.6 + 10 * car.drift) * dt);

  // ---------------- Longitudinale ----------------
  const surfGrip = car.surfaceGrip;
  const vtop = s.topSpeed * (car.nitroActive ? s.nitroTopMul : 1) * (surfGrip < 0.8 ? 0.62 : 1);
  let aLong = 0;
  car.reversing = false;

  if (throttle > 0.02) {
    if (vf < -0.5) {
      aLong = s.brake * 0.7;                // frena la retromarcia prima di ripartire
    } else {
      const ratio = Math.max(vf, 0) / vtop;
      let curve = 1 - Math.pow(Math.min(ratio, 1.35), 2.2);
      curve = Math.max(curve, -0.55);
      let a = s.accel0 * curve * (car.nitroActive ? s.nitroAccelMul : 1);
      // trazione limitata alla partenza
      a = Math.min(a, 7.6 * surfGrip + (car.nitroActive ? 2.5 : 0));
      if (car.shiftTimer > 0) a *= 0.35;
      aLong = a * throttle;
    }
  } else {
    // a gas chiuso: resistenze + freno motore
    aLong = vf > 0 ? -(1.0 + 0.35 + 0.00055 * vf * vf) : (vf < 0 ? 1.5 : 0);
  }
  if (brake > 0.02) {
    if (vf > 0.6) {
      aLong -= brake * s.brake * Math.min(1, surfGrip + 0.15);
    } else if (throttle < 0.05) {
      car.reversing = true;
      if (vf > -11) aLong -= brake * 5.4;
    }
  }
  if (hb && vf > 0) aLong -= 2.2;
  // fuori pista: resistenza aggiuntiva
  if (car.surfaceDrag > 0 && vf > 0) aLong -= car.surfaceDrag;

  // ---------------- Imbardata ----------------
  const vAbs = Math.abs(vf);
  // cerchio d'aderenza: frenando/accelerando forte resta meno aderenza laterale. Anche la rotazione del muso
  // ne tiene conto, così il muso non punta dentro la curva mentre l'auto scivola dritta (falso sottosterzo).
  const demand = Math.abs(aLong);
  const circle = Math.sqrt(Math.max(0.5, 1 - Math.pow(demand / 21, 2)));
  const wMax = maxYawRate(s, vf, surfGrip * circle);
  let wTarget = -steer * wMax * (vf >= -0.3 ? 1 : -1);
  if (hb && vAbs > 7) wTarget *= 1.6;
  // coppia di autoallineamento: riporta il muso lungo la traiettoria (si riduce col freno a mano)
  // A bassa velocità l'auto "perna" sull'asse posteriore: il baricentro scivola verso l'interno della curva
  // (vlEq) e la coda segue la traiettoria del muso invece di sbandare verso l'esterno.
  const ell = s.wheelbase * 0.5;
  const kin = 1 / (1 + Math.pow(vAbs / 16, 2));
  const alignK = hb ? 0.85 : 1.8;
  const align = (-(vl + car.yawRate * ell * kin) / Math.max(vAbs, 6)) * alignK;
  const wDesired = wTarget + (vAbs > 3 ? align : 0);
  car.yawRate += (wDesired - car.yawRate) * (1 - Math.exp(-11 * dt));
  // quando si è quasi fermi l'imbardata decade
  if (vAbs < 0.4 && throttle < 0.05) car.yawRate *= 0.9;

  // ---------------- Applicazione forze ----------------
  vf += aLong * dt;

  // aderenza laterale con cerchio d'aderenza semplificato
  const rearGrip = hb ? 0.26 : 1;
  const latCap = latGripAt(s, vAbs, surfGrip) * circle * rearGrip;
  const wasLat = vl;
  const vlEq = hb ? 0 : -car.yawRate * ell * kin;
  let dvl = (vlEq - vl) * (1 - Math.exp(-(14 + 16 * kin) * dt));   // a bassa velocità le gomme reagiscono più in fretta
  const cap = latCap * dt;
  dvl = clamp(dvl, -cap, cap);
  vl += dvl;
  // l'attrito laterale scalda le gomme: costa un po' di velocità
  if (vf > 0) vf -= Math.abs(dvl) * 0.32 * (Math.abs(wasLat) > 2 ? 1 : 0.3);

  // ---------------- Integrazione ----------------
  // ricostruisco la velocità mondo nel sistema "vecchio": l'inerzia lavora a favore dello slittamento
  car.vx = hx * vf + rx * vl;
  car.vz = hz * vf + rz * vl;
  car.heading = wrapAngle(car.heading + car.yawRate * dt);
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // ---------------- Derivati per HUD/audio/render ----------------
  const hx2 = Math.sin(car.heading), hz2 = Math.cos(car.heading);
  car.vf = car.vx * hx2 + car.vz * hz2;
  car.vl = car.vx * -hz2 + car.vz * hx2;
  car.speed = Math.hypot(car.vx, car.vz);
  car.slipAngle = Math.atan2(Math.abs(car.vl + car.yawRate * ell * kin), Math.max(Math.abs(car.vf), 1));
  const driftTarget = car.speed > 7 ? smoothstep(0.1, 0.42, car.slipAngle) : 0;
  car.drift += (driftTarget - car.drift) * (1 - Math.exp(-10 * dt));
  car.wheelspin = throttle > 0.85 && car.vf < 14 && surfGrip > 0.7
    ? (1 - car.vf / 14) : (car.nitroActive && car.vf < 30 ? 0.5 : 0);

  const accLongNow = (vf - vf0) / dt;
  car.accLong += (accLongNow - car.accLong) * (1 - Math.exp(-8 * dt));
  const accLatNow = car.yawRate * car.vf;
  car.accLat += (accLatNow - car.accLat) * (1 - Math.exp(-8 * dt));

  // sterzo visuale
  const visTarget = steer * clamp(0.56 - car.speed * 0.0055, 0.15, 0.56);
  car.steerAngle += (visTarget - car.steerAngle) * (1 - Math.exp(-14 * dt));
  car.wheelRot += (car.vf / 0.34) * dt; // raggio ruota ~0.34 m

  updateGearbox(car, car.vf, throttle, dt);
}

// ---------------------------------------------------------------------------
// Collisioni
// ---------------------------------------------------------------------------

/**
 * Collisione con i muri laterali della pista. `info` = nearestOnTrack(...)
 * Ritorna l'intensità dell'impatto (m/s, velocità normale al muro).
 */
export function resolveWall(car, track, info, dt) {
  const limit = track.wallOffset - 1.0;
  const d = info.d;
  const ad = Math.abs(d);
  car.scrape = 0;
  if (ad <= limit) return 0;
  const sgn = d > 0 ? 1 : -1;
  const nx = info.nx * sgn, nz = info.nz * sgn; // normale verso il muro
  const pen = ad - limit;
  car.x -= nx * pen;
  car.z -= nz * pen;
  const vn = car.vx * nx + car.vz * nz;
  let impact = 0;
  if (vn > 0) {
    impact = vn;
    car.vx -= 1.16 * vn * nx;
    car.vz -= 1.16 * vn * nz;
    const scrub = 1 - Math.min(0.4, 0.014 * vn * vn / 2 + 0.01);
    car.vx *= scrub; car.vz *= scrub;
  }
  // radente al muro: attrito continuo + il muso tende a riallinearsi
  const sp = car.speed;
  if (sp > 2) {
    car.scrape = clamp(sp / 25, 0.2, 1);
    const f = Math.max(0, 1 - 3.2 * dt);
    car.vx *= f; car.vz *= f;
    const trackHeading = Math.atan2(info.tx, info.tz);
    const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
    if (hx * info.tx + hz * info.tz > 0) {
      const err = wrapAngle(trackHeading - car.heading);
      car.heading = wrapAngle(car.heading + err * Math.min(0.5, 2.2 * dt + impact * 0.012));
    }
  }
  car.impact = Math.max(car.impact, impact);
  return impact;
}

const CIRCLE_R = 1.08;
const CIRCLE_OFF = 1.25;

/** Collisione tra due auto (due cerchi per vettura). Ritorna intensità o 0. */
export function collideCars(a, b) {
  const ahx = Math.sin(a.heading), ahz = Math.cos(a.heading);
  const bhx = Math.sin(b.heading), bhz = Math.cos(b.heading);
  const ca = [[a.x + ahx * CIRCLE_OFF, a.z + ahz * CIRCLE_OFF], [a.x - ahx * CIRCLE_OFF, a.z - ahz * CIRCLE_OFF]];
  const cb = [[b.x + bhx * CIRCLE_OFF, b.z + bhz * CIRCLE_OFF], [b.x - bhx * CIRCLE_OFF, b.z - bhz * CIRCLE_OFF]];
  let best = null, bestPen = 0;
  for (const p of ca) for (const q of cb) {
    const dx = p[0] - q[0], dz = p[1] - q[1];
    const dist = Math.hypot(dx, dz);
    const pen = 2 * CIRCLE_R - dist;
    if (pen > bestPen) { bestPen = pen; best = { p, q, dx, dz, dist }; }
  }
  if (!best) return 0;
  let nx = best.dx, nz = best.dz;
  const l = best.dist;
  if (l < 1e-4) { nx = 1; nz = 0; } else { nx /= l; nz /= l; }
  // separazione
  a.x += nx * bestPen * 0.5; a.z += nz * bestPen * 0.5;
  b.x -= nx * bestPen * 0.5; b.z -= nz * bestPen * 0.5;
  // impulso (masse uguali)
  const rvx = a.vx - b.vx, rvz = a.vz - b.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  const e = 0.22;
  const j = (-(1 + e) * vn) / 2;
  a.vx += nx * j; a.vz += nz * j;
  b.vx -= nx * j; b.vz -= nz * j;
  // un po' di rotazione dal punto di contatto
  const cx = (best.p[0] + best.q[0]) / 2, cz = (best.p[1] + best.q[1]) / 2;
  const ra = [cx - a.x, cz - a.z], rb = [cx - b.x, cz - b.z];
  const ta = (ra[0] * nz - ra[1] * nx) * j * 0.05;
  const tb = -(rb[0] * nz - rb[1] * nx) * j * 0.05;
  a.yawRate += clamp(ta, -1.2, 1.2);
  b.yawRate += clamp(tb, -1.2, 1.2);
  const intensity = -vn;
  a.impact = Math.max(a.impact, intensity);
  b.impact = Math.max(b.impact, intensity);
  return intensity;
}
