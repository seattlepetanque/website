// Pétanque rules and scoring (doublette). Pure data logic: no DOM, no physics.
// Jack: { x, y, dead }. Boules: { id, team, owner, x, y, dead }. Metres, 2D distances.
import { nextCircle, CIRCLE_R } from './court.js';
import { C } from './constants.js';

export const DEFAULT_GEOMETRY = Object.freeze({
  circle: Object.freeze({ x: 2, y: 1 }),
  dir: 1, // E10: +1 plays toward y = length, -1 toward y = 0; moves with the circle each mène
  width: 4,
  length: 15,
  circleR: CIRCLE_R, // radius of the circle; the throw limits are measured from its inner edge (F75)
  jackMin: 6, // F75: edge to edge, circle's inner edge to the jack's nearest point
  jackMax: 10,
});

// F123b: the one tie rule. Surface gaps to the jack are held in integer micrometres. Sorted ascending, a boule joins the current
// cluster when its gap minus the cluster's smallest is <= 1.0 mm (inclusive; anchored on the smallest, no chaining), else it
// starts a new one. Boules in one cluster are EQUAL and every display shows the cluster's smallest gap (the canonical gap).
export const TIE_UM = 1000;
export const gapUm = (centreDist, rB = C.boule.r, rJ = C.jack.r) => Math.round(Math.max(0, centreDist - rB - rJ) * 1e6);
// canonical micrometre value for each entry of an array of gaps in micrometres (same order)
export function clusterUm(ums) {
  const order = ums.map((u, i) => i).sort((p, q) => ums[p] - ums[q]);
  const out = new Array(ums.length);
  let anchor = null;
  for (const i of order) {
    if (anchor === null || ums[i] - anchor > TIE_UM) anchor = ums[i];
    out[i] = anchor;
  }
  return out;
}
// canonicalGaps(boules, jack): Map id -> canonical surface gap in metres, for the live boules.
export function canonicalGaps(boules, jack) {
  const live = (boules || []).filter((b) => !b.dead);
  const ums = live.map((b) => gapUm(dist(b, jack), b.r ?? C.boule.r, jack.r ?? C.jack.r));
  const canon = clusterUm(ums);
  return new Map(live.map((b, i) => [b.id, canon[i] / 1e6]));
}
// two centre distances (e.g. the best of each side) are equal under the cluster rule (they are clustered together with the rest of `all`)
export function sameGap(centreA, centreB, all = []) {
  const u = [centreA, centreB, ...all].map((d) => gapUm(d));
  const c = clusterUm(u);
  return c[0] === c[1];
}
const BOULES_PER_PLAYER = 3;
const EPS = 1e-9;

// F45: the human picks a partner from the three characters; the other two are the opponents. Each keeps their own
// role (Marcel points; Pierre and Odette shoot); the human takes the role the partner does not.
export const PARTNER_IDS = Object.freeze(['pierre', 'marcel', 'odette']);
export const CHARACTER_ROLE = Object.freeze({ pierre: 'tireur', marcel: 'pointeur', odette: 'tireur' });
const CHARACTER_NAME = Object.freeze({ pierre: 'Pierre', marcel: 'Marcel', odette: 'Odette' });
export const validPartner = (id) => (PARTNER_IDS.includes(id) ? id : 'pierre');
export const opponentIds = (partner = 'pierre') => PARTNER_IDS.filter((id) => id !== validPartner(partner));
// 'You & Pierre', 'Marcel & Odette' (opponents in the fixed Pierre, Marcel, Odette order)
export const teamNamesFor = (partner = 'pierre') =>
  ['You & ' + CHARACTER_NAME[validPartner(partner)], opponentIds(partner).map((id) => CHARACTER_NAME[id]).join(' & ')];

export function defaultPlayers(partner = 'pierre') {
  const part = validPartner(partner);
  const mk = (id, name, team, isHuman, role) =>
    ({ id, name, team, isHuman, boulesLeft: BOULES_PER_PLAYER, role });
  return [
    mk('you', 'You', 0, true, CHARACTER_ROLE[part] === 'pointeur' ? 'tireur' : 'pointeur'),
    mk(part, CHARACTER_NAME[part], 0, false, CHARACTER_ROLE[part]),
    ...opponentIds(part).map((id) => mk(id, CHARACTER_NAME[id], 1, false, CHARACTER_ROLE[id])),
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
    stayed: false, // F74: has any boule come to rest in play this mène (Art. 16: until one does, dead first boules alternate teams)
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
// whole jack is past a string). Every other limit is edge to edge (user decision, F75/F76/F80): the 6-10 m throw limits
// are the gap between the circle's inner edge and the jack's nearest point (jackGap); the jack's surface must be more than
// 0.5 m before the end string (its centre more than JACK_END_CENTRE); a live jack less than 3 m from the circle (same gap)
// is dead (Art. 9.3).
// The end string is the far one in the playing direction: geometry.dir (+1 toward y = length, the default; -1 toward
// y = 0), ready for E10's flipping direction. One rule for a thrown and a placed jack.
export const JACK_R = 0.015;
export const JACK_END_MARGIN = 0.5; // metres from the jack's EDGE to the end string
export const JACK_END_CENTRE = JACK_END_MARGIN + JACK_R; // the same rule for the jack's centre
export const JACK_DEAD_DIST = 3; // Art. 9.3: edge gap from the circle below which a jack is dead
export const JACK_CENTRE_SHIFT = CIRCLE_R + JACK_R; // centre distance = edge gap + this (default circle)
// F06: every displayed distance is surface to surface. gapM: metres from a's edge to b's edge (negative = touching or overlapping).
// fmtCm: always centimetres with one decimal, "18.3 cm", "100.2 cm", "1234.5 cm" (never metres: F100 scoring measurements).
// Negative input (touching or overlapping) is shown as 0.0 cm.
export const gapM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - (a.r ?? 0) - (b.r ?? 0);
export function fmtCm(m) {
  const v = Math.max(0, m);
  return `${(v * 100).toFixed(1)} cm`;
}
const endGap = (jack, g) => ((g.dir ?? 1) < 0 ? jack.y : g.length - jack.y); // distance from the jack's centre to the end string
const circleR = (g) => g.circle.r ?? g.circleR ?? CIRCLE_R;
// F75: metres from the circle's inner edge to the jack's nearest point (negative = overlapping the circle)
export function jackGap(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  return dist(jack, g.circle) - circleR(g) - JACK_R;
}
// Art. 9.3: a live jack closer than 3 m (edge to edge) to the circle is dead
export const jackTooClose = (jack, geometry = DEFAULT_GEOMETRY) => !!jack && !jack.dead && jackGap(jack, geometry) < JACK_DEAD_DIST - EPS;
// the legal range of the jack's CENTRE distance from the circle's centre (what the zone lines and AI aims use)
export function jackCentreRange(geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry }, k = circleR(g) + JACK_R;
  return { min: g.jackMin + k, max: g.jackMax + k };
}
// the jack's edge is more than 0.5 m before the end string
const endOk = (jack, g) => endGap(jack, g) - JACK_R > JACK_END_MARGIN + EPS;
export function jackValid(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (!jack || jack.dead) return false;
  const gap = jackGap(jack, g);
  if (gap < g.jackMin - EPS || gap > g.jackMax + EPS) return false;
  return jack.x >= -JACK_R - EPS && jack.x <= g.width + JACK_R + EPS && endOk(jack, g);
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
  const m = boules
    .filter((b) => !b.dead)
    .map((b) => ({ id: b.id, team: b.team, dist: dist(b, jack), um: gapUm(dist(b, jack), b.r ?? C.boule.r, jack.r ?? C.jack.r) }))
    .sort((a, b) => a.um - b.um || a.dist - b.dist);
  const canon = clusterUm(m.map((x) => x.um));
  m.forEach((x, i) => { x.canon = canon[i]; }); // F123b: the cluster's smallest gap
  return m;
}

// Team holding the point: 0 | 1 | null (no live boules) | 'tie'
export function holdingTeam(jack, boules) {
  if (!jack || jack.dead) return null;
  const m = measure(jack, boules);
  if (!m.length) return null;
  const other = m.find((b) => b.team !== m[0].team);
  if (other && other.canon === m[0].canon) return 'tie';
  return m[0].team;
}

// Final mène score from the ground: closest team scores boules closer than the other's best.
export function meneResult(jack, boules) {
  if (!jack || jack.dead) return { void: true };
  const measured = measure(jack, boules);
  if (!measured.length) return { void: true };
  const win = measured[0];
  const other = measured.find((b) => b.team !== win.team);
  if (other && other.canon === win.canon) return { void: true };
  const limit = other ? other.canon : Infinity;
  const points = measured.filter((b) => b.team === win.team && b.canon < limit).length;
  return { team: win.team, points, measured: measured.map(({ id, dist }) => ({ id, dist })) };
}

// Why a jack is not legal: { reason: 'out'|'short'|'far'|'line'|'end', dist } or null when it is valid.
// 'line': whole jack past a side string (side 'left'|'right', gap = how far past the string, m);
// 'end': the jack's edge within 0.5 m of the end string (gap = edge to string, margin = 0.5);
// 'short'/'far': dist = the edge gap from the circle's inner edge (6 to 10 m);
// 'out': dead (went over a line during the roll); back = it now lies in a legal spot.
export function jackFault(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (jackValid(jack, g)) return null;
  if (!jack || jack.dead) {
    const back = !!jack && jackValid({ x: jack.x, y: jack.y }, g);
    return { reason: 'out', dist: jack ? jackGap(jack, g) : 0, ...(back ? { back } : {}) };
  }
  const d = jackGap(jack, g); // edge gap
  if (d < g.jackMin - EPS) return { reason: 'short', dist: d };
  if (d > g.jackMax + EPS) return { reason: 'far', dist: d };
  if (jack.x < -JACK_R) return { reason: 'line', dist: d, side: 'left', gap: -jack.x - JACK_R };
  if (jack.x > g.width + JACK_R) return { reason: 'line', dist: d, side: 'right', gap: jack.x - g.width - JACK_R };
  return { reason: 'end', dist: d, gap: endGap(jack, g) - JACK_R, margin: JACK_END_MARGIN };
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
  // F74, Art. 16: while no boule has stayed in play, a dead boule passes the turn to the opponent (alternately);
  // once boules have stayed and a shot cleared the ground, Art. 29 applies: the last thrower plays again.
  if (!live[0] && !live[1]) return match.stayed || match.lastThrower == null ? last : 1 - last; // lastThrower null: the first boule, the jack team throws it
  if (live[0] !== live[1]) return live[0] ? 1 : 0; // team without a boule on the ground
  const hold = holdingTeam(match.jack, match.boules);
  if (hold === 'tie' || hold === null) return last;
  return 1 - hold;
}

// The sentence for a dead cochonnet, from the boules in hand [team0, team1] when it went dead.
// Both teams holding boules or neither: void. Only one team: that team scores them.
export function deadJackText(inHand, teamNames = teamNamesFor('pierre'), reason = 'out') {
  const [h0, h1] = inHand;
  const what = reason === 'knocked' ? 'The cochonnet was knocked out and goes back to where it lay (the next mène starts there)' : reason === 'close' ? 'The cochonnet is too close to the circle (less than 3 m), so it is dead and goes back to where it lay (the next mène starts there)' : 'The cochonnet went out';
  if (h0 > 0 && h1 > 0) return `${what}: both teams still have boules, so the mène is void.`;
  if (h0 === 0 && h1 === 0) return `${what} and neither team has boules left, so the mène is void.`;
  const team = h0 > 0 ? 0 : 1;
  return `${what} with only ${teamNames[team]} holding boules: they score ${inHand[team]}.`;
}

function endMene(match, jack, boules) {
  let result;
  if (jack.dead) {
    // Dead jack: void if both teams still hold boules, else the team with boules scores them.
    // inHand is the count at the moment the jack died (kept on the result for the message, deadJackText).
    const h0 = boulesInHand(match, 0);
    const h1 = boulesInHand(match, 1);
    const inHand = [h0, h1], jackReason = jack.reason || (jack.replaced ? 'knocked' : 'out'); // 'knocked': F88, put back at its pre-throw spot
    // 'close': F76, less than 3 m from the circle
    if (h0 > 0 && h1 > 0) result = { void: true, inHand, jackReason };
    else if (h0 > 0) result = { team: 0, points: h0, measured: [], inHand, jackReason };
    else if (h1 > 0) result = { team: 1, points: h1, measured: [], inHand, jackReason };
    else result = { void: true, inHand, jackReason };
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
      return { ...match, phase: 'play', jackTeam: event.team, placingTeam: null, jack, boules: [], lastThrower: null, stayed: false };
    }
    case 'jackPlaceSettled': {
      // E04: the jack has come to rest. A valid resting place starts play; otherwise a yellow card and the same team places again.
      if (match.phase !== 'jackPlace' || event.team !== match.placingTeam) return match;
      const jack = { x: event.jack.x, y: event.jack.y, dead: !!event.jack.dead };
      if (!jackPlaceValid(jack, match.geometry)) return { ...match, yellowCards: (match.yellowCards || 0) + 1 };
      return { ...match, phase: 'play', placingTeam: null, jack, boules: [], lastThrower: null, stayed: false, yellowCards: 0 };
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
      if (jack.dead && event.jack.spot) jack.spot = { x: event.jack.spot.x, y: event.jack.spot.y };
      // F88: a jack a boule knocked out of bounds is put back where it lay before that throw; the next mène starts there
      // (the state's jack is the pre-throw position; the throw's own last-in-bounds spot is only the fallback)
      if (jack.dead && match.jack && !match.jack.dead && Number.isFinite(match.jack.x) && Number.isFinite(match.jack.y)) {
        jack.spot = { x: match.jack.x, y: match.jack.y }; jack.replaced = true;
      }
      if (jackTooClose(jack, match.geometry)) { // F76, Art. 9.3: knocked to less than 3 m from the circle: dead where it lies
        jack.dead = true; jack.reason = 'close'; jack.spot = { x: jack.x, y: jack.y };
        // F88b: rules slightly ambiguous, so treat it like the out-of-bounds jack: back to its pre-throw spot (reason stays 'close')
        if (match.jack && !match.jack.dead && Number.isFinite(match.jack.x) && Number.isFinite(match.jack.y)) { jack.spot = { x: match.jack.x, y: match.jack.y }; jack.replaced = true; } else delete jack.replaced;
      }
      const boules = event.boules.map((b) => ({ ...b }));
      const none = boulesInHand(match, 0) + boulesInHand(match, 1) === 0;
      if (jack.dead || none) return endMene(match, jack, boules);
      if (clinchedOnGround(match, jack, boules)) return endMene(match, jack, boules);
      return { ...match, jack, boules, inFlight: null, stayed: match.stayed || boules.some((x) => !x.dead) };
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
        stayed: false,
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
