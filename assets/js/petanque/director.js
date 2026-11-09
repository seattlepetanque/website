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

// F38: when to cut to a flying floatplane. At most once per flight (and only for some flights), a few seconds long, in slow mode
// with reduced motion off, and only while the human is not busy (main.js decides `eligible`: not their aim, throw, walk or any
// boule in flight). It ends early when that stops being true, the plane fades out, or the player clicks (skip()).
export const PLANE_CUT = Object.freeze({
  chance: 0.7, // of flights that get a shot at all
  // plane time window (s) the shot starts in, per flight kind: the takeoff run and lift-off, the approach and touch-down
  takeoff: { from: [7, 13], until: 26 },
  landing: { from: [5, 10], until: 22 },
  hold: [4.5, 7], // s of the shot
});

// update(dt-free): ctx = { flight (id of the running flight, 0 for none), kind, t (plane seconds, frozen while paused), visible,
// allowed (slow mode, no reduced motion), eligible }. Returns 'cut', 'end' or null. skip() ends a running shot (true if one was).
export function createPlaneCuts({ rand = Math.random } = {}) {
  let id = 0, state = 'idle', startAt = 0, endAt = 0, hold = 0, t0 = 0;
  return {
    get on() { return state === 'on'; },
    skip() { if (state !== 'on') return false; state = 'done'; return true; },
    update(ctx) {
      let out = null;
      if (ctx.flight !== id) { // a new flight (or none): plan it afresh
        if (state === 'on') out = 'end';
        id = ctx.flight;
        state = 'idle';
        if (id) {
          const cfg = PLANE_CUT[ctx.kind];
          if (cfg && rand() < PLANE_CUT.chance) {
            state = 'wait'; startAt = cfg.from[0] + rand() * (cfg.from[1] - cfg.from[0]); endAt = cfg.until;
            hold = PLANE_CUT.hold[0] + rand() * (PLANE_CUT.hold[1] - PLANE_CUT.hold[0]);
          } else state = 'done';
        }
        if (out) return out;
      }
      if (state === 'on') {
        if (!ctx.allowed || !ctx.eligible || !ctx.visible || ctx.t - t0 >= hold) { state = 'done'; return 'end'; }
      } else if (state === 'wait') {
        if (ctx.t > endAt) state = 'done';
        else if (ctx.allowed && ctx.eligible && ctx.visible && ctx.t >= startAt) { state = 'on'; t0 = ctx.t; return 'cut'; }
      }
      return null;
    },
  };
}
