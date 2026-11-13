// three.js renderer for the pétanque game. World axes: x across, y along, z up.
import { stripGeometry } from './strip.js';
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { jackMaterialParams } from './terrain.js';
import { court } from './court.js';
import { JACK_END_CENTRE, JACK_CENTRE_SHIFT } from './rules.js';
import { rankBoules, layoutBadges } from './ranklabels.js'; // F91
import { mulberry32 } from './rng.js';
import { LUMBER } from './physics.js';
import { frameMoving, cameraFromFrame, blendStart, blendStep, frameObserver, gatherMoving, frameTV, tvVariant, TV, frameBroadcast, frameCourtWide, scoringTargetBox } from './camera.js';
import { makeButterflies } from './butterflies.js'; // F67
import { makeCloudShadows } from './cloudshadows.js'; // F68
import { daylightAt, SUN_DISTANCE, SHADOW_NEAR, SHADOW_FAR } from './daylight.js';
import { grassTexture, makeGrassPlane, blendGrassIntoTerrain, makeTufts, makeTrees, makeTreeShadows, makeBlobTexture, dbgParam, makeSkyPanorama, makeLake, makeSailboats, skyColor, SKY_HAZE, isPhone } from './scenery.js';
import { createFloatplane } from './floatplane.js'; // F19

const TRANSITION = 0.6; // seconds for camera moves

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Speckled gravel detail texture, tileable enough at this scale
function gravelTexture(grey) {
  const S = 512, cv = makeCanvas(S, S), g = cv.getContext('2d');
  const rand = mulberry32(7);
  g.fillStyle = grey ? '#aab6cc' : '#b9a98a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < (grey ? 14000 : 9000); i++) { // F16: the grey court gets more, bluer speckle (it read as asphalt)
    const x = rand() * S, y = rand() * S, r = 0.6 + rand() * 2.6;
    const l = 45 + rand() * 45;
    g.fillStyle = grey ? `hsl(${208 + rand() * 24}, ${8 + rand() * 16}%, ${Math.min(94, l + 4)}%)` : `hsl(${28 + rand() * 14}, ${12 + rand() * 22}%, ${l}%)`;
    // draw wrapped so the tile has no seams
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -4 || x + ox > S + 4 || y + oy < -4 || y + oy > S + 4) continue;
      g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.283); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Weathered grey-brown timber: grain streaks run along u, with a few knots and splits
function woodTexture() {
  const W = 512, H = 128, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const rand = mulberry32(21);
  g.fillStyle = '#cdc4b4';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { // broad tonal bands
    g.fillStyle = `hsla(${28 + rand() * 12}, ${8 + rand() * 18}%, ${38 + rand() * 30}%, ${0.12 + rand() * 0.2})`;
    g.fillRect(0, rand() * H, W, 1 + rand() * 7);
  }
  for (let i = 0; i < 260; i++) { // fine wavy grain lines (wrap at the tile edges)
    const y0 = rand() * H, amp = 0.4 + rand() * 1.6, ph = rand() * 6.28, fr = 0.01 + rand() * 0.02;
    g.strokeStyle = `hsla(${24 + rand() * 12}, ${10 + rand() * 15}%, ${22 + rand() * 25}%, ${0.15 + rand() * 0.3})`;
    g.lineWidth = 0.5 + rand() * 1.3;
    g.beginPath();
    for (let x = 0; x <= W; x += 8) { const y = y0 + Math.sin(x * fr * 6.2832 + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 4; i++) { // knots
    const x = rand() * W, y = 20 + rand() * (H - 40), rx = 6 + rand() * 9;
    for (let k = 4; k >= 1; k--) {
      g.strokeStyle = `hsla(25, 25%, ${18 + k * 4}%, 0.45)`; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(x, y, rx * k / 2.2, rx * k / 5, 0, 0, 6.283); g.stroke();
    }
  }
  for (let i = 0; i < 5; i++) { // checks (splits) along the grain
    const x = rand() * W, y = rand() * H;
    g.strokeStyle = 'rgba(40,28,18,0.65)'; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 25 + rand() * 50, y + (rand() - 0.5) * 3); g.stroke();
  }
  for (let i = 0; i < 1500; i++) { // silvery weathering speckle
    g.fillStyle = `rgba(${200 + rand() * 40}, ${195 + rand() * 40}, ${185 + rand() * 40}, ${rand() * 0.12})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Grayscale groove bump maps: team 0 = parallel rings, team 1 = crossing grooves
function grooveTexture(team) {
  const W = 512, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#303030';
  g.lineWidth = 7;
  g.lineCap = 'round';
  if (team === 0) {
    for (const f of [0.3, 0.5, 0.7]) {
      g.beginPath(); g.moveTo(0, H * f); g.lineTo(W, H * f); g.stroke();
    }
  } else {
    for (let k = 0; k < 4; k++) {
      const x = (k + 0.5) * (W / 4);
      g.beginPath(); g.moveTo(x - H * 0.5, 0); g.lineTo(x + H * 0.5, H); g.stroke();
      g.beginPath(); g.moveTo(x + H * 0.5, 0); g.lineTo(x - H * 0.5, H); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Sky dome with a vertical colour gradient
function makeSky() {
  // clear summer sky: deeper blue overhead fading to a pale haze at the horizon (same gradient as the panorama and fog)
  const geo = new THREE.SphereGeometry(200, 48, 64);
  // sphere's pole is +y; rotate so +z is up
  geo.rotateX(Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  paintSky(mesh, null);
  return mesh;
}
// F71: (re)colour the dome. `fog` (a Color) is the warmed horizon haze: the horizon matches it exactly and the shift
// fades out with elevation, so the upper sky only warms a little.
const SKY_HAZE0 = new THREE.Color(SKY_HAZE);
function paintSky(mesh, fog) {
  const pos = mesh.geometry.attributes.position, col = mesh.geometry.attributes.color, c = new THREE.Color();
  const dr = fog ? fog.r - SKY_HAZE0.r : 0, dg = fog ? fog.g - SKY_HAZE0.g : 0, db = fog ? fog.b - SKY_HAZE0.b : 0;
  for (let i = 0; i < pos.count; i++) {
    const el = Math.asin(Math.max(-1, Math.min(1, pos.getZ(i) / 200))) * 180 / Math.PI;
    skyColor(el, c);
    const f = Math.pow(Math.max(0, 1 - Math.max(0, el) / 80), 1.5);
    col.setXYZ(i, c.r + dr * f, c.g + dg * f, c.b + db * f);
  }
  col.needsUpdate = true;
}
function makeEnvMap(renderer, envFloor) {
  const s = new THREE.Scene();
  s.add(makeSky());
  const floor = new THREE.Mesh(new THREE.CircleGeometry(150, 16), new THREE.MeshBasicMaterial({ color: envFloor }));
  floor.position.z = -1;
  s.add(floor);
  const bright = new THREE.MeshBasicMaterial({ color: '#fff4dc' });
  for (const [x, y, z, w, h] of [[-20, 10, 15, 14, 8], [18, -12, 12, 10, 6], [0, 30, 8, 20, 3]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1, h), bright);
    b.position.set(x, y, z);
    b.lookAt(0, 0, 0);
    s.add(b);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return tex;
}

const smooth = (t) => t * t * (3 - 2 * t);

// init.antialias: fixed at context creation (F103: a WebGL context cannot change it later); init.quality: level settings (quality.js) applied at once
export function createRenderer(canvas, terrain, init = {}) {
  let renderer;
  const antialias = init.antialias !== false;
  let pixelRatioMax = 2; // F103
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias });
  } catch (e) {
    throw new Error('WebGL is not available in this browser, so the 3D game cannot start.');
  }
  if (!renderer.getContext()) throw new Error('WebGL is not available in this browser, so the 3D game cannot start.');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioMax));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(SKY_HAZE);
  scene.background = FOG;
  scene.fog = new THREE.Fog(FOG, 60, 320);
  const skyDome = makeSky();
  scene.add(skyDome);
  const panorama = makeSkyPanorama(C.terrainW / 2, C.terrainL / 2, SKY_HAZE);
  scene.add(panorama);
  scene.environment = makeEnvMap(renderer, terrain.gravel === 'grey' ? '#8e939c' : '#a8977a');

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  camera.up.set(0, 0, 1);

  // Lights
  const hemi = new THREE.HemisphereLight('#cfe2ff', '#8a7a5c', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe2b8', 3.0);
  const sunOffset = new THREE.Vector3(-5, -7, 6); // F71: mutable, the single source of the sun direction (set by setDaylight)
  sun.castShadow = true;
  // The shadow box follows the look target. It is wide enough to take in the trees (within ~15 m of the court) and
  // their shadows, which fall away from the sun: desktop gets a 2048 map over +-14 m (texels ~1.4 cm), phones keep
  // a 1024 map over +-10 m. The depth range is 60 m, so the bias is scaled to match the old 25 m setting.
  const phoneShadows = isPhone(), shadowHalf = Number(dbgParam('shadowhalf')) || (phoneShadows ? 10 : 14);
  // F92: clamp to what the GPU supports; ?debug&shadowmap=N forces a size, &shadowtype=basic|pcf|soft picks the filter, &shadowhalf=M the half-width in metres
  const dbgMap = Number(dbgParam('shadowmap')) || 0;
  const baseHalf = shadowHalf, baseMap = Math.max(256, Math.min(dbgMap || (phoneShadows ? 1024 : 2048), renderer.capabilities.maxTextureSize || 2048));
  let curHalf = shadowHalf;
  sun.shadow.mapSize.set(baseMap, baseMap);
  const st = dbgParam('shadowtype');
  if (st) renderer.shadowMap.type = { basic: THREE.BasicShadowMap, pcf: THREE.PCFShadowMap, soft: THREE.PCFSoftShadowMap }[st] ?? renderer.shadowMap.type;
  const sc = sun.shadow.camera;
  sc.left = -shadowHalf; sc.right = shadowHalf; sc.top = shadowHalf; sc.bottom = -shadowHalf; sc.near = SHADOW_NEAR; sc.far = SHADOW_FAR; // F95: near is negative so players upsun of the target keep their shadow
  sc.updateProjectionMatrix();
  sun.shadow.bias = Number(dbgParam("sb") ?? (-0.00003 * 60 / (SHADOW_FAR - SHADOW_NEAR))); // F98: tiny; the old -0.00017 (~1 cm over the 90 m depth range) detached boule shadows
  sun.shadow.normalBias = Number(dbgParam("nb") ?? 0.002); // F98: was 0.01 (1 cm), which on 7.5 cm boules shows as a gap at the contact point (peter panning); ?debug&nb=&sb= override
  scene.add(sun, sun.target);
  // F40: aim the sun at p, snapped to the shadow map's texel grid in light space. Without this the frustum slides
  // by sub-texel steps as the camera moves, which crawls the shadow edges (the timbers' flicker).
  // F71: the light-space axes are recomputed whenever setDaylight changes the direction (snapping stays on the new grid)
  const sunXAxis = new THREE.Vector3(), sunYAxis = new THREE.Vector3(), sunZAxis = new THREE.Vector3();
  const updateSunAxes = () => {
    sunZAxis.copy(sunOffset).normalize();
    sunXAxis.crossVectors(new THREE.Vector3(0, 1, 0), sunZAxis).normalize();
    sunYAxis.crossVectors(sunZAxis, sunXAxis).normalize();
  };
  updateSunAxes();
  let sunTexel = (2 * curHalf) / sun.shadow.mapSize.x; // F103: follows the quality level's map size and box
  const aimSun = (p) => {
    const px = p.dot(sunXAxis), py = p.dot(sunYAxis);
    const sx = Math.round(px / sunTexel) * sunTexel, sy = Math.round(py / sunTexel) * sunTexel;
    sun.target.position.copy(p).addScaledVector(sunXAxis, sx - px).addScaledVector(sunYAxis, sy - py);
    sun.position.copy(sun.target.position).add(sunOffset);
  };

  // Terrain mesh
  const grid = terrain.heightGrid(0.05);
  const { w: gw, h: gh } = grid;
  const pos = new Float32Array(gw * gh * 3), uv = new Float32Array(gw * gh * 2), colr = new Float32Array(gw * gh * 3);
  const WHITE = new THREE.Color('#ffffff');
  let edgeZ = 0; // the grass plane sits just below the lowest terrain point; the mesh eases down to it past the timbers
  for (let k = 0; k < grid.data.length; k++) edgeZ = Math.min(edgeZ, grid.data[k]);
  edgeZ -= 0.004;
  const grey = terrain.gravel === 'grey';
  const earth = new THREE.Color(grey ? '#8790a0' : '#8f8365'), packed = new THREE.Color(grey ? '#e0e6f2' : '#e6d9bd'), loose = new THREE.Color(grey ? '#eef2fa' : '#fff0d2'), tint = new THREE.Color();
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i, x = grid.x0 + i * grid.step, y = grid.y0 + j * grid.step;
      const s = terrain.sample(x, y);
      const gd = Math.hypot(Math.max(-C.lumberGap - C.lumberSize - x, x - C.terrainW - C.lumberGap - C.lumberSize, 0), Math.max(-C.lumberGap - C.lumberSize - y, y - C.terrainL - C.lumberGap - C.lumberSize, 0));
      const ez = smooth(Math.max(0, Math.min(1, (gd - 1.0) / 0.9)));
      pos.set([x, y, grid.data[k] + (edgeZ + 0.003 - grid.data[k]) * ez], k * 3);
      uv.set([x * 2, y * 2], k * 2);
      tint.copy(packed).lerp(loose, Math.max(0, Math.min(1, s.loose)));
      // beyond the timbers the ground is darker, rougher earth
      const o = C.lumberGap + C.lumberSize;
      const ox = Math.max(-o - x, x - C.terrainW - o, 0), oy = Math.max(-o - y, y - C.terrainL - o, 0);
      tint.lerp(earth, smooth(Math.max(0, Math.min(1, Math.hypot(ox, oy) / 0.5))) * 0.75);
      tint.lerp(WHITE, smooth(Math.max(0, Math.min(1, (Math.hypot(ox, oy) - 0.8) / 0.6)))); // grass takes over (see scenery.js)
      colr.set([tint.r, tint.g, tint.b], k * 3);
    }
  }
  const idx = new Uint32Array((gw - 1) * (gh - 1) * 6);
  let n = 0;
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
      idx.set([a, b, d, a, d, c], n); n += 6;
    }
  }
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tgeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tgeo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  tgeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tgeo.computeVertexNormals();
  const gravel = gravelTexture(grey);
  const terrainMesh = new THREE.Mesh(tgeo, new THREE.MeshStandardMaterial({
    map: gravel, vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.4,
  }));
  terrainMesh.receiveShadow = true;
  // F96: the height of the terrain MESH under (x, y), triangle by triangle as the mesh is indexed. The mesh is built once
  // from the undented ground, but terrain.sample() includes the divots physics stamps into the ground (up to 2 cm) and the
  // 1.5 mm jitter, so decals placed with sample().h ended up under the mesh and only showed where the triangles dipped:
  // soft dark blobs cut by straight, grid-aligned edges. Every decal lying on the ground now takes its height from here.
  const surfH = (x, y) => {
    const fx = Math.max(0, Math.min(gw - 1.0001, (x - grid.x0) / grid.step)), fy = Math.max(0, Math.min(gh - 1.0001, (y - grid.y0) / grid.step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * gw + i, d = grid.data;
    return tx >= ty ? d[k] + (d[k + 1] - d[k]) * tx + (d[k + gw + 1] - d[k + 1]) * ty
      : d[k] + (d[k + gw + 1] - d[k + gw]) * tx + (d[k + gw] - d[k]) * ty;
  };
  const grass = grassTexture();
  blendGrassIntoTerrain(terrainMesh.material, grass);
  const clouds = makeCloudShadows(1); // F68
  // F96 debug (dev builds): ?debug&hideshadows=trees,players,clouds,decals,all (comma list) switches shadow sources off, to tell
  // which one a cut-off dark shape belongs to: trees = tree blob decals, players = the sun's shadow map (people and boules),
  // clouds = cloud shading, decals = divot discs, the donnee marker and the throw-preview fans
  const hideSh = new Set(String(dbgParam('hideshadows') || '').split(',').filter(Boolean));
  const hides = (k) => hideSh.has(k) || hideSh.has('all');
  if (hides('clouds')) clouds.patch = () => {};
  clouds.patch(terrainMesh.material); // F68
  scene.add(terrainMesh);

  // Grass beyond the terrain mesh, out to the horizon (the mesh blends into it past the timbers)
  const ground = makeGrassPlane(grass, C.terrainW / 2, C.terrainL / 2, 600, edgeZ);
  clouds.patch(ground.material); // F68
  scene.add(ground);
  const lake = makeLake(C.terrainW / 2, edgeZ); // F19: distant lake (shimmer frozen when paused or under reduced motion)
  scene.add(lake.mesh);
  const sailboats = makeSailboats(C.terrainW / 2, edgeZ); scene.add(sailboats.group); // F64
  const butterflies = makeButterflies(edgeZ); scene.add(butterflies.group); // F67
  const floatplane = createFloatplane({ cx: C.terrainW / 2, z: edgeZ + 0.05 });
  scene.add(floatplane.group);
  const tufts = makeTufts(terrain, isPhone()); clouds.patch(tufts.material); scene.add(tufts); // F68
  const trees = makeTrees(terrain);
  scene.add(trees);
  const treeShadows = makeTreeShadows(terrain, sunOffset); // F73: blob shadows for the trees outside the shadow map's job
  scene.add(treeShadows);
  if (hides('trees')) treeShadows.visible = false;
  if (hides('players')) sun.castShadow = false;
  let swayT = 0; // D15: a slow lean of each tree about its foot; frozen when paused (render dt 0), none under reduced motion

  // Lumber surround: weathered 6x6 timbers, one mesh per board section (long sides split with butt joints,
  // slightly different tone and top height per board), casting and receiving shadows
  const woodMap = woodTexture();
  const lumberGroup = new THREE.Group();
  {
    const lr = mulberry32(31), tones = ['#ffffff', '#f0e6d8', '#fff4e6', '#e6dac8', '#f5ecde'];
    const sz = C.lumberSize;
    for (const bx of LUMBER) {
      const alongY = bx.y1 - bx.y0 > bx.x1 - bx.x0;
      const len = alongY ? bx.y1 - bx.y0 : bx.x1 - bx.x0;
      const n = Math.max(1, Math.round(len / 4.4)), seg = len / n;
      for (let i = 0; i < n; i++) {
        const gapJ = 0.004;
        const l = seg - (n > 1 ? gapJ : 0);
        const hTop = sz + (lr() - 0.5) * 0.01; // uneven tops, up to +-5 mm
        const geo = new THREE.BoxGeometry(l, sz, hTop + 0.1);
        const uv = geo.attributes.uv, uo = lr(), vo = lr();
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * l / 1.6 + uo, uv.getY(k) * 0.9 + vo);
        const mat = new THREE.MeshStandardMaterial({ map: woodMap, color: tones[Math.floor(lr() * tones.length)], roughness: 0.92, metalness: 0, envMapIntensity: 0.3 });
        const m = new THREE.Mesh(geo, mat);
        const c0 = (alongY ? bx.y0 : bx.x0) + seg * (i + 0.5);
        const zc = hTop - (hTop + 0.1) / 2;
        if (alongY) { m.rotation.z = Math.PI / 2; m.position.set((bx.x0 + bx.x1) / 2, c0, zc); } else m.position.set(c0, (bx.y0 + bx.y1) / 2, zc);
        m.castShadow = true; m.receiveShadow = true;
        lumberGroup.add(m);
      }
    }
  }
  scene.add(lumberGroup);

  // Visible stones
  const stones = terrain.visibleStones();
  if (stones.length) {
    const sg = new THREE.IcosahedronGeometry(1, 0);
    const stoneMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true, envMapIntensity: 0.3 }), stones.length);
    const rand = mulberry32(99), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
    stones.forEach((s, i) => {
      const h = terrain.sample(s.x, s.y).h;
      // exaggerate pebble visibility slightly; they still sit in the ground
      const r = s.r * (1.3 + rand() * 0.3);
      e.set(rand() * 6, rand() * 6, rand() * 6);
      q.setFromEuler(e);
      sv.set(r, r * (0.7 + rand() * 0.3), r * (0.6 + rand() * 0.3));
      pv.set(s.x, s.y, h + r * 0.25);
      m.compose(pv, q, sv);
      stoneMesh.setMatrixAt(i, m);
      const t = rand();
      if (grey) col.setHSL(0.6 + rand() * 0.04, 0.04 + t * 0.1, 0.22 + rand() * 0.25);
      else col.setHSL(0.09 + rand() * 0.04, 0.1 + t * 0.25, 0.3 + rand() * 0.3);
      stoneMesh.setColorAt(i, col);
    });
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    scene.add(stoneMesh);
  }
  // Boundary strings and throwing circle
  const strings = new THREE.Group();
  // F34: each string is a thin strip (1.6 cm) draped on the terrain: both edges sampled every ~10 cm and lifted a few mm,
  // so slopes of up to ±0.2 m never bury it. The offset keeps it clear of the ground at grazing angles.
  const stringMat = new THREE.MeshBasicMaterial({
    color: '#ffffff', fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const STRING_W = 0.016, STRING_LIFT = 0.004;
  const W = C.terrainW, L = C.terrainL;
  const addString = (x0, y0, x1, y1) => {
    const { pos, idx } = stripGeometry(x0, y0, x1, y1, STRING_W, STRING_LIFT, (x, y) => terrain.sample(x, y).h);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, stringMat);
    m.frustumCulled = false;
    strings.add(m);
  };
  addString(0, 0, W, 0); addString(W, 0, W, L); addString(W, L, 0, L); addString(0, L, 0, 0);
  scene.add(strings);
  // E10: the circle is a real object (a ring) that can be picked up and carried: syncCourt puts it at the current
  // circle (with a short fade for a quick-mode move), setRingPose holds it elsewhere (in somebody's hand)
  const ringGeo = new THREE.RingGeometry(C.circle.r - 0.012, C.circle.r + 0.012, 64);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#c0262f', transparent: true }));
  // F34: on the court the ring is laid on the terrain (each vertex takes the ground height under it, 6 mm up), so none of
  // it sinks into a slope; held in somebody's hand it is flat about its own origin
  let ringDraped = false;
  const ringHome = () => {
    const c = court.circle, p = ringGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, terrain.sample(c.x + p.getX(i), c.y + p.getY(i)).h + 0.006);
    p.needsUpdate = true; ringDraped = true;
    ring.position.set(c.x, c.y, 0); ring.rotation.set(0, 0, 0);
  };
  const ringFlat = () => {
    if (!ringDraped) return;
    const p = ringGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0);
    p.needsUpdate = true; ringDraped = false;
  };
  ringHome();
  scene.add(ring);
  let ringFade = null; // { t, dur, moved }: fade out, move, fade in
  let ringHeld = false;
  function setRingPose(p) {
    ringHeld = !!p;
    if (p) { ringFlat(); ring.position.set(p.x, p.y, p.z); ring.rotation.set(0, 0, 0); } else ringHome();
  }
  function tickRing(dt) {
    if (!ringFade) return;
    ringFade.t += dt;
    const k = Math.min(1, ringFade.t / ringFade.dur);
    if (k >= 0.5 && !ringFade.moved) { ringFade.moved = true; if (!ringHeld) ringHome(); }
    ring.material.opacity = Math.abs(1 - 2 * k);
    if (k >= 1) { ringFade = null; ring.material.opacity = 1; }
  }

  // Bodies
  const grooves = [grooveTexture(0), grooveTexture(1)];
  const bouleMats = [
    new THREE.MeshStandardMaterial({ color: '#a9bde0', metalness: 1, roughness: 0.3, bumpMap: grooves[0], bumpScale: 1.5, envMapIntensity: 2.2 }),
    new THREE.MeshStandardMaterial({ color: '#e8aa6a', metalness: 1, roughness: 0.3, bumpMap: grooves[1], bumpScale: 1.5, envMapIntensity: 2.2 }),
  ];
  // Dead (out of play) bodies: greyed and dulled
  const deadBouleMat = new THREE.MeshStandardMaterial({ color: '#a4a8b0', metalness: 0.45, roughness: 0.5, envMapIntensity: 0.9 });
  const deadJackMat = new THREE.MeshStandardMaterial({ color: '#8a7a5e', metalness: 0, roughness: 0.6 });
  const jackMat = new THREE.MeshStandardMaterial(jackMaterialParams()); // orange on grey gravel, bright red on sand (F52), lit a little from within so it stays vivid in shade
  const bouleGeo = new THREE.SphereGeometry(1, 40, 24);
  bouleGeo.rotateX(Math.PI / 2); // texture poles along z; any orientation is fine
  const jackGeo = new THREE.SphereGeometry(1, 20, 12);
  const meshes = new Map(); // id -> { mesh, body, fade, ... }
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();

  function sync(world) {
    const bodies = Array.isArray(world) ? world : (world.bodies || []);
    const seen = new Set();
    for (const b of bodies) {
      seen.add(b.id);
      let e = meshes.get(b.id);
      if (!e) {
        const jack = b.kind === 'jack';
        const mesh = new THREE.Mesh(jack ? jackGeo : bouleGeo, jack ? jackMat : bouleMats[b.team ? 1 : 0]);
        mesh.scale.setScalar(b.r);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
        scene.add(mesh);
        e = { mesh, body: b };
        meshes.set(b.id, e);
      }
      e.body = b;
      e.mesh.position.set(b.x, b.y, b.z);
      e.mesh.visible = true; // dead bodies stay visible at their spot beyond the far line, greyed
      const baseMat = b.dead ? (b.kind === 'jack' ? deadJackMat : deadBouleMat) : (b.kind === 'jack' ? (jv.c ? jackBright : jackMat) : bouleMats[b.team ? 1 : 0]);
      if (e.fade) { // D11 reduced motion: a ball fades out and in instead of being carried
        if (!e.fadeMat || e.fadeBase !== baseMat) { e.fadeMat = baseMat.clone(); e.fadeBase = baseMat; e.fadeMat.transparent = true; }
        e.fadeMat.opacity = e.fade.k;
        e.mesh.material = e.fadeMat;
      } else e.mesh.material = baseMat;
      if (b.kind === 'jack') jackLive = e;
    }
    for (const [id, e] of meshes) {
      if (seen.has(id)) continue;
      scene.remove(e.mesh);
      if (e === jackLive) jackLive = null;
      meshes.delete(id);
    }
  }

  // Fade a body out (dir -1) or in (dir +1) over `dur` seconds of render time (reduced motion only; see main.js kickFetch)
  function fadeBody(id, dir, dur = 0.3) {
    const e = meshes.get(id);
    if (!e) return;
    e.fade = { k: dir > 0 ? 0 : 1, dir, dur };
  }
  function updateFades(dt) {
    for (const e of meshes.values()) {
      const f = e.fade;
      if (!f) continue;
      f.k = Math.max(0, Math.min(1, f.k + f.dir * dt / f.dur));
      if (f.k >= 1 && f.dir > 0) { e.fade = null; if (e.fadeMat) e.mesh.material = e.fadeBase; }
      e.mesh.visible = !(f.dir < 0 && f.k <= 0);
    }
  }

  // Jack finder: at 6-10 m the jack is a few pixels, so a bobbing chevron (constant screen size) floats over it.
  // ?debug&jackvis=a|c|ac|none compares the options (a = chevron, c = bright orange jack).
  const jackVisParam = (() => {
    try { const q = new URLSearchParams(location.search); return globalThis.__DEBUG__ !== false && q.has('debug') ? q.get('jackvis') : null; } catch (e) { return null; }
  })();
  const jv = jackVisParam === null ? { a: true, c: true }
    : { a: jackVisParam.includes('a'), c: jackVisParam.includes('c') };
  const jackBright = new THREE.MeshStandardMaterial(jackMaterialParams(undefined, true)); // the live jack: livelier orange on grey, the same bright red as jackMat on sand
  const jackChevron = (() => {
    const cv = makeCanvas(64, 96), g = cv.getContext('2d');
    g.lineJoin = 'round';
    g.beginPath(); g.moveTo(32, 90); g.lineTo(6, 44); g.lineTo(20, 44); g.lineTo(20, 8); g.lineTo(44, 8); g.lineTo(44, 44); g.lineTo(58, 44); g.closePath(); // down arrow
    g.lineWidth = 9; g.strokeStyle = '#241608'; g.stroke();
    g.fillStyle = '#ffd84a'; g.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false }));
    spr.center.set(0.5, 0); spr.scale.set(0.026, 0.039, 1); spr.renderOrder = 20; spr.visible = false; spr.frustumCulled = false;
    scene.add(spr);
    return spr;
  })();
  let jackLive = null, jackT = 0;
  // The chevron is only wanted while the human aims a boule (D17): main.js switches it on and off, and it fades over ~0.4 s
  let arrowWant = false, arrowK = 0;
  function setJackArrow(on, now) { arrowWant = !!on; if (now || reduce()) arrowK = arrowWant ? 1 : 0; }
  function updateJackMark(dt) {
    jackT += dt;
    arrowK = reduce() ? (arrowWant ? 1 : 0) : Math.max(0, Math.min(1, arrowK + (arrowWant ? dt : -dt) / 0.25));
    const e = jackLive, on = e && !e.body.dead && mode !== 'inspect' && !measure.children.length && !scoring.children.length && !placeMarker.visible;
    if (!on) { jackChevron.visible = false; return; }
    const p = e.mesh.position, dist = camera.position.distanceTo(p);
    const k = Math.max(0, Math.min(1, (dist - 1.5) / 1.5)); // fade out inside ~1.5 m, fully on by 3 m
    const ndcH = dist * Math.tan(camera.fov * Math.PI / 360); // metres per unit of NDC height at the jack
    if (jv.a && k > 0 && arrowK > 0) {
      const bob = reduce() ? 0 : 0.5 + 0.5 * Math.sin(jackT * 4.5);
      jackChevron.position.set(p.x, p.y, p.z + e.body.r + ndcH * (0.03 + 0.03 * bob));
      jackChevron.material.opacity = k * arrowK;
      jackChevron.visible = true;
    } else jackChevron.visible = false;
  }

  // Divot decals: a pool of soft dark discs just above the ground, reused in a ring
  const DIVOTS = 48;
  const dc = grey ? '40,46,58' : '60,44,24';
  const divotTex = makeBlobTexture(64, [[0, `rgba(${dc},0.55)`], [0.65, `rgba(${dc},0.3)`], [1, `rgba(${dc},0)`]]); // F92: alpha 0 with a 4 px margin
  const divotGeo = new THREE.PlaneGeometry(2, 2);
  const divotMat = new THREE.MeshBasicMaterial({
    map: divotTex, transparent: true, depthWrite: false, depthTest: dbgParam('blobs') !== 'nodepth', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const divotMeshes = [];
  for (let i = 0; i < DIVOTS; i++) {
    const m = new THREE.Mesh(divotGeo, divotMat);
    m.visible = false;
    m.renderOrder = 1;
    scene.add(m);
    divotMeshes.push(m);
  }
  let divotNext = 0;
  let divotsOn = true; // F103: off at Low (the discs read as shadows)
  function addDivot(x, y, r = 0.06) {
    const m = divotMeshes[divotNext++ % DIVOTS];
    if (hides('decals') || !divotsOn) return;
    // F34: lay the disc on the slope (tangent to the ground there) so its whole span stays above it
    // F96: the plane is tangent to the MESH (surfH), then lifted until it clears the mesh at the centre and a ring of points
    // around it (the mesh is 5 cm triangles; the dented ground that terrain.sample() reports is up to 2 cm below it)
    const up = new THREE.Vector3(0, 0, 1), e = 0.05, hs = Math.max(0.03, r * 1.6) * 1.5;
    const z0 = surfH(x, y), gx = (surfH(x + e, y) - surfH(x - e, y)) / (2 * e), gy = (surfH(x, y + e) - surfH(x, y - e)) / (2 * e);
    const n = new THREE.Vector3(-gx, -gy, 1).normalize();
    let lift = 0;
    for (let a = 0; a < 8; a++) {
      const px = hs * Math.cos(a * Math.PI / 4), py = hs * Math.sin(a * Math.PI / 4);
      lift = Math.max(lift, surfH(x + px, y + py) - (z0 + gx * px + gy * py));
    }
    m.position.set(x, y, z0 + lift + 0.004);
    m.quaternion.setFromUnitVectors(up, n);
    m.rotateZ((x * 977 + y * 331) % 6.283);
    m.scale.setScalar(Math.max(0.03, r * 1.6));
    m.visible = true;
  }
  function clearDivots() { for (const m of divotMeshes) m.visible = false; divotNext = 0; }

  // E05/E18: the 6 m and 10 m zone arcs run exactly string to string (x = 0 and x = terrainW), draped on the terrain.
  // zoneArc gives the angles where an arc of radius rad is inside the court, so its ends sit on the side strings.
  // Depth-tested with a polygon offset: the people (opaque) draw over the zone.
  const zoneArc = (rad) => {
    const c = court.circle;
    const lo = Math.asin(Math.max(-1, Math.min(1, (0 - c.x) / rad)));
    const hi = Math.asin(Math.max(-1, Math.min(1, (C.terrainW - c.x) / rad)));
    return [lo, hi];
  };
  // E20/F75: the zone stops JACK_END_CENTRE (0.5 m + the jack's radius: its edge 0.5 m clear) before the end string (the far one in the playing direction, zoneDir = +1 toward
  // y = terrainL, -1 toward y = 0; E10 sets it with the circle). A no-op with the default circle: the 10 m arc ends at y = 11.
  const zoneY = (y) => (court.dir < 0 ? Math.max(y, JACK_END_CENTRE) : Math.min(y, C.terrainL - JACK_END_CENTRE));
  const zoneMat = (opacity, color = '#ffd24a') => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  // a line of width w along the arc of radius rad, string to string
  function zoneLine(rad, w, zoff, order) {
    const c = court.circle, [a0, a1] = zoneArc(rad), n = Math.max(2, Math.ceil((a1 - a0) * rad / 0.02)), pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      for (const r of [rad - w / 2, rad + w / 2]) {
        const x = c.x + r * Math.sin(a), y = zoneY(c.y + court.dir * r * Math.cos(a));
        pos.push(x, y, surfH(x, y) + zoff);
      }
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, zoneMat(0.85));
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }
  // the fill between the two arcs: concentric rings, each spanning its own in-court arc, so the cells never overlap
  // and their outer ends lie exactly on the side strings
  function zoneFill(r0, r1, zoff, order) {
    const c = court.circle, rows = 16, cols = 120, pos = [], idx = [];
    for (let j = 0; j <= rows; j++) {
      const r = r0 + (r1 - r0) * j / rows, [a0, a1] = zoneArc(r);
      for (let i = 0; i <= cols; i++) {
        const a = a0 + (a1 - a0) * i / cols, x = c.x + r * Math.sin(a), y = zoneY(c.y + court.dir * r * Math.cos(a));
        pos.push(x, y, surfH(x, y) + zoff);
      }
    }
    const row = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * row + i, b = a + 1, d = a + row + 1, e = a + row;
      idx.push(a, b, d, a, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, zoneMat(0.22));
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }

  // Legal jack zone: two arcs 6 m and 10 m from the circle, string to string, shown while a human aims the jack
  const jackZone = new THREE.Group();
  jackZone.visible = false;
  scene.add(jackZone);
  // D14: the zone for a hand-placed jack runs string to string: both arcs across the whole court width, with a
  // faint fill between them, clipped at the side strings and the far string
  const placeZone = new THREE.Group();
  placeZone.visible = false;
  scene.add(placeZone);
  // E10: the zone geometry follows the circle and direction, so it is rebuilt whenever the court moves
  function buildZones() {
    for (const g of [jackZone, placeZone]) { for (const m of g.children.slice()) { g.remove(m); m.geometry.dispose(); } }
    // F75: the 6 m and 10 m limits are edge to edge, so the lines (the jack's centre) sit JACK_CENTRE_SHIFT further out
    const rMin = C.jackMinDist + JACK_CENTRE_SHIFT, rMax = C.jackMaxDist + JACK_CENTRE_SHIFT;
    for (const rad of [rMin, rMax]) { jackZone.add(zoneLine(rad, 0.07, 0.008, 3)); placeZone.add(zoneLine(rad, 0.07, 0.008, 3)); }
    placeZone.add(zoneFill(rMin, rMax, 0.006, 2)); // the 10 m arc stops short of the far string, so the side strings are the only clip
  }
  buildZones();
  // The circle or direction changed (court.js): rebuild the zones and move the ring (`fade`: a short fade out and in)
  function syncCourt({ fade = false } = {}) {
    buildZones();
    if (fade && !reduce()) ringFade = { t: 0, dur: 0.5, moved: false };
    else { ringFade = null; ring.material.opacity = 1; if (!ringHeld) ringHome(); }
  }
  function showJackZone(on, mode) {
    jackZone.visible = !!on && mode !== 'place';
    placeZone.visible = !!on && mode === 'place';
  }

  // Placement marker for an invalid jack: a green ring on a valid spot, a red X on an invalid one
  const placeMarker = new THREE.Group();
  placeMarker.visible = false;
  {
    const mk = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40), mk('#3ddc5a'));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), mk('#3ddc5a'));
    const ok = new THREE.Group();
    ok.add(ring, dot);
    const bad = new THREE.Group();
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), mk('#ff3b30'));
      bar.rotation.z = a;
      bad.add(bar);
    }
    for (const g of [ok, bad]) g.traverse((o) => { o.renderOrder = 6; });
    placeMarker.add(ok, bad);
    placeMarker.userData = { ok, bad };
  }
  scene.add(placeMarker);
  function setPlaceMarker(p) {
    if (!p) { placeMarker.visible = false; return; }
    const s = terrain.sample(p.x, p.y);
    placeMarker.position.set(p.x, p.y, s.h + 0.02);
    nrm.set(s.nx || 0, s.ny || 0, s.nz || 1).normalize();
    placeMarker.quaternion.setFromUnitVectors(upZ, nrm);
    placeMarker.userData.ok.visible = !!p.valid;
    placeMarker.userData.bad.visible = !p.valid;
    placeMarker.visible = true;
  }

  // Measuring tape: lines from the jack to each measured boule, with cm labels
  const measure = new THREE.Group();
  scene.add(measure);
  const scoring = new THREE.Group(); // D07: the mène-end circle, number badges and distance labels
  scene.add(scoring);
  function clearMeasure() {
    for (const g of [measure, scoring]) {
      for (const o of [...g.children]) {
        g.remove(o);
        if (o.material && o.material.map) o.material.map.dispose();
        if (o.material) o.material.dispose();
        if (o.geometry && o.geometry !== divotGeo) o.geometry.dispose();
      }
    }
  }
  // Ground-hugging geometry (follows the bumps so it never z-fights or sinks): annulus r0..r1 around (cx, cy)
  function groundRing(cx, cy, r0, r1, color, opacity, zoff, order) {
    const segs = 72, rows = r0 > 0 ? 1 : 8, pos = [], idx = [];
    for (let i = 0; i <= rows; i++) {
      const r = r0 + (r1 - r0) * i / rows;
      for (let k = 0; k < segs; k++) {
        const a = k / segs * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        pos.push(x, y, surfH(x, y) + zoff);
      }
    }
    for (let i = 0; i < rows; i++) for (let k = 0; k < segs; k++) {
      const a = i * segs + k, b = i * segs + (k + 1) % segs, c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }
  // A flat ribbon along the ground from a to b (shortened by ra and rb at the ends)
  function groundRibbon(a, b, ra, rb, w, color, opacity, zoff, order) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= ra + rb + 0.005) return null;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, nx = -dy * w / 2, ny = dx * w / 2;
    const n = Math.max(2, Math.ceil((len - ra - rb) / 0.04)), pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = ra + (len - ra - rb) * i / n, x = a.x + dx * t, y = a.y + dy * t, z = surfH(x, y) + zoff;
      pos.push(x + nx, y + ny, z, x - nx, y - ny, z);
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  }
  function badgeSprite(text, fill, edge) {
    const cv = makeCanvas(96, 96), g = cv.getContext('2d');
    g.beginPath(); g.arc(48, 48, 42, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill(); g.lineWidth = 7; g.strokeStyle = edge; g.stroke();
    g.font = '800 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.fillText(text, 48, 52);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, fog: false }));
    spr.renderOrder = 6; spr.scale.set(0.15, 0.15, 1);
    return spr;
  }
  // F91: overhead-hold rank labels. setRankLabels(world bodies array | () => bodies | null); while set, every frame ranks the live
  // boules by gap to the jack (ranklabels.js) and draws a scoring-style badge beside each, sized to ~26 px on screen.
  const rankGroup = new THREE.Group();
  scene.add(rankGroup);
  const RANK_PX = 26, rankSprites = new Map(), rankTex = new Map();
  let rankSrc = null;
  function rankBadge(rank, team) {
    const key = rank + ':' + team;
    const ink = team === 0 ? ['#2f5fb8', '#16315f'] : ['#d9893a', '#8a4a0c']; // the scoring view's team inks (main.js)
    if (!rankTex.has(key)) { const t = badgeSprite(String(rank), ink[0], '#fff'); t.material.map.colorSpace = THREE.SRGBColorSpace; rankTex.set(key, t.material.map); t.material.dispose(); }
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: rankTex.get(key), depthTest: false, transparent: true, fog: false }));
    spr.renderOrder = 7; spr.userData.key = key;
    return spr;
  }
  function setRankLabels(src) {
    rankSrc = src || null;
    if (!rankSrc) updateRankLabels();
  }
  function updateRankLabels() {
    const bodies = typeof rankSrc === 'function' ? rankSrc() : rankSrc;
    const items = rankSrc ? rankBoules(bodies) : [];
    const jack = items.length ? bodies.find((b) => b.kind === 'jack') : null;
    const seen = new Set();
    if (jack) {
      const H = canvas.clientHeight || 1;
      const dist = camera.position.distanceTo(new THREE.Vector3(jack.x, jack.y, jack.z || 0));
      const size = Math.max(0.05, dist * 2 * Math.tan(camera.fov * Math.PI / 360) * RANK_PX / H); // badge diameter in metres
      const L = layoutBadges(items, jack, size / 2);
      items.forEach((it, i) => {
        seen.add(it.id);
        const key = it.rank + ':' + (it.team ? 1 : 0);
        let spr = rankSprites.get(it.id);
        if (spr && spr.userData.key !== key) { rankGroup.remove(spr); spr.material.dispose(); spr = null; }
        if (!spr) { spr = rankBadge(it.rank, it.team ? 1 : 0); rankSprites.set(it.id, spr); rankGroup.add(spr); }
        spr.scale.set(size, size, 1);
        spr.position.set(L[i].x, L[i].y, it.z + it.r + size * 0.1);
      });
    }
    for (const [id, spr] of rankSprites) {
      if (seen.has(id)) continue;
      rankGroup.remove(spr); spr.material.dispose(); rankSprites.delete(id);
    }
  }
  // D07 mène end: soft disc on the jack holding every scoring boule, numbered badges and distance labels.
  // o: { radius, fill, edge, items: [{ x, y, n }], rival: { x, y, r, label } | null } (the rival gets a label only)
  // F22: showScoring remembers its arguments; fitScoring (below) rebuilds it with the result card as an obstacle
  let scoringArgs = null, scoringFit = null;
  function showScoring(jack, o) {
    scoringArgs = { jack, o }; scoringFit = null;
    return buildScoring(jack, o, null);
  }
  // returns { pts: world points (ground) the view must show: circle, boules, badges and label corners }
  function buildScoring(jack, o, obst) {
    clearMeasure();
    const pts = [];
    for (let k = 0; k < 24; k++) pts.push({ x: jack.x + Math.cos(k * Math.PI / 12) * o.radius, y: jack.y + Math.sin(k * Math.PI / 12) * o.radius });
    // F82: only the circle, the labelled boules, their badges and labels are framed; other boules (they only keep labels
    // off them) may lie far outside and must not zoom the view out
    const K = Math.max(1, Math.min(3, o.radius / 0.45)); // F82: badges and labels grow with a large circle so they read
    scoring.add(groundRing(jack.x, jack.y, 0, o.radius, o.fill, 0.3, 0.014, 2));
    const hw = Math.min(0.009, Math.max(0.0035, o.radius * 0.05)); // E17: a tiny circle gets a thin line, never an inflated one
    scoring.add(groundRing(jack.x, jack.y, o.radius - hw, o.radius + hw, o.edge, 0.95, 0.018, 3)); // centred on the radius
    // E17: each badge sits beside its boule (away from the jack, turned aside if that is taken) so the boule stays visible
    const BR = 0.075 * K, badges = [];
    const taken = [{ x: jack.x, y: jack.y, r: (jack.r || 0.015) + 0.02 }];
    for (const q of o.others || []) taken.push({ x: q.x, y: q.y, r: (q.r || 0.037) + 0.01 });
    for (const it of o.items) {
      const away = Math.atan2(it.y - jack.y, it.x - jack.x), d = (it.r || 0.037) + BR + 0.012;
      let best = null, bm = -Infinity;
      for (let k = 0; k < 12; k++) {
        const ang = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6, x = it.x + Math.cos(ang) * d, y = it.y + Math.sin(ang) * d;
        let m = Infinity;
        for (const q of taken) if (!(Math.abs(q.x - it.x) < 1e-6 && Math.abs(q.y - it.y) < 1e-6)) m = Math.min(m, Math.hypot(x - q.x, y - q.y) - q.r - BR);
        for (const q of badges) m = Math.min(m, Math.hypot(x - q.x, y - q.y) - 2 * BR);
        m -= k * 0.004; // prefer straight away
        if (m > bm) { bm = m; best = { x, y }; }
        if (m >= 0 && k === 0) break;
      }
      badges.push(best);
      pts.push({ x: best.x - BR, y: best.y - BR }, { x: best.x + BR, y: best.y + BR });
      const spr = badgeSprite(String(it.n), o.edge, '#fff'); spr.scale.multiplyScalar(K);
      spr.position.set(best.x, best.y, terrain.sample(best.x, best.y).h + 0.09);
      scoring.add(spr);
    }
    // E32: a distance label for every scoring boule and the rival, as screen-aligned boxes kept off each other,
    // the badges, the jack and every boule (D07's avoidance, in box form so it holds from a top-down view)
    const LW = 0.25 * K, LH = 0.085 * K, jr = jack.r || 0.015;
    const hits = [{ x: jack.x, y: jack.y, r: jr + 0.01 }];
    for (const q of o.others || []) hits.push({ x: q.x, y: q.y, r: (q.r || 0.037) + 0.005 });
    for (const q of badges) hits.push({ x: q.x, y: q.y, r: BR }); // badge
    const boxes = []; // placed label boxes, centres
    const clashBox = (cx, cy) => {
      for (const q of hits) { // box against circle
        const dx = Math.max(Math.abs(cx - q.x) - LW / 2, 0), dy = Math.max(Math.abs(cy - q.y) - LH / 2, 0);
        if (dx * dx + dy * dy < q.r * q.r) return true;
      }
      if (obst && obst(cx, cy, LW / 2, LH / 2)) return true; // F22: under the result card
      return boxes.some((b) => Math.abs(b.x - cx) < LW + 0.01 && Math.abs(b.y - cy) < LH + 0.01);
    };
    const placeLabel = (b, text, bg, border) => {
      const r = b.r || 0.037, away = Math.atan2(b.y - jack.y, b.x - jack.x), cands = [];
      for (let k = 0; k < 16; k++) { // fan out from straight away from the jack, alternating sides
        const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
        const ux = Math.cos(a), uy = Math.sin(a), t = r + 0.03 + Math.abs(ux) * LW / 2 + Math.abs(uy) * LH / 2;
        cands.push({ x: b.x + ux * t, y: b.y + uy * t });
      }
      let pick = cands.find((c) => !clashBox(c.x, c.y));
      if (!pick) { // nothing clear: take the candidate furthest from everything
        let bm = -Infinity;
        for (const c of cands) {
          let m = Infinity;
          for (const q of hits) m = Math.min(m, Math.hypot(c.x - q.x, c.y - q.y) - q.r);
          for (const q of boxes) m = Math.min(m, Math.hypot(c.x - q.x, c.y - q.y) - 0.1);
          if (m > bm) { bm = m; pick = c; }
        }
      }
      boxes.push({ x: pick.x, y: pick.y });
      pts.push({ x: pick.x - LW / 2, y: pick.y - LH / 2 }, { x: pick.x + LW / 2, y: pick.y + LH / 2 });
      const spr = labelSprite(text, '#fff', bg, border); spr.scale.multiplyScalar(K);
      spr.position.set(pick.x, pick.y, terrain.sample(pick.x, pick.y).h + 0.1);
      scoring.add(spr);
    };
    for (const it of o.items) if (it.label) placeLabel(it, it.label, o.dark, o.color);
    if (o.rival && o.rival.label) placeLabel(o.rival, o.rival.label, 'rgba(110,110,110,0.88)', '#e8e8e8');
    return { pts };
  }
  // F22: frame the whole scoring view (circle, boules, badges, labels) into the screen region the HUD and the result card
  // leave free. measure() -> { free: {l,t,r,b}, card: {l,t,r,b} | null } in canvas pixels. A near top-down camera at
  // elevation el; the target and distance are solved by projecting the content into the free box, and the labels are
  // re-placed with the card rect as an obstacle. Re-runs on resize.
  function fitScoring(measure, el = 1.5) {
    if (!scoringArgs) return;
    scoringFit = { measure, el };
    solveScoring(true);
  }
  function solveScoring(cut) {
    const { jack, o } = scoringArgs, { measure, el } = scoringFit;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const m = measure(), fr = m.free || { l: 0, t: 0, r: W, b: H };
    const cardH = m.card ? m.card.b - m.card.t : 0; // F62: a tall card lifts the centre
    const cam = camera.clone(); cam.aspect = W / H; cam.updateProjectionMatrix();
    const place = (tx, ty, dist) => {
      const gz = terrain.sample(tx, ty).h;
      cam.position.set(tx, ty - court.dir * Math.cos(el) * dist, gz + Math.sin(el) * dist);
      cam.up.set(0, 0, 1); cam.lookAt(tx, ty, gz); cam.updateMatrixWorld(true);
    };
    const v = new THREE.Vector3();
    const px = (x, y) => { v.set(x, y, terrain.sample(x, y).h).project(cam); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
    const bounds = (pts) => {
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const p of pts) { const q = px(p.x, p.y); l = Math.min(l, q.x); r = Math.max(r, q.x); t = Math.min(t, q.y); b = Math.max(b, q.y); }
      return { l, t, r, b };
    };
    const hitsCard = (cx, cy, hw, hh) => {
      if (!m.card) return false;
      const c = m.card, g = 8;
      const xs = [], ys = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = px(cx + sx * hw, cy + sy * hh); xs.push(q.x); ys.push(q.y); }
      return Math.min(...xs) < c.r + g && Math.max(...xs) > c.l - g && Math.min(...ys) < c.b + g && Math.max(...ys) > c.t - g;
    };
    let tx = jack.x, ty = jack.y, dist = 1.4, pts = scoringArgs.pts || [{ x: jack.x, y: jack.y }];
    for (let pass = 0; pass < 3; pass++) { // labels depend on the camera and the camera on the labels
      place(tx, ty, dist);
      pts = buildScoring(jack, o, hitsCard).pts;
      for (let it = 0; it < 24; it++) {
        place(tx, ty, dist);
        const bb = bounds(pts), bw = bb.r - bb.l, bh = bb.b - bb.t;
        // F62: the box is centred in the free rectangle and the content fills ~76% of it, whatever the content's aspect
        const box = scoringTargetBox(fr, bw / Math.max(1, bh), { cardH, H });
        const s = Math.max(bw / (box.r - box.l), bh / (box.b - box.t));
        const dx = (box.l + box.r) / 2 - (bb.l + bb.r) / 2, dy = (box.t + box.b) / 2 - (bb.t + bb.b) / 2;
        if (Math.abs(s - 1) < 0.01 && Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        // shift the target by the measured screen response of a 0.1 m step in x and y
        const c0 = px(tx, ty), cx = px(tx + 0.1, ty), cy = px(tx, ty + 0.1);
        const a = (cx.x - c0.x) / 0.1, b = (cy.x - c0.x) / 0.1, c = (cx.y - c0.y) / 0.1, d = (cy.y - c0.y) / 0.1, det = a * d - b * c || 1e-6;
        // want the content to move by (dx, dy): move the target the other way
        tx -= (d * dx - b * dy) / det * 0.8; ty -= (-c * dx + a * dy) / det * 0.8;
        dist = Math.max(0.35, Math.min(16, dist * (s > 1 ? s : Math.max(s, 0.9)) ** 0.9));
      }
    }
    scoringArgs.pts = pts;
    const fitOpts = { now: true, target: { x: jack.x, y: jack.y }, exact: { x: tx, y: ty, dist }, el };
    if (cut) setCamera('head', fitOpts); else { opts = fitOpts; computeGoal(0, true); cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt); trans = 1; } // F62: a resize re-fit lands at once, a transition in flight must not pull it back
  }
  function labelSprite(text, color, bg, border) {
    const cv = makeCanvas(160, 64), g = cv.getContext('2d');
    let px = 38;
    g.font = `700 ${px}px system-ui, sans-serif`;
    while (px > 24 && g.measureText(text).width > 132) { px -= 2; g.font = `700 ${px}px system-ui, sans-serif`; } // E32: "21.6 cm" must fit
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = bg || 'rgba(20,40,75,0.82)';
    g.beginPath(); g.roundRect(6, 8, 148, 48, 12); g.fill();
    if (border) { g.lineWidth = 4; g.strokeStyle = border; g.stroke(); }
    g.fillStyle = color;
    g.fillText(text, 80, 33);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, fog: false }));
    spr.renderOrder = 5;
    spr.scale.set(0.27, 0.108, 1);
    return spr;
  }
  // Between throws (D07): ribbons from the jack's edge to the closest boule of each team, with team-coloured cm labels
  // items: [{ x, y, r, label, color, dark }]; jack: { x, y, r }; others: [{ x, y }] every other live boule, which a label
  // must stay clear of. The label sits beyond its boule, away from the jack, unless that lands on a neighbour or on
  // the other label, in which case the nearest clear direction round the boule is used.
  function showMeasure(jack, items, others = []) {
    scoringFit = null; scoringArgs = null;
    clearMeasure();
    const jz = terrain.sample(jack.x, jack.y).h;
    const taken = []; // centres of labels already placed
    for (const it of items) {
      const under = groundRibbon(jack, it, jack.r || 0.015, it.r || 0.037, 0.05, '#000000', 0.5, 0.014, 4);
      const line = groundRibbon(jack, it, jack.r || 0.015, it.r || 0.037, 0.032, it.color, 1, 0.017, 5);
      if (under) measure.add(under);
      if (line) measure.add(line);
      const spr = labelSprite(it.label, '#fff', it.dark);
      const r = it.r || 0.037, off = r + 0.04, mid = off + 0.11; // mid: roughly where the label's middle ends up
      const a0 = Math.atan2(it.y - jack.y, it.x - jack.x);
      const clear = (a) => { // distance from the label's middle to the nearest thing it could cover
        const cx = it.x + Math.cos(a) * mid, cy = it.y + Math.sin(a) * mid;
        let m = Math.hypot(cx - jack.x, cy - jack.y) - 0.1;
        for (const q of others) if (q.x !== it.x || q.y !== it.y) m = Math.min(m, Math.hypot(cx - q.x, cy - q.y));
        for (const q of taken) m = Math.min(m, Math.hypot(cx - q.x, cy - q.y) - 0.1);
        return m;
      };
      let best = a0, bestM = clear(a0);
      for (const da of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
        if (bestM >= 0.17) break;
        const m = clear(a0 + da) - Math.abs(da) * 0.01;
        if (m > bestM) { bestM = m; best = a0 + da; }
      }
      const ux = Math.cos(best), uy = Math.sin(best);
      taken.push({ x: it.x + ux * mid, y: it.y + uy * mid });
      spr.center.set(0.5 - 0.5 * Math.max(-1, Math.min(1, ux * 1.6)), 0.5 - 0.5 * Math.max(-1, Math.min(1, uy * 1.6)));
      spr.position.set(it.x + ux * off, it.y + uy * off, Math.max(jz, terrain.sample(it.x, it.y).h) + 0.06);
      measure.add(spr);
    }
  }

  // Placeholder players: capsule body (1.7 m with the head) and a nose marking the facing direction
  const playerMats = [
    new THREE.MeshStandardMaterial({ color: '#46618f', metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6 }), // navy-steel
    new THREE.MeshStandardMaterial({ color: '#b8793a', metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6 }), // bronze
  ];
  const skinMat = new THREE.MeshStandardMaterial({ color: '#d9b393', roughness: 0.8, metalness: 0 });
  const bodyGeo = new THREE.CapsuleGeometry(0.17, 1.14, 4, 14);
  bodyGeo.rotateX(Math.PI / 2); // capsule axis along z
  bodyGeo.translate(0, 0, 0.74);
  const headGeo = new THREE.SphereGeometry(0.11, 18, 12);
  headGeo.translate(0, 0, 1.59);
  const noseGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);
  noseGeo.translate(0, 0.12, 1.6);
  const playerMeshes = new Map(); // id -> { group, team }
  function setPlayers(list = []) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      const team = p.team ? 1 : 0;
      let e = playerMeshes.get(p.id);
      if (e && e.team !== team) { scene.remove(e.group); playerMeshes.delete(p.id); e = null; }
      if (!e) {
        const g = new THREE.Group();
        for (const [geo, mat] of [[bodyGeo, playerMats[team]], [headGeo, skinMat], [noseGeo, skinMat]]) {
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
        }
        scene.add(g);
        e = { group: g, team };
        playerMeshes.set(p.id, e);
      }
      e.group.position.set(p.x, p.y, terrain.sample(p.x, p.y).h);
      e.group.rotation.z = -(p.yaw || 0); // yaw 0 faces +y, positive toward +x
    }
    for (const [id, e] of playerMeshes) {
      if (seen.has(id)) continue;
      scene.remove(e.group);
      playerMeshes.delete(id);
    }
  }

  // Throw preview: camera-facing ribbons (rebuilt per frame from cached points, buffers reused),
  // dotted roll guide, donnée ring, optional legal-zone arcs
  function makeRibbon(cap, mat, order) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 6), ix = new Uint16Array((cap - 1) * 6);
    for (let i = 0; i < cap - 1; i++) ix.set([2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2], i * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(ix, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, pos, cap, n: 0, pts: new Float32Array(cap * 3), k: 0.003 };
  }
  // pts: [{x,y,z}], ground: drape on the terrain
  function setRibbonPath(r, pts, ground, close) {
    let n = 0;
    if (pts && pts.length > 1) {
      const m = Math.min(pts.length, r.cap - 1);
      for (let i = 0; i < m; i++) {
        const q = pts[i];
        r.pts[n * 3] = q.x; r.pts[n * 3 + 1] = q.y;
        r.pts[n * 3 + 2] = ground ? surfH(q.x, q.y) + 0.012 : q.z;
        n++;
      }
      if (close && n < r.cap && Math.hypot(pts[0].x - pts[m - 1].x, pts[0].y - pts[m - 1].y) > 1e-3) {
        r.pts.copyWithin(n * 3, 0, 3); n++;
      }
    }
    r.n = n;
    r.mesh.visible = n > 1;
  }
  function updateRibbon(r, cam) {
    const n = r.n, p = r.pts, o = r.pos;
    if (n < 2) return;
    let sx = 0, sy = 0, sz = 1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tx = p[b * 3] - p[a * 3], ty = p[b * 3 + 1] - p[a * 3 + 1], tz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = cam.x - p[i * 3], vy = cam.y - p[i * 3 + 1], vz = cam.z - p[i * 3 + 2];
      let cx = ty * vz - tz * vy, cy = tz * vx - tx * vz, cz = tx * vy - ty * vx;
      const l = Math.hypot(cx, cy, cz);
      if (l > 1e-9) { sx = cx / l; sy = cy / l; sz = cz / l; }
      const w = r.k * Math.hypot(vx, vy, vz);
      o[i * 6] = p[i * 3] - sx * w; o[i * 6 + 1] = p[i * 3 + 1] - sy * w; o[i * 6 + 2] = p[i * 3 + 2] - sz * w;
      o[i * 6 + 3] = p[i * 3] + sx * w; o[i * 6 + 4] = p[i * 3 + 1] + sy * w; o[i * 6 + 5] = p[i * 3 + 2] + sz * w;
    }
    r.mesh.geometry.attributes.position.needsUpdate = true;
    r.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }
  const ribbonMat = (color, opacity, offset = -2) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
  const CREAM = '#fff1c2', RED = '#c0262f', CONE = '#bff0ff';
  const ribbons = {
    centerOutline: makeRibbon(64, ribbonMat('#241608', 0.85, 0), 10),
    center: makeRibbon(64, ribbonMat(CREAM, 1, -3), 11),
    edgeOutlines: [0, 1, 2, 3].map(() => makeRibbon(64, ribbonMat('#241608', 0.45, 0), 8)),
    edges: [0, 1, 2, 3].map(() => makeRibbon(64, ribbonMat(CONE, 0.9, -1), 9)),
    e1Outline: makeRibbon(160, ribbonMat('#241608', 0.7, 0), 8),
    e1: makeRibbon(160, ribbonMat(CONE, 1, -3), 9),
    e2Outline: makeRibbon(160, ribbonMat('#241608', 0.45, 0), 7),
    e2: makeRibbon(160, ribbonMat(CONE, 0.9, -2), 8),
  };
  ribbons.center.k = 0.0026; ribbons.centerOutline.k = 0.0042;
  for (const r of ribbons.edges) r.k = 0.0017;
  for (const r of ribbons.edgeOutlines) r.k = 0.0029;
  ribbons.e1.k = 0.0032; ribbons.e1Outline.k = 0.0048; ribbons.e2.k = 0.0022; ribbons.e2Outline.k = 0.0036;
  const allRibbons = [ribbons.centerOutline, ribbons.center, ...ribbons.edges, ...ribbons.edgeOutlines,
    ribbons.e1Outline, ribbons.e1, ribbons.e2Outline, ribbons.e2];

  // Cone surface: a translucent elliptical tube around the nominal arc whose cross-section grows toward the
  // landing (lateral half-width = 2 sigma, vertical half-height from the longitudinal error), alpha rising
  // toward the landing. Rebuilt per preview from the envelope arcs, so it is exactly the drawn cone.
  const TUBE_N = 41, TUBE_SIDES = 16;
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(CONE) } },
    vertexShader: 'attribute float aAlpha; varying float vA; void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA); }',
  });
  const coneGeo = new THREE.BufferGeometry();
  const conePos = new Float32Array(TUBE_N * TUBE_SIDES * 3), coneAlpha = new Float32Array(TUBE_N * TUBE_SIDES);
  {
    const ix = [];
    for (let i = 0; i < TUBE_N - 1; i++) {
      for (let j = 0; j < TUBE_SIDES; j++) {
        const a0 = i * TUBE_SIDES + j, a1 = i * TUBE_SIDES + (j + 1) % TUBE_SIDES, b0 = a0 + TUBE_SIDES, b1 = a1 + TUBE_SIDES;
        ix.push(a0, b0, b1, a0, b1, a1);
      }
    }
    coneGeo.setAttribute('position', new THREE.BufferAttribute(conePos, 3));
    coneGeo.setAttribute('aAlpha', new THREE.BufferAttribute(coneAlpha, 1));
    coneGeo.setIndex(ix);
  }
  const coneMesh = new THREE.Mesh(coneGeo, coneMat);
  coneMesh.frustumCulled = false; coneMesh.renderOrder = 6; coneMesh.visible = false;
  scene.add(coneMesh);
  const CONE_K = 2; // the cone is drawn at 2 sigma (about 86% of landings fall inside the ground ellipse)
  // Fill the tube from the preview's centre arc and its four +-1 sigma arcs; returns the four 2-sigma edge
  // paths (lateral +/-, vertical +/-) so the outline ribbons coincide with the surface.
  function buildCone(center, edges) {
    const n = center.length, sides = [[], [], [], []];
    if (!edges || edges.length < 4 || n < 3) return null;
    const m = Math.min(n, TUBE_N);
    for (let i = 0; i < TUBE_N; i++) {
      const q = Math.min(i, m - 1);
      const c = center[q], pa = center[Math.max(0, q - 1)], pb = center[Math.min(n - 1, q + 1)];
      let tx = pb.x - pa.x, ty = pb.y - pa.y, tz = pb.z - pa.z;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const rem = (vx, vy, vz) => { const d = vx * tx + vy * ty + vz * tz; return [vx - d * tx, vy - d * ty, vz - d * tz]; };
      const l = rem((edges[0][q].x - edges[1][q].x) / 2, (edges[0][q].y - edges[1][q].y) / 2, (edges[0][q].z - edges[1][q].z) / 2);
      // vertical direction of the section: t x l, flipped to point up
      let nx = ty * l[2] - tz * l[1], ny = tz * l[0] - tx * l[2], nz = tx * l[1] - ty * l[0];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const w = rem((edges[2][q].x - edges[3][q].x) / 2, (edges[2][q].y - edges[3][q].y) / 2, (edges[2][q].z - edges[3][q].z) / 2);
      const la = Math.hypot(l[0], l[1], l[2]) * CONE_K;
      const lb = Math.abs(w[0] * nx + w[1] * ny + w[2] * nz) * CONE_K;
      const b = Math.max(lb, 0.8 * la); // never thinner than 0.8 of the width, so it reads as a cone from behind
      const f = q / (m - 1);
      for (let j = 0; j < TUBE_SIDES; j++) {
        const th = j / TUBE_SIDES * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const o = (i * TUBE_SIDES + j) * 3;
        conePos[o] = c.x + cs * l[0] * CONE_K + sn * nx * b;
        conePos[o + 1] = c.y + cs * l[1] * CONE_K + sn * ny * b;
        conePos[o + 2] = c.z + cs * l[2] * CONE_K + sn * nz * b;
        coneAlpha[i * TUBE_SIDES + j] = 0.04 + 0.26 * f * f;
      }
      const pt = (th) => ({ x: c.x + Math.cos(th) * l[0] * CONE_K + Math.sin(th) * nx * b, y: c.y + Math.cos(th) * l[1] * CONE_K + Math.sin(th) * ny * b, z: c.z + Math.cos(th) * l[2] * CONE_K + Math.sin(th) * nz * b });
      if (i < m) { sides[0].push(pt(0)); sides[1].push(pt(Math.PI)); sides[2].push(pt(Math.PI / 2)); sides[3].push(pt(-Math.PI / 2)); }
    }
    coneGeo.attributes.position.needsUpdate = true;
    coneGeo.attributes.aAlpha.needsUpdate = true;
    return sides;
  }

  // Filled ground ellipses (triangle fans draped on the terrain)
  function makeFan(color, opacity, order, cap = 64) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((cap + 1) * 3), ix = [];
    for (let i = 0; i < cap; i++) ix.push(0, 1 + i, 1 + (i + 1) % cap);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(ix);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    mesh.frustumCulled = false; mesh.renderOrder = order; mesh.visible = false;
    scene.add(mesh);
    return { mesh, pos, cap };
  }
  const fans = { e2: makeFan(CONE, 0.28, 5), e1: makeFan(CONE, 0.5, 6) };
  function setFan(f, pts) {
    if (!pts || pts.length < 4) { f.mesh.visible = false; return; }
    const m = pts.length - 1; // the closing point repeats the first
    let cx = 0, cy = 0;
    for (let i = 0; i < m; i++) { cx += pts[i].x / m; cy += pts[i].y / m; }
    f.pos[0] = cx; f.pos[1] = cy; f.pos[2] = surfH(cx, cy) + 0.01;
    for (let i = 0; i < f.cap; i++) {
      const q = pts[Math.min(m - 1, Math.round(i * m / f.cap))];
      f.pos[3 + i * 3] = q.x; f.pos[4 + i * 3] = q.y; f.pos[5 + i * 3] = surfH(q.x, q.y) + 0.01;
    }
    f.mesh.geometry.attributes.position.needsUpdate = true;
    f.mesh.visible = true;
  }

  // Roll guide (D21): a soft translucent orange band on the ground that widens toward the rest point, a dashed centre
  // line (dark under-layer, bright orange on top) and a faint rest ellipse. Orange so it is never mistaken for the blue cone.
  const DASHES = 160, DASH_LEN = 0.3, DASH_GAP = 0.25, DASH_W = 0.05;
  const dashMat = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const dashGeo = new THREE.PlaneGeometry(1, 1);
  const dashBack = new THREE.InstancedMesh(dashGeo, dashMat('#241608', 0.75), DASHES);
  const dashTop = new THREE.InstancedMesh(dashGeo, dashMat('#ffae2b', 1), DASHES);
  // rest ellipse: a unit ring and fill in a group that is laid on the ground, rotated and scaled per band
  const restGroup = new THREE.Group(), restInner = new THREE.Group();
  for (const [geo, color, op, order] of [[new THREE.CircleGeometry(1, 40), '#ffae2b', 0.16, 11], [new THREE.RingGeometry(0.9, 1, 40), '#241608', 0.35, 12], [new THREE.RingGeometry(0.93, 0.985, 40), '#ffae2b', 0.7, 13]]) {
    const m = new THREE.Mesh(geo, dashMat(color, op)); m.renderOrder = order; m.frustumCulled = false; restInner.add(m);
  }
  restGroup.add(restInner); restGroup.visible = false; scene.add(restGroup);
  // the band: three nested ground strips (widest faintest) so it fades toward its edges
  const BAND_N = 40, BAND_LAYERS = [[1, 0.2], [0.66, 0.2], [0.33, 0.2]];
  const bandStrips = BAND_LAYERS.map(([w, op], li) => {
    const geo = new THREE.BufferGeometry(), ix = [];
    for (let i = 0; i < BAND_N - 1; i++) ix.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
    const pos = new Float32Array(BAND_N * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(ix); geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, dashMat('#ffae2b', op));
    mesh.frustumCulled = false; mesh.renderOrder = 9 + li; mesh.visible = false; scene.add(mesh);
    return { mesh, pos, w };
  });
  for (const [o, order] of [[dashBack, 13], [dashTop, 14]]) {
    o.frustumCulled = false; o.renderOrder = order; o.visible = false; scene.add(o);
  }
  dashBack.count = dashTop.count = 0;
  const dM = new THREE.Matrix4(), dPos = new THREE.Vector3(), dX = new THREE.Vector3(), dY = new THREE.Vector3(), dZ = new THREE.Vector3();
  // `band`: { center: [{x,y,z}], halfWidths, restMean, restCov } from predictRollBand (a bare point list also works)
  function setRoll(band) {
    let n = 0;
    restGroup.visible = false;
    for (const st of bandStrips) st.mesh.visible = false;
    if (Array.isArray(band)) { // plain path: a narrow band with no spread
      const m = band.length;
      band = { center: band, halfWidths: band.map((_, i) => 0.04 + 0.06 * i / Math.max(1, m - 1)), restMean: band[m - 1], restCov: { xx: 0.003, xy: 0, yy: 0.003 } };
    }
    const pts = band && band.center;
    if (pts && pts.length > 1) {
      // the band: perpendicular offsets of each centre point, widened to read from the shoulder view
      const m = Math.min(pts.length, BAND_N);
      for (const st of bandStrips) {
        for (let i = 0; i < m; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
          let tx = b.x - a.x, ty = b.y - a.y;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const hw = Math.max(0.16, (band.halfWidths[i] || 0.05) * 2.5) * st.w;
          for (let sd = 0; sd < 2; sd++) {
            const k = sd ? -1 : 1, x = pts[i].x - ty * hw * k, y = pts[i].y + tx * hw * k;
            const o = (i * 2 + sd) * 3;
            st.pos[o] = x; st.pos[o + 1] = y; st.pos[o + 2] = surfH(x, y) + 0.014;
          }
        }
        st.mesh.geometry.attributes.position.needsUpdate = true;
        st.mesh.geometry.setDrawRange(0, (m - 1) * 6);
        st.mesh.visible = true;
      }
      // walk the path by arc length, laying a dash every DASH_LEN + DASH_GAP
      let pos = 0; // distance along the path to the start of the next dash
      let acc = 0; // path length so far
      for (let i = 1; i < pts.length && n < DASHES; i++) {
        const a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg < 1e-6) continue;
        while (pos < acc + seg && n < DASHES) {
          const mid = pos + DASH_LEN / 2;
          const t = Math.max(0, Math.min(1, (mid - acc) / seg));
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          const h = terrain.sample(x, y);
          dZ.set(h.nx || 0, h.ny || 0, h.nz || 1).normalize();
          dX.set((b.x - a.x) / seg, (b.y - a.y) / seg, 0);
          dX.addScaledVector(dZ, -dX.dot(dZ)).normalize();
          dY.crossVectors(dZ, dX);
          dPos.set(x, y, h.h + 0.016);
          dM.makeBasis(dX.clone().multiplyScalar(DASH_LEN), dY.clone().multiplyScalar(DASH_W), dZ);
          dM.setPosition(dPos);
          dashTop.setMatrixAt(n, dM);
          dM.makeBasis(dX.clone().multiplyScalar(DASH_LEN + 0.03), dY.clone().multiplyScalar(DASH_W + 0.035), dZ);
          dM.setPosition(dPos);
          dashBack.setMatrixAt(n, dM);
          n++;
          pos += DASH_LEN + DASH_GAP;
        }
        acc += seg;
      }
      // rest ellipse at 1.5 sigma along the principal axes of the rest covariance
      const e = band.restMean || pts[pts.length - 1], h = terrain.sample(e.x, e.y), c = band.restCov;
      const tr = (c.xx + c.yy) / 2, df = Math.sqrt(((c.xx - c.yy) / 2) ** 2 + c.xy * c.xy);
      const l1 = Math.max(0.0036, tr + df), l2 = Math.max(0.0036, tr - df);
      restGroup.position.set(e.x, e.y, h.h + 0.018);
      restGroup.quaternion.setFromUnitVectors(upZ, dZ.set(h.nx || 0, h.ny || 0, h.nz || 1).normalize());
      restInner.rotation.z = 0.5 * Math.atan2(2 * c.xy, c.xx - c.yy);
      restInner.scale.set(Math.max(0.14, 1.5 * Math.sqrt(l1)), Math.max(0.14, 1.5 * Math.sqrt(l2)), 1);
      restGroup.visible = true;
    }
    dashTop.count = dashBack.count = n;
    dashTop.instanceMatrix.needsUpdate = dashBack.instanceMatrix.needsUpdate = true;
    dashTop.visible = dashBack.visible = n > 0;
  }

  // donnée marker: ring on the ground; snapped adds a bold red ring and ticks
  const marker = new THREE.Group();
  marker.visible = false;
  const mkMat = (color, op = 1) => new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, side: THREE.DoubleSide, fog: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const plainRing = new THREE.Group();
  const snapRing = new THREE.Group();
  {
    const add = (g, geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; g.add(m); return m; };
    // small, so it never hides the 1 sigma ellipse (about 0.2 x 0.6 m at 8 m)
    add(plainRing, new THREE.RingGeometry(0.035, 0.09, 32), mkMat('#241608', 0.85), 12);
    add(plainRing, new THREE.RingGeometry(0.05, 0.075, 32), mkMat(CREAM), 13);
    add(snapRing, new THREE.RingGeometry(0.17, 0.3, 40), mkMat('#241608', 0.8), 12);
    add(snapRing, new THREE.RingGeometry(0.2, 0.27, 40), mkMat(RED), 13);
    for (let k = 0; k < 4; k++) {
      const t = add(snapRing, new THREE.PlaneGeometry(0.06, 0.2), mkMat(RED), 13);
      const a = k * Math.PI / 2;
      t.position.set(Math.sin(a) * 0.27, Math.cos(a) * 0.27, 0);
      t.rotation.z = -a;
    }
    marker.add(plainRing, snapRing);
  }
  scene.add(marker);
  const upZ = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3();

  let preview = null, previewApex = 0;
  function setThrowPreview(p) {
    preview = p || null;
    previewApex = p && p.center ? Math.max(0, ...p.center.map((q) => q.z)) : 0;
    if (!p) {
      for (const r of allRibbons) { r.n = 0; r.mesh.visible = false; }
      coneMesh.visible = false;
      fans.e1.mesh.visible = fans.e2.mesh.visible = false;
      setRoll(null);
      marker.visible = false;
      jackZone.visible = false;
      return;
    }
    setRibbonPath(ribbons.center, p.center, false);
    setRibbonPath(ribbons.centerOutline, p.center, false);
    const sides = p.center && p.edges ? buildCone(p.center, p.edges) : null;
    coneMesh.visible = !!sides;
    ribbons.edges.forEach((r, i) => setRibbonPath(r, sides ? sides[i] : p.edges && p.edges[i], false));
    ribbons.edgeOutlines.forEach((r, i) => setRibbonPath(r, sides ? sides[i] : p.edges && p.edges[i], false));
    setFan(fans.e1, p.ellipse1);
    setFan(fans.e2, p.ellipse2);
    setRibbonPath(ribbons.e1, p.ellipse1, true, true);
    setRibbonPath(ribbons.e1Outline, p.ellipse1, true, true);
    setRibbonPath(ribbons.e2, p.ellipse2, true, true);
    setRibbonPath(ribbons.e2Outline, p.ellipse2, true, true);
    setRoll(p.roll);
    if (p.donnee) {
      const s = terrain.sample(p.donnee.x, p.donnee.y);
      marker.position.set(p.donnee.x, p.donnee.y, surfH(p.donnee.x, p.donnee.y) + 0.014); // F96: the mesh height, not the dented ground
      nrm.set(s.nx || 0, s.ny || 0, s.nz || 1).normalize();
      marker.quaternion.setFromUnitVectors(upZ, nrm);
      plainRing.visible = !p.snapped;
      snapRing.visible = !!p.snapped;
      marker.visible = !hides('decals');
    } else marker.visible = false;
    if (p.legalZone) jackZone.visible = true;
  }
  function updatePreview() {
    if (!preview) return;
    for (const r of allRibbons) updateRibbon(r, camera.position);
  }

  // Camera state
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cur = { pos: new THREE.Vector3(2, -2, 2), tgt: new THREE.Vector3(2, 8, 0) };
  const from = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const goal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  let mode = 'aim', opts = {}, trans = 1, zoom = 1;
  const ZOOM_MIN = 0.6, ZOOM_MAX = 1.6;
  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const orbit = { az: 0, el: 0.6, dist: 3 };
  let heading = new THREE.Vector3(0, 1, 0);
  let flightFrame = null; // camera.js spring state while the flight camera follows moving bodies
  let obsFrame = null; // E11: camera.js state of the casual-observer camera (kept while it stays in that mode)

  const camLog = dbgParam('camlog'); // F110: ?debug&camlog logs the camera pose per frame and each setCamera (console)
  let blend = null, fovEase = false; // F110: the aim to follow switch: null | 'start' (first frame) | camera.js blend state; fovEase eases the field of view with it
  let bcFrame = null; // F01: camera.js state of the current broadcast shot (a new shot is a cut)
  let tvFrame = null, tvPending = null; // E27: the TV shot's state, and a camera request held until the shot has played out
  function setCamera(m, o = {}, flush = false) {
    if (mode === 'tv' && m !== 'tv' && m !== 'flight' && !flush && !o.now) { // let the boule settle on screen before the next cut
      if (tvFrame && tvFrame.restT < (TV.hold[tvFrame.variant] || 0) && !reduce()) { tvPending = [m, o]; return; }
    }
    tvPending = null;
    const cutIn = m === 'tv' || mode === 'tv' || m === 'broadcast' || !!o.cut; // TV style cuts: no glide into or out of the shot
    if (m === 'tv') tvFrame = null;
    if (m === 'broadcast') bcFrame = null;
    if (m === 'inspect' && (mode !== 'inspect' || o.reset)) { // o.reset: a scripted cut replaces the user's orbit
      orbit.dist = o.dist || 2.5;
      orbit.az = o.az !== undefined ? o.az : 0;
      orbit.el = o.el !== undefined ? o.el : 0.6;
    }
    if (m === 'shoulder' && o.zoom !== undefined) zoom = clampZoom(o.zoom);
    if (m === 'observer' && mode !== 'observer') obsFrame = null; // a fresh spectator spot; later subjects only pan and dolly
    const wasAim = mode === 'shoulder' || mode === 'aim';
    if (camLog !== null) console.log('[camlog] setCamera ' + JSON.stringify({ from: mode, to: m, cut: !!o.cut, flush }));
    mode = m; opts = o;
    blend = null; fovEase = false;
    if (m === 'flight') flightFrame = null;
    if (m === 'flight' && o.bodies && wasAim && !cutIn && !reduce()) { blend = 'start'; fovEase = true; } // F110: no copy of the follow pose: the camera keeps its pose and the offset decays (reduced motion keeps the cut)
    from.pos.copy(cur.pos); from.tgt.copy(cur.tgt);
    trans = reduce() || cutIn || blend ? 1 : 0; // F110: a blend replaces the timed lerp
    if (trans === 1) computeGoal(0, true);
  }

  function groundZ(t) { return terrain.sample(t.x, t.y).h; }

  function computeGoal(dt) {
    if (mode === 'aim') {
      const yaw = opts.yaw || 0, c = court.circle;
      goal.pos.set(c.x - Math.sin(yaw) * 1.4, c.y - Math.cos(yaw) * 1.4, 1.6);
      goal.tgt.set(c.x + Math.sin(yaw) * 5.5, c.y + Math.cos(yaw) * 5.5, 0);
    } else if (mode === 'observer') { // E11: a spectator beside the court; opts.points (or moving opts.bodies) is what to watch
      let pts = opts.points || [];
      if (opts.bodies) {
        pts = gatherMoving(opts.bodies, opts.body).map((m) => ({ x: m.x, y: m.y, z: m.z }));
        const jk = opts.bodies.find((b) => b.kind === 'jack' && !b.dead);
        if (jk) pts.push({ x: jk.x, y: jk.y, z: 0 });
        if (!pts.length && opts.body) pts = [{ x: opts.body.x, y: opts.body.y, z: 0 }];
      }
      if (opts.target) pts = pts.concat([opts.target]);
      const f = frameObserver(pts, { aspect: camera.aspect, fov: camera.aspect < 1 ? 62 : 50, dt, reduced: reduce(), groundAt: (x, y) => terrain.sample(x, y).h, dir: court.dir }, obsFrame);
      obsFrame = f;
      goal.pos.set(f.pos.x, f.pos.y, f.pos.z);
      goal.tgt.set(f.tgt.x, f.tgt.y, f.tgt.z);
    } else if (mode === 'wide') { // F57: the whole court from behind the near end, Rainier in the background
      const f = frameCourtWide({ width: C.terrainW, length: C.terrainL, aspect: camera.aspect, fov: camera.aspect < 1 ? 62 : 50, groundAt: (x, y) => terrain.sample(x, y).h });
      goal.pos.set(f.pos.x, f.pos.y, f.pos.z);
      goal.tgt.set(f.tgt.x, f.tgt.y, f.tgt.z);
    } else if (mode === 'broadcast') { // F01: a director's shot (opts.shot: prep | throw | reaction | flight)
      const jk = opts.bodies && opts.bodies.find((b) => b.kind === 'jack' && !b.dead);
      const sub = opts.subject;
      const face = opts.face !== undefined ? opts.face : opts.faceTo && sub ? Math.atan2(opts.faceTo.x - sub.x, opts.faceTo.y - sub.y) : undefined;
      const f = frameBroadcast(opts.shot, { subject: sub, face, body: opts.body, jack: jk, dir: court.dir, dt, reduced: reduce(), groundAt: (x, y) => terrain.sample(x, y).h, aspect: camera.aspect, fov: camera.aspect < 1 ? 62 : 50 }, bcFrame);
      if (f) {
        bcFrame = f;
        goal.pos.set(f.pos.x, f.pos.y, f.pos.z);
        goal.tgt.set(f.tgt.x, f.tgt.y, f.tgt.z);
      }
    } else if (mode === 'tv') { // E27: a TV-style shot of an AI throw
      const jk = opts.bodies && opts.bodies.find((b) => b.kind === 'jack' && !b.dead);
      const f = frameTV(tvVariant(opts.variant) || 'a', { body: opts.body, jack: jk, dir: court.dir, dt, reduced: reduce(), groundAt: (x, y) => terrain.sample(x, y).h, aspect: camera.aspect, fov: camera.aspect < 1 ? 62 : 50 }, tvFrame);
      if (f) {
        tvFrame = f;
        goal.pos.set(f.pos.x, f.pos.y, f.pos.z);
        goal.tgt.set(f.tgt.x, f.tgt.y, f.tgt.z);
      }
    } else if (mode === 'flight' && opts.bodies) { // D09: frame every moving body (camera.js), cochonnet first when it flies
      const jack = opts.bodies.find((b) => b.kind === 'jack');
      const f = frameMoving(opts.bodies, jack, { aspect: camera.aspect, fov: camera.fov, dt, reduced: reduce(), thrown: opts.body, dir: court.dir }, flightFrame);
      if (f) {
        flightFrame = f;
        const cf = cameraFromFrame(f, (x, y) => terrain.sample(x, y).h);
        goal.pos.set(cf.pos.x, cf.pos.y, cf.pos.z);
        goal.tgt.set(f.target.x, f.target.y, f.target.z);
      }
    } else if (mode === 'flight' && opts.body) {
      const b = opts.body;
      const v = tmpV.set(b.vx || 0, b.vy || 0, 0);
      if (v.lengthSq() > 0.25) heading.lerp(v.normalize(), Math.min(1, dt * 4)).normalize();
      goal.pos.set(b.x - heading.x * 2.6, b.y - heading.y * 2.6, Math.max(b.z, 0) + 1.1);
      goal.tgt.set(b.x + heading.x * 2.5, b.y + heading.y * 2.5, Math.max(0, b.z * 0.4));
    } else if (mode === 'head') {
      const t = opts.target || { x: 2, y: 8 };
      if (opts.exact) { // F22: a camera solved by fitScoring: target and distance given
        const e = opts.exact, el2 = opts.el || 1.38, gz = groundZ(e);
        goal.tgt.set(e.x, e.y, gz);
        goal.pos.set(e.x, e.y - court.dir * Math.cos(el2) * e.dist, gz + Math.sin(el2) * e.dist);
        return;
      }
      // frame the target plus any listed points (nearby live boules) with a margin
      let x0 = t.x, x1 = t.x, y0 = t.y, y1 = t.y;
      for (const p of opts.points || []) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const margin = opts.margin || 0.5, el = opts.el || 0.95; // rad of elevation (E32: near top-down at mène end)
      const minHalf = opts.minHalf || 0.9; // E17: wider default, the chooser view sat right on the gravel
      const hx = Math.max(minHalf, (x1 - x0) / 2 + margin), hy = Math.max(minHalf, (y1 - y0) / 2 + margin);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const dist = Math.max(opts.dist || 2.4, hx / Math.tan(hf / 2), (hy * Math.sin(el) + 0.1) / Math.tan(vf / 2) + hy * Math.cos(el)) * 1.05;
      const ly = cy - court.dir * (opts.lift || 0) * dist; // look nearer so the subject sits higher on screen (E10: the circle side)
      goal.tgt.set(cx, ly, groundZ({ x: cx, y: cy }));
      goal.pos.set(cx, ly - court.dir * Math.cos(el) * dist, goal.tgt.z + Math.sin(el) * dist);
    } else if (mode === 'shoulder') {
      // behind and to the right of the player, ~2.1 m up at zoom 1, looking ~7 m ahead and a little down
      const p = opts.player || court.circle, yaw = (opts.yaw || 0) + (opts.viewYaw || 0); // E12: view offset orbits the thrower
      const side = opts.hand === 'left' ? -1 : 1; // behind the left shoulder for a left-hander (mirrors the offsets)
      const fx = Math.sin(yaw), fy = Math.cos(yaw), rx = side * Math.cos(yaw), ry = -side * Math.sin(yaw);
      const gz = groundZ(p);
      const w = opts.wide || 1; // chibi mesh players are bulkier: stand the camera further back and up
      goal.pos.set(p.x - fx * 2.2 * zoom * w + rx * 1.1 * zoom * w, p.y - fy * 2.2 * zoom * w + ry * 1.1 * zoom * w, gz + (1.5 + 0.6 * zoom) * w);
      goal.tgt.set(p.x + fx * 7 - rx * 0.5, p.y + fy * 7 - ry * 0.5, gz - 0.7);
      if (opts.viewPitch) { // E12: positive pitch looks down from higher up, negative looks level from lower
        goal.pos.z += opts.viewPitch * 3 * zoom * w; goal.tgt.z -= Math.tan(opts.viewPitch) * 7 * 0.6;
      }
      if (focusK > 0 && preview && preview.donnee) { // while tossing, look toward the donnée (and zoom in a little)
        const d = preview.donnee, k = 0.6 * focusK;
        goal.tgt.x += (d.x - goal.tgt.x) * k; goal.tgt.y += (d.y - goal.tgt.y) * k;
        goal.tgt.z += (groundZ(d) - 0.2 - goal.tgt.z) * k;
        goal.tgt.z += Math.min(2.2, 0.3 * previewApex) * focusK; // tilt up so a high lob's apex stays in view
      }
    } else if (mode === 'inspect') {
      const t = opts.target || { x: 2, y: 8 };
      goal.tgt.set(t.x, t.y, groundZ(t) + 0.03 + (opts.height || 0));
      const ce = Math.cos(orbit.el), se = Math.sin(orbit.el);
      let dist = orbit.dist;
      if (opts.fit) { // opts.fit: half-width in metres that must stay in view (pulls back on narrow screens)
        const hf = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
        dist = Math.max(dist, opts.fit / Math.tan(hf / 2));
      }
      goal.pos.set(t.x + Math.sin(orbit.az) * ce * dist, t.y - Math.cos(orbit.az) * ce * dist, goal.tgt.z + se * dist);
    }
  }

  // Toss focus: 0..1, eased while the shoulder camera shows a preview, so the cone is bigger on screen
  let focusK = 0;
  // ---- Paused (D12): a free orbit camera round a ground point, and the sepia pass ----
  let paused = false;
  const PC = { P: new THREE.Vector3(), pos: new THREE.Vector3(), az: 0, el: 0.6, dist: 6 };
  const PC_DIST = [0.8, 30], PC_EL = [0.06, 1.5];
  const pcClamp = () => {
    PC.dist = Math.max(PC_DIST[0], Math.min(PC_DIST[1], PC.dist));
    PC.el = Math.max(PC_EL[0], Math.min(PC_EL[1], PC.el));
  };
  function setPaused(on) {
    on = !!on;
    if (on === paused) return;
    if (on) {
      // the orbit point: where the centre-screen ray meets the ground (else the point looked at)
      const dir = cur.tgt.clone().sub(cur.pos).normalize();
      const g0 = groundZ(cur.tgt);
      PC.P.copy(cur.tgt);
      if (dir.z < -0.03) { const k = (g0 - cur.pos.z) / dir.z; if (k > 0 && k < 80) PC.P.copy(cur.pos).addScaledVector(dir, k); }
      PC.P.x = Math.max(-C.terrainPad, Math.min(C.terrainW + C.terrainPad, PC.P.x)); // the court runs x 0..W, y 0..L
      PC.P.y = Math.max(-C.terrainPad, Math.min(C.terrainL + C.terrainPad, PC.P.y));
      PC.P.z = groundZ(PC.P) + 0.03;
      const off = cur.pos.clone().sub(PC.P);
      PC.dist = Math.max(0.01, off.length());
      PC.el = Math.asin(Math.max(-1, Math.min(1, off.z / PC.dist)));
      PC.az = Math.atan2(off.x, -off.y);
      pcClamp();
      pointers.clear(); pinch = 0;
      paused = true;
      sepiaTarget = 1;
      if (reduce()) sepiaK = 1;
    } else {
      paused = false;
      sepiaTarget = 0;
      if (reduce()) sepiaK = 0;
      from.pos.copy(PC.pos); from.tgt.copy(PC.P); // ease back to where the camera was before the pause
      trans = reduce() ? 1 : 0;
      pointers.clear(); pinch = 0;
    }
  }
  function updatePausedCamera() {
    pcClamp();
    const ce = Math.cos(PC.el), se = Math.sin(PC.el);
    PC.pos.set(PC.P.x + Math.sin(PC.az) * ce * PC.dist, PC.P.y - Math.cos(PC.az) * ce * PC.dist, PC.P.z + se * PC.dist);
    const floor = groundZ(PC.pos) + 0.25;
    if (PC.pos.z < floor) PC.pos.z = floor;
    camera.position.copy(PC.pos);
    camera.lookAt(PC.P);
    aimSun(PC.P);
  }

  // Sepia: while paused the scene is drawn to a target and a full-screen triangle redraws it in sepia
  let sepiaK = 0, sepiaTarget = 0, sepiaRT = null, sepiaT0 = 0;
  const sepiaScene = new THREE.Scene();
  const sepiaCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sepiaMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, k: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float k; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(tDiffuse, vUv);
        vec3 c = t.rgb;
        vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
        gl_FragColor = vec4(mix(c, s * 0.96, k), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  sepiaScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sepiaMat));
  sepiaScene.children[0].frustumCulled = false;
  function renderScene() {
    const now = performance.now(), sdt = Math.min(0.1, (now - sepiaT0) / 1000);
    sepiaT0 = now;
    if (!reduce() && sepiaK !== sepiaTarget) { // a short fade in and out, none under reduced motion
      const step = sdt / 0.35;
      sepiaK = sepiaTarget > sepiaK ? Math.min(sepiaTarget, sepiaK + step) : Math.max(sepiaTarget, sepiaK - step);
    } else if (reduce()) sepiaK = sepiaTarget;
    if (sepiaK <= 0 && !paused) { renderer.render(scene, camera); return; }
    const size = renderer.getDrawingBufferSize(tmpSize);
    if (!sepiaRT) sepiaRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.sepiaSamples });
    else if (sepiaRT.width !== size.x || sepiaRT.height !== size.y) sepiaRT.setSize(size.x, size.y);
    renderer.setRenderTarget(sepiaRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    sepiaMat.uniforms.tDiffuse.value = sepiaRT.texture;
    sepiaMat.uniforms.k.value = sepiaK;
    renderer.render(sepiaScene, sepiaCam);
  }
  const tmpSize = new THREE.Vector2();

  function updateCamera(dt) {
    dt = Math.max(0, dt); // a negative first frame (timer skew) must not run the transition backwards
    if (paused) { updatePausedCamera(); return; }
    const wantFocus = mode === 'shoulder' && preview && preview.donnee ? 1 : 0;
    focusK = reduce() ? wantFocus : focusK + (wantFocus - focusK) * (1 - Math.exp(-dt * 6));
    if (Math.abs(focusK - wantFocus) < 0.002) focusK = wantFocus;
    if (tvPending && (!tvFrame || reduce() || tvFrame.restT >= (TV.hold[tvFrame.variant] || 0))) { const [pm, po] = tvPending; setCamera(pm, po, true); }
    computeGoal(dt);
    const baseFov = camera.aspect < 1 ? 62 : 50;
    let fov = baseFov;
    if (focusK > 0 && preview && preview.donnee) {
      const d = Math.hypot(preview.donnee.x - court.circle.x, preview.donnee.y - court.circle.y);
      fov = baseFov * (1 - 0.32 * focusK * Math.max(0, Math.min(1, (d - 3) / 5)));
    }
    if (mode === 'observer' && obsFrame) fov *= obsFrame.fovK; // E11: the spectator's slow zoom
    if (fovEase) { if (Math.abs(fov - camera.fov) < 0.05) fovEase = false; else fov = camera.fov + (fov - camera.fov) * (1 - Math.exp(-dt / 0.12)); } // F110: the aim zoom eases out with the pose blend
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (blend) { // F110: aim to follow: the camera's own pose plus a decaying offset to the follow goal
      const g = { pos: goal.pos, tgt: goal.tgt };
      if (blend === 'start') blend = blendStart({ pos: cur.pos, tgt: cur.tgt }, g);
      const r = blendStep(blend, g, dt);
      blend = r.done ? null : r.b;
      cur.pos.set(r.pose.pos.x, r.pose.pos.y, r.pose.pos.z); cur.tgt.set(r.pose.tgt.x, r.pose.tgt.y, r.pose.tgt.z);
      if (!blend) { cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt); }
    } else if (trans < 1) {
      trans = Math.min(1, trans + dt / TRANSITION);
      const k = smooth(trans);
      cur.pos.lerpVectors(from.pos, goal.pos, k);
      cur.tgt.lerpVectors(from.tgt, goal.tgt, k);
    } else if (mode === 'flight' && !reduce() && !opts.bodies) {
      const k = 1 - Math.exp(-dt * 8);
      cur.pos.lerp(goal.pos, k);
      cur.tgt.lerp(goal.tgt, k);
    } else {
      cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt);
    }
    camera.position.copy(cur.pos);
    if (camLog !== null) console.log('[camlog] ' + JSON.stringify({ m: mode, t: +dt.toFixed(4), p: [cur.pos.x, cur.pos.y, cur.pos.z].map((v) => +v.toFixed(4)), g: [cur.tgt.x, cur.tgt.y, cur.tgt.z].map((v) => +v.toFixed(4)), f: +camera.fov.toFixed(3), gp: [goal.pos.x, goal.pos.y, goal.pos.z].map((v) => +v.toFixed(3)), gt: [goal.tgt.x, goal.tgt.y, goal.tgt.z].map((v) => +v.toFixed(3)) })); // F110: ?debug&camlog
    let lookAt = cur.tgt;
    camera.lookAt(lookAt);
    // shadow frustum follows what we look at
    aimSun(cur.tgt);
  }

  // Minimal orbit controls for inspect mode
  const pointers = new Map();
  let pinch = 0;
  const onDown = (e) => {
    if (paused) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      return;
    }
    if (mode !== 'inspect' && mode !== 'shoulder') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // shoulder mode only watches for a pinch; the toss input owns single-pointer gestures
    if (mode === 'inspect' && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (p && paused) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) { PC.az -= dx * 0.008; PC.el += dy * 0.008; }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) PC.dist *= pinch / d;
        pinch = d;
      }
      pcClamp();
      return;
    }
    if (!p || (mode !== 'inspect' && mode !== 'shoulder')) return;
    if (mode === 'shoulder') {
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) zoom = clampZoom(zoom * pinch / d);
        pinch = d;
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      orbit.az -= dx * 0.008;
      orbit.el = Math.max(0.08, Math.min(1.5, orbit.el + dy * 0.008));
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) orbit.dist = Math.max(0.4, Math.min(12, orbit.dist * pinch / d));
      pinch = d;
    }
  };
  const onUp = (e) => { pointers.delete(e.pointerId); pinch = 0; };
  const onWheel = (e) => {
    if (paused) { e.preventDefault(); PC.dist *= Math.exp(e.deltaY * 0.001); pcClamp(); return; }
    if (mode === 'shoulder') {
      e.preventDefault();
      zoom = clampZoom(zoom * Math.exp(e.deltaY * 0.001));
      return;
    }
    if (mode !== 'inspect') return;
    e.preventDefault();
    orbit.dist = Math.max(0.4, Math.min(12, orbit.dist * Math.exp(e.deltaY * 0.001)));
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioMax));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the court in view on tall (phone) screens
    camera.fov = camera.aspect < 1 ? 62 : 50;
    camera.updateProjectionMatrix();
    if (scoringFit && scoringArgs && mode === 'head' && opts.exact) solveScoring(false); // F22: re-fit the circle into the new free region
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(canvas); }
  resize();

  // F71: golden-hour drift. Colours and the sun move in steps of 0.01 of progress (a shadow-map hop of under a texel or
  // two each time, never per frame); the tree decals follow the direction at most every 2 s of render time.
  let dayAt = -1, dayD = null, treeDir = new THREE.Vector3().copy(sunOffset).normalize(), treeT = 99;
  const tmpC = new THREE.Color();
  const srgb = (a, out) => out.setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
  function applyDay(d) {
    sunOffset.set(d.sunDir[0], d.sunDir[1], d.sunDir[2]).multiplyScalar(SUN_DISTANCE);
    updateSunAxes();
    sun.color.copy(srgb(d.sunColor, tmpC)); sun.intensity = d.sunIntensity;
    hemi.color.copy(srgb(d.hemiSky, tmpC)); hemi.groundColor.copy(srgb(d.hemiGround, tmpC)); hemi.intensity = d.hemiIntensity;
    srgb(d.fogColor, FOG); scene.fog.color.copy(FOG); // scene.background is FOG itself; the Fog keeps its own copy
    paintSky(skyDome, FOG);
    panorama.userData.setDaylight(d);
  }
  function setDaylight(progress) {
    const p = Math.round(Math.max(0, Math.min(1, progress)) * 100) / 100;
    const d = daylightAt(progress);
    panorama.userData.setDaylight(d); // the alpenglow follows the smooth value
    if (p === dayAt) return;
    dayAt = p; dayD = daylightAt(p);
    applyDay({ ...dayD, alpenglow: d.alpenglow });
  }
  function updateTreeShadows(dt) {
    treeT += dt;
    if (treeT < 2) return;
    if (sunOffset.clone().normalize().angleTo(treeDir) < 0.004) return;
    treeDir.copy(sunOffset).normalize(); treeT = 0;
    treeShadows.userData.setSun(sunOffset);
  }
  setDaylight(0);
  treeT = 99; treeDir.set(0, 0, 1);

  function render(dt = 1 / 60) {
    dt = Math.min(dt, 0.1);
    updateTreeShadows(dt);
    // roll the boules from their angular velocity
    for (const e of meshes.values()) {
      const b = e.body, wl = Math.hypot(b.wx || 0, b.wy || 0, b.wz || 0);
      if (wl > 1e-4 && dt > 0) {
        tmpV.set(b.wx, b.wy, b.wz).divideScalar(wl);
        tmpQ.setFromAxisAngle(tmpV, wl * dt);
        e.mesh.quaternion.premultiply(tmpQ);
      }
    }
    tickRing(dt);
    if (dt > 0 && !reduce()) {
      swayT += dt;
      trees.children.forEach((t, i) => t.rotation.set(Math.sin(swayT * 0.55 + i * 1.9) * 0.011, Math.sin(swayT * 0.41 + i * 2.7) * 0.011, 0));
    }
    updateFades(dt);
    updateCamera(dt);
    if (!reduce()) lake.update(dt);
    floatplane.update(dt, camera, reduce());
    if (sailboats.group.visible) sailboats.update(dt, reduce(), floatplane, edgeZ); // F64 (F103: not when switched off)
    if (butterflies.group.visible) butterflies.update(dt, reduce(), butterflies.busy); // F67, F81
    clouds.update(dt, reduce()); // F68
    updatePreview();
    updateJackMark(dt);
    if (rankSrc) updateRankLabels(); // F91
    renderScene();
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(terrainMesh, false)[0];
    return hit ? { x: hit.point.x, y: hit.point.y } : null;
  }

  function dispose() {
    if (ro) ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    renderer.dispose();
  }

  // F103: apply a quality level (quality.js levelSettings). Cheap to call again; only what changed is redone.
  let q = { sepiaSamples: 4 };
  const hidesPlayers = hides('players');
  function setQuality(s) {
    if (s.pixelRatioMax !== pixelRatioMax) { pixelRatioMax = s.pixelRatioMax; resize(); }
    const size = Math.max(256, Math.min(Math.round(baseMap * s.shadowScale), renderer.capabilities.maxTextureSize || 2048)), half = baseHalf * s.shadowHalfScale;
    if (size !== sun.shadow.mapSize.x) { // the shadow map is rebuilt at the new size
      if (sun.shadow.map) sun.shadow.map.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(size, size);
    }
    if (half !== curHalf) {
      curHalf = half;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    sunTexel = (2 * curHalf) / sun.shadow.mapSize.x; // F40: texel snapping stays on the new grid
    const on = !!s.shadows;
    if (renderer.shadowMap.enabled !== on) {
      renderer.shadowMap.enabled = on;
      scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    sun.castShadow = on && !hidesPlayers;
    tufts.visible = !!s.tufts;
    treeShadows.visible = !!s.treeShadows && !hides('trees');
    sailboats.group.visible = !!s.sailboats;
    butterflies.group.visible = !!s.butterflies;
    clouds.uniforms.cloudK.value = s.cloudShadows ? 1 : 0;
    divotsOn = s.divots !== false;
    if (!divotsOn) for (const m of divotMeshes) m.visible = false;
    if (sepiaRT && s.sepiaSamples !== q.sepiaSamples) { sepiaRT.dispose(); sepiaRT = null; }
    q = { sepiaSamples: s.sepiaSamples, tufts: !!s.tufts };
  }
  if (init.quality) setQuality(init.quality);

  setCamera('aim');
  trans = 1;
  computeGoal(0);
  cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt);
  return { butterflies, antialias, setQuality, setDaylight, sync, fadeBody, setCamera, setPaused, render, pick, resize, dispose, addDivot, clearDivots, showMeasure, showScoring, setRankLabels, fitScoring, clearMeasure: () => { scoringFit = null; scoringArgs = null; clearMeasure(); }, showJackZone, syncCourt, floatplane, setRingPose, setJackArrow, setPlaceMarker, setPlayers, setThrowPreview, getZoom: () => zoom, addObject: (o) => scene.add(o), removeObject: (o) => scene.remove(o) };
}
