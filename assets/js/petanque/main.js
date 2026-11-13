// Game loop: terrain, world, renderer, rules, AI, toss input (donnée throw), audio and HUD wired together.
import { C } from './constants.js';
import { court, setCourt, resetCourt, baseYaw, ahead, facingTo } from './court.js';
import { cameraStyle, tvVariant, clampViewOffset, panViewOffset, walkSubject, freeViewRect } from './camera.js';
import { createDirector } from './director.js';
import { mulberry32 } from './rng.js';
import { createTerrain } from './terrain.js';
import { createWorld, createBody, launch, placeDeadBall, deadRowSlot, deadJackSpot } from './physics.js';
import { createRenderer } from './render.js';
import {
  createMatch, defaultPlayers, teamNamesFor, validPartner, opponentIds, apply, nextTeam, playersWithBoules, holdingTeam, meneResult, jackFault, jackPlaceValid, jackPlaceFault, gapM, fmtCm, deadJackText, jackGap, jackTooClose, sameGap, canonicalGaps,
} from './rules.js';
import { detectAnnouncement, createCarreauWatcher } from './announce.js';
import { createAnnouncer } from './announce-view.js';
import { createHud, createHoldIcons } from './hud.js';
import { settings } from './settings.js';
import { chooseThrowAsync, chooseJackThrow, chooseJackPlacement, whoThrows } from './ai.js';
import { createTossInput } from './toss.js';
import {
  SKILL, scaledSkill, coneFor, coneEnvelope, executeThrow, predictRollBand, styleForLoft, releaseFrom, snapAim, fitToBudget, planAim,
} from './donnee.js';
import { createAudio } from './audio.js';
import { createClock } from './clock.js';
import { createDrift, REDUCED_PROGRESS } from './daylight.js'; // F71
import * as THREE from '../vendor/three.module.js';
import { createCharacter, releaseOffset, bendReach } from './character.js';
import { planRoute, standPoint, pathLength } from './fetch.js';
import { meneEndReady, atPlaces, steer, planGoals, pickJackCarrier, ringStagePoint, ringMayDrop, BLOCK_FADE_S } from './crowd.js';
import { pickWaitingSlot, waitingSlots } from './waiting.js';
import { attachModels } from './models.js';
import { createGroundView } from './groundview.js';
import { isPhone } from './scenery.js';
import { probeGpu, assessGpu, weakDevice, browserName, gpuMessage } from './gpuinfo.js'; // F102
import { classifyBootError } from './boot-error.js'; // F114
import { LEVELS, levelSettings, initialLevel, wantAntialias, createAutoQuality } from './quality.js'; // F103
import { PERSONALITIES, CAST_IDS, specFor, pickStance, stanceFor, STAND_BEYOND, createCommentary, whoKind, composeSuggestion } from './personalities.js';

let TEAM_NAMES = teamNamesFor('pierre'); // F45: reset in startGame for the chosen partner
const TEAM_TROUSERS = ['#23396b', '#8a5a2b']; // navy for your team, bronze for the opponents (F45: by team, whoever is on it)
const AIM_MAX = 0.6; // rad of aim either side of straight ahead
const FACE_MAX = 80 * Math.PI / 180; // F99: how far off straight ahead a thrower may face towards a donnée picked off to the side
const MAX_STEPS = 24; // physics steps per frame; backlog beyond this is dropped
const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
// F84: `debug` is not declared here. Hugo's js.Build defines it: the literal false in a production build (esbuild then
// drops every `debug && ...` / `if (debug)` branch with its strings), and globalThis.__dbg under `hugo server` and
// development builds, where it is set from ?debug just below. The set-up code is itself dropped in production.
if (globalThis.__DEBUG__ !== false) globalThis.__dbg = params.has('debug');
const modelTimeout = +params.get('modeltimeout') || 5000; // ms; ?modeltimeout=600000 for virtual-time screenshots
const useMeshes = params.get('figures') === 'mesh'; // stick figures by default; ?figures=mesh loads the Kenney models (opt-in; ?figures=stick is the same as the default)
const AI_MIN_THINK = 800; // ms: the AI never answers faster than this
const HINT_KEY = 'petanque-hint-seen';
const HINT_TEXT = 'Drag sideways to turn. Press on the court where you want the boule to land, pull down to throw ' +
  'higher, release to throw; drag back up to cancel. Press on a boule to shoot it.';
// Where waiting players stand: behind the circle and beside the court, out of the shoulder camera's view
// F45: the slots belong to the seats: your partner stands in Pierre's slot and the opponents in Marcel's and Odette's, whoever they are
const HOME_LOCAL = { you: { x: -0.9, y: -0.4 }, pierre: { x: -1.5, y: 0.7 }, marcel: { x: 6.0, y: 0.0 }, odette: { x: 6.8, y: 0.8 } };
// E10: HOME_LOCAL is relative to the default circle (2, 1) playing +y; homeAt turns it with the circle and direction
let seatOf = { you: 'you', pierre: 'pierre', marcel: 'marcel', odette: 'odette' };
const homeAt = (id) => { const h = HOME_LOCAL[seatOf[id]], d = court.dir; return { x: C.terrainW / 2 + (h.x - 2) * d, y: court.circle.y + (h.y - 1) * d }; };
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
  if (debug && params.has('bootfail')) throw new Error(params.get('bootfail') === 'webgl' ? 'WebGL is not available in this browser, so the 3D game cannot start.' : 'debug boot failure'); // F114: ?debug&bootfail=webgl|other shows each boot message
  const seedParam = params.get('seed');
  const seed = seedParam !== null && seedParam !== '' && !isNaN(+seedParam)
    ? +seedParam : Math.floor(Math.random() * 1e9);
  // F102: the game needs hardware WebGL. Production always enforces it; ?debug skips the check (headless Chrome uses SwiftShader),
  // and ?debug&fakegpu=SwiftShader|none forces the message path.
  const fakeGpu = debug ? params.get('fakegpu') : null;
  const gpuCheck = assessGpu(fakeGpu ? { hasContext: fakeGpu !== 'none', renderer: fakeGpu === 'none' ? '' : fakeGpu } : probeGpu(document));
  if (!gpuCheck.ok && !(debug && !fakeGpu)) { showGpuMessage(gpuCheck); return; }
  // F102/F104: soft hints (little memory or few cores) start Auto in Low graphics; ?debug&weak forces the hint, &gfx=high|auto|low the setting
  const weak = weakDevice(navigator) || !!(debug && params.has('weak'));
  if (debug && ['high', 'auto', 'low'].includes(params.get('gfx'))) settings.graphics = params.get('gfx');
  let level = initialLevel(settings.graphics, weak);
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const renderer = createRenderer(canvas, terrain, { antialias: wantAntialias(settings.graphics, weak), quality: levelSettings(level) });
  const aiRand = mulberry32(seed ^ 0x51ed270b);
  const stanceRand = mulberry32(seed ^ 0x6a09e667); // the AI's crouch-or-stand pick, one per throw
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
  let partner = 'pierre'; // F45: the character on your team
  let instant = false; // autotest: no delays, simulate to rest synchronously
  let token = 0; // bumped on each new game so stale timers are ignored
  let yellowDone = false; // ?debug&yellow forces one yellow card
  let flying = null; // body being tracked
  let carreauW = null; // F107
  let throwEvents = []; // physics events of the current throw (hits, for commentary)
  let preThrow = new Map(); // id -> { x, y } of boules before the current throw
  let pending = null; // { kind, playerId } while waiting for the human to throw
  let aimYaw = 0;
  let throwerYaw = 0; // yaw of whoever stands in the circle
  const throwRand = mulberry32(seed ^ 0x2545f491);
  // shared with the renderer so turning moves the camera without restarting its transition
  const shoulderCam = { player: court.circle, yaw: 0, viewYaw: 0, viewPitch: 0 }; // E12: viewYaw/viewPitch orbit offsets (rad)
  const shoulderView = () => renderer.setCamera('shoulder', shoulderCam);
  // E11 / E27: the camera style is read here and nowhere else. Slow mode watches from the side like a spectator
  // ('observer'); the human's own turn (shoulder view) and quick mode keep the game cameras. ?debug&cam=tv|game overrides.
  // E27: the TV variant (?debug&tvcam=a|b|c, else the hidden setting); a debug tvcam also turns TV on in slow mode
  const quickDefault = () => !slow() && !debug; // F123: quick mode ignores the hidden tvcam / camStyle settings (debug overrides only): every thrower gets the shoulder view and the same follow
  const tvVar = () => quickDefault() ? '' : tvVariant((debug && params.get('tvcam')) || settings.tvcam);
  const camStyle = (human = false) => cameraStyle({ slow: slow(), human, override: quickDefault() ? null : (debug && params.get('cam')) || settings.camStyle || (debug && params.has('tvcam') ? 'tv' : null), tv: tvVar() }); // F01: settings.camStyle (hidden) or ?debug&cam=broadcast
  const observing = () => camStyle() === 'observer';
  const broadcasting = () => camStyle() === 'broadcast'; // F01
  const observerView = (points, extra) => { if (wideHold) return; if (humanWalk && !(extra && extra.follow)) humanWalk.cam = false; renderer.setCamera('observer', { points, ...extra }); };
  // F39: slow mode, the human walking to the circle: the observer follows them (walkSubject), per frame in followHumanWalk
  let humanWalk = null; // { id, goal, pts, cam, tok }
  // F57: after Next the camera shows the whole court (wide shot) until the first player walks to the circle
  let wideHold = false;
  function wideShot() { wideHold = false; renderer.setCamera('wide'); wideHold = true; }
  // F39/F57: any thrower (the human or an AI player) walking to the circle is followed in slow mode. A walker already followed keeps
  // the camera (it re-aims at the newcomer smoothly, no cut).
  function startHumanWalk(id, goal) {
    if (!slow()) return;
    wideHold = false; // the first walker ends the wide shot: back to the regular camera behaviour
    const prevW = humanWalk;
    if (prevW && prevW.tok === token && prevW.cam && prevW.id !== id) { Object.assign(prevW, { id, goal: { x: goal.x, y: goal.y } }); return; }
    humanWalk = { id, goal: { x: goal.x, y: goal.y }, pts: walkSubject(cast.get(id).root.position, goal), cam: false, tok: token };
  }
  function followHumanWalk() {
    const w = humanWalk;
    if (!w) return;
    const p = cast.get(w.id).root.position;
    if (w.tok !== token || pending || flying || !observing() || !match || Math.hypot(p.x - w.goal.x, p.y - w.goal.y) < 0.05) { humanWalk = null; return; }
    walkSubject(p, w.goal, undefined, w.pts);
    if (!w.cam) { w.cam = true; renderer.setCamera('observer', { points: w.pts, follow: true }); } // later frames only move the points
  }
  const watchCircle = () => observerView([{ x: court.circle.x, y: court.circle.y }, ahead(5)]); // somebody about to throw
  const aimView = () => (observing() && match ? watchCircle() : shoulderView());
  const KEEP_YAW = 35 * DEG; // E12 (see setAdjust); the pan limits live in camera.js (VIEW_PAN, F48)
  let adjusting = false, viewAnim = 0;
  const audio = createAudio();
  audio.setAmbientScale(levelSettings(level).ambient);
  const announcer = createAnnouncer(root, { audio }); // F61
  if (debug && ['carreau', 'biberon'].includes(params.get('announce'))) { // ?debug&announce=carreau|biberon: preview at page load, and again every 4 s
    const kind = params.get('announce');
    const go = () => announcer.show(kind, { force: true, still: params.has('still') });
    setTimeout(go, 600);
    if (!params.has('once')) setInterval(go, 4000);
  }
  let thinkToken = 0; // bumped to drop stale partner-suggestion results
  let pierreChoice = null; // cached AI choice for Pierre while the chooser is open
  const pickHuman = debug ? params.get('humanturn') : null; // debug: stop at the human's first boule (or 'chooser')

  // Controls (F32): F48 hold-to-use view icons (pan, read the ground, overhead) top right; speaker,
  // fullscreen and pause icons bottom right; Resume / New game / End game and the Mode (Slow / Quick) choice on the paused card; no raw sliders
  controls.textContent = '';
  const mkBtn = (parent, text, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = cls;
    parent.append(b);
    return b;
  };
  // F05 "Read the ground": slope arrows and a firmness wash, human turn only, shown while its icon is held (F48), can be disabled in settings
  const gv = createGroundView(terrain, { phone: isPhone(), reduced: () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) });
  renderer.addObject(gv.object);
  let gvOn = debug && params.has('groundview');
  const syncGv = (dt) => {
    const avail = settings.groundView && !!pending && !flying;
    gv.setVisible(avail && gvOn);
    gv.update(dt);
  };
  // E14/F32: the bottom-right icon cluster holds the speaker (mute), the fullscreen toggle (desktop only) and pause
  const corner = document.createElement('div');
  corner.className = 'pc-corner';
  const muteBtn = audio.createMuteButton();
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button'; fsBtn.className = 'pc-fs';
  const exitBtn = document.createElement('button');
  exitBtn.type = 'button'; exitBtn.className = 'pc-exit';
  exitBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  exitBtn.setAttribute('aria-label', 'Pause');
  exitBtn.title = 'Pause (Esc)';
  corner.append(muteBtn, fsBtn, exitBtn);
  root.append(corner);
  // F48: Adjust view, Read the ground and View (overhead) are translucent press-and-hold icons at the top right.
  const holdSvg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const holds = createHoldIcons([
    { cls: 'pc-pan', label: 'Adjust view: hold to pan up, down, left or right', title: 'Hold the arrows to look around the thrower (or hold Space, then use the arrow keys)',
      svg: holdSvg('<path d="M12 3v18M3 12h18M12 3l-2.5 2.8M12 3l2.5 2.8M12 21l-2.5-2.8M12 21l2.5-2.8M3 12l2.8-2.5M3 12l2.8 2.5M21 12l-2.8-2.5M21 12l-2.8 2.5"/>'),
      onHold: (info) => panHold(info), onRelease: () => panRelease() },
    { cls: 'pc-terrain', label: 'Read the ground: hold to show the slope and firmness', title: 'Hold to study the court: arrows drift downhill (faster = steeper); colour shows firmness, warm soft and cool hard.',
      svg: holdSvg('<path d="M2.5 18c3-1 4-5 7-5s3 3 6 3 4-3 6-4M3 12.5c2.5-.8 3.2-4.2 6-4.2 2.4 0 3 2.2 5.2 2.2 1.7 0 2.8-1.6 5-2.7M5 6.5c1.8-.6 2.5-2.8 4.8-2.8"/>'),
      onHold: () => { gvOn = true; syncGv(0); }, onRelease: () => { gvOn = false; syncGv(0); } },
    { cls: 'pc-headview', label: 'View: hold for the overhead view', title: 'Hold for the view from above; let go to return to the shoulder view',
      svg: holdSvg('<circle cx="7" cy="6.5" r="2.2"/><path d="M3 20v-4.5a4 4 0 0 1 8 0V20"/><path d="M14 8h7M14 8l2-2M14 8l2 2"/><circle cx="17.5" cy="16.5" r="3"/><circle cx="17.5" cy="16.5" r=".6" fill="currentColor"/>'),
      onHold: () => setView('head'), onRelease: () => { if (pending && !flying) setView('shoulder'); else { view = 'shoulder'; renderer.setRankLabels(null); } } }, // F91
  ]);
  root.append(holds.el);
  holds.buttons[1].hidden = !settings.groundView; // the hidden kill switch for slow devices (localStorage petanque-groundview=off)
  root.append(gv.legend);
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
    for (const [label, name] of [['Ambience: bird', 'bird'], ['Ambience: breeze swell', 'breeze'], ['Ambience: airplane (25 s)', 'plane'], ['Ambience: floatplane engine (10 s)', 'floatplane'], ['Ambience: church bell (4 strikes)', 'bell'], ['Ambience: cicada (12 s)', 'cicada']]) {
      mkBtn(panel, label, 'pc-sound').addEventListener('click', () => audio.playAmbient(name));
    }
    drawer.append(panel);
    controls.append(drawer);
  }
  // Aim: toss turns the shared camera options; the debug yaw slider mirrors it
  function setAim(yaw) {
    aimYaw = baseYaw() + Math.max(-AIM_MAX, Math.min(AIM_MAX, wrapPi(yaw - baseYaw()))); // E10: within AIM_MAX of straight ahead, whichever way that is
    shoulderCam.yaw = aimYaw;
    throwerYaw = aimYaw;
    tossFace = null;
    if (debug && params.has('aimlog')) console.log('[aimlog] setAim ' + (aimYaw / DEG).toFixed(2));
    const me = cast.get('you');
    if (pending && inCircle === 'you' && !me.busy) me.yaw = aimYaw;
  }

  // Release point of a player's boule: where that character's hand will be at the release frame for this loft,
  // facing their aim. Without a loft it returns a base for the AI ({ x, y, release(loft) }), see donnee.releaseFrom.
  let tossFace = null; // F99: while the human tosses, the yaw they face: the bearing of the donnée (planAim), so the hand, the pose and the launch agree
  const faceYaw = (id) => (id === 'you' ? (tossFace ?? aimYaw) : aiYaw);
  const faceLimit = (a) => baseYaw() + Math.max(-FACE_MAX, Math.min(FACE_MAX, wrapPi(a - baseYaw())));
  function setFace(y) { // the thrower turns to face the donnée (null: back to the aim); looks only, never the throw
    tossFace = y;
    const me = cast.get('you');
    if (pending && inCircle === 'you' && !me.busy) me.yaw = faceYaw('you');
  }
  // The human's toss as a throw plan (shared by the preview and the release): see donnee.planAim
  const planToss = (t) => planAim({
    donnee: t.donnee, snapped: !!t.snappedTo, loft: t.loft, skill: SKILL.human, terrain: world.terrain, limit: faceLimit,
    handAt: (yaw) => handFrom('you', t.loft, yaw),
  });
  // Stance of each player's current throw: picked when they step into the circle (enterCircle), used by the preview,
  // the AI plan, the throw pose and the launch alike
  const throwStance = {};
  const throwRoll = {}; // F33: the one random draw per throw behind a crouch-or-stand choice (reused if the stance is re-decided)
  const stanceOf = (id) => throwStance[id] || SPECS[id].stance;
  // F33: the stance for a throw of `distance` m (undefined = not known yet), from the throw's fixed roll
  const stanceAtDistance = (id, distance) => stanceFor(SPECS[id], distance, () => throwRoll[id] ?? 0);
  // Distance from the circle to a point ({x, y}); NaN without one
  const circleDist = (p) => (p ? Math.hypot(p.x - court.circle.x, p.y - court.circle.y) : NaN);
  // F33: after planning, make the stance match the planned donnée distance; true when it changed (the plan must be redone)
  function restance(id, choice) {
    if (!choice || !choice.donnee) return false;
    const want = stanceAtDistance(id, circleDist(choice.donnee));
    if (want === stanceOf(id)) return false;
    throwStance[id] = want;
    if (inCircle === id) cast.get(id).setStance(want);
    return true;
  }
  function handFrom(id, loft, yaw, stance = stanceOf(id)) {
    const spec = SPECS[id];
    const o = releaseOffset({ height: spec.height, stance, loft, yaw, hand: spec.hand, model: cast.get(id).isMesh ? spec.model : null });
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
  let lastToss = null; // last onPreview payload (the roll guide is always on, F32)
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

  let reachShown = false;

  // Draw the preview for a toss state { donnee, loft, snappedTo }
  function showToss(t, kind) {
    const { from, landing, clamped, energyFrac, face } = planToss(t); // F99: the same plan the release uses
    setFace(face);
    if (clamped !== reachShown) {
      reachShown = clamped;
      if (clamped) say2(`Max reach: about ${Math.hypot(landing.x - from.x, landing.y - from.y).toFixed(1)} m at this loft. Throw lower to go farther.`);
    }
    const cone = coneFor({ skill: SKILL.human, from, landing, loft: t.loft, energyFrac });
    const env = coneEnvelope({ from, landing, loft: t.loft, cone, terrain: world.terrain });
    cancelAnimationFrame(roll.raf); roll.raf = 0;
    const band = rollBandFor(from, landing, t.loft, cone, kind); // F32: the roll guide is always shown while aiming
    if (band.blending) roll.raf = requestAnimationFrame(() => { roll.raf = 0; if (lastToss === t) showToss(t, kind); });
    renderer.setThrowPreview({
      ...env, roll: band, donnee: clamped ? landing : t.donnee, style: styleForLoft(t.loft),
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
      if (t.cancel) { lastToss = null; clearToss(); setFace(null); return; }
      lastToss = t;
      showToss(t, pending.kind);
    },
    onThrow: (t) => humanToss(t),
    onCancel: () => { clearToss(); setFace(null); },
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
    const { from, landing, energyFrac, face } = planToss(t);
    setFace(face); // faces the donnée through the whole throw (throwWith reads faceYaw at the start)
    if (debug && params.has('aimlog')) console.log('[aimlog] toss ' + JSON.stringify({ donnee: t.donnee, landing, aimYaw, loft: t.loft, donneeAngle: Math.atan2(t.donnee.x - court.circle.x, t.donnee.y - court.circle.y) / DEG }));
    const cone = coneFor({ skill: SKILL.human, from, landing, loft: t.loft, energyFrac });
    const res = executeThrow({ from, landing, loft: t.loft, cone, terrain: world.terrain, rand: throwRand });
    clearToss();
    humanThrow(res.throwParams, from, t.loft);
  }

  function enableControls(on) {
    if (!on) setAdjust(false, { reset: true }); // the turn is over: drop the toggle and the view offset
    toss.setPhase(on ? 'aim' : 'off');
    holds.setVisible(on);
    if (!on) { clearToss(); renderer.setJackArrow(false); }
  }
  enableControls(false);

  // F48 views: 'shoulder' (normal) or 'head' (overhead, only while its icon is held)
  let view = 'shoulder';
  function setView(v) {
    if (v !== 'shoulder' && adjusting) setAdjust(false);
    view = v;
    renderer.setRankLabels(v === 'head' ? world.bodies : null); // F91: rank labels only while the overhead view is held
    if (v === 'shoulder') shoulderView();
    else {
      const j = jackBody();
      headView(j && !j.dead ? j : ahead(7), undefined, undefined, undefined, true);
    }
  }
  // E12/F48 "Adjust view": while its icon is held, toss input is off and the held arrows orbit the shoulder camera round the
  // thrower: yaw offset within +-180 deg of the aim, pitch offset within +-15 deg (clamped in camera.js, never wrapped). Wheel and pinch still zoom.
  // Turning it off keeps a small yaw offset (<= KEEP_YAW) since aiming still works from there; a larger one would
  // leave the camera looking sideways or backwards of the aim, so it eases back to the default framing. Pitch stays.
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function setViewOffset(yaw, pitch) {
    const c = clampViewOffset(yaw, pitch);
    shoulderCam.viewYaw = c.yaw; shoulderCam.viewPitch = c.pitch;
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
    if (on === was && !reset) return;
    if (on) {
      clearToss();
      if (view !== 'shoulder') setView('shoulder');
      toss.setPhase('off');
    } else {
      if (pending && !flying && !reset) toss.setPhase('aim');
    }
    if (!on) {
      if (reset || Math.abs(shoulderCam.viewYaw) > KEEP_YAW) {
        if (reset) { cancelAnimationFrame(viewAnim); setViewOffset(0, 0); }
        else easeViewTo(0, shoulderCam.viewPitch);
      }
    }
  }
  // The pan icon (hud.js createHoldIcons) reports a held direction (pointer: which arrow of the icon is under the finger;
  // keyboard: Space/Enter holds, arrow keys on the focused icon pan). A frame loop applies the pan while anything is held.
  const pan = { pointer: null, hold: false, keys: new Set(), raf: 0, t: 0 };
  const panDir = () => {
    let x = pan.pointer ? pan.pointer.x : 0, y = pan.pointer ? pan.pointer.y : 0;
    if (pan.keys.has('ArrowLeft')) x -= 1;
    if (pan.keys.has('ArrowRight')) x += 1;
    if (pan.keys.has('ArrowUp')) y -= 1;
    if (pan.keys.has('ArrowDown')) y += 1;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  };
  const panActive = () => pan.hold || !!pan.pointer || pan.keys.size > 0;
  function panStep(now) {
    const dt = Math.min(0.1, (now - pan.t) / 1000); pan.t = now;
    const d = panDir();
    if (adjusting && (d.x || d.y)) {
      const v = panViewOffset({ yaw: shoulderCam.viewYaw, pitch: shoulderCam.viewPitch }, d.x, d.y, dt);
      setViewOffset(v.yaw, v.pitch);
    }
    pan.raf = panActive() && adjusting ? requestAnimationFrame(panStep) : 0;
  }
  function panRefresh() {
    const on = panActive();
    if (on && !adjusting) { cancelAnimationFrame(viewAnim); setAdjust(true); }
    else if (!on && adjusting) setAdjust(false);
    if (on && adjusting && !pan.raf) { pan.t = performance.now(); pan.raf = requestAnimationFrame(panStep); }
  }
  function panHold(info) {
    if (info.pointer) pan.pointer = { x: info.dirX, y: info.dirY }; else pan.hold = true;
    panRefresh();
  }
  function panRelease() { pan.pointer = null; pan.hold = false; pan.keys.clear(); panRefresh(); }
  const panBtn = holds.buttons[0];
  panBtn.addEventListener('keydown', (e) => {
    if (!e.key.startsWith('Arrow') || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    pan.keys.add(e.key); panRefresh();
  });
  panBtn.addEventListener('keyup', (e) => { if (pan.keys.delete(e.key)) panRefresh(); });
  const hud = createHud(root, document.querySelector('.petanque-hud'), {
    onStart: (opts) => { audio.unlock(); setPlaying(true); startGame(opts); },
    onNext: () => { releaseHold(); nextMene(); },
    onPlayAgain: () => toSetup(),
    onResume: () => resumeGame(),
    onNewGame: () => { userPaused = false; setPlaying(true); toSetup(); },
    onEndGame: () => endGame(),
    onExit: () => endGame(), // F93: the game-over card's Exit leaves the same way as End game
    onChoose: (id) => beginTurn(id),
    onHintDismiss: () => store(HINT_KEY, '1'),
    needsReload: () => wantAntialias(settings.graphics, weak) !== renderer.antialias, // F104: antialiasing is fixed at context creation
  });
  const say2 = hud.say;

  // ---- Cast movement ----
  // E01: every walk and teleport decision goes through slow(). Debug instant/autotest and reduced motion never walk.
  const slow = () => !instant && (!reduceMotion() || (debug && params.has('slow'))) && settings.mode === 'slow'; // ?debug&slow: slow mode despite reduced motion (screenshots)
  const snapMove = () => !slow(); // no walking: teleport
  // E31: quick-mode changeover (fades, then a beat with the circle empty). Instant and reduced motion cut straight across.
  const changeover = () => !slow() && !instant && !reduceMotion();
  const FADE_S = 0.15, CHANGEOVER_BEAT_MS = 400;
  // E16: slow mode shows the boules in each player's hands (1 in the dominant hand, 2 in the other); the counts always
  // match boulesLeft. Quick mode shows just the one boule about to be thrown (the character's setHolding).
  const BOULE_COLORS = ['#a9bde0', '#e8aa6a']; // the team's boule look (render.js bouleMats)
  const playerOf = (id) => match && match.players.find((p) => p.id === id);
  const splitHeld = (n) => ({ dominant: Math.min(1, n), other: Math.min(2, Math.max(0, n - 1)) });
  const teamColor = (id) => BOULE_COLORS[(playerOf(id) || PERSONALITIES[id]).team]; // E23: a team-0 player holds steel, team 1 bronze
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
    const full = (p) => { const h = cast.get(p.id).heldBoules; return !!h && h.dominant + h.other === p.boulesLeft; }; // F02 already gave them their boules
    const ids = match.players.filter((p) => p.boulesLeft > 0 && !full(p)).map((p) => p.id);
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
  // F95b: every player always casts a shadow (the on/off argument is ignored)
  const shadow = (id, on) => cast.get(id).root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
    inCircle = null; stanceKept = null;
    const kept = spotsKept === token; spotsKept = 0; // F02: the players are already walking to their spots with their boules
    for (const id of cast.keys()) {
      const ch = cast.get(id);
      if (kept) { ch.setHolding(false); ch.setCarrying(false); ch.setStance('watch'); shadow(id, false); ch.setOpacity(1); continue; }
      ch.setHolding(false); ch.setHeldBoules(null); ch.setCarrying(false); ch.setStance('watch'); shadow(id, false);
      ch.setOpacity(1); // E31: cancels any changeover fade still running
      placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
      claims.set(id, { x: homeAt(id).x, y: homeAt(id).y });
    }
  }
  // E31: the player who must leave the circle before `id` steps in (quick mode only; null otherwise)
  function quickSwapFrom(id) {
    const prev = inCircle && inCircle !== id && !(fetchJob && fetchJob.id === inCircle) ? inCircle : null;
    return prev && changeover() ? prev : null;
  }
  // E31: quick-mode changeover: the previous thrower fades out and stands at their waiting spot, the circle stays empty
  // for a beat, then the new thrower fades into it. Resolves once they are in place (the turn starts after this).
  function changeoverIn(prev, id, yaw, c) {
    const t = token, pc = cast.get(prev), ch = cast.get(id);
    const live = () => t === token && inCircle === id;
    ch.setOpacity(0); // the new thrower stays hidden until they step in
    pc.fadeTo(0, FADE_S);
    return sleep(FADE_S * 1000).then(() => {
      if (!live()) return null;
      walkOut(prev); // quick mode: placed at the waiting spot at once
      pc.setOpacity(1);
      return sleep(CHANGEOVER_BEAT_MS);
    }).then(() => {
      if (!live()) return null;
      placeAt(id, c.x, c.y, yaw);
      ch.fadeTo(1, FADE_S);
      return sleep(FADE_S * 1000);
    }).then(() => { if (live()) ch.setOpacity(1); });
  }
  let stanceKept = null; // id whose stance was picked by the walk-to-circle step; the turn's own enterCircle keeps it
  let circleWalk = null; // { id, yaw, tok, start } while a thrower walks to the circle
  // The thrower walks into the circle (the previous one walks out); returns a promise for the arrival
  function enterCircle(id, yaw, snap, kind = 'boule') { // kind: 'jack' for the cochonnet throw (E23), else a boule
    const ch = cast.get(id), c = court.circle, jack = kind === 'jack';
    if (fetchJob && fetchJob.id === id) { // D11: a fetcher called to throw drops what they carry (E02: and walks from where they are)
      cancelFetch(); ch.setCarrying(false);
    }
    const here = Math.hypot(ch.root.position.x - c.x, ch.root.position.y - c.y) < 0.05;
    const swap = !snap && !here ? quickSwapFrom(id) : null; // E31: quick mode, the previous thrower changes over with fades
    if (inCircle && inCircle !== id && !(fetchJob && fetchJob.id === inCircle) && !swap) walkOut(inCircle);
    inCircle = id;
    claims.delete(id);
    shadow(id, true);
    for (const [oid, och] of cast) if (oid !== id && oid !== inCircle && !och.busy) och.setStance('watch');
    if (stanceKept === id) stanceKept = null; // E17: beginTurn's walk to the circle already picked this throw's stance
    else { // once per throw: the same stance for the plan, the pose and the launch (F33: standing beyond 7.5 m; for a boule the
      // jack is the estimate of the target, a jack throw is re-checked after planning)
      const spec = SPECS[id], jk = jackBody();
      throwRoll[id] = spec.stances && spec.stances.length > 1 ? stanceRand() : 0; // draws exactly as pickStance did
      throwStance[id] = stanceAtDistance(id, !jack && jk && !jk.dead ? circleDist(jk) : undefined);
    }
    ch.setStance(stanceOf(id));
    if (jack) ch.setHeldBoules(null); // E23: a jack throw shows no boules in the hands
    ch.setHolding(jack ? 'jack' : 'boule', jack ? undefined : teamColor(id));
    if (swap) {
      arrival = changeoverIn(swap, id, yaw, c);
    } else if (here || snap || snapMove()) {
      placeAt(id, c.x, c.y, yaw);
      arrival = Promise.resolve();
    } else {
      const t = token;
      circleWalk = { id, yaw, tok: t, start: performance.now() }; // E02: a click or key skips the walk
      startHumanWalk(id, c); // F39
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
    if (broadcasting() && match && !match.players.find((q) => q.id === id && q.isHuman)) director.throwShot(id, faceYaw(id)); // F01: hold through the swing
    if (!ch.busy) ch.yaw = faceYaw(id);
    let released = false;
    const done = ch.playThrow({
      loft,
      onRelease: (pos) => {
        released = true;
        if (t !== token) return;
        if (debug && params.has('aimlog')) console.log('[aimlog] releaseframe ' + JSON.stringify({ id, aimYaw, chYaw: ch.yaw, ball: pos, root: { x: ch.root.position.x, y: ch.root.position.y } }));
        if (debug && params.has('freezethrow')) { frozen = true; return; }
        go();
      },
    });
    await done;
    if (!released && t === token) go(); // the animation was cut short: still throw
  }

  // Per frame: animate, keep feet on the terrain, everyone watches the boule in flight (or the jack)
  function tickCast(dt) {
    if (frozen || holdSim) return; // F55: holdSim: the sim waits for the click on Next mène (players and idle fidgets stand still)
    if (debug && (fetchScript || f02Script)) { // ?debug&fetch: fixed steps; with &fetchat the animation is pumped synchronously (headless frames are too few)
      if (fetchFreezeAt && !fetchPump) return;
      dt = 1 / 60; clock.tick(1000 / 60);
    }
    const thrower = inCircle && cast.get(inCircle);
    shoulderCam.wide = thrower && thrower.isMesh ? 1.45 : 1;
    if (thrower) shoulderCam.hand = thrower.hand; // a left-hander's shoulder camera sits behind the left shoulder
    const w = flying && !flying.dead ? flying : jackBody();
    crowdTick(dt); // F14
    followHumanWalk(); // F39
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
    if (broadcasting()) { // F01: the head hover, then a reaction cut chosen by the outcome (the director's)
      bcastDelay = director.afterStop({ mood, was, prevHold, players: match.players });
      return;
    }
    // cut to the thrower (and a reacting team-mate) for a moment so the reaction can be seen
    later(() => {
      if (pending || flying) return;
      const pts = shown.length ? shown : [cast.get(inCircle || was.owner).root.position];
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (observing()) { observerView(pts.map((q) => ({ x: q.x, y: q.y }))); return; }
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
      if (ringTask && p.id === ringHolder) continue; // F07: the ring carrier is walking the ring to the jack
      if (jackTask && p.id === jackFetcher) continue; // F10: fetching the dead jack
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
      if (observing()) { observerView([{ x: c.x, y: c.y }, { x: c.x - 2.6, y: c.y + 1.4 * court.dir }, { x: c.x + 2.6, y: c.y + 1.4 * court.dir }]); return; }
      renderer.setCamera('inspect', { target: { x: c.x, y: c.y - 0.2 * court.dir }, dist: 5.5, az: baseYaw(), el: 0.4, height: 0.2, reset: true, fit: 3.4 });
    }, 2200);
  }

  // Head camera framing the jack and live boules within 2 m of it
  let camNow = false; // E17: the mène-end camera cuts at once, never queued behind a TV shot's hold
  function headView(jack, extra, lift, tight, game) { // game: the user's own View button, never the observer
    const pts = world.bodies
      .filter((b) => b.kind === 'boule' && !b.dead && Math.hypot(b.x - jack.x, b.y - jack.y) < 2)
      .map((b) => ({ x: b.x, y: b.y }));
    if (!game && observing()) { observerView([{ x: jack.x, y: jack.y }].concat(tight ? [] : pts, extra || [])); return; }
    renderer.setCamera('head', { now: camNow, cut: !game && broadcasting(), target: { x: jack.x, y: jack.y }, points: (tight ? [] : pts).concat(extra || []), lift, ...(tight ? { margin: 0.25, minHalf: 0.55, dist: 1.3 } : {}) });
  }
  // D07 between throws: ribbons from the cochonnet to the closest live boule of each team (a team with none is dropped)
  const TEAM_INK = [{ line: '#2f5fb8', dark: 'rgba(22,49,95,0.95)' }, { line: '#f0a040', dark: 'rgba(100,54,8,0.95)' }];
  function showBetween() {
    const j = jackBody();
    if (!j || j.dead) { renderer.clearMeasure(); return; }
    const items = [], cg = canonicalGaps(world.bodies.filter((b) => b.kind === 'boule'), j);
    for (const team of [0, 1]) {
      let best = null;
      for (const b of world.bodies) {
        if (b.kind !== 'boule' || b.dead || b.team !== team) continue;
        if (!best || Math.hypot(b.x - j.x, b.y - j.y) < Math.hypot(best.x - j.x, best.y - j.y)) best = b;
      }
      if (best) items.push({ x: best.x, y: best.y, r: best.r, label: fmtCm(cg.get(best.id) ?? gapM(best, j)), color: TEAM_INK[team].line, dark: TEAM_INK[team].dark });
    }
    const others = world.bodies.filter((b) => b.kind === 'boule' && !b.dead).map((b) => ({ x: b.x, y: b.y }));
    if (items.length) renderer.showMeasure({ x: j.x, y: j.y, r: j.r }, items, others);
    else renderer.clearMeasure();
  }
  // Landing marks from physics 'land' events
  let aimLogBody = null; // F99 debug: the body whose first landing is logged
  function markLandings(events) {
    for (const ev of events) {
      if (debug && aimLogBody && ev.type === 'land' && ev.a === aimLogBody.id) { console.log('[aimlog] land ' + JSON.stringify({ x: ev.x, y: ev.y, angle: Math.atan2(ev.x - court.circle.x, ev.y - court.circle.y) / DEG })); aimLogBody = null; }
      if (ev.type === 'land' && ev.speed > 1.5) renderer.addDivot(ev.x, ev.y, 0.035 + 0.05 * Math.min(1, ev.speed / 8));
    }
  }

  const jackBody = () => world.bodies.find((b) => b.kind === 'jack');
  const clock = createClock(); // D12: every game delay goes through this, so a pause freezes them all
  const later = (fn, ms) => {
    const t = token;
    clock.later(() => { if (t === token) fn(); }, instant ? 0 : ms);
  };

  // F01: the sports-broadcast director (camera style 'broadcast'): shots for prep, throw, flight, head hover and reaction
  const showShot = (sh) => {
    if (sh.kind === 'flight') { renderer.setCamera('broadcast', { shot: 'flight', body: sh.body, bodies: world.bodies }); return; }
    const ch = cast.get(sh.id);
    if (!ch) return;
    const j = jackBody();
    const faceTo = sh.kind === 'reaction' ? (j && !j.dead ? j : ahead(7)) : undefined;
    renderer.setCamera('broadcast', { shot: sh.kind, subject: ch.root.position, face: sh.kind === 'reaction' ? undefined : sh.face, faceTo, cut: true });
  };
  const director = createDirector({ later, show: showShot, reduced: reduceMotion });
  let bcastDelay = 1800; // ms from the stop to the next turn (longer when a reaction shot plays)

  function clearWorld() {
    releaseHold(); cancelFetch(); carry = null; jackFetch = null; placing = null; gateSince = 0; lastThrowerId = null; ringTask = null; jackTask = null; jackFetcher = null; jackDone = true; jackSnapFn = null; ringHolder = null; ringCarry = null; ringPlaced = false; collect = null; // D11, F07, F02
    world.bodies.length = 0;
    world.events.length = 0;
    terrain.resetDivots();
    renderer.clearDivots();
    renderer.clearMeasure();
    scoringShown = false;
    renderer.showJackZone(false);
    renderer.setPlaceMarker(null);
    renderer.setJackArrow(false, true);
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
    tossFace = null; // F99: the toss is over; the thrower's facing goes back to the aim
    if (debug && params.has('aimlog')) { // F99: ?debug&aimlog: what the launch used vs the character at that frame (console)
      const ch = cast.get(owner);
      console.log('[aimlog] launch ' + JSON.stringify({ aimYaw, chYaw: ch && ch.yaw, from, hand: ch && ch.handWorldPosition(), throwYaw: p.yaw, circle: court.circle }));
      aimLogBody = body;
    }
    flying = body;
    clearToss();
    const humanOwner = !!(match && match.players.find((q) => q.id === owner && q.isHuman));
    if (broadcasting()) { // F01: cut to the cochonnet, then the boule comes into view (a jack throw follows the jack from the side)
      if (kind === 'jack') renderer.setCamera('tv', { variant: 'a', body, bodies: world.bodies });
      else director.release(body);
    } else if (observing()) { // E11: the spectator watches the flight; after the human's own release, a short flight follow first
      if (humanOwner) {
        renderer.setCamera('flight', { body, bodies: world.bodies });
        later(() => { if (flying === body) renderer.setCamera('observer', { body, bodies: world.bodies }); }, 1100);
      } else renderer.setCamera('observer', { body, bodies: world.bodies });
    } else if (camStyle(humanOwner) === 'tv') renderer.setCamera('tv', { variant: tvVar() || 'a', body, bodies: world.bodies }); // E27
    else renderer.setCamera('flight', { body, bodies: world.bodies });
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
    userPaused = false;
    golden.reset(); hideHolding(); // F86: no leftover light drift or who-holds banner
    token++; thinkToken++; pierreChoice = null; wideHold = false;
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
    hud.showSetup({ difficulty, partner: settings.partner, cast: ['pierre', 'marcel', 'odette'].map((id) => ({ id, name: PERSONALITIES[id].name, bio: PERSONALITIES[id].bio, tag: PERSONALITIES[id].tag })) });
    if (debug && params.has('topcam')) hud.hideOverlay();
  }

  const golden = createDrift(), goldenParam = debug && params.has('golden') ? Math.max(0, Math.min(1, +params.get('golden') || 0)) : null; // F71 (?debug&golden=0..1 fixes it)
  function startGame(opts) {
    golden.reset(); // F71
    userPaused = false;
    token++; thinkToken++; pierreChoice = null; wideHold = false;
    difficulty = opts.difficulty || 'medium';
    instant = !!opts.instant;
    partner = validPartner((debug && params.get('partner')) || opts.partner || settings.partner); // F45
    const players = defaultPlayers(partner);
    TEAM_NAMES = teamNamesFor(partner);
    seatOf = { you: 'you', [partner]: 'pierre' };
    opponentIds(partner).forEach((id, i) => { seatOf[id] = i ? 'odette' : 'marcel'; });
    talk.setPartner(partner);
    for (const id of cast.keys()) if (id !== 'you') cast.get(id).setTrousers(TEAM_TROUSERS[id === partner ? 0 : 1]);
    // all-AI debug matches: nobody is "You", so the commentary grammar ("Sam points", "Sam's boule") still works
    if (opts.allAI) for (const p of players) { p.isHuman = false; if (p.id === 'you') p.name = 'Sam'; }
    resetCourt(); applyCourt(court.circle, 1, false);
    match = createMatch({ target: opts.target || 13, players, firstJackTeam: opts.firstJackTeam ?? (Math.random() < 0.5 ? 0 : 1) });
    hud.hideOverlay();
    beginMene(true);
  }

  function beginMene(first) {
    wideHold = false; // F57
    clearWorld();
    resetCast();
    pending = null;
    hud.hideChooser();
    const team = match.jackTeam;
    const thrower = (debug && match.players.find((p) => p.id === params.get('thrower') && p.team === team)) ||
      match.players.find((p) => p.team === team && (p.isHuman || team === 1)) ||
      match.players.find((p) => p.team === team);
    if (debug && (first || params.has('mene2')) && params.has('jackplace')) { forceInvalidJack(team); return; } // &mene2&jackplace: placement toward y = 0 (E17)
    const lead = first ? `${TEAM_NAMES[team]} won the toss. ` : '';
    refreshHud({ team, playerId: thrower.id, text: `${thrower.isHuman ? 'You' : thrower.name} throw${thrower.isHuman ? '' : 's'} the jack` });
    aimView();
    if (thrower.isHuman) {
      humanTurn('jack', thrower.id, lead + 'Your jack. Aim, then toss it onto the court between the two yellow lines (6 to 10 metres from the edge of the circle). It rolls on after landing: aim so the orange dashes end inside the zone.');
    } else {
      aiJack(thrower, lead).catch((err) => console.error(err));
    }
  }

  function refreshHud(turn) { hud.update(match, turn); }

  // F11: who holds the point, shown once a boule has settled and cleared when the next aim starts (or after 2 s of
  // game time, so it freezes while paused). holdTok invalidates a pending hide when a newer banner or the aim replaces it.
  let holdTok = 0;
  function hideHolding() {
    holdTok++;
    if (!(debug && params.has('holding'))) hud.hideHolding(); // ?debug&holding keeps the sample banner up for screenshots
  }
  function showHolding() {
    const hold = holdingTeam(match.jack, match.boules);
    if (hold !== 0 && hold !== 1) { hideHolding(); return; } // nobody holds: no jack, no live boules, or a tie
    const n = meneResult(match.jack, match.boules).points;
    hud.showHolding(`${TEAM_NAMES[hold]} are holding ${n} point${n === 1 ? '' : 's'}`, hold);
    const t = ++holdTok;
    clock.later(() => { if (t === holdTok) hideHolding(); }, 2000);
  }

  function humanTurn(kind, playerId, text) {
    tossFace = null; // F99
    pending = { kind, playerId };
    { // F109: every human turn starts facing the jack (straight ahead for the cochonnet throw), whatever the last aim or walk left
      const jk = kind === 'jack' ? null : jackBody();
      aimYaw = facingTo(court.circle, jk && !jk.dead ? jk : null, AIM_MAX); throwerYaw = aimYaw; shoulderCam.yaw = aimYaw;
    }
    hideHolding(); // F11: aiming starts, so the who-holds banner goes
    renderer.clearMeasure(); // aiming starts: the between-throws lines go (D07)
    renderer.showJackZone(kind === 'jack');
    const arrived = enterCircle(playerId, aimYaw, undefined, kind);
    if (debug && params.has('aimlog')) arrived.then(() => { const jk = jackBody(), c = cast.get(playerId), t = jk && !jk.dead ? Math.atan2(jk.x - court.circle.x, jk.y - court.circle.y) : baseYaw(); console.log('[aimlog] turnstart ' + JSON.stringify({ kind, chYawDeg: +(c.yaw / DEG).toFixed(1), jackBearingDeg: +(t / DEG).toFixed(1), aimYawDeg: +(aimYaw / DEG).toFixed(1) })); });
    enableControls(true);
    renderer.setJackArrow(kind !== 'jack'); // the chevron guides a boule throw only, never the cochonnet's (D17)
    setView('shoulder');
    if (debug && (params.has('viewyaw') || params.has('viewpitch') || params.has('adjust'))) { // ?debug&viewyaw=40&viewpitch=10&adjust
      setViewOffset((+params.get('viewyaw') || 0) * DEG, (+params.get('viewpitch') || 0) * DEG);
      if (params.has('adjust')) setAdjust(true);
    }
    if (debug && params.has('holdhead')) setView('head'); // ?debug&humanturn&holdhead: the overhead view as while its icon is held (screenshots)
    say2(text);
    if (pickHuman !== null || store(HINT_KEY) !== '1') hud.showHint(HINT_TEXT);
    if (debug && params.has('aimyaw')) setAim(baseYaw() + (+params.get('aimyaw') || 0) * DEG); // F99: ?debug&humanturn&aimyaw=30: aim this many degrees off centre (with &demo, the donnée is along that aim)
    if (debug && demo) { // ?debug&humanturn&demo: a scripted toss preview for screenshots
      // &loft=15 (degrees), &dist=7 (m ahead of the circle), &dx=0.9 (m across), &tir (snap onto the jack)
      const jb = jackBody();
      const tir = params.has('tir') && jb;
      lastToss = {
        donnee: tir ? { x: jb.x, y: jb.y } : params.has('aimyaw') ? { x: court.circle.x + Math.sin(aimYaw) * (+params.get('dist') || 7), y: court.circle.y + Math.cos(aimYaw) * (+params.get('dist') || 7) } : ahead(+params.get('dist') || 7, +params.get('dx') || 0.9),
        loft: (+params.get('loft') || 40) * DEG, snappedTo: tir ? jb.id : null,
      };
      showToss(lastToss, kind);
      if (params.has('autothrow') && +params.get('fixeddt')) clock.later(() => { if (pending && lastToss) showToss(lastToss, kind); }, 800); // F110: with &animate the walk to the circle clears the preview; show it again so the aim focus is on when the throw starts
      if (params.has('autothrow') && !humanTurn.auto) (+params.get('fixeddt') ? clock.later : setTimeout)(() => { humanTurn.auto = true; humanToss(lastToss); }, 2500); // screenshots of the throw
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
  let userPaused = false; // F32: paused with the pause icon or Esc, still in the full-window view (Resume / New game / End game)
  let savedScroll = 0;
  const html = document.documentElement;
  const fsSupported = !!(root.requestFullscreen);
  function logScroll(tag) { // ?debug: report whether the page can scroll while playing
    if (!debug) return;
    const se = document.scrollingElement || html;
    console.log(`[play] ${tag} playing=${playing} scrollHeight=${se.scrollHeight} innerHeight=${window.innerHeight} scrollWidth=${se.scrollWidth} innerWidth=${window.innerWidth} canvas=${canvas.clientWidth}x${canvas.clientHeight}`);
  }
  // The full-window layer never requests browser fullscreen; only the corner fullscreen button does (E30)
  function syncPausedUI() { hud.showPaused(!!match && (!playing || userPaused)); }
  function setPlaying(on) {
    if (on === playing) return;
    playing = on;
    if (on) savedScroll = window.scrollY;
    root.classList.toggle('is-playing', on);
    html.classList.toggle('petanque-playing', on);
    syncPausedUI();
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
  function pauseGame() { if (!playing || !match || userPaused) return; userPaused = true; syncPausedUI(); }
  function resumeGame() { userPaused = false; if (playing) { syncPausedUI(); if (exitBtn.offsetParent) exitBtn.focus(); } else setPlaying(true); }
  function endGame() { toSetup(); setPlaying(false); } // F86: back to the landing state a fresh load shows (setup card over the idle court), full-window view left, no match to resume
  exitBtn.addEventListener('click', pauseGame);
  window.addEventListener('keydown', (e) => {
    // Esc pauses (and resumes while paused), unless the browser is in fullscreen (it handles that Esc) or a toss used the key
    if (e.key !== 'Escape' || !playing || e.defaultPrevented || document.fullscreenElement) return;
    if (userPaused) resumeGame(); else pauseGame();
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
    if (!debug || !ailog || !choice.from) return;
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
    if (!debug || !aiLogRec || !was || was.kind !== 'boule') return;
    const j = jackBody(), rec = aiLogRec;
    aiLogRec = null;
    console.log('[ailog]', JSON.stringify({ ...rec, restY: +((was.y - court.circle.y) * court.dir).toFixed(2), dead: was.dead, toJackM: j && !was.dead ? +Math.hypot(was.x - j.x, was.y - j.y).toFixed(2) : null }));
  }

  const sleep = (ms) => clock.sleep(instant ? 0 : ms);

  async function aiJack(player, lead) {
    refreshHud({ team: player.team, playerId: player.id, text: `${player.name} throws the jack` });
    say2(`${lead}${player.name} is aiming…`);
    renderer.setJackArrow(false, true); // E17
    const t = token;
    await sleep(AI_MIN_THINK + 100);
    if (t !== token) return;
    aiYaw = baseYaw();
    const base = releasePoint(player);
    enterCircle(player.id, aiYaw, undefined, 'jack');
    let choice;
    try {
      choice = chooseJackThrow({ world, difficulty, rand: aiRand, player, from: base, geometry: match && match.geometry });
      if (restance(player.id, choice)) choice = chooseJackThrow({ world, difficulty, rand: aiRand, player, from: base, geometry: match && match.geometry }); // F33
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
    if (broadcasting()) director.prep(player.id, yaw); else if (observing()) watchCircle(); else shoulderView();
    const snapped = choice.style === 'tir';
    const showArc = debug && params.has('aispot'); // the arc, cone, donnée and legal zone stay hidden from players (D18)
    renderer.setThrowPreview(null);
    renderer.showJackZone(false);
    if (debug && showArc) {
      const skill = scaledSkill(SKILL[player.id] || SKILL.human, difficulty);
      const cone = coneFor({ skill, from, landing: choice.donnee, loft: choice.loft, energyFrac: choice.energyFrac });
      const env = coneEnvelope({ from, landing: choice.donnee, loft: choice.loft, cone, terrain: world.terrain });
      renderer.setThrowPreview({
        ...env, roll: null, donnee: choice.donnee, style: choice.style || styleForLoft(choice.loft),
        snapped, legalZone: kind === 'jack',
      });
    }
    say2(spot);
    await sleep(showArc ? 1e8 : 1100); // ?debug&aispot holds the view for screenshots
    if (t === token) { renderer.setThrowPreview(null); renderer.showJackZone(false); }
    shoulderCam.yaw = aimYaw;
  }

  // Status line while an AI shows its spot: the factual label, then the player's own line.
  function spotText(player, choice, kind) {
    const key = choice.labelKey || { event: kind === 'jack' ? 'spotJack' : 'spotPoint' };
    const target = key.target === 'jack' ? 'the jack' : player.team === 1 ? 'your boule' : 'their boule';
    const facts = (choice.label || `${player.name} picks ${player.id === 'odette' ? 'her' : 'his'} spot`) + '.';
    // the tactical reason (D13) first, then the generic line for the event
    const why = choice.why;
    const quip = (why && why.code !== 'mistake' && talk.say(player.id, 'why.' + why.code, { target, ...why })) || talk.say(player.id, key.event, { target });
    return quip ? `${facts} ${quip}` : facts;
  }

  async function aiBoule(player) {
    hideHolding(); // F11: aiming starts, so the who-holds banner goes
    say2(`${player.name} is aiming…`);
    renderer.setJackArrow(false, true); // E17: never a chevron on an AI turn
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
      if (restance(player.id, choice)) choice = await chooseThrowAsync({ world, match, player, difficulty, rand: aiRand, from: base }); // F33: re-plan once with the corrected stance
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
    // F33: advice is planned for a throw at the jack: standing beyond 7.5 m, else the stance the thrower has now
    const stance = jk && !jk.dead && circleDist(jk) > STAND_BEYOND ? 'stand' : stanceOf(player.id);
    return { x: c.x, y: c.y, release: (l) => handFrom(player.id, l, yaw, stance) };
  }

  // Your partner looks at the court and tells you what they would do
  async function suggest(pierre) { // (pierre: the partner, whoever you chose)
    const mine = ++thinkToken;
    const t = token;
    let choice, who;
    try {
      // who should throw (analytic, each with their own cone), then what that player should do: the partner's blended advice
      const avail = playersWithBoules(match, pierre.team);
      who = whoThrows({ match, bodies: world.bodies, team: pierre.team, difficulty, players: avail }).player || pierre;
      choice = await chooseThrowAsync({ world, match, player: who, difficulty, rand: aiRand, from: aiBase(pierre), advice: pierre.id });
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
    const kind = whoKind({ intent: choice.intent, thrower: who, partner: pierre, partnerHasBoules: avail.some((p) => p.id === pierre.id) && pierre.boulesLeft > 0, teamSize: avail.length });
    hud.setSuggestion(composeSuggestion(talk, { speaker: pierre.id, intent: choice.intent, code, kind, vars: { target, ...choice.why }, fact }), who.id);
    if (pickHuman !== null && pickHuman !== 'chooser') beginTurn('you'); // debug: go straight to the human throw
  }

  // ---- D11: players fetch dead balls and place the cochonnet (GAME-PLAN section 10) ----
  // A teammate of the thrower walks out to each dead ball at rest, bends, picks it up (the body then follows the hand)
  // and sets it down in the row beyond the far string; a failed cochonnet is carried to the player who places it,
  // handed over, and walked out to the chosen spot. Instant mode and reduced motion teleport. Fetching never holds
  // up a turn for long: the next turn waits (briefly) only while the fetcher is still in view.
  const FETCH_SPEED = CAST_SPEED; // m/s: F26, the same brisk pace as walking to the circle (fetches, pick-ups, gathering)
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
  const deadTargets = () => world.bodies.filter((b) => b.dead && !b.slotted && b.state === 'resting' && !(carry && carry.body === b) && !(jackTask && b.kind === 'jack'));
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
    // F24: a slow-mode put-down leaves the ring pose "held" (render.js ignores the circle while it is), so a later quick-mode
    // move or a new game never moved it. Nobody is carrying it here, so release it (still at the old spot) before the court moves.
    if (!ringCarry) renderer.setRingPose(null);
    setCourt(circle, dir);
    aimYaw = baseYaw(); throwerYaw = aimYaw; shoulderCam.yaw = aimYaw;
    shoulderCam.viewYaw = 0; shoulderCam.viewPitch = 0;
    renderer.syncCourt({ fade: !!fade });
  }
  // F07 (slow mode): the last thrower stays in the circle until the throw settles, picks the ring up where it lies (they stand
  // in it), carries it to about 1 m from the cochonnet on the circle's side and waits there holding it during the scoring.
  // The next mene sets it down (carryRing). Hooks: F10 returns a dead jack's last in-bounds spot from `ringJackSpot`;
  // F02 (others collecting boules meanwhile) can run beside `ringTask`, which is the promise of this walk.
  let ringAt = null, ringTask = null, ringHolder = null, ringSkip = false, ringSkipFn = null, ringPlaced = false; // ringPlaced: F51, the ring is down at the next circle
  const ringJackSpot = () => { // F10: a dead jack's last in-bounds spot, else where it lies
    const j = match && match.jack;
    if (j && j.dead && j.spot) return { x: j.spot.x, y: j.spot.y };
    return j && Number.isFinite(j.x) ? { x: j.x, y: j.y } : null;
  };
  // F10 (slow mode): a dead cochonnet is walked back to its last in-bounds spot by the idle player nearest to it
  // (not the ring holder); the ring holder waits for that before bringing the ring (jackTask is the promise)
  let jackTask = null, jackFetcher = null, jackDone = true, jackSnapFn = null; // F97: jackDone once the jack is down at jack.spot
  const ringWho = () => {
    const last = match.players.find((p) => p.id === lastThrowerId) || match.players.find((p) => p.team === match.jackTeam);
    return last.id;
  };
  const ringDrop = (t) => { if (t !== token) { ringCarry = null; ringHolder = null; renderer.setRingPose(null); } return t !== token; };
  function startJackReturn() { // from endOfMene (after startRingPickup), slow mode only
    const j = jackBody(), spot = ringJackSpot();
    if (!slow() || jackTask || !match || !j || !j.dead || !spot || match.phase !== 'meneEnd') return;
    const posOf = new Map(match.players.map((p) => { const q = cast.get(p.id).root.position; return [p.id, { x: q.x, y: q.y }]; }));
    const who = pickJackCarrier(match.players, posOf, { x: j.x, y: j.y }, { ringHolder, ringCarrier: ringWho() }); // F97: never the ring carrier
    if (!who) return;
    jackFetcher = who; jackDone = false;
    const t = token, job = { id: jackFetcher, tok: t, cancelled: false, scripted: false, jack: true, obstacles: () => obstaclesExcept(j) };
    // F97: a skip (click, key) or the fallback timer: the jack is down at its spot at once and the carrier stands by it
    jackSnapFn = () => {
      if (jackDone) return;
      job.cancelled = true; jackDone = true;
      const c = cast.get(job.id), r = reachOf(c);
      c.setCarrying(false);
      if (carry && carry.body === j) carry = null;
      placeDeadBall(world, j, spot.x, spot.y); j.slotted = true;
      placeAt(job.id, spot.x - r.x, spot.y - r.y, 0);
    };
    jackTask = (async () => {
      await sleep(900);
      if (inCircle === job.id) inCircle = null;
      const ch = cast.get(job.id);
      ch.setHolding(false); ch.setHeldBoules(null); ch.setStance('watch');
      if (!(await pickUp(job, j))) return; // walks to where it lies (round the outside of the timbers if it is out), bends, takes it
      const r = reachOf(ch);
      await walkVia(job, job.id, { x: spot.x - r.x, y: spot.y - r.y, yaw: 0 }, true); // carried back, in the hand, to the spot
      if (!fetchAlive(job)) return;
      await ch.playBend({ kind: 'putdown', onAct: () => { ch.setCarrying(false); placeDeadBall(world, j, spot.x, spot.y); j.slotted = true; if (carry && carry.body === j) carry = null; } });
    })().catch((err) => console.error(err)).then(() => {
      if (carry && carry.body === j) { placeDeadBall(world, j, spot.x, spot.y); j.slotted = true; carry = null; cast.get(job.id).setCarrying(false); }
      if (Math.hypot(j.x - spot.x, j.y - spot.y) > 0.01) { placeDeadBall(world, j, spot.x, spot.y); j.slotted = true; } // (a cancelled walk: the jack still ends at its spot)
      jackDone = true; jackSnapFn = null;
    });
  }
  function startRingPickup() { // from endOfMene, after the throw settled
    if (!slow() || ringTask || !match || match.phase !== 'meneEnd') return;
    const t = token;
    ringHolder = ringWho(); ringPlaced = false;
    ringTask = ringToJack(ringHolder, t).catch((err) => { console.error(err); ringCarry = null; renderer.setRingPose(null); });
  }
  async function ringToJack(id, t) {
    const ch = cast.get(id), r = reachOf(ch), from = { x: court.circle.x, y: court.circle.y };
    const job = { id, tok: t, cancelled: false, scripted: false, obstacles: () => obstaclesExcept(null) };
    await sleep(900); // the throw's follow-through and the first look at the result
    // Only the carrier's OWN fetch is waited for. Another player's fetch (a dead boule) and the F10 dead-jack walk (startJackReturn picks
    // someone other than ringWho(), and ringDest() comes from the rules, not from where the jack is put down) run in parallel with the ring.
    for (let n = 0; n < 80 && fetchJob && fetchJob.id === id && t === token; n++) await sleep(100);
    if (ringDrop(t)) return;
    if (inCircle === id) inCircle = null;
    ch.setHolding(false); ch.setHeldBoules(null); ch.setStance('watch'); shadow(id, true);
    await walkVia(job, id, { x: from.x - r.x, y: from.y - r.y, yaw: 0 }); // a step to put the hand over the ring
    if (ringDrop(t)) return;
    await ch.playBend({ kind: 'pickup', onAct: () => { ringCarry = id; ch.setCarrying(true); followRing(); } });
    if (ringDrop(t)) return;
    // F51: straight on to the next mène's circle (known now: rules' nextMene geometry) and down, beside everybody's boule collection
    await setRingDown(job, id, t, ringDest());
  }
  // F51: where the ring goes for the next mène (E28: round the jack, moved back if the front lacks room; rules.js applies nextCircle)
  function ringDest() {
    const g = apply(match, { type: 'nextMene' }).geometry;
    return { x: g.circle.x, y: g.circle.y };
  }
  // The holder walks the ring to `to` and DROPS it as soon as they arrive (nothing is waited for: boules are already in hands after Next).
  // A click or key skips. The holder is free for their own boules after that.
  const JACK_WAIT_GAP = 1.6, JACK_WAIT_MAX = 90; // F97: the ring carrier waits this far (m) from the spot, for at most this long (s) for the jack
  const RING_BOUNCE_T = 0.14; // s: the ring's one small bounce after it lands
  async function setRingDown(job, id, t, to) {
    const ch = cast.get(id), r = reachOf(ch);
    ringSkip = false; ringPlaced = false;
    const finish = () => { // skipped: straight to the end state
      ringCarry = null; ch.setCarrying(false);
      placeAt(id, to.x - r.x, to.y - r.y, 0);
      renderer.setRingPose({ x: to.x, y: to.y, z: terrain.sample(to.x, to.y).h + 0.006 });
      ringAt = { x: to.x, y: to.y }; markRingDown();
    };
    ringSkipFn = () => { ringSkip = true; if (jackSnapFn) jackSnapFn(); placeAt(id, to.x - r.x, to.y - r.y, 0); };
    try {
      if (!ringCarry) { ringCarry = id; ch.setCarrying(true); followRing(); }
      if (!ringMayDrop({ jackTask, jackDone })) { // F97: the jack is still being carried back: wait short of the spot, ring in hand, until it is down
        const p = ch.root.position, st = ringStagePoint({ x: p.x, y: p.y }, to, JACK_WAIT_GAP);
        await walkVia(job, id, { x: st.x - r.x, y: st.y - r.y, yaw: 0 });
        for (let n = 0; n < JACK_WAIT_MAX * 10 && !ringMayDrop({ jackTask, jackDone }) && !ringSkip && t === token; n++) await sleep(100);
        if (t === token && !ringMayDrop({ jackTask, jackDone }) && jackSnapFn) jackSnapFn(); // fallback: the jack goes down at its spot
      }
      await walkVia(job, id, { x: to.x - r.x, y: to.y - r.y, yaw: 0 });
      if (t !== token) { ringCarry = null; renderer.setRingPose(null); return; }
      if (ringSkip) { finish(); return; }
      // F53: the ring is dropped, not set down: the hand lets go over the spot and it falls flat with a small bounce (no leaning down)
      const h0 = ch.handWorldPosition(), z0 = Math.max(h0.z - 0.04, terrain.sample(to.x, to.y).h + 0.03);
      ringCarry = null; ch.setCarrying(false);
      const gz = terrain.sample(to.x, to.y).h + 0.006, fall = Math.sqrt(2 * Math.max(z0 - gz, 0.02) / 9.81);
      for (let e = 0; e < fall + RING_BOUNCE_T && !ringSkip && t === token; e += 0.02) {
        const hop = e < fall ? 0 : 0.025 * (1 - Math.pow(((e - fall) / RING_BOUNCE_T) * 2 - 1, 2));
        renderer.setRingPose({ x: to.x, y: to.y, z: e < fall ? Math.max(gz, z0 - 4.905 * e * e) : gz + hop });
        await sleep(20);
      }
      if (t !== token) { ringCarry = null; renderer.setRingPose(null); return; }
      renderer.setRingPose({ x: to.x, y: to.y, z: gz });
      ringAt = { x: to.x, y: to.y }; markRingDown();
      if (ringSkip && ringCarry) finish();
    } finally { ringCarry = null; ringSkipFn = null; ringHolder = null; }
  }
  function markRingDown() { ringPlaced = true; if (collect && collect.plan) collect.plan.ringDown = true; } // F15: the next jack thrower may walk to the circle
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
  async function walkVia(job, id, to, outside = false, hurry = 1) {
    const ch = cast.get(id), p = ch.root.position;
    const path = planRoute({ x: p.x, y: p.y }, to, job.obstacles ? job.obstacles() : obstaclesExcept(null), { outside });
    const last = path[path.length - 1] || { lift: 1 };
    await ch.walkTo({ x: to.x, y: to.y, yaw: to.yaw, speed: FETCH_SPEED * hurry, lift: last.lift, via: path.slice(0, -1) });
  }
  // The head camera follows the fetch loosely: it frames the fetcher and where they are going (never over an aim)
  function fetchCam(job, ids, spots = []) {
    if (pending || flying || job.jack || !fetchAlive(job) || (job.scripted && !(debug && params.has('fetchcam')))) return;
    const pts = ids.map((i) => cast.get(i).root.position).concat(spots).map((q) => ({ x: q.x, y: q.y }));
    const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length, cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
    if (observing()) { observerView(pts); return; }
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
  // F32: the Mode choice lives on the pause card; switching to quick while paused is applied on Resume (the cast is frozen meanwhile)
  let quickPending = false;
  function applyQuick() {
    quickPending = false;
    if (!match) return;
    if (placing) skipPlacement();
    const fj = fetchJob, jf = jackFetch;
    if (fj) { cancelFetch(); if (!fj.jack || !jf) sendHome(fj.id); }
    if (jf) {
      if (match.phase === 'jackPlace' && !placing) { jackFetch = null; if (fj) sendHome(fj.id); if (jf.handed) jf.handed(); }
    }
    if (deadTargets().length) dropAllDead();
    for (const [id, ch] of cast) if (id !== inCircle && ch.busy && !(carry && carry.id === id)) sendHome(id);
    gateSince = 0;
  }
  settings.onChange((m) => { if (m !== 'quick') { quickPending = false; return; } if (isPaused()) quickPending = true; else applyQuick(); });
  const skipEvent = (ev) => {
    if (holdSim && !isPaused() && (ev.type === 'pointerdown' || ev.key === 'Enter' || ev.key === ' ')) { nextMene(); return; } // F56: a click or key at the outcome view is Next
    if (isPaused()) return; // a drag to orbit the paused scene (or Esc) is not a skip
    if (placing && ev.timeStamp - placing.start > 350) skipPlacement();
    else if (circleWalk && performance.now() - circleWalk.start > 350) { // E02: the thrower is at the circle at once
      const w = circleWalk; circleWalk = null;
      if (w.tok === token) placeAt(w.id, court.circle.x, court.circle.y, w.yaw);
    }
    else if (!placing && gateSince && fetchJob) skipFetchWait();
    else if (ringSkipFn && !ringSkip) ringSkipFn(); // F07: the ring walk
    if (jackSnapFn) jackSnapFn(); // F97: the jack is down at its spot at once
    skipCollect(); // F02: the players have their boules at once
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
      headView(match.jack, undefined, 0.3); // E17: the card covers the middle, so the subject sits high
      const pierre = avail.find((p) => !p.isHuman); // your partner
      hud.showChooser(avail, `${pierre ? pierre.name : 'Your partner'} is sizing up the court…`);
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
      stanceKept = playerId;
    } else if (quickSwapFrom(playerId)) { // E31: the changeover (fades, the beat) finishes before the turn starts
      const t = token;
      enterCircle(playerId, baseYaw()).then(() => { if (t === token && match && match.phase === 'play') start(); });
      stanceKept = playerId;
    } else start();
  }

  function snapshot() {
    const j = jackBody();
    return {
      jack: { x: j.x, y: j.y, dead: j.dead, spot: j.dead && Number.isFinite(j.outX) ? { x: j.outX, y: j.outY } : null },
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
    if (was.kind === 'jack') return `Jack is ${jackGap(was, match && match.geometry).toFixed(1)} m out.`; // F75: edge to edge
    if (j && match && jackTooClose(j, match.geometry)) return 'The jack is too close: less than 3 m from the circle, dead jack.'; // F76, Art. 9.3
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
  // F06: edge-to-edge gap, the same figure as every measuring label, card and status line
  // F123b: the canonical (tie-cluster) gap, the same value the rules decide on
  const canonGap = (b, j) => canonicalGaps(world.bodies.filter((x) => x.kind === 'boule'), j).get(b.id) ?? gapM(b, j);
  const gapText = (b, j) => fmtCm(canonGap(b, j));
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
      out.push(cheer ? talk.say(partner, 'ownScores') : talk.line('you', ev));
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
      say2(`${why} You and ${PERSONALITIES[partner].name} place the cochonnet: click a green spot between the yellow arcs (6 to 10 m from the edge of the circle).`);
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
    if (!debug) return;
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
      if (debug && showTarget) renderer.setPlaceMarker({ x: spot.x, y: spot.y, valid: true });
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
    if (!match || match.phase !== 'jackPlace' || flying) { if (debug) console.info('[placeJack] refused', match && match.phase, !!flying); return; }
    if (!jackPlaceValid(spot, match.geometry)) { if (debug) console.info('[placeJack] invalid spot', JSON.stringify(spot), JSON.stringify(match.geometry.circle), match.geometry.dir); return; }
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
    if (instant) { // E17: autotest has no frames to run the drop: settle it here, as launchBody does
      let guard = 0;
      while (!world.settled() && guard++ < 240 * C.hardCapSeconds) world.step();
      if (!world.settled()) world.forceRest();
      onSettled();
      world.events.length = 0;
    }
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
    const first = match.players.filter((p) => p.team === match.jackTeam && p.isHuman).length ? `You and ${PERSONALITIES[partner].name} play` : `${TEAM_NAMES[match.jackTeam]} play`;
    say2(`Jack placed at ${jackGap(j, match.geometry).toFixed(1)} m. ${first} first.`);
    later(startPlay, 1400);
  }
  // ?debug&jackplace[=ai]: skip the throw and fail the jack, so the placement shows at once
  function forceInvalidJack(team) {
    if (!debug) return;
    const spot = { x: +params.get('jx') || 2, y: +params.get('jy') || 5.2 };
    removeJack();
    world.add(createBody('jack', { team: -1, x: spot.x, y: spot.y }));
    renderer.sync(world);
    match = apply(match, { type: 'jackThrown', team, jack: spot });
    jackFailed(spot, '');
    if (debug && params.has('yellow')) { // ?debug&jackplace&yellow: set the jack down at once; the first rest counts as a yellow card
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
    if (was.kind === 'boule' && !instant) { // F61: CARREAU / BIBERON overlay (the sim keeps running)
      try {
        const kind = detectAnnouncement({ before: preThrow, bodies: world.bodies, shooterId: was.id, events: evs });
        const early = carreauW && carreauW.fired && carreauW.shooterId === was.id && carreauW.preThrow === preThrow; // F107: announced mid-throw
        if (kind && !(early && kind === 'carreau')) announcer.show(kind);
      } catch (err) { console.error('[announce]', err); }
    }
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
    { // F76: the rules judged a jack knocked to less than 3 m from the circle dead: show it dead too (fetch and ring follow the dead-jack flow)
      const jb = jackBody();
      if (match.jack && match.jack.dead && jb && !jb.dead) placeDeadBall(world, jb, jb.x, jb.y);
    }
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
    showHolding(); // F11: who holds the point before the next aim
    bcastDelay = 1800;
    react(was, prevHold);
    kickFetch(was); // D11
    later(nextTurn, instant ? 0 : bcastDelay);
  }

  // lift the framing so the circle sits above the card (a bottom card on tall/narrow screens, less on wide ones)
  const SCORING_LIFT = () => (innerWidth / innerHeight < 1 ? 0.2 : 0.15);
  let scoringShown = false, closeCall = false;
  function endOfMene(note) {
    const r = match.result;
    scoringShown = false; closeCall = false; nextStarted = false; meneEndWork = null;
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
          // F06: the circle is centred on the jack and its line touches the rival's near surface: radius = the rival's
          // centre distance minus its radius. Every scoring boule's near edge is inside by definition (it is nearer).
          // No live rival: the furthest scoring boule's far edge plus a margin.
          const ink = r.team === 0 ? { fill: '#2f5fb8', edge: '#16315f' } : { fill: '#d9893a', edge: '#8a4a0c' };
          // E32: a debug-only forced close call: the rival sits 7 mm behind the winner along its own line
          if (debug && params.has('closecall') && rivalE) {
            const w = scoringE[0].b, want = Math.hypot(w.x - j.x, w.y - j.y) - w.r + rivalE.b.r + 0.007;
            const d = Math.hypot(rivalE.b.x - j.x, rivalE.b.y - j.y) || 1;
            rivalE.b.x = j.x + (rivalE.b.x - j.x) / d * want; rivalE.b.y = j.y + (rivalE.b.y - j.y) / d * want;
            rivalE.m.dist = want;
          }
          // (computed after the debug shift above, so the rival stays on the line)
          const centreD = (b) => Math.hypot(b.x - j.x, b.y - j.y);
          const reach = Math.max(...scoringE.map((e) => centreD(e.b) + e.b.r));
          const radius = rivalE ? centreD(rivalE.b) - rivalE.b.r : reach + 0.07;
          // E32: a close call (gaps within 2 cm) is flagged in the card; every gap is shown to one decimal (F06)
          const cgs = canonicalGaps(world.bodies.filter((b) => b.kind === 'boule'), j);
          const cgap = (b) => cgs.get(b.id) ?? gapM(b, j);
          const bestWin = Math.min(...scoringE.map((e) => cgap(e.b)));
          closeCall = !!rivalE && Math.abs(cgap(rivalE.b) - bestWin) < 0.02;
          const lab = (b) => fmtCm(cgap(b));
          renderer.showScoring(j, {
            radius, fill: ink.fill, edge: ink.edge, color: TEAM_INK[r.team].line, dark: TEAM_INK[r.team].dark,
            items: scoringE.map((e, n) => ({ x: e.b.x, y: e.b.y, r: e.b.r, n: n + 1, label: lab(e.b) })),
            others: world.bodies.filter((b) => b.kind === 'boule' && !b.dead).map((b) => ({ x: b.x, y: b.y, r: b.r })),
            rival: rivalE ? { x: rivalE.b.x, y: rivalE.b.y, r: rivalE.b.r, label: lab(rivalE.b) } : null,
          });
          scoringShown = true;
          pts.push({ x: j.x - radius, y: j.y - radius }, { x: j.x + radius, y: j.y + radius });
          if (rivalE) pts.push({ x: rivalE.b.x, y: rivalE.b.y });
        } else renderer.clearMeasure();
      } else renderer.clearMeasure();
      // E32: near top-down over the circle in both modes (the observer may cut to it), so perspective can't mislead
      if (scoringShown) renderer.setCamera('head', { now: true, target: { x: j.x, y: j.y }, points: pts, lift: innerWidth / innerHeight < 1 ? 0.2 : 0.1, margin: innerWidth / innerHeight < 1 ? 0.12 : 0.22, minHalf: 0.3, dist: 1.4, el: 1.38 });
      else { camNow = true; headView(j, pts, 0.4, false); camNow = false; }
    } else aimView();
    if (r.void) {
      // say why: a dead jack (even one that rolled back onto the court), tied boules, or no live boules
      const live = world.bodies.filter((b) => b.kind === 'boule' && !b.dead);
      const near = [0, 1].map((t) => live.filter((b) => b.team === t)
        .reduce((m, b) => Math.min(m, Math.hypot(b.x - j.x, b.y - j.y)), Infinity));
      if (jackOut && r.inHand) note = deadJackText(r.inHand, TEAM_NAMES, r.jackReason); // F13: from the boules in hand when it went dead
      else if (!live.length) note = 'No live boules on the court: mène void.';
      else if (sameGap(near[0], near[1], live.map((b) => Math.hypot(b.x - j.x, b.y - j.y)))) note = 'The closest boules of each team are the same distance from the cochonnet: mène void.';
      else { note = 'Mène void.'; console.warn('[void mène] no reason found: please report this with the details below'); }
      console.info('[void mène]', { jackDead: !!(j && j.dead), jackAt: j && { x: +j.x.toFixed(3), y: +j.y.toFixed(3) },
        liveBoules: live.length, closest: near.map((d) => (Number.isFinite(d) ? +d.toFixed(4) : null)),
        matchJack: match.jack, inHand: match.players.map((p) => `${p.id}:${p.boulesLeft}`).join(' ') });
    }
    else if (jackOut && r.inHand) note = deadJackText(r.inHand, TEAM_NAMES, r.jackReason); // F13: dead jack, one team holds boules
    else if (!jackOut && !r.void && r.measured && r.measured.length) {
      // report the winning boule's gap, the figure on its measuring label
      const win = world.bodies.find((b) => b.id === r.measured[0].id);
      const special = /^(Carreau|Biberon)/.test(note) ? note + ' ' : '';
      if (win) note = `${closeCall ? 'Close call! ' : ''}${special}Closest: ${ownerName(win)} boule, ${gapText(win, j)} from the jack.`;
    }
    refreshHud(null);
    // F56: in a slow mène the outcome view and the card wait for the click (the sim clock is held); the ring, jack return, gathering and
    // collecting then start from nextMene (startMeneEndWork). Otherwise (quick, instant, game over) they start now.
    const hold = slow() && match.phase === 'meneEnd' && !(instant && !(debug && params.has('meneend')));
    const winTeam = r.void ? null : r.team, workTok = token;
    meneEndWork = () => {
      if (workTok !== token || !match || (match.phase !== 'meneEnd' && match.phase !== 'gameOver')) return;
      startRingPickup(); // F07 (slow mode)
      startJackReturn(); // F10 (slow mode): a dead jack is carried to its last in-bounds spot
      gather(winTeam);
      if (match.phase === 'meneEnd') startCollect(); // F02 (slow mode)
    };
    if (!hold) startMeneEndWork();
    let text, detail = note;
    if (r.void) text = 'Void mène: no points';
    else {
      const names = TEAM_NAMES[r.team];
      text = `${names} score ${r.points} point${r.points === 1 ? '' : 's'}`;
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
        text: win === 0 ? 'You win!' : `${TEAM_NAMES[1]} win`,
        detail: `${text}. Final score ${match.scores[0]} to ${match.scores[1]}. ` +
          [lines[0] && talk.say(lines[0], 'gameWon'), lines[1] && talk.say(lines[1], 'gameLost')].filter(Boolean).join(' '),
      });
      return;
    }
    hud.showMeneEnd({ text, detail: `${detail} Score: ${match.scores[0]} to ${match.scores[1]}. ${voices('meneWon', 'meneLost')}`.trim() });
    // F22: with the card up, frame the circle, badges and labels into whatever the card and the top HUD leave free
    if (scoringShown) renderer.fitScoring(() => {
      const cv = canvas.getBoundingClientRect(), rel = (r) => ({ l: r.left - cv.left, t: r.top - cv.top, r: r.right - cv.left, b: r.bottom - cv.top });
      const card = root.querySelector('.pt-overlay.pt-mene-end .pt-card');
      // F62: measured from the DOM now and on every resize: the top score bar, the card, and the right-hand icon cluster
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden' ? rel(r) : null; };
      const bars = [...root.querySelectorAll('.pt-board')].map(vis).filter(Boolean);
      const cr = card ? rel(card.getBoundingClientRect()) : null;
      const icons = [...root.querySelectorAll('button, .pc-corner')].filter((n) => !(card && card.contains(n)) && !n.closest('.pt-overlay, .pt-paused')).map(vis).filter(Boolean);
      const free = freeViewRect({ W: cv.width, H: cv.height, bars, card: cr, icons });
      return { free, card: cr };
    });
    if (hold) holdSim = true, clock.pause(); // F56: the camera is on the outcome view and the card is up: the sim waits for the click
    if (instant && !(debug && params.has('meneend'))) later(() => nextMene(), 0);
  }

  // F56: the score card and Next mène show as soon as the outcome view is up and the sim clock pauses (holdSim: no sepia, no pause card;
  // players and fidgets stand still, the camera stays on the outcome). The click (Next, a canvas click or Enter/Space) releases the clock,
  // starts the ring, jack return, gathering and collecting (meneEndWork), and nextMene carries on by itself once they are all done.
  let holdSim = false, meneEndWork = null, nextStarted = false;
  function releaseHold() { if (!holdSim) return; holdSim = false; if (!isPaused()) clock.resume(); }
  function startMeneEndWork() { const w = meneEndWork; meneEndWork = null; if (w) w(); }

  // E10: the next mène starts from a new circle around the last jack (rules.js picks it), played the other way.
  // Slow mode: the last thrower walks the ring over first; quick mode: it fades to the new spot as the jack throw starts.
  async function nextMene() {
    if (!match || match.phase !== 'meneEnd' || ringBusy || nextStarted) return;
    nextStarted = true;
    releaseHold();
    startMeneEndWork();
    if (slow() && observing()) wideShot(); // F57: the whole court with Rainier behind, held through the collecting
    const next = apply(match, { type: 'nextMene' });
    const g = next.geometry, to = { x: g.circle.x, y: g.circle.y };
    const t = token;
    hud.hideOverlay();
    const fadeOut = changeover() && !collect; // F02, quick mode: boules and players fade to their places
    if (fadeOut) {
      for (const b of world.bodies) if (b.kind === 'boule') renderer.fadeBody(b.id, -1, FADE_S);
      for (const ch of cast.values()) ch.fadeTo(0, FADE_S);
      await sleep(FADE_S * 1000 + 50);
      if (t !== token) return;
    }
    if (slow()) {
      // F51: the ring has been on its way since the result (setRingDown) beside the boule collection; the mène starts when both are done
      ringBusy = true;
      try {
        if (jackTask) { await Promise.race([jackTask, sleep(JACK_WAIT_MAX * 1000)]); if (jackSnapFn) jackSnapFn(); } // F10, F97: the fallback snaps the jack to its spot
        if (!ringTask && !ringPlaced) startRingPickup();
        if (ringTask && !ringPlaced) say2('The circle is moved to where the cochonnet finished…');
        if (ringTask) await ringTask;
        ringTask = null;
      } catch (err) { console.error(err); renderer.setRingPose(null); ringCarry = null; }
      if (collect && collect.plan) collect.plan.ringDown = true; // F15: the next jack thrower may walk to the circle
      try { await finishCollect(); } catch (err) { console.error(err); } // F02: the rest of the collecting
      if (collect && collect.places && t === token) { // F59: the mène starts when the ring is down and everybody is at their place (the fade covers the stuck ones)
        const at = () => new Map([...cast.keys()].map((k) => [k, cast.get(k).root.position]));
        for (let w = 0; w < 25 && t === token && !meneEndReady({ ringDown: ringPlaced || !ringTask, collectDone: atPlaces(at(), collect.places) }); w++) await sleep(200);
      }
      ringBusy = false;
      if (t !== token) return;
    }
    jackTask = null; jackFetcher = null; jackDone = true; jackSnapFn = null;
    match = next;
    applyCourt(to, g.dir ?? 1, !slow() && !instant);
    if (slow()) walkToSpots(next);
    beginMene(false);
    if (fadeOut) for (const ch of cast.values()) { ch.setOpacity(0); ch.fadeTo(1, FADE_S); }
  }

  // ---- F60: after Next every boule goes at once into its owner's hands; the owners walk straight to their next-mène places ----
  // Slow mode: the ring carrier (F07) and the jack fetcher (F10) finish first and then take their boules. Walkers steer round
  // each other (`crowdTick`, crowd.js) and, blocked for more than BLOCK_FADE_S, fade to the place. The mène starts when the ring
  // is down and everybody is at their place (nextMene); the start leaves them there (spotsKept). A click or key (skipCollect)
  // jumps to the end state. Quick mode: boules and players fade (nextMene). Instant: nothing.
  let collect = null, spotsKept = 0, f02Script = false; // collect: { tok, ids, skipped, finished, done, walkers, goal, blocked }
  const ownBoules = (id) => world.bodies.filter((b) => b.kind === 'boule' && b.owner === id && !(carry && carry.body === b));
  function startCollect() {
    if (!slow() || collect || !match || match.phase !== 'meneEnd') return;
    const st = { tok: token, ids: match.players.map((p) => p.id), skipped: false, finished: false, held: new Map(), picked: false, walkers: new Set(), goal: new Map(), blocked: new Map(), goalStarted: new Set(), plan: planNext(), places: new Map() };
    collect = st;
    st.done = runCollect(st).catch((err) => console.error(err)).then(() => { st.finished = true; });
  }
  // F15: the next mène's circle and waiting slots depend only on the final jack spot, so they are known as soon as the result
  // is. Each player walks to their own spot straight after picking up their boules; the next jack thrower goes to the new
  // circle once the ring is down (plan.ringDown, set by nextMene).
  function planNext() {
    if (!match || match.phase !== 'meneEnd') return null;
    const pl = planGoals(apply(match, { type: 'nextMene' }), { terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist });
    return { ...pl, taken: [], ringDown: false };
  }
  function slotFor(st, id) { // the nearest free waiting slot behind the new circle
    const pl = st.plan, pos = cast.get(id).root.position;
    const free = pl.slots.filter((s) => !pl.taken.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 0.6));
    free.sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y));
    const s = free[0] || homeAt(id);
    pl.taken.push({ x: s.x, y: s.y }); claims.set(id, { x: s.x, y: s.y });
    return { x: s.x, y: s.y, yaw: Math.atan2(pl.to.x - s.x, pl.to.y + 5 * pl.dir - s.y) };
  }
  // Steered walk to the player's next-mène spot (the circle for the jack thrower, once the ring is down); blocked for
  // more than BLOCK_FADE_S they fade to it (crowdTick). `live` says whether the walk is still wanted.
  async function goalWalk(st, id, live) {
    const pl = st.plan, ch = cast.get(id);
    if (!pl || st.goalStarted.has(id)) return;
    st.goalStarted.add(id);
    let g;
    if (id === pl.thrower) {
      claims.delete(id);
      for (let w = 0; w < 900 && live() && !pl.ringDown && !ringPlaced; w++) await sleep(200);
      if (!live()) return;
      g = { x: pl.to.x, y: pl.to.y, yaw: baseYaw(pl.dir) };
    } else { g = slotFor(st, id); st.places.set(id, { x: g.x, y: g.y }); }
    const job = { id, tok: st.tok, cancelled: false, scripted: false, obstacles: () => obstaclesExcept(null) };
    ch.setCarrying(false); ch.setHolding(false); ch.setStance('watch');
    st.walkers.add(id); st.goal.set(id, g);
    if (id === pl.thrower) startHumanWalk(id, g); // F39: the human's walk to the new circle
    await walkVia(job, id, g);
    st.goal.delete(id); st.walkers.delete(id);
    if (st.tok !== token) return;
    ch.setStance('watch'); shadow(id, id === pl.thrower);
  }
  const gatherBusy = (id) => ringHolder === id || (fetchJob && fetchJob.id === id); // still on the ring (F07) or a fetch
  // Each frame: the gathering walkers steer round everybody else (crowd.js); blocked goal walkers fade after BLOCK_FADE_S
  function crowdTick(dt) {
    const st = collect;
    if (!st || st.tok !== token || !st.walkers.size) return;
    const all = [...cast.keys()].map((k) => { const q = cast.get(k).root.position; return { id: k, x: q.x, y: q.y }; });
    for (const id of [...st.walkers]) {
      const ch = cast.get(id), leg = ch.walkLeg();
      if (!leg) { st.blocked.delete(id); continue; }
      const p = ch.root.position;
      if (Math.hypot(leg.x - p.x, leg.y - p.y) < 0.4) continue; // arriving: no steering, so the last step always lands
      // F53: the next jack thrower close to their circle stands their ground: others slow for them, they are not pushed sideways
      const stand = !!st.plan && id === st.plan.thrower && Math.hypot(st.plan.to.x - p.x, st.plan.to.y - p.y) < 2.5;
      const v = steer({ x: p.x, y: p.y }, leg, all.filter((o) => o.id !== id), { push: !stand });
      ch.setSteer(v);
      if (!st.goal.has(id)) continue;
      const bt = v.blocked ? (st.blocked.get(id) || 0) + dt : 0;
      st.blocked.set(id, bt);
      if (bt > BLOCK_FADE_S) fadeToGoal(st, id);
    }
  }
  function fadeToGoal(st, id) { // blocked on the way to the goal: fade out and in at the spot
    const g = st.goal.get(id), ch = cast.get(id);
    st.goal.delete(id); st.walkers.delete(id); st.blocked.delete(id);
    ch.fadeTo(0, 0.15);
    later(() => { if (st.tok !== token) return; placeAt(id, g.x, g.y, g.yaw); ch.fadeTo(1, 0.15); ch.setStance('watch'); shadow(id, false); }, 200);
  }
  function giveBoules(st, id) { // F60: every boule still on the court is at once in its owner's hands (a skip does the same)
    const rest = ownBoules(id);
    for (const b of rest) { const i = world.bodies.indexOf(b); if (i >= 0) world.bodies.splice(i, 1); }
    const n = (st.held.get(id) || 0) + rest.length;
    st.held.set(id, n);
    if (rest.length) { cast.get(id).setHeldBoules({ ...splitHeld(n), color: teamColor(id) }); renderer.sync(world); renderer.clearMeasure(); } // (the result labels would point at nothing)
  }
  // F60: after Next every boule on the court (dead ones in the row included) is in its owner's hands at once, then the owner
  // walks straight to their next-mene place (goalWalk). The ring holder (and a jack fetcher) keeps going and takes his boules
  // once free. The next mene starts when the ring is down and everybody is at a place (nextMene).
  async function runCollect(st) {
    const t = st.tok, alive = (id) => t === token && !st.skipped && !!match;
    const run = async (id) => {
      const ch = cast.get(id);
      for (let w = 0; w < 600 && alive(id) && gatherBusy(id); w++) await sleep(200); // the ring carrier or a fetcher joins when free
      if (jackTask && jackFetcher === id) await jackTask;
      if (!alive(id)) return;
      giveBoules(st, id);
      shadow(id, true); ch.setHolding(false); ch.setCarrying(false); ch.setStance('watch');
      await goalWalk(st, id, () => alive(id)); // F15: straight to the next mène's spot
    };
    await Promise.all(st.ids.map((id) => run(id)));
  }
  function skipCollect() { // everything jumps to the end state: every boule in its owner's hands
    const st = collect;
    if (!st || st.finished || st.skipped || st.tok !== token || !match) return;
    st.skipped = true;
    for (const id of st.ids) {
      const ch = cast.get(id), p = ch.root.position;
      giveBoules(st, id);
      st.walkers.delete(id);
      if (gatherBusy(id) || (jackTask && jackFetcher === id)) continue; // carrying the ring or the jack: leave them to it
      ch.setCarrying(false);
      const pl = st.plan;
      let g = st.goal.get(id) || null;
      if (!g && pl && id !== pl.thrower && !st.goalStarted.has(id)) { g = slotFor(st, id); st.goalStarted.add(id); }
      st.goal.delete(id);
      if (g) { placeAt(id, g.x, g.y, g.yaw); ch.setStance('watch'); shadow(id, false); } // F15: everyone is at their next spot
      else placeAt(id, p.x, p.y);
    }
    renderer.sync(world); renderer.clearMeasure();
    st.finished = true;
  }
  async function finishCollect() { // nextMene: wait for whoever is still collecting (a click skips it)
    const st = collect;
    if (st && st.tok === token && !st.finished) await st.done;
  }
  // The next mène's players go to their spots (F15: normally they are there already). Anybody not yet sent (the ring carrier
  // who held no boules, a skipped gathering) goes now, steered like the rest; the jack thrower walks in as the turn begins.
  function walkToSpots(next) {
    const st = collect;
    if (!st || st.tok !== token || !slow() || !st.plan) return;
    spotsKept = token;
    for (const p of next.players) {
      if (p.id === st.plan.thrower) { claims.delete(p.id); continue; }
      goalWalk(st, p.id, () => st.tok === token).catch((err) => console.error(err));
    }
  }

  // ---- Pause (D12): the page is showing with a game in progress. One switch freezes the game clock (every sleep and
  // later), physics, characters, camera transitions and audio; the scene goes sepia with a free orbit camera, and the
  // game widgets (not the page's paused bar) go sepia and inert. ?debug&paused holds off until the human's turn.
  let pauseHold = debug && params.has('paused');
  const isPaused = () => !pauseHold && (!playing || userPaused) && !!match;
  let pausedNow = false, tossPhase = 'off', pausedTok = 0;
  function syncPause() {
    const p = isPaused();
    if (p === pausedNow) return;
    pausedNow = p;
    root.classList.toggle('is-paused', p);
    for (const n of root.querySelectorAll('.pt-board, .pt-dock, .petanque-controls, .pt-overlay')) n.inert = p;
    if (p) { clock.pause(); pausedTok = token; tossPhase = toss.getPhase() === 'toss' ? 'aim' : toss.getPhase(); toss.setPhase('off'); } else { if (!holdSim) clock.resume(); toss.setPhase(pausedTok === token ? tossPhase : 'off'); } // a New game while paused leaves the toss off
    audio.setPaused(p);
    renderer.setPaused(p);
    if (!p && quickPending && settings.mode === 'quick') applyQuick();
  }

  // F103/F104: graphics quality. High = level 0, Low = the last level, Auto starts at 0 (Low on a weak device) and the
  // controller steps down one level when frames stay slow; never back up. Changing the setting applies at once.
  let auto = settings.graphics === 'auto' ? createAutoQuality(level) : null, qLast = 0;
  function applyLevel(l) { level = l; const s = levelSettings(l); renderer.setQuality(s); audio.setAmbientScale(s.ambient); }
  settings.onGraphicsChange((g) => { auto = g === 'auto' ? createAutoQuality(initialLevel(g, weak)) : null; applyLevel(initialLevel(g, weak)); });
  function qualityTick(now) {
    const ms = now - qLast; qLast = now;
    if (!auto) return;
    const next = auto.frame(ms, !pausedNow && !document.hidden);
    if (next !== null) { applyLevel(next); if (debug) console.info('[quality] auto stepped down to', next, LEVELS[next].name); }
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
  const fixedDt = debug ? +params.get('fixeddt') || 0 : 0; // F110: ?debug&fixeddt=16.7 advances exactly that many ms per rendered frame (camera measurements at 60 fps under slow headless rendering)
  function frame(now) {
    if (fixedDt) now = last + fixedDt;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (pauseHold && ((pending && now > 1500) || now > 3500)) { pauseHold = false; if (playing) userPaused = true; syncPausedUI(); }
    syncPause();
    qualityTick(now);
    clock.tick(dt * 1000);
    acc += dt;
    if ((!playing || userPaused) && match) acc = 0; // paused: the game waits
    let n = 0;
    while (acc >= C.dt && n < MAX_STEPS && !(freezeAt && world.t >= freezeAt)) {
      world.step(); acc -= C.dt; n++;
      if (flying && flying.kind === 'boule' && !instant && match) { // F107: carreau overlay the moment it happens, once per throw
        if (!carreauW || carreauW.shooterId !== flying.id || carreauW.preThrow !== preThrow) { carreauW = createCarreauWatcher({ before: preThrow, shooterId: flying.id }); carreauW.preThrow = preThrow; }
        try { if (carreauW.feed(world.bodies, world.events)) announcer.show('carreau'); } catch (err) { console.error('[carreau]', err); }
      }
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
    syncGv(pausedNow ? 0 : dt);
    { // F19: the floatplane keeps game time (none while paused or between games) and feeds its engine to the ambience
      const fp = renderer.floatplane;
      // F37: random planes are scheduled in slow mode only (quick mode: none).
      fp.schedule(match && !pausedNow && playing ? dt : 0, match, reduceMotion() || settings.mode !== 'slow');
      const en = fp.engine;
      audio.setAmbientState({ busy: !!(pending || flying), slow: settings.mode !== 'quick' });
      renderer.butterflies.busy = !!(pending || flying); // F81
      audio.setEngine(en.on && !pausedNow, en.level, en.pan, en.rev, en.dist);
    }
    renderer.setDaylight(goldenParam !== null ? goldenParam : reduceMotion() ? REDUCED_PROGRESS : golden.step(match, pausedNow || !playing ? 0 : dt)); // F71
    renderer.render(pausedNow ? 0 : dt);
    nextFrame(frame);
  }

  if (debug && params.get('floatplane')) { // ?debug&floatplane=takeoff|landing[&fpat=seconds][&fpcam=0]: run it now, camera on it
    const fp = renderer.floatplane;
    fp.trigger(params.get('floatplane') === 'landing' ? 'landing' : 'takeoff', params.get('fpmirror') === '-1' ? -1 : 1);
    fp.debugFrame = params.get('fpcam') !== '0';
    if (params.has('fpat')) fp.advance(+params.get('fpat') || 0);
  }
  aimView();
  nextFrame(frame);

  if (debug) { // F86: ?debug&pausegame=MS / &endgame=MS pause / end the game after MS of wall time (screenshots)
    if (params.has('pausegame')) setTimeout(() => pauseGame(), +params.get('pausegame') || 0);
    if (params.has('endgame')) setTimeout(() => endGame(), +params.get('endgame') || 0);
    if (params.has('exitclick')) { const t0 = Date.now(), iv = setInterval(() => { const b = document.querySelector('.pt-exit'); if (b && Date.now() - t0 > (+params.get('exitclick') || 0)) { clearInterval(iv); b.click(); } }, 200); } // F93: ?debug&exitclick=MS presses Exit once the game-over card is up (and MS have passed)
    window.__petanque = {
      world, terrain, renderer, seed, reset: toSetup, startGame, court,
      audio,
      setPlaying, clock, pauseGame, endGame,
      get paused() { return pausedNow; },
      get quality() { return level; },
      get pending() { return pending; },
      cast,
      get aimYaw() { return aimYaw; },
      get match() { return match; },
      throw: (p) => launchBody(jackBody() && !jackBody().dead ? 'boule' : 'jack', 0, 'you', { ...readParams(), ...p }),
      throwJack: (p) => launchBody('jack', -1, null, { ...readParams(), ...p }),
    };
  }

  // ?debug&play enters the full-window view without a click; the debug modes that start a match do too (otherwise the
  // match would start paused, with the page showing, and an instant match would never run)
  if (debug && (params.has('play') || params.has('autotest') || params.has('jackplace') || params.has('aispot') || pickHuman !== null)) setPlaying(true);
  if (debug && params.has('holding')) hud.showHolding('Marcel & Odette are holding 2 points', 1); // ?debug&holding: sample banner (F11 screenshots)

  if (debug && params.has('autotest')) {
    // AI-only quick match, every throw simulated to rest instantly
    startGame({ target: +params.get('target') || 7, difficulty: 'medium', allAI: true, instant: !params.has('animate') }); // &animate: real time
  } else if (debug && params.has('jackplace') && !params.has('mene2')) {
    // ?debug&jackplace: Marcel's jack fails and you place it; ?debug&jackplace=ai: your jack fails and the AI places it
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: params.get('jackplace') === 'ai' ? 0 : 1 });
  } else if (debug && params.has('aispot')) {
    // Real-time game where Marcel throws the jack first: screenshot while he shows his spot
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 1 });
  } else if (debug && params.has('mescenario')) {
    // F22: ?debug&play&mescenario=small|big|close[&mdir=-1]: a mène end with a fixed layout, to check the result card against the scoring view
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 0 });
    token++; pending = null; clearWorld();
    const jb = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb.z = jb.r; world.add(jb);
    const lay = { small: [[0, 0.11, 0.1], [1, -0.4, 0.3], [1, 0.5, -0.5], [0, -0.7, -0.4]],
      big: [[0, 0.1, 0.08], [0, -0.12, 0.12], [0, 0.02, -0.18], [0, 0.22, -0.1], [0, -0.26, -0.05], [1, 0.0, 0.62], [1, -0.7, -0.3]],
      far: [[0, 0.11, 0.1], [1, -0.4, 0.3], [1, 0.5, -0.5], [0, -0.7, -0.4], [0, 4, 3], [1, -5, -4], [0, 2, -6], [1, -3, 6]], // F82: scattered far-off boules must not shrink the view
      wide: [[0, 0.5, 0.3], [0, -0.9, 0.2], [1, 1.4, -0.6], [0, 0.3, -1.0]],
      close: [[0, 0.16, 0.0], [1, -0.16 - 0.007, 0], [0, 0.6, 0.5], [1, -0.5, -0.6]] }[params.get('mescenario')] || [];
    for (const [t, dx, dy] of lay) { const b = createBody('boule', { team: t, x: 2.3 + dx, y: 9.2 + dy }); b.z = b.r; world.add(b); }
    renderer.sync(world);
    match = { ...match, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: meneResult(jb, world.bodies.filter((b) => b.kind === 'boule')) };
    lastThrowerId = 'marcel';
    for (const id of cast.keys()) placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
    setPlaying(true);
    endOfMene('');
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
    if (params.has('deadjack')) { // &deadjack (with &ringcarry&slow): the jack went out beyond the side string; F97: someone carries it back to its pre-throw spot, the ring waits
      world.bodies.length = 0;
      const jd = createBody('jack', { team: -1, x: C.terrainW + 1.4, y: 8.4 }); jd.z = terrain.sample(jd.x, jd.y).h + jd.r; jd.dead = true; jd.ghost = true; world.add(jd);
      for (const [t, x, y] of [[0, 1.2, 6.6], [1, 3.2, 7.0]]) { const b = createBody('boule', { team: t, x, y }); b.z = b.r; world.add(b); }
      renderer.sync(world);
      match = { ...match, jack: { x: jd.x, y: jd.y, dead: true, spot: { x: 2.3, y: 9.2 }, replaced: true } };
      lastThrowerId = 'marcel';
      renderer.setCamera('head', { target: { x: 3.4, y: 8.8 }, points: [{ x: -0.5, y: 5 }, { x: C.terrainW + 2, y: 12 }] });
      startRingPickup(); startJackReturn();
      return;
    }
    if (params.has('f02')) { // &f02 (with &ringcarry&slow): the mène is over with twelve boules scattered; the players gather, then collect their own (&f02at=seconds freezes the frame)
      world.bodies.length = 0;
      const jb2 = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb2.z = jb2.r; world.add(jb2);
      const spots = [[1.6, 8.7], [3.0, 9.8], [2.0, 10.3], [3.3, 8.6], [1.2, 9.6], [2.7, 9.0], [3.4, 10.4], [1.5, 7.9], [2.4, 8.4]];
      if (params.has('f51')) spots[5] = [2.4, 9.3]; // &f51: a boule against the jack, in the ring's way
      let k = 0;
      for (const p of match.players) for (let n = 0; n < 3 && k < spots.length + 3; n++, k++) {
        const b = createBody('boule', { team: p.team, x: (spots[k] || [0, 0])[0], y: (spots[k] || [0, 0])[1] }); b.owner = p.id; b.z = b.r; world.add(b);
        if (!spots[k]) placeDeadBall(world, b, 0.2 + (k - spots.length) * 0.4, court.dir > 0 ? C.terrainL + 0.15 : -0.15);
      }
      renderer.sync(world);
      lastThrowerId = 'marcel';
      f02Script = true; fetchFreezeAt = +params.get('f02at') || 0;
      gather(null);
      startRingPickup();
      startCollect(+params.get('f02delay') || 600);
      if (params.has('f02skip')) later(() => skipCollect(), +params.get('f02skip') * 1000); // &f02skip=seconds: a click or key (F15)
      if (params.has('f02next')) later(() => nextMene(), +params.get('f02next') * 1000); // &f02next=seconds: the player continues (F15: the ring goes down, the jack thrower walks in)
      renderer.setCamera('head', { target: { x: 2.3, y: 9 }, points: [{ x: -1, y: 6 }, { x: 5.5, y: 12 }] });
      if (fetchFreezeAt) (async () => {
        for (let i = 0; i < fetchFreezeAt * 60; i++) { fetchPump = true; tickCast(1 / 60); fetchPump = false; renderer.sync(world); await null; await null; }
        frozen = true; renderer.sync(world);
      })();
      return;
    }
    if (params.has('f07')) { // &f07 (with &ringcarry&slow): Marcel stands in the circle after the last throw, picks the ring up and waits holding it by the jack
      const ch = cast.get('marcel'); inCircle = 'marcel'; shadow('marcel', true);
      placeAt('marcel', court.circle.x, court.circle.y, Math.PI); ch.setStance('watch');
      renderer.setCamera('head', { target: { x: 2.3, y: 7.5 }, points: [{ x: 1.5, y: 5 }, { x: 3, y: 9.6 }, { x: court.circle.x, y: court.circle.y }] });
      if (params.get('f07') === 'held') { // a still of the end state: Marcel 1 m from the jack on the circle's side, holding the ring
        const j = match.jack, dx = court.circle.x - j.x, dy = court.circle.y - j.y, d = Math.hypot(dx, dy);
        const sx = j.x + dx / d, sy = j.y + dy / d;
        ringCarry = 'marcel'; ch.setCarrying(true); placeAt('marcel', sx, sy, Math.atan2(j.x - sx, j.y - sy));
        renderer.setCamera('inspect', { target: { x: (j.x + sx) / 2, y: (j.y + sy) / 2 - 0.2 * court.dir }, dist: 3.2, az: baseYaw() + Math.PI * 0.8, el: 0.25, height: 0.9, reset: true, fit: 1.4 });
        return;
      }
      startRingPickup();
      return;
    }
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
  } else if (debug && (params.has('jackshot') || params.has('tvshot'))) { // ?debug&tvshot[&tvcam=a|b|c&jspeed=&freezeat=]: Pierre's boule toward the jack in quick mode (E27 camera checks)
    if (params.has('tvshot')) settings.mode = 'quick';
    // --- ?debug&jackshot[&jspeed=&jloft=&jyaw=&freezeat=0.6]: a boule shot hard into the jack, with the flight camera following ---
    clearWorld();
    hud.hideHint();
    const put = (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; world.add(b); return b; };
    put('jack', -1, debug && +params.get('jx') || 2.1, 8); // ?jx= moves the jack across the line of the shot (F123 widen check)
    put('boule', 1, 1.8, 8.2);
    put('boule', 1, 2.6, 7.7);
    renderer.sync(world);
    placePlayers('you');
    const bshot = debug && params.get('bshot'); // F01: ?bshot=prep|throw|reaction|head|flight[&who=pierre]: one broadcast shot (with &cam=broadcast)
    if (bshot === 'head') headView(jackBody());
    else if (bshot === 'reaction' || bshot === 'prep' || bshot === 'throw') {
      const who = SPECS[params.get('who')] ? params.get('who') : 'you';
      if (who !== 'you') { enterCircle(who, baseYaw(), true); }
      if (bshot === 'reaction') cast.get(who).setStance('celebrate');
      showShot({ kind: bshot, id: who, face: baseYaw() });
    } else launchBody('boule', 0, params.has('tvshot') ? 'pierre' : 'you', { yaw: +params.get('jyaw') || 0.0143, loft: +params.get('jloft') || 0.14, speed: +params.get('jspeed') || 9, backspin: 0, sidespin: 0 });
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

// Friendly message in the game area when the game cannot start: WebGL missing (F114: 'webgl'), or any other boot failure
function showFallback(err) {
  const webgl = classifyBootError(err) === 'webgl';
  const msg = err && err.message ? err.message : String(err);
  say(webgl ? 'Sorry, the game could not start: ' + msg : 'Something went wrong starting the game. Please reload the page.');
  if (!root) return;
  for (const el of root.querySelectorAll('canvas, .petanque-hud, .petanque-controls')) el.hidden = true;
  const box = document.createElement('div');
  box.className = 'petanque-fallback';
  const h = document.createElement('p');
  h.className = 'petanque-fallback-title';
  const p = document.createElement('p');
  if (webgl) {
    h.textContent = 'The pétanque court is closed for now';
    p.textContent = 'This game needs WebGL 3D graphics, and your browser or device could not start them. ' +
      'Try another browser or turn on hardware acceleration. In the meantime, ';
  } else {
    h.textContent = 'Something went wrong starting the game. Please reload the page.';
    p.textContent = 'In the meantime, ';
    const det = document.createElement('details'); // F114: the error text, for support
    det.className = 'petanque-fallback-details';
    const sum = document.createElement('summary');
    sum.textContent = 'Error details';
    const pre = document.createElement('pre');
    pre.textContent = msg;
    det.append(sum, pre);
    box.append(det);
  }
  const a = document.createElement('a');
  a.href = root.dataset.linksUrl || '/links/';
  a.textContent = 'read up on pétanque and find a real court on our Links page';
  p.append(a, '.');
  box.prepend(h, p);
  root.insertBefore(box, root.firstChild);
}

// F102: the hardware-WebGL requirement message, in the game area: what is needed, what was detected, how to fix it
function showGpuMessage(a) {
  const m = gpuMessage(a, browserName(navigator.userAgent));
  say(m.title + '. ' + m.lead);
  if (!root) return;
  for (const el of root.querySelectorAll('canvas, .petanque-hud, .petanque-controls')) el.hidden = true;
  const box = document.createElement('div');
  box.className = 'petanque-fallback petanque-gpu';
  const h = document.createElement('p');
  h.className = 'petanque-fallback-title';
  h.textContent = m.title;
  const lead = document.createElement('p');
  lead.textContent = m.lead;
  const det = document.createElement('p');
  det.className = 'petanque-gpu-detected';
  det.textContent = m.detected;
  const ul = document.createElement('ul');
  for (const t of m.howto) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
  const p = document.createElement('p');
  const link = document.createElement('a');
  link.href = root.dataset.linksUrl || '/links/';
  link.textContent = 'read up on pétanque and find a real court on our Links page';
  p.append('In the meantime, ', link, '.');
  box.append(h, lead, det, ul, p);
  root.insertBefore(box, root.firstChild);
}

try {
  boot();
} catch (err) {
  console.error(err); // F114: always logged, before the message is drawn
  showFallback(err);
}
