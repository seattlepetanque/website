// Pétanque rules and scoring (doublette). Pure data logic: no DOM, no physics.
// Jack: { x, y, dead }. Boules: { id, team, owner, x, y, dead }. Metres, 2D distances.

export const DEFAULT_GEOMETRY = Object.freeze({
  circle: Object.freeze({ x: 2, y: 1 }),
  width: 4,
  length: 15,
  jackMin: 6,
  jackMax: 10,
  lineMargin: 1,
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
    phase: 'jack', // 'jack' | 'play' | 'meneEnd' | 'gameOver'
    jack: null,
    boules: [],
    result: null, // last mène result: { team, points, void, ... }
    winner: null,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Jack must land 6-10 m from the circle centre and >= 1 m from side and end lines.
export function jackValid(jack, geometry = DEFAULT_GEOMETRY) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (!jack || jack.dead) return false;
  const d = dist(jack, g.circle);
  if (d < g.jackMin - EPS || d > g.jackMax + EPS) return false;
  const m = g.lineMargin;
  return jack.x >= m - EPS && jack.x <= g.width - m + EPS &&
    jack.y >= m - EPS && jack.y <= g.length - m + EPS;
}

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

function endMene(match, jack, boules) {
  let result;
  if (jack.dead) {
    // Dead jack: void if both teams still hold boules, else the team with boules scores them.
    const h0 = boulesInHand(match, 0);
    const h1 = boulesInHand(match, 1);
    if (h0 > 0 && h1 > 0) result = { void: true };
    else if (h0 > 0) result = { team: 0, points: h0, measured: [] };
    else if (h1 > 0) result = { team: 1, points: h1, measured: [] };
    else result = { void: true };
  } else {
    result = meneResult(jack, boules);
  }
  const scores = match.scores.slice();
  if (!result.void) scores[result.team] += result.points;
  const over = scores.findIndex((s) => s >= match.target) >= 0;
  const winner = over ? (scores[0] >= scores[1] ? 0 : 1) : null;
  return { ...match, jack, boules, scores, result, inFlight: null,
    phase: over ? 'gameOver' : 'meneEnd', winner };
}

// Reducer: returns a new match, never mutates the input.
export function apply(match, event) {
  switch (event.type) {
    case 'jackThrown': {
      if (match.phase !== 'jack') return match;
      const jack = { x: event.jack.x, y: event.jack.y, dead: !!event.jack.dead };
      if (!jackValid(jack, match.geometry)) {
        // Invalid: the other team throws the jack next.
        return { ...match, jackTeam: 1 - event.team, jack: null };
      }
      return { ...match, phase: 'play', jackTeam: event.team, jack, boules: [], lastThrower: null };
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
      return { ...match, jack, boules, inFlight: null };
    }
    case 'nextMene': {
      if (match.phase !== 'meneEnd') return match;
      const r = match.result;
      return {
        ...match,
        players: match.players.map((p) => ({ ...p, boulesLeft: BOULES_PER_PLAYER })),
        mene: match.mene + 1,
        jackTeam: r && !r.void ? r.team : match.jackTeam, // winner throws; void keeps the same team
        lastThrower: null,
        inFlight: null,
        phase: 'jack',
        jack: null,
        boules: [],
        result: null,
      };
    }
    default:
      return match;
  }
}
