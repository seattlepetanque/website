// D13 full-match statistics (GAME-PLAN 12.8): decision mix by situation, shot results, void rate, win rates by
// difficulty against scripted human teams, AI v AI, decision times.
//   node tests/petanque/measure-tactics.js [matches=40] [--rows pointer,shooter,tactician,aivai] [--workers 8] [--json]
// AI_MOD=path/to/old-ai.js runs the same harness against an older ai.js (for a baseline; it has no whoThrows or reasons).
// Teams: team 0 is You (scripted bot) + Pierre (AI), team 1 is Marcel + Odette (AI) at the row's difficulty.
import { spawn } from 'node:child_process';
import { mulberry32, gauss } from '../../assets/js/petanque/rng.js';
import { C } from '../../assets/js/petanque/constants.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules, boulesInHand, holdingTeam } from '../../assets/js/petanque/rules.js';
import { SKILL, difficultyScale, coneFor, executeThrow, releaseFrom, fitToBudget } from '../../assets/js/petanque/donnee.js';
import { baseFor } from './measure-throws.js';
import { readSituation, plan, DEFAULT_CFG, DIFFICULTY } from '../../assets/js/petanque/tactics.js';
const AIM = await import(process.env.AI_MOD || '../../assets/js/petanque/ai.js');
const { chooseThrow, chooseJackThrow, chooseJackPlacement, donneeDistFor } = AIM;
const whoThrows = AIM.whoThrows || null;
// tuning hooks: DSCALE=easy,medium,hard overrides donnee.js difficultyScale (the AI skill spread); EPS=easy,medium,hard overrides the tactical error rates for a run
if (process.env.DSCALE) process.env.DSCALE.split(',').forEach((v, i) => { difficultyScale[['easy', 'medium', 'hard'][i]] = +v; });
if (process.env.EPS) process.env.EPS.split(',').forEach((v, i) => { DIFFICULTY[['easy', 'medium', 'hard'][i]].eps = +v; });
if (AIM.AI && !process.env.TIME_GUARD) AIM.AI.timeGuard = false; // the 40 ms wall-clock guard makes results load-dependent; TIME_GUARD=1 keeps it

const DEG = Math.PI / 180;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// The scripted human: a pointer (demi at the jack), a shooter (shoots whenever they hold anything), a tactician (the AI at Medium)
function botThrow(kind, { world, match, player, rand, from: base, terrain }) {
  const jack = world.bodies.find((b) => b.kind === 'jack');
  const foes = world.bodies.filter((b) => b.kind === 'boule' && !b.dead && b.team !== player.team);
  const mine = world.bodies.filter((b) => b.kind === 'boule' && !b.dead && b.team === player.team);
  const best = (a) => Math.min(Infinity, ...a.map((b) => d2(b, jack)));
  const theyHold = foes.length && best(foes) <= best(mine);
  const shoot = kind === 'shooter' && theyHold;
  const loft = (shoot ? 22 : 32) * DEG, from = releaseFrom(base, loft);
  let target = { x: jack.x, y: jack.y }, landing;
  if (shoot) {
    const t = foes.sort((a, b) => d2(a, jack) - d2(b, jack))[0];
    const dx = t.x - from.x, dy = t.y - from.y, dd = Math.hypot(dx, dy);
    landing = { x: t.x - dx / dd * 0.6, y: t.y - dy / dd * 0.6 };
  } else {
    // a reasonable human uses the roll guide: refined on the felt terrain (NAIVE_POINTER=1 keeps the old flat-table aim)
    const refined = !process.env.NAIVE_POINTER && AIM.planPoint && AIM.planPoint({ world, from, target, loft, rand });
    if (refined) landing = refined;
    else {
      const dist = d2(jack, from), dd = donneeDistFor('boule', loft, from, dist) ?? dist, k = Math.min(dd, dist) / dist;
      landing = { x: from.x + (jack.x - from.x) * k, y: from.y + (jack.y - from.y) * k };
    }
  }
  const fit = fitToBudget({ from, landing, loft, skill: SKILL.human, terrain });
  const cone = coneFor({ skill: SKILL.human, from, landing: fit.landing, loft, energyFrac: fit.energyFrac });
  const tp = executeThrow({ from, landing: fit.landing, loft, cone, terrain, rand }).throwParams;
  return { throwParams: tp, from, intent: shoot ? 'shoot' : 'point', family: shoot ? 'bot-shoot' : 'bot-point', why: { code: 'bot' }, info: { target } };
}

const bucket = (sit) => {
  const ba = sit.hand.us - sit.hand.them;
  return `BA${ba <= -2 ? '-2' : ba >= 2 ? '+2' : ba < 0 ? '-1' : ba > 0 ? '+1' : ' 0'}/${sit.holding ? 'hold' : 'notHold'}/${sit.hand.us === 1 ? 'last' : 'more'}`;
};

export function playMatch(seed, { diffs = ['medium', 'medium'], bot = null, target = 13, rec }) {
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const rand = mulberry32(seed ^ 0x51ed270b);
  // AI v AI rows: the human seat is an AI with the human's skill, scaled by the row's difficulty like the others (STANDIN=raw keeps it unscaled-as-human, the old harness)
  const players = defaultPlayers().map((p) => ({ ...p, isHuman: false, ...(!bot && p.id === 'you' && process.env.STANDIN !== 'raw' ? { skill: process.env.SYMMETRIC ? SKILL.marcel : SKILL.human } : {}),
    ...(!bot && p.id === 'pierre' && process.env.SYMMETRIC ? { skill: SKILL.odette } : {}) }));
  // SYMMETRIC=1 (AI v AI rows): the human seat throws like Marcel and Pierre like Odette, so both teams are equal
  let match = createMatch({ target, players, firstJackTeam: seed % 2 });
  const out = { menes: 0, voids: 0, points: 0, throws: 0, decisionMs: [] };
  let guard = 0;
  while (match.phase !== 'gameOver' && guard++ < 500) {
    if (match.phase === 'jack') {
      world.bodies.length = 0; terrain.resetDivots();
      const thrower = match.players.find((p) => p.team === match.jackTeam);
      const difficulty = diffs[thrower.team];
      const { throwParams, from } = chooseJackThrow({ world, difficulty, rand, player: thrower, from: baseFor(thrower.id, 0, terrain) });
      const jack = createBody('jack', {}); world.add(jack); launch(jack, throwParams, from); simulate(world, 20);
      match = apply(match, { type: 'jackThrown', team: match.jackTeam, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
    } else if (match.phase === 'jackPlace') {
      const placer = match.players.find((p) => p.team === match.placingTeam);
      const spot = chooseJackPlacement({ match, player: placer, difficulty: diffs[placer.team], rand, terrain });
      match = apply(match, { type: 'jackPlaced', team: match.placingTeam, jack: spot });
      world.bodies.length = 0; world.add(createBody('jack', { x: spot.x, y: spot.y }));
    } else if (match.phase === 'play') {
      const team = nextTeam(match);
      const avail = playersWithBoules(match, team);
      const botTeam = bot && team === 0;
      // who throws: the bot's team lets You go first; the AI uses whoThrows when the module has it, else most boules first
      let player;
      if (botTeam) player = avail.find((p) => p.id === 'you') || avail[0];
      else if (avail.length > 1 && whoThrows) player = whoThrows({ match, bodies: world.bodies, team, difficulty: diffs[team], players: avail }).player;
      else player = avail.slice().sort((a, b) => b.boulesLeft - a.boulesLeft)[0];
      const jk = world.bodies.find((b) => b.kind === 'jack');
      const yaw = Math.atan2(jk.x - C.circle.x, jk.y - C.circle.y);
      const base = baseFor(player.id, yaw, terrain);
      const difficulty = diffs[team];
      // shot opportunity, independent of the boule advantage: would the planner admit a shot if the hands were even?
      let opp = false, ptsSigned = 0, dTheirs = null;
      if (rec) {
        const sit0 = readSituation({ match, bodies: world.bodies, player, difficulty });
        ptsSigned = sit0.ptsSigned; dTheirs = sit0.d && sit0.d.them.slice(0, 3);
        if (!sit0.void) opp = plan({ ...sit0, BA: 0 }, DEFAULT_CFG).cands.some((c) => c.family === 'shootBoule');
      }
      const t0 = performance.now();
      let choice;
      if (botTeam && player.id === 'you' && bot !== 'tactician') choice = botThrow(bot, { world, match, player, rand, from: base, terrain });
      else if (botTeam && player.id === 'you') choice = chooseThrow({ world, match, player: { ...player, isHuman: true }, difficulty: 'medium', rand, from: base });
      else choice = chooseThrow({ world, match, player, difficulty, rand, from: base });
      const ms = performance.now() - t0;
      if (!(botTeam && player.id === 'you' && bot !== 'tactician')) out.decisionMs.push(ms);
      const sitInfo = { hand: { us: boulesInHand(match, team), them: boulesInHand(match, 1 - team) }, holding: holdingTeam(match.jack, match.boules) === team };
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      const others = world.bodies.filter((b) => b.kind === 'boule' && !b.dead).map((b) => ({ b, x: b.x, y: b.y, team: b.team }));
      const jx = jk.x, jy = jk.y;
      const body = createBody('boule', { team, owner: player.id });
      world.add(body);
      launch(body, choice.throwParams, choice.from);
      simulate(world, 20);
      out.throws++;
      const r = {
        player: player.id, team, difficulty, opp, ptsSigned, dTheirs, table: choice.info && choice.info.table, estHit: choice.info && choice.info.hitRate, bucket: bucket(sitInfo), intent: choice.intent, family: choice.family || choice.intent, why: choice.why ? choice.why.code : 'none',
        shootBoule: choice.intent === 'shoot' && choice.info.tag === 'boule', shootJack: choice.intent === 'shoot' && choice.info.tag === 'jack',
        hit: false, carreau: false, ownMoved: 0, jackMoved: d2(jk, { x: jx, y: jy }) > 0.15 || jk.dead, jackDead: !!jk.dead,
      };
      if (r.shootBoule) {
        const t = others.find((o) => d2(o, choice.info.target) < 0.02);
        if (t) { r.hit = t.b.dead || d2(t.b, t) > 0.15; r.carreau = r.hit && !body.dead && d2(body, t) < 0.4; }
      }
      if (choice.intent === 'shoot') r.ownMoved = others.filter((o) => o.team === team && (o.b.dead || d2(o.b, o) > 0.15)).length;
      if (rec) rec(r);
      match = apply(match, {
        type: 'throwSettled', jack: { x: jk.x, y: jk.y, dead: jk.dead },
        boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({ id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead })),
      });
      if (match.phase === 'meneEnd' || match.phase === 'gameOver') {
        out.menes++;
        if (match.result.void) out.voids++; else out.points += match.result.points;
        if (match.phase === 'meneEnd') match = apply(match, { type: 'nextMene' });
      }
    } else break;
  }
  out.winner = match.winner; out.scores = match.scores;
  return out;
}

// ---- rows ----
const ROWS = {
  pointer: (d) => ({ bot: 'pointer', diffs: ['medium', d] }),
  shooter: (d) => ({ bot: 'shooter', diffs: ['medium', d] }),
  tactician: (d) => ({ bot: 'tactician', diffs: ['medium', d] }),
};
// Pierre's difficulty: the same as the opponents' (the game sets one difficulty for all AI players)
const rowOpts = (row, d) => {
  if (row === 'hardvhard') return { diffs: ['hard', 'hard'] };
  if (row === 'hardveasy') return { diffs: ['hard', 'easy'] };
  const o = ROWS[row](d);
  o.diffs = [d, d];
  return o;
};

function runJob({ row, d, from, to }) {
  const recs = [], res = [];
  for (let seed = from; seed < to; seed++) {
    const o = rowOpts(row, d);
    const m = playMatch(seed, { ...o, rec: (r) => recs.push(r) });
    res.push({ winner: m.winner, menes: m.menes, voids: m.voids, points: m.points, throws: m.throws, ms: m.decisionMs });
  }
  return { row, d, recs, res };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (n, dd) => (dd ? (100 * n / dd).toFixed(0) + '%' : '-');
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

function report(label, parts, { detail = false } = {}) {
  const res = parts.flatMap((p) => p.res), recs = parts.flatMap((p) => p.recs);
  const n = res.length;
  const aiWins = res.filter((r) => r.winner === 1).length;
  const ms = res.flatMap((r) => r.ms);
  const menes = res.reduce((a, r) => a + r.menes, 0), voids = res.reduce((a, r) => a + r.voids, 0);
  console.log(`${label.padEnd(28)} n=${n}  team1 (Marcel+Odette) wins ${pct(aiWins, n)}  menes/game ${(menes / n).toFixed(1)}  void ${pct(voids, menes)}  pts/mene ${(res.reduce((a, r) => a + r.points, 0) / Math.max(1, menes - voids)).toFixed(2)}  decision ms mean ${mean(ms).toFixed(0)} p95 ${q(ms, 0.95).toFixed(0)}`);
  if (!detail) return;
  const ai = recs.filter((r) => !String(r.family).startsWith('bot'));
  // decision mix by situation bucket
  console.log('  decision mix by situation (AI throws): bucket  n  point%  shootBoule%  shootJack%  shoot% when a shot is on (even-hands plan admits one)  top reasons');
  const buckets = [...new Set(ai.map((r) => r.bucket))].sort();
  for (const b of buckets) {
    const a = ai.filter((r) => r.bucket === b);
    const why = {};
    for (const r of a) why[r.why] = (why[r.why] || 0) + 1;
    const top = Object.entries(why).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v, a.length)}`).join(', ');
    console.log(`    ${b.padEnd(18)} ${String(a.length).padStart(5)}  ${pct(a.filter((r) => r.intent === 'point').length, a.length).padStart(4)}  ${pct(a.filter((r) => r.shootBoule).length, a.length).padStart(4)}  ${pct(a.filter((r) => r.shootJack).length, a.length).padStart(4)}  ${pct(a.filter((r) => r.opp && r.shootBoule).length, a.filter((r) => r.opp).length).padStart(4)}/${String(a.filter((r) => r.opp).length).padStart(4)}   ${top}`);
  }
  const fam = {};
  for (const r of ai) fam[r.family] = (fam[r.family] || 0) + 1;
  console.log('  families:', Object.entries(fam).map(([k, v]) => `${k} ${pct(v, ai.length)}`).join(', '));
  const sj = ai.filter((r) => r.shootJack);
  const sjWhy = {};
  for (const r of sj) sjWhy[r.why] = (sjWhy[r.why] || 0) + 1;
  console.log(`  shootJack ${pct(sj.length, ai.length)} of throws, dead jack ${pct(sj.filter((r) => r.jackDead).length, sj.length)}, reasons ${JSON.stringify(sjWhy)}`);
  console.log('  shots per player: player  shoot%  hit%  carreau%  own boules displaced/shot  jack moved%');
  for (const id of ['pierre', 'odette', 'marcel', 'you']) {
    const a = ai.filter((r) => r.player === id), sh = a.filter((r) => r.shootBoule);
    if (!a.length) continue;
    console.log(`    ${id.padEnd(8)} ${pct(sh.length, a.length).padStart(5)} ${pct(sh.filter((r) => r.hit).length, sh.length).padStart(5)} ${pct(sh.filter((r) => r.carreau).length, sh.length).padStart(7)} ${mean(sh.map((r) => r.ownMoved)).toFixed(2).padStart(10)} ${pct(sh.filter((r) => r.jackMoved).length, sh.length).padStart(11)}`);
  }
  const mist = ai.filter((r) => r.why === 'mistake').length;
  console.log(`  tactical errors: ${pct(mist, ai.length)} of AI throws`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const nMatches = +args.find((a) => /^\d+$/.test(a)) || 40;
  const rows = opt('--rows', 'pointer,shooter,tactician,hardvhard,hardveasy').split(',');
  const diffsArg = opt('--diffs', 'easy,medium,hard').split(',');
  const workers = +opt('--workers', 8);
  const jobsFor = (row, d) => {
    const per = Math.ceil(nMatches / workers), jobs = [];
    for (let s = 0; s < nMatches; s += per) jobs.push({ row, d, from: 1000 + s, to: 1000 + Math.min(nMatches, s + per) });
    return jobs;
  };
  const run = (job) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [new URL(import.meta.url).pathname, '--job', JSON.stringify(job)], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', (c) => (buf += c));
    p.on('close', (code) => (code ? reject(new Error('job failed')) : resolve(JSON.parse(buf))));
  });
  for (const row of rows) {
    const dl = row.startsWith('hardv') ? ['-'] : diffsArg;
    for (const d of dl) {
      const parts = await Promise.all(jobsFor(row, d).map(run));
      report(`${row}${d === '-' ? '' : ' / ' + d}`, parts, { detail: args.includes('--detail') });
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('measure-tactics.js')) {
  const i = process.argv.indexOf('--job');
  if (i >= 0) process.stdout.write(JSON.stringify(runJob(JSON.parse(process.argv[i + 1]))));
  else await main();
}
