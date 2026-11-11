// E09: Pierre's chooser suggestion is one coherent line with exactly one action
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommentary, composeSuggestion, whoKind, REASON_ACTION, LINES } from '../../assets/js/petanque/personalities.js';
import { mulberry32 } from '../../assets/js/petanque/rng.js';

const SHOOT = /\b(shoot|shot|knock|hit|blast|take out)\b/i;
const POINT = /\b(point|points|pointing)\b/i;
const actionsIn = (t) => [SHOOT.test(t) && 'shoot', POINT.test(t) && 'point'].filter(Boolean);

test('every code has an action, and every Pierre reason line states only that action', () => {
  for (const code of Object.keys(LINES.pierre.suggest)) {
    assert.ok(REASON_ACTION[code], `${code} has an action`);
    for (const l of LINES.pierre.suggest[code]) {
      const a = actionsIn(l);
      assert.ok(a.length <= 1, `"${l}" mixes actions`);
      if (a.length) assert.equal(a[0], REASON_ACTION[code], `"${l}" (${code})`);
    }
  }
  for (const [kind, lines] of Object.entries(LINES.pierre.who)) for (const l of lines) assert.ok(actionsIn(l).length <= 1, `who.${kind} "${l}"`);
});

test('the composed suggestion has one speaker and exactly one action, for every code, intent and who', () => {
  const pierre = { id: 'pierre' }, you = { id: 'you', isHuman: true };
  for (let seed = 1; seed <= 12; seed++) {
    const talk = createCommentary(mulberry32(seed));
    for (const intent of ['point', 'shoot']) {
      for (const code of Object.keys(REASON_ACTION)) {
        for (const [thrower, hasP, size] of [[you, true, 2], [you, false, 1], [pierre, true, 2], [pierre, true, 1]]) {
          const kind = whoKind({ intent, thrower, pierre, pierreHasBoules: hasP, teamSize: size });
          const text = composeSuggestion(talk, { intent, code, kind, vars: { n: 2, gap: '20 cm', target: 'their boule' }, fact: '(Marcel boule is 12 cm from the jack.)' });
          const body = text.replace(/^Pierre: “|”$/g, '');
          assert.equal((text.match(/Pierre:/g) || []).length, 1, text);
          assert.ok(!/\{\w+\}/.test(text), `unfilled template: ${text}`);
          const strip = body.replace(/\(.*?\)/g, ''); // the measured fact names a boule, not an action
          const acts = actionsIn(strip);
          if (kind !== 'only') assert.deepEqual(acts, [intent], `${intent}/${code}/${kind}: ${text}`);
          else assert.ok(acts.length <= 1 && (acts[0] || intent) === intent, text);
        }
      }
    }
  }
});

test('a reason for the other action is dropped rather than merged', () => {
  const talk = createCommentary(mulberry32(4));
  const t = composeSuggestion(talk, { intent: 'point', code: 'bringInBoules', kind: 'youPoint', vars: { n: 2 } });
  assert.ok(!SHOOT.test(t) && !/Knock|Hit that/i.test(t), t);
  const s = composeSuggestion(talk, { intent: 'shoot', code: 'protectOwn', kind: 'iShoot', vars: {} });
  assert.ok(!POINT.test(s), s);
});
