// Game loop and precise-mode throws: terrain, world and renderer wired to range inputs.
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch } from './physics.js';
import { createRenderer } from './render.js';

const MAX_STEPS = 24; // physics steps per frame; backlog beyond this is dropped
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const status = document.querySelector('.petanque-status');
const canvas = document.querySelector('#petanque canvas');
const controls = document.querySelector('.petanque-controls');
const say = (text) => { if (status) status.textContent = text; };

// slider spec: [key, label, min, max, step, default, unit]
const SLIDERS = [
  ['yaw', 'Aim', -15, 15, 0.5, 0, '°'],
  ['speed', 'Speed', 2, 12, 0.1, 7, ' m/s'],
  ['loft', 'Loft', 5, 75, 1, 50, '°'],
  ['backspin', 'Backspin', 0, 150, 1, 30, ' rad/s'],
  ['sidespin', 'Sidespin', -40, 40, 1, 0, ' rad/s'],
];

function boot() {
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' && !isNaN(+seedParam)
    ? +seedParam : Math.floor(Math.random() * 1e9);
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const renderer = createRenderer(canvas, terrain);

  let jack = null;
  let thrown = 0; // boules thrown; team alternates
  let flying = null; // body being tracked
  let aimYaw = 0;

  // Controls
  const inputs = {};
  controls.textContent = '';
  const grid = document.createElement('div');
  grid.className = 'pc-grid';
  for (const [key, label, min, max, step, def, unit] of SLIDERS) {
    const row = document.createElement('div');
    row.className = 'pc-row';
    const lab = document.createElement('label');
    lab.htmlFor = 'pc-' + key;
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = 'pc-' + key;
    Object.assign(input, { min, max, step, value: def });
    const out = document.createElement('output');
    out.htmlFor = input.id;
    const show = () => { out.textContent = input.value + unit; };
    input.addEventListener('input', () => {
      show();
      if (key === 'yaw') {
        aimYaw = +input.value * DEG;
        if (!flying) renderer.setCamera('aim', { yaw: aimYaw });
      }
    });
    show();
    row.append(lab, input, out);
    grid.append(row);
    inputs[key] = input;
  }
  const buttons = document.createElement('div');
  buttons.className = 'pc-buttons';
  const mkBtn = (text, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = cls;
    buttons.append(b);
    return b;
  };
  const throwBtn = mkBtn('Throw jack', 'pc-throw');
  const resetBtn = mkBtn('Reset', 'pc-reset');
  controls.append(grid, buttons);

  const readParams = () => ({
    yaw: +inputs.yaw.value * DEG,
    speed: +inputs.speed.value,
    loft: +inputs.loft.value * DEG,
    backspin: +inputs.backspin.value,
    sidespin: +inputs.sidespin.value,
  });

  const jackLive = () => jack && !jack.dead;
  const updateButton = () => { throwBtn.textContent = jackLive() ? 'Throw boule' : 'Throw jack'; };

  function startThrow(kind, p) {
    if (kind === 'jack' && jack) {
      const i = world.bodies.indexOf(jack);
      if (i >= 0) world.bodies.splice(i, 1);
    }
    const body = createBody(kind, { team: kind === 'jack' ? -1 : thrown % 2 });
    world.add(body);
    launch(body, { ...readParams(), ...p });
    if (kind === 'jack') jack = body; else thrown++;
    flying = body;
    renderer.setCamera('flight', { body });
    throwBtn.disabled = true;
    say('Rolling…');
    return body;
  }
  const throwJack = (p) => startThrow('jack', p);
  const throwBoule = (p) => startThrow(jackLive() ? 'boule' : 'jack', p);

  throwBtn.addEventListener('click', () => {
    if (!flying) throwBoule();
  });

  function reset() {
    world.bodies.length = 0;
    world.events.length = 0;
    terrain.resetDivots();
    jack = null; thrown = 0; flying = null;
    throwBtn.disabled = false;
    updateButton();
    renderer.sync(world);
    renderer.setCamera('aim', { yaw: aimYaw });
    say('Ready. Throw the jack first.');
  }
  resetBtn.addEventListener('click', reset);

  function onSettled() {
    const was = flying;
    flying = null;
    throwBtn.disabled = false;
    updateButton();
    if (jackLive()) {
      renderer.setCamera('head', { target: { x: jack.x, y: jack.y } });
      if (was === jack) say(`Jack settled ${(jack.y - C.circle.y).toFixed(1)} m out`);
      else if (was.dead) say('Out of bounds: dead boule');
      else say(`Settled ${Math.hypot(was.x - jack.x, was.y - jack.y).toFixed(2)} m from the jack`);
    } else {
      renderer.setCamera('aim', { yaw: aimYaw });
      say(was.kind === 'jack' ? 'Dead jack. Throw it again.' : 'Settled.');
    }
  }

  // Fixed timestep loop
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= C.dt && n < MAX_STEPS) {
      world.step(); acc -= C.dt; n++;
      if (flying && world.settled()) onSettled();
    }
    if (n === MAX_STEPS) acc = 0; // drop backlog rather than spiral
    world.events.length = 0;
    renderer.sync(world);
    renderer.render(dt);
    requestAnimationFrame(frame);
  }

  say('Ready. Throw the jack first.');
  renderer.setCamera('aim', { yaw: aimYaw });
  requestAnimationFrame(frame);

  if (debug) {
    window.__petanque = {
      world, terrain, renderer, seed, reset,
      throw: (p) => throwBoule(p),
      throwJack: (p) => throwJack(p),
    };
    if (params.has('autotest')) autotest();
  }

  // Scripted (debug only): jack then three boules, each simulated to rest instantly
  function autotest() {
    const run = (f) => {
      f();
      let guard = 0;
      while (!world.settled() && guard++ < 240 * 20) world.step();
      onSettled();
    };
    run(() => throwJack({}));
    run(() => throwBoule({ yaw: -0.02, speed: 7.1 }));
    run(() => throwBoule({ yaw: 0.03, speed: 6.9 }));
    run(() => throwBoule({ speed: 7, backspin: 45 }));
  }
}

try {
  boot();
} catch (err) {
  say('Sorry, the game could not start: ' + (err && err.message ? err.message : err));
  console.error(err);
}
