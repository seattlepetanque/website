// Game loop: terrain, world, renderer, rules, AI, swing input, audio and HUD wired together.
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch } from './physics.js';
import { createRenderer } from './render.js';
import {
  createMatch, defaultPlayers, apply, nextTeam, playersWithBoules,
} from './rules.js';
import { createHud } from './hud.js';
import { chooseThrowAsync, chooseJackThrow, assistJackThrow, idealJackSpeed } from './ai.js';
import { createSwingInput, createSwingGauge } from './input.js';
import { createAudio } from './audio.js';
import * as THREE from '../vendor/three.module.js';
import { createCharacter } from './character.js';

const TEAM_NAMES = ['You & Pierre', 'Marcel & Odette'];
const AIM_MAX = 0.6; // rad of aim either side of straight ahead
const MAX_STEPS = 24; // physics steps per frame; backlog beyond this is dropped
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const AI_MIN_THINK = 800; // ms: the AI never answers faster than this
const HINT_KEY = 'petanque-hint-seen';
const PRECISE_KEY = 'petanque-precise';
const HINT_TEXT = 'Drag sideways to aim. Swipe down then up in the lower part of the court to throw. ' +
  'Let go higher for a lob, stop sharply before letting go for backspin.';

function store(key, value) { // localStorage that never throws
  try {
    if (value === undefined) return globalThis.localStorage.getItem(key);
    globalThis.localStorage.setItem(key, value);
  } catch (e) { /* blocked storage: remember nothing */ }
  return null;
}

const root = document.querySelector('#petanque');
const status = document.querySelector('.petanque-status');
const canvas = document.querySelector('#petanque canvas');
const controls = document.querySelector('.petanque-controls');
const say = (text) => { if (status) status.textContent = text; };

// slider spec: [key, label, min, max, step, default, unit]
const SLIDERS = [
  ['yaw', 'Aim', -35, 35, 0.5, 0, '°'],
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
  const aiRand = mulberry32(seed ^ 0x51ed270b);

  let match = null; // rules state; null until a game starts
  let difficulty = 'medium';
  let instant = false; // autotest: no delays, simulate to rest synchronously
  let token = 0; // bumped on each new game so stale timers are ignored
  let flying = null; // body being tracked
  let throwEvents = []; // physics events of the current throw (hits, for commentary)
  let preThrow = new Map(); // id -> { x, y } of boules before the current throw
  let pending = null; // { kind, playerId } while waiting for the human to throw
  let aimYaw = 0;
  const aimCam = { yaw: 0 }; // shared with the renderer so dragging moves the camera without restarting its transition
  const aimView = () => renderer.setCamera('aim', aimCam);
  const audio = createAudio();
  let thinkToken = 0; // bumped to drop stale partner-suggestion results
  let pierreChoice = null; // cached AI choice for Pierre while the chooser is open
  const pickHuman = params.get('humanturn'); // debug: stop at the human's first boule (or 'chooser')

  // Controls
  const inputs = {};
  const outputs = {};
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
      if (key === 'yaw') setAim(+input.value * DEG, true);
    });
    show();
    row.append(lab, input, out);
    grid.append(row);
    inputs[key] = input;
    outputs[key] = show;
  }
  // Layout: [Precise controls] [mute] [New game] bar, then the optional slider panel
  const bar = document.createElement('div');
  bar.className = 'pc-bar';
  const mkBtn = (parent, text, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = cls;
    parent.append(b);
    return b;
  };
  const toggleBtn = mkBtn(bar, 'Precise controls', 'pc-toggle');
  toggleBtn.setAttribute('aria-controls', 'pc-panel');
  bar.append(audio.createMuteButton());
  const newBtn = mkBtn(bar, 'New game', 'pc-reset');
  const panel = document.createElement('div');
  panel.className = 'pc-panel';
  panel.id = 'pc-panel';
  const buttons = document.createElement('div');
  buttons.className = 'pc-buttons';
  const throwBtn = mkBtn(buttons, 'Throw jack', 'pc-throw');
  panel.append(grid, buttons);
  controls.append(bar, panel);

  function setPrecise(on, remember) {
    panel.hidden = !on;
    toggleBtn.setAttribute('aria-expanded', String(on));
    toggleBtn.classList.toggle('is-on', on);
    if (remember) store(PRECISE_KEY, on ? '1' : '0');
  }
  setPrecise(store(PRECISE_KEY) === '1', false);
  toggleBtn.addEventListener('click', () => setPrecise(panel.hidden, true));

  // Aim from swing drag or slider; the yaw slider mirrors it
  function setAim(yaw, fromSlider) {
    aimYaw = Math.max(-AIM_MAX, Math.min(AIM_MAX, yaw));
    aimCam.yaw = aimYaw;
    if (!fromSlider) {
      inputs.yaw.value = (Math.round(aimYaw / DEG * 2) / 2).toString();
      outputs.yaw();
    }
  }

  // Swing input and gauge sit over the canvas
  const gauge = createSwingGauge(root);
  const swing = createSwingInput(canvas, {
    getAimYaw: () => aimYaw,
    onAim: (dyaw) => setAim(aimYaw + dyaw, false),
    onSwingStart: () => audio.unlock(),
    onSwingUpdate: (state) => { if (pending) gauge.update(state); },
    onThrow: (tp) => {
      gauge.hide();
      if (!pending || flying) return;
      gauge.showGhost(tp);
      humanThrow(pending.kind === 'jack' ? assistJackThrow(tp) : tp);
    },
    onCancel: () => gauge.hide(),
  });

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
    if (on) swing.enable(); else { swing.disable(); gauge.hide(); }
  }
  enableControls(false);

  const hud = createHud(root, document.querySelector('.petanque-hud'), {
    onStart: (opts) => { audio.unlock(); startGame(opts); },
    onNext: () => nextMene(),
    onPlayAgain: () => toSetup(),
    onChoose: (id) => beginTurn(id),
    onHintDismiss: () => store(HINT_KEY, '1'),
  });
  const say2 = hud.say;

  // Head camera framing the jack and live boules within 2 m of it
  function headView(jack, extra, lift) {
    const pts = world.bodies
      .filter((b) => b.kind === 'boule' && !b.dead && Math.hypot(b.x - jack.x, b.y - jack.y) < 2)
      .map((b) => ({ x: b.x, y: b.y }));
    renderer.setCamera('head', { target: { x: jack.x, y: jack.y }, points: pts.concat(extra || []), lift });
  }
  // Landing marks from physics 'land' events
  function markLandings(events) {
    for (const ev of events) {
      if (ev.type === 'land' && ev.speed > 1.5) renderer.addDivot(ev.x, ev.y, 0.035 + 0.05 * Math.min(1, ev.speed / 8));
    }
  }

  const jackBody = () => world.bodies.find((b) => b.kind === 'jack');
  const later = (fn, ms) => {
    const t = token;
    setTimeout(() => { if (t === token) fn(); }, instant ? 0 : ms);
  };

  function clearWorld() {
    world.bodies.length = 0;
    world.events.length = 0;
    terrain.resetDivots();
    renderer.clearDivots();
    renderer.clearMeasure();
    renderer.showJackZone(false);
    throwEvents = [];
    flying = null;
    renderer.sync(world);
  }

  // Launch a body; the frame loop reports when the world settles
  function launchBody(kind, team, owner, p) {
    if (kind === 'jack') {
      const old = jackBody();
      if (old) world.bodies.splice(world.bodies.indexOf(old), 1);
    }
    preThrow = new Map(world.bodies.map((b) => [b.id, { x: b.x, y: b.y }]));
    throwEvents = [];
    renderer.showJackZone(false);
    const body = createBody(kind, { team: kind === 'jack' ? -1 : team, owner });
    world.add(body);
    launch(body, p);
    flying = body;
    renderer.setCamera('flight', { body });
    enableControls(false);
    if (instant) {
      let guard = 0;
      while (!world.settled() && guard++ < 240 * 20) world.step();
      onSettled();
      world.events.length = 0;
    }
    return body;
  }

  // ---- Game flow ----
  function toSetup() {
    token++; thinkToken++; pierreChoice = null;
    match = null; pending = null;
    enableControls(false);
    clearWorld();
    setAim(0, false);
    aimView();
    hud.hideChooser();
    hud.hideHint();
    hud.showSetup({ difficulty });
  }

  function startGame(opts) {
    token++; thinkToken++; pierreChoice = null;
    difficulty = opts.difficulty || 'medium';
    instant = !!opts.instant;
    const players = defaultPlayers();
    if (opts.allAI) for (const p of players) p.isHuman = false;
    match = createMatch({ target: opts.target || 13, players, firstJackTeam: opts.firstJackTeam ?? (Math.random() < 0.5 ? 0 : 1) });
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
    aimView();
    if (thrower.isHuman) {
      humanTurn('jack', thrower.id, lead + 'Your jack. Aim, then swing to throw it between the two yellow lines (6 to 10 metres out). A medium swing works best.');
    } else {
      aiJack(thrower, lead);
    }
  }

  function refreshHud(turn) { hud.update(match, turn); }

  let slidersFor = 'boule';
  function humanTurn(kind, playerId, text) {
    pending = { kind, playerId };
    renderer.showJackZone(kind === 'jack');
    if (kind !== slidersFor) { // slider defaults that suit the jack (light, short) or a boule
      const d = kind === 'jack'
        ? { speed: idealJackSpeed(35 * DEG, 10).toFixed(1), loft: 35, backspin: 10, sidespin: 0 }
        : { speed: 7, loft: 50, backspin: 30, sidespin: 0 };
      for (const k in d) { inputs[k].value = d[k]; outputs[k](); }
      slidersFor = kind;
    }
    throwBtn.textContent = kind === 'jack' ? 'Throw jack' : 'Throw boule';
    enableControls(true);
    aimView();
    say2(text);
    if (pickHuman !== null || store(HINT_KEY) !== '1') hud.showHint(HINT_TEXT);
    if (pickHuman !== null) gauge.update({ height: 0.35, power: 0.6, ceiling: 0.8, phase: 'forward' });
    if (!instant && !panel.hidden) setTimeout(() => throwBtn.focus({ preventScroll: true }), 0);
  }

  function humanThrow(p) {
    if (!pending || flying) return;
    const { kind, playerId } = pending;
    pending = null;
    audio.unlock();
    store(HINT_KEY, '1');
    hud.hideHint();
    doThrow(kind, playerId, p);
  }

  throwBtn.addEventListener('click', () => humanThrow(readParams()));
  newBtn.addEventListener('click', () => {
    if (match) toSetup();
  });

  function doThrow(kind, playerId, p, comment) {
    pierreChoice = null; thinkToken++;
    hud.hideChooser();
    const player = match.players.find((q) => q.id === playerId);
    if (kind === 'boule') match = apply(match, { type: 'bouleThrown', playerId });
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'You are' : player.name + ' is'} throwing…` });
    say2(comment || 'Rolling…');
    launchBody(kind, player.team, playerId, p);
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, instant ? 0 : ms));

  async function aiJack(player, lead) {
    refreshHud({ team: player.team, playerId: player.id, text: `${player.name} throws the jack` });
    say2(`${lead}${player.name} is aiming…`);
    const t = token;
    await sleep(AI_MIN_THINK + 100);
    if (t !== token) return;
    const { throwParams, label } = chooseJackThrow({ world, difficulty, rand: aiRand, player });
    pending = null;
    doThrow('jack', player.id, throwParams, label);
  }

  async function aiBoule(player) {
    say2(`${player.name} is aiming…`);
    const t = token;
    const cached = pierreChoice && pierreChoice.id === player.id ? pierreChoice.choice : null;
    pierreChoice = null;
    let choice;
    try {
      [choice] = await Promise.all([
        cached || chooseThrowAsync({ world, match, player, difficulty, rand: aiRand }),
        sleep(AI_MIN_THINK),
      ]);
    } catch (err) {
      console.error(err);
      if (t !== token) return;
      // fall back to a plain throw at the jack so the game never stalls
      const j = jackBody();
      const yaw = j ? Math.atan2(j.x - C.throwFrom.x, j.y - C.throwFrom.y) : 0;
      choice = { label: `${player.name} throws`, throwParams: { yaw, speed: 6.5, loft: 0.6, backspin: 40, sidespin: 0 } };
    }
    if (t !== token) return;
    say2(choice.label);
    await sleep(700);
    if (t !== token) return;
    doThrow('boule', player.id, choice.throwParams, choice.label);
  }

  // Pierre looks at the court and tells you what he would do
  async function suggest(pierre) {
    const mine = ++thinkToken;
    const t = token;
    let choice;
    try {
      choice = await chooseThrowAsync({ world, match, player: pierre, difficulty, rand: aiRand });
    } catch (err) { return; }
    if (mine !== thinkToken || t !== token) return;
    pierreChoice = { id: pierre.id, choice };
    let text = 'You point, I\'ll keep my boules for shooting.';
    if (choice.intent === 'shoot') {
      const j = jackBody();
      const foes = world.bodies.filter((b) => b.kind === 'boule' && !b.dead && b.team === 1 && j);
      foes.sort((a, b) => Math.hypot(a.x - j.x, a.y - j.y) - Math.hypot(b.x - j.x, b.y - j.y));
      text = foes.length ? `I'd shoot ${ownerName(foes[0])} boule. Want me to?` : 'I\'d like to shoot. Want me to?';
    } else if (choice.intent === 'point') {
      text = 'I can see a good point from here, but you point and I\'ll keep my boules for shooting.';
    }
    hud.setSuggestion(`Pierre: "${text}"`);
    if (pickHuman !== null && pickHuman !== 'chooser') beginTurn('you'); // debug: go straight to the human throw
  }

  // Pick who throws next, from rules.nextTeam()
  function nextTurn() {
    const team = nextTeam(match);
    if (team === null) return; // mène already ended
    const avail = playersWithBoules(match, team);
    if (avail.length > 1 && avail.some((p) => p.isHuman)) {
      refreshHud({ team, playerId: null, text: 'Your team throws next' });
      say2('Your team to play. Who throws?');
      headView(match.jack);
      hud.showChooser(avail, 'Pierre is sizing up the court…');
      const pierre = avail.find((p) => !p.isHuman);
      if (pierre) suggest(pierre);
      return;
    }
    // AI side: whoever holds more boules goes first, the first listed on ties
    const pl = avail.slice().sort((a, b) => b.boulesLeft - a.boulesLeft)[0];
    beginTurn(pl.id);
  }

  function beginTurn(playerId) {
    thinkToken++; // drop a partner suggestion still being computed
    hud.hideChooser();
    const player = match.players.find((p) => p.id === playerId);
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'Your throw' : player.name + ' to throw'}` });
    if (player.isHuman) {
      humanTurn('boule', playerId, 'Your turn. Aim with a sideways drag, then swing to throw.');
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

  // Commentary for the throw that just settled; evs = its physics events
  function describe(was, evs) {
    const j = jackBody();
    if (j && j.dead) return 'The jack is out: dead jack.';
    if (was.kind === 'jack') return `Jack is ${Math.hypot(was.x - C.circle.x, was.y - C.circle.y).toFixed(1)} m out.`;
    if (was.dead) return `${ownerName(was)} boule is out: dead boule.`;
    const gap = Math.hypot(was.x - j.x, was.y - j.y) - was.r - j.r;
    const base = `${ownerName(was)} boule is ${gapText(was, j)} from the jack.`;
    // carreau: the shooter hit an opposing boule, knocked it away and took its place
    for (const ev of evs) {
      if (ev.type !== 'hit' || (ev.a !== was.id && ev.b !== was.id)) continue;
      const tid = ev.a === was.id ? ev.b : ev.a;
      const t = world.bodies.find((b) => b.id === tid), from = preThrow.get(tid);
      if (!t || t.kind !== 'boule' || t.team === was.team || !from) continue;
      const moved = t.dead || Math.hypot(t.x - from.x, t.y - from.y) > 0.15;
      if (moved && Math.hypot(was.x - from.x, was.y - from.y) < 0.3) {
        return `Carreau! ${ownerName(was)} boule replaces the target.`;
      }
    }
    if (gap < 0.02) return `Biberon! ${ownerName(was)} boule is touching the jack.`;
    return base;
  }
  // Edge-to-edge gap, the same figure as the measuring labels at the end of a mène
  const gapCm = (b, j) => Math.max(0, Math.round((Math.hypot(b.x - j.x, b.y - j.y) - b.r - j.r) * 100));
  const gapText = (b, j) => {
    const cm = gapCm(b, j);
    return cm < 100 ? `${cm} cm` : `${(cm / 100).toFixed(2)} m`;
  };
  const ownerName = (b) => {
    const p = match && match.players.find((q) => q.id === b.owner);
    return p ? (p.id === 'you' ? 'Your' : p.name + "'s") : 'The';
  };

  function onSettled() {
    const was = flying;
    flying = null;
    if (!match) { // debug throws outside a game
      const j = jackBody();
      if (j && !j.dead) headView(j);
      else aimView();
      return;
    }
    const evs = throwEvents.concat(world.events);
    if (instant) markLandings(world.events);
    const snap = snapshot();
    const note = describe(was, evs);
    if (was.kind === 'jack') {
      const team = match.jackTeam;
      match = apply(match, { type: 'jackThrown', team, jack: snap.jack });
      if (match.phase === 'jack') { // invalid: the other team throws it
        aimView();
        say2(`${note} Not a legal jack (6 to 10 m, 1 m from the lines). ${TEAM_NAMES[match.jackTeam]} throw it.`);
        later(() => beginMene(false), 1500);
        return;
      }
      headView(snap.jack);
      say2(note + ' Play begins.');
      later(nextTurn, 1400);
      return;
    }
    match = apply(match, { type: 'throwSettled', jack: snap.jack, boules: snap.boules });
    if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
      endOfMene(note);
      return;
    }
    headView(snap.jack);
    say2(note);
    refreshHud(null);
    later(nextTurn, 1500);
  }

  function endOfMene(note) {
    const r = match.result;
    const j = jackBody();
    const jackOut = !j || j.dead;
    if (!jackOut) {
      // measuring tape to every boule that scored, plus the best losing boule
      const items = [];
      if (!r.void && r.measured) {
        const byId = new Map(world.bodies.map((b) => [b.id, b]));
        const best = r.measured.find((m) => byId.get(m.id) && byId.get(m.id).team !== r.team);
        let shown = 0;
        for (const m of r.measured) {
          const b = byId.get(m.id);
          if (!b) continue;
          const scored = b.team === r.team && (!best || m.dist < best.dist);
          if (!scored && m !== best) continue;
          items.push({ x: b.x, y: b.y, scored, label: `${Math.max(0, Math.round((m.dist - b.r - j.r) * 100))} cm` });
          shown++;
        }
        if (shown) renderer.showMeasure(j, items);
      }
      headView(j, items, 0.4); // subject high in the view, clear of the result card
    } else aimView();
    if (r.void && jackOut) note = 'The jack is out: mène void.';
    else if (!jackOut && !r.void && r.measured && r.measured.length) {
      // report the winning boule's gap, the figure on its measuring label
      const win = world.bodies.find((b) => b.id === r.measured[0].id);
      const special = /^(Carreau|Biberon)/.test(note) ? note + ' ' : '';
      if (win) note = `${special}Closest: ${ownerName(win)} boule, ${gapText(win, j)} from the jack.`;
    }
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
    if (instant && !params.has('meneend')) later(() => nextMene(), 0);
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
    if (world.events.length) {
      markLandings(world.events);
      if (flying) throwEvents.push(...world.events.filter((e) => e.type === 'hit'));
      audio.handleEvents(world.events, new Map(world.bodies.map((b) => [b.id, b])));
      world.events.length = 0;
    }
    renderer.sync(world);
    renderer.render(dt);
    requestAnimationFrame(frame);
  }

  aimView();
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
  } else if (debug && pickHuman !== null) {
    // Stop at the human's first boule (or at the chooser with ?humanturn=chooser)
    startGame({ target: 7, difficulty: 'medium', instant: true, firstJackTeam: pickHuman === 'jack' ? 0 : 1 });
  } else if (debug && params.has('characters')) {
    // --- ?debug&characters: stick figures in every stance side by side (for screenshots) ---
    clearWorld();
    hud.hideHint();
    const specs = [
      ['idle', { name: 'Ana', height: 1.62, build: 'slim', stance: 'stand', colors: { shirt: '#c0392b', trousers: '#2c3e50', skin: '#e8b48c' } }],
      ['crouch', { name: 'Marcel', height: 1.7, build: 'stout', stance: 'crouch', colors: { shirt: '#6f8f4e', trousers: '#4b4b55', skin: '#d29b74', hat: '#2d3a55' }, quirks: { hat: 'cap' } }],
      ['stand', { name: 'Odette', height: 1.65, build: 'slim', stance: 'stand', colors: { shirt: '#f2efe6', trousers: '#6b5b8c', skin: '#efc6a4', hat: '#e9d9a0' }, quirks: { hat: 'sunhat' } }],
      ['celebrate', { name: 'Pierre', height: 1.82, build: 'average', stance: 'crouch', colors: { shirt: '#2f6fb5', trousers: '#2b2b2b', skin: '#a8734d' } }],
      ['dismay', { name: 'Lou', height: 1.75, build: 'average', stance: 'stand', colors: { shirt: '#e0a526', trousers: '#4a3b2f', skin: '#c58a63' } }],
      ['watch', { name: 'Max', height: 1.9, build: 'stout', stance: 'stand', colors: { shirt: '#7a3b8f', trousers: '#33414d', skin: '#f0c7a8' } }],
      ['throw', { name: 'Thrower', height: 1.72, build: 'average', stance: params.get('stance') === 'stand' ? 'stand' : 'crouch', colors: { shirt: '#1f9d8b', trousers: '#3b3b3b', skin: '#dba983' } }],
    ];
    const cast = specs.map(([stance, spec], i) => {
      const ch = createCharacter(THREE, spec);
      const x = 0.15 + i * (3.7 / (specs.length - 1));
      ch.setPlacement(x, 3, Math.PI); // facing the camera (-y)
      ch.root.position.z = terrain.sample(x, 3).h;
      renderer.addObject(ch.root);
      if (stance === 'throw') {
        ch.setStance(spec.stance);
        const loop = () => {
          ch.setHolding(true);
          ch.playThrow({ loft: 0.3 + Math.random() * 0.7 }).then(() => setTimeout(loop, 800));
        };
        loop();
      } else ch.setStance(stance);
      if (stance === 'watch') ch.lookAt(2, 0.5, 1.6);
      return ch;
    });
    renderer.setCamera('inspect', { target: { x: 2, y: 3 }, dist: 4.6, az: 0, el: 0.1 });
    let lastC = performance.now();
    const tickC = (now) => {
      const dt = Math.min((now - lastC) / 1000, 0.1); lastC = now;
      for (const ch of cast) ch.update(dt);
      requestAnimationFrame(tickC);
    };
    for (const ch of cast) ch.update(0.5);
    requestAnimationFrame(tickC);
    window.__characters = cast;
  } else if (debug && params.has('preview')) {
    // --- ?debug&preview: static throw preview with made-up paths (for screenshots) ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; world.add(b); return b; };
    put('jack', -1, 2.1, 8.45);
    put('boule', 0, 1.9, 8.3);
    put('boule', 1, 2.3, 8.6);
    renderer.sync(world);
    renderer.setPlayers([
      { id: 'p-you', x: 2, y: 1, yaw: 0, team: 0 },
      { id: 'p-partner', x: 2.6, y: 0.2, yaw: 0, team: 0 },
      { id: 'p-opp1', x: 3.4, y: 1.2, yaw: -0.5, team: 1 },
      { id: 'p-opp2', x: 3.6, y: 0.6, yaw: -0.5, team: 1 },
    ]);
    renderer.setCamera('shoulder', { player: { x: 2, y: 1 }, yaw: 0, zoom: 1 });
    const arc = (x1, y1, peak, n = 40) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({ x: 2 + (x1 - 2) * t, y: 1 + (y1 - 1) * t, z: 0.9 * (1 - t) + 4 * (peak - 0.45) * t * (1 - t) + 0.9 * 0 });
      }
      return pts;
    };
    const ell = (cx, cy, rx, ry) => Array.from({ length: 49 }, (_, i) => ({ x: cx + rx * Math.cos(i / 48 * 6.2832), y: cy + ry * Math.sin(i / 48 * 6.2832), z: 0 }));
    renderer.setThrowPreview({
      center: arc(2.1, 7.5, 2.5),
      edges: [arc(2.22, 7.8, 2.6), arc(1.98, 7.8, 2.6), arc(2.22, 7.2, 2.4), arc(1.98, 7.2, 2.4)],
      ellipse1: ell(2.1, 7.5, 0.12, 0.3),
      ellipse2: ell(2.1, 7.5, 0.24, 0.6),
      roll: [{ x: 2.1, y: 7.5, z: 0 }, { x: 2.13, y: 7.9, z: 0 }, { x: 2.15, y: 8.3, z: 0 }],
      donnee: { x: 2.1, y: 7.5 },
      style: 'demi-portee',
      snapped: params.has('snapped'),
      legalZone: params.has('zone'),
    });
  } else {
    toSetup();
  }
}

// Friendly message in the game area when the game cannot start (no WebGL, etc.)
function showFallback(err) {
  const msg = err && err.message ? err.message : String(err);
  say('Sorry, the game could not start: ' + msg);
  if (!root) return;
  for (const el of root.querySelectorAll('canvas, .petanque-hud, .petanque-controls, .swing-gauge')) el.hidden = true;
  const box = document.createElement('div');
  box.className = 'petanque-fallback';
  const h = document.createElement('p');
  h.className = 'petanque-fallback-title';
  h.textContent = 'The pétanque court is closed for now';
  const p = document.createElement('p');
  p.textContent = 'This game needs WebGL 3D graphics, and your browser or device could not start them. ' +
    'Try another browser or turn on hardware acceleration. In the meantime, ';
  const a = document.createElement('a');
  a.href = root.dataset.linksUrl || '/links/';
  a.textContent = 'read up on pétanque and find a real court on our Links page';
  p.append(a, '.');
  box.append(h, p);
  root.insertBefore(box, root.firstChild);
}

try {
  boot();
} catch (err) {
  showFallback(err);
  console.error(err);
}
