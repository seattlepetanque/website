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

  // Divot decals: a pool of soft dark discs just above the ground, reused in a ring
  const DIVOTS = 48;
  const divotTex = (() => {
    const cv = makeCanvas(64, 64), g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
    gr.addColorStop(0, 'rgba(60,44,24,0.55)');
    gr.addColorStop(0.65, 'rgba(60,44,24,0.3)');
    gr.addColorStop(1, 'rgba(60,44,24,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const divotGeo = new THREE.PlaneGeometry(2, 2);
  const divotMat = new THREE.MeshBasicMaterial({
    map: divotTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
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
  function addDivot(x, y, r = 0.06) {
    const m = divotMeshes[divotNext++ % DIVOTS];
    m.position.set(x, y, terrain.sample(x, y).h + 0.004);
    m.scale.setScalar(Math.max(0.03, r * 1.6));
    m.rotation.z = (x * 977 + y * 331) % 6.283;
    m.visible = true;
  }
  function clearDivots() { for (const m of divotMeshes) m.visible = false; divotNext = 0; }

  // Legal jack zone: two arcs 6 m and 10 m from the circle, shown while a human aims the jack
  const jackZone = new THREE.Group();
  jackZone.visible = false;
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.85, depthTest: false });
    const c = C.circle;
    for (const rad of [C.jackMinDist, C.jackMaxDist]) {
      for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.012) {
        const x = c.x + rad * Math.sin(a), y = c.y + rad * Math.cos(a);
        if (x < 1 || x > C.terrainW - 1 || y > C.terrainL - 1) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.06, 0.004), mat);
        m.position.set(x, y, terrain.sample(x, y).h + 0.008);
        m.rotation.z = -a;
        m.renderOrder = 3;
        jackZone.add(m);
      }
    }
  }
  scene.add(jackZone);
  function showJackZone(on) { jackZone.visible = !!on; }

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
  function clearMeasure() {
    for (const o of [...measure.children]) {
      measure.remove(o);
      if (o.material && o.material.map) o.material.map.dispose();
      if (o.material) o.material.dispose();
      if (o.geometry && o.geometry !== divotGeo) o.geometry.dispose();
    }
  }
  function labelSprite(text, color) {
    const cv = makeCanvas(160, 64), g = cv.getContext('2d');
    g.font = '700 38px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(20,40,75,0.82)';
    g.beginPath(); g.roundRect(6, 8, 148, 48, 12); g.fill();
    g.fillStyle = color;
    g.fillText(text, 80, 33);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, fog: false }));
    spr.renderOrder = 5;
    spr.scale.set(0.34, 0.136, 1);
    return spr;
  }
  // items: [{ x, y, label, scored }]; jack: { x, y }
  function showMeasure(jack, items) {
    clearMeasure();
    const jz = terrain.sample(jack.x, jack.y).h + 0.012;
    for (const it of items) {
      const color = it.scored ? '#ffd24a' : '#c9d2e6';
      const iz = terrain.sample(it.x, it.y).h + 0.012;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(jack.x, jack.y, jz), new THREE.Vector3(it.x, it.y, iz)]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.04, gapSize: it.scored ? 0.0 : 0.03, depthTest: false, transparent: true, opacity: 0.95 }));
      line.computeLineDistances();
      line.renderOrder = 4;
      measure.add(line);
      const spr = labelSprite(it.label, color);
      spr.position.set((jack.x + it.x) / 2, (jack.y + it.y) / 2, Math.max(jz, iz) + 0.1);
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
        r.pts[n * 3 + 2] = ground ? terrain.sample(q.x, q.y).h + 0.012 : q.z;
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
    f.pos[0] = cx; f.pos[1] = cy; f.pos[2] = terrain.sample(cx, cy).h + 0.01;
    for (let i = 0; i < f.cap; i++) {
      const q = pts[Math.min(m - 1, Math.round(i * m / f.cap))];
      f.pos[3 + i * 3] = q.x; f.pos[4 + i * 3] = q.y; f.pos[5 + i * 3] = terrain.sample(q.x, q.y).h + 0.01;
    }
    f.mesh.geometry.attributes.position.needsUpdate = true;
    f.mesh.visible = true;
  }

  // Roll guide: dashes laid flat on the ground (dark under-layer, bright orange on top) plus a ring where the
  // roll ends. Orange so it is never mistaken for the cream arc.
  const DASHES = 160, DASH_LEN = 0.4, DASH_GAP = 0.3, DASH_W = 0.11;
  const dashMat = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const dashGeo = new THREE.PlaneGeometry(1, 1);
  const dashBack = new THREE.InstancedMesh(dashGeo, dashMat('#241608', 0.75), DASHES);
  const dashTop = new THREE.InstancedMesh(dashGeo, dashMat('#ffae2b', 1), DASHES);
  const restRing = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 32), dashMat('#ffae2b', 1));
  const restRingBack = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.25, 32), dashMat('#241608', 0.75));
  for (const [o, order] of [[dashBack, 13], [dashTop, 14], [restRingBack, 13], [restRing, 14]]) {
    o.frustumCulled = false; o.renderOrder = order; o.visible = false; scene.add(o);
  }
  dashBack.count = dashTop.count = 0;
  const dM = new THREE.Matrix4(), dPos = new THREE.Vector3(), dX = new THREE.Vector3(), dY = new THREE.Vector3(), dZ = new THREE.Vector3();
  function setRoll(pts) {
    let n = 0;
    restRing.visible = restRingBack.visible = false;
    if (pts && pts.length > 1) {
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
      const e = pts[pts.length - 1], h = terrain.sample(e.x, e.y);
      for (const r of [restRing, restRingBack]) {
        r.position.set(e.x, e.y, h.h + 0.018);
        r.quaternion.setFromUnitVectors(upZ, dZ.set(h.nx || 0, h.ny || 0, h.nz || 1).normalize());
        r.visible = true;
      }
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
      marker.position.set(p.donnee.x, p.donnee.y, s.h + 0.014);
      nrm.set(s.nx || 0, s.ny || 0, s.nz || 1).normalize();
      marker.quaternion.setFromUnitVectors(upZ, nrm);
      plainRing.visible = !p.snapped;
      snapRing.visible = !!p.snapped;
      marker.visible = true;
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

  function setCamera(m, o = {}) {
    if (m === 'inspect' && (mode !== 'inspect' || o.reset)) { // o.reset: a scripted cut replaces the user's orbit
      const t = o.target || { x: 2, y: 8 };
      orbit.dist = o.dist || 2.5;
      orbit.az = o.az !== undefined ? o.az : 0;
      orbit.el = o.el !== undefined ? o.el : 0.6;
      void t;
    }
    if (m === 'shoulder' && o.zoom !== undefined) zoom = clampZoom(o.zoom);
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
      // frame the target plus any listed points (nearby live boules) with a margin
      let x0 = t.x, x1 = t.x, y0 = t.y, y1 = t.y;
      for (const p of opts.points || []) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const margin = 0.3, el = 0.95; // rad of elevation
      const hx = Math.max(0.45, (x1 - x0) / 2 + margin), hy = Math.max(0.45, (y1 - y0) / 2 + margin);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const dist = Math.max(opts.dist || 1.4, hx / Math.tan(hf / 2), (hy * Math.sin(el) + 0.1) / Math.tan(vf / 2) + hy * Math.cos(el)) * 1.05;
      const ly = cy - (opts.lift || 0) * dist; // look nearer so the subject sits higher on screen
      goal.tgt.set(cx, ly, groundZ({ x: cx, y: cy }));
      goal.pos.set(cx, ly - Math.cos(el) * dist, goal.tgt.z + Math.sin(el) * dist);
    } else if (mode === 'shoulder') {
      // behind and to the right of the player, ~2.1 m up at zoom 1, looking ~7 m ahead and a little down
      const p = opts.player || C.circle, yaw = opts.yaw || 0;
      const fx = Math.sin(yaw), fy = Math.cos(yaw), rx = Math.cos(yaw), ry = -Math.sin(yaw);
      const gz = groundZ(p);
      const w = opts.wide || 1; // chibi mesh players are bulkier: stand the camera further back and up
      goal.pos.set(p.x - fx * 2.2 * zoom * w + rx * 1.1 * zoom * w, p.y - fy * 2.2 * zoom * w + ry * 1.1 * zoom * w, gz + (1.5 + 0.6 * zoom) * w);
      goal.tgt.set(p.x + fx * 7 - rx * 0.5, p.y + fy * 7 - ry * 0.5, gz - 0.7);
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
  function updateCamera(dt) {
    const wantFocus = mode === 'shoulder' && preview && preview.donnee ? 1 : 0;
    focusK = reduce() ? wantFocus : focusK + (wantFocus - focusK) * (1 - Math.exp(-dt * 6));
    if (Math.abs(focusK - wantFocus) < 0.002) focusK = wantFocus;
    computeGoal(dt);
    const baseFov = camera.aspect < 1 ? 62 : 50;
    let fov = baseFov;
    if (focusK > 0 && preview && preview.donnee) {
      const d = Math.hypot(preview.donnee.x - C.circle.x, preview.donnee.y - C.circle.y);
      fov = baseFov * (1 - 0.32 * focusK * Math.max(0, Math.min(1, (d - 3) / 5)));
    }
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (trans < 1) {
      trans = Math.min(1, trans + dt / TRANSITION);
      const k = smooth(trans);
      cur.pos.lerpVectors(from.pos, goal.pos, k);
      cur.tgt.lerpVectors(from.tgt, goal.tgt, k);
    } else if (mode === 'flight' && !reduce()) {
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
    if (mode !== 'inspect' && mode !== 'shoulder') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // shoulder mode only watches for a pinch; the toss input owns single-pointer gestures
    if (mode === 'inspect' && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
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
    updatePreview();
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
  return { sync, setCamera, render, pick, resize, dispose, addDivot, clearDivots, showMeasure, clearMeasure, showJackZone, setPlaceMarker, setPlayers, setThrowPreview, getZoom: () => zoom, addObject: (o) => scene.add(o), removeObject: (o) => scene.remove(o) };
}
