// F01: the sports-broadcast director. It schedules shots for each throw on the game clock (main.js passes `later`, which a pause
// freezes) and asks `show(shot)` to cut to them; camera.js (`frameBroadcast`) frames each one and moves smoothly inside it.
//   prep      the player in the circle getting ready (waist-up to full body, a slow push-in)
//   throw     a fuller shot held through the swing and release (AI throws; the human's aim keeps the shoulder view)
//   flight    cut to the cochonnet, panning to bring the boule into view as it lands and rolls
//   head      hover 1 to 2 s on the boule and jack once it stops
//   reaction  cut to the thrower, a partner or an opponent, chosen by the outcome
// Reduced motion means fewer cuts: no separate throw shot and no reaction cut.

export const DIRECTOR = Object.freeze({
  hoverMin: 1000, hoverMax: 2000, // ms on the head after the boule stops
  reactionHold: 1500, // ms on the reaction before the next turn
  baseDelay: 1800, // ms from the stop to the next turn when there is no reaction
});

// Who reacts, by outcome. mood: 'celebrate' | 'dismay' | 'watch' (react() in main.js); prevHold: the team that held the point before this
// throw (null for none); players: [{ id, team }]; pick in [0, 1) varies the choice. Returns { id, role, mood } or null (no reaction cut).
// - a good point (first boule near, tie broken): the thrower or a partner celebrates
// - a point taken from the other side: the thrower celebrates or an opponent shows dismay
// - a miss: the thrower
export function reactionChoice({ mood, was, prevHold, players, pick = 0 }) {
  if (!was || mood === 'watch') return null;
  const owner = players.find((p) => p.id === was.owner);
  if (!owner) return null;
  if (mood === 'dismay') return { id: owner.id, role: 'thrower', mood };
  const mates = players.filter((p) => p.team === owner.team && p.id !== owner.id);
  const foes = players.filter((p) => p.team !== owner.team);
  const taken = prevHold !== null && prevHold !== undefined && prevHold !== was.team;
  if (taken && foes.length && pick < 0.5) return { id: foes[Math.floor(pick * 2 * foes.length) % foes.length].id, role: 'opponent', mood: 'dismay' };
  if (mates.length && pick >= 0.5) return { id: mates[Math.floor((pick - 0.5) * 2 * mates.length) % mates.length].id, role: 'partner', mood };
  return { id: owner.id, role: 'thrower', mood };
}

// ms to hover on the head, 1 to 2 s
export const hoverMs = (pick = 0.5) => Math.round(DIRECTOR.hoverMin + (DIRECTOR.hoverMax - DIRECTOR.hoverMin) * Math.max(0, Math.min(1, pick)));

// What follows the stop: { hover, reaction (a choice or null), nextTurn (ms from the stop) }. Reduced motion: no reaction cut.
export function afterStop({ reduced, pick = 0.5, ...outcome }) {
  const hover = hoverMs(pick), reaction = reduced ? null : reactionChoice({ ...outcome, pick });
  return { hover, reaction, nextTurn: reaction ? hover + DIRECTOR.reactionHold : DIRECTOR.baseDelay };
}

// later(fn, ms): the game clock. show(shot): cut to { kind, id?, body? }. reduced(): prefers-reduced-motion.
export function createDirector({ later, show, reduced = () => false }) {
  let epoch = 0, turns = 0;
  const guard = (fn) => { const e = epoch; return () => { if (e === epoch) fn(); }; };
  return {
    cancel() { epoch++; },
    prep(id, face) { epoch++; show({ kind: 'prep', id, face }); },
    throwShot(id, face) { if (!reduced()) show({ kind: 'throw', id, face }); },
    release(body) { epoch++; show({ kind: 'flight', body }); },
    // outcome: { mood, was, prevHold, players }; returns the ms from the stop to the next turn. The head cut is main's (headView).
    afterStop(outcome) {
      epoch++;
      const pick = (turns++ * 0.6180339887) % 1;
      const plan = afterStop({ reduced: reduced(), pick, ...outcome });
      if (plan.reaction) later(guard(() => show({ kind: 'reaction', id: plan.reaction.id, role: plan.reaction.role })), plan.hover);
      return plan.nextTurn;
    },
  };
}

// F38 (reworked again): the plane camera STAYS on for as long as the plane flies and is visible (opacity > 0.5) and it is not the human's
// turn (`busy`: from the human's turn start until their boule has landed, see main.js humanBusy), across consecutive AI turns, walks,
// throws and results. It starts at the first quiet moment (`eligible`) and ends only when busy begins, the plane fades or the flight ends,
// `allowed` goes false (quick mode, reduced motion, pause, game over, outcome view: main.js folds those into busy/allowed) or skip().
// After a busy/fade end it may start again at the next quiet moment (gap seconds later); a click (skip) ends it for the flight.
// The solver-no-fit hold (1.5 s) and the blend limits live in render.js (PSHOT.holdMiss, PSHOT.reentry).
export const PLANE_CUT = Object.freeze({
  gap: 3, // s of plane time before a shot may start again after it ended (at most one blend per 3 s)
});

// update: ctx = { flight (id of the running flight, 0 for none), kind, t (plane seconds, frozen while paused), visible, allowed (slow
// mode, no reduced motion), eligible (a quiet moment to start), busy (the human is busy: end a running shot) }.
// Returns 'cut', 'end' or null. skip() ends a running shot (true if one was).
export function createPlaneCuts() {
  let id = 0, state = 'idle', tEnd = -Infinity;
  return {
    get on() { return state === 'on'; },
    skip() { if (state !== 'on') return false; state = 'done'; return true; },
    update(ctx) {
      if (ctx.flight !== id) { // a new flight (or none): plan it afresh
        const was = state === 'on';
        id = ctx.flight; state = id ? 'wait' : 'idle'; tEnd = -Infinity;
        if (was) return 'end';
      }
      if (state === 'on') {
        if (!ctx.allowed || ctx.busy || !ctx.visible) { tEnd = ctx.t; state = 'wait'; return 'end'; }
      } else if (state === 'wait') {
        if (ctx.allowed && !ctx.busy && ctx.eligible && ctx.visible && ctx.t - tEnd >= PLANE_CUT.gap) { state = 'on'; return 'cut'; }
      }
      return null;
    },
  };
}
