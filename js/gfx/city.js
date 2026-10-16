// Città attorno alla pista: palazzi (una sola mesh), lampioni, cartelli a chevron, cartelloni, arco del traguardo.

import * as THREE from '../three.js';
import { mulberry32 } from '../ai.js';
import { mergeGeometries, xform } from './geo.js';
import * as TX from './textures.js';
import { ATLAS } from './textures.js';

const BUILDING_TINTS = ['#d9d2c6', '#bdb7ad', '#a3abb6', '#dcc3a4', '#939aa8', '#c9ab90', '#848f9e', '#e4ded4'];

function nearestSample(track, x, z) {
  let best = Infinity, bi = 0;
  const n = track.count;
  for (let i = 0; i < n; i++) {
    const dx = x - track.px[i], dz = z - track.pz[i];
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  return { dist: Math.sqrt(best), index: bi };
}

// ---------------------------------------------------------------------------
// Palazzi
// ---------------------------------------------------------------------------

function pushQuad(out, p, uv, normal) {
  // verifica l'orientamento: la normale geometrica deve concordare con `normal`
  const a = new THREE.Vector3(...p[0]), b = new THREE.Vector3(...p[1]), c = new THREE.Vector3(...p[2]);
  const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const flip = fn.dot(new THREE.Vector3(...normal)) < 0;
  const base = out.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    out.pos.push(...p[i]); out.nor.push(...normal); out.uv.push(...uv[i]);
    out.col.push(...out.curColor);
  }
  if (!flip) out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function addBuilding(out, b, rnd) {
  const { x, z, w, d, h, rot, tile } = b;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const W = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const Nrm = (nx, nz) => [nx * cos + nz * sin, 0, -nx * sin + nz * cos];
  const col = new THREE.Color(BUILDING_TINTS[Math.floor(rnd() * BUILDING_TINTS.length)]);
  const shade = 0.78 + rnd() * 0.3;
  out.curColor = [col.r * shade, col.g * shade, col.b * shade];

  const faces = [
    { n: [0, 1], w: w, c: [0, d / 2] },
    { n: [0, -1], w: w, c: [0, -d / 2] },
    { n: [1, 0], w: d, c: [w / 2, 0] },
    { n: [-1, 0], w: d, c: [-w / 2, 0] },
  ];
  const rows = Math.max(3, Math.round(h / 3.4));
  for (const f of faces) {
    const nCols = Math.min(ATLAS.cols, Math.max(2, Math.round(f.w / 3.2)));
    const c0 = Math.floor(rnd() * (ATLAS.cols - nCols + 1));
    const u0 = (tile * ATLAS.cols + c0) / (ATLAS.tiles * ATLAS.cols);
    const u1 = (tile * ATLAS.cols + c0 + nCols) / (ATLAS.tiles * ATLAS.cols);
    const v0 = Math.floor(rnd() * ATLAS.rows) / ATLAS.rows;
    const v1 = v0 + rows / ATLAS.rows;
    // destra vista dall'esterno: (nz, -nx)
    const rx = f.n[1], rz = -f.n[0];
    const hw = f.w / 2;
    const cx = f.c[0], cz = f.c[1];
    const bl = W(cx - rx * hw, cz - rz * hw), br = W(cx + rx * hw, cz + rz * hw);
    const nn = Nrm(f.n[0], f.n[1]);
    pushQuad(out,
      [[bl[0], 0, bl[1]], [br[0], 0, br[1]], [br[0], h, br[1]], [bl[0], h, bl[1]]],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], nn);
  }
  // tetto
  const c1 = W(-w / 2, -d / 2), c2 = W(w / 2, -d / 2), c3 = W(w / 2, d / 2), c4 = W(-w / 2, d / 2);
  const ru = 0.9972, rv = 0.0058;
  out.curColor = [0.55, 0.55, 0.58];
  pushQuad(out,
    [[c1[0], h, c1[1]], [c2[0], h, c2[1]], [c3[0], h, c3[1]], [c4[0], h, c4[1]]],
    [[ru, rv], [ru, rv], [ru, rv], [ru, rv]], [0, 1, 0]);
}

function generateBuildings(track, count, rnd, placed) {
  const list = [];
  const wo = track.wallOffset;
  const b = track.bounds;
  const M = 330;
  const target = count;
  let attempts = 0;
  while (list.length < target && attempts < target * 90) {
    attempts++;
    const x = b.minX - M + rnd() * (b.maxX - b.minX + 2 * M);
    const z = b.minZ - M + rnd() * (b.maxZ - b.minZ + 2 * M);
    const w = 12 + rnd() * 15, d = 12 + rnd() * 15;
    const rad = Math.hypot(w, d) / 2;
    const { dist, index } = nearestSample(track, x, z);
    const minDist = wo + 7 + rad;
    if (dist < minDist) continue;
    if (rnd() > Math.exp(-(dist - minDist) / 150)) continue;
    let ok = true;
    for (const p of placed) {
      const dx = p.x - x, dz = p.z - z;
      const rr = p.r + rad + 3;
      if (dx * dx + dz * dz < rr * rr) { ok = false; break; }
    }
    if (!ok) continue;
    const rot = track.heading[index] + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.04;
    // più alti allontanandosi dalla pista
    const near = Math.min(1, (dist - minDist) / 120);
    const h = Math.min(108, 11 + Math.pow(rnd(), 1.7) * (26 + near * 85));
    const tile = Math.floor(rnd() * ATLAS.tiles);
    placed.push({ x, z, r: rad });
    list.push({ x, z, w, d, h, rot, tile });
  }
  return list;
}

function generateSkyline(track, rnd, num = 150) {
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const list = [];
  for (let i = 0; i < num; i++) {
    const ang = rnd() * Math.PI * 2;
    const R = 650 + rnd() * 600;
    const x = cx + Math.cos(ang) * R * 1.2, z = cz + Math.sin(ang) * R;
    const w = 20 + rnd() * 18, d = 20 + rnd() * 18;
    const { dist } = nearestSample(track, x, z);
    if (dist < 260) continue;
    const h = 60 + Math.pow(rnd(), 1.5) * 200;
    list.push({ x, z, w, d, h, rot: rnd() * Math.PI, tile: Math.floor(rnd() * ATLAS.tiles) });
  }
  return list;
}

// ---------------------------------------------------------------------------

export function buildCity(track, quality, { aniso = 8 } = {}) {
  const group = new THREE.Group();
  group.name = 'city';
  const rnd = mulberry32(777);
  const n = track.count, L = track.length;
  const hw = track.halfWidth, wo = track.wallOffset;
  const placed = [];

  // ---------- cartelloni (prima dei palazzi per riservare lo spazio)
  const billboardDefs = [
    ['REDLINE', 'ENERGY DRINK', 14], ['TURBO CITY', 'AUTO PARTS', 200], ['NITRO X', 'RACING FUEL', 190],
    ['NEON 88', 'ARCADE', 300], ['APEX', 'TYRES', 50], ['BLACKLIST', 'WANTED', 355],
    ['STREET KINGS', 'LIVE TONIGHT', 28], ['OCTANE FM', '104.7', 160],
  ];
  {
    const fr = [0.07, 0.19, 0.31, 0.44, 0.56, 0.68, 0.81, 0.93];
    fr.forEach((f, k) => {
      const i = Math.floor(f * n);
      if (Math.abs(track.curvS[i]) > 0.006) return;
      const side = k % 2 ? 1 : -1;
      const off = wo + 17;
      const x = track.px[i] + track.nx[i] * off * side;
      const z = track.pz[i] + track.nz[i] * off * side;
      const inx = -track.nx[i] * side, inz = -track.nz[i] * side;
      let nx = -track.tx[i] * 0.78 + inx * 0.62, nz = -track.tz[i] * 0.78 + inz * 0.62;
      const l = Math.hypot(nx, nz); nx /= l; nz /= l;
      const [title, sub, hue] = billboardDefs[k % billboardDefs.length];
      const tex = TX.billboardTexture(title, sub, hue);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshBasicMaterial({ map: tex, toneMapped: true }));
      board.position.set(x, 14.5, z);
      board.rotation.y = Math.atan2(nx, nz);
      group.add(board);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(24.6, 12.6), new THREE.MeshLambertMaterial({ color: 0x1b1a20 }));
      back.position.set(x - nx * 0.15, 14.5, z - nz * 0.15);
      back.rotation.y = board.rotation.y;
      group.add(back);
      const poleGeo = new THREE.CylinderGeometry(0.35, 0.45, 9, 8);
      for (const s of [-7, 7]) {
        const p = new THREE.Mesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
        p.position.set(x + nz * s, 4.5, z - nx * s);
        group.add(p);
      }
      placed.push({ x, z, r: 15 });
    });
  }

  // ---------- palazzi
  {
    const list = generateBuildings(track, quality.buildings, rnd, placed);
    const sky = generateSkyline(track, rnd, Math.round(quality.buildings * 0.55));
    const out = { pos: [], nor: [], uv: [], col: [], idx: [], curColor: [1, 1, 1] };
    for (const b of list) addBuilding(out, b, rnd);
    for (const b of sky) addBuilding(out, b, rnd);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    g.setIndex(out.idx);
    const atlas = TX.windowAtlas(aniso);
    atlas.map.wrapS = THREE.ClampToEdgeWrapping;       // le colonne restano nel proprio stile
    atlas.emissive.wrapS = THREE.ClampToEdgeWrapping;
    atlas.map.wrapT = THREE.RepeatWrapping;          // i palazzi alti ripetono i piani in verticale
    atlas.emissive.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshLambertMaterial({
      map: atlas.map, vertexColors: true,
      emissive: 0xffffff, emissiveMap: atlas.emissive, emissiveIntensity: 1.35,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'buildings';
    mesh.frustumCulled = false;
    group.add(mesh);

    // luci rosse di segnalazione sui grattacieli
    const tops = [];
    for (const b of [...list, ...sky]) if (b.h > 64) tops.push(b.x, b.h + 1.5, b.z);
    if (tops.length) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(tops, 3));
      const pm = new THREE.PointsMaterial({
        map: TX.glowTexture('rgba(255,60,40,1)', 'rgba(255,40,30,0.5)', 64), size: 14, sizeAttenuation: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff3a22,
      });
      const pts = new THREE.Points(pg, pm);
      pts.frustumCulled = false;
      group.add(pts);
    }
  }

  // ---------- lampioni
  {
    const total = quality.lamps;
    const spacing = Math.max(1, Math.round(n / (total / 2)));
    const poleGeo = mergeGeometries([
      xform(new THREE.CylinderGeometry(0.1, 0.16, 9.2, 8), { y: 4.6 }),
      xform(new THREE.BoxGeometry(3.6, 0.13, 0.13), { x: 1.7, y: 9.15 }),
    ]);
    const headGeo = xform(new THREE.BoxGeometry(1.0, 0.1, 0.38), { x: 3.3, y: 9.05 });
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3a3b42 }), total + 4);
    const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), total + 4);
    const poolGeo = new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2);
    const poolMesh = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
      map: TX.glowTexture('rgba(255,190,110,0.85)', 'rgba(255,150,70,0.30)'), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
    }), total + 4);
    const glowPos = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let k = 0, side = 1;
    for (let i = 0; i < n && k < total; i += spacing) {
      const ix = -track.nx[i] * side, iz = -track.nz[i] * side;
      const bx = track.px[i] + track.nx[i] * side * (wo + 1.5);
      const bz = track.pz[i] + track.nz[i] * side * (wo + 1.5);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-iz, ix));
      m.compose(p.set(bx, 0, bz), q, s);
      poleMesh.setMatrixAt(k, m); headMesh.setMatrixAt(k, m);
      const hx = bx + ix * 3.3, hz = bz + iz * 3.3;
      glowPos.push(hx, 8.95, hz);
      m.compose(p.set(hx, 0.07, hz), new THREE.Quaternion(), s);
      poolMesh.setMatrixAt(k, m);
      side = -side; k++;
    }
    poleMesh.count = headMesh.count = poolMesh.count = k;
    poleMesh.frustumCulled = headMesh.frustumCulled = poolMesh.frustumCulled = false;
    group.add(poleMesh, headMesh, poolMesh);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({
      map: TX.glowTexture('rgba(255,235,200,1)', 'rgba(255,170,80,0.5)'), size: 9, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb468,
    }));
    pts.frustumCulled = false;
    group.add(pts);
  }

  // ---------- chevron sulle curve strette
  {
    const lists = { left: [], right: [] };
    for (let i = 0; i < n; i += 5) {
      const k = track.curvS[i];
      if (Math.abs(k) < 0.0105) continue;
      const side = k > 0 ? 1 : -1; // lato esterno della curva
      lists[k > 0 ? 'left' : 'right'].push({ i, side });
    }
    for (const key of ['left', 'right']) {
      const arr = lists[key];
      if (!arr.length) continue;
      const tex = TX.chevronTexture(key === 'left' ? -1 : 1);
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(2.0, 2.0),
        new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }),
        arr.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      arr.forEach((a, j) => {
        const i = a.i, side = a.side;
        const ix = -track.nx[i] * side, iz = -track.nz[i] * side;
        const x = track.px[i] + track.nx[i] * side * (wo + 0.8);
        const z = track.pz[i] + track.nz[i] * side * (wo + 0.8);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(ix, iz));
        m.compose(p.set(x, 2.1, z), q, s);
        mesh.setMatrixAt(j, m);
      });
      mesh.frustumCulled = false;
      group.add(mesh);
      // pali
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), new THREE.MeshLambertMaterial({ color: 0x2b2b30 }), arr.length);
      arr.forEach((a, j) => {
        const i = a.i, side = a.side;
        const x = track.px[i] + track.nx[i] * side * (wo + 0.85);
        const z = track.pz[i] + track.nz[i] * side * (wo + 0.85);
        m.compose(p.set(x, 1.1, z), new THREE.Quaternion(), s);
        posts.setMatrixAt(j, m);
      });
      posts.frustumCulled = false;
      group.add(posts);
    }
  }

  // ---------- arco del traguardo
  {
    const gate = new THREE.Group();
    const span = hw + 1.9;
    const dark = new THREE.MeshLambertMaterial({ color: 0x24242b });
    for (const sx of [-span, span]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.0, 8.4, 1.1), dark);
      pil.position.set(sx, 4.2, 0);
      gate.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.0, 1.1, 1.3), dark);
    beam.position.set(0, 8.4, 0);
    gate.add(beam);
    const tex = TX.bannerTexture('START / FINISH', 'REDLINE RIVALS');
    const bw = span * 2, bh = bw / 4;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex }));
    front.position.set(0, 8.4 - 0.55 - bh / 2, -0.68);
    front.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex }));
    back.position.set(0, 8.4 - 0.55 - bh / 2, 0.68);
    gate.add(front, back);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
    strip.position.set(0, 8.4 - 0.55 - bh - 0.12, -0.7);
    gate.add(strip);
    gate.position.set(track.px[0], 0, track.pz[0]);
    gate.rotation.y = track.heading[0];
    gate.name = 'gate';
    group.add(gate);
  }

  return group;
}
