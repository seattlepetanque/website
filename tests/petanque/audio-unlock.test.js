import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioUnlock, GESTURES, silentWavUri } from '../../assets/js/petanque/audio-unlock.js';

function fakeTarget() {
  const l = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(t, f) { (l.get(t) || l.set(t, new Set()).get(t)).add(f); },
    removeEventListener(t, f) { l.get(t)?.delete(f); },
    fire(t) { for (const f of [...(l.get(t) || [])]) f({ type: t }); },
    count() { let n = 0; for (const s of l.values()) n += s.size; return n; },
    createElement() { return { play() { this.played = (this.played || 0) + 1; return Promise.resolve(); }, pause() {}, setAttribute() {} }; },
  };
}
function fakeCtx(state = 'suspended') {
  const c = { state, calls: 0, resume() { c.calls++; return new Promise((r) => { c.done = () => { c.state = 'running'; r(); }; }); } };
  return c;
}
let clock = 0;
const setup = (over = {}) => {
  const doc = fakeTarget(), win = fakeTarget(), ctx = over.ctx === undefined ? fakeCtx() : over.ctx, st = { muted: false, held: false };
  const u = createAudioUnlock({ doc, win, nav: over.nav || {}, getContext: () => ctx, isMuted: () => st.muted, isHeld: () => st.held, now: () => clock, ...over.opts });
  u.attach();
  return { doc, win, ctx, st, u };
};

test('resumes a suspended or interrupted context on a gesture; running is left alone', () => {
  for (const s of ['suspended', 'interrupted']) {
    clock += 5000;
    const { doc, ctx } = setup({ ctx: fakeCtx(s) });
    doc.fire('touchend'); assert.equal(ctx.calls, 1, s);
  }
  clock += 5000;
  const { doc, ctx } = setup({ ctx: fakeCtx('running') });
  doc.fire('click'); assert.equal(ctx.calls, 0);
});

test('every gesture kind is listened for, and listeners stay until detach (resume on every gesture while not running)', () => {
  clock += 5000;
  const { doc, win, ctx, u } = setup();
  assert.equal(doc.count(), GESTURES.length + 1); assert.equal(win.count(), 2);
  doc.fire('pointerup'); ctx.done(); await_tick();
  assert.equal(doc.count(), GESTURES.length + 1);
  ctx.state = 'interrupted'; clock += 5000; // interrupted again later
  doc.fire('click'); assert.equal(ctx.calls, 2);
  u.detach();
  assert.equal(doc.count(), 0); assert.equal(win.count(), 0);
  doc.fire('click'); assert.equal(ctx.calls, 2);
});
function await_tick() {}

test('an unsettled resume is not spammed but is retried after the retry window', () => {
  clock += 5000;
  const { doc, ctx } = setup({ ctx: fakeCtx('interrupted') });
  doc.fire('click'); doc.fire('touchend'); assert.equal(ctx.calls, 1);
  clock += 1500; doc.fire('click'); assert.equal(ctx.calls, 2);
});

test('resumes on visibilitychange (visible only), pageshow and focus', () => {
  clock += 5000;
  const { doc, win, ctx } = setup({ ctx: fakeCtx('interrupted') });
  doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); assert.equal(ctx.calls, 0);
  doc.visibilityState = 'visible'; doc.fire('visibilitychange'); assert.equal(ctx.calls, 1);
  clock += 5000; win.fire('pageshow'); assert.equal(ctx.calls, 2);
  clock += 5000; win.fire('focus'); assert.equal(ctx.calls, 3);
});

test('muted or held: no automatic resume; explicit gesture() forces it when muted but never when held', () => {
  clock += 5000;
  const { doc, ctx, st, u } = setup();
  st.muted = true; doc.fire('click'); assert.equal(ctx.calls, 0);
  u.gesture(); assert.equal(ctx.calls, 1);
  clock += 5000; st.muted = false; st.held = true; doc.fire('click'); assert.equal(ctx.calls, 1);
  st.held = false; doc.fire('click'); assert.equal(ctx.calls, 2);
});

test('creates the context on the first gesture when none exists, unless muted', () => {
  clock += 5000;
  let ctx = null, made = 0;
  const doc = fakeTarget(), st = { muted: true };
  const u = createAudioUnlock({ doc, win: fakeTarget(), nav: {}, getContext: () => ctx, create: () => { made++; ctx = fakeCtx('running'); }, isMuted: () => st.muted, now: () => clock });
  u.attach();
  doc.fire('click'); assert.equal(made, 0);
  st.muted = false; doc.fire('click'); assert.equal(made, 1);
  doc.fire('click'); assert.equal(made, 1);
});

test('playback audio session: navigator.audioSession when present, else a silent looping <audio> started in a gesture', () => {
  clock += 5000;
  const nav = { audioSession: { type: 'auto' } };
  setup({ nav }).doc.fire('touchend'); assert.equal(nav.audioSession.type, 'playback');
  const { doc } = setup({ nav: {} });
  let el = null; const ce = doc.createElement; doc.createElement = () => (el = ce());
  doc.fire('touchend'); doc.fire('click');
  assert.equal(el.played, 1); assert.equal(el.loop, true); assert.match(el.src, /^data:audio\/wav;base64,/);
});

test('state log callback gets initial, resume and statechange entries; missing ctx or a throwing resume never throws', () => {
  clock += 5000;
  const log = [], ctx = fakeCtx('interrupted'); let fire;
  ctx.addEventListener = (t, f) => { fire = f; };
  const { doc } = setup({ ctx, opts: { onState: (s, w) => log.push(s + ':' + w) } });
  doc.fire('click'); ctx.done(); fire();
  assert.deepEqual(log.slice(0, 2), ['interrupted:initial', 'interrupted:resume:click']);
  assert.equal(typeof fire, 'function');
  const none = setup({ ctx: null }); none.doc.fire('click');
  clock += 5000;
  const bad = fakeCtx(); bad.resume = () => { throw new Error('x'); };
  setup({ ctx: bad }).doc.fire('click');
});

test('silentWavUri is a valid tiny WAV', () => {
  const b = Buffer.from(silentWavUri().split(',')[1], 'base64');
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.length, 844); assert.equal(b.readUInt32LE(24), 8000);
});
