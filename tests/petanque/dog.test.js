import test from 'node:test';
import assert from 'node:assert/strict';
import { placeDog, createDogAnim, inTreeShade, DOG_ANIM, DOG_KEEPOUT } from '../../assets/js/petanque/dog.js';
import { outsideTimbers } from '../../assets/js/petanque/scenery.js';
import { waitingSlots } from '../../assets/js/petanque/waiting.js';
import { C } from '../../assets/js/petanque/constants.js';

test('placement: outside the timbers, in shade, clear of every slot and walking line, deterministic', () => {
  for (let seed = 0; seed < 400; seed++) {
    const d = placeDog(seed);
    assert.deepEqual(placeDog(seed), d);
    const out = outsideTimbers(d.x, d.y);
    assert.ok(out >= 1.5 && out <= 3, `outside ${out}`);
    assert.ok(d.x < 0 && d.y > 5 && d.y < 11);
    assert.ok(d.shaded && inTreeShade(d.x, d.y));
    for (const dir of [1, -1]) for (const cy of [1, 4, 8, 11, 14]) for (const jy of [null, 3, 9, 14]) {
      for (const s of waitingSlots(jy === null ? null : { x: 2, y: jy }, { terrainW: C.terrainW, terrainL: C.terrainL, jackMinDist: C.jackMinDist, jackMaxDist: C.jackMaxDist, circle: { x: 2, y: cy }, dir })) {
        assert.ok(Math.hypot(s.x - d.x, s.y - d.y) >= DOG_KEEPOUT, 'near a slot');
      }
    }
    assert.ok(-1 - d.x >= DOG_KEEPOUT, 'near the left walking line x = -1');
  }
  assert.notDeepEqual(placeDog(1), placeDog(2));
});

test('animation: bounded, deterministic, breathing 0.25 Hz of 2.5 cm', () => {
  const a = createDogAnim(5), b = createDogAnim(5), pa = {}, pb = {};
  let maxRise = 0, minRise = 1;
  for (let t = 0; t < 600; t += 0.05) {
    a.pose(t, pa); b.pose(t, pb);
    assert.deepEqual(pa, pb);
    assert.ok(pa.rise >= 0 && pa.rise <= 0.025 + 1e-9);
    assert.ok(Math.abs(pa.earL) <= DOG_ANIM.ear.amp && Math.abs(pa.earR) <= DOG_ANIM.ear.amp);
    assert.ok(pa.tail >= 0 && pa.tail <= DOG_ANIM.tail.amp + 1e-9 && pa.head >= 0 && pa.head <= DOG_ANIM.head.amp + 1e-9);
    maxRise = Math.max(maxRise, pa.rise); minRise = Math.min(minRise, pa.rise);
  }
  assert.ok(maxRise > 0.024 && minRise < 0.001);
  const p0 = a.pose(3.3, {}).rise, p1 = a.pose(3.3 + 4, {}).rise; // one period = 4 s
  assert.ok(Math.abs(p0 - p1) < 1e-9);
});

test('schedule gaps are respected', () => {
  for (let seed = 0; seed < 50; seed++) {
    const s = createDogAnim(seed).schedule, A = DOG_ANIM;
    for (const [arr, g] of [[s.ears, A.ear.gap], [s.tails, A.tail.gap], [s.heads, A.head.gap]]) {
      assert.ok(arr.length > 5 && arr[0] >= g[0] && arr[0] <= g[1]);
      for (let i = 1; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; assert.ok(d >= g[0] - 1e-9 && d <= g[1] + 1e-9, `gap ${d}`); }
    }
    assert.ok(s.tailBeats.every((n) => n >= 2 && n <= 3));
  }
});
