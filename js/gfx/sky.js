// Cielo procedurale al tramonto (cupola con shader) + mappa d'ambiente per i riflessi delle auto.

import * as THREE from '../three.js';

export const SUN_DIR = new THREE.Vector3(0.80, 0.085, -0.60).normalize();

const vert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const frag = /* glsl */`
  uniform vec3 sunDir;
  uniform float time;
  varying vec3 vDir;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    float cosA = dot(d, normalize(sunDir));
    float sunAz = max(cosA, 0.0);

    vec3 horizon = vec3(1.0, 0.50, 0.20);
    vec3 mid     = vec3(0.50, 0.20, 0.40);
    vec3 top     = vec3(0.035, 0.06, 0.19);

    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.30, e));
    col = mix(col, top, smoothstep(0.20, 0.85, e));
    col += vec3(1.0, 0.42, 0.10) * pow(sunAz, 3.0) * 0.55 * (1.0 - smoothstep(0.0, 0.55, e));

    vec3 below = mix(horizon * 0.50, vec3(0.07, 0.045, 0.06), smoothstep(0.0, -0.22, e));
    col = mix(col, below, smoothstep(0.004, -0.012, e));

    float disc = smoothstep(0.99950, 0.99985, cosA);
    float glow = pow(sunAz, 110.0) * 1.5 + pow(sunAz, 14.0) * 0.55;
    col += vec3(1.0, 0.62, 0.30) * glow + vec3(1.0, 0.92, 0.75) * disc * 7.0;

    if (e > 0.0) {
      vec2 uv = d.xz / (e + 0.20) * 1.5 + vec2(time * 0.004, time * 0.0013);
      float n = fbm(uv * 1.25);
      float n2 = fbm(uv * 3.2 + 7.0);
      float c = smoothstep(0.46, 0.80, n * 0.8 + n2 * 0.35);
      c *= smoothstep(0.0, 0.16, e) * (1.0 - smoothstep(0.55, 0.95, e));
      float lit = pow(sunAz, 3.0);
      vec3 cc = mix(vec3(0.20, 0.09, 0.24), vec3(1.0, 0.48, 0.20), clamp(lit * 1.3 + 0.10 + (1.0 - e) * 0.22, 0.0, 1.0));
      cc += vec3(1.0, 0.70, 0.35) * pow(sunAz, 12.0) * 0.9;
      col = mix(col, cc, c * 0.82);
    }
    // qualche stella in alto
    if (e > 0.35) {
      float st = step(0.9965, hash(floor(d.xz / (e + 0.3) * 160.0)));
      col += vec3(0.8, 0.85, 1.0) * st * smoothstep(0.35, 0.8, e) * 0.9;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { sunDir: { value: SUN_DIR.clone() }, time: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 28), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/** Genera la mappa d'ambiente (PMREM) dal cielo; ritorna la texture da usare come envMap. */
export function createEnvMap(renderer) {
  const scene = new THREE.Scene();
  const sky = createSky();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 1, 2000);
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return rt.texture;
}
