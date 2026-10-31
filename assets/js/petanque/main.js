// Game loop and precise-mode throws: terrain, world and renderer wired to range inputs.
import { C } from './constants.js';
import { mulberry32, gauss } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch, simulate } from './physics.js';
import { createRenderer } from './render.js';
import {
  createMatch, defaultPlayers, apply, nextTeam, playersWithBoules,
} from './rules.js';
import { createHud } from './hud.js';

const TEAM_NAMES = ['You & Pierre', 'Marcel & Odette'];
const MAX_STEPS = 24; // physics steps per frame; backlog beyond this is dropped
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const root = document.querySelector('#petanque');
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


// ---- Placeholder AI (B11 swaps this for ai.js with the same signatures) ----
const NOISE = { // speed (fraction) and yaw (rad) standard deviations
  easy: { speed: 0.09, yaw: 0.03 },
  medium: { speed: 0.05, yaw: 0.015 },
  hard: { speed: 0.025, yaw: 0.008 },
};

// Bisect launch speed so a lone body comes to rest `dist` metres from the circle
function searchSpeed(world, kind, yaw, loft, backspin, dist) {
  const terr = world.terrain.perceived ? world.terrain.perceived() : world.terrain;
  const scratch = world.clone(terr, mulberry32(4321));
  let lo = 2, hi = 16;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    scratch.bodies = [];
    scratch.events.length = 0;
    const b = createBody(kind, {});
    scratch.add(b);
    launch(b, { yaw, speed: mid, loft, backspin, sidespin: 0 });
    simulate(scratch, 15);
    const d = b.dead ? Infinity : Math.hypot(b.x - C.throwFrom.x, b.y - C.throwFrom.y);
    if (d < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function aimAt(world, kind, target, loft, backspin, difficulty, rand) {
  const dx = target.x - C.throwFrom.x, dy = target.y - C.throwFrom.y;
  const yaw0 = Math.atan2(dx, dy);
  const speed0 = searchSpeed(world, kind, yaw0, loft, backspin, Math.hypot(dx, dy));
  const n = NOISE[difficulty] || NOISE.medium;
  return {
    yaw: yaw0 + gauss(rand) * n.yaw,
    speed: speed0 * (1 + gauss(rand) * n.speed),
    loft, backspin, sidespin: 0,
  };
}

// Demi-portée at the jack (placeholder)
async function chooseThrowAsync({ world, match, player, difficulty, rand }) {
  const jack = world.bodies.find((b) => b.kind === 'jack' && !b.dead) || match.jack;
  const throwParams = aimAt(world, 'boule', jack, 0.6, 20, difficulty, rand);
  return { throwParams, intent: 'point', label: `${player.name} is aiming…` };
}

// Jack thrown 6.5 to 9.5 m out, roughly centred
function chooseJackThrow({ world, difficulty, rand }) {
  const target = { x: 2 + (rand() - 0.5) * 0.8, y: C.throwFrom.y + 6.5 + rand() * 3 };
  const throwParams = aimAt(world, 'jack', target, 0.5, 0, difficulty, rand);
  return { throwParams, intent: 'jack', label: 'throws the jack' };
}


function boot() {
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' && !isNaN(+seedParam)
    ? +seedParam : Math.floor(Math.random() * 1e9);
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const renderer = createRenderer(canvas, terrain);
  const aiRand = mulberry32(seed ^ 0x51ed270b);

  let match = null; // rules state; null until a game starts
  let difficulty = 'medium';
  let instant = false; // autotest: no delays, simulate to rest synchronously
  let token = 0; // bumped on each new game so stale timers are ignored
  let flying = null; // body being tracked
  let pending = null; // { kind, playerId } while waiting for the human to throw
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
  const newBtn = mkBtn('New game', 'pc-reset');
  controls.append(grid, buttons);

  const readParams = () => ({
    yaw: +inputs.yaw.value * DEG,
    speed: +inputs.speed.value,
    loft: +inputs.loft.value * DEG,
    backspin: +inputs.backspin.value,
    sidespin: +inputs.sidespin.value,
  });

  function enableControls(on) {
    for (const k in inputs) inputs[k].disabled = !on;
    throwBtn.disabled = !on;
  }
  enableControls(false);

  const hud = createHud(root, document.querySelector('.petanque-hud'), {
    onStart: (opts) => startGame(opts),
    onNext: () => nextMene(),
    onPlayAgain: () => toSetup(),
    onChoose: (id) => beginTurn(id),
  });
  const say2 = hud.say;

  const jackBody = () => world.bodies.find((b) => b.kind === 'jack');
  const later = (fn, ms) => {
    const t = token;
    setTimeout(() => { if (t === token) fn(); }, instant ? 0 : ms);
  };

  function clearWorld() {
    world.bodies.length = 0;
    world.events.length = 0;
    terrain.resetDivots();
    flying = null;
    renderer.sync(world);
  }

  // Launch a body; the frame loop reports when the world settles
  function launchBody(kind, team, owner, p) {
    if (kind === 'jack') {
      const old = jackBody();
      if (old) world.bodies.splice(world.bodies.indexOf(old), 1);
    }
    const body = createBody(kind, { team: kind === 'jack' ? -1 : team, owner });
    world.add(body);
    launch(body, p);
    flying = body;
    renderer.setCamera('flight', { body });
    enableControls(false);
    if (instant) {
      let guard = 0;
      while (!world.settled() && guard++ < 240 * 20) world.step();
      world.events.length = 0;
      onSettled();
    }
    return body;
  }

  // ---- Game flow ----
  function toSetup() {
    token++;
    match = null; pending = null;
    enableControls(false);
    clearWorld();
    renderer.setCamera('aim', { yaw: 0 });
    hud.hideChooser();
    hud.showSetup({ difficulty });
  }

  function startGame(opts) {
    token++;
    difficulty = opts.difficulty || 'medium';
    instant = !!opts.instant;
    const players = defaultPlayers();
    if (opts.allAI) for (const p of players) p.isHuman = false;
    match = createMatch({ target: opts.target || 13, players, firstJackTeam: Math.random() < 0.5 ? 0 : 1 });
    hud.hideOverlay();
    beginMene(true);
  }

  function beginMene(first) {
    clearWorld();
    pending = null;
    hud.hideChooser();
    const team = match.jackTeam;
    const thrower = match.players.find((p) => p.team === team && (p.isHuman || team === 1)) ||
      match.players.find((p) => p.team === team);
    const lead = first ? `${TEAM_NAMES[team]} won the toss. ` : '';
    refreshHud({ team, playerId: thrower.id, text: `${thrower.isHuman ? 'You' : thrower.name} throw${thrower.isHuman ? '' : 's'} the jack` });
    renderer.setCamera('aim', { yaw: aimYaw });
    if (thrower.isHuman) {
      humanTurn('jack', thrower.id, lead + 'Your jack. Set the sliders and throw it 6 to 10 metres out.');
    } else {
      aiJack(thrower, lead);
    }
  }

  function refreshHud(turn) { hud.update(match, turn); }

  function humanTurn(kind, playerId, text) {
    pending = { kind, playerId };
    throwBtn.textContent = kind === 'jack' ? 'Throw jack' : 'Throw boule';
    enableControls(true);
    renderer.setCamera('aim', { yaw: aimYaw });
    say2(text);
    if (!instant) setTimeout(() => throwBtn.focus({ preventScroll: true }), 0);
  }

  throwBtn.addEventListener('click', () => {
    if (!pending || flying) return;
    const { kind, playerId } = pending;
    pending = null;
    doThrow(kind, playerId, readParams());
  });
  newBtn.addEventListener('click', () => {
    if (match) toSetup();
  });

  function doThrow(kind, playerId, p) {
    const player = match.players.find((q) => q.id === playerId);
    if (kind === 'boule') match = apply(match, { type: 'bouleThrown', playerId });
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'You are' : player.name + ' is'} throwing…` });
    say2('Rolling…');
    launchBody(kind, player.team, playerId, p);
  }

  async function aiJack(player, lead) {
    refreshHud({ team: player.team, playerId: player.id, text: `${player.name} throws the jack` });
    say2(`${lead}${player.name} is aiming…`);
    const t = token;
    await sleep(900);
    if (t !== token) return;
    const { throwParams } = chooseJackThrow({ world, difficulty, rand: aiRand });
    pending = null;
    doThrow('jack', player.id, throwParams);
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, instant ? 0 : ms));

  async function aiBoule(player) {
    say2(`${player.name} is aiming…`);
    const t = token;
    const choice = await chooseThrowAsync({ world, match, player, difficulty, rand: aiRand });
    await sleep(1100);
    if (t !== token) return;
    say2(choice.label.replace('is aiming…', 'throws…'));
    doThrow('boule', player.id, choice.throwParams);
  }

  // Pick who throws next, from rules.nextTeam()
  function nextTurn() {
    const team = nextTeam(match);
    if (team === null) return; // mène already ended
    const avail = playersWithBoules(match, team);
    if (avail.length > 1 && avail.some((p) => p.isHuman)) {
      refreshHud({ team, playerId: null, text: 'Your team throws next' });
      say2('Your team to play. Who throws?');
      renderer.setCamera('head', { target: match.jack });
      hud.showChooser(avail);
      return;
    }
    // AI side: whoever holds more boules goes first, the first listed on ties
    const pl = avail.slice().sort((a, b) => b.boulesLeft - a.boulesLeft)[0];
    beginTurn(pl.id);
  }

  function beginTurn(playerId) {
    const player = match.players.find((p) => p.id === playerId);
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'Your throw' : player.name + ' to throw'}` });
    if (player.isHuman) {
      humanTurn('boule', playerId, 'Your turn. Set the sliders and throw a boule.');
    } else {
      aiBoule(player);
    }
  }

  function snapshot() {
    const j = jackBody();
    return {
      jack: { x: j.x, y: j.y, dead: j.dead },
      boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({
        id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead,
      })),
    };
  }

  function describe(was) {
    const j = jackBody();
    if (j && j.dead) return 'The jack is out: dead jack.';
    if (was.kind === 'jack') return `Jack is ${Math.hypot(was.x - C.circle.x, was.y - C.circle.y).toFixed(1)} m out.`;
    if (was.dead) return `${ownerName(was)}'s boule is out: dead boule.`;
    return `${ownerName(was)}'s boule is ${Math.hypot(was.x - j.x, was.y - j.y).toFixed(2)} m from the jack.`;
  }
  const ownerName = (b) => {
    const p = match && match.players.find((q) => q.id === b.owner);
    return p ? (p.isHuman ? 'Your' : p.name).replace(/^Your$/, 'Your') : 'The';
  };

  function onSettled() {
    const was = flying;
    flying = null;
    if (!match) { // debug throws outside a game
      const j = jackBody();
      if (j && !j.dead) renderer.setCamera('head', { target: { x: j.x, y: j.y } });
      else renderer.setCamera('aim', { yaw: aimYaw });
      return;
    }
    const snap = snapshot();
    const note = describe(was);
    if (was.kind === 'jack') {
      const team = match.jackTeam;
      match = apply(match, { type: 'jackThrown', team, jack: snap.jack });
      if (match.phase === 'jack') { // invalid: the other team throws it
        renderer.setCamera('aim', { yaw: aimYaw });
        say2(`${note} Not a legal jack (6 to 10 m, 1 m from the lines). ${TEAM_NAMES[match.jackTeam]} throw it.`);
        later(() => beginMene(false), 1500);
        return;
      }
      renderer.setCamera('head', { target: snap.jack });
      say2(note + ' Play begins.');
      later(nextTurn, 1400);
      return;
    }
    match = apply(match, { type: 'throwSettled', jack: snap.jack, boules: snap.boules });
    if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
      endOfMene(note);
      return;
    }
    renderer.setCamera('head', { target: snap.jack });
    say2(note);
    refreshHud(null);
    later(nextTurn, 1500);
  }

  function endOfMene(note) {
    const r = match.result;
    const j = match.jack;
    renderer.setCamera(j && !j.dead ? 'head' : 'aim', { target: j, yaw: 0 });
    refreshHud(null);
    let text, detail = note;
    if (r.void) text = 'Void mène: no points';
    else {
      const names = TEAM_NAMES[r.team];
      text = `${names} score ${r.points} point${r.points === 1 ? '' : 's'}`;
      if (r.team === 0) text = `You & Pierre score ${r.points} point${r.points === 1 ? '' : 's'}`;
    }
    if (match.phase === 'gameOver') {
      const win = match.winner;
      hud.showGameOver({
        text: win === 0 ? 'You win!' : 'Marcel & Odette win',
        detail: `${text}. Final score ${match.scores[0]} to ${match.scores[1]}.`,
      });
      return;
    }
    hud.showMeneEnd({ text, detail: `${detail} Score: ${match.scores[0]} to ${match.scores[1]}.` });
    if (instant) later(() => nextMene(), 0);
  }

  function nextMene() {
    if (!match || match.phase !== 'meneEnd') return;
    match = apply(match, { type: 'nextMene' });
    hud.hideOverlay();
    beginMene(false);
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

  renderer.setCamera('aim', { yaw: aimYaw });
  requestAnimationFrame(frame);

  if (debug) {
    window.__petanque = {
      world, terrain, renderer, seed, reset: toSetup, startGame,
      get match() { return match; },
      throw: (p) => launchBody(jackBody() && !jackBody().dead ? 'boule' : 'jack', 0, 'you', { ...readParams(), ...p }),
      throwJack: (p) => launchBody('jack', -1, null, { ...readParams(), ...p }),
    };
  }

  if (debug && params.has('autotest')) {
    // AI-only quick match, every throw simulated to rest instantly
    startGame({ target: 7, difficulty: 'medium', allAI: true, instant: true });
  } else {
    toSetup();
  }
}

try {
  boot();
} catch (err) {
  say('Sorry, the game could not start: ' + (err && err.message ? err.message : err));
  console.error(err);
}
