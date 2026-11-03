// Game loop: terrain, world, renderer, rules, AI, toss input (donnée throw), audio and HUD wired together.
import { C } from './constants.js';
import { court, setCourt, resetCourt, baseYaw, ahead, nextCircle } from './court.js';
import { mulberry32 } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch, placeDeadBall, deadRowSlot, deadJackSpot } from './physics.js';
import { createRenderer } from './render.js';
import {
  createMatch, defaultPlayers, apply, nextTeam, playersWithBoules, holdingTeam, jackFault, jackPlaceValid, jackPlaceFault,
} from './rules.js';
import { createHud } from './hud.js';
import { settings } from './settings.js';
import { chooseThrowAsync, chooseJackThrow, chooseJackPlacement, whoThrows } from './ai.js';
import { createTossInput } from './toss.js';
import {
  SKILL, scaledSkill, coneFor, coneEnvelope, executeThrow, solveLaunch, predictRoll, predictRollBand, styleForLoft, releaseFrom, snapAim, fitToBudget,
} from './donnee.js';
import { createAudio } from './audio.js';
import { createClock } from './clock.js';
import * as THREE from '../vendor/three.module.js';
import { createCharacter, releaseOffset, bendReach } from './character.js';
import { planRoute, standPoint, pathLength } from './fetch.js';
import { pickWaitingSlot } from './waiting.js';
import { attachModels } from './models.js';
import { PERSONALITIES, CAST_IDS, specFor, pickStance, createCommentary } from './personalities.js';

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
const HOME_LOCAL = { you: { x: -0.9, y: -0.4 }, pierre: { x: -1.5, y: 0.7 }, marcel: { x: 6.0, y: 0.0 }, odette: { x: 6.8, y: 0.8 } };
// E10: HOME_LOCAL is relative to the default circle (2, 1) playing +y; homeAt turns it with the circle and direction
const homeAt = (id) => { const h = HOME_LOCAL[id], d = court.dir; return { x: C.terrainW / 2 + (h.x - 2) * d, y: court.circle.y + (h.y - 1) * d }; };
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
  const stanceRand = mulberry32(seed ^ 0x6a09e667); // Pierre's crouch-or-stand pick, one per throw
  const talk =createCommentary(mulberry32(seed ^ 0x7a1c0de5)); // personality lines, seeded like everything else
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
  // Skinned meshes load in the background; each character stays a stick figure until its model arrives
  if (useMeshes) attachModels([...cast.entries()].map(([id, ch]) => ({ ch, model: SPECS[id].model })), modelTimeout).catch((err) => console.warn(err));
  let inCircle = null; // id of whoever stands in the circle
  let arrival = Promise.resolve(); // resolves when the thrower has reached the circle
  let aiYaw = 0; // facing of an AI thrower (towards the jack), fixed before it plans so the release point matches
  let frozen = false; // ?debug&freezethrow stops the animation at the release frame

  let match = null; // rules state; null until a game starts
  let difficulty = 'medium';
  let instant = false; // autotest: no delays, simulate to rest synchronously
  let token = 0; // bumped on each new game so stale timers are ignored
  let yellowDone = false; // ?debug&yellow forces one yellow card
  let flying = null; // body being tracked
  let throwEvents = []; // physics events of the current throw (hits, for commentary)
  let preThrow = new Map(); // id -> { x, y } of boules before the current throw
  let pending = null; // { kind, playerId } while waiting for the human to throw
  let aimYaw = 0;
  let throwerYaw = 0; // yaw of whoever stands in the circle
  const throwRand = mulberry32(seed ^ 0x2545f491);
  // shared with the renderer so turning moves the camera without restarting its transition
  const shoulderCam = { player: court.circle, yaw: 0, viewYaw: 0, viewPitch: 0 }; // E12: viewYaw/viewPitch orbit offsets (rad)
  const shoulderView = () => renderer.setCamera('shoulder', shoulderCam);
  const aimView = shoulderView;
  const PITCH_MAX = 15 * DEG, KEEP_YAW = 35 * DEG; // E12 (see setAdjust)
  let adjusting = false, viewAnim = 0;
  const audio = createAudio();
  let thinkToken = 0; // bumped to drop stale partner-suggestion results
  let pierreChoice = null; // cached AI choice for Pierre while the chooser is open
  const pickHuman = params.get('humanturn'); // debug: stop at the human's first boule (or 'chooser')

  // Controls: [Adjust view] [Roll guide] [View] [mute] bar (New game lives on the paused bar); no raw sliders
  controls.textContent = '';
  const mkBtn = (parent, text, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = cls;
    parent.append(b);
    return b;
  };
  const bar = document.createElement('div');
  bar.className = 'pc-bar';
  const reaimBtn = mkBtn(bar, '', 'pc-reaim'); // E12: "Adjust view" toggle
  reaimBtn.innerHTML = '<svg class="pc-eye" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg> <span>Adjust view</span>';
  reaimBtn.setAttribute('aria-pressed', 'false');
  reaimBtn.title = 'Drag or use the arrow keys to look around the thrower. Turn off to aim and toss.';
  const rollBtn = mkBtn(bar, 'Roll guide', 'pc-roll');
  const modeBtn = mkBtn(bar, '', 'pc-mode'); // E01: Quick / Slow
  const syncModeBtn = () => {
    modeBtn.textContent = 'Mode: ' + (settings.mode === 'quick' ? 'Quick' : 'Slow');
    modeBtn.title = 'Quick: no walking. Slow: people walk. Click to switch.';
  };
  syncModeBtn();
  modeBtn.addEventListener('click', () => { settings.mode = settings.mode === 'quick' ? 'slow' : 'quick'; });
  settings.onChange(syncModeBtn);
  const viewBtn = mkBtn(bar, 'View: Shoulder', 'pc-view');
  bar.append(audio.createMuteButton());
  // E14: a corner of the full-window layer holds the fullscreen toggle and a pause icon. The pause icon leaves the
  // full-window view, as the old Exit button did (only shown while playing); the fullscreen toggle is desktop-only.
  const corner = document.createElement('div');
  corner.className = 'pc-corner';
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button'; fsBtn.className = 'pc-fs';
  const exitBtn = document.createElement('button');
  exitBtn.type = 'button'; exitBtn.className = 'pc-exit';
  exitBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  exitBtn.setAttribute('aria-label', 'Pause');
  exitBtn.title = 'Pause (Esc)';
  corner.append(fsBtn, exitBtn);
  root.append(corner);
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
    aimYaw = baseYaw() + Math.max(-AIM_MAX, Math.min(AIM_MAX, wrapPi(yaw - baseYaw()))); // E10: within AIM_MAX of straight ahead, whichever way that is
    shoulderCam.yaw = aimYaw;
    throwerYaw = aimYaw;
    const me = cast.get('you');
    if (pending && inCircle === 'you' && !me.busy) me.yaw = aimYaw;
  }

  // Release point of a player's boule: where that character's hand will be at the release frame for this loft,
  // facing their aim. Without a loft it returns a base for the AI ({ x, y, release(loft) }), see donnee.releaseFrom.
  const faceYaw = (id) => (id === 'you' ? aimYaw : aiYaw);
  // Stance of each player's current throw: picked when they step into the circle (enterCircle), used by the preview,
  // the AI plan, the throw pose and the launch alike
  const throwStance = {};
  const stanceOf = (id) => throwStance[id] || SPECS[id].stance;
  function handFrom(id, loft, yaw) {
    const spec = SPECS[id];
    const o = releaseOffset({ height: spec.height, stance: stanceOf(id), loft, yaw, hand: spec.hand, model: cast.get(id).isMesh ? spec.model : null });
    return { x: court.circle.x + o.x, y: court.circle.y + o.y, z: terrain.sample(court.circle.x, court.circle.y).h + o.z };
  }
  function releasePoint(player, loft) {
    const id = player ? player.id : 'you';
    const yaw = faceYaw(id);
    if (loft === undefined) return { x: court.circle.x, y: court.circle.y, release: (l) => handFrom(id, l, yaw) };
    return handFrom(id, loft, yaw);
  }

  // default raw throw for the debug hooks (window.__petanque.throw / throwJack)
  const readParams = () => ({ yaw: aimYaw, speed: 7, loft: 0.9, backspin: 30, sidespin: 0 });

  // ---- Throw preview and toss input ----
  let rollGuide = false;
  let rollOverride = store(ROLL_KEY); // '1' | '0' | null
  let lastToss = null; // last onPreview payload, to redraw when the roll guide toggles
  // D21: the roll band is recomputed only when the donnée moves 5 cm or the loft 1 degree, and the drawn band eases
  // toward each new result over 150 ms so it never jumps
  const roll = { target: null, from: null, t0: 0, landing: null, loft: 0, kind: '', raf: 0 };
  const ROLL_MOVE = 0.05, ROLL_LOFT = Math.PI / 180, ROLL_BLEND = 150;
  const lerpN = (a, b, u) => a + (b - a) * u;
  function rollShown(now) {
    const { from, target } = roll;
    const u = !from || reduceMotion() ? 1 : Math.min(1, (now - roll.t0) / ROLL_BLEND);
    if (u >= 1) { roll.from = null; return target; }
    const e = u * u * (3 - 2 * u);
    const pt = (a, b) => ({ x: lerpN(a.x, b.x, e), y: lerpN(a.y, b.y, e), z: lerpN(a.z, b.z, e) });
    return {
      center: target.center.map((q, i) => pt(from.center[i] || q, q)),
      halfWidths: target.halfWidths.map((h, i) => lerpN(from.halfWidths[i] ?? h, h, e)),
      restMean: pt(from.restMean, target.restMean),
      restCov: { xx: lerpN(from.restCov.xx, target.restCov.xx, e), xy: lerpN(from.restCov.xy, target.restCov.xy, e), yy: lerpN(from.restCov.yy, target.restCov.yy, e) },
      blending: true,
    };
  }
  function rollBandFor(from, landing, loft, cone, kind) {
    const now = performance.now(), k = kind === 'jack' ? 'jack' : 'boule';
    if (!roll.target || roll.kind !== k || Math.hypot(landing.x - roll.landing.x, landing.y - roll.landing.y) > ROLL_MOVE || Math.abs(loft - roll.loft) > ROLL_LOFT) {
      const shown = roll.target ? rollShown(now) : null;
      roll.target = predictRollBand({ world, terrain, from, landing, loft, cone, kind: k });
      roll.from = shown && shown.center.length === roll.target.center.length ? shown : null;
      roll.t0 = now; roll.landing = landing; roll.loft = loft; roll.kind = k;
    }
    return rollShown(now);
  }
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
    let band = null;
    cancelAnimationFrame(roll.raf); roll.raf = 0;
    // the jack rolls on a metre or more after landing, so its guide is on unless the player turned guides off
    if (rollGuide || (kind === 'jack' && rollOverride !== '0')) {
      band = rollBandFor(from, landing, t.loft, cone, kind);
      if (band.blending) roll.raf = requestAnimationFrame(() => { roll.raf = 0; if (lastToss === t) showToss(t, kind); });
    }
    renderer.setThrowPreview({
      ...env, roll: band, donnee: clamped ? landing : t.donnee, style: styleForLoft(t.loft, !!t.snappedTo),
      snapped: !!t.snappedTo && !clamped, legalZone: kind === 'jack',
    });
  }
  function clearToss() {
    lastToss = null; reachShown = false;
    cancelAnimationFrame(roll.raf); roll.raf = 0; roll.target = roll.from = null;
    renderer.setThrowPreview(null);
    renderer.showJackZone(!!pending && pending.kind === 'jack' && !flying);
  }

  const toss = createTossInput(canvas, {
    pick: (x, y) => renderer.pick(x, y),
    getYaw: () => aimYaw,
    getOrigin: () => court.circle,
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
    // placing an invalid jack by hand: marker preview, valid click places, invalid click gives a hint
    placeValid: (p) => !!match && jackPlaceValid(p, match.geometry),
    placeStart: { x: 2, y: 9 },
    onPlacePreview: (m) => renderer.setPlaceMarker(m ? { x: m.point.x, y: m.point.y, valid: m.valid } : null),
    onPlace: (p) => placeJackWalk(p),
    onPlaceInvalid: (p) => say2(`Not there: ${faultText(jackPlaceFault(p, match && match.geometry))} Pick a green spot 6 to 10 m out, inside the lines and 0.5 m short of the end string.`),
    targets: () => world.bodies.filter((b) => !b.dead).map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r })),
  });

  function humanToss(t) {
    renderer.setJackArrow(false); // released: the chevron fades out (D17)
    if (!pending || flying) { toss.setPhase('off'); return; }
    const from = releasePoint(null, t.loft);
    const { landing, energyFrac } = fitToss(t, from);
    const cone = coneFor({ skill: SKILL.human, from, landing, loft: t.loft, energyFrac });
    const res = executeThrow({ from, landing, loft: t.loft, cone, terrain: world.terrain, rand: throwRand });
    clearToss();
    humanThrow(res.throwParams, from, t.loft);
  }

  function enableControls(on) {
    if (!on) setAdjust(false, { reset: true }); // the turn is over: drop the toggle and the view offset
    toss.setPhase(on ? 'aim' : 'off');
    reaimBtn.hidden = !on;
    rollBtn.hidden = !on;
    viewBtn.hidden = !on;
    if (!on) { clearToss(); renderer.setJackArrow(false); }
  }
  enableControls(false);

  // View cycling: shoulder, head, inspect
  let view = 'shoulder';
  function setView(v) {
    if (v !== 'shoulder' && adjusting) setAdjust(false);
    view = v;
    viewBtn.textContent = 'View: ' + VIEW_LABELS[v];
    const j = jackBody();
    const target = j && !j.dead ? { x: j.x, y: j.y } : ahead(7);
    if (v === 'shoulder') shoulderView();
    else if (v === 'head') headView(j && !j.dead ? j : ahead(7));
    else renderer.setCamera('inspect', { target, dist: 3, az: baseYaw(), el: 0.6 });
    if (pending && !flying) toss.setPhase(v === 'inspect' ? 'off' : 'aim');
  }
  viewBtn.addEventListener('click', () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]));
  // E12 "Adjust view": while on, toss input is off and dragging (or arrows) orbits the shoulder camera round the
  // thrower: yaw offset within +-180 deg of the aim, pitch offset within +-15 deg. Wheel and pinch still zoom.
  // Turning it off keeps a small yaw offset (<= KEEP_YAW) since aiming still works from there; a larger one would
  // leave the camera looking sideways or backwards of the aim, so it eases back to the default framing. Pitch stays.
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function setViewOffset(yaw, pitch) {
    const lim = (a) => Math.max(-Math.PI, Math.min(Math.PI, a));
    shoulderCam.viewYaw = lim(yaw);
    shoulderCam.viewPitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch));
  }
  function easeViewTo(yaw, pitch) {
    cancelAnimationFrame(viewAnim);
    if (reducedMotion()) { setViewOffset(yaw, pitch); return; }
    const y0 = shoulderCam.viewYaw, p0 = shoulderCam.viewPitch, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 350), e = k * k * (3 - 2 * k);
      setViewOffset(y0 + (yaw - y0) * e, p0 + (pitch - p0) * e);
      if (k < 1) viewAnim = requestAnimationFrame(step);
    };
    viewAnim = requestAnimationFrame(step);
  }
  function setAdjust(on, { reset = false } = {}) {
    on = !!on;
    if (on && !(pending && !flying)) return;
    const was = adjusting;
    adjusting = on;
    reaimBtn.classList.toggle('is-on', on);
    reaimBtn.setAttribute('aria-pressed', String(on));
    if (on === was && !reset) return;
    if (on) {
      clearToss();
      if (view !== 'shoulder') setView('shoulder');
      toss.setPhase('off');
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = '';
      if (pending && !flying && !reset) toss.setPhase('aim');
    }
    if (!on) {
      if (reset || Math.abs(shoulderCam.viewYaw) > KEEP_YAW) {
        if (reset) { cancelAnimationFrame(viewAnim); setViewOffset(0, 0); }
        else easeViewTo(0, shoulderCam.viewPitch);
      }
    }
  }
  reaimBtn.addEventListener('click', () => setAdjust(!adjusting));
  let dragView = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!adjusting || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (dragView) { dragView = null; return; } // second finger: pinch zoom, stop orbiting
    dragView = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!adjusting || !dragView || e.pointerId !== dragView.id) return;
    const dx = e.clientX - dragView.x, dy = e.clientY - dragView.y;
    dragView.x = e.clientX; dragView.y = e.clientY;
    cancelAnimationFrame(viewAnim);
    // dragging right swings the view left round the thrower (grab-the-world feel), as in the paused orbit
    setViewOffset(wrapPi(shoulderCam.viewYaw - dx * 0.008), shoulderCam.viewPitch - dy * 0.004);
  });
  const endDrag = (e) => { if (dragView && e.pointerId === dragView.id) { dragView = null; if (adjusting) canvas.style.cursor = 'grab'; } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', (e) => {
    if (!adjusting || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const f = e.shiftKey ? 0.25 : 1;
    let dy = 0, dp = 0;
    if (e.key === 'ArrowLeft') dy = -5 * DEG * f; else if (e.key === 'ArrowRight') dy = 5 * DEG * f;
    else if (e.key === 'ArrowUp') dp = -2 * DEG * f; else if (e.key === 'ArrowDown') dp = 2 * DEG * f;
    else if (e.key === 'Escape') { setAdjust(false); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    cancelAnimationFrame(viewAnim);
    setViewOffset(wrapPi(shoulderCam.viewYaw + dy), shoulderCam.viewPitch + dp);
  });
  rollBtn.addEventListener('click', () => {
    rollGuide = !rollGuide;
    rollOverride = rollGuide ? '1' : '0';
    store(ROLL_KEY, rollOverride);
    rollBtn.classList.toggle('is-on', rollGuide);
    rollBtn.setAttribute('aria-pressed', String(rollGuide));
    roll.target = roll.from = null;
    if (lastToss && pending) showToss(lastToss, pending.kind);
  });
  rollBtn.setAttribute('aria-pressed', 'false');

  const hud = createHud(root, document.querySelector('.petanque-hud'), {
    onStart: (opts) => { audio.unlock(); setPlaying(true); startGame(opts); },
    onNext: () => nextMene(),
    onPlayAgain: () => toSetup(),
    onResume: () => setPlaying(true),
    onNewGame: () => { setPlaying(true); toSetup(); },
    onChoose: (id) => beginTurn(id),
    onHintDismiss: () => store(HINT_KEY, '1'),
  });
  const say2 = hud.say;

  // ---- Cast movement ----
  // E01: every walk and teleport decision goes through slow(). Debug instant/autotest and reduced motion never walk.
  const slow = () => !instant && (!reduceMotion() || (debug && params.has('slow'))) && settings.mode === 'slow'; // ?debug&slow: slow mode despite reduced motion (screenshots)
  const snapMove = () => !slow(); // no walking: teleport
  // E16: slow mode shows the boules in each player's hands (1 in the dominant hand, 2 in the other); the counts always
  // match boulesLeft. Quick mode shows just the one boule about to be thrown (the character's setHolding).
  const BOULE_COLORS = ['#a9bde0', '#e8aa6a']; // the team's boule look (render.js bouleMats)
  const playerOf = (id) => match && match.players.find((p) => p.id === id);
  const splitHeld = (n) => ({ dominant: Math.min(1, n), other: Math.min(2, Math.max(0, n - 1)) });
  const teamColor = (id) => BOULE_COLORS[PERSONALITIES[id].team]; // E23: a team-0 player holds steel, team 1 bronze
  function readyHeld(id) { // before a throw: the boule is in the dominant hand, moved over from the other hand if need be
    const ch = cast.get(id), p = playerOf(id);
    if (!p || match.phase !== 'play' || !slow()) { ch.setHeldBoules(null); return Promise.resolve(); }
    const cur = ch.heldBoules;
    if (!cur || cur.dominant + cur.other !== p.boulesLeft) ch.setHeldBoules({ ...splitHeld(p.boulesLeft), color: BOULE_COLORS[p.team] });
    return ch.shiftBoule() ? sleep(450) : Promise.resolve();
  }
  // At the start of play every player in turn bends and takes up their boules (staggered, so it takes about 3 s)
  async function collectBoules() {
    if (!slow() || !match) return;
    const t = token;
    const ids = match.players.filter((p) => p.boulesLeft > 0).map((p) => p.id);
    await Promise.all(ids.map(async (id, i) => {
      const ch = cast.get(id), p = playerOf(id), look = { ...splitHeld(p.boulesLeft), color: BOULE_COLORS[p.team] };
      await sleep(i * 550);
      for (let w = 0; ch.busy && w < 40 && t === token; w++) await sleep(150); // still walking home
      if (t !== token) return;
      if (ch.busy || (fetchJob && fetchJob.id === id)) { ch.setHeldBoules(look); return; }
      await ch.playBend({ kind: 'pickup', onAct: () => ch.setHeldBoules(look) });
      if (t === token && !(fetchJob && fetchJob.id === id)) ch.setCarrying(false);
    }));
  }
  function startPlay() { // after the jack is set: pick up the boules (slow mode), then the first throw
    const t = token;
    collectBoules().catch((err) => console.error(err)).then(() => { if (t === token) nextTurn(); });
  }
  const homeYaw = (id) => Math.atan2(court.circle.x - homeAt(id).x, court.circle.y + 5 * court.dir - homeAt(id).y);
  function placeAt(id, x, y, yaw) {
    const ch = cast.get(id);
    ch.setPlacement(x, y, yaw);
    ch.root.position.z = terrain.sample(x, y).h;
  }
  // Waiting players cast no shadow: the low sun would throw theirs into the shoulder view
  const shadow = (id, on) => cast.get(id).root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  // E02: in slow mode a returning player takes the nearest free waiting slot (waiting.js); quick mode uses HOME.
  // `claims` holds where each waiting player stands or is heading, so slots never overlap.
  const claims = new Map();
  function homeSpot(id) {
    if (snapMove()) { claims.set(id, { x: homeAt(id).x, y: homeAt(id).y }); return { ...homeAt(id), yaw: homeYaw(id) }; }
    const jk = jackBody(), p = cast.get(id).root.position;
    const occupied = [...claims].filter(([k]) => k !== id).map(([, v]) => v);
    const s = pickWaitingSlot({ x: p.x, y: p.y }, jk && !jk.dead ? jk : null, occupied) || homeAt(id);
    claims.set(id, { x: s.x, y: s.y });
    return { x: s.x, y: s.y, yaw: Math.atan2(court.circle.x - s.x, (jk && !jk.dead ? jk.y : court.circle.y + 5 * court.dir) - s.y) };
  }
  function walkOut(id) { // to a waiting spot, then watch
    const ch = cast.get(id), h = homeSpot(id);
    shadow(id, false);
    ch.setHolding(false);
    ch.setStance('watch');
    if (snapMove()) placeAt(id, h.x, h.y, h.yaw);
    else ch.walkTo({ x: h.x, y: h.y, yaw: h.yaw, speed: CAST_SPEED });
  }
  // Everyone to their waiting spot at once (new mène, new game)
  function resetCast() {
    inCircle = null;
    for (const id of cast.keys()) {
      const ch = cast.get(id);
      ch.setHolding(false); ch.setHeldBoules(null); ch.setCarrying(false); ch.setStance('watch'); shadow(id, false);
      placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
      claims.set(id, { x: homeAt(id).x, y: homeAt(id).y });
    }
  }
  let circleWalk = null; // { id, yaw, tok, start } while a thrower walks to the circle
  // The thrower walks into the circle (the previous one walks out); returns a promise for the arrival
  function enterCircle(id, yaw, snap, kind = 'boule') { // kind: 'jack' for the cochonnet throw (E23), else a boule
    const ch = cast.get(id), c = court.circle, jack = kind === 'jack';
    if (fetchJob && fetchJob.id === id) { // D11: a fetcher called to throw drops what they carry (E02: and walks from where they are)
      cancelFetch(); ch.setCarrying(false);
    }
    if (inCircle && inCircle !== id && !(fetchJob && fetchJob.id === inCircle)) walkOut(inCircle);
    inCircle = id;
    claims.delete(id);
    shadow(id, true);
    for (const [oid, och] of cast) if (oid !== id && oid !== inCircle && !och.busy) och.setStance('watch');
    throwStance[id] = pickStance(SPECS[id], stanceRand); // once per throw: the same stance for the plan, the pose and the launch
    ch.setStance(stanceOf(id));
    if (jack) ch.setHeldBoules(null); // E23: a jack throw shows no boules in the hands
    ch.setHolding(jack ? 'jack' : 'boule', jack ? undefined : teamColor(id));
    const here =Math.hypot(ch.root.position.x - c.x, ch.root.position.y - c.y) < 0.05;
    if (here || snap || snapMove()) {
      placeAt(id, c.x, c.y, yaw);
      arrival = Promise.resolve();
    } else {
      const t = token;
      circleWalk = { id, yaw, tok: t, start: performance.now() }; // E02: a click or key skips the walk
      arrival = ch.walkTo({ x: c.x, y: c.y, yaw, speed: CAST_SPEED }).then(() => {
        if (circleWalk && circleWalk.id === id) circleWalk = null;
        if (t === token && inCircle === id) ch.yaw = faceYaw(id);
      });
    }
    arrival = arrival.then(() => (jack ? undefined : readyHeld(id))); // E16: the boule is in the dominant hand
    return arrival;
  }
  // Setup screen and debug views: the human crouched in the circle, the others waiting
  function placePlayers(throwerId) {
    resetCast();
    enterCircle(throwerId, baseYaw(), true);
  }

  // Throw animation drives the launch: go() runs at the release frame (the boule leaves the hand)
  async function throwWith(id, loft, go, kind = 'boule') {
    const ch = cast.get(id), t = token;
    await arrival;
    if (t !== token) return;
    ch.setHolding(kind === 'jack' ? 'jack' : true);
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
    if (fetchScript) { // ?debug&fetch: fixed steps; with &fetchat the animation is pumped synchronously (headless frames are too few)
      if (fetchFreezeAt && !fetchPump) return;
      dt = 1 / 60; clock.tick(1000 / 60);
    }
    const thrower = inCircle && cast.get(inCircle);
    shoulderCam.wide = thrower && thrower.isMesh ? 1.45 : 1;
    if (thrower) shoulderCam.hand = thrower.hand; // a left-hander's shoulder camera sits behind the left shoulder
    const w = flying && !flying.dead ? flying : jackBody();
    for (const ch of cast.values()) {
      const p = ch.root.position;
      p.z = terrain.sample(p.x, p.y).h;
      if (w) ch.lookAt(w.x, w.y, Math.max(0.3, w.z)); else ch.lookAt(null);
      ch.update(dt);
    }
    followCarry();
    followRing();
    if (fetchFreezeAt && (fetchClockT += dt) >= fetchFreezeAt) frozen = true; // ?debug&fetch&fetchat=seconds
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
        target: { x: cx, y: cy }, dist: 3.8, az: baseYaw() + Math.PI, el: 0.12, height: 0.9, reset: true,
        fit: (Math.max(...xs) - Math.min(...xs)) / 2 + 1.1,
      });
    }, 800);
  }

  // Mène end or game over: gather by the jack; the winners celebrate, the others are dismayed
  function gather(winTeam) {
    if (instant && !(debug && params.has('meneend'))) return; // ?debug&meneend shows the gathering in instant matches
    const j = jackBody(), c = j && !j.dead ? j : ahead(7);
    const slots = [[-2.3, 1.0], [-3.0, 1.9], [2.3, 1.0], [3.0, 1.9]]; // beyond the jack, to the sides
    const n = [0, 0];
    for (const p of match.players) {
      const ch = cast.get(p.id), k = n[p.team]++;
      const [dx, dy] = slots[p.team * 2 + k];
      const x = c.x + dx, y = c.y + dy * court.dir; // E10: 'beyond the jack' is toward the end being played to
      ch.setHolding(false); ch.setHeldBoules(null); shadow(p.id, true);
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
      if (scoringShown) return; // keep the scoring circle framed (D07)
      renderer.setCamera('inspect', { target: { x: c.x, y: c.y - 0.2 * court.dir }, dist: 5.5, az: baseYaw(), el: 0.4, height: 0.2, reset: true, fit: 3.4 });
    }, 2200);
  }

  // Head camera framing the jack and live boules within 2 m of it
  function headView(jack, extra, lift, tight) {
    const pts = world.bodies
      .filter((b) => b.kind === 'boule' && !b.dead && Math.hypot(b.x - jack.x, b.y - jack.y) < 2)
      .map((b) => ({ x: b.x, y: b.y }));
    renderer.setCamera('head', { target: { x: jack.x, y: jack.y }, points: (tight ? [] : pts).concat(extra || []), lift, ...(tight ? { margin: 0.25, minHalf: 0.55, dist: 1.3 } : {}) });
  }
  // D07 between throws: ribbons from the cochonnet to the closest live boule of each team (a team with none is dropped)
  const TEAM_INK = [{ line: '#2f5fb8', dark: 'rgba(22,49,95,0.95)' }, { line: '#f0a040', dark: 'rgba(100,54,8,0.95)' }];
  const edgeCm = (b, j) => `${Math.max(0, Math.round((Math.hypot(b.x - j.x, b.y - j.y) - b.r - j.r) * 100))} cm`;
  function showBetween() {
    const j = jackBody();
    if (!j || j.dead) { renderer.clearMeasure(); return; }
    const items = [];
    for (const team of [0, 1]) {
      let best = null;
      for (const b of world.bodies) {
        if (b.kind !== 'boule' || b.dead || b.team !== team) continue;
        if (!best || Math.hypot(b.x - j.x, b.y - j.y) < Math.hypot(best.x - j.x, best.y - j.y)) best = b;
      }
      if (best) items.push({ x: best.x, y: best.y, r: best.r, label: edgeCm(best, j), color: TEAM_INK[team].line, dark: TEAM_INK[team].dark });
    }
    const others = world.bodies.filter((b) => b.kind === 'boule' && !b.dead).map((b) => ({ x: b.x, y: b.y }));
    if (items.length) renderer.showMeasure({ x: j.x, y: j.y, r: j.r }, items, others);
    else renderer.clearMeasure();
  }
  // Landing marks from physics 'land' events
  function markLandings(events) {
    for (const ev of events) {
      if (ev.type === 'land' && ev.speed > 1.5) renderer.addDivot(ev.x, ev.y, 0.035 + 0.05 * Math.min(1, ev.speed / 8));
    }
  }

  const jackBody = () => world.bodies.find((b) => b.kind === 'jack');
  const clock = createClock(); // D12: every game delay goes through this, so a pause freezes them all
  const later = (fn, ms) => {
    const t = token;
    clock.later(() => { if (t === token) fn(); }, instant ? 0 : ms);
  };

  function clearWorld() {
    cancelFetch(); carry = null; jackFetch = null; placing = null; gateSince = 0; lastThrowerId = null; // D11
    world.bodies.length = 0;
    world.events.length = 0;
    terrain.resetDivots();
    renderer.clearDivots();
    renderer.clearMeasure();
    scoringShown = false;
    renderer.showJackZone(false);
    renderer.setPlaceMarker(null);
    renderer.setJackArrow(false);
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
    renderer.clearMeasure();
    const body = createBody(kind, { team: kind === 'jack' ? -1 : team, owner });
    world.add(body);
    launch(body, p, from || court.throwFrom);
    flying = body;
    clearToss();
    renderer.setCamera('flight', { body, bodies: world.bodies });
    enableControls(false);
    if (instant) {
      let guard = 0;
      while (!world.settled() && guard++ < 240 * C.hardCapSeconds) world.step();
      if (!world.settled()) world.forceRest();
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
      renderer.setCamera('inspect', { target: { x: court.circle.x, y: court.circle.y }, dist: +params.get('topdist') || 2.2, az: +params.get('topaz') || 0, el: +params.get('topel') || 1.5, height: +params.get('topheight') || 0 });
      cast.get(inCircle).setStance(stanceOf(inCircle));
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
    resetCourt(); applyCourt(court.circle, 1, false);
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
    if (debug && first && params.has('jackplace')) { forceInvalidJack(team); return; }
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
    renderer.clearMeasure(); // aiming starts: the between-throws lines go (D07)
    renderer.showJackZone(kind === 'jack');
    enterCircle(playerId, aimYaw, undefined, kind);
    enableControls(true);
    renderer.setJackArrow(kind !== 'jack'); // the chevron guides a boule throw only, never the cochonnet's (D17)
    setView('shoulder');
    if (debug && (params.has('viewyaw') || params.has('viewpitch') || params.has('adjust'))) { // ?debug&viewyaw=40&viewpitch=10&adjust
      setViewOffset((+params.get('viewyaw') || 0) * DEG, (+params.get('viewpitch') || 0) * DEG);
      if (params.has('adjust')) setAdjust(true);
    }
    say2(text);
    if (pickHuman !== null || store(HINT_KEY) !== '1') hud.showHint(HINT_TEXT);
    if (demo) { // ?debug&humanturn&demo: a scripted toss preview for screenshots
      rollGuide = true;
      rollBtn.classList.add('is-on');
      // &loft=15 (degrees), &dist=7 (m ahead of the circle), &dx=0.9 (m across), &tir (snap onto the jack)
      const jb = jackBody();
      const tir = params.has('tir') && jb;
      lastToss = {
        donnee: tir ? { x: jb.x, y: jb.y } : ahead(+params.get('dist') || 7, +params.get('dx') || 0.9),
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
    setAdjust(false, { reset: true }); // E12: a released throw ends view adjusting
    audio.unlock();
    store(HINT_KEY, '1');
    hud.hideHint();
    doThrow(kind, playerId, p, undefined, from, loft);
  }

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
  // The full-window layer never requests browser fullscreen; only the corner fullscreen button does (E30)
  function setPlaying(on) {
    if (on === playing) return;
    playing = on;
    if (on) savedScroll = window.scrollY;
    root.classList.toggle('is-playing', on);
    html.classList.toggle('petanque-playing', on);
    hud.showPaused(!on && !!match);
    exitBtn.hidden = !on;
    if (on) {
      window.scrollTo(0, 0);
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
  // E14: browser fullscreen toggle in the corner (desktop only; hidden where the Fullscreen API is missing)
  const ICON_ENTER_FS = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_EXIT_FS = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const fineMedia = window.matchMedia && window.matchMedia('(pointer: fine)');
  fsBtn.hidden = !(fsSupported && (!fineMedia || fineMedia.matches));
  function syncFsBtn() {
    const on = !!document.fullscreenElement;
    fsBtn.innerHTML = on ? ICON_EXIT_FS : ICON_ENTER_FS;
    fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    fsBtn.title = on ? 'Exit full screen' : 'Full screen';
  }
  syncFsBtn();
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(() => {}); }
    else tryFullscreen();
  });
  exitBtn.hidden = true;
  exitBtn.addEventListener('click', () => setPlaying(false));
  window.addEventListener('keydown', (e) => {
    // Esc leaves the view, unless the browser is in fullscreen (it handles that Esc) or a toss used the key
    if (e.key !== 'Escape' || !playing || e.defaultPrevented || document.fullscreenElement) return;
    setPlaying(false);
  });
  document.addEventListener('fullscreenchange', () => { syncFsBtn(); renderer.resize(); logScroll('fullscreenchange'); });
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
    else {
      throwWith(playerId, loft, go, kind).catch((err) => { console.error(err); if (!launched && token === t0) go(); });
      // E21 watchdog: "Rolling…" is up, so if the walk to the circle or the throw animation never reaches the release
      // frame, throw anyway (game time: a pause holds it)
      clock.later(() => { if (!launched && token === t0) { if (debug) console.warn('[throw watchdog] forcing the release'); go(); } }, 12000);
    }
  }

  // ?debug&ailog (D16): one console line per AI boule, the plan (style, donnée, budget clamp, release point vs the hand at
  // launch) when it throws and the result (rest, distance to the jack) when it settles
  const ailog = debug && params.has('ailog');
  let aiLogRec = null;
  function aiLogPlan(player, choice) {
    if (!ailog || !choice.from) return;
    const hand = handFrom(player.id, choice.loft, aiYaw), j = jackBody();
    aiLogRec = {
      player: player.id, difficulty, intent: choice.intent, style: choice.style, loftDeg: +(choice.loft * 180 / Math.PI).toFixed(1),
      donneeM: +Math.hypot(choice.donnee.x - choice.from.x, choice.donnee.y - choice.from.y).toFixed(2),
      jackM: j ? +Math.hypot(j.x - choice.from.x, j.y - choice.from.y).toFixed(2) : null,
      fromVsHandCm: +(Math.hypot(hand.x - choice.from.x, hand.y - choice.from.y, hand.z - choice.from.z) * 100).toFixed(1),
      clampedByM: choice.info ? +choice.info.clampedBy.toFixed(2) : null, fallback: choice.info ? choice.info.fallback : null,
      energyFrac: +(choice.energyFrac ?? 0).toFixed(2),
    };
  }
  function aiLogResult(was) {
    if (!aiLogRec || !was || was.kind !== 'boule') return;
    const j = jackBody(), rec = aiLogRec;
    aiLogRec = null;
    console.log('[ailog]', JSON.stringify({ ...rec, restY: +((was.y - court.circle.y) * court.dir).toFixed(2), dead: was.dead, toJackM: j && !was.dead ? +Math.hypot(was.x - j.x, was.y - j.y).toFixed(2) : null }));
  }

  const sleep = (ms) => clock.sleep(instant ? 0 : ms);

  async function aiJack(player, lead) {
    refreshHud({ team: player.team, playerId: player.id, text: `${player.name} throws the jack` });
    say2(`${lead}${player.name} is aiming…`);
    const t = token;
    await sleep(AI_MIN_THINK + 100);
    if (t !== token) return;
    aiYaw = baseYaw();
    const base = releasePoint(player);
    enterCircle(player.id, aiYaw, undefined, 'jack');
    let choice;
    try {
      choice = chooseJackThrow({ world, difficulty, rand: aiRand, player, from: base, geometry: match && match.geometry });
    } catch (err) { // never stall the game: a plain lob to about 8 m
      console.error(err);
      choice = { label: `${player.name} throws the cochonnet`, throwParams: { yaw: baseYaw(), speed: 5, loft: 0.9, backspin: 10, sidespin: 0 } };
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
    const snapped = choice.style === 'tir';
    const showArc = debug && params.has('aispot'); // the arc, cone, donnée and legal zone stay hidden from players (D18)
    renderer.setThrowPreview(null);
    renderer.showJackZone(false);
    if (showArc) {
      const skill = scaledSkill(SKILL[player.id] || SKILL.human, difficulty);
      const cone = coneFor({ skill, from, landing: choice.donnee, loft: choice.loft, energyFrac: choice.energyFrac });
      const env = coneEnvelope({ from, landing: choice.donnee, loft: choice.loft, cone, terrain: world.terrain });
      renderer.setThrowPreview({
        ...env, roll: null, donnee: choice.donnee, style: choice.style || styleForLoft(choice.loft, snapped),
        snapped, legalZone: kind === 'jack',
      });
    }
    say2(spot);
    await sleep(showArc ? 1e8 : 1100); // ?debug&aispot holds the view for screenshots
    if (t === token) { renderer.setThrowPreview(null); renderer.showJackZone(false); }
    shoulderCam.yaw = aimYaw;
  }

  // Status line while an AI shows its spot: the factual label and distance, then the player's own line.
  // The distance is where the throw lands (the donnée); a jack rolls on after landing, so its line also gives the
  // distance it should come to rest at (noiseless prediction), and the settled distance is reported afterwards.
  function spotText(player, choice, kind) {
    const key = choice.labelKey || { event: kind === 'jack' ? 'spotJack' : 'spotPoint' };
    const dist = (q) => Math.hypot(q.x - court.circle.x, q.y - court.circle.y);
    const target = key.target === 'jack' ? 'the jack' : player.team === 1 ? 'your boule' : 'their boule';
    let tail = '.';
    if (choice.donnee && kind === 'jack' && choice.from) {
      const tp = solveLaunch({ from: choice.from, landing: choice.donnee, loft: choice.loft, terrain: world.terrain });
      const path = predictRoll({ world, terrain, throwParams: tp, from: choice.from, kind: 'jack' });
      const end = path[path.length - 1];
      tail = ` (lands at ${dist(choice.donnee).toFixed(1)} m, should roll to about ${dist(end).toFixed(1)} m).`;
    } else if (choice.donnee) tail = ` (lands at ${dist(choice.donnee).toFixed(1)} m).`;
    const facts = (choice.label || `${player.name} picks ${player.id === 'odette' ? 'her' : 'his'} spot`) + tail;
    // the tactical reason (D13) first, then the generic line for the event
    const why = choice.why;
    const quip = (why && why.code !== 'mistake' && talk.say(player.id, 'why.' + why.code, { target, ...why })) || talk.say(player.id, key.event, { target });
    return quip ? `${facts} ${quip}` : facts;
  }

  async function aiBoule(player) {
    say2(`${player.name} is aiming…`);
    renderer.clearMeasure(); // aiming starts: the between-throws lines go (D07)
    const t = token;
    const jk = jackBody();
    aiYaw = jk && !jk.dead ? Math.atan2(jk.x - court.circle.x, jk.y - court.circle.y) : baseYaw();
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
      await clock.resumed(); // D12: a decision that finishes while paused waits for Resume
    } catch (err) {
      console.error(err);
      if (t !== token) return;
      // fall back to a plain throw at the jack so the game never stalls
      const j = jackBody();
      const yaw = j ? Math.atan2(j.x - court.throwFrom.x, j.y - court.throwFrom.y) : baseYaw();
      choice = { label: `${player.name} throws`, throwParams: { yaw, speed: 6.5, loft: 0.6, backspin: 40, sidespin: 0 } };
    }
    if (t !== token) return;
    if (!instant) say2(choice.label);
    const spot = instant ? choice.label : spotText(player, choice, 'boule');
    if (!instant) await showAiSpot(player, choice, 'boule', spot);
    else await sleep(700);
    if (t !== token) return;
    aiLogPlan(player, choice);
    doThrow('boule', player.id, choice.throwParams, spot, choice.from, choice.from ? choice.loft : undefined);
  }

  // Planning base for an AI that is not (yet) in the circle: facing the jack
  function aiBase(player) {
    const jk = jackBody(), c = court.circle;
    const yaw = jk && !jk.dead ? Math.atan2(jk.x - c.x, jk.y - c.y) : baseYaw();
    return { x: c.x, y: c.y, release: (l) => handFrom(player.id, l, yaw) };
  }

  // Pierre looks at the court and tells you what he would do
  async function suggest(pierre) {
    const mine = ++thinkToken;
    const t = token;
    let choice, who;
    try {
      // who should throw (analytic, each with their own cone), then what that player should do: Pierre's blended advice
      const avail = playersWithBoules(match, pierre.team);
      who = whoThrows({ match, bodies: world.bodies, team: pierre.team, difficulty, players: avail }).player || pierre;
      choice = await chooseThrowAsync({ world, match, player: who, difficulty, rand: aiRand, from: aiBase(pierre), advice: true });
    } catch (err) { return; }
    if (mine !== thinkToken || t !== token) return;
    const j = jackBody();
    const foes = world.bodies.filter((b) => b.kind === 'boule' && !b.dead && b.team === 1 && j);
    foes.sort((a, b) => Math.hypot(a.x - j.x, a.y - j.y) - Math.hypot(b.x - j.x, b.y - j.y));
    // E09: one decision (who + intent) gives one line; a reason for the other action is never merged in
    const shoot = choice.intent === 'shoot';
    const atBoule = shoot && foes.length && !(choice.labelKey && choice.labelKey.target === 'jack');
    const target = atBoule ? `${ownerName(foes[0])} boule` : 'the jack';
    const fact = atBoule ? `(${target} is ${gapText(foes[0], j)} from the jack.)` : '';
    const code = choice.why && choice.why.code !== 'mistake' ? choice.why.code : 'takePoint';
    const avail = playersWithBoules(match, pierre.team);
    const kind = whoKind({ intent: choice.intent, thrower: who, pierre, pierreHasBoules: avail.some((p) => p.id === pierre.id) && pierre.boulesLeft > 0, teamSize: avail.length });
    hud.setSuggestion(composeSuggestion(talk, { intent: choice.intent, code, kind, vars: { target, ...choice.why }, fact }), who.id);
    if (pickHuman !== null && pickHuman !== 'chooser') beginTurn('you'); // debug: go straight to the human throw
  }

  // ---- D11: players fetch dead balls and place the cochonnet (GAME-PLAN section 10) ----
  // A teammate of the thrower walks out to each dead ball at rest, bends, picks it up (the body then follows the hand)
  // and sets it down in the row beyond the far string; a failed cochonnet is carried to the player who places it,
  // handed over, and walked out to the chosen spot. Instant mode and reduced motion teleport. Fetching never holds
  // up a turn for long: the next turn waits (briefly) only while the fetcher is still in view.
  const FETCH_SPEED = 1.35; // m/s
  const FETCH_VIEW_WAIT = 20000; // ms: longest a new turn waits for a fetcher to leave the court's view (a click or key ends it)
  let fetchJob = null; // { id, tok, cancelled } the character at work
  let carry = null; // { body, id }: a ball riding in somebody's hand
  let jackFetch = null; // { placer, ready } while a failed cochonnet is brought to its placer
  let lastThrowerId = null;
  let placing = null; // { id, spot, skipped, start } while the cochonnet is walked out
  let fetchFreezeAt = 0; // ?debug&fetch&fetchat=seconds
  let fetchClockT = 0;
  let fetchPump = false;
  const fetchScript = debug && params.has('fetch');
  const fetchAlive = (job) => !job.cancelled && job.tok === token && (!!match || !!job.scripted);
  const reachOf = (ch) => { const r = bendReach(ch.height, ch.hand); return { x: r[0], y: r[1] }; };
  const rowCount = () => world.bodies.filter((b) => b.slotted && b.kind === 'boule').length;
  const deadTargets = () => world.bodies.filter((b) => b.dead && !b.slotted && b.state === 'resting' && !(carry && carry.body === b));
  const courtView = (p) => p.x > -0.3 && p.x < C.terrainW + 0.3 && (court.dir > 0 ? p.y > -0.3 && p.y < C.terrainL + 0.8 : p.y > -0.8 && p.y < C.terrainL + 0.3); // roughly what the shoulder camera sees
  const obstaclesExcept = (body) => world.bodies.filter((b) => !b.dead && b !== body).map((b) => ({ x: b.x, y: b.y }));
  // a ball in the hand hangs just under the fist (the hand is 5 cm across), never below the ground
  const handBall = (id, r) => { const h = cast.get(id).handWorldPosition(); return { x: h.x, y: h.y, z: Math.max(h.z - 0.03 - r, terrain.sample(h.x, h.y).h + r) }; };
  function followCarry() { // the carried ball rides in the hand (called after the characters are posed)
    if (!carry) return;
    const b = carry.body, h = handBall(carry.id, b.r);
    b.x = h.x; b.y = h.y; b.z = h.z; b.vx = b.vy = b.vz = 0; b.state = 'resting';
  }
  // E10: the circle is a ring object. Slow mode: the last thrower carries it from the old circle to the new one.
  let ringCarry = null; // id of whoever holds the ring
  let ringBusy = false;
  function followRing() { // the ring rides in the hand
    if (!ringCarry) return;
    const h = cast.get(ringCarry).handWorldPosition();
    renderer.setRingPose({ x: h.x, y: h.y, z: Math.max(h.z - 0.04, terrain.sample(h.x, h.y).h + 0.03) });
  }
  // The circle and direction become the new ones: aim, camera and zones follow (court.js is the single source)
  function applyCourt(circle, dir, fade) {
    setCourt(circle, dir);
    aimYaw = baseYaw(); throwerYaw = aimYaw; shoulderCam.yaw = aimYaw;
    shoulderCam.viewYaw = 0; shoulderCam.viewPitch = 0;
    renderer.syncCourt({ fade: !!fade });
  }
  async function carryRing(from, to) {
    const t = token;
    const last = match.players.find((p) => p.id === lastThrowerId) || match.players.find((p) => p.team === match.jackTeam);
    const id = last.id;
    const job = { id, tok: t, cancelled: false, scripted: false };
    for (let n = 0; n < 80 && fetchJob && t === token; n++) await sleep(100); // let a fetch finish first
    if (t !== token) return;
    const ch = cast.get(id), r = reachOf(ch);
    if (inCircle === id) inCircle = null;
    ch.setHolding(false); ch.setHeldBoules(null); ch.setStance('watch'); shadow(id, true);
    job.obstacles = () => obstaclesExcept(null);
    fetchCam(job, [id], [from]);
    await walkVia(job, id, { x: from.x - r.x, y: from.y - r.y, yaw: 0 });
    if (t !== token) return;
    await ch.playBend({ kind: 'pickup', onAct: () => { ringCarry = id; ch.setCarrying(true); followRing(); } });
    if (t !== token) { ringCarry = null; renderer.setRingPose(null); return; }
    fetchCam(job, [id], [to]);
    await walkVia(job, id, { x: to.x - r.x, y: to.y - r.y, yaw: 0 });
    if (t !== token) { ringCarry = null; renderer.setRingPose(null); return; }
    await ch.playBend({ kind: 'putdown', onAct: () => { ringCarry = null; ch.setCarrying(false); renderer.setRingPose({ x: to.x, y: to.y, z: terrain.sample(to.x, to.y).h + 0.006 }); } });
    ringCarry = null;
  }
  function dropDead(body, slot) { // set a dead ball down in the row (or its jack spot): out of play, nobody's
    const s = slot || (body.kind === 'jack' ? deadJackSpot() : deadRowSlot(rowCount()));
    placeDeadBall(world, body, s.x, s.y);
    body.slotted = true;
    if (carry && carry.body === body) carry = null;
  }
  function dropAllDead() { for (const b of deadTargets()) dropDead(b); }
  // E02: true inside the strings, the field of play
  const inField = (p) => p.x > 0 && p.x < C.terrainW && p.y > 0 && p.y < C.terrainL;
  // walk a planned route (around live boules, over the timbers; `outside`: round the outside of the timbers) to { x, y, yaw }
  async function walkVia(job, id, to, outside = false) {
    const ch = cast.get(id), p = ch.root.position;
    const path = planRoute({ x: p.x, y: p.y }, to, job.obstacles ? job.obstacles() : obstaclesExcept(null), { outside });
    const last = path[path.length - 1] || { lift: 1 };
    await ch.walkTo({ x: to.x, y: to.y, yaw: to.yaw, speed: FETCH_SPEED, lift: last.lift, via: path.slice(0, -1) });
  }
  // The head camera follows the fetch loosely: it frames the fetcher and where they are going (never over an aim)
  function fetchCam(job, ids, spots = []) {
    if (pending || flying || job.jack || !fetchAlive(job) || (job.scripted && !params.has('fetchcam'))) return;
    const pts = ids.map((i) => cast.get(i).root.position).concat(spots).map((q) => ({ x: q.x, y: q.y }));
    const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length, cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
    renderer.setCamera('head', { target: { x: cx, y: cy }, points: pts });
  }
  async function pickUp(job, body) {
    const ch = cast.get(job.id), p = ch.root.position;
    fetchCam(job, [job.id], [body]);
    const sp = standPoint(body, p, reachOf(ch));
    shadow(job.id, true);
    job.obstacles = () => obstaclesExcept(body);
    await walkVia(job, job.id, sp, !inField(body)); // E02: a ball outside the timbers is reached round the outside
    if (!fetchAlive(job)) return false;
    await ch.playBend({ kind: 'pickup', onAct: () => { carry = { body, id: job.id }; ch.setCarrying(true); followCarry(); } });
    return fetchAlive(job);
  }
  async function putDown(job, body, slot, then) { // stand at the slot, bend, let go
    const ch = cast.get(job.id), r = reachOf(ch);
    fetchCam(job, [job.id], [slot]);
    await walkVia(job, job.id, { x: slot.x - r.x, y: slot.y - r.y, yaw: 0 }, true); // E02: carried round the outside of the timbers
    if (!fetchAlive(job)) return false;
    await ch.playBend({ kind: 'putdown', onAct: () => { ch.setCarrying(false); if (then) then(); else dropDead(body, slot); } });
    return fetchAlive(job);
  }
  async function walkHome(job) { // out of the court by the nearer side (so they leave the shoulder view), then round to the waiting spot
    const id = job.id, ch = cast.get(id), home = homeSpot(id), p = ch.root.position;
    if (inCircle === id) return;
    let at = { x: p.x, y: p.y };
    if (courtView(at) && snapMove()) { // (E02: in slow mode the route round the outside of the timbers leaves the court by itself)
      const side = { x: at.x < C.terrainW / 2 ? -1.1 : C.terrainW + 1.1, y: Math.max(at.y, 1.5) };
      await walkVia(job, id, side);
      if (!fetchAlive(job) || inCircle === id) return;
    }
    await walkVia(job, id, { x: home.x, y: home.y, yaw: home.yaw }, !snapMove());
    if (fetchAlive(job) && inCircle !== id) { ch.setStance('watch'); shadow(id, false); }
  }
  function sendHome(id) { // teleport to the waiting spot (a skipped walk, a preempted fetch)
    if (inCircle === id) return;
    const ch = cast.get(id);
    ch.setCarrying(false); ch.setHolding(false); ch.setStance('watch'); shadow(id, false);
    const h = homeSpot(id);
    placeAt(id, h.x, h.y, h.yaw);
  }
  // Stop whoever is fetching: a ball in hand goes straight to its place. Returns the job that was running.
  function cancelFetch() {
    const job = fetchJob;
    if (!job) return null;
    job.cancelled = true; fetchJob = null;
    if (carry && carry.id === job.id) { if (carry.body.dead) dropDead(carry.body); else carry = null; }
    cast.get(job.id).setCarrying(false);
    return job;
  }
  async function runFetch(id, scripted, hold = false) {
    const job = { id, tok: token, cancelled: false, scripted, hold };
    fetchJob = job;
    const ch = cast.get(id);
    try {
      await sleep(900); // let the reactions play first
      for (let n = 0; n < 12 && fetchAlive(job); n++) {
        const p = ch.root.position;
        const body = deadTargets().sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (!body) break;
        if (!(await pickUp(job, body))) break;
        const slot = body.kind === 'jack' ? deadJackSpot() : deadRowSlot(rowCount());
        if (!(await putDown(job, body, slot))) break;
      }
      if (fetchAlive(job)) await walkHome(job);
    } catch (err) { console.error(err); }
    if (fetchJob === job) fetchJob = null;
  }
  // After a throw settles: queue the fetching (the thrower's teammate, or the thrower if alone)
  function kickFetch(was) {
    if (!deadTargets().length) return;
    if (instant) { dropAllDead(); return; }
    if (snapMove()) { // reduced motion: no walking, the balls fade out where they lie and in again in the row
      later(() => {
        const bodies = deadTargets();
        for (const b of bodies) renderer.fadeBody(b.id, -1, 0.25);
        later(() => { dropAllDead(); for (const b of bodies) renderer.fadeBody(b.id, 1, 0.25); }, 300);
      }, 400);
      return;
    }
    if (fetchJob || jackFetch) return;
    const fetcher = pickRetriever();
    if (fetcher) runFetch(fetcher.id, false, deadTargets().some(inField)); // E02: play waits while somebody walks onto the court
  }
  // E02: the retriever is one of the players who aren't throwing next: those without a turn coming (the other team when
  // the next team has two with boules, else everyone but the one left), the one with the shortest walk to the nearest ball
  function pickRetriever() {
    if (!match) return null;
    const team = nextTeam(match);
    const next = team === null ? [] : playersWithBoules(match, team);
    let cands = match.players.filter((p) => !next.includes(p) && p.id !== inCircle);
    if (!cands.length) cands = match.players.filter((p) => !next.includes(p));
    if (!cands.length) cands = match.players.filter((p) => p.id !== inCircle);
    if (!cands.length) cands = match.players.slice();
    const targets = deadTargets();
    if (!targets.length) return cands[0];
    const walk = (p) => {
      const ch = cast.get(p.id), q = ch.root.position, from = { x: q.x, y: q.y };
      let best = Infinity;
      for (const b of targets) {
        const sp = standPoint(b, from, reachOf(ch));
        best = Math.min(best, pathLength(from, planRoute(from, sp, obstaclesExcept(b), { outside: !inField(b) })));
      }
      return best;
    };
    return cands.map((p) => ({ p, d: walk(p) })).sort((a, b) => a.d - b.d)[0].p;
  }
  // True while a new turn should hold on for a moment because the fetcher is still walking about in view. Gives up
  // after FETCH_VIEW_WAIT: the fetcher is then sent home (a ball in hand is put in its place).
  let gateSince = 0;
  function fetchGate() {
    const job = fetchJob;
    // E02 (slow mode): only a ball on the court holds the turn up: while one still lies there or the carrier is on the court
    const held = job && job.hold && (deadTargets().some(inField) || inField(cast.get(job.id).root.position));
    if (!job || job.scripted || snapMove() || !held) { gateSince = 0; return false; }
    if (!gateSince) gateSince = clock.now();
    if (clock.now() - gateSince < FETCH_VIEW_WAIT) return true;
    gateSince = 0;
    cancelFetch(); sendHome(job.id); dropAllDead();
    return false;
  }
  // A cochonnet that failed: the thrower's teammate fetches it and hands it to the placer (D00 rules)
  function startJackFetch(placing_, aiPlaces) {
    if (snapMove() || jackFetch || !match) return;
    const jack = jackBody();
    if (!jack) return;
    const thrower = match.players.find((p) => p.id === lastThrowerId);
    const team = thrower ? thrower.team : match.jackTeam;
    const mates = match.players.filter((p) => p.team === team && p !== thrower);
    const fetcher = mates[0] || thrower || match.players.find((p) => p.team === team);
    let placer;
    if (aiPlaces) {
      const cands = match.players.filter((p) => p.team === placing_ && !p.isHuman);
      placer = cands[Math.floor(chance() * cands.length)] || cands[0];
    } else placer = match.players.find((p) => p.team === placing_ && p.isHuman);
    if (!fetcher || !placer) return;
    cancelFetch();
    if (slow()) { // E02: the player who will place the cochonnet walks to it and picks it up: no hand-over
      const pjob = { id: placer.id, tok: token, cancelled: false, jack: true };
      fetchJob = pjob;
      jackFetch = { placer, tok: token, ready: null };
      jackFetch.ready = (async () => {
        try {
          await sleep(700);
          if (fetchAlive(pjob)) await pickUp(pjob, jack);
        } catch (err) { console.error(err); }
        if (fetchJob === pjob) fetchJob = null;
      })();
      return;
    }
    const job = { id: fetcher.id, tok: token, cancelled: false, jack: true };
    fetchJob = job;
    jackFetch = { placer, tok: token, ready: null };
    jackFetch.ready = (async () => {
      try {
        await sleep(700);
        if (!fetchAlive(job) || !(await pickUp(job, jack))) return;
        await handOver(job, placer.id);
        if (fetchAlive(job)) await walkHome(job);
      } catch (err) { console.error(err); }
      if (fetchJob === job) fetchJob = null;
    })();
    // `ready` resolves once the jack is in the placer's hand (the fetcher's walk home carries on)
    const handed = new Promise((res) => { jackFetch.handed = res; });
    jackFetch.ready = Promise.race([handed, jackFetch.ready]);
  }
  async function handOver(job, toId) { // meet the receiver face to face and pass the ball hand to hand
    const a = cast.get(job.id), b = cast.get(toId), pa = a.root.position, pb = b.root.position;
    const dx = pa.x - pb.x, dy = pa.y - pb.y, l = Math.hypot(dx, dy) || 1;
    const meet = { x: pb.x + dx / l * 0.95, y: pb.y + dy / l * 0.95 };
    const yawA = Math.atan2(pb.x - meet.x, pb.y - meet.y);
    b.walkTo({ x: pb.x, y: pb.y, yaw: yawA + Math.PI, speed: FETCH_SPEED });
    await walkVia(job, job.id, { ...meet, yaw: yawA });
    if (!fetchAlive(job)) return;
    a.setStance('give'); b.setStance('give');
    await sleep(600);
    if (!fetchAlive(job) || !carry) return;
    carry = { body: carry.body, id: toId };
    a.setCarrying(false); b.setCarrying(true);
    await sleep(500);
    a.setStance('watch'); b.setStance('watch');
    if (jackFetch && jackFetch.handed) jackFetch.handed();
  }
  // The placer walks the cochonnet out to `spot`, crouches, sets it down (placeJack at the release), walks back.
  async function placeWalk(id, spot) {
    const ch = cast.get(id), tok = token;
    const job = { id, tok, cancelled: false, scripted: !match };
    const mine = placing && placing.id === id && placing.spot === spot ? placing : (placing = { id, spot, skipped: false, start: performance.now() });
    const gone = () => mine.skipped || tok !== token;
    if (!carry || carry.id !== id) { // the jack must be in this placer's hand; if not (a cancelled fetch) it appears there
      const j = jackBody();
      if (j) carry = { body: j, id };
      ch.setCarrying(true);
    }
    shadow(id, true);
    const p = ch.root.position;
    const r = reachOf(ch);
    const sp = standPoint(spot, { x: p.x, y: p.y }, r);
    job.obstacles = () => obstaclesExcept(null).filter((o) => Math.hypot(o.x - spot.x, o.y - spot.y) > 0.01);
    await walkVia(job, id, sp);
    if (gone()) return;
    await ch.playBend({
      kind: 'putdown',
      onAct: () => {
        const held = carry && carry.body;
        carry = null; jackFetch = null; ch.setCarrying(false);
        if (match) placeJack(spot);
        else if (held) { held.dead = held.ghost = false; held.x = spot.x; held.y = spot.y; held.z = terrain.sample(spot.x, spot.y).h + held.r; } // ?debug&fetch
      },
    });
    if (gone()) return;
    if (placing === mine) placing = null;
    walkHome(job).catch((err) => console.error(err));
  }
  // The human may skip the walk with a click or key: straight to the end state (jack down, everyone back)
  function skipPlacement() {
    const p = placing;
    if (!p || p.skipped) return;
    p.skipped = true; placing = null;
    const fetcher = fetchJob && fetchJob.id;
    cancelFetch();
    carry = null; jackFetch = null;
    if (match && match.phase === 'jackPlace') placeJack(p.spot);
    sendHome(p.id);
    if (fetcher) sendHome(fetcher);
    jackFetch = null;
  }
  function skipFetchWait() { // a click or key while the next turn waits on a fetcher: they finish at once
    const job = cancelFetch();
    if (job) sendHome(job.id);
    dropAllDead();
    gateSince = 0;
  }
  // E01: switching to quick mid-game finishes any walk in progress at once (switching to slow starts at the next action)
  settings.onChange((m) => {
    if (m !== 'quick' || !match) return;
    if (placing) skipPlacement();
    const fj = fetchJob, jf = jackFetch;
    if (fj) { cancelFetch(); if (!fj.jack || !jf) sendHome(fj.id); }
    if (jf) {
      if (match.phase === 'jackPlace' && !placing) { jackFetch = null; if (fj) sendHome(fj.id); if (jf.handed) jf.handed(); }
    }
    if (deadTargets().length) dropAllDead();
    for (const [id, ch] of cast) if (id !== inCircle && ch.busy && !(carry && carry.id === id)) sendHome(id);
    gateSince = 0;
  });
  const skipEvent = (ev) => {
    if (isPaused()) return; // a drag to orbit the paused scene (or Esc) is not a skip
    if (placing && ev.timeStamp - placing.start > 350) skipPlacement();
    else if (circleWalk && performance.now() - circleWalk.start > 350) { // E02: the thrower is at the circle at once
      const w = circleWalk; circleWalk = null;
      if (w.tok === token) placeAt(w.id, court.circle.x, court.circle.y, w.yaw);
    }
    else if (!placing && gateSince && fetchJob) skipFetchWait();
  };
  window.addEventListener('keydown', skipEvent);
  canvas.addEventListener('pointerdown', skipEvent);
  // Human click on a green spot: the human's character carries the jack out (after the fetch hands it over)
  function placeJackWalk(spot) {
    if (!match || match.phase !== 'jackPlace') return;
    if (snapMove() || !jackFetch) { placeJack(spot); return; }
    toss.setPhase('off');
    renderer.setPlaceMarker({ x: spot.x, y: spot.y, valid: true });
    const id = jackFetch.placer.id, fetch = jackFetch;
    placing = { id, spot, skipped: false, start: performance.now() };
    const mine = placing;
    say2('You carry the cochonnet out (click or press a key to skip the walk).');
    fetch.ready.then(() => { if (!mine.skipped && token === fetch.tok) return placeWalk(id, spot); }).catch((err) => console.error(err));
  }

  // Pick who throws next, from rules.nextTeam()
  function nextTurn() {
    if (fetchGate()) { later(nextTurn, 300); return; } // D11: wait while a fetcher is still in view
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
    // AI side: the better-placed player throws (tactics.whoThrows; on a tie the one with more boules)
    const pl = avail.length > 1 ? whoThrows({ match, bodies: world.bodies, team, difficulty, players: avail }).player : avail[0];
    beginTurn(pl.id);
  }

  function beginTurn(playerId) {
    thinkToken++; // drop a partner suggestion still being computed
    hud.hideChooser();
    const player = match.players.find((p) => p.id === playerId);
    refreshHud({ team: player.team, playerId, text: `${player.isHuman ? 'Your throw' : player.name + ' to throw'}` });
    const start = () => {
      if (player.isHuman) humanTurn('boule', playerId, 'Your turn. Turn with a sideways drag, then press where you want the boule to land.');
      else aiBoule(player).catch((err) => console.error(err));
    };
    const pos = cast.get(playerId).root.position;
    if (slow() && Math.hypot(pos.x - court.circle.x, pos.y - court.circle.y) > 0.05) { // E02: the turn starts when they arrive at the circle
      const t = token;
      say2(`${player.isHuman ? 'You walk' : player.name + ' walks'} to the circle…`);
      enterCircle(playerId, baseYaw()).then(() => { if (t === token && match && match.phase === 'play') start(); });
    } else start();
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
    if (was.kind === 'jack') return `Jack is ${Math.hypot(was.x - court.circle.x, was.y - court.circle.y).toFixed(1)} m out.`;
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

  // ---- Invalid jack: the other team places it by hand ----
  function faultText(f) {
    if (!f) return '';
    const d = f.dist.toFixed(1);
    if (f.reason === 'short') return `Too short: ${d} m.`;
    if (f.reason === 'far') return `Too far: ${d} m.`;
    if (f.reason === 'line') return `Out over the ${f.side} line.`;
    if (f.reason === 'end') return `Too close to the end string: ${f.gap.toFixed(1)} m, it needs ${f.margin} m.`;
    if (f.back) return 'Went over a line and came back.';
    return 'Out of bounds.';
  }
  // Wide view over the whole 6 to 10 m zone, with the legal-zone arcs
  function placeView() {
    renderer.showJackZone(true, 'place');
    { // E10: frame the whole 6-10 m zone of the current circle and direction, string to string
      const c = court.circle, d = court.dir, y0 = c.y + d * 4.8, y1 = Math.max(0.4, Math.min(C.terrainL - 0.4, c.y + d * 10.6));
      renderer.setCamera('head', { target: { x: C.terrainW / 2, y: (y0 + y1) / 2 }, points: [{ x: 0.1, y: y0 }, { x: 3.9, y: y1 }] });
    }
  }
  function jackFailed(jack, note) {
    const placing = match.placingTeam;
    const fault = jackFault(jack, match.geometry);
    const why = faultText(fault);
    const jb = jackBody();
    if (debug) console.info('[jack] invalid', JSON.stringify({ x: +jack.x.toFixed(2), y: +jack.y.toFixed(2), dead: !!jack.dead, state: jb && jb.state, ghost: jb && jb.ghost, fault }));
    const aiPlaces = placing === 1 || !match.players.some((p) => p.team === placing && p.isHuman);
    pending = null;
    startJackFetch(placing, aiPlaces); // D11: the thrower's teammate fetches the cochonnet and hands it to the placer
    refreshHud({ team: placing, playerId: null, text: aiPlaces ? 'Placing the jack' : 'Place the jack' });
    placeView();
    if (aiPlaces) {
      say2(`${why} ${TEAM_NAMES[placing]} place the cochonnet.`);
      later(() => aiPlaceJack(why).catch((err) => console.error(err)), 1300);
    } else {
      say2(`${why} You and Pierre place the cochonnet: click a green spot between the yellow arcs (6 to 10 m out).`);
      later(() => humanPlaceJack(), 1300);
      if (debug && params.has('px')) humanPlaceMarker(); // screenshots: show the marker at once
    }
  }
  function removeJack() {
    const old = jackBody();
    if (old) world.bodies.splice(world.bodies.indexOf(old), 1);
    renderer.sync(world);
  }
  function humanPlaceJack() {
    if (!match || match.phase !== 'jackPlace') return;
    if (!jackFetch) removeJack(); // D11: still out there until the fetcher picks it up
    enableControls(false);
    placeView();
    toss.setPhase('place');
    if (debug && params.has('px')) humanPlaceMarker();
  }
  function humanPlaceMarker() { // ?debug&px=2&py=8.5: show the marker without a pointer
    const p = { x: +params.get('px'), y: +params.get('py') || 8.5 };
    renderer.setPlaceMarker({ ...p, valid: jackPlaceValid(p, match.geometry) });
  }
  async function aiPlaceJack(why, attempt = 0) {
    const t = token;
    if (!match || match.phase !== 'jackPlace') return;
    const cands = match.players.filter((p) => p.team === match.placingTeam && !p.isHuman);
    const placer = (jackFetch && jackFetch.placer) || cands[Math.floor(chance() * cands.length)] || cands[0];
    if (!jackFetch) removeJack(); // D11: with a fetch under way the jack is still lying out there until it is picked up
    const spot = chooseJackPlacement({ match, player: placer, difficulty, rand: aiRand, terrain: world.terrain, attempt });
    const quip = talk.say(placer.id, 'jackPlace');
    say2(`${why} ${spot.label}.${quip ? ' ' + quip : ''}`);
    if (!instant) {
      placeView();
      // E03: an AI's target stays hidden from players; ?debug&showtarget shows it in the aispot / jackplace=ai debug views
      const showTarget = debug && params.has('showtarget') && (params.has('aispot') || params.get('jackplace') === 'ai');
      if (showTarget) renderer.setPlaceMarker({ x: spot.x, y: spot.y, valid: true });
    }
    const fetched = jackFetch;
    await Promise.all([sleep(debug && params.has('jphold') ? 1e8 : 2000), fetched && fetched.ready]); // ?debug&jackplace=ai&jphold keeps the marker up for screenshots
    if (t !== token) return;
    if (fetched && slow()) { await placeWalk(placer.id, spot); return; } // D11: walk it out and set it down
    placeJack(spot);
  }
  // E04: set the jack down at `spot` (placer's hand, or at once in quick mode) and simulate it for real, with a
  // small drop, on the natural ground. Play starts only once it has come to rest on a valid spot (placeDone).
  function placeJack(spot) {
    if (!match || match.phase !== 'jackPlace' || flying) return;
    if (!jackPlaceValid(spot, match.geometry)) return;
    removeJack();
    renderer.setPlaceMarker(null);
    renderer.showJackZone(false);
    toss.setPhase('off');
    const h = world.terrain.sample(spot.x, spot.y).h;
    const body = createBody('jack', { team: -1, x: spot.x, y: spot.y, z: h + C.jack.r + 0.04, state: 'airborne' });
    world.add(body);
    flying = body;
    throwEvents = [];
    renderer.sync(world);
    headView(body);
  }
  // The placed jack has come to rest: valid starts play, otherwise a yellow card and the same team places again
  function placeDone() {
    const j = jackBody();
    const jack = j ? { x: j.x, y: j.y, dead: !!j.dead } : { x: 0, y: 0, dead: true };
    const forced = debug && params.has('yellow') && !yellowDone;
    const next = forced ? match : apply(match, { type: 'jackPlaceSettled', team: match.placingTeam, jack });
    if (!forced && next.phase === 'play') { match = next; afterPlaced(); return; }
    yellowDone = true;
    if (!forced) match = next;
    const placing = match.placingTeam;
    const aiPlaces = placing === 1 || !match.players.some((p) => p.team === placing && p.isHuman);
    const f = jackPlaceFault(jack, match.geometry);
    const why = jack.dead ? 'It rolled out of play.' : !f || f.reason === 'line' ? 'It rolled outside the lines.' : f.reason === 'short' ? `It rolled too close: ${f.dist.toFixed(1)} m.` : `It rolled too far: ${f.dist.toFixed(1)} m.`;
    const attempt = match.yellowCards || 1;
    placeView();
    refreshHud({ team: placing, playerId: null, text: aiPlaces ? 'Placing the jack' : 'Place the jack' });
    if (aiPlaces) {
      hud.showYellowCard({ detail: why });
      say2(`Yellow card! Place the cochonnet correctly! ${why}`);
      later(() => { hud.hideOverlay(); aiPlaceJack('Again, more carefully.', attempt).catch((err) => console.error(err)); }, 2800);
    } else {
      say2(`Yellow card! ${why}`);
      hud.showYellowCard({ detail: why, button: true }, () => humanPlaceJack());
    }
  }
  function afterPlaced() { // the jack is at rest on its spot (E04: after its drop): show it and carry on
    const j = jackBody();
    if (!j || !match) return;
    match = { ...match, jack: { x: j.x, y: j.y, dead: j.dead } };
    headView(j);
    const first = match.players.filter((p) => p.team === match.jackTeam && p.isHuman).length ? 'You and Pierre play' : `${TEAM_NAMES[match.jackTeam]} play`;
    say2(`Jack placed at ${Math.hypot(j.x - court.circle.x, j.y - court.circle.y).toFixed(1)} m. ${first} first.`);
    later(startPlay, 1400);
  }
  // ?debug&jackplace[=ai]: skip the throw and fail the jack, so the placement shows at once
  function forceInvalidJack(team) {
    const spot = { x: +params.get('jx') || 2, y: +params.get('jy') || 5.2 };
    removeJack();
    world.add(createBody('jack', { team: -1, x: spot.x, y: spot.y }));
    renderer.sync(world);
    match = apply(match, { type: 'jackThrown', team, jack: spot });
    jackFailed(spot, '');
    if (params.has('yellow')) { // ?debug&jackplace&yellow: set the jack down at once; the first rest counts as a yellow card
      cancelFetch(); jackFetch = null; placeJack({ x: +params.get('yx') || 2, y: +params.get('yy') || 8.5 });
      for (let g = 0; flying && !world.settled() && g < 240 * C.hardCapSeconds; g++) world.step();
      if (!world.settled()) world.forceRest();
      if (flying) { flying = null; placeDone(); } // synchronous, so a screenshot under virtual time shows the card
    }
  }

  function onSettled() {
    const was = flying;
    flying = null;
    if (match && match.phase === 'jackPlace') { placeDone(); return; } // E04: the hand-placed jack came to rest
    aiLogResult(was);
    if (!match) { // debug throws outside a game
      const j = jackBody();
      if (j && !j.dead) headView(j);
      else aimView();
      return;
    }
    lastThrowerId = was.owner || lastThrowerId; // D11: who fetches
    const evs = throwEvents.concat(world.events);
    if (instant) markLandings(world.events);
    const snap = snapshot();
    const note = describe(was, evs);
    if (was.kind === 'jack') {
      const team = match.jackTeam;
      match = apply(match, { type: 'jackThrown', team, jack: snap.jack });
      if (match.phase === 'jackPlace') { // invalid: the other team places it
        jackFailed(snap.jack, note);
        return;
      }
      headView(snap.jack);
      say2(note + ' Play begins.');
      later(startPlay, 1400);
      return;
    }
    const prevHold = holdingTeam(match.jack, match.boules);
    match = apply(match, { type: 'throwSettled', jack: snap.jack, boules: snap.boules });
    if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
      cancelFetch();
      endOfMene(note);
      return;
    }
    headView(snap.jack);
    showBetween();
    const remark = quip(was, prevHold);
    say2(remark ? `${note} ${remark}` : note);
    refreshHud(null);
    react(was, prevHold);
    kickFetch(was); // D11
    later(nextTurn, instant ? 0 : 1800);
  }

  // lift the framing so the circle sits above the card (a bottom card on tall/narrow screens, less on wide ones)
  const SCORING_LIFT = () => (innerWidth / innerHeight < 1 ? 0.2 : 0.15);
  let scoringShown = false;
  function endOfMene(note) {
    const r = match.result;
    scoringShown = false;
    const j = jackBody();
    const jackOut = !j || j.dead;
    if (!jackOut) {
      // scoring circle on the jack around every scoring boule, numbered by closeness, with the best rival outlined
      const pts = [];
      if (!r.void && r.measured && r.measured.length) {
        const byId = new Map(world.bodies.map((b) => [b.id, b]));
        const live = r.measured.map((m) => ({ m, b: byId.get(m.id) })).filter((e) => e.b);
        const rivalE = live.find((e) => e.b.team !== r.team);
        const scoringE = live.filter((e) => e.b.team === r.team && (!rivalE || e.m.dist < rivalE.m.dist));
        if (scoringE.length) {
          const edge = (e) => e.m.dist + e.b.r;
          let radius = Math.max(...scoringE.map(edge));
          const room = rivalE ? (rivalE.m.dist - rivalE.b.r - radius) / 2 : 0.07; // keep the rival just outside when it fits
          radius += Math.min(0.07, Math.max(0.01, room));
          const ink = r.team === 0 ? { fill: '#2f5fb8', edge: '#16315f' } : { fill: '#d9893a', edge: '#8a4a0c' };
          renderer.showScoring(j, {
            radius, fill: ink.fill, edge: ink.edge,
            items: scoringE.map((e, n) => ({ x: e.b.x, y: e.b.y, n: n + 1 })),
            rival: rivalE ? { x: rivalE.b.x, y: rivalE.b.y, r: rivalE.b.r, label: edgeCm(rivalE.b, j) } : null,
          });
          scoringShown = true;
          pts.push({ x: j.x - radius, y: j.y - radius }, { x: j.x + radius, y: j.y + radius });
          if (rivalE) pts.push({ x: rivalE.b.x, y: rivalE.b.y });
        } else renderer.clearMeasure();
      } else renderer.clearMeasure();
      headView(j, pts, scoringShown ? SCORING_LIFT() : 0.4, scoringShown); // subject high in the view, clear of the result card
    } else aimView();
    if (r.void) {
      // say why: a dead jack (even one that rolled back onto the court), tied boules, or no live boules
      const live = world.bodies.filter((b) => b.kind === 'boule' && !b.dead);
      const near = [0, 1].map((t) => live.filter((b) => b.team === t)
        .reduce((m, b) => Math.min(m, Math.hypot(b.x - j.x, b.y - j.y)), Infinity));
      if (jackOut) note = 'The cochonnet went out of bounds, so it is dead (even if it rolled back in) and neither side has boules left: mène void.';
      else if (!live.length) note = 'No live boules on the court: mène void.';
      else if (Math.abs(near[0] - near[1]) <= 0.002) note = 'The closest boules of each team are the same distance from the cochonnet: mène void.';
      else { note = 'Mène void.'; console.warn('[void mène] no reason found: please report this with the details below'); }
      console.info('[void mène]', { jackDead: !!(j && j.dead), jackAt: j && { x: +j.x.toFixed(3), y: +j.y.toFixed(3) },
        liveBoules: live.length, closest: near.map((d) => (Number.isFinite(d) ? +d.toFixed(4) : null)),
        matchJack: match.jack, inHand: match.players.map((p) => `${p.id}:${p.boulesLeft}`).join(' ') });
    }
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

  // E10: the next mène starts from a new circle around the last jack (rules.js picks it), played the other way.
  // Slow mode: the last thrower walks the ring over first; quick mode: it fades to the new spot as the jack throw starts.
  async function nextMene() {
    if (!match || match.phase !== 'meneEnd' || ringBusy) return;
    const next = apply(match, { type: 'nextMene' });
    const g = next.geometry, to = { x: g.circle.x, y: g.circle.y };
    const nc = nextCircle(match.jack, court.dir, { width: g.width, length: g.length }); // E28: placed round the jack, then moved back if the front lacks room
    const t = token;
    hud.hideOverlay();
    if (slow()) {
      ringBusy = true;
      say2('The circle is moved to where the cochonnet finished…');
      try {
        await carryRing({ x: court.circle.x, y: court.circle.y }, nc.placed);
        if (nc.moved && t === token) { say2('Too little court ahead of the ring: it is carried back…'); await carryRing(nc.placed, to); }
      } catch (err) { console.error(err); renderer.setRingPose(null); ringCarry = null; }
      ringBusy = false;
      if (t !== token) return;
    }
    match = next;
    applyCourt(to, g.dir ?? 1, !slow() && !instant);
    beginMene(false);
  }

  // ---- Pause (D12): the page is showing with a game in progress. One switch freezes the game clock (every sleep and
  // later), physics, characters, camera transitions and audio; the scene goes sepia with a free orbit camera, and the
  // game widgets (not the page's paused bar) go sepia and inert. ?debug&paused holds off until the human's turn.
  let pauseHold = debug && params.has('paused');
  const isPaused = () => !pauseHold && !playing && !!match;
  let pausedNow = false, tossPhase = 'off', pausedTok = 0;
  function syncPause() {
    const p = isPaused();
    if (p === pausedNow) return;
    pausedNow = p;
    root.classList.toggle('is-paused', p);
    for (const n of root.querySelectorAll('.pt-board, .pt-dock, .petanque-controls, .pt-overlay')) n.inert = p;
    if (p) { clock.pause(); pausedTok = token; tossPhase = toss.getPhase() === 'toss' ? 'aim' : toss.getPhase(); toss.setPhase('off'); } else { clock.resume(); toss.setPhase(pausedTok === token ? tossPhase : 'off'); } // a New game while paused leaves the toss off
    audio.setPaused(p);
    renderer.setPaused(p);
  }

  // Fixed timestep loop (?debug&timerframes drives it from timers, for headless screenshots under virtual time)
  const nextFrame = debug && params.has('timerframes') ? (f) => setTimeout(() => f(performance.now()), 16) : requestAnimationFrame;
  // E21 hard cap: a throw that hasn't settled after hardCapSeconds of game time (the clock stops while paused) has
  // every moving body forced to rest where it is; ?debug logs what had to be stopped
  let capBody = null, capT0 = 0;
  function hardCap() {
    const stopped = world.forceRest();
    if (debug) console.warn('[hard cap]', `t=${(world.t - capT0).toFixed(1)}s`, JSON.stringify(stopped.map((s) => ({ ...s, x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3), speed: +s.speed.toFixed(4), spin: +s.spin.toFixed(3) }))));
  }
  let acc = 0, last = performance.now();
  const freezeAt = debug ? +params.get('freezeat') || 0 : 0; // ?debug&freezeat=0.6 stops the sim at that time (camera checks)
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (pauseHold && ((pending && now > 1500) || now > 3500)) { pauseHold = false; if (playing) setPlaying(false); else hud.showPaused(true); }
    syncPause();
    clock.tick(dt * 1000);
    acc += dt;
    if (!playing && match) acc = 0; // paused: the page is showing, the game waits
    let n = 0;
    while (acc >= C.dt && n < MAX_STEPS && !(freezeAt && world.t >= freezeAt)) {
      world.step(); acc -= C.dt; n++;
      if (flying) {
        if (flying !== capBody) { capBody = flying; capT0 = world.t; }
        if (!world.settled() && world.t - capT0 > C.hardCapSeconds) hardCap(); // E21: never roll for ever
        if (world.settled()) { try { onSettled(); } catch (err) { console.error('[onSettled]', err); } } // an error here must not kill the frame loop
      }
    }
    if (n === MAX_STEPS) acc = 0; // drop backlog rather than spiral
    if (world.events.length) {
      markLandings(world.events);
      if (flying) throwEvents.push(...world.events.filter((e) => e.type === 'hit'));
      audio.handleEvents(world.events, new Map(world.bodies.map((b) => [b.id, b])));
      world.events.length = 0;
    }
    if (!pausedNow) audio.update(world.bodies, dt); // rolling scrape loops (accepts an array)
    if (!pausedNow) { try { tickCast(dt); } catch (err) { console.error('[tickCast]', err); } } // E21: a throw in a release callback must not stop the loop
    renderer.sync(world);
    renderer.render(pausedNow ? 0 : dt);
    nextFrame(frame);
  }

  aimView();
  nextFrame(frame);

  if (debug) {
    window.__petanque = {
      world, terrain, renderer, seed, reset: toSetup, startGame,
      audio,
      setPlaying, clock,
      get paused() { return pausedNow; },
      get match() { return match; },
      throw: (p) => launchBody(jackBody() && !jackBody().dead ? 'boule' : 'jack', 0, 'you', { ...readParams(), ...p }),
      throwJack: (p) => launchBody('jack', -1, null, { ...readParams(), ...p }),
    };
  }

  // ?debug&play enters the full-window view without a click; the debug modes that start a match do too (otherwise the
  // match would start paused, with the page showing, and an instant match would never run)
  if (debug && (params.has('play') || params.has('autotest') || params.has('jackplace') || params.has('aispot') || pickHuman !== null)) setPlaying(true);

  if (debug && params.has('autotest')) {
    // AI-only quick match, every throw simulated to rest instantly
    startGame({ target: +params.get('target') || 7, difficulty: 'medium', allAI: true, instant: !params.has('animate') }); // &animate: real time
  } else if (debug && params.has('jackplace')) {
    // ?debug&jackplace: Marcel's jack fails and you place it; ?debug&jackplace=ai: your jack fails and the AI places it
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: params.get('jackplace') === 'ai' ? 0 : 1 });
  } else if (debug && params.has('aispot')) {
    // Real-time game where Marcel throws the jack first: screenshot while he shows his spot
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 1 });
  } else if (debug && params.has('mene2')) {
    // ?debug&mene2[&ringcarry][&timerframes]: the first mène is over (jack at 2.3, 9.2, so the ring is carried back to 11 m) and the second begins: quick mode shows
    // the human's jack turn toward y = 0; &ringcarry (slow mode) shows the last thrower carrying the ring there
    settings.mode = params.has('ringcarry') ? 'slow' : 'quick';
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 0 });
    token++; pending = null; clearWorld();
    const jb = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb.z = jb.r; world.add(jb);
    for (const [t, x, y] of [[0, 2.0, 9.0], [1, 2.6, 9.4]]) { const b = createBody('boule', { team: t, x, y }); b.z = b.r; world.add(b); }
    renderer.sync(world);
    match = { ...match, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: { void: true } };
    lastThrowerId = 'marcel';
    for (const id of cast.keys()) placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
    setPlaying(true);
    if (params.has('ringheld')) { // &ringheld: a still of Marcel carrying the ring back toward the corrected spot (slow mode)
      const ch = cast.get('marcel'); ringCarry = 'marcel'; ch.setCarrying(true); shadow('marcel', true);
      placeAt('marcel', 2.2, 5.5, Math.PI); ch.setStance('watch');
      renderer.setCamera('head', { target: { x: 2.3, y: 7.5 }, points: [{ x: 1.5, y: 5 }, { x: 3, y: 9.6 }, { x: 2.2, y: 11.2 }] });
      return;
    }
    nextMene();
  } else if (debug && pickHuman !== null) {
    // Stop at the human's first boule (or at the chooser with ?humanturn=chooser)
    startGame({ target: 7, difficulty: 'medium', instant: !params.has('animate'), firstJackTeam: pickHuman === 'jack' ? 0 : 1 }); // &animate: real time
  } else if (debug && params.has('characters')) {
    // --- ?debug&characters: stick figures in every stance side by side (for screenshots) ---
    clearWorld();
    hud.hideHint();
    for (const ch of cast.values()) ch.root.visible = false;
    // &cast=quirk|celebrate|dismay: the four real players in a row (&q=N picks which idle quirk is held)
    // &hold: each holds 1 + 2 boules (E16); &cast=throw&backswing=0.4 freezes the four mid-backswing
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
          ch.setHolding(true, BOULE_COLORS[PERSONALITIES[spec.model].team]);
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
          if (params.has('backswing')) { for (let tt = 0; tt < +params.get('backswing'); tt += 1 / 60) ch.update(1 / 60); ch.frozen = true; } // &backswing=0.4: freeze that long into the throw
        };
        loop();
      } else ch.setStance(stance);
      if (params.has('hold')) ch.setHeldBoules({ dominant: 1, other: 2, color: BOULE_COLORS[PERSONALITIES[spec.model].team] }); // &hold: one boule in the dominant hand, two in the other (the player's team colour, E23)
      if (castMode === 'quirk') { const l = spec.quirks.idle; ch.forceQuirk(l[qi % l.length]); }
      if (stance === 'watch') ch.lookAt(2, 0.5, 1.6);
      return ch;
    });
    if (params.has('closeup')) renderer.setCamera('inspect', { target: { x: 5.6, y: 0.5, }, dist: +params.get('dist') || 3.6, az: +params.get('az') || 1.2, el: +params.get('el') || 0.12 });
    else renderer.setCamera('inspect', { target: { x: castMode ? 2.1 : 1.7, y: 3 }, dist: castMode ? +params.get('dist') || 5 : 7, az: +params.get('az') || 0, el: params.has('el') ? +params.get('el') : 0.1, height: +params.get('height') || 0 });
    let lastC = performance.now();
    const tickC = (now) => {
      const dt = params.has('freezethrow') ? 1 / 60 : Math.min((now - lastC) / 1000, 0.1); lastC = now; // fixed step so a frozen release is exact
      for (const ch of figures) if (!ch.frozen) ch.update(dt);
      requestAnimationFrame(tickC);
    };
    for (const ch of figures) ch.update(0.5);
    requestAnimationFrame(tickC);
    window.__characters = figures;
  } else if (debug && params.has('measure')) {
    // --- ?debug&measure: jack and boules from both teams, with the between-throws measuring lines (for screenshots) ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; return world.add(b); };
    put('jack', -1, 2.1, 8.45);
    put('boule', 0, 1.9, 8.3); put('boule', 0, 2.5, 8.9);
    put('boule', 1, 2.28, 8.62); put('boule', 1, 1.6, 7.9);
    renderer.sync(world);
    placePlayers('you');
    headView(jackBody());
    showBetween();
  } else if (debug && params.has('jackshot')) {
    // --- ?debug&jackshot[&jspeed=&jloft=&jyaw=&freezeat=0.6]: a boule shot hard into the jack, with the flight camera following ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; world.add(b); return b; };
    put('jack', -1, 2.1, 8);
    put('boule', 1, 1.8, 8.2);
    put('boule', 1, 2.6, 7.7);
    renderer.sync(world);
    placePlayers('you');
    launchBody('boule', 0, 'you', { yaw: +params.get('jyaw') || 0.0143, loft: +params.get('jloft') || 0.14, speed: +params.get('jspeed') || 9, backspin: 0, sidespin: 0 });
    if (freezeAt) { // step to the freeze time up front (headless frames are too slow to get there), moving the camera as it would
      for (let k = 1; world.t < freezeAt; k++) { world.step(); if (k % 24 === 0) { renderer.sync(world); renderer.render(0.1); } }
      renderer.sync(world);
    }
  } else if (debug && params.has('fetch')) {
    // --- ?debug&fetch: a boule out beyond the side timber and a jack out beyond the far one. Pierre fetches the boule
    // to the row, then the jack, which he hands to Odette; she walks it out and sets it down at (&jx, &jy), then both
    // walk home. &fetchat=seconds freezes the animation then (frame screenshots); &dist/&az/&el/&lx/&ly give a close
    // inspect camera ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; return world.add(b); };
    put('boule', 0, 1.9, 8.3);
    put('boule', 1, 2.3, 8.6);
    // &fetchin: the dead boule lies inside the strings instead (E02: it is walked off the court)
    const deadBoule = params.has('fetchin') ? placeDeadBall(world, put('boule', 1, 0, 0), 1.2, 5.2)
      : placeDeadBall(world, put('boule', 1, 0, 0), C.terrainW + C.lumberGap + C.lumberSize + 0.5, 9.2);
    const deadJack = placeDeadBall(world, put('jack', -1, 0, 0), 2.6, C.terrainL + C.lumberGap + C.lumberSize + 0.8);
    renderer.sync(world);
    placePlayers('you');
    fetchFreezeAt = +params.get('fetchat') || 0;
    if (params.has('dist')) renderer.setCamera('inspect', { target: { x: +params.get('lx') || 4, y: +params.get('ly') || 9 }, dist: +params.get('dist'), az: +params.get('az') || 1.2, el: +params.get('el') || 0.3 });
    else renderer.setCamera('head', { target: { x: 2, y: 8 }, points: [{ x: -1.5, y: -0.5 }, { x: 6.5, y: 16.5 }] });
    if (fetchFreezeAt) (async () => {
      for (let i = 0; i < fetchFreezeAt * 60; i++) {
        fetchPump = true; tickCast(1 / 60); fetchPump = false; await null; await null;
      }
      frozen = true;
      if (params.has('followc')) { // &followc=pierre: close camera on that character (with &dist &az &el)
        const q = cast.get(params.get('followc')).root.position;
        renderer.setCamera('inspect', { target: { x: q.x, y: q.y }, dist: +params.get('dist') || 3.2, az: +params.get('az') || 0.6, el: +params.get('el') || 0.2, height: 0.6, reset: true });
      }
      renderer.sync(world);
    })();
    if (params.has('e02')) { // ?debug&fetch&e02: Pierre (or &who=) retrieves the dead boule like the game does, then goes to a waiting slot
      runFetch(params.get('who') || 'pierre', true).catch((err) => console.error(err));
    } else (async () => {
      const job = { id: 'pierre', tok: token, cancelled: false, scripted: true };
      fetchJob = job;
      if (await pickUp(job, deadBoule) && await putDown(job, deadBoule, deadRowSlot(rowCount()))) {
        if (await pickUp(job, deadJack)) {
          await handOver(job, 'odette');
          const spot = { x: +params.get('jx') || 2.3, y: +params.get('jy') || 8.2 };
          await placeWalk('odette', spot);
          await walkHome(job);
        }
      }
    })().catch((err) => console.error(err));
  } else if (debug && params.has('lumber')) {
    // --- ?debug&lumber: ghosts resting against the timbers and beyond them, plus live boules (for screenshots);
    // &lx=&ly=&dist=&az=&el= place the inspect camera ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; return world.add(b); };
    put('jack', -1, 2.1, 8.45);
    put('boule', 0, 1.9, 8.3);
    put('boule', 1, 2.3, 8.6);
    const gi = C.terrainW + C.lumberGap - C.boule.r - 0.003;
    placeDeadBall(world, put('boule', 0, 0, 0), gi, 9);
    placeDeadBall(world, put('boule', 1, 0, 0), gi - 0.5, 9.6);
    placeDeadBall(world, put('boule', 1, 0, 0), C.terrainW + C.lumberGap + C.lumberSize + 0.4, 9.2);
    placeDeadBall(world, put('boule', 0, 0, 0), 2.5, C.terrainL + C.lumberGap - C.boule.r - 0.003);
    renderer.sync(world);
    placePlayers('you');
    renderer.setCamera('inspect', { target: { x: +params.get('lx') || 4.3, y: +params.get('ly') || 9.2 }, dist: +params.get('dist') || 3, az: +params.get('az') || 1.2, el: +params.get('el') || 0.35 });
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
