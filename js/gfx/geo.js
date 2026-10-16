// Utility per costruire geometrie a mano (strisce lungo la pista, merge di mesh semplici).

import * as THREE from '../three.js';

/**
 * Striscia di quad tra due polilinee A e B (stesso numero di punti).
 * pts: array di [x,y,z]; uv: array di [u,v]; nrm: [nx,ny,nz] costante oppure array per-punto.
 * Il verso dei triangoli viene scelto in modo che la normale geometrica concordi con `nrm`.
 */
export function stripGeometry(ptsA, ptsB, uvA, uvB, nrm) {
  const n = ptsA.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const nor = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const a = ptsA[i], b = ptsB[i];
    pos.set(a, i * 6); pos.set(b, i * 6 + 3);
    uv.set(uvA[i], i * 4); uv.set(uvB[i], i * 4 + 2);
    const nn = Array.isArray(nrm[0]) ? nrm[i] : nrm;
    nor.set(nn, i * 6); nor.set(nn, i * 6 + 3);
  }
  // verso
  let flip = false;
  if (n >= 2) {
    const A = new THREE.Vector3(...ptsA[0]), B = new THREE.Vector3(...ptsB[0]), C = new THREE.Vector3(...ptsA[1]);
    const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    const want = Array.isArray(nrm[0]) ? nrm[0] : nrm;
    flip = fn.dot(new THREE.Vector3(...want)) < 0;
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    if (!flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Unisce geometrie indicizzate con gli stessi attributi (position, normal, uv, [color]). */
export function mergeGeometries(list) {
  if (!list.length) return new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  const arrays = {}; names.forEach((n) => { arrays[n] = []; });
  const index = [];
  let offset = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    for (const n of names) arrays[n].push(g.attributes[n].array);
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) index.push(ia[i] + offset); }
    else { for (let i = 0; i < count; i++) index.push(i + offset); }
    offset += count;
  }
  for (const n of names) {
    const itemSize = list[0].attributes[n].itemSize;
    let total = 0; arrays[n].forEach((a) => { total += a.length; });
    const merged = new Float32Array(total);
    let o = 0; arrays[n].forEach((a) => { merged.set(a, o); o += a.length; });
    out.setAttribute(n, new THREE.BufferAttribute(merged, itemSize));
  }
  out.setIndex(index);
  return out;
}

/** Applica una matrice e ritorna la stessa geometria (comodo per comporre pali, bracci...). */
export function xform(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Colora tutti i vertici con un colore (attributo `color`). */
export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
