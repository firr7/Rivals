// Mesh della pista: asfalto, cordoli, marciapiedi, muri, linea del traguardo e terreno.

import * as THREE from '../three.js';
import { stripGeometry, mergeGeometries } from './geo.js';
import * as TX from './textures.js';

export function buildTrackMeshes(track, { envMap = null, aniso = 8 } = {}) {
  const group = new THREE.Group();
  group.name = 'track';
  const n = track.count, L = track.length;
  const hw = track.halfWidth, wo = track.wallOffset;
  const step = track.step;

  const P = (i, off, y) => {
    const k = ((i % n) + n) % n;
    return [track.px[k] + track.nx[k] * off, y, track.pz[k] + track.nz[k] * off];
  };
  const N = (i, sgn = 1) => {
    const k = ((i % n) + n) % n;
    return [track.nx[k] * sgn, 0, track.nz[k] * sgn];
  };

  // ---------------- terreno ----------------
  {
    const t = TX.groundTexture(aniso);
    t.repeat.set(120, 120);
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: t, color: 0xffffff })
    );
    g.position.set((track.bounds.minX + track.bounds.maxX) / 2, -0.03, (track.bounds.minZ + track.bounds.maxZ) / 2);
    g.name = 'ground';
    group.add(g);
  }

  // ---------------- asfalto ----------------
  {
    const roadTile = L / Math.max(1, Math.round(L / 12));
    const A = [], B = [], uA = [], uB = [];
    for (let i = 0; i <= n; i++) {
      A.push(P(i, -hw, 0.03)); B.push(P(i, hw, 0.03));
      const v = (i * step) / roadTile;
      uA.push([0, v]); uB.push([1, v]);
    }
    const geo = stripGeometry(A, B, uA, uB, [0, 1, 0]);
    const tex = TX.roadTexture(aniso);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.62, metalness: 0.0,
      envMap, envMapIntensity: 1.1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'road';
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------------- marciapiedi ----------------
  {
    const parts = [];
    const tex = TX.sidewalkTexture(aniso);
    for (const sgn of [1, -1]) {
      const A = [], B = [], uA = [], uB = [];
      for (let i = 0; i <= n; i++) {
        A.push(P(i, sgn * hw, 0.012)); B.push(P(i, sgn * (wo + 0.6), 0.012));
        const v = (i * step) / 2;
        uA.push([0, v]); uB.push([((wo + 0.6) - hw) / 2, v]);
      }
      parts.push(stripGeometry(A, B, uA, uB, [0, 1, 0]));
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ map: tex }));
    m.name = 'sidewalk';
    group.add(m);
  }

  // ---------------- cordoli (solo in curva) ----------------
  {
    const parts = [];
    const tex = TX.kerbTexture(aniso);
    const thr = 0.0055;
    for (const sgn of [1, -1]) {
      let run = null;
      const flush = () => {
        if (run && run.A.length > 1) parts.push(stripGeometry(run.A, run.B, run.uA, run.uB, [0, 1, 0]));
        run = null;
      };
      for (let i = 0; i <= n; i++) {
        const on = Math.abs(track.curvS[i % n]) > thr;
        if (!on) { flush(); continue; }
        if (!run) run = { A: [], B: [], uA: [], uB: [] };
        run.A.push(P(i, sgn * hw, 0.05)); run.B.push(P(i, sgn * (hw + 0.95), 0.05));
        const v = (i * step) / 4;
        run.uA.push([0, v]); run.uB.push([1, v]);
      }
      flush();
    }
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({
        map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.name = 'kerbs';
      group.add(m);
    }
  }

  // ---------------- muri ----------------
  {
    const wallH = 1.05;
    const wtile = L / Math.max(1, Math.round(L / 4.2));
    const parts = [], caps = [];
    for (const sgn of [1, -1]) {
      const A = [], B = [], uA = [], uB = [], nr = [];
      const cA = [], cB = [], cuA = [], cuB = [];
      for (let i = 0; i <= n; i++) {
        A.push(P(i, sgn * wo, 0)); B.push(P(i, sgn * wo, wallH));
        const u = (i * step) / wtile;
        uA.push([u, 0]); uB.push([u, 1]);
        nr.push(N(i, -sgn));
        cA.push(P(i, sgn * wo, wallH)); cB.push(P(i, sgn * (wo + 0.55), wallH));
        cuA.push([0.0, u]); cuB.push([0.2, u]);
      }
      parts.push(stripGeometry(A, B, uA, uB, nr));
      caps.push(stripGeometry(cA, cB, cuA, cuB, [0, 1, 0]));
    }
    const wallMat = new THREE.MeshLambertMaterial({ map: TX.wallTexture(aniso) });
    const wall = new THREE.Mesh(mergeGeometries(parts), wallMat);
    wall.name = 'walls';
    wall.castShadow = false;
    group.add(wall);
    const capTex = TX.sidewalkTexture(aniso);
    const cap = new THREE.Mesh(mergeGeometries(caps), new THREE.MeshLambertMaterial({ color: 0x9a9690, map: capTex }));
    group.add(cap);
  }

  // ---------------- linea del traguardo ----------------
  {
    const A = [], B = [], uA = [], uB = [];
    for (let i = 0; i <= 1; i++) {
      A.push(P(i, -hw, 0.055)); B.push(P(i, hw, 0.055));
      uA.push([0, i * 0.75]); uB.push([5, i * 0.75]);
    }
    const geo = stripGeometry(A, B, uA, uB, [0, 1, 0]);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: TX.checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    m.name = 'start-line';
    group.add(m);
  }

  return group;
}
