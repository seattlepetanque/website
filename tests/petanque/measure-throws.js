// D16 throw investigation: AI-vs-AI mènes with the real chooseThrow / executeThrow and the browser's release-point
// path (character hand offsets), logging plan vs actual for every boule.
//   node tests/petanque/measure-throws.js [difficulty|all] [matches] [--json]
import { mulberry32 } from '../../assets/js/petanque/rng.js';
import { C } from '../../assets/js/petanque/constants.js';
import { createTerrain } from '../../assets/js/petanque/terrain.js';
import { createWorld, createBody, launch, simulate } from '../../assets/js/petanque/physics.js';
import { createMatch, defaultPlayers, apply, nextTeam, playersWithBoules } from '../../assets/js/petanque/rules.js';
const { chooseThrow, chooseJackThrow, chooseJackPlacement } = await import(process.env.AI_MOD || '../../assets/js/petanque/ai.js'); // AI_MOD: compare against an older copy
import { SKILL, scaledSkill, solveLaunch, coneFor } from '../../assets/js/petanque/donnee.js';
import { releaseOffset } from '../../assets/js/petanque/character.js';
import { specFor } from '../../assets/js/petanque/personalities.js';

// main.js handFrom/releasePoint/aiBase: the AI plans from the hand it will have at release, facing the jack
export function baseFor(id, yaw, terrain) {
  const spec = specFor(id);
  const z0 = terrain.sample(C.circle.x, C.circle.y).h;
  const hand = (loft, y = yaw) => {
    const o = releaseOffset({ height: spec.height, stance: spec.stance, loft, yaw: y });
    return { x: C.circle.x + o.x, y: C.circle.y + o.y, z: z0 + o.z };
  };
  return { x: C.circle.x, y: C.circle.y, release: (l) => hand(l), hand };
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Plays one match; calls onThrow(record) for every boule thrown.
export function playMatch(seed, difficulty, onThrow, { target = 13, noiseless = false } = {}) {
  const terrain = createTerrain(seed);
  const world = createWorld(terrain, mulberry32(seed ^ 0x9e3779b9));
  const rand = mulberry32(seed ^ 0x51ed270b);
  const players = defaultPlayers().map((p) => ({ ...p, isHuman: false }));
  let match = createMatch({ target, players, firstJackTeam: seed % 2 });
  let guard = 0;
  while (match.phase !== 'gameOver' && guard++ < 400) {
    if (match.phase === 'jack') {
      world.bodies.length = 0;
      terrain.resetDivots();
      const thrower = match.players.find((p) => p.team === match.jackTeam);
      const base = baseFor(thrower.id, 0, terrain);
      const { throwParams, from } = chooseJackThrow({ world, difficulty, rand, player: thrower, from: base });
      const jack = createBody('jack', {});
      world.add(jack);
      launch(jack, throwParams, from);
      simulate(world, 20);
      match = apply(match, { type: 'jackThrown', team: match.jackTeam, jack: { x: jack.x, y: jack.y, dead: jack.dead } });
    } else if (match.phase === 'jackPlace') {
      const placer = match.players.find((p) => p.team === match.placingTeam);
      const spot = chooseJackPlacement({ match, player: placer, difficulty, rand, terrain });
      match = apply(match, { type: 'jackPlaceSettled', team: match.placingTeam, jack: spot });
      world.bodies.length = 0;
      world.add(createBody('jack', { x: spot.x, y: spot.y }));
    } else if (match.phase === 'play') {
      const team = nextTeam(match);
      const player = playersWithBoules(match, team)[0];
      const jk = world.bodies.find((b) => b.kind === 'jack');
      const yaw = Math.atan2(jk.x - C.circle.x, jk.y - C.circle.y);
      const base = baseFor(player.id, yaw, terrain);
      const choice = chooseThrow({ world, match, player, difficulty, rand, from: base });
      match = apply(match, { type: 'bouleThrown', playerId: player.id });
      // planned rest: the noiseless throw at the chosen donnée on the real terrain
      const plan = (() => {
        const tp = solveLaunch({ from: choice.from, landing: choice.donnee, loft: choice.loft, terrain });
        const w = world.clone(terrain, () => 0.5);
        const b = launch(createBody('boule', { team }), tp, choice.from);
        w.add(b);
        simulate(w, 20);
        return { x: b.x, y: b.y, dead: b.dead };
      })();
      const others = world.bodies.filter((b) => b.kind === 'boule' && !b.dead).map((b) => ({ b, x: b.x, y: b.y }));
      const body = createBody('boule', { team, owner: player.id });
      world.add(body);
      world.events.length = 0;
      const tp = noiseless ? solveLaunch({ from: choice.from, landing: choice.donnee, loft: choice.loft, terrain }) : choice.throwParams;
      launch(body, tp, choice.from);
      simulate(world, 20);
      const land = world.events.find((e) => e.type === 'land' && e.id === body.id) || world.events.find((e) => e.type === 'land');
      const skill = scaledSkill(SKILL[player.id] || SKILL.human, difficulty);
      const cone = coneFor({ skill, from: choice.from, landing: choice.donnee, loft: choice.loft, energyFrac: choice.energyFrac });
      const tgt = choice.info.target || { x: jk.x, y: jk.y };
      const ux = choice.donnee.x - choice.from.x, uy = choice.donnee.y - choice.from.y, ul = Math.hypot(ux, uy) || 1;
      const rest = { x: body.x, y: body.y };
      const rec = {
        seed, difficulty, player: player.id, intent: choice.intent, style: choice.style, tag: choice.info.tag, loft: choice.loft,
        energyFrac: choice.energyFrac, clampedBy: choice.info.clampedBy, clamped: choice.info.budgetClamped, fallback: choice.info.fallback,
        donneeDist: d2(choice.donnee, choice.from), jackDist: d2(jk, choice.from), cone,
        fromMismatchCm: d2(choice.from, base.hand(choice.loft, Math.atan2(choice.donnee.x - C.circle.x, choice.donnee.y - C.circle.y))) * 100,
        nOthers: others.length, planned: plan, rest, dead: body.dead,
        landing: land ? { x: land.x, y: land.y } : null,
        planErr: plan.dead ? 9 : d2(plan, rest), // actual vs planned rest
        // signed shortfall along the throw line: intended target minus actual rest (positive = short)
        short: ((tgt.x - rest.x) * ux + (tgt.y - rest.y) * uy) / ul,
        plannedShort: plan.dead ? 9 : ((tgt.x - plan.x) * ux + (tgt.y - plan.y) * uy) / ul,
        landLat: land ? ((land.x - choice.donnee.x) * uy - (land.y - choice.donnee.y) * ux) / ul : 0,
        landLong: land ? ((land.x - choice.donnee.x) * ux + (land.y - choice.donnee.y) * uy) / ul : 0,
        toTarget: body.dead ? 9 : d2(rest, tgt),
        toJack: body.dead ? 9 : d2(rest, jk),
        lateral: ((rest.x - tgt.x) * uy - (rest.y - tgt.y) * ux) / ul,
        moved: choice.intent === 'shoot' ? others.some(({ b, x, y }) => b.dead || d2(b, { x, y }) > 0.15) : false,
        carreau: false,
        targetMoved: false,
      };
      if (choice.intent === 'shoot' && choice.info.tag === 'boule') {
        const t = others.find(({ x, y }) => d2({ x, y }, tgt) < 0.02);
        if (t) {
          rec.targetMoved = t.b.dead || d2(t.b, t) > 0.15;
          rec.carreau = rec.targetMoved && !body.dead && d2(body, t) < 0.4;
        }
      }
      onThrow(rec);
      const jack = world.bodies.find((b) => b.kind === 'jack');
      match = apply(match, {
        type: 'throwSettled', jack: { x: jack.x, y: jack.y, dead: jack.dead },
        boules: world.bodies.filter((b) => b.kind === 'boule').map((b) => ({ id: b.id, team: b.team, owner: b.owner, x: b.x, y: b.y, dead: b.dead })),
      });
      if (match.phase === 'meneEnd') match = apply(match, { type: 'nextMene' });
    } else break;
  }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (n, d) => (d ? (100 * n / d).toFixed(0) + '%' : '-');
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

function report(difficulty, recs) {
  console.log(`\n=== ${difficulty}: ${recs.length} throws ===`);
  const pts = recs.filter((r) => r.intent === 'point');
  console.log('style      n   plannedErr(m)  mean short(m)  >1m short  >2m short  clamped  fallback  energy');
  for (const st of ['roulette', 'demi-portee', 'plombee']) {
    const a = pts.filter((r) => r.style === st);
    if (!a.length) continue;
    console.log(`${st.padEnd(11)}${String(a.length).padEnd(4)}${mean(a.map((r) => r.planErr)).toFixed(2).padStart(9)}${mean(a.map((r) => r.short)).toFixed(2).padStart(14)}${pct(a.filter((r) => r.short > 1).length, a.length).padStart(11)}${pct(a.filter((r) => r.short > 2).length, a.length).padStart(11)}${pct(a.filter((r) => r.clamped).length, a.length).padStart(9)}${pct(a.filter((r) => r.fallback).length, a.length).padStart(10)}${mean(a.map((r) => r.energyFrac)).toFixed(2).padStart(8)}`);
  }
  for (const st of ['roulette', 'demi-portee', 'plombee']) {
    const a = pts.filter((r) => r.style === st);
    if (a.length) console.log(`  ${st}: planned rest short of target by mean ${mean(a.map((r) => r.plannedShort)).toFixed(2)} m (p90 ${q(a.map((r) => Math.abs(r.plannedShort)), 0.9).toFixed(2)}); landing long err sd ${Math.sqrt(mean(a.map((r) => r.landLong ** 2))).toFixed(2)} m, model sigma ${mean(a.map((r) => r.cone.sigmaLong)).toFixed(2)} m`);
  }
  const clamped = recs.filter((r) => r.clamped);
  console.log(`clamped ${clamped.length}/${recs.length}, mean pull-in ${mean(clamped.map((r) => r.clampedBy)).toFixed(2)} m; fallbacks ${recs.filter((r) => r.fallback).length}; max plan-vs-hand mismatch ${Math.max(...recs.map((r) => r.fromMismatchCm)).toFixed(1)} cm`);
  const pe = pts.map((r) => r.planErr);
  console.log(`pointing actual vs planned rest: median ${q(pe, 0.5).toFixed(2)} p90 ${q(pe, 0.9).toFixed(2)} m; short>1m: ${pct(pts.filter((r) => r.short > 1).length, pts.length)}, >2m: ${pct(pts.filter((r) => r.short > 2).length, pts.length)}`);
  console.log('shooters:  shots/throws  shoot%  moved%  carreau%  median |lat| miss (cm)  p90');
  for (const id of ['pierre', 'odette', 'marcel', 'you']) {
    const a = recs.filter((r) => r.player === id);
    const sh = a.filter((r) => r.intent === 'shoot' && r.tag === 'boule');
    const lat = sh.map((r) => Math.abs(r.landLat) * 100);
    console.log(`${id.padEnd(10)} ${String(sh.length).padStart(4)}/${String(a.length).padEnd(4)} ${pct(sh.length, a.length).padStart(6)} ${pct(sh.filter((r) => r.targetMoved).length, sh.length).padStart(7)} ${pct(sh.filter((r) => r.carreau).length, sh.length).padStart(9)} ${q(lat, 0.5).toFixed(1).padStart(14)} ${q(lat, 0.9).toFixed(1).padStart(8)}   shotDist ${mean(sh.map((r) => r.donneeDist)).toFixed(1)} m  sigmaLat ${mean(sh.map((r) => r.cone.sigmaLat * 100)).toFixed(1)} cm  energy ${mean(sh.map((r) => r.energyFrac)).toFixed(2)}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('measure-throws.js')) {
  const arg = process.argv[2] || 'all';
  const nMatches = +process.argv[3] || 6;
  for (const difficulty of arg === 'all' ? ['easy', 'medium', 'hard'] : [arg]) {
    const recs = [];
    for (let i = 0; i < nMatches; i++) playMatch(11 + i, difficulty, (r) => recs.push(r));
    report(difficulty, recs);
  }
}
