import { CARS } from '../js/config.js';
import { makeCar, stepCar } from '../js/car-physics.js';
import assert from 'node:assert/strict';

const spec = CARS[0].physics;
const dt = 1 / 120;
const out = (n, v) => console.log(n.padEnd(34), v);

// --- accelerazione rettilinea
{
  const c = makeCar(spec, 0, 0, 0);
  let t = 0, t100 = 0, t200 = 0, t250 = 0;
  const inp = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
  while (t < 90) {
    stepCar(c, inp, dt); t += dt;
    if (!t100 && c.speed * 3.6 >= 100) t100 = t;
    if (!t200 && c.speed * 3.6 >= 200) t200 = t;
    if (!t250 && c.speed * 3.6 >= 250) t250 = t;
  }
  out('0-100 km/h (s)', t100.toFixed(2));
  out('0-200 km/h (s)', t200.toFixed(2));
  out('0-250 km/h (s)', t250.toFixed(2));
  out('velocità finale km/h', (c.speed * 3.6).toFixed(1));
  assert.ok(t100 > 3.4 && t100 < 5.2, '0-100 fuori range');
  assert.ok(c.speed * 3.6 > 245 && c.speed * 3.6 < 262, 'top speed fuori range');
  // con nitro
  // nitro da fermo: picco di velocità durante la spinta (~4 s di serbatoio)
  const n = makeCar(spec, 0, 0, 0); t = 0; let peak = 0, tn = 0;
  while (t < 14) { stepCar(n, { ...inp, nitro: true }, dt); t += dt; if (n.nitroActive) { tn = t; peak = n.speed * 3.6; } }
  out('velocità a fine nitro km/h', peak.toFixed(1) + '  (nitro finito a ' + tn.toFixed(1) + ' s)');
  const base = makeCar(spec, 0, 0, 0); t = 0; while (t < tn) { stepCar(base, inp, dt); t += dt; }
  out('stesso istante senza nitro km/h', (base.speed * 3.6).toFixed(1));
  assert.ok(n.speed * 3.6 > 0 && peak > base.speed * 3.6 + 25, 'nitro non incrementa abbastanza la velocità');
  c.nitro = 100; t = 0;
}

// --- frenata da 200 km/h
{
  const c = makeCar(spec, 0, 0, 0);
  c.vz = 200 / 3.6; c.speed = c.vf = c.vz; c.gear = 6;
  let t = 0, d = 0;
  while (c.speed > 0.5 && t < 30) { stepCar(c, { throttle: 0, brake: 1, steer: 0 }, dt); d += c.speed * dt; t += dt; }
  out('frenata 200->0 (s / m)', t.toFixed(2) + ' / ' + d.toFixed(1));
  assert.ok(t > 3 && t < 7);
}

// --- curva a regime a varie velocità: raggio e slittamento
for (const kmh of [50, 100, 150, 200]) {
  const c = makeCar(spec, 0, 0, 0);
  c.vz = kmh / 3.6; c.speed = c.vf = c.vz; c.gear = 3;
  let t = 0, maxSlip = 0, x0 = 0;
  // mantiene la velocità
  while (t < 3) {
    stepCar(c, { throttle: c.speed < kmh / 3.6 ? 1 : 0.0, brake: 0, steer: 1 }, dt); t += dt;
    maxSlip = Math.max(maxSlip, c.slipAngle);
  }
  const R = c.speed / Math.max(Math.abs(c.yawRate), 1e-3);
  out(`steer pieno @${kmh} km/h  raggio m`, R.toFixed(1) + ` slip max ${(maxSlip * 57.3).toFixed(1)}° vel ${(c.speed * 3.6).toFixed(0)}`);
}

// --- freno a mano in curva a 120 km/h -> drift
{
  const c = makeCar(spec, 0, 0, 0);
  c.vz = 120 / 3.6; c.speed = c.vf = c.vz; c.gear = 4;
  let t = 0, maxSlip = 0, maxDrift = 0;
  while (t < 1.5) {
    stepCar(c, { throttle: 0.5, brake: 0, steer: 0.8, handbrake: true }, dt); t += dt;
    maxSlip = Math.max(maxSlip, c.slipAngle); maxDrift = Math.max(maxDrift, c.drift);
  }
  out('freno a mano 120 km/h slip max °', (maxSlip * 57.3).toFixed(1) + ' drift ' + maxDrift.toFixed(2));
  assert.ok(maxSlip * 57.3 > 12, 'il freno a mano non produce drift');
  // rilascio: deve rientrare
  t = 0;
  while (t < 2.5) { stepCar(c, { throttle: 0.6, brake: 0, steer: 0, handbrake: false }, dt); t += dt; }
  out('dopo rilascio slip °', (c.slipAngle * 57.3).toFixed(1));
  assert.ok(c.slipAngle * 57.3 < 6, 'il drift non rientra');
}

// --- retromarcia
{
  const c = makeCar(spec, 0, 0, 0);
  let t = 0;
  while (t < 3) { stepCar(c, { throttle: 0, brake: 1, steer: 0 }, dt); t += dt; }
  out('retromarcia vf m/s', c.vf.toFixed(2));
  assert.ok(c.vf < -4);
}
console.log('\nOK physics');
