// F68: drifting cloud shadows. Pure part: cloudAt(x, y, t, params) -> 0..1 (a sum of a few travelling sinusoids, so the
// pattern drifts rigidly with the wind: cloudAt(x + vx*dt, y + vy*dt, t + dt) === cloudAt(x, y, t)). Rendering part: the
// same function evaluated in the fragment shader of the terrain, grass plane and tuft materials (patched with
// onBeforeCompile; no extra mesh, so no z-fighting and boules/players/trees are untouched, they use other materials).
import * as THREE from '../vendor/three.module.js';
import { mulberry32 } from './rng.js';

export const CLOUD = {
  waves: 6,
  wavelength: [38, 130], // metres
  speed: 2.2, // m/s drift
  lo: 0.53, hi: 0.76, // smoothstep band over the normalised wave sum: sets coverage and edge softness
  strength: [0.19, 0.175, 0.15], // peak darkening per channel (slightly bluish: red falls most)
};

// seedParams(seed) -> { waves: [[kx, ky, phase, amp]...], vx, vy }. Wind direction is a gentle function of the seed.
export function cloudParams(seed = 1) {
  const r = mulberry32((seed | 0) * 7919 + 31);
  const dir = (r() - 0.5) * 1.6 + 0.35; // radians, drifting roughly toward +x
  const vx = Math.cos(dir) * CLOUD.speed, vy = Math.sin(dir) * CLOUD.speed;
  const waves = [];
  for (let i = 0; i < CLOUD.waves; i++) {
    const a = r() * Math.PI * 2;
    const wl = CLOUD.wavelength[0] + (CLOUD.wavelength[1] - CLOUD.wavelength[0]) * r();
    const k = (Math.PI * 2) / wl;
    waves.push([Math.cos(a) * k, Math.sin(a) * k, r() * Math.PI * 2, 0.6 + 0.8 * r()]);
  }
  return { waves, vx, vy };
}

const sstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

export function cloudAt(x, y, t, p) {
  let s = 0, tot = 0;
  for (const [kx, ky, ph, amp] of p.waves) {
    s += amp * Math.sin(kx * (x - p.vx * t) + ky * (y - p.vy * t) + ph);
    tot += amp;
  }
  return sstep(CLOUD.lo, CLOUD.hi, 0.5 + 0.5 * (s / tot));
}

let nPatched = 0;
const f = (n) => n.toFixed(5);

// Shader side. Returns { uniforms, patch(material), update(dt, reduced) }.
export function makeCloudShadows(seed = 1) {
  const p = cloudParams(seed);
  const uniforms = {
    cloudT: { value: 0 },
    cloudW: { value: p.waves.map(([kx, ky, ph, amp]) => new THREE.Vector4(kx, ky, ph, amp)) },
  };
  const glsl = `
uniform float cloudT;
uniform vec4 cloudW[${CLOUD.waves}];
varying vec2 vCsXY;
float cloudShadowAt(vec2 q) {
  float s = 0.0, tot = 0.0;
  for (int i = 0; i < ${CLOUD.waves}; i++) {
    s += cloudW[i].w * sin(cloudW[i].x * (q.x - ${f(p.vx)} * cloudT) + cloudW[i].y * (q.y - ${f(p.vy)} * cloudT) + cloudW[i].z);
    tot += cloudW[i].w;
  }
  return smoothstep(${f(CLOUD.lo)}, ${f(CLOUD.hi)}, 0.5 + 0.5 * s / tot);
}`;
  return {
    uniforms, params: p,
    patch(material) {
      const prev = material.onBeforeCompile;
      material.onBeforeCompile = (sh, renderer) => {
        if (prev) prev(sh, renderer);
        sh.uniforms.cloudT = uniforms.cloudT;
        sh.uniforms.cloudW = uniforms.cloudW;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vCsXY;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
  { vec4 csw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    csw = instanceMatrix * csw;
  #endif
  vCsXY = (modelMatrix * csw).xy; }`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nprecision highp float;\n' + glsl)
          .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  diffuseColor.rgb *= 1.0 - cloudShadowAt(vCsXY) * vec3(${CLOUD.strength.map(f).join(', ')});`);
      };
      const key = 'f68cloud' + (nPatched++);
      material.customProgramCacheKey = () => key;
      material.needsUpdate = true;
    },
    // dt is render time (0 when paused); no drift under reduced motion (a static pattern)
    update(dt, reduced) { if (!reduced) uniforms.cloudT.value += dt; },
  };
}
