# REDLINE RIVALS

Gioco di corse stradali 3D al tramonto, ispirato all'atmosfera di *Need for Speed: Most Wanted* (2005):
menu principale → **GIOCA** → garage (scelta dell'auto) → gara su un circuito cittadino contro 3 rivali.

È una **PWA**: HTML + JavaScript puri (moduli ES, nessun bundler), grafica 3D con [Three.js](https://threejs.org/)
inclusa nel progetto. Si pubblica su **GitHub Pages**, si installa come app e funziona **offline**.

> Tutta la grafica, i suoni e la musica sono generati dal codice: nessun asset di EA o di terzi
> (solo i font Orbitron e Rajdhani, licenza OFL). Nomi, auto e circuito sono originali.

## Pubblicare su GitHub Pages

1. Crea un nuovo repository su GitHub (es. `redline-rivals`) e carica **il contenuto di questa cartella**
   nella radice del repository (`index.html` deve stare in cima, non dentro una sottocartella).
   ```bash
   git init
   git add .
   git commit -m "Primo commit"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/redline-rivals.git
   git push -u origin main
   ```
2. Su GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**,
   branch **`main`**, cartella **`/ (root)`** → **Save**.
3. Dopo circa un minuto il gioco è online su `https://TUO-UTENTE.github.io/redline-rivals/`.

Tutti i percorsi sono relativi, quindi funziona anche in una sottocartella come quella di GitHub Pages.
Il file `.nojekyll` evita che GitHub rielabori i file. Serve HTTPS (GitHub Pages lo fornisce): è
indispensabile per service worker e installazione.

### Installare come app
- **Android / Chrome / Edge (PC)**: voce **INSTALLA APP** nel menu del gioco (o l'icona di installazione nella barra degli indirizzi).
- **iPhone / iPad (Safari)**: Condividi → **Aggiungi a Home**.
- Dopo la prima apertura il gioco funziona anche senza connessione.

## Provarlo in locale

Serve un server statico (i moduli ES non funzionano aprendo `index.html` con doppio clic):

```bash
python3 -m http.server 8080      # oppure: npm start
# poi apri http://localhost:8080
```

Aggiungendo `?nosw` all'indirizzo il service worker viene ignorato (utile mentre sviluppi);
`?quality=low|medium|high` forza la qualità grafica.

## Comandi

| Azione | Tastiera | Gamepad | Touch |
|---|---|---|---|
| Accelera | `W` / `↑` | RT | GAS |
| Frena / retromarcia | `S` / `↓` | LT | FRENO |
| Sterza | `A` `D` / `←` `→` | stick sinistro | frecce a sinistra |
| Freno a mano (drift) | `Spazio` | B / X | DRIFT |
| Nitro | `Shift` / `N` | A | NITRO |
| Cambia visuale | `C` | Y | – |
| Rimetti in pista | `R` | LB | – |
| Pausa | `Esc` / `P` | Start | ❚❚ |
| Audio on/off | `M` | – | – |

Dalle **Opzioni** si regolano grafica (auto/bassa/media/alta), difficoltà, giri, volumi,
accelerazione automatica, **sensibilità dello sterzo** (morbida/normale/pronta), assistenza allo sterzo, unità di misura e controlli touch.
Su telefono tieni il dispositivo in orizzontale.

## Struttura del progetto

```
index.html, css/        interfaccia (menu, garage, HUD, comandi touch)
manifest.webmanifest    manifest PWA (fullscreen, landscape, icone)
sw.js                   service worker: precache + cache-first (offline)
js/config.js            auto, rivali, preset grafici, impostazioni predefinite
js/track-data.js        definizione dei circuiti + generazione della pista
js/car-physics.js       fisica arcade dell'auto
js/ai.js, js/race.js    avversari e logica di gara (indipendenti dal DOM)
js/game.js, js/ui.js    stati di gioco (menu → garage → gara → risultati) e interfaccia
js/input.js, js/audio.js, js/storage.js   comandi, audio sintetizzato, record salvati
js/engine-synth.js      sintesi del motore (V8 scoppio per scoppio, loop mescolati in tempo reale)
js/gfx/                 rendering: città, pista, auto procedurale, effetti, camera
vendor/three/           Three.js r186 (MIT), incluso per funzionare offline
icons/, fonts/, tools/  icone PWA, font, script di utilità
tests/                  test Node di fisica, gara e sintesi del motore
```

## Dopo ogni modifica

```bash
node tools/build-sw.mjs    # aggiorna l'elenco dei file in cache e la versione in sw.js
```

Senza questo passaggio chi ha già installato il gioco continuerebbe a vedere la versione vecchia
(il service worker serve i file dalla cache finché `VERSION` non cambia). `npm test` esegue i test
di fisica, gara e suono del motore.

## Aggiungere contenuti

- **Nuova mappa**: in `js/track-data.js` aggiungi una voce a `TRACKS` con i punti del tracciato
  (chiuso, in metri) e larghezza; `buildTrack()` genera tutto il resto. Poi aggiungi la selezione
  in `js/game.js` / `js/ui.js` (oggi c'è un solo circuito, `downtown`).
- **Nuova auto**: aggiungi una voce a `CARS` in `js/config.js` (statistiche, colori, parametri fisici);
  nel garage i pulsanti freccia ‹ › ci sono già (disattivati finché esiste una sola auto): vanno collegati
  alle azioni `prev-car` / `next-car` in `js/game.js`; la carrozzeria è costruita in `js/gfx/car-model.js`.
- **Icone**: `ORBITRON_TTF=tools/Orbitron-Black.ttf python3 tools/make-icons.py` (richiede Pillow).

## Crediti e licenze

- [Three.js](https://threejs.org/) r186 — MIT (`vendor/three/LICENSE`)
- Font Orbitron e Rajdhani — SIL Open Font License (`fonts/LICENSE-*.txt`)
- Codice del gioco — MIT (`LICENSE`)
- *Need for Speed* e *Most Wanted* sono marchi di Electronic Arts; questo progetto non è affiliato a EA
  e non usa materiale di EA.
