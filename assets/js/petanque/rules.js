// Pétanque rules and scoring (doublette). Pure data logic: no DOM, no physics.
// Jack: { x, y, dead }. Boules: { id, team, owner, x, y, dead }. Metres, 2D distances.
import { nextCircle } from './court.js';

export const DEFAULT_GEOMETRY = Object.freeze({
  circle: Object.freeze({ x: 2, y: 1 }),
  dir: 1, // E10: +1 plays toward y = length, -1 toward y = 0; moves with the circle each mène
  width: 4,
  length: 15,
  jackMin: 6,
  jackMax: 10,
});

const TIE_EPS = 0.001; // equidistant within 1 mm
const BOULES_PER_PLAYER = 3;
const EPS = 1e-9;

export function defaultPlayers() {
  const mk = (id, name, team, isHuman, role) =>
    ({ id, name, team, isHuman, boulesLeft: BOULES_PER_PLAYER, role });
  return [
    mk('you', 'You', 0, true, 'pointeur'),
    mk('pierre', 'Pierre', 0, false, 'tireur'),
    mk('marcel', 'Marcel', 1, false, 'pointeur'),
    mk('odette', 'Odette', 1, false, 'tireur'),
  ];
}

export function createMatch({ target = 13, players, geometry, firstJackTeam = 0 } = {}) {
  return {
    target,
    geometry: { ...DEFAULT_GEOMETRY, ...(geometry || {}) },
    players: (players || defaultPlayers()).map((p) => ({ ...p, boulesLeft: p.boulesLeft ?? BOULES_PER_PLAYER })),
    scores: [0, 0],
    mene: 1,
    jackTeam: firstJackTeam, // team that throws (or must throw) the jack
    lastThrower: null, // team of the last boule thrown this mène
    inFlight: null, // playerId whose boule is being simulated
    phase: 'jack', // 'jack' | 'jackPlace' | 'play' | 'meneEnd' | 'gameOver'
    placingTeam: null, // team that places the jack by hand after an invalid throw (phase 'jackPlace')
    jack: null,
    boules: [],
    result: null, // last mène result: { team, points, void, ... }
    winner: null,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// E20: the cochonnet is judged like a boule at the side strings (in while any part is inside: out only when the
// whole jack is past a string) and must be more than 0.5 m before the end string. 6-10 m from the circle centre.
// The end string is the far one in the playing direction: geometry.dir (+1 toward y = length, the default; -1 toward
// y = 0), ready for E10's flipping direction. One rule for a thrown and a placed jack.
export const JACK_R = 0.015;
export const JACK_END_MARGIN = 0.5;
// F06: every displayed distance is surface to surface. gapM: metres from a's edge to b's edge (negative = touching or overlapping).
// fmtCm: one decimal, "18.3 cm" (metres from 1 m up, "1.8 m").
export const gapM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - (a.r ?? 0) - (b.r ?? 0);
export function fmtCm(m) {
  const v = Math.max(0, m);
  return v < 1 ? `${(v * 100).toFixed(1)} cm` : `${v.toFixed(1)} m`;
}
const endGap = (jack, g) => ((g.dir ?? 1) < 0 ? jack.y : g.length - jack.y); // distance in front of the end string
export function jackValid(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (!jack || jack.dead) return false;
  const d = dist(jack, g.circle);
  if (d < g.jackMin - EPS || d > g.jackMax + EPS) return false;
  return jack.x >= -JACK_R - EPS && jack.x <= g.width + JACK_R + EPS && endGap(jack, g) > JACK_END_MARGIN;
}
export const jackPlaceValid = jackValid;

export function playersWithBoules(match, team) {
  return match.players.filter((p) => p.team === team && p.boulesLeft > 0);
}

export function boulesInHand(match, team) {
  return match.players.filter((p) => p.team === team).reduce((n, p) => n + p.boulesLeft, 0);
}

// Live boules sorted by distance to the jack: [{ id, team, dist }]
function measure(jack, boules) {
  return boules
    .filter((b) => !b.dead)
    .map((b) => ({ id: b.id, team: b.team, dist: dist(b, jack) }))
    .sort((a, b) => a.dist - b.dist);
}

// Team holding the point: 0 | 1 | null (no live boules) | 'tie'
export function holdingTeam(jack, boules) {
  if (!jack || jack.dead) return null;
  const m = measure(jack, boules);
  if (!m.length) return null;
  const other = m.find((b) => b.team !== m[0].team);
  if (other && other.dist - m[0].dist <= TIE_EPS) return 'tie';
  return m[0].team;
}

// Final mène score from the ground: closest team scores boules closer than the other's best.
export function meneResult(jack, boules) {
  if (!jack || jack.dead) return { void: true };
  const measured = measure(jack, boules);
  if (!measured.length) return { void: true };
  const win = measured[0];
  const other = measured.find((b) => b.team !== win.team);
  if (other && other.dist - win.dist <= TIE_EPS) return { void: true };
  const limit = other ? other.dist : Infinity;
  const points = measured.filter((b) => b.team === win.team && b.dist < limit).length;
  return { team: win.team, points, measured: measured.map(({ id, dist }) => ({ id, dist })) };
}

// Why a jack is not legal: { reason: 'out'|'short'|'far'|'line'|'end', dist } or null when it is valid.
// 'line': whole jack past a side string (side 'left'|'right', gap = how far past the string, m);
// 'end': centre within 0.5 m of the end string (gap = distance to it, margin = 0.5);
// 'out': dead (went over a line during the roll); back = it now lies in a legal spot.
export function jackFault(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (jackValid(jack, g)) return null;
  if (!jack || jack.dead) {
    const back = !!jack && jackValid({ x: jack.x, y: jack.y }, g);
    return { reason: 'out', dist: jack ? dist(jack, g.circle) : 0, ...(back ? { back } : {}) };
  }
  const d = dist(jack, g.circle);
  if (d < g.jackMin - EPS) return { reason: 'short', dist: d };
  if (d > g.jackMax + EPS) return { reason: 'far', dist: d };
  if (jack.x < -JACK_R) return { reason: 'line', dist: d, side: 'left', gap: -jack.x - JACK_R };
  if (jack.x > g.width + JACK_R) return { reason: 'line', dist: d, side: 'right', gap: jack.x - g.width - JACK_R };
  return { reason: 'end', dist: d, gap: endGap(jack, g), margin: JACK_END_MARGIN };
}
export const jackPlaceFault = jackFault;

// Which team throws next: 0 | 1, or null when not in play or nobody has boules.
export function nextTeam(match) {
  if (match.phase !== 'play') return null;
  const in0 = boulesInHand(match, 0) > 0;
  const in1 = boulesInHand(match, 1) > 0;
  if (!in0 && !in1) return null;
  if (in0 !== in1) return in0 ? 0 : 1; // only one team has boules left
  const last = match.lastThrower ?? match.jackTeam;
  const live = [0, 1].map((t) => match.boules.some((b) => !b.dead && b.team === t));
  if (!live[0] && !live[1]) return last;
  if (live[0] !== live[1]) return live[0] ? 1 : 0; // team without a boule on the ground
  const hold = holdingTeam(match.jack, match.boules);
  if (hold === 'tie' || hold === null) return last;
  return 1 - hold;
}

// The sentence for a dead cochonnet, from the boules in hand [team0, team1] when it went dead.
// Both teams holding boules or neither: void. Only one team: that team scores them.
export function deadJackText(inHand, teamNames = ['You & Pierre', 'Marcel & Odette']) {
  const [h0, h1] = inHand;
  if (h0 > 0 && h1 > 0) return 'The cochonnet went out: both teams still have boules, so the mène is void.';
  if (h0 === 0 && h1 === 0) return 'The cochonnet went out and neither team has boules left, so the mène is void.';
  const team = h0 > 0 ? 0 : 1;
  return `The cochonnet went out with only ${teamNames[team]} holding boules: they score ${inHand[team]}.`;
}

function endMene(match, jack, boules) {
  let result;
  if (jack.dead) {
    // Dead jack: void if both teams still hold boules, else the team with boules scores them.
    // inHand is the count at the moment the jack died (kept on the result for the message, deadJackText).
    const h0 = boulesInHand(match, 0);
    const h1 = boulesInHand(match, 1);
    const inHand = [h0, h1];
    if (h0 > 0 && h1 > 0) result = { void: true, inHand };
    else if (h0 > 0) result = { team: 0, points: h0, measured: [], inHand };
    else if (h1 > 0) result = { team: 1, points: h1, measured: [], inHand };
    else result = { void: true, inHand };
  } else {
    result = meneResult(jack, boules);
  }
  const scores = match.scores.slice();
  // F31: a team's score never exceeds the target (12 + 3 is stored and shown as 13).
  if (!result.void) scores[result.team] = Math.min(match.target, scores[result.team] + result.points);
  const over = scores.findIndex((s) => s >= match.target) >= 0;
  const winner = over ? (scores[0] >= scores[1] ? 0 : 1) : null;
  return { ...match, jack, boules, scores, result, inFlight: null,
    phase: over ? 'gameOver' : 'meneEnd', winner };
}

// E15: only one team has boules left and the points already on the ground take it to the target.
function clinchedOnGround(match, jack, boules) {
  const h = [boulesInHand(match, 0), boulesInHand(match, 1)];
  if ((h[0] > 0) === (h[1] > 0)) return false;
  const team = h[0] > 0 ? 0 : 1;
  const r = meneResult(jack, boules);
  return !r.void && r.team === team && match.scores[team] + r.points >= match.target;
}

// Reducer: returns a new match, never mutates the input.
export function apply(match, event) {
  switch (event.type) {
    case 'jackThrown': {
      if (match.phase !== 'jack') return match;
      const jack = { x: event.jack.x, y: event.jack.y, dead: !!event.jack.dead };
      if (jack.dead && event.jack.spot) jack.spot = { x: event.jack.spot.x, y: event.jack.spot.y }; // F10: last in-bounds spot
      if (!jackValid(jack, match.geometry)) {
        // Invalid: the other team places the jack by hand; the thrower's team still plays first.
        return { ...match, phase: 'jackPlace', jackTeam: event.team, placingTeam: 1 - event.team, jack: null };
      }
      return { ...match, phase: 'play', jackTeam: event.team, placingTeam: null, jack, boules: [], lastThrower: null };
    }
    case 'jackPlaceSettled': {
      // E04: the jack has come to rest. A valid resting place starts play; otherwise a yellow card and the same team places again.
      if (match.phase !== 'jackPlace' || event.team !== match.placingTeam) return match;
      const jack = { x: event.jack.x, y: event.jack.y, dead: !!event.jack.dead };
      if (!jackPlaceValid(jack, match.geometry)) return { ...match, yellowCards: (match.yellowCards || 0) + 1 };
      return { ...match, phase: 'play', placingTeam: null, jack, boules: [], lastThrower: null, yellowCards: 0 };
    }
    case 'bouleThrown': {
      if (match.phase !== 'play') return match;
      const p = match.players.find((q) => q.id === event.playerId);
      if (!p || p.boulesLeft <= 0) return match;
      return {
        ...match,
        players: match.players.map((q) => (q === p ? { ...q, boulesLeft: q.boulesLeft - 1 } : q)),
        lastThrower: p.team,
        inFlight: p.id,
      };
    }
    case 'throwSettled': {
      if (match.phase !== 'play') return match;
      const jack = { x: event.jack.x, y: event.jack.y, dead: !!event.jack.dead };
      const boules = event.boules.map((b) => ({ ...b }));
      const none = boulesInHand(match, 0) + boulesInHand(match, 1) === 0;
      if (jack.dead || none) return endMene(match, jack, boules);
      if (clinchedOnGround(match, jack, boules)) return endMene(match, jack, boules);
      return { ...match, jack, boules, inFlight: null };
    }
    case 'nextMene': {
      if (match.phase !== 'meneEnd') return match;
      const r = match.result;
      const g = match.geometry; // E10: the next mène starts from a circle around the last jack, played the other way
      const nc = nextCircle(match.jack && match.jack.dead && match.jack.spot ? match.jack.spot : match.jack, g.dir ?? 1, { width: g.width, length: g.length });
      return {
        ...match,
        geometry: { ...g, circle: { x: nc.circle.x, y: nc.circle.y }, dir: nc.dir },
        players: match.players.map((p) => ({ ...p, boulesLeft: BOULES_PER_PLAYER })),
        mene: match.mene + 1,
        jackTeam: r && !r.void ? r.team : match.jackTeam, // winner throws; void keeps the same team
        lastThrower: null,
        inFlight: null,
        phase: 'jack',
        placingTeam: null,
        jack: null,
        boules: [],
        result: null,
      };
    }
    default:
      return match;
  }
}
