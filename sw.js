/* Redline Rivals — service worker
 * Strategia: precache completa all'installazione, poi "cache first" (il gioco funziona offline).
 * Gli aggiornamenti arrivano cambiando VERSION: lo script tools/build-sw.mjs lo calcola dal contenuto dei file.
 */

// <build:version>
const VERSION = 'rr-814528733e';
// </build:version>

// <build:precache>
const PRECACHE = [
  './',
  './css/style.css',
  './fonts/LICENSE-Orbitron.txt',
  './fonts/LICENSE-Rajdhani.txt',
  './fonts/orbitron-latin-700-normal.woff2',
  './fonts/orbitron-latin-900-normal.woff2',
  './fonts/rajdhani-latin-500-normal.woff2',
  './fonts/rajdhani-latin-600-normal.woff2',
  './fonts/rajdhani-latin-700-normal.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-32.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './js/ai.js',
  './js/audio.js',
  './js/car-physics.js',
  './js/config.js',
  './js/engine-synth.js',
  './js/game.js',
  './js/gfx/camera.js',
  './js/gfx/car-model.js',
  './js/gfx/city.js',
  './js/gfx/fx.js',
  './js/gfx/geo.js',
  './js/gfx/sky.js',
  './js/gfx/textures.js',
  './js/gfx/track-mesh.js',
  './js/gfx/world.js',
  './js/input.js',
  './js/main.js',
  './js/race.js',
  './js/storage.js',
  './js/three.js',
  './js/track-data.js',
  './js/ui.js',
  './manifest.webmanifest',
  './package.json',
  './vendor/three/addons/postprocessing/EffectComposer.js',
  './vendor/three/addons/postprocessing/MaskPass.js',
  './vendor/three/addons/postprocessing/OutputPass.js',
  './vendor/three/addons/postprocessing/Pass.js',
  './vendor/three/addons/postprocessing/RenderPass.js',
  './vendor/three/addons/postprocessing/ShaderPass.js',
  './vendor/three/addons/postprocessing/UnrealBloomPass.js',
  './vendor/three/addons/shaders/CopyShader.js',
  './vendor/three/addons/shaders/LuminosityHighPassShader.js',
  './vendor/three/addons/shaders/OutputShader.js',
  './vendor/three/three.core.js',
  './vendor/three/three.module.js',
];
// </build:precache>

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // `cache: 'reload'` salta la cache HTTP del browser/CDN e prende i file freschi
    await Promise.all(PRECACHE.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache fallita: ' + url + ' (' + res.status + ')');
      await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('rr-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const home = (await cache.match('./index.html')) || (await cache.match('./'));
        if (home) return home;
      }
      throw err;
    }
  })());
});
