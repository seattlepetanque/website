// F108: headless Chrome session that switches Graphics several times and checks the GL surface re-creation.
// Needs `hugo server --port 1609 --disableLiveReload` running (the ?debug hooks only exist under the server/development build).
// Usage: node scripts/f108-browser-check.mjs <screenshot-dir> [url]
// Checks after every switch: one game canvas (the live renderer's), the context's antialias matches the setting, no console errors,
// the canvas keeps its attributes and size, a real mouse drag still turns the aim, and old contexts are lost (no accumulation).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] || '.', URL_ = process.argv[3] || 'http://localhost:1609/game.html?debug&play&humanturn=1&cam=game&gfx=high';
const PORT = 9341;
mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'f108-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-prefers-reduced-motion', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1000,720', 'about:blank'], { stdio: 'ignore' });
console.log('chrome pid', chrome.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch (_) { /* not up yet */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });
for (let i = 0; i < 120; i++) { if (await ev('!!(window.__petanque && window.__petanque.pending)').catch(() => false)) break; await sleep(500); }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const state = () => ev(`(() => { const p = window.__petanque, r = p.renderer; const gl = r.canvas.getContext('webgl2') || r.canvas.getContext('webgl');
  return { canvases: document.querySelectorAll('canvas').length, same: document.querySelector('#petanque canvas') === r.canvas, stats: { ...r.surfaceStats },
  ctxLost: gl ? gl.isContextLost() : 'none', attrs: r.canvas.getAttribute('role') + '|' + r.canvas.style.touchAction, size: r.canvas.clientWidth + 'x' + r.canvas.clientHeight,
  quality: p.quality, paused: p.paused, aa: gl && gl.getContextAttributes().antialias, geometries: r.surface.renderer.info.memory.geometries, textures: r.surface.renderer.info.memory.textures }; })()`);
await sleep(2000);
console.log('initial', JSON.stringify(await state()));
await shot('0-start');
const drag = async (dx) => {
  const b = await ev(`(() => { const r = window.__petanque.renderer.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; })()`);
  const mk = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await mk('mousePressed', b.x, b.y);
  for (let i = 1; i <= 6; i++) { await mk('mouseMoved', b.x + dx * i / 6, b.y); await sleep(40); }
  await mk('mouseReleased', b.x + dx, b.y); await sleep(300);
};
let fails = 0; const check = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
const seq = (process.env.SEQ || 'low,high,low,high,auto,low,auto,high').split(',');
let n = 0;
for (const g of seq) {
  n++;
  await ev('window.__petanque.pauseGame()'); await sleep(600);
  // the real Graphics radio on the pause card
  const how = await ev(`(() => { const r = [...document.querySelectorAll('.pt-paused-gfx input')].find((i) => i.value === '${g}'); if (r) { r.click(); return 'clicked'; } window.__petanque.settings.graphics = '${g}'; return 'hook'; })()`);
  await sleep(1500);
  await shot(`${n}-${g}-paused`);
  const note = await ev(`(() => { const n = document.querySelector('.pt-gfx-note'); return n ? !n.hidden : null; })()`);
  await ev('(() => { const b = document.querySelector(".pt-resume"); if (b) b.click(); else window.__petanque.setPlaying(true); })()'); await sleep(1200);
  // the drag can release a throw (a press-and-release without a pull is a roulette throw), so wait for the human's next turn
  for (let i = 0; i < 60 && !(await ev('!!(window.__petanque.pending && !window.__petanque.paused)').catch(() => false)); i++) await sleep(1000);
  const y0 = await ev('window.__petanque.aimYaw'); await drag(120); let y1 = await ev('window.__petanque.aimYaw');
  if (y1 === y0) { await drag(-120); y1 = await ev('window.__petanque.aimYaw'); } // at the aim limit one way
  await shot(`${n}-${g}-after`);
  const s = await state();
  if (Math.abs(y1 - y0) <= 1e-4) console.log('diag', await ev(`(() => { const r = window.__petanque.renderer.canvas.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.6); return e.tagName + '.' + e.className + ' phase-pending=' + JSON.stringify(window.__petanque.pending) + ' flying=' + document.querySelector('#petanque').className; })()`));
  console.log(n, g, how, JSON.stringify({ aa: s.aa, canvases: s.canvases, rebuilds: s.stats.rebuilds, failures: s.stats.failures, lost: s.stats.lost, ctxLost: s.ctxLost, note, size: s.size, attrs: s.attrs, yaw: [y0, y1], level: s.quality, paused: s.paused, geom: s.geometries, tex: s.textures }));
  check(s.canvases === 1 && s.same, 'canvas count/identity');
  check(s.aa === (g !== 'low'), `antialias for ${g}: ${s.aa}`);
  check(note === false || note === null, 'reload note shown');
  check(s.ctxLost === false, 'new context lost');
  check(s.stats.failures === 0, 'rebuild failure');
  check(Math.abs(y1 - y0) > 1e-4, `pointer input changed the aim (${y0} -> ${y1})`);
  check(s.attrs === 'img|none', 'canvas attributes ' + s.attrs);
}
await sleep(1500);
const fin = await state(); console.log('final', JSON.stringify(fin));
check(fin.stats.lost === fin.stats.rebuilds, `lost contexts ${fin.stats.lost} vs rebuilds ${fin.stats.rebuilds}`);
console.log('errors', JSON.stringify(errors)); check(errors.length === 0, 'console errors');
console.log(fails ? `FAILED ${fails}` : 'ALL OK');
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
