// Game loop: terrain, world, renderer, rules, AI, toss input (donnée throw), audio and HUD wired together.
import { C } from './constants.js';
import { mulberry32 } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch } from './physics.js';
import { createRenderer } from './render.js';
import {
  createMatch, defaultPlayers, apply, nextTeam, playersWithBoules, holdingTeam,
} from './rules.js';
import { createHud } from './hud.js';
import { chooseThrowAsync, chooseJackThrow } from './ai.js';
import { createTossInput } from './toss.js';
import {
  SKILL, scaledSkill, coneFor, coneEnvelope, executeThrow, solveLaunch, predictRoll, styleForLoft, releaseFrom, snapAim, fitToBudget,
} from './donnee.js';
import { createAudio } from './audio.js';
import * as THREE from '../vendor/three.module.js';
import { createCharacter, releaseOffset } from './character.js';
import { attachModels } from './models.js';
import { PERSONALITIES, CAST_IDS, specFor, createCommentary } from './personalities.js';

const TEAM_NAMES = ['You & Pierre', 'Marcel & Odette'];
const AIM_MAX = 0.6; // rad of aim either side of straight ahead
const MAX_STEPS = 24; // physics steps per frame; backlog beyond this is dropped
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const modelTimeout = +params.get('modeltimeout') || 5000; // ms; ?modeltimeout=600000 for virtual-time screenshots
const useMeshes = params.get('figures') === 'mesh'; // stick figures by default; ?figures=mesh loads the Kenney models (opt-in; ?figures=stick is the same as the default)
const AI_MIN_THINK = 800; // ms: the AI never answers faster than this
const HINT_KEY = 'petanque-hint-seen';
const ROLL_KEY = 'petanque-roll-guide';
const HINT_TEXT = 'Drag sideways to turn. Press on the court where you want the boule to land, pull down to throw ' +
  'higher, release to throw; drag back up to cancel. Press near a boule to shoot it.';
const VIEWS = ['shoulder', 'head', 'inspect'];
const VIEW_LABELS = { shoulder: 'Shoulder', head: 'Head', inspect: 'Inspect' };
const ROLL_DEFAULT = { easy: true, medium: false, hard: false };
// Where waiting players stand: behind the circle and beside the court, out of the shoulder camera's view
const HOME = { you: { x: -0.9, y: -0.4 }, pierre: { x: -1.5, y: 0.7 }, marcel: { x: 6.0, y: 0.0 }, odette: { x: 6.8, y: 0.8 } };
const CAST_SPEED = 2.4; // m/s: a brisk walk, so a change of thrower takes about a second
// Looks, stances, quirks and commentary live in personalities.js (GAME-PLAN section 10).
// Team colours: navy trousers for your team, bronze for the opponents.
const SPECS = Object.fromEntries(CAST_IDS.map((id) => [id, specFor(id)]));

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


function boot() {
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' && !isNaN(+seedParam)
    ? +seedParam : Math.floor(Math.random() * 1e9);
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const renderer = createRenderer(canvas, terrain);
  const aiRand = mulberry32(seed ^ 0x51ed270b);
  const talk = createCommentary(mulberry32(seed ^ 0x7a1c0de5)); // personality lines, seeded like everything else
  const chance = mulberry32(seed ^ 0x3c6ef372);

  // ---- Characters: created once, walk between the circle and their waiting spots ----
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cast = new Map(); // id -> character
  for (const id of Object.keys(SPECS)) {
    const ch = createCharacter(THREE, SPECS[id]);
    ch.setStance('watch');
    renderer.addObject(ch.root);
    cast.set(id, ch);
  }
  const CAST_ALL = cast;
  // Skinned meshes load in the background; each character stays a stick figure until its model arrives
  const meshReady = useMeshes
    ? attachModels([...cast.entries()].map(([id, ch]) => ({ ch, model: SPECS[id].model })), modelTimeout) : Promise.resolve([]);
  let inCircle = null; // id of whoever stands in the circle
  let arrival = Promise.resolve(); // resolves when the thrower has reached the circle
  let aiYaw = 0; // facing of an AI thrower (towards the jack), fixed before it plans so the release point matches
  let frozen = false; // ?debug&freezethrow stops the animation at the release frame

  let match = null; // rules state; null until a game starts
  let difficulty = 'medium';
  let instant = false; // autotest: no delays, simulate to rest synchronously
  let token = 0; // bumped on each new game so stale timers are ignored
  let flying = null; // body being tracked
  let throwEvents = []; // physics events of the current throw (hits, for commentary)
  let preThrow = new Map(); // id -> { x, y } of boules before the current throw
  let pending = null; // { kind, playerId } while waiting for the human to throw
  let aimYaw = 0;
  let throwerYaw = 0; // yaw of whoever stands in the circle
  const throwRand = mulberry32(seed ^ 0x2545f491);
  // shared with the renderer so turning moves the camera without restarting its transition
  const shoulderCam = { player: { x: C.circle.x, y: C.circle.y }, yaw: 0 };
  const shoulderView = () => renderer.setCamera('shoulder', shoulderCam);
  const aimView = shoulderView;
  const audio = createAudio();
  let thinkToken = 0; // bumped to drop stale partner-suggestion results
  let pierreChoice = null; // cached AI choice for Pierre while the chooser is open
  const pickHuman = params.get('humanturn'); // debug: stop at the human's first boule (or 'chooser')

  // Controls: [Re-aim] [Roll guide] [View] [mute] [New game] bar; no raw sliders
  controls.textContent = '';
  const mkBtn = (parent, text, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = cls;
    parent.append(b);
    return b;
  };
  const bar = document.createElement('div');
  bar.className = 'pc-bar';
  const reaimBtn = mkBtn(bar, 'Re-aim', 'pc-reaim');
  const rollBtn = mkBtn(bar, 'Roll guide', 'pc-roll');
  const viewBtn = mkBtn(bar, 'View: Shoulder', 'pc-view');
  bar.append(audio.createMuteButton());
  const newBtn = mkBtn(bar, 'New game', 'pc-reset');
  const exitBtn = mkBtn(bar, 'Exit', 'pc-exit'); // leaves the full-window view (only shown while playing)
  controls.append(bar);
  if (debug && params.has('sounds')) {
    // ?debug&sounds panel sits in a collapsible drawer: below the game on the page, an overlay while playing
    const drawer = document.createElement('details');
    drawer.className = 'pc-debug';
    drawer.open = !params.has('play');
    const sum = document.createElement('summary');
    sum.textContent = 'Sounds';
    drawer.append(sum); // ?debug&sounds: audition panel for the synthesized sound effects
    const panel = document.createElement('div');
    panel.className = 'pc-bar pc-sounds';
    panel.style.flexWrap = 'wrap';
    const SOUNDS = [
      ['Boule lands (soft)', 'land', { speed: 1.5 }], ['Boule lands (hard)', 'land', { speed: 7 }],
      ['Boule rolls 2 s (slow)', 'roll', { speed: 0.6, dur: 2 }], ['Boule rolls 2 s (fast)', 'roll', { speed: 4, dur: 2, decay: 0.9 }],
      ['Jack rolls 2 s', 'roll', { kind: 'jack', speed: 1.5, dur: 2 }],
      ['Jack lands', 'jackLand', {}], ['Jack hit by boule', 'jackHit', {}],
      ['Boules graze', 'graze', {}], ['Boules hit direct', 'direct', {}], ['Carreau', 'carreau', {}],
    ];
    for (const [label, name, p] of SOUNDS) {
      mkBtn(panel, label, 'pc-sound').addEventListener('click', () => { audio.unlock(); audio.play(name, p); });
    }
    drawer.append(panel);
    controls.append(drawer);
  }
  // Aim: toss turns the shared camera options; the debug yaw slider mirrors it
  function setAim(yaw) {
    aimYaw = Math.max(-AIM_MAX, Math.min(AIM_MAX, yaw));
    shoulderCam.yaw = aimYaw;
    throwerYaw = aimYaw;
    const me = cast.get('you');
    if (pending && inCircle === 'you' && !me.busy) me.yaw = aimYaw;
  }

  // Release point of a player's boule: where that character's hand will be at the release frame for this loft,
  // facing their aim. Without a loft it returns a base for the AI ({ x, y, release(loft) }), see donnee.releaseFrom.
  const faceYaw = (id) => (id === 'you' ? aimYaw : aiYaw);
  function handFrom(id, loft, yaw) {
    const spec = SPECS[id];
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw, model: cast.get(id).isMesh ? spec.model : null });
    return { x: C.circle.x + o.x, y: C.circle.y + o.y, z: terrain.sample(C.circle.x, C.circle.y).h + o.z };
  }
  function releasePoint(player, loft) {
    const id = player ? player.id : 'you';
    const yaw = faceYaw(id);
    if (loft === undefined) return { x: C.circle.x, y: C.circle.y, release: (l) => handFrom(id, l, yaw) };
    return handFrom(id, loft, yaw);
  }

  // default raw throw for the debug hooks (window.__petanque.throw / throwJack)
  const readParams = () => ({ yaw: aimYaw, speed: 7, loft: 0.9, backspin: 30, sidespin: 0 });

  // ---- Throw preview and toss input ----
  let rollGuide = false;
  let rollOverride = store(ROLL_KEY); // '1' | '0' | null
  let lastToss = null; // last onPreview payload, to redraw when the roll guide toggles
  const roll = { key: '', path: null, t: 0, timer: 0 };
  const demo = debug && params.has('demo');

  function applyRollDefault() {
    rollGuide = rollOverride === '1' ? true : rollOverride === '0' ? false : !!ROLL_DEFAULT[difficulty];
    rollBtn.classList.toggle('is-on', rollGuide);
    rollBtn.setAttribute('aria-pressed', String(rollGuide));
  }

  // The toss donnée pulled in to what the human's arm can deliver at this loft (D02)
  function fitToss(t, from) {
    const want = t.snappedTo ? snapAim(from, t.donnee) : t.donnee; // a tir lands just short of its target
    const fit = fitToBudget({ from, landing: want, loft: t.loft, skill: SKILL.human, terrain: world.terrain });
    return { landing: fit.landing, clamped: fit.clamped, energyFrac: fit.energyFrac };
  }
  let reachShown = false;

  // Draw the preview for a toss state { donnee, loft, snappedTo }
  function showToss(t, kind) {
    const from = releasePoint(null, t.loft);
    const { landing, clamped, energyFrac } = fitToss(t, from);
    if (clamped !== reachShown) {
      reachShown = clamped;
      if (clamped) say2(`Max reach: about ${Math.hypot(landing.x - from.x, landing.y - from.y).toFixed(1)} m at this loft. Throw lower to go farther.`);
    }
    const cone = coneFor({ skill: SKILL.human, from, landing, loft: t.loft, energyFrac });
    const env = coneEnvelope({ from, landing, loft: t.loft, cone, terrain: world.terrain });
    let path = null;
    // the jack rolls on a metre or more after landing, so its guide is on unless the player turned guides off
    if (rollGuide || (kind === 'jack' && rollOverride !== '0')) {
      const key = `${landing.x.toFixed(3)},${landing.y.toFixed(3)},${t.loft.toFixed(4)},${kind}`;
      const now = performance.now();
      if (key === roll.key) path = roll.path;
      else if (now - roll.t >= 100) {
        const throwParams = solveLaunch({ from, landing, loft: t.loft, terrain: world.terrain });
        const full = predictRoll({ world, terrain, throwParams, from, kind: kind === 'jack' ? 'jack' : 'boule' });
        // the guide starts where the boule first touches down, not in the air
        const hit = full.findIndex((q) => q.z <= terrain.sample(q.x, q.y).h + 0.1);
        path = hit < 0 ? [] : full.slice(hit);
        roll.key = key; roll.path = path; roll.t = now;
        clearTimeout(roll.timer); roll.timer = 0;
      } else { // throttled: keep the last guide and refresh shortly
        path = roll.path;
        clearTimeout(roll.timer);
        roll.timer = setTimeout(() => { roll.timer = 0; if (lastToss === t) showToss(t, kind); }, 110);
      }
    }
    renderer.setThrowPreview({
      ...env, roll: path, donnee: clamped ? landing : t.donnee, style: styleForLoft(t.loft, !!t.snappedTo),
      snapped: !!t.snappedTo && !clamped, legalZone: kind === 'jack',
    });
  }
  function clearToss() {
    lastToss = null; reachShown = false;
    clearTimeout(roll.timer); roll.timer = 0;
    renderer.setThrowPreview(null);
    renderer.showJackZone(!!pending && pending.kind === 'jack' && !flying);
  }

  const toss = createTossInput(canvas, {
    pick: (x, y) => renderer.pick(x, y),
    getYaw: () => aimYaw,
    getOrigin: () => C.circle,
    onTurn: (dyaw) => setAim(aimYaw + dyaw),
    onPreview: (t) => {
      if (!pending || flying) return;
      audio.unlock();
      if (t.cancel) { lastToss = null; clearToss(); return; }
      lastToss = t;
      showToss(t, pending.kind);
    },
    onThrow: (t) => humanToss(t),
    onCancel: () => clearToss(),
    targets: () => world.bodies.filter((b) => !b.dead).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r })),
  });

  function humanToss(t) {
    if (!pending || flying) { toss.setPhase('off'); return; }
    const from = releasePoint(null, t.loft);
    const { landing, energyFrac } = fitToss(t, from);
    const cone = coneFor({ skill: SKILL.human, from, landing, loft: t.loft, energyFrac });
    const res = executeThrow({ from, landing, loft: t.loft, cone, terrain: world.terrain, rand: throwRand });
    clearToss();
    humanThrow(res.throwParams, from, t.loft);
  }

  function enableControls(on) {
    toss.setPhase(on ? 'aim' : 'off');
    reaimBtn.hidden = !on;
    rollBtn.hidden = !on;
    viewBtn.hidden = !on;
    if (!on) clearToss();
  }
  enableControls(false);

  // View cycling: shoulder, head, inspect
  let view = 'shoulder';
  function setView(v) {
    view = v;
    viewBtn.textContent = 'View: ' + VIEW_LABELS[v];
    const j = jackBody();
    const target = j && !j.dead ? { x: j.x, y: j.y } : { x: 2, y: 8 };
    if (v === 'shoulder') shoulderView();
    else if (v === 'head') headView(j && !j.dead ? j : { x: 2, y: 8 });
    else renderer.setCamera('inspect', { target, dist: 3, az: 0, el: 0.6 });
    if (pending && !flying) toss.setPhase(v === 'inspect' ? 'off' : 'aim');
  }
  viewBtn.addEventListener('click', () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]));
  reaimBtn.addEventListener('click', () => {
    if (!pending || flying) return;
    clearToss();
    if (view !== 'shoulder') setView('shoulder');
    toss.setPhase('aim');
  });
  rollBtn.addEventListener('click', () => {
    rollGuide = !rollGuide;
    rollOverride = rollGuide ? '1' : '0';
    store(ROLL_KEY, rollOverride);
    rollBtn.classList.toggle('is-on', rollGuide);
    rollBtn.setAttribute('aria-pressed', String(rollGuide));
    roll.key = '';
    if (lastToss && pending) showToss(lastToss, pending.kind);
  });
  rollBtn.setAttribute('aria-pressed', 'false');

  const hud = createHud(root, document.querySelector('.petanque-hud'), {
    onStart: (opts) => { audio.unlock(); setPlaying(true, true); startGame(opts); },
    onNext: () => nextMene(),
    onPlayAgain: () => toSetup(),
    onResume: () => setPlaying(true, true),
    onNewGame: () => { setPlaying(true, true); toSetup(); },
    onChoose: (id) => beginTurn(id),
    onHintDismiss: () => store(HINT_KEY, '1'),
  });
  const say2 = hud.say;

  // ---- Cast movement ----
  const snapMove = () => instant || reduceMotion(); // no walking: teleport
  const homeYaw = (id) => Math.atan2(C.circle.x - HOME[id].x, 6 - HOME[id].y);
  function placeAt(id, x, y, yaw) {
    const ch = cast.get(id);
    ch.setPlacement(x, y, yaw);
    ch.root.position.z = terrain.sample(x, y).h;
  }
  // Waiting players cast no shadow: the low sun would throw theirs into the shoulder view
  const shadow = (id, on) => cast.get(id).root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  function walkOut(id) { // to a waiting spot, then watch
    const ch = cast.get(id), h = HOME[id];
    shadow(id, false);
    ch.setHolding(false);
    ch.setStance('watch');
    if (snapMove()) placeAt(id, h.x, h.y, homeYaw(id));
    else ch.walkTo({ x: h.x, y: h.y, yaw: homeYaw(id), speed: CAST_SPEED });
  }
  // Everyone to their waiting spot at once (new mène, new game)
  function resetCast() {
    inCircle = null;
    for (const id of cast.keys()) {
      const ch = cast.get(id);
      ch.setHolding(false); ch.setStance('watch'); shadow(id, false);
      placeAt(id, HOME[id].x, HOME[id].y, homeYaw(id));
    }
  }
  // The thrower walks into the circle (the previous one walks out); returns a promise for the arrival
  function enterCircle(id, yaw, snap) {
    const ch = cast.get(id), c = C.circle;
    if (inCircle && inCircle !== id) walkOut(inCircle);
    inCircle = id;
    shadow(id, true);
    for (const [oid, och] of cast) if (oid !== id && oid !== inCircle && !och.busy) och.setStance('watch');
    ch.setStance(SPECS[id].stance);
    ch.setHolding(true);
    const here = Math.hypot(ch.root.position.x - c.x, ch.root.position.y - c.y) < 0.05;
    if (here || snap || snapMove()) {
      placeAt(id, c.x, c.y, yaw);
      arrival = Promise.resolve();
    } else {
      const t = token;
      arrival = ch.walkTo({ x: c.x, y: c.y, yaw, speed: CAST_SPEED }).then(() => {
        if (t === token && inCircle === id) ch.yaw = faceYaw(id);
      });
    }
    return arrival;
  }
  // Setup screen and debug views: the human crouched in the circle, the others waiting
  function placePlayers(throwerId) {
    resetCast();
    enterCircle(throwerId, 0, true);
  }

  // Throw animation drives the launch: go() runs at the release frame (the boule leaves the hand)
  async function throwWith(id, loft, go) {
    const ch = cast.get(id), t = token;
    await arrival;
    if (t !== token) return;
    ch.setHolding(true);
    if (!ch.busy) ch.yaw = faceYaw(id);
    let released = false;
    const done = ch.playThrow({
      loft,
      onRelease: () => {
        released = true;
        if (t !== token) return;
        if (debug && params.has('freezethrow')) { frozen = true; return; }
        go();
      },
    });
    await done;
    if (!released && t === token) go(); // the animation was cut short: still throw
  }

  // Per frame: animate, keep feet on the terrain, everyone watches the boule in flight (or the jack)
  function tickCast(dt) {
    if (frozen) return;
    const thrower = inCircle && cast.get(inCircle);
    shoulderCam.wide = thrower && thrower.isMesh ? 1.45 : 1;
    const w = flying && !flying.dead ? flying : jackBody();
    for (const ch of cast.values()) {
      const p = ch.root.position;
      p.z = terrain.sample(p.x, p.y).h;
      if (w) ch.lookAt(w.x, w.y, Math.max(0.3, w.z)); else ch.lookAt(null);
      ch.update(dt);
    }
  }

  // After a throw settles: celebrate a point gained, dismay for a poor throw, otherwise watch
  function react(was, prevHold) {
    if (instant || !was || was.kind !== 'boule' || !match) return;
    const j = jackBody(), now = holdingTeam(match.jack, match.boules);
    const gap = j ? Math.hypot(was.x - j.x, was.y - j.y) - was.r - j.r : 9;
    let mood = 'watch';
    if (was.dead) mood = 'dismay';
    else if (prevHold === null) mood = gap < 0.3 ? 'celebrate' : gap > 1 ? 'dismay' : 'watch'; // the first boule of a mène takes the point by default: judge it by distance
    else if (now === was.team && prevHold !== was.team) mood = 'celebrate';
    else if (now !== was.team && gap > 0.6) mood = 'dismay';
    const shown = [];
    for (const p of match.players) {
      const ch = cast.get(p.id);
      let m = 'watch';
      if (p.id === was.owner) m = mood;
      else if (mood === 'celebrate') m = p.team === was.team ? 'celebrate' : 'dismay';
      if (p.id === inCircle && m === 'watch') continue; // keep the thrower's follow-through
      ch.setStance(m);
      if (m !== 'watch' && (p.id === was.owner || p.team === was.team)) shown.push(ch.root.position);
    }
    // cut to the thrower (and a reacting team-mate) for a moment so the reaction can be seen
    later(() => {
      if (pending || flying) return;
      const pts = shown.length ? shown : [cast.get(inCircle || was.owner).root.position];
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      renderer.setCamera('inspect', {
        target: { x: cx, y: cy }, dist: 3.8, az: Math.PI, el: 0.12, height: 0.9, reset: true,
        fit: (Math.max(...xs) - Math.min(...xs)) / 2 + 1.1,
      });
    }, 800);
  }

  // Mène end or game over: gather by the jack; the winners celebrate, the others are dismayed
  function gather(winTeam) {
    if (instant && !(debug && params.has('meneend'))) return; // ?debug&meneend shows the gathering in instant matches
    const j = jackBody(), c = j && !j.dead ? j : { x: 2, y: 8 };
    const slots = [[-2.3, 1.0], [-3.0, 1.9], [2.3, 1.0], [3.0, 1.9]]; // beyond the jack, to the sides
    const n = [0, 0];
    for (const p of match.players) {
      const ch = cast.get(p.id), k = n[p.team]++;
      const [dx, dy] = slots[p.team * 2 + k];
      const x = c.x + dx, y = c.y + dy;
      ch.setHolding(false); shadow(p.id, true);
      ch.setStance(winTeam === null || winTeam === undefined ? 'watch' : p.team === winTeam ? 'celebrate' : 'dismay');
      if (p.id === inCircle) inCircle = null;
      const yaw = Math.atan2(c.x - x, c.y - y);
      if (snapMove()) placeAt(p.id, x, y, yaw);
      else ch.walkTo({ x, y, yaw, speed: CAST_SPEED });
    }
    // After a moment on the head view (measuring labels), a low angled shot from the circle side shows the
    // boules by the jack with the four players gathering behind them; the steep head camera shows only legs
    later(() => { // (instant debug matches cut straight to it)
      if (!match || (match.phase !== 'meneEnd' && match.phase !== 'gameOver')) return;
      renderer.setCamera('inspect', { target: { x: c.x, y: c.y - 0.2 }, dist: 5.5, az: 0, el: 0.4, height: 0.2, reset: true, fit: 3.4 });
    }, 2200);
  }

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
  function launchBody(kind, team, owner, p, from) {
    if (kind === 'jack') {
      const old = jackBody();
      if (old) world.bodies.splice(world.bodies.indexOf(old), 1);
    }
    preThrow = new Map(world.bodies.map((b) => [b.id, { x: b.x, y: b.y }]));
    throwEvents = [];
    renderer.showJackZone(false);
    const body = createBody(kind, { team: kind === 'jack' ? -1 : team, owner });
    world.add(body);
    launch(body, p, from || C.throwFrom);
    flying = body;
    clearToss();
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
    setAim(0);
    placePlayers(debug && SPECS[params.get('who')] ? params.get('who') : 'you');
    aimView();
    if (debug && params.has('topcam')) { // ?debug&topcam[&who=pierre]: top-down on the circle, for checking foot placement
      renderer.setCamera('inspect', { target: { x: C.circle.x, y: C.circle.y }, dist: +params.get('topdist') || 2.2, az: +params.get('topaz') || 0, el: +params.get('topel') || 1.5, height: +params.get('topheight') || 0 });
      cast.get(inCircle).setStance(SPECS[inCircle].stance);
    }
    hud.hideChooser();
    hud.hideHint();
    hud.showPaused(false);
    hud.showSetup({ difficulty, cast: ['pierre', 'marcel', 'odette'].map((id) => ({ name: PERSONALITIES[id].name, bio: PERSONALITIES[id].bio, team: PERSONALITIES[id].team })) });
    if (debug && params.has('topcam')) hud.hideOverlay();
  }

  function startGame(opts) {
    token++; thinkToken++; pierreChoice = null;
    difficulty = opts.difficulty || 'medium';
    applyRollDefault();
    instant = !!opts.instant;
    const players = defaultPlayers();
    // all-AI debug matches: nobody is "You", so the commentary grammar ("Sam points", "Sam's boule") still works
    if (opts.allAI) for (const p of players) { p.isHuman = false; if (p.id === 'you') p.name = 'Sam'; }
    match = createMatch({ target: opts.target || 13, players, firstJackTeam: opts.firstJackTeam ?? (Math.random() < 0.5 ? 0 : 1) });
    hud.hideOverlay();
    beginMene(true);
  }

  function beginMene(first) {
    clearWorld();
    resetCast();
    pending = null;
    hud.hideChooser();
    const team = match.jackTeam;
    const thrower = (debug && match.players.find((p) => p.id === params.get('thrower') && p.team === team)) ||
      match.players.find((p) => p.team === team && (p.isHuman || team === 1)) ||
      match.players.find((p) => p.team === team);
    const lead = first ? `${TEAM_NAMES[team]} won the toss. ` : '';
    refreshHud({ team, playerId: thrower.id, text: `${thrower.isHuman ? 'You' : thrower.name} throw${thrower.isHuman ? '' : 's'} the jack` });
    aimView();
    if (thrower.isHuman) {
      humanTurn('jack', thrower.id, lead + 'Your jack. Aim, then toss it onto the court between the two yellow lines (6 to 10 metres out). It rolls on after landing: aim so the orange dashes end inside the zone.');
    } else {
      aiJack(thrower, lead).catch((err) => console.error(err));
    }
  }

  function refreshHud(turn) { hud.update(match, turn); }

  function humanTurn(kind, playerId, text) {
    pending = { kind, playerId };
    renderer.showJackZone(kind === 'jack');
    enterCircle(playerId, aimYaw);
    enableControls(true);
    setView('shoulder');
    say2(text);
    if (pickHuman !== null || store(HINT_KEY) !== '1') hud.showHint(HINT_TEXT);
    if (demo) { // ?debug&humanturn&demo: a scripted toss preview for screenshots
      rollGuide = true;
      rollBtn.classList.add('is-on');
      // &loft=15 (degrees), &dist=7 (m ahead of the circle), &dx=0.9 (m across), &tir (snap onto the jack)
      const jb = jackBody();
      const tir = params.has('tir') && jb;
      lastToss = {
        donnee: tir ? { x: jb.x, y: jb.y } : { x: C.circle.x + (+params.get('dx') || 0.9), y: C.circle.y + (+params.get('dist') || 7) },
        loft: (+params.get('loft') || 40) * DEG, snappedTo: tir ? jb.id : null,
      };
      showToss(lastToss, kind);
      if (params.has('autothrow') && !humanTurn.auto) setTimeout(() => { humanTurn.auto = true; humanToss(lastToss); }, 2500); // screenshots of the throw
    }
  }

  function humanThrow(p, from, loft) {
    if (!pending || flying) return;
    const { kind, playerId } = pending;
    pending = null;
    audio.unlock();
    store(HINT_KEY, '1');
    hud.hideHint();
    doThrow(kind, playerId, p, undefined, from, loft);
  }

  newBtn.addEventListener('click', () => {
    if (match) toSetup();
  });

  // ---- Full-window view: a fixed layer over the page while playing ----
  let playing = false;
  let savedScroll = 0;
  const html = document.documentElement;
  const fsSupported = !!(root.requestFullscreen);
  function logScroll(tag) { // ?debug: report whether the page can scroll while playing
    if (!debug) return;
    const se = document.scrollingElement || html;
    console.log(`[play] ${tag} playing=${playing} scrollHeight=${se.scrollHeight} innerHeight=${window.innerHeight} scrollWidth=${se.scrollWidth} innerWidth=${window.innerWidth} canvas=${canvas.clientWidth}x${canvas.clientHeight}`);
  }
  function setPlaying(on, gesture) {
    if (on === playing) {
      if (on && gesture && fsSupported && !document.fullscreenElement) tryFullscreen();
      return;
    }
    playing = on;
    if (on) savedScroll = window.scrollY;
    root.classList.toggle('is-playing', on);
    html.classList.toggle('petanque-playing', on);
    hud.showPaused(!on && !!match);
    exitBtn.hidden = !on;
    if (on) {
      window.scrollTo(0, 0);
      if (gesture && fsSupported) tryFullscreen();
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      window.scrollTo(0, savedScroll);
      if (match) root.scrollIntoView({ block: 'start' });
    }
    renderer.resize();
    requestAnimationFrame(() => { renderer.resize(); logScroll(on ? 'enter' : 'leave'); });
  }
  function tryFullscreen() {
    try {
      const p = root.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => { /* rejected (iframe, iOS): the fixed layer is enough */ });
    } catch (_) { /* ignore */ }
  }
  exitBtn.hidden = true;
  exitBtn.addEventListener('click', () => setPlaying(false));
  window.addEventListener('keydown', (e) => {
    // Esc leaves the view, unless the browser is in fullscreen (it handles that Esc) or a toss used the key
    if (e.key !== 'Escape' || !playing || e.defaultPrevented || document.fullscreenElement) return;
    setPlaying(false);
  });
  document.addEventListener('fullscreenchange', () => { renderer.resize(); logScroll('fullscreenchange'); });
  window.addEventListener('resize', () => { renderer.resize(); if (playing) logScroll('resize'); });
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 200));

  function doThrow(kind, playerId, p, comment, from, loft) {
    pierreChoice = null; thinkToken++;
    hud.hideChooser();
    const player = match.players.find((q) => q.id === playerId);
    const t0 = token;
    if (kind === 'boule') match = apply(match, { type: 'bouleThrown', playerId });
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'You are' : player.name + ' is'} throwing…` });
    say2(comment || 'Rolling…');
    let launched = false; // the boule leaves once, whichever of the release frame, the fallback or the error path gets there first
    const go = () => { if (launched) return; launched = true; launchBody(kind, player.team, playerId, p, from); };
    if (instant || !loft) go();
    else throwWith(playerId, loft, go).catch((err) => { console.error(err); if (!launched && token === t0) go(); });
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, instant ? 0 : ms));

  async function aiJack(player, lead) {
    refreshHud({ team: player.team, playerId: player.id, text: `${player.name} throws the jack` });
    say2(`${lead}${player.name} is aiming…`);
    const t = token;
    await sleep(AI_MIN_THINK + 100);
    if (t !== token) return;
    aiYaw = 0;
    const base = releasePoint(player);
    enterCircle(player.id, aiYaw);
    let choice;
    try {
      choice = chooseJackThrow({ world, difficulty, rand: aiRand, player, from: base });
    } catch (err) { // never stall the game: a plain lob to about 8 m
      console.error(err);
      choice = { label: `${player.name} throws the cochonnet`, throwParams: { yaw: 0, speed: 5, loft: 0.9, backspin: 10, sidespin: 0 } };
    }
    pending = null;
    const spot = spotText(player, choice, 'jack');
    await showAiSpot(player, choice, 'jack', spot);
    if (t !== token) return;
    doThrow('jack', player.id, choice.throwParams, spot, choice.from, choice.loft);
  }

  // Show the AI's donnée and arc for a moment before it throws
  async function showAiSpot(player, choice, kind, spot) {
    if (instant || !choice.donnee) return;
    const from = choice.from || releasePoint(player, choice.loft);
    const t = token;
    const yaw = Math.atan2(choice.donnee.x - from.x, choice.donnee.y - from.y);
    throwerYaw = yaw;
    shoulderCam.yaw = yaw;
    shoulderView();
    const skill = scaledSkill(SKILL[player.id] || SKILL.human, difficulty);
    const cone = coneFor({ skill, from, landing: choice.donnee, loft: choice.loft, energyFrac: choice.energyFrac });
    const env = coneEnvelope({ from, landing: choice.donnee, loft: choice.loft, cone, terrain: world.terrain });
    const snapped = choice.style === 'tir';
    renderer.setThrowPreview({
      ...env, roll: null, donnee: choice.donnee, style: choice.style || styleForLoft(choice.loft, snapped),
      snapped, legalZone: kind === 'jack',
    });
    say2(spot);
    await sleep(debug && params.has('aispot') ? 1e8 : 1100); // ?debug&aispot holds the view for screenshots
    if (t === token) { renderer.setThrowPreview(null); renderer.showJackZone(false); }
    shoulderCam.yaw = aimYaw;
  }

  // Status line while an AI shows its spot: the factual label and distance, then the player's own line.
  // The distance is where the throw lands (the donnée); a jack rolls on after landing, so its line also gives the
  // distance it should come to rest at (noiseless prediction), and the settled distance is reported afterwards.
  function spotText(player, choice, kind) {
    const key = choice.labelKey || { event: kind === 'jack' ? 'spotJack' : 'spotPoint' };
    const dist = (q) => Math.hypot(q.x - C.circle.x, q.y - C.circle.y);
    const target = key.target === 'jack' ? 'the jack' : player.team === 1 ? 'your boule' : 'their boule';
    let tail = '.';
    if (choice.donnee && kind === 'jack' && choice.from) {
      const tp = solveLaunch({ from: choice.from, landing: choice.donnee, loft: choice.loft, terrain: world.terrain });
      const path = predictRoll({ world, terrain, throwParams: tp, from: choice.from, kind: 'jack' });
      const end = path[path.length - 1];
      tail = ` (lands at ${dist(choice.donnee).toFixed(1)} m, should roll to about ${dist(end).toFixed(1)} m).`;
    } else if (choice.donnee) tail = ` (lands at ${dist(choice.donnee).toFixed(1)} m).`;
    const facts = (choice.label || `${player.name} picks ${player.id === 'odette' ? 'her' : 'his'} spot`) + tail;
    const quip = talk.say(player.id, key.event, { target });
    return quip ? `${facts} ${quip}` : facts;
  }

  async function aiBoule(player) {
    say2(`${player.name} is aiming…`);
    const t = token;
    const jk = jackBody();
    aiYaw = jk && !jk.dead ? Math.atan2(jk.x - C.circle.x, jk.y - C.circle.y) : 0;
    const base = releasePoint(player);
    enterCircle(player.id, aiYaw);
    const cached = pierreChoice && pierreChoice.id === player.id ? pierreChoice.choice : null;
    pierreChoice = null;
    let choice;
    try {
      [choice] = await Promise.all([
        cached || chooseThrowAsync({ world, match, player, difficulty, rand: aiRand, from: base }),
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
    if (!instant) say2(choice.label);
    const spot = instant ? choice.label : spotText(player, choice, 'boule');
    if (!instant) await showAiSpot(player, choice, 'boule', spot);
    else await sleep(700);
    if (t !== token) return;
    doThrow('boule', player.id, choice.throwParams, spot, choice.from, choice.from ? choice.loft : undefined);
  }

  // Planning base for an AI that is not (yet) in the circle: facing the jack
  function aiBase(player) {
    const jk = jackBody(), c = C.circle;
    const yaw = jk && !jk.dead ? Math.atan2(jk.x - c.x, jk.y - c.y) : 0;
    return { x: c.x, y: c.y, release: (l) => handFrom(player.id, l, yaw) };
  }

  // Pierre looks at the court and tells you what he would do
  async function suggest(pierre) {
    const mine = ++thinkToken;
    const t = token;
    let choice;
    try {
      choice = await chooseThrowAsync({ world, match, player: pierre, difficulty, rand: aiRand, from: aiBase(pierre) });
    } catch (err) { return; }
    if (mine !== thinkToken || t !== token) return;
    pierreChoice = { id: pierre.id, choice };
    const j = jackBody();
    const foes = world.bodies.filter((b) => b.kind === 'boule' && !b.dead && b.team === 1 && j);
    foes.sort((a, b) => Math.hypot(a.x - j.x, a.y - j.y) - Math.hypot(b.x - j.x, b.y - j.y));
    const mineHold = j && holdingTeam(match.jack, match.boules) === 0;
    let event = 'suggestYou', target = 'the jack', fact = '';
    if (choice.intent === 'shoot') {
      event = 'suggestShoot';
      if (foes.length) { target = `${ownerName(foes[0])} boule`; fact = ` (${target} is ${gapText(foes[0], j)} from the jack.)`; }
    } else if (choice.intent === 'point' && !mineHold) event = 'suggestPoint';
    hud.setSuggestion(`${talk.say('pierre', event, { target })}${fact}`);
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
      humanTurn('boule', playerId, 'Your turn. Turn with a sideways drag, then press where you want the boule to land.');
    } else {
      aiBoule(player).catch((err) => console.error(err));
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
  let lastKind = null; // 'dead' | 'carreau' | 'great' | null, set by describe() for the personality lines
  function describe(was, evs) {
    const j = jackBody();
    lastKind = null;
    if (j && j.dead) return 'The jack is out: dead jack.';
    if (was.kind === 'jack') return `Jack is ${Math.hypot(was.x - C.circle.x, was.y - C.circle.y).toFixed(1)} m out.`;
    if (was.dead) lastKind = 'dead';
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
        lastKind = 'carreau';
        return `Carreau! ${ownerName(was)} boule replaces the target.`;
      }
    }
    if (gap < 0.02) lastKind = 'great';
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
    return p ? (p.isHuman ? 'Your' : p.name + "'s") : 'The';
  };

  // One or two personality lines for the throw that just settled (null when nothing fits)
  const pick = (team) => {
    const ids = match.players.filter((p) => p.team === team && !p.isHuman).map((p) => p.id);
    return ids[Math.floor(chance() * ids.length)] || null;
  };
  function quip(was, prevHold) {
    const j = jackBody(), now = holdingTeam(match.jack, match.boules);
    const gap = j ? Math.hypot(was.x - j.x, was.y - j.y) - was.r - j.r : 9;
    const owner = match.players.find((p) => p.id === was.owner);
    if (!owner) return '';
    const gained = now === was.team && prevHold !== was.team;
    let ev = lastKind;
    if (!ev) ev = gained || gap < 0.25 ? 'good' : now !== was.team && gap > 0.6 ? 'miss' : null;
    if (!ev) return '';
    const out = [];
    if (owner.isHuman) { // you have no catchphrases: your partner cheers your points, a neutral line otherwise
      const cheer = gained || ev === 'great' || ev === 'carreau';
      out.push(cheer ? talk.say('pierre', 'ownScores') : talk.line('you', ev));
    } else out.push(talk.say(owner.id, ev));
    if (gained && chance() < 0.5) { // the other side reacts to losing the point
      const foe = pick(1 - was.team);
      if (foe && foe !== owner.id) out.push(talk.say(foe, 'oppScores'));
    }
    return out.filter(Boolean).join(' ');
  }

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
    const prevHold = holdingTeam(match.jack, match.boules);
    match = apply(match, { type: 'throwSettled', jack: snap.jack, boules: snap.boules });
    if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
      endOfMene(note);
      return;
    }
    headView(snap.jack);
    const remark = quip(was, prevHold);
    say2(remark ? `${note} ${remark}` : note);
    refreshHud(null);
    react(was, prevHold);
    later(nextTurn, instant ? 0 : 1800);
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
    gather(r.void ? null : r.team);
    let text, detail = note;
    if (r.void) text = 'Void mène: no points';
    else {
      const names = TEAM_NAMES[r.team];
      text = `${names} score ${r.points} point${r.points === 1 ? '' : 's'}`;
      if (r.team === 0) text = `You & Pierre score ${r.points} point${r.points === 1 ? '' : 's'}`;
    }
    // the scoring side's player and one on the other side say their piece (nobody speaks for a void mène)
    const voices = (won, lost) => {
      if (r.void) return '';
      const w = pick(r.team), l = pick(1 - r.team);
      return [w && talk.say(w, won), l && talk.say(l, lost)].filter(Boolean).join(' ');
    };
    if (match.phase === 'gameOver') {
      const win = match.winner;
      const lines = [pick(win), pick(1 - win)];
      hud.showGameOver({
        text: win === 0 ? 'You win!' : 'Marcel & Odette win',
        detail: `${text}. Final score ${match.scores[0]} to ${match.scores[1]}. ` +
          [lines[0] && talk.say(lines[0], 'gameWon'), lines[1] && talk.say(lines[1], 'gameLost')].filter(Boolean).join(' '),
      });
      return;
    }
    hud.showMeneEnd({ text, detail: `${detail} Score: ${match.scores[0]} to ${match.scores[1]}. ${voices('meneWon', 'meneLost')}`.trim() });
    if (instant && !params.has('meneend')) later(() => nextMene(), 0);
  }

  function nextMene() {
    if (!match || match.phase !== 'meneEnd') return;
    match = apply(match, { type: 'nextMene' });
    hud.hideOverlay();
    beginMene(false);
  }

  // Fixed timestep loop (?debug&timerframes drives it from timers, for headless screenshots under virtual time)
  const nextFrame = debug && params.has('timerframes') ? (f) => setTimeout(() => f(performance.now()), 16) : requestAnimationFrame;
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    if (!playing && match) acc = 0; // paused: the page is showing, the game waits
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
    audio.update(world.bodies, dt); // rolling scrape loops (accepts an array)
    tickCast(dt);
    renderer.sync(world);
    renderer.render(dt);
    nextFrame(frame);
  }

  aimView();
  nextFrame(frame);

  if (debug) {
    window.__petanque = {
      world, terrain, renderer, seed, reset: toSetup, startGame,
      audio,
      setPlaying,
      get match() { return match; },
      throw: (p) => launchBody(jackBody() && !jackBody().dead ? 'boule' : 'jack', 0, 'you', { ...readParams(), ...p }),
      throwJack: (p) => launchBody('jack', -1, null, { ...readParams(), ...p }),
    };
  }

  if (debug && params.has('play')) setPlaying(true, false); // ?debug&play: enter the full-window view without a click

  if (debug && params.has('autotest')) {
    // AI-only quick match, every throw simulated to rest instantly
    startGame({ target: +params.get('target') || 7, difficulty: 'medium', allAI: true, instant: !params.has('animate') }); // &animate: real time
  } else if (debug && params.has('aispot')) {
    // Real-time game where Marcel throws the jack first: screenshot while he shows his spot
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 1 });
  } else if (debug && pickHuman !== null) {
    // Stop at the human's first boule (or at the chooser with ?humanturn=chooser)
    startGame({ target: 7, difficulty: 'medium', instant: !params.has('animate'), firstJackTeam: pickHuman === 'jack' ? 0 : 1 }); // &animate: real time
  } else if (debug && params.has('characters')) {
    // --- ?debug&characters: stick figures in every stance side by side (for screenshots) ---
    clearWorld();
    hud.hideHint();
    for (const ch of CAST_ALL.values()) ch.root.visible = false;
    // &cast=quirk|celebrate|dismay: the four real players in a row (&q=N picks which idle quirk is held)
    const castMode = params.get('cast');
    const qi = +params.get('q') || 0;
    const specs = castMode ? ['you', 'pierre', 'marcel', 'odette'].map((id) => [castMode === 'quirk' ? 'watch' : castMode, specFor(id)]) : [
      ['idle', { model: 'odette', name: 'Ana', height: 1.62, build: 'slim', stance: 'stand', colors: { shirt: '#c0392b', trousers: '#2c3e50', skin: '#e8b48c' } }],
      ['crouch', { model: 'marcel', name: 'Marcel', height: 1.7, build: 'stout', stance: 'crouch', colors: { shirt: '#6f8f4e', trousers: '#4b4b55', skin: '#d29b74', hat: '#2d3a55' }, quirks: { hat: 'cap' } }],
      ['stand', { model: 'odette', name: 'Odette', height: 1.65, build: 'slim', stance: 'stand', colors: { shirt: '#f2efe6', trousers: '#6b5b8c', skin: '#efc6a4', hat: '#e9d9a0' }, quirks: { hat: 'sunhat' } }],
      ['celebrate', { model: 'pierre', name: 'Pierre', height: 1.82, build: 'average', stance: 'crouch', colors: { shirt: '#2f6fb5', trousers: '#2b2b2b', skin: '#a8734d' } }],
      ['dismay', { model: 'you', name: 'Lou', height: 1.75, build: 'average', stance: 'stand', colors: { shirt: '#e0a526', trousers: '#4a3b2f', skin: '#c58a63' } }],
      ['watch', { model: 'pierre', name: 'Max', height: 1.9, build: 'stout', stance: 'stand', colors: { shirt: '#7a3b8f', trousers: '#33414d', skin: '#f0c7a8' } }],
      ['throw', { model: 'you', name: 'Thrower', height: 1.72, build: 'average', stance: params.get('stance') === 'stand' ? 'stand' : 'crouch', colors: { shirt: '#1f9d8b', trousers: '#3b3b3b', skin: '#dba983' } }],
    ];
    const figures = specs.map(([stance, spec], i) => {
      const ch = createCharacter(THREE, spec);
      if (useMeshes) attachModels([{ ch, model: spec.model }], modelTimeout);
      const x = castMode ? -1.4 + i * 1.5 : -2.2 + i * 1.3;
      const y = stance === 'throw' && params.has('closeup') ? 0.5 : 3; // closeup: the thrower steps out of the line
      ch.setPlacement(x, y, Math.PI); // facing the camera (-y)
      ch.root.position.z = terrain.sample(x, y).h;
      renderer.addObject(ch.root);
      if (stance === 'throw') {
        ch.setStance(spec.stance);
        const loop = () => {
          ch.setHolding(true);
          const loft = params.has('loft') ? +params.get('loft') * DEG : 0.3 + Math.random() * 0.7;
          ch.playThrow({ // &freezethrow: stop at the release frame and mark where the boule leaves
            loft,
            onRelease: (h) => {
              if (!params.has('freezethrow')) return;
              const m = new THREE.Mesh(new THREE.SphereGeometry(C.boule.r, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
              m.position.set(h.x, h.y, h.z); renderer.addObject(m);
              ch.frozen = true;
            },
          }).then(() => { if (!ch.frozen) setTimeout(loop, 800); });
        };
        loop();
      } else ch.setStance(stance);
      if (castMode === 'quirk') { const l = spec.quirks.idle; ch.forceQuirk(l[qi % l.length]); }
      if (stance === 'watch') ch.lookAt(2, 0.5, 1.6);
      return ch;
    });
    if (params.has('closeup')) renderer.setCamera('inspect', { target: { x: 5.6, y: 0.5, }, dist: +params.get('dist') || 3.6, az: +params.get('az') || 1.2, el: +params.get('el') || 0.12 });
    else renderer.setCamera('inspect', { target: { x: castMode ? 2.1 : 1.7, y: 3 }, dist: castMode ? +params.get('dist') || 5 : 7, az: +params.get('az') || 0, el: 0.1 });
    let lastC = performance.now();
    const tickC = (now) => {
      const dt = params.has('freezethrow') ? 1 / 60 : Math.min((now - lastC) / 1000, 0.1); lastC = now; // fixed step so a frozen release is exact
      for (const ch of figures) if (!ch.frozen) ch.update(dt);
      requestAnimationFrame(tickC);
    };
    for (const ch of figures) ch.update(0.5);
    requestAnimationFrame(tickC);
    window.__characters = figures;
  } else if (debug && params.has('preview')) {
    // --- ?debug&preview: static throw preview with made-up paths (for screenshots) ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; world.add(b); return b; };
    put('jack', -1, 2.1, 8.45);
    put('boule', 0, 1.9, 8.3);
    put('boule', 1, 2.3, 8.6);
    renderer.sync(world);
    placePlayers('you');
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
  for (const el of root.querySelectorAll('canvas, .petanque-hud, .petanque-controls')) el.hidden = true;
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
