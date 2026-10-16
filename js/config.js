// Costanti di gioco condivise (nessuna dipendenza da DOM o three.js).

export const GAME = {
  title: 'REDLINE RIVALS',
  version: '1.0.0',
  laps: 3,
  rivals: 3,
  countdownSeconds: 3,
};

// Auto selezionabile. Per ora una sola, ma la struttura permette di aggiungerne altre.
export const CARS = [
  {
    id: 'apex-gt',
    name: 'APEX GT-R',
    tagline: 'Coupé da strada pronta alla guerra',
    stats: { speed: 8, accel: 7, handling: 7, nitro: 8 },
    colors: [
      { name: 'Blu Notte', hex: '#1f4fd8' },
      { name: 'Rosso Corsa', hex: '#d3121c' },
      { name: 'Argento', hex: '#b9bec6' },
      { name: 'Arancio Fuoco', hex: '#ff6a00' },
      { name: 'Nero Lucido', hex: '#16171b' },
      { name: 'Verde Acido', hex: '#6bd12a' },
    ],
    physics: {
      mass: 1500,
      wheelbase: 2.65,
      length: 4.55,
      width: 1.9,
      topSpeed: 71,        // m/s  (~256 km/h)
      accel0: 7.3,         // m/s^2 a bassa velocità
      brake: 14,           // m/s^2
      nitroAccelMul: 1.45,
      nitroTopMul: 1.14,
      maxSteer: 0.62,      // rad a bassa velocità (curve strette)
      maxYaw: 0.85,        // rad/s: tetto alla rotazione (niente "trottola" a bassa velocità)
      latGrip: 16.5,       // m/s^2 di accelerazione laterale massima a bassa velocità
      downforce: 0.9,      // quanto cresce l'aderenza con la velocità (a 70 m/s: +90%)
    },
  },
];

export const RIVALS = [
  { name: 'RAZOR',  color: '#e8e8ea', skill: 0.955, aggression: 0.8, lane: -3.2 },
  { name: 'BLACKLIST #7', color: '#101114', skill: 0.935, aggression: 0.5, lane: 3.0 },
  { name: 'DIABLO', color: '#ff9a00', skill: 0.915, aggression: 0.65, lane: -0.4 },
  { name: 'KAZE',   color: '#7a1fd6', skill: 0.90, aggression: 0.4, lane: 1.8 },
  { name: 'VIPER',  color: '#18b36b', skill: 0.89, aggression: 0.5, lane: -2.0 },
];

export const QUALITY = {
  low:    { label: 'BASSA',  pixelRatio: 1,   bloom: false, shadows: false, buildings: 90,  lamps: 40,  particles: 60,  skid: true,  radialBlur: false },
  medium: { label: 'MEDIA',  pixelRatio: 1.5, bloom: true,  shadows: false, buildings: 170, lamps: 80,  particles: 120, skid: true,  radialBlur: true },
  high:   { label: 'ALTA',   pixelRatio: 2,   bloom: true,  shadows: true,  buildings: 260, lamps: 140, particles: 220, skid: true,  radialBlur: true },
};

export const DEFAULT_SETTINGS = {
  quality: 'auto',      // auto | low | medium | high
  difficulty: 'normal', // easy | normal | hard
  laps: 3,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  autoGas: false,       // accelerazione automatica (utile su touch)
  steerAssist: true, steerSens: 1,
  showFps: false,
  units: 'kmh',         // kmh | mph
  touchControls: 'auto', // auto | on | off
};

export const KMH = 3.6;
export const MPH = 2.236936;
