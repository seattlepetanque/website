// The 17 scenarios of GAME-PLAN 12.8 as fixed court states, shared by tactics.test.js and measure-ai.js.
// Coordinates: jack J = (2, 8), the thrower at the circle (2, 1); "ahead" means smaller y. A boule is given as an
// offset from J, `us` / `them` are relative to the thrower's team; `hand` lists boules left per player in team
// order (team 0: you, pierre; team 1: marcel, odette).
import { createWorld, createBody } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers } from '../../assets/js/petanque/rules.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';

export function flat() {
  return {
    sample: () => ({ h: 0, nx: 0, ny: 0, nz: 1, friction: 0.1, loose: 0.2 }),
    stonesNear: () => [], addDivot() {}, resetDivots() {}, visibleStones: () => [],
    perceived() { return this; },
  };
}

const TEAM_OF = { you: 0, pierre: 0, marcel: 1, odette: 1 };
const ORDER = { 0: ['you', 'pierre'], 1: ['marcel', 'odette'] };

// spec: { thrower, jack?, us: { hand: [a, b], boules: [[dx, dy], ...] }, them: {...}, score?: [us, them], target? }
export function build(spec, { seed = 1, difficulty } = {}) {
  const J = spec.jack || { x: 2, y: 8 };
  const world = createWorld(flat(), mulberry32(seed));
  const jack = world.add(createBody('jack', { x: J.x, y: J.y }));
  const team = TEAM_OF[spec.thrower], opp = 1 - team;
  const boules = [];
  for (const [side, t] of [['us', team], ['them', opp]]) {
    for (const [dx, dy] of (spec[side] && spec[side].boules) || []) boules.push(world.add(createBody('boule', { x: J.x + dx, y: J.y + dy, team: t })));
  }
  const players = defaultPlayers().map((p) => {
    const t = TEAM_OF[p.id], side = t === team ? 'us' : 'them';
    const i = ORDER[t].indexOf(p.id);
    return { ...p, isHuman: p.id === 'you' && !!spec.humanTeam, boulesLeft: spec[side].hand[i] };
  });
  const scores = [0, 0];
  if (spec.score) { scores[team] = spec.score[0]; scores[opp] = spec.score[1]; }
  const match = { ...createMatch({ players, target: spec.target || 13 }), phase: 'play', jack: { x: jack.x, y: jack.y }, boules, scores };
  const player = match.players.find((p) => p.id === spec.thrower);
  return { world, match, jack, player, team, boules, difficulty };
}

export const scenarios = [
  { id: 1, name: 'jack only, even hands', thrower: 'marcel', us: { hand: [2, 1] }, them: { hand: [2, 1] } },
  { id: 2, name: 'theirs 0.12 m from the jack, even hands', thrower: 'odette', us: { hand: [1, 2] }, them: { hand: [2, 1] }, them_boules: [[0.12, 0]] },
  { id: 3, name: 'theirs 0.15 m, we 1 left, they 3', thrower: 'odette', us: { hand: [0, 1] }, them: { hand: [2, 1] }, them_boules: [[0.15, 0]] },
  { id: 4, name: 'theirs 0.10 and 0.30, ours 0.9; we 3 left, they 1', thrower: 'odette', us: { hand: [1, 2], boules: [[0, 0.9]] }, them: { hand: [0, 1] }, them_boules: [[0.1, 0], [0, 0.3]] },
  { id: 5, name: 'theirs 0.20, ours 0.35 and 0.50; 2 v 2', thrower: 'odette', us: { hand: [1, 1], boules: [[-0.35, 0], [0.5, 0]] }, them: { hand: [1, 1] }, them_boules: [[0, 0.2]] },
  { id: 6, name: 'theirs 0.20 with our boule beside it, jack behind', thrower: 'odette', us: { hand: [1, 2], boules: [[0.12, -0.2]] }, them: { hand: [1, 2] }, them_boules: [[0, -0.2]] },
  { id: 7, name: 'they hold four points, all within 0.15 m; we 2 left, they 1', thrower: 'odette', us: { hand: [1, 1] }, them: { hand: [0, 1], boules: [] }, them_boules: [[0.06, 0], [-0.09, 0], [0, 0.12], [0, -0.15]] },
  { id: 8, name: 'theirs 0.10 and 0.25, our last boule, they 3 left', thrower: 'odette', us: { hand: [0, 1] }, them: { hand: [2, 1] }, them_boules: [[0.1, 0], [-0.25, 0]] },
  { id: 9, name: 'jack 0.5 m from the string, they hold 4 and have none left; we 3', thrower: 'odette', jack: { x: 3.5, y: 9.0 }, us: { hand: [1, 2] }, them: { hand: [0, 0] }, them_boules: [[0.06, 0], [-0.09, 0], [0, 0.12], [0, -0.15]] },
  { id: 10, name: 'score 5-11, they hold 2; we 2 left, they 1', thrower: 'odette', score: [5, 11], us: { hand: [1, 1] }, them: { hand: [0, 1] }, them_boules: [[0.15, 0], [-0.3, 0]] },
  { id: 11, name: 'score 11-4, we hold 2 and they have none; we 2 left', thrower: 'odette', score: [11, 4], us: { hand: [1, 1], boules: [[0.1, 0], [-0.3, 0]] }, them: { hand: [0, 0] } },
  { id: 12, name: 'jack 0.5 m from the string, theirs 0.30, ours 0.60; they have a tireur', thrower: 'odette', jack: { x: 3.5, y: 8 }, us: { hand: [1, 1], boules: [[0, 0.6]] }, them: { hand: [1, 1], boules: [] }, them_boules: [[0, -0.3]] },
  { id: 13, name: 'theirs 0.50 beside the jack, they have a pointeur, BA +1', thrower: 'pierre', us: { hand: [1, 2] }, them: { hand: [1, 1] }, them_boules: [[0.5, 0]] },
];
// them_boules is sugar for them.boules
for (const s of scenarios) { if (s.them_boules) { s.them = { ...s.them, boules: s.them_boules }; delete s.them_boules; } }

// 14, 15, 16: the human's team chooser
export const chooserScenarios = [
  { id: 14, name: 'court of 4, human team (you + Pierre)', thrower: 'you', humanTeam: true, us: { hand: [2, 1], boules: [[0, 0.9]] }, them: { hand: [0, 1], boules: [[0.1, 0], [0, 0.3]] } },
  { id: 15, name: 'jack only, human team', thrower: 'you', humanTeam: true, us: { hand: [2, 1] }, them: { hand: [2, 1] } },
  { id: 16, name: 'only Pierre has boules', thrower: 'pierre', humanTeam: true, us: { hand: [0, 2] }, them: { hand: [1, 1] } },
];
