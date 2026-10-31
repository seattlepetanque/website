// three.js renderer for the pétanque game. World axes: x across, y along, z up.
import * as THREE from '../vendor/three.module.js';
import { C } from './constants.js';
import { mulberry32 } from './rng.js';

const TRANSITION = 0.6; // seconds for camera moves

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Speckled gravel detail texture, tileable enough at this scale
function gravelTexture() {
  const S = 512, cv = makeCanvas(S, S), g = cv.getContext('2d');
  const rand = mulberry32(7);
  g.fillStyle = '#b9a98a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S, r = 0.6 + rand() * 2.6;
    const l = 45 + rand() * 45;
    g.fillStyle = `hsl(${28 + rand() * 14}, ${12 + rand() * 22}%, ${l}%)`;
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
  const geo = new THREE.SphereGeometry(200, 24, 16);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#2f7ae0'), hor = new THREE.Color('#cfe0f2'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getZ(i) / 120));
    c.copy(hor).lerp(top, Math.pow(t, 0.45));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // sphere's pole is +y; rotate so +z is up
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

// Tiny scene baked to an environment map so the steel has something to reflect
function makeEnvMap(renderer) {
  const s = new THREE.Scene();
  s.add(makeSky());
  const floor = new THREE.Mesh(new THREE.CircleGeometry(150, 16), new THREE.MeshBasicMaterial({ color: '#a8977a' }));
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

export function createRenderer(canvas, terrain) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    throw new Error('WebGL is not available in this browser, so the 3D game cannot start.');
  }
  if (!renderer.getContext()) throw new Error('WebGL is not available in this browser, so the 3D game cannot start.');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#cfdcea');
  scene.background = FOG;
  scene.fog = new THREE.Fog(FOG, 14, 60);
  scene.add(makeSky());
  scene.environment = makeEnvMap(renderer);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  camera.up.set(0, 0, 1);

  // Lights
  scene.add(new THREE.HemisphereLight('#cfe2ff', '#8a7a5c', 1.1));
  const sun = new THREE.DirectionalLight('#ffe2b8', 3.0);
  const sunOffset = new THREE.Vector3(-5, -7, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 25;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);

  // Terrain mesh
  const grid = terrain.heightGrid(0.05);
  const { w: gw, h: gh } = grid;
  const pos = new Float32Array(gw * gh * 3), uv = new Float32Array(gw * gh * 2), colr = new Float32Array(gw * gh * 3);
  const packed = new THREE.Color('#e6d9bd'), loose = new THREE.Color('#fff0d2'), tint = new THREE.Color();
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i, x = grid.x0 + i * grid.step, y = grid.y0 + j * grid.step;
      const s = terrain.sample(x, y);
      pos.set([x, y, grid.data[k]], k * 3);
      uv.set([x * 2, y * 2], k * 2);
      tint.copy(packed).lerp(loose, Math.max(0, Math.min(1, s.loose)));
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
  const gravel = gravelTexture();
  const terrainMesh = new THREE.Mesh(tgeo, new THREE.MeshStandardMaterial({
    map: gravel, vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.4,
  }));
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Darker surroundings
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: '#7b6f56', roughness: 1, metalness: 0, envMapIntensity: 0.2 }),
  );
  ground.position.set(C.terrainW / 2, C.terrainL / 2, -0.03);
  ground.receiveShadow = true;
  scene.add(ground);

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
      col.setHSL(0.09 + rand() * 0.04, 0.1 + t * 0.25, 0.3 + rand() * 0.3);
      stoneMesh.setColorAt(i, col);
    });
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    scene.add(stoneMesh);
  }

  // Boundary strings and throwing circle
  const strings = new THREE.Group();
  const stringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: true });
  const W = C.terrainW, L = C.terrainL;
  const addString = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.004), stringMat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.012);
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    strings.add(m);
  };
  addString(0, 0, W, 0); addString(W, 0, W, L); addString(W, L, 0, L); addString(0, L, 0, 0);
  scene.add(strings);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(C.circle.r - 0.012, C.circle.r + 0.012, 64),
    new THREE.MeshBasicMaterial({ color: '#c0262f' }),
  );
  ring.position.set(C.circle.x, C.circle.y, terrain.sample(C.circle.x, C.circle.y).h + 0.006);
  scene.add(ring);

  // Bodies
  const grooves = [grooveTexture(0), grooveTexture(1)];
  const bouleMats = [
    new THREE.MeshStandardMaterial({ color: '#a9bde0', metalness: 1, roughness: 0.3, bumpMap: grooves[0], bumpScale: 1.5, envMapIntensity: 2.2 }),
    new THREE.MeshStandardMaterial({ color: '#e8aa6a', metalness: 1, roughness: 0.3, bumpMap: grooves[1], bumpScale: 1.5, envMapIntensity: 2.2 }),
  ];
  const jackMat = new THREE.MeshStandardMaterial({ color: '#ffa81c', metalness: 0, roughness: 0.45, emissive: '#3a1c00' });
  const bouleGeo = new THREE.SphereGeometry(1, 40, 24);
  bouleGeo.rotateX(Math.PI / 2); // texture poles along z; any orientation is fine
  const jackGeo = new THREE.SphereGeometry(1, 20, 12);
  const ringGeo = new THREE.RingGeometry(1.25, 1.7, 32);
  const ringMats = [new THREE.MeshBasicMaterial({ color: '#2b6fe0', side: THREE.DoubleSide }), new THREE.MeshBasicMaterial({ color: '#e0832b', side: THREE.DoubleSide })];
  const meshes = new Map(); // id -> { mesh, ring, body, w }
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
        let ringM = null;
        if (!jack) {
          ringM = new THREE.Mesh(ringGeo, ringMats[b.team ? 1 : 0]);
          ringM.scale.setScalar(b.r);
          ringM.visible = false;
          scene.add(ringM);
        }
        e = { mesh, ring: ringM, body: b };
        meshes.set(b.id, e);
      }
      e.body = b;
      e.mesh.position.set(b.x, b.y, b.z);
      if (e.ring) e.ring.position.set(b.x, b.y, terrain.sample(b.x, b.y).h + 0.004);
      e.mesh.visible = !(b.dead && b.z < -1);
    }
    for (const [id, e] of meshes) {
      if (seen.has(id)) continue;
      scene.remove(e.mesh);
      if (e.ring) scene.remove(e.ring);
      meshes.delete(id);
    }
  }

  // Camera state
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cur = { pos: new THREE.Vector3(2, -2, 2), tgt: new THREE.Vector3(2, 8, 0) };
  const from = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const goal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  let mode = 'aim', opts = {}, trans = 1;
  const orbit = { az: 0, el: 0.6, dist: 3 };
  let heading = new THREE.Vector3(0, 1, 0);

  function setCamera(m, o = {}) {
    if (m === 'inspect' && mode !== 'inspect') {
      const t = o.target || { x: 2, y: 8 };
      orbit.dist = o.dist || 2.5;
      orbit.az = o.az !== undefined ? o.az : 0;
      orbit.el = o.el !== undefined ? o.el : 0.6;
      void t;
    }
    mode = m; opts = o;
    from.pos.copy(cur.pos); from.tgt.copy(cur.tgt);
    trans = reduce() ? 1 : 0;
    if (trans === 1) computeGoal(0, true);
  }

  function groundZ(t) { return terrain.sample(t.x, t.y).h; }

  function computeGoal(dt) {
    if (mode === 'aim') {
      const yaw = opts.yaw || 0, c = C.circle;
      goal.pos.set(c.x - Math.sin(yaw) * 1.4, c.y - Math.cos(yaw) * 1.4, 1.6);
      goal.tgt.set(c.x + Math.sin(yaw) * 5.5, c.y + Math.cos(yaw) * 5.5, 0);
    } else if (mode === 'flight' && opts.body) {
      const b = opts.body;
      const v = tmpV.set(b.vx || 0, b.vy || 0, 0);
      if (v.lengthSq() > 0.25) heading.lerp(v.normalize(), Math.min(1, dt * 4)).normalize();
      goal.pos.set(b.x - heading.x * 2.6, b.y - heading.y * 2.6, Math.max(b.z, 0) + 1.1);
      goal.tgt.set(b.x + heading.x * 2.5, b.y + heading.y * 2.5, Math.max(0, b.z * 0.4));
    } else if (mode === 'head') {
      const t = opts.target || { x: 2, y: 8 };
      goal.tgt.set(t.x, t.y, groundZ(t));
      goal.pos.set(t.x, t.y - (opts.dist || 1.8), (opts.height || 3));
    } else if (mode === 'inspect') {
      const t = opts.target || { x: 2, y: 8 };
      goal.tgt.set(t.x, t.y, groundZ(t) + 0.03);
      const ce = Math.cos(orbit.el), se = Math.sin(orbit.el);
      goal.pos.set(t.x + Math.sin(orbit.az) * ce * orbit.dist, t.y - Math.cos(orbit.az) * ce * orbit.dist, goal.tgt.z + se * orbit.dist);
    }
  }

  function updateCamera(dt) {
    computeGoal(dt);
    if (trans < 1) {
      trans = Math.min(1, trans + dt / TRANSITION);
      const k = smooth(trans);
      cur.pos.lerpVectors(from.pos, goal.pos, k);
      cur.tgt.lerpVectors(from.tgt, goal.tgt, k);
    } else if (mode === 'flight') {
      const k = 1 - Math.exp(-dt * 8);
      cur.pos.lerp(goal.pos, k);
      cur.tgt.lerp(goal.tgt, k);
    } else {
      cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt);
    }
    camera.position.copy(cur.pos);
    camera.lookAt(cur.tgt);
    // shadow frustum follows what we look at
    sun.target.position.copy(cur.tgt);
    sun.position.copy(cur.tgt).add(sunOffset);
  }

  // Minimal orbit controls for inspect mode
  const pointers = new Map();
  let pinch = 0;
  const onDown = (e) => {
    if (mode !== 'inspect') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || mode !== 'inspect') return;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the court in view on tall (phone) screens
    camera.fov = camera.aspect < 1 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(canvas); }
  resize();

  function render(dt = 1 / 60) {
    dt = Math.min(dt, 0.1);
    // roll the boules from their angular velocity
    for (const e of meshes.values()) {
      const b = e.body, wl = Math.hypot(b.wx || 0, b.wy || 0, b.wz || 0);
      if (wl > 1e-4 && dt > 0) {
        tmpV.set(b.wx, b.wy, b.wz).divideScalar(wl);
        tmpQ.setFromAxisAngle(tmpV, wl * dt);
        e.mesh.quaternion.premultiply(tmpQ);
      }
      if (e.ring) e.ring.visible = mode === 'head';
    }
    updateCamera(dt);
    renderer.render(scene, camera);
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

  setCamera('aim');
  trans = 1;
  computeGoal(0);
  cur.pos.copy(goal.pos); cur.tgt.copy(goal.tgt);
  return { sync, setCamera, render, pick, resize, dispose };
}
