// F111: the ?debug scenarios and the window.__petanque hook, moved verbatim out of main.js boot().
// main.js imports this module and calls it only under `if (debug)`, so a production build (debug is the literal false)
// drops all of it, strings included (scripts/check-prod-bundle.mjs checks that).
// ctx is built by main.js: read-only bindings are plain properties; the closure's mutable state (token, pending, match,
// lastThrowerId, f02Script, fetchFreezeAt, frozen, fetchPump, fetchJob, inCircle, ringCarry, pausedNow, aimYaw) goes
// through getters and setters on ctx.
import { C } from './constants.js';
import { court, baseYaw } from './court.js';
import { createBody, placeDeadBall, deadRowSlot } from './physics.js';
import { meneResult } from './rules.js';
import { settings } from './settings.js';
import { createCharacter } from './character.js';
import { attachModels } from './models.js';
import { PERSONALITIES, specFor } from './personalities.js';
import * as THREE from '../vendor/three.module.js';

const DEG = Math.PI / 180;

// A body at rest on the ground, added to the world (was redefined five times in the scenarios).
const putter = (world) => (kind, team, x, y) => { const b = createBody(kind, { team, x, y }); b.z = b.r; return world.add(b); };

// ?debug&floatplane=takeoff|landing[&fpat=seconds][&fpcam=0]: run it now, camera on it
export function debugFloatplane(ctx) {
  const { params, renderer } = ctx;
  if (debug && params.get('floatplane')) { // ?debug&floatplane=takeoff|landing[&fpat=seconds][&fpcam=0]: run it now, camera on it
    const fp = renderer.floatplane;
    fp.trigger(params.get('floatplane') === 'landing' ? 'landing' : 'takeoff', params.get('fpmirror') === '-1' ? -1 : 1);
    fp.debugFrame = params.get('fpcam') !== '0';
    if (params.has('fpat')) fp.advance(+params.get('fpat') || 0);
  }
}

// F86 pause/end/exit timers and the window.__petanque hook
export function debugHooks(ctx) {
  const { params, world, terrain, renderer, seed, toSetup, startGame, setPlaying, clock, pauseGame, endGame, cast, audio, launchBody, jackBody, readParams } = ctx;
  if (debug) { // F86: ?debug&pausegame=MS / &endgame=MS pause / end the game after MS of wall time (screenshots)
    if (params.has('pausegame')) setTimeout(() => pauseGame(), +params.get('pausegame') || 0);
    if (params.has('endgame')) setTimeout(() => endGame(), +params.get('endgame') || 0);
    if (params.has('exitclick')) { const t0 = Date.now(), iv = setInterval(() => { const b = document.querySelector('.pt-exit'); if (b && Date.now() - t0 > (+params.get('exitclick') || 0)) { clearInterval(iv); b.click(); } }, 200); } // F93: ?debug&exitclick=MS presses Exit once the game-over card is up (and MS have passed)
    if (params.has('hidesim')) { // F106: ?debug&hidesim=AT:FOR goes hidden AT ms after load for FOR ms; logs the game clock and world time around it
      const [at, dur] = params.get('hidesim').split(':').map(Number);
      const snap = () => `clock=${clock.now().toFixed(0)} world=${world.t.toFixed(3)} now=${performance.now().toFixed(0)}`;
      setTimeout(() => { console.warn('[hidesim] hide', snap()); ctx.visSet(true); setTimeout(() => { console.warn('[hidesim] show', snap()); ctx.visSet(false); setTimeout(() => console.warn('[hidesim] after', snap()), 500); }, dur); }, at);
    }
    window.__petanque = {
      world, terrain, renderer, seed, reset: toSetup, startGame, court,
      audio,
      settings, setPlaying, clock, pauseGame, endGame,
      get paused() { return ctx.pausedNow; },
      get quality() { return ctx.level; },
      get pending() { return ctx.pending; },
      cast,
      get aimYaw() { return ctx.aimYaw; },
      get match() { return ctx.match; },
      throw: (p) => launchBody(jackBody() && !jackBody().dead ? 'boule' : 'jack', 0, 'you', { ...readParams(), ...p }),
      throwJack: (p) => launchBody('jack', -1, null, { ...readParams(), ...p }),
    };
  }
}

// The scenarios. Returns false when no scenario applies (main.js then shows the setup screen).
export function runDebugScenario(ctx) {
  const { params, world, terrain, renderer, hud, cast, SPECS, BOULE_COLORS, useMeshes, modelTimeout, pickHuman, freezeAt,
    setPlaying, startGame, nextMene, endOfMene, clearWorld, placeAt, placePlayers, homeAt, homeYaw, enterCircle, headView, showBetween, showShot,
    launchBody, jackBody, shadow, gather, later, skipCollect, startCollect, startRingPickup, startJackReturn, tickCast,
    runFetch, pickUp, putDown, handOver, placeWalk, walkHome, rowCount } = ctx;
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
    ctx.token++; ctx.pending = null; clearWorld();
    const jb = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb.z = jb.r; world.add(jb);
    const lay = { small: [[0, 0.11, 0.1], [1, -0.4, 0.3], [1, 0.5, -0.5], [0, -0.7, -0.4]],
      big: [[0, 0.1, 0.08], [0, -0.12, 0.12], [0, 0.02, -0.18], [0, 0.22, -0.1], [0, -0.26, -0.05], [1, 0.0, 0.62], [1, -0.7, -0.3]],
      far: [[0, 0.11, 0.1], [1, -0.4, 0.3], [1, 0.5, -0.5], [0, -0.7, -0.4], [0, 4, 3], [1, -5, -4], [0, 2, -6], [1, -3, 6]], // F82: scattered far-off boules must not shrink the view
      wide: [[0, 0.5, 0.3], [0, -0.9, 0.2], [1, 1.4, -0.6], [0, 0.3, -1.0]],
      close: [[0, 0.16, 0.0], [1, -0.16 - 0.007, 0], [0, 0.6, 0.5], [1, -0.5, -0.6]] }[params.get('mescenario')] || [];
    for (const [t, dx, dy] of lay) { const b = createBody('boule', { team: t, x: 2.3 + dx, y: 9.2 + dy }); b.z = b.r; world.add(b); }
    renderer.sync(world);
    ctx.match = { ...ctx.match, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: meneResult(jb, world.bodies.filter((b) => b.kind === 'boule')) };
    ctx.lastThrowerId = 'marcel';
    for (const id of cast.keys()) placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
    setPlaying(true);
    endOfMene('');
  } else if (debug && params.has('mene2')) {
    // ?debug&mene2[&ringcarry][&timerframes]: the first mène is over (jack at 2.3, 9.2, so the ring is carried back to 11 m) and the second begins: quick mode shows
    // the human's jack turn toward y = 0; &ringcarry (slow mode) shows the last thrower carrying the ring there
    settings.setModeInMemory(params.has('ringcarry') ? 'slow' : 'quick'); // F111: not saved
    startGame({ target: 7, difficulty: 'medium', firstJackTeam: 0 });
    ctx.token++; ctx.pending = null; clearWorld();
    const jb = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb.z = jb.r; world.add(jb);
    for (const [t, x, y] of [[0, 2.0, 9.0], [1, 2.6, 9.4]]) { const b = createBody('boule', { team: t, x, y }); b.z = b.r; world.add(b); }
    renderer.sync(world);
    ctx.match = { ...ctx.match, phase: 'meneEnd', jack: { x: 2.3, y: 9.2 }, boules: [], result: { void: true } };
    ctx.lastThrowerId = 'marcel';
    for (const id of cast.keys()) placeAt(id, homeAt(id).x, homeAt(id).y, homeYaw(id));
    setPlaying(true);
    if (params.has('deadjack')) { // &deadjack (with &ringcarry&slow): the jack went out beyond the side string; F97: someone carries it back to its pre-throw spot, the ring waits
      world.bodies.length = 0;
      const jd = createBody('jack', { team: -1, x: C.terrainW + 1.4, y: 8.4 }); jd.z = terrain.sample(jd.x, jd.y).h + jd.r; jd.dead = true; jd.ghost = true; world.add(jd);
      for (const [t, x, y] of [[0, 1.2, 6.6], [1, 3.2, 7.0]]) { const b = createBody('boule', { team: t, x, y }); b.z = b.r; world.add(b); }
      renderer.sync(world);
      ctx.match = { ...ctx.match, jack: { x: jd.x, y: jd.y, dead: true, spot: { x: 2.3, y: 9.2 }, replaced: true } };
      ctx.lastThrowerId = 'marcel';
      renderer.setCamera('head', { target: { x: 3.4, y: 8.8 }, points: [{ x: -0.5, y: 5 }, { x: C.terrainW + 2, y: 12 }] });
      startRingPickup(); startJackReturn();
      return true;
    }
    if (params.has('f02')) { // &f02 (with &ringcarry&slow): the mène is over with twelve boules scattered; the players gather, then collect their own (&f02at=seconds freezes the frame)
      world.bodies.length = 0;
      const jb2 = createBody('jack', { team: -1, x: 2.3, y: 9.2 }); jb2.z = jb2.r; world.add(jb2);
      const spots = [[1.6, 8.7], [3.0, 9.8], [2.0, 10.3], [3.3, 8.6], [1.2, 9.6], [2.7, 9.0], [3.4, 10.4], [1.5, 7.9], [2.4, 8.4]];
      if (params.has('f51')) spots[5] = [2.4, 9.3]; // &f51: a boule against the jack, in the ring's way
      let k = 0;
      for (const p of ctx.match.players) for (let n = 0; n < 3 && k < spots.length + 3; n++, k++) {
        const b = createBody('boule', { team: p.team, x: (spots[k] || [0, 0])[0], y: (spots[k] || [0, 0])[1] }); b.owner = p.id; b.z = b.r; world.add(b);
        if (!spots[k]) placeDeadBall(world, b, 0.2 + (k - spots.length) * 0.4, court.dir > 0 ? C.terrainL + 0.15 : -0.15);
      }
      renderer.sync(world);
      ctx.lastThrowerId = 'marcel';
      ctx.f02Script = true; ctx.fetchFreezeAt = +params.get('f02at') || 0;
      gather(null);
      startRingPickup();
      later(() => startCollect(), +params.get('f02delay') || 600); // F111: the argument used to be ignored (the collection started at once)
      if (params.has('f02skip')) later(() => skipCollect(), +params.get('f02skip') * 1000); // &f02skip=seconds: a click or key (F15)
      if (params.has('f02next')) later(() => nextMene(), +params.get('f02next') * 1000); // &f02next=seconds: the player continues (F15: the ring goes down, the jack thrower walks in)
      renderer.setCamera('head', { target: { x: 2.3, y: 9 }, points: [{ x: -1, y: 6 }, { x: 5.5, y: 12 }] });
      if (ctx.fetchFreezeAt) (async () => {
        for (let i = 0; i < ctx.fetchFreezeAt * 60; i++) { ctx.fetchPump = true; tickCast(1 / 60); ctx.fetchPump = false; renderer.sync(world); await null; await null; }
        ctx.frozen = true; renderer.sync(world);
      })();
      return true;
    }
    if (params.has('f07')) { // &f07 (with &ringcarry&slow): Marcel stands in the circle after the last throw, picks the ring up and waits holding it by the jack
      const ch = cast.get('marcel'); ctx.inCircle = 'marcel'; shadow('marcel', true);
      placeAt('marcel', court.circle.x, court.circle.y, Math.PI); ch.setStance('watch');
      renderer.setCamera('head', { target: { x: 2.3, y: 7.5 }, points: [{ x: 1.5, y: 5 }, { x: 3, y: 9.6 }, { x: court.circle.x, y: court.circle.y }] });
      if (params.get('f07') === 'held') { // a still of the end state: Marcel 1 m from the jack on the circle's side, holding the ring
        const j = ctx.match.jack, dx = court.circle.x - j.x, dy = court.circle.y - j.y, d = Math.hypot(dx, dy);
        const sx = j.x + dx / d, sy = j.y + dy / d;
        ctx.ringCarry = 'marcel'; ch.setCarrying(true); placeAt('marcel', sx, sy, Math.atan2(j.x - sx, j.y - sy));
        renderer.setCamera('inspect', { target: { x: (j.x + sx) / 2, y: (j.y + sy) / 2 - 0.2 * court.dir }, dist: 3.2, az: baseYaw() + Math.PI * 0.8, el: 0.25, height: 0.9, reset: true, fit: 1.4 });
        return true;
      }
      startRingPickup();
      return true;
    }
    if (params.has('ringheld')) { // &ringheld: a still of Marcel carrying the ring back toward the corrected spot (slow mode)
      const ch = cast.get('marcel'); ctx.ringCarry = 'marcel'; ch.setCarrying(true); shadow('marcel', true);
      placeAt('marcel', 2.2, 5.5, Math.PI); ch.setStance('watch');
      renderer.setCamera('head', { target: { x: 2.3, y: 7.5 }, points: [{ x: 1.5, y: 5 }, { x: 3, y: 9.6 }, { x: 2.2, y: 11.2 }] });
      return true;
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
    const put = putter(world);
    put('jack', -1, 2.1, 8.45);
    put('boule', 0, 1.9, 8.3); put('boule', 0, 2.5, 8.9);
    put('boule', 1, 2.28, 8.62); put('boule', 1, 1.6, 7.9);
    renderer.sync(world);
    placePlayers('you');
    headView(jackBody());
    showBetween();
  } else if (debug && (params.has('jackshot') || params.has('tvshot'))) { // ?debug&tvshot[&tvcam=a|b|c&jspeed=&freezeat=]: Pierre's boule toward the jack in quick mode (E27 camera checks)
    if (params.has('tvshot')) settings.setModeInMemory('quick'); // F111: not saved
    // --- ?debug&jackshot[&jspeed=&jloft=&jyaw=&freezeat=0.6]: a boule shot hard into the jack, with the flight camera following ---
    clearWorld();
    hud.hideHint();
    const put = putter(world);
    put('jack', -1, 2.1, 8);
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
    const put = putter(world);
    put('boule', 0, 1.9, 8.3);
    put('boule', 1, 2.3, 8.6);
    // &fetchin: the dead boule lies inside the strings instead (E02: it is walked off the court)
    const deadBoule = params.has('fetchin') ? placeDeadBall(world, put('boule', 1, 0, 0), 1.2, 5.2)
      : placeDeadBall(world, put('boule', 1, 0, 0), C.terrainW + C.lumberGap + C.lumberSize + 0.5, 9.2);
    const deadJack = placeDeadBall(world, put('jack', -1, 0, 0), 2.6, C.terrainL + C.lumberGap + C.lumberSize + 0.8);
    renderer.sync(world);
    placePlayers('you');
    ctx.fetchFreezeAt = +params.get('fetchat') || 0;
    if (params.has('dist')) renderer.setCamera('inspect', { target: { x: +params.get('lx') || 4, y: +params.get('ly') || 9 }, dist: +params.get('dist'), az: +params.get('az') || 1.2, el: +params.get('el') || 0.3 });
    else renderer.setCamera('head', { target: { x: 2, y: 8 }, points: [{ x: -1.5, y: -0.5 }, { x: 6.5, y: 16.5 }] });
    if (ctx.fetchFreezeAt) (async () => {
      for (let i = 0; i < ctx.fetchFreezeAt * 60; i++) {
        ctx.fetchPump = true; tickCast(1 / 60); ctx.fetchPump = false; await null; await null;
      }
      ctx.frozen = true;
      if (params.has('followc')) { // &followc=pierre: close camera on that character (with &dist &az &el)
        const q = cast.get(params.get('followc')).root.position;
        renderer.setCamera('inspect', { target: { x: q.x, y: q.y }, dist: +params.get('dist') || 3.2, az: +params.get('az') || 0.6, el: +params.get('el') || 0.2, height: 0.6, reset: true });
      }
      renderer.sync(world);
    })();
    if (params.has('e02')) { // ?debug&fetch&e02: Pierre (or &who=) retrieves the dead boule like the game does, then goes to a waiting slot
      runFetch(params.get('who') || 'pierre', true).catch((err) => console.error(err));
    } else (async () => {
      const job = { id: 'pierre', tok: ctx.token, cancelled: false, scripted: true };
      ctx.fetchJob = job;
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
    const put = putter(world);
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
    const put = putter(world);
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
    return false;
  }
  return true;
}
