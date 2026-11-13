// Pure commentary text builders (F112), extracted from main.js. No DOM, no three, no closure state:
// everything they need comes in as arguments.
import { gapM, fmtCm, jackGap, jackTooClose, holdingTeam } from './rules.js';

export const gapText = (b, j) => fmtCm(gapM(b, j));

export const ownerName = (b, players) => {
  const p = players && players.find((q) => q.id === b.owner);
  return p ? (p.isHuman ? 'Your' : p.name + "'s") : 'The';
};

// Status line while an AI shows its spot: the factual label, then the player's own line.
export function spotText(player, choice, kind, talk) {
  const key = choice.labelKey || { event: kind === 'jack' ? 'spotJack' : 'spotPoint' };
  const target = key.target === 'jack' ? 'the jack' : player.team === 1 ? 'your boule' : 'their boule';
  const facts = (choice.label || `${player.name} picks ${player.id === 'odette' ? 'her' : 'his'} spot`) + '.';
  // the tactical reason (D13) first, then the generic line for the event
  const why = choice.why;
  const quip = (why && why.code !== 'mistake' && talk.say(player.id, 'why.' + why.code, { target, ...why })) || talk.say(player.id, key.event, { target });
  return quip ? `${facts} ${quip}` : facts;
}

// Commentary for the throw that just settled. Returns { text, kind } where kind is
// 'dead' | 'carreau' | 'great' | null (for the personality lines).
// ctx: { jack, match, bodies, preThrow }
export function describe(was, evs, { jack: j, match, bodies, preThrow }) {
  const players = match && match.players;
  if (j && j.dead) return { text: 'The jack is out: dead jack.', kind: null };
  if (was.kind === 'jack') return { text: `Jack is ${jackGap(was, match && match.geometry).toFixed(1)} m out.`, kind: null }; // F75: edge to edge
  if (j && match && jackTooClose(j, match.geometry)) return { text: 'The jack is too close: less than 3 m from the circle, dead jack.', kind: null }; // F76, Art. 9.3
  if (was.dead) return { text: `${ownerName(was, players)} boule is out: dead boule.`, kind: 'dead' };
  if (!j) return { text: `${ownerName(was, players)} boule is down.`, kind: null }; // no jack on the court: nothing to measure against
  const gap = Math.hypot(was.x - j.x, was.y - j.y) - was.r - j.r;
  const base = `${ownerName(was, players)} boule is ${gapText(was, j)} from the jack.`;
  // carreau: the shooter hit an opposing boule, knocked it away and took its place
  for (const ev of evs) {
    if (ev.type !== 'hit' || (ev.a !== was.id && ev.b !== was.id)) continue;
    const tid = ev.a === was.id ? ev.b : ev.a;
    const t = bodies.find((b) => b.id === tid), from = preThrow.get(tid);
    if (!t || t.kind !== 'boule' || t.team === was.team || !from) continue;
    const moved = t.dead || Math.hypot(t.x - from.x, t.y - from.y) > 0.15;
    if (moved && Math.hypot(was.x - from.x, was.y - from.y) < 0.3) {
      return { text: `Carreau! ${ownerName(was, players)} boule replaces the target.`, kind: 'carreau' };
    }
  }
  if (gap < 0.02) return { text: `Biberon! ${ownerName(was, players)} boule is touching the jack.`, kind: 'great' };
  return { text: base, kind: null };
}

// One or two personality lines for the throw that just settled ('' when nothing fits).
// ctx: { jack, match, kind (from describe), talk, partner, chance }
export function quip(was, prevHold, { jack: j, match, kind, talk, partner, chance }) {
  const pick = (team) => {
    const ids = match.players.filter((p) => p.team === team && !p.isHuman).map((p) => p.id);
    return ids[Math.floor(chance() * ids.length)] || null;
  };
  const now = holdingTeam(match.jack, match.boules);
  const gap = j ? Math.hypot(was.x - j.x, was.y - j.y) - was.r - j.r : 9;
  const owner = match.players.find((p) => p.id === was.owner);
  if (!owner) return '';
  const gained = now === was.team && prevHold !== was.team;
  let ev = kind;
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

export function faultText(f) {
  if (!f) return '';
  const d = f.dist.toFixed(1);
  if (f.reason === 'short') return `Too short: ${d} m.`;
  if (f.reason === 'far') return `Too far: ${d} m.`;
  if (f.reason === 'line') return `Out over the ${f.side} line.`;
  if (f.reason === 'end') return `Too close to the end string: ${f.gap.toFixed(1)} m, it needs ${f.margin} m.`;
  if (f.back) return 'Went over a line and came back.';
  return 'Out of bounds.';
}

// The mène-end note for a decided mène: the winning boule's gap, with any carreau/biberon note kept in front.
// Returns the previous note unchanged when there is no winning boule or jack.
export function meneWinNote({ note, closeCall, win, jack, players }) {
  if (!win || !jack) return note;
  const special = /^(Carreau|Biberon)/.test(note) ? note + ' ' : '';
  return `${closeCall ? 'Close call! ' : ''}${special}Closest: ${ownerName(win, players)} boule, ${gapText(win, jack)} from the jack.`;
}
