// Modello 3D procedurale della coupé sportiva (nessun asset esterno).
// Assi del modello: +z = avanti, +x = sinistra, +y = alto. Origine a terra, al centro dell'auto.

import * as THREE from '../three.js';
import { mergeGeometries, xform } from './geo.js';
import * as TX from './textures.js';

// z, yb (fondo), ys (spalla), yt (tetto/cofano), hwU (semilarghezza alta), hwL (semilarghezza bassa), hr (semilarghezza tetto), sg (vetri laterali), tg (parabrezza/lunotto)
const S = (z, yb, ys, yt, hwU, hwL, hr, sg = 0, tg = 0) => ({ z, yb, ys, yt, hwU, hwL, hr, sg, tg });
const STATIONS = [
  S(2.27, 0.34, 0.50, 0.54, 0.62, 0.55, 0.52),
  S(2.20, 0.26, 0.54, 0.66, 0.80, 0.72, 0.70),
  S(2.02, 0.22, 0.60, 0.76, 0.90, 0.84, 0.78),
  S(1.77, 0.21, 0.66, 0.82, 0.94, 0.90, 0.78),
  S(1.55, 0.21, 0.70, 0.86, 0.95, 0.80, 0.76),
  S(1.32, 0.21, 0.72, 0.88, 0.96, 0.68, 0.75),
  S(1.09, 0.21, 0.73, 0.90, 0.96, 0.80, 0.74),
  S(0.87, 0.21, 0.73, 0.93, 0.95, 0.90, 0.72),
  S(0.60, 0.21, 0.74, 0.97, 0.95, 0.92, 0.70, 0, 1),
  S(0.30, 0.21, 0.75, 1.15, 0.95, 0.92, 0.64, 1, 1),
  S(0.00, 0.21, 0.76, 1.30, 0.95, 0.92, 0.58, 1, 0),
  S(-0.45, 0.21, 0.77, 1.34, 0.95, 0.92, 0.56, 1, 0),
  S(-0.87, 0.21, 0.78, 1.32, 0.95, 0.90, 0.57, 1, 1),
  S(-1.09, 0.21, 0.79, 1.25, 0.95, 0.80, 0.59, 0, 1),
  S(-1.32, 0.21, 0.80, 1.15, 0.95, 0.68, 0.64, 0, 1),
  S(-1.55, 0.21, 0.81, 1.02, 0.95, 0.80, 0.72),
  S(-1.77, 0.22, 0.82, 0.98, 0.95, 0.90, 0.76),
  S(-2.02, 0.24, 0.80, 0.96, 0.92, 0.86, 0.76),
  S(-2.20, 0.28, 0.74, 0.90, 0.84, 0.76, 0.68),
  S(-2.27, 0.34, 0.62, 0.74, 0.66, 0.58, 0.54),
];

function loftBody() {
  const RING = 12;
  const verts = [];
  for (const s of STATIONS) {
    const half = [
      [0, s.yb],
      [s.hwL * 0.88, s.yb],
      [s.hwL, s.yb + (s.ys - s.yb) * 0.4],
      [s.hwU, s.ys],
      [s.hr + (s.hwU - s.hr) * 0.10, s.yt - (s.yt - s.ys) * 0.07],
      [s.hr * 0.55, s.yt],
      [0, s.yt],
    ];
    const ring = [];
    for (let k = 0; k < 7; k++) ring.push([half[k][0], half[k][1]]);
    for (let k = 5; k >= 1; k--) ring.push([-half[k][0], half[k][1]]);
    verts.push(ring);
  }
  const pos = [];
  const index = { paint: [], glass: [], dark: [] };
  const vid = (i, j) => i * RING + (j % RING);
  for (let i = 0; i < STATIONS.length; i++) for (let j = 0; j < RING; j++) pos.push(verts[i][j][0], verts[i][j][1], STATIONS[i].z);
  // centri per i tappi
  const cFront = pos.length / 3; pos.push(0, (STATIONS[0].yb + STATIONS[0].yt) / 2, STATIONS[0].z);
  const last = STATIONS.length - 1;
  const cRear = pos.length / 3; pos.push(0, (STATIONS[last].yb + STATIONS[last].yt) / 2, STATIONS[last].z);

  const P = (id) => [pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]];
  const pushTri = (arr, a, b, c, axis) => {
    // orienta in modo che la normale punti lontano dall'asse (axis = [0, y, z])
    const A = P(a), B = P(b), C = P(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    const out = [cen[0] - axis[0], cen[1] - axis[1], cen[2] - axis[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) arr.push(a, b, c); else arr.push(a, c, b);
  };

  for (let i = 0; i < STATIONS.length - 1; i++) {
    const s = STATIONS[i], t = STATIONS[i + 1];
    const axis = [0, (s.yb + s.yt) / 2, (s.z + t.z) / 2];
    for (let j = 0; j < RING; j++) {
      let group = 'paint';
      if (j === 0 || j === 11) group = 'dark';
      else if ((j === 5 || j === 6) && s.tg) group = 'glass';
      else if ((j === 3 || j === 8) && s.sg) group = 'glass';
      const a = vid(i, j), b = vid(i, j + 1), c = vid(i + 1, j), d = vid(i + 1, j + 1);
      pushTri(index[group], a, b, c, axis);
      pushTri(index[group], b, d, c, axis);
    }
  }
  // tappi (anteriore e posteriore)
  for (let j = 0; j < RING; j++) {
    // l'asse di riferimento sta "dentro" l'auto: la normale deve puntare fuori (muso verso +z, coda verso -z)
    pushTri(index.paint, cFront, vid(0, j), vid(0, j + 1), [0, pos[cFront * 3 + 1], pos[cFront * 3 + 2] - 1]);
    pushTri(index.paint, cRear, vid(last, j), vid(last, j + 1), [0, pos[cRear * 3 + 1], pos[cRear * 3 + 2] + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const all = [...index.paint, ...index.glass, ...index.dark];
  g.setIndex(all);
  g.addGroup(0, index.paint.length, 0);
  g.addGroup(index.paint.length, index.glass.length, 1);
  g.addGroup(index.paint.length + index.glass.length, index.dark.length, 2);
  g.computeVertexNormals();
  return g;
}

let rimTex = null;
function rimTexture() {
  if (rimTex) return rimTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(64, 64, 64, 0, 7); g.fill();
  const rg = g.createRadialGradient(54, 50, 6, 64, 64, 62);
  rg.addColorStop(0, '#f1f3f6'); rg.addColorStop(0.6, '#a9aeb7'); rg.addColorStop(1, '#5a5e66');
  g.fillStyle = rg;
  g.beginPath(); g.arc(64, 64, 60, 0, 7); g.arc(64, 64, 46, 0, 7, true); g.fill('evenodd');
  // 5 razze
  for (let i = 0; i < 5; i++) {
    g.save(); g.translate(64, 64); g.rotate((i * Math.PI * 2) / 5);
    g.fillStyle = rg;
    g.beginPath(); g.moveTo(-6, -8); g.lineTo(-9, -50); g.lineTo(9, -50); g.lineTo(6, -8); g.closePath(); g.fill();
    g.restore();
  }
  g.fillStyle = '#d7dae0'; g.beginPath(); g.arc(64, 64, 13, 0, 7); g.fill();
  g.fillStyle = '#1b1c20'; g.beginPath(); g.arc(64, 64, 5, 0, 7); g.fill();
  rimTex = new THREE.CanvasTexture(c);
  rimTex.colorSpace = THREE.SRGBColorSpace;
  rimTex.anisotropy = 4;
  return rimTex;
}

/**
 * Costruisce il modello. Ritorna { root, body, wheels[], mats, flames[], pops[], tail, head, dims }.
 */
export function buildCarModel({ color = '#1f4fd8', envMap = null, fancy = true } = {}) {
  const root = new THREE.Group();
  root.name = 'car';
  const body = new THREE.Group(); // riceve rollio/beccheggio
  root.add(body);

  const paint = fancy
    ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap, envMapIntensity: 0.72 })
    : new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4, envMap, envMapIntensity: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3b4d, metalness: 0.75, roughness: 0.06, envMap, envMapIntensity: 2.4, emissive: 0x0a1018, emissiveIntensity: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.2, roughness: 0.8 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x131318, metalness: 0.6, roughness: 0.35, envMap, envMapIntensity: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 1.0, roughness: 0.15, envMap, envMapIntensity: 1.3 });

  const bodyMesh = new THREE.Mesh(loftBody(), [paint, glass, dark]);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);

  // ---- dettagli anteriori
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.0) });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.085, 0.14), headMat);
    hl.position.set(sx * 0.66, 0.66, 2.13);
    hl.rotation.y = sx * 0.28; hl.rotation.x = 0.18;
    body.add(hl);
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10).rotateX(Math.PI / 2), headMat);
    fog.position.set(sx * 0.72, 0.38, 2.2);
    body.add(fog);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.15, 0.12), dark);
  grille.position.set(0, 0.5, 2.22);
  body.add(grille);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.035, 0.34), carbon);
  splitter.position.set(0, 0.2, 2.15);
  body.add(splitter);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.62), paint);    // rialzo del cofano
  hood.position.set(0, 0.935, 1.2);
  hood.rotation.x = -0.1;
  body.add(hood);
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.07), dark);      // feritoia della presa d'aria
  scoop.position.set(0, 0.958, 1.5);
  scoop.rotation.x = -0.1;
  body.add(scoop);

  // ---- posteriore
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.03, 0.03) });
  // fanali sulla faccia posteriore (il tappo della carrozzeria è piano a z = -2.27)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.05, 0.04), tailMat);
  tail.position.set(0, 0.64, -2.285);
  body.add(tail);
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), tailMat);
    tl.position.set(sx * 0.46, 0.55, -2.285);
    body.add(tl);
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.2, 14).rotateX(Math.PI / 2), chrome);
    ex.position.set(sx * 0.48, 0.3, -2.3);
    body.add(ex);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.3), carbon);
  diffuser.position.set(0, 0.28, -2.18);
  body.add(diffuser);
  // alettone
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 0.4), carbon);
  wing.position.set(0, 1.16, -2.05);
  wing.rotation.x = 0.07;
  body.add(wing);
  for (const sx of [-1, 1]) {
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.14), carbon);
    pyl.position.set(sx * 0.55, 1.02, -2.02);
    body.add(pyl);
    const endp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.44), paint);
    endp.position.set(sx * 0.88, 1.17, -2.05);
    body.add(endp);
  }
  // specchietti
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.1), paint);
    m.position.set(sx * 0.97, 0.9, 0.58);
    body.add(m);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.04), carbon);
    st.position.set(sx * 0.9, 0.87, 0.58);
    body.add(st);
  }
  // minigonne laterali
  for (const sx of [-1, 1]) {
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 1.25), paint);
    sk.position.set(sx * 0.9, 0.3, 0);
    body.add(sk);
  }

  // ---- ruote
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 28).rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.92, metalness: 0 });
  const rimGeo = new THREE.CircleGeometry(0.255, 28);
  const rimMat = new THREE.MeshStandardMaterial({ map: rimTexture(), metalness: 0.85, roughness: 0.28, envMap, envMapIntensity: 1.1, side: THREE.DoubleSide });
  const discGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.04, 20).rotateZ(Math.PI / 2);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x772218, metalness: 0.5, roughness: 0.5 });
  const archGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
  const archMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1, side: THREE.DoubleSide });

  const wheels = [];
  const WZ = 1.32, WX = 0.84, WR = 0.34;
  for (const fz of [1, -1]) {
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * WX, WR, fz * WZ);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = true;
      const disc = new THREE.Mesh(discGeo, discMat);
      spin.add(tire, disc);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      rim.position.x = sx * 0.131;
      spin.add(rim);
      body.add(pivot);
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(sx * (WX - 0.07), WR, fz * WZ);
      body.add(arch);
      wheels.push({ pivot, spin, front: fz > 0, side: sx });
    }
  }

  // ---- fiamme nitro (blu) e backfire (arancio)
  const flameTex = TX.flameTexture();
  const flameGeo = new THREE.ConeGeometry(0.12, 1.0, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const flames = [], pops = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
      map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.8, 2.4),
    }));
    f.position.set(sx * 0.48, 0.3, -2.4);
    f.visible = false;
    body.add(f); flames.push(f);
    const p = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
      map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(3.0, 1.3, 0.35),
    }));
    p.position.set(sx * 0.48, 0.3, -2.4);
    p.visible = false;
    body.add(p); pops.push(p);
  }

  return {
    root, body, wheels, flames, pops,
    mats: { paint, glass, tail: tailMat, head: headMat },
    dims: { wheelRadius: WR, wheelZ: WZ, wheelX: WX, length: 4.54, width: 1.92 },
  };
}
