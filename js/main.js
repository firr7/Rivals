// Punto d'ingresso: avvia il gioco e registra il service worker (PWA).

import { Game } from './game.js';

const $ = (s) => document.querySelector(s);

function fatal(msg) {
  const t = $('#loading-text');
  if (t) { t.textContent = msg; t.style.color = '#ff8a7a'; }
  const b = $('#loading-bar');
  if (b) b.style.background = '#c33';
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

async function boot() {
  if (!hasWebGL2()) {
    fatal('Questo browser non supporta WebGL 2: prova ad aggiornare il browser o ad attivare l\'accelerazione hardware.');
    return;
  }
  const game = new Game();
  window.__game = game; // utile per il debug da console

  // Installazione PWA (Chrome/Edge/Android)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    game.setInstallEvent(e);
  });
  window.addEventListener('appinstalled', () => {
    game.setInstallEvent(null);
    game.ui.toast('App installata!');
  });

  const setNet = () => game.ui.setOnline(navigator.onLine);
  window.addEventListener('online', setNet);
  window.addEventListener('offline', setNet);

  try {
    await game.init();
    setNet();
  } catch (err) {
    console.error(err);
    fatal('Errore di avvio: ' + (err && err.message ? err.message : err));
    return;
  }

  registerServiceWorker(game);
}

function registerServiceWorker(game) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const params = new URLSearchParams(location.search);
  if (params.has('nosw')) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // nuova versione scaricata mentre il gioco è aperto
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          game.ui.toast('Aggiornamento scaricato: riavvia il gioco per usarlo', 5000);
        }
      });
    });
    // controlla aggiornamenti ogni tanto (app lasciata aperta a lungo)
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch((e) => console.warn('Service worker non registrato:', e));
}

boot();
