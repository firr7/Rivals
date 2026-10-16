// Logica della gara: griglia, countdown, giri, posizioni, collisioni, respawn.
// Modulo puro (nessun DOM): i risultati arrivano al resto del gioco tramite `race.events`.

import { nearestOnTrack, pointAt } from './track-data.js';
import { makeCar, stepCar, resolveWall, collideCars, clamp, IDLE_RPM } from './car-physics.js';
import { buildTrackProfile, createAI, aiControl } from './ai.js';
import { GAME, RIVALS } from './config.js';

export const FIXED_DT = 1 / 120;
const DIFFICULTY = { easy: 0.955, normal: 1.0, hard: 1.035 };

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

/**
 * opts: {
 *   track, spec, playerName, playerColor, rivalCount, laps, difficulty,
 *   seed, autoPlayer (solo test: il giocatore è guidato dall'AI)
 * }
 */
export function createRace(opts) {
  const track = opts.track;
  const spec = opts.spec;
  const laps = opts.laps ?? GAME.laps;
  const rivalCount = Math.min(opts.rivalCount ?? GAME.rivals, RIVALS.length);
  const profile = buildTrackProfile(track, spec);
  const seed = opts.seed ?? 12345;
  const total = 1 + rivalCount;
  const playerSlot = Math.min(2, total - 1);

  const slotPos = (k) => {
    const row = Math.floor(k / 2), col = k % 2;
    const s = track.length - (10 + row * 9.5 + col * 4.5);
    const d = col ? 3.9 : -3.9;
    return pointAt(track, s, d, {});
  };

  const cars = [];
  let rivalIdx = 0;
  for (let k = 0; k < total; k++) {
    const isPlayer = k === playerSlot;
    const p = slotPos(k);
    const car = makeCar(spec, p.x, p.z, p.heading);
    car.nitro = 100;
    let name, color, ai = null;
    if (isPlayer) {
      name = opts.playerName || 'TU';
      color = opts.playerColor || '#1f4fd8';
      if (opts.autoPlayer) ai = createAI(track, profile, { skill: 0.97, aggression: 0.7, lane: 0 }, seed + 99);
    } else {
      const r = RIVALS[rivalIdx++];
      name = r.name; color = r.color;
      ai = createAI(track, profile, r, seed + 17 * rivalIdx);
    }
    const info = nearestOnTrack(track, car.x, car.z);
    cars.push({
      id: k,
      name, color, isPlayer,
      car, ai,
      input: { ...NO_INPUT },
      info,
      prog: {
        prevS: info.s,
        total: info.s > track.length / 2 ? info.s - track.length : info.s,
        lapsDone: 0,
        lapStart: 0,
        lapTimes: [],
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        place: k + 1,
        gridSlot: k,
      },
      wrongTimer: 0,
      resetCooldown: 0,
      respawns: 0,
      autopilot: false,
      aiTick: 0,
      lastPlace: k + 1,
    });
  }

  const race = {
    track, spec, profile, laps, seed,
    difficulty: opts.difficulty || 'normal',
    cars,
    player: cars[playerSlot],
    phase: 'intro',            // intro -> countdown -> running -> finished
    introTimer: 1.4,
    countdown: GAME.countdownSeconds,
    lastCountInt: -1,
    time: 0,                   // secondi dal via
    acc: 0,
    events: [],
    finishedAt: -1,            // tempo (race.time) in cui il giocatore ha tagliato il traguardo
    standings: [],
    playerWrongWay: false,
    autoPlayer: !!opts.autoPlayer,
  };
  race.standings = computeStandings(race);
  return race;
}

export function drainEvents(race) {
  const e = race.events;
  race.events = [];
  return e;
}

// ---------------------------------------------------------------------------

function surfaceFor(car, d, track) {
  const ad = Math.abs(d);
  const hw = track.halfWidth;
  if (ad <= hw) { car.surfaceGrip = 1; car.surfaceDrag = 0; }
  else if (ad <= hw + 0.9) { car.surfaceGrip = 0.9; car.surfaceDrag = 0.6; }
  else { car.surfaceGrip = 0.62; car.surfaceDrag = 3.2; }
}

export function respawnCar(race, rc, keepSpeed = true) {
  const T = race.track, car = rc.car;
  const info = nearestOnTrack(T, car.x, car.z, rc.info.index, 90);
  const d = clamp(info.d, -4.5, 4.5) * 0.4;
  const p = pointAt(T, info.s + 5, d, {});
  car.x = p.x; car.z = p.z; car.heading = p.heading;
  const sp = keepSpeed ? Math.min(car.speed * 0.5, 24) : 0;
  car.vx = Math.sin(p.heading) * sp; car.vz = Math.cos(p.heading) * sp;
  car.yawRate = 0; car.vl = 0; car.vf = sp; car.speed = sp; car.drift = 0;
  car.steerAngle = 0;
  rc.info = nearestOnTrack(T, car.x, car.z, info.index, 40);
  rc.prog.prevS = rc.info.s;
  rc.resetCooldown = 1.6;
  rc.respawns++;
  rc.wrongTimer = 0;
  if (rc.ai) { rc.ai.stuck = 0; rc.ai.avoid = 0; rc.ai.steer = 0; rc.ai.wantRespawn = false; }
  race.events.push({ type: 'respawn', car: rc });
}

function updateProgress(race, rc) {
  const T = race.track, L = T.length, p = rc.prog;
  let ds = rc.info.s - p.prevS;
  if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
  p.prevS = rc.info.s;
  if (Math.abs(ds) < 80) p.total += ds;
  if (p.finished) return;
  if (race.phase !== 'running' && race.phase !== 'finished') return;

  while (p.total >= (p.lapsDone + 1) * L && !p.finished) {
    const over = p.total - (p.lapsDone + 1) * L;
    const tCross = race.time - over / Math.max(rc.car.speed, 1);
    const lapTime = tCross - p.lapStart;
    p.lapsDone++;
    p.lapTimes.push(lapTime);
    const isBest = lapTime < p.bestLap;
    if (isBest) p.bestLap = lapTime;
    p.lapStart = tCross;
    if (p.lapsDone >= race.laps) {
      p.finished = true;
      p.finishTime = tCross;
      race.events.push({ type: 'finish', car: rc, time: tCross, lapTime, bestLap: isBest });
      if (rc.isPlayer) {
        race.phase = 'finished';
        race.finishedAt = race.time;
        // dopo il traguardo l'auto del giocatore prosegue in auto-pilota
        if (!rc.ai) rc.ai = createAI(T, race.profile, { skill: 0.9, aggression: 0.2, lane: 0 }, race.seed + 5);
        rc.autopilot = true;
        rc.ai.paceMul = 0.55;
      } else {
        rc.autopilot = true;
        if (rc.ai) rc.ai.paceMul = 0.5;
      }
    } else {
      race.events.push({ type: 'lap', car: rc, lap: p.lapsDone + 1, lapTime, best: isBest });
    }
  }
}

export function computeStandings(race) {
  const list = race.cars.slice();
  list.sort((a, b) => {
    const pa = a.prog, pb = b.prog;
    if (pa.finished && pb.finished) return pa.finishTime - pb.finishTime;
    if (pa.finished) return -1;
    if (pb.finished) return 1;
    return pb.total - pa.total;
  });
  list.forEach((rc, i) => { rc.prog.place = i + 1; });
  return list;
}

// ---------------------------------------------------------------------------

function substep(race, dt, playerInput) {
  const T = race.track;
  const cars = race.cars;

  // -------- fasi
  if (race.phase === 'intro') {
    race.introTimer -= dt;
    if (race.introTimer <= 0) race.phase = 'countdown';
  } else if (race.phase === 'countdown') {
    race.countdown -= dt;
    const n = Math.ceil(race.countdown);
    if (n >= 1 && n !== race.lastCountInt) { race.lastCountInt = n; race.events.push({ type: 'count', n }); }
    if (race.countdown <= 0) {
      race.phase = 'running';
      race.time = 0;
      race.events.push({ type: 'go' });
    }
  }
  const live = race.phase === 'running' || race.phase === 'finished';
  if (live) race.time += dt;

  const diffMul = DIFFICULTY[race.difficulty] ?? 1;
  const playerTotal = race.player.prog.total;

  // -------- input + fisica per auto
  for (const rc of cars) {
    const car = rc.car;
    rc.resetCooldown = Math.max(0, rc.resetCooldown - dt);
    car.impact = 0;
    const info = rc.info = nearestOnTrack(T, car.x, car.z, rc.info.index, 40);
    surfaceFor(car, info.d, T);

    let input;
    if (!live) {
      // sulla griglia: auto ferma, il giocatore può "dare gas" per far salire i giri
      input = NO_INPUT;
      const th = rc.isPlayer ? clamp(playerInput.throttle || 0, 0, 1) : 0;
      const target = IDLE_RPM + th * 5200 + (rc.isPlayer ? 0 : 0);
      car.rpm += (target - car.rpm) * (1 - Math.exp(-7 * dt));
      car.throttle = th;
      continue;
    }

    if (rc.isPlayer && !rc.autopilot && !race.autoPlayer) {
      input = playerInput;
    } else {
      rc.aiTick++;
      if (!rc.ai) rc.ai = createAI(T, race.profile, { skill: 0.97, aggression: 0.7, lane: 0 }, race.seed + 99);
      if (rc.aiTick % 2 === 1 || !rc.input) {
        // rubber band leggero rispetto al giocatore
        if (!rc.isPlayer && !rc.autopilot) {
          const gap = rc.prog.total - playerTotal;
          let mul = 1;
          if (gap < -40) mul += Math.min(0.045, (-gap - 40) * 0.00022);
          else if (gap > 70) mul -= Math.min(0.08, (gap - 70) * 0.00028);
          rc.ai.paceMul = mul * diffMul;
        }
        const others = [];
        for (const o of cars) if (o !== rc) others.push(o);
        rc.input = aiControl(rc.ai, car, info, dt * 2, others, true);
      }
      input = rc.input;
      if (rc.ai.wantRespawn && rc.resetCooldown <= 0) respawnCar(race, rc, false);
    }
    stepCar(car, input, dt);
  }

  // -------- collisioni tra auto
  if (live) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.car.x - b.car.x) > 6 || Math.abs(a.car.z - b.car.z) > 6) continue;
        const hit = collideCars(a.car, b.car);
        if (hit > 1.2) race.events.push({ type: 'crash', kind: 'car', a, b, intensity: hit });
      }
    }
  }

  // -------- muri + avanzamento
  for (const rc of cars) {
    const car = rc.car;
    const info = rc.info = nearestOnTrack(T, car.x, car.z, rc.info.index, 40);
    const hit = resolveWall(car, T, info, dt);
    if (hit > 2.0) race.events.push({ type: 'crash', kind: 'wall', car: rc, intensity: hit });
    updateProgress(race, rc);

    // contromano
    if (live && rc.isPlayer) {
      const dot = Math.sin(car.heading) * info.tx + Math.cos(car.heading) * info.tz;
      if (dot < -0.2 && car.speed > 3) rc.wrongTimer += dt; else rc.wrongTimer = Math.max(0, rc.wrongTimer - dt * 2);
      race.playerWrongWay = rc.wrongTimer > 1.1;
      if (rc.wrongTimer > 9 && rc.resetCooldown <= 0) respawnCar(race, rc, false);
    }
  }

  race.standings = computeStandings(race);
  for (const rc of cars) {
    if (rc.prog.place !== rc.lastPlace) {
      if (rc.isPlayer && live) race.events.push({ type: 'place', place: rc.prog.place, from: rc.lastPlace });
      rc.lastPlace = rc.prog.place;
    }
  }
}

/**
 * Avanza la gara di `frameDt` secondi reali (con sotto-passi a passo fisso).
 * playerInput: { throttle, brake, steer, handbrake, nitro, reset }
 */
export function stepRace(race, frameDt, playerInput = NO_INPUT) {
  race.acc += Math.min(frameDt, 0.1);
  let steps = 0;
  while (race.acc >= FIXED_DT && steps < 14) {
    race.acc -= FIXED_DT;
    substep(race, FIXED_DT, playerInput);
    steps++;
  }
  if (steps >= 14) race.acc = 0;
  // respawn manuale del giocatore
  const rc = race.player;
  if (playerInput.reset && rc.resetCooldown <= 0 && (race.phase === 'running')) respawnCar(race, rc, true);
}
