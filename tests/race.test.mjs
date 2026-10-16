import { buildTrack, TRACKS, analyzeTrack } from '../js/track-data.js';
import { CARS, GAME } from '../js/config.js';
import { createRace, stepRace, drainEvents } from '../js/race.js';
import assert from 'node:assert/strict';

const track = buildTrack(TRACKS.downtown);
const an = analyzeTrack(track);
console.log(`pista ${track.name}: ${(an.length).toFixed(0)} m, raggio min ${an.minRadius.toFixed(0)} m, gap min ${an.minGap.toFixed(0)} m`);
assert.ok(an.minGap > 60, 'tratti troppo vicini');
assert.ok(an.minRadius > 30, 'curva troppo stretta');

const race = createRace({ track, spec: CARS[0].physics, rivalCount: 3, laps: 3, autoPlayer: true, seed: 7, difficulty: 'normal' });
const frame = 1 / 60;
let t = 0, crashes = { wall: 0, car: 0 }, respawns = 0;
const lapLog = {};
const pos = [];
while (t < 600) {
  stepRace(race, frame, { throttle: 0, brake: 0, steer: 0 });
  t += frame;
  for (const e of drainEvents(race)) {
    if (e.type === 'crash') crashes[e.kind]++;
    if (e.type === 'respawn') respawns++;
    if (e.type === 'lap' || e.type === 'finish') {
      (lapLog[e.car.name] ||= []).push(e.lapTime);
    }
    if (e.type === 'go') console.log('GO a t=', t.toFixed(2));
  }
  if (race.cars.every(c => c.prog.finished)) break;
}
console.log('fine simulazione a', t.toFixed(1), 's, race.time', race.time.toFixed(1));
for (const rc of race.standings) {
  const laps = (lapLog[rc.name] || []).map(x => x.toFixed(1)).join(' / ');
  console.log(`${rc.prog.place}. ${rc.name.padEnd(14)} finito=${rc.prog.finished} tempo=${rc.prog.finishTime.toFixed(1)} giri: ${laps}  respawn=${rc.respawns}`);
}
console.log('impatti', crashes, 'respawn', respawns);
assert.ok(race.cars.every(c => c.prog.finished), 'non tutte le auto hanno finito');
for (const rc of race.cars) assert.ok(rc.respawns <= 2, rc.name + ' troppi respawn');
const avgLap = race.cars.map(c => c.prog.bestLap);
console.log('giri migliori', avgLap.map(x => x.toFixed(1)).join(', '));
assert.ok(Math.min(...avgLap) > 55 && Math.max(...avgLap) < 120, 'tempi sul giro irrealistici');
console.log('OK race');
