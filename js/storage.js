// Salvataggi locali (localStorage) con valori di default e tolleranza agli errori
// (modalità privata, quota piena, storage disabilitato).

import { DEFAULT_SETTINGS } from './config.js';

const K = { settings: 'redline.settings.v1', records: 'redline.records.v1', garage: 'redline.garage.v1' };
const DEFAULT_RECORDS = { bestLap: null, bestRace: null, wins: 0, races: 0 };
const DEFAULT_GARAGE = { car: 'apex-gt', color: 0 };

function read(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch { return { ...defaults }; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignora */ }
}

export const Store = {
  settings: read(K.settings, DEFAULT_SETTINGS),
  records: read(K.records, DEFAULT_RECORDS),
  garage: read(K.garage, DEFAULT_GARAGE),

  setSettings(patch) { Object.assign(this.settings, patch); write(K.settings, this.settings); },
  setGarage(patch) { Object.assign(this.garage, patch); write(K.garage, this.garage); },

  /** Registra il risultato di una gara. Ritorna { newBestLap, newBestRace }. */
  addRaceResult({ place, time, bestLap }) {
    const r = this.records;
    r.races++;
    if (place === 1) r.wins++;
    let newBestLap = false, newBestRace = false;
    if (bestLap && (r.bestLap == null || bestLap < r.bestLap)) { r.bestLap = bestLap; newBestLap = true; }
    if (time && place === 1 && (r.bestRace == null || time < r.bestRace)) { r.bestRace = time; newBestRace = true; }
    write(K.records, r);
    return { newBestLap, newBestRace };
  },
  /** Aggiorna il miglior giro durante la gara (senza contare la gara). */
  noteLap(lapTime) {
    const r = this.records;
    if (r.bestLap == null || lapTime < r.bestLap) { r.bestLap = lapTime; write(K.records, r); return true; }
    return false;
  },
  resetRecords() { this.records = { ...DEFAULT_RECORDS }; write(K.records, this.records); },
};

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
