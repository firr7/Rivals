// Effetti: particelle (fumo, scintille), segni delle gomme e shader finale (radial blur, color grading).

import * as THREE from '../three.js';

// ---------------------------------------------------------------------------
// Particelle
// ---------------------------------------------------------------------------

const pVert = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 160.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const pFrag = /* glsl */`
  uniform sampler2D map;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  }
`;

export class ParticleSystem {
  constructor({ max = 200, texture, additive = false, gravity = 0, drag = 0 }) {
    this.max = max;
    this.gravity = gravity; this.drag = drag;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: pVert, fragmentShader: pFrag,
      uniforms: { map: { value: texture }, uScale: { value: 500 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, a) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = size0; this.s1[i] = size1; this.a0[i] = a;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
  }

  update(dt) {
    const d = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.col[i * 4 + 3] = 0; continue; }
      this.age[i] += dt;
      const t = Math.min(this.age[i] / this.life[i], 1);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.gravity * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * (1 - t * 0.2) * Math.min(1, this.age[i] * 12);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Segni delle gomme
// ---------------------------------------------------------------------------

export class SkidMarks {
  constructor(maxSegments = 900) {
    this.max = maxSegments;
    this.count = 0; this.head = 0;
    this.pos = new Float32Array(maxSegments * 4 * 3);
    this.col = new Float32Array(maxSegments * 4 * 4);
    const idx = [];
    for (let s = 0; s < maxSegments; s++) { const b = s * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, fog: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.last = new Map();
    this.dirty = false;
  }

  /** Aggiunge un tratto per la ruota `id` alla posizione (x,z). `a` = opacità (0 = interrompe il segno). */
  add(id, x, z, a, width = 0.2) {
    const prev = this.last.get(id);
    if (a <= 0.02) { if (prev) this.last.delete(id); return; }
    if (!prev) { this.last.set(id, { x, z }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return;
    if (len > 6) { this.last.set(id, { x, z }); return; }
    const px = (-dz / len) * width * 0.5, pz = (dx / len) * width * 0.5;
    const s = this.head; this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
    const o = s * 12;
    const y = 0.058;
    this.pos.set([prev.x - px, y, prev.z - pz, prev.x + px, y, prev.z + pz, x - px, y, z - pz, x + px, y, z + pz], o);
    const c = s * 16;
    for (let k = 0; k < 4; k++) { this.col[c + k * 4] = 0.02; this.col[c + k * 4 + 1] = 0.02; this.col[c + k * 4 + 2] = 0.025; this.col[c + k * 4 + 3] = Math.min(0.7, a); }
    this.last.set(id, { x, z });
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.count * 6);
    this.dirty = false;
  }

  clear() {
    this.count = 0; this.head = 0; this.last.clear();
    this.mesh.geometry.setDrawRange(0, 0);
  }
}

// ---------------------------------------------------------------------------
// Shader finale: radial blur, aberrazione cromatica, color grading, vignetta, grana
// ---------------------------------------------------------------------------

export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAberr: { value: 0 },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.035 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.07 },
    uWarm: { value: 0.65 },
    uAspect: { value: 1.7 },
    uFlash: { value: 0 },
    uSamples: { value: 8 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uBlur, uAberr, uVignette, uGrain, uSat, uContrast, uWarm, uAspect, uFlash;
    uniform vec2 uCenter;
    uniform int uSamples;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }

    void main() {
      vec2 dir = vUv - uCenter;
      float d = length(dir * vec2(uAspect, 1.0));
      vec3 col;
      if (uBlur > 0.003) {
        float amt = uBlur * smoothstep(0.12, 0.85, d);
        vec3 acc = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 12; i++) {
          if (i >= uSamples) break;
          float t = float(i) / float(uSamples - 1);
          float w = 1.0 - t * 0.55;
          acc += texture2D(tDiffuse, uCenter + dir * (1.0 - amt * 0.17 * t)).rgb * w;
          ws += w;
        }
        col = acc / ws;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uAberr > 0.0005) {
        vec2 o = dir * uAberr * (0.3 + d);
        col.r = mix(col.r, texture2D(tDiffuse, vUv + o).r, 0.8);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - o).b, 0.8);
      }
      // linee di velocità radiali
      if (uBlur > 0.15) {
        float ang = atan(dir.y, dir.x * uAspect);
        float cell = floor(ang * 70.0 + floor(uTime * 22.0) * 7.31);
        float sp = step(0.9, hash(vec2(cell, 3.7))) * smoothstep(0.30, 0.8, d);
        col += vec3(1.0, 0.92, 0.8) * sp * (uBlur - 0.15) * 0.35;
      }
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      vec3 shadowTint = vec3(0.90, 0.97, 1.08);
      vec3 highTint = vec3(1.10, 1.01, 0.86);
      col *= mix(vec3(1.0), mix(shadowTint, highTint, smoothstep(0.08, 0.75, luma)), uWarm);
      float v = length((vUv - 0.5) * vec2(uAspect * 0.62, 1.0));
      col *= 1.0 - uVignette * smoothstep(0.30, 0.95, v);
      col += (hash(vUv * vec2(1280.0, 720.0) + fract(uTime) * 91.7) - 0.5) * uGrain;
      col = mix(col, vec3(1.0), uFlash);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
