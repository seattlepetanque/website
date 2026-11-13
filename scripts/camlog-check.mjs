// Headless Chrome: stage the quick-mode auto throw with ?debug&camlog&fixeddt and print the largest per-frame camera jumps.
// Needs `hugo server --port 1609 --disableLiveReload`. Usage: node scripts/camlog-check.mjs [seconds]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PORT = 9342, SECS = +process.argv[2] || 40;
const URL_ = process.env.URL_ || 'http://localhost:1609/game.html?debug&play&humanturn&demo&animate&autothrow&cam=game&fixeddt=16.7&camlog';
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.REDUCED === '0' ? [] : ['--force-prefers-reduced-motion']), `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cam-'))}`, '--window-size=1000,720', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch (_) { /* wait */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const lines = [], errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.method === 'Runtime.consoleAPICalled') { const t = d.params.args.map((a) => a.value ?? a.description).join(' '); if (d.params.type === 'error') errors.push(t); else if (t.startsWith('[camlog]')) lines.push(t); }
  else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
send('Runtime.enable'); send('Page.enable');
send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false });
send('Page.navigate', { url: URL_ });
await sleep(SECS * 1000);
const frames = lines.filter((l) => !l.startsWith('[camlog] setCamera')).map((l) => JSON.parse(l.slice(9)));
let maxP = 0, maxG = 0, at = -1;
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1], b = frames[i];
  const dp = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]), dg = Math.hypot(b.g[0] - a.g[0], b.g[1] - a.g[1], b.g[2] - a.g[2]);
  if (dp > maxP) { maxP = dp; at = i; }
  maxG = Math.max(maxG, dg);
}
if (process.env.DUMP) writeFileSync(process.env.DUMP, lines.join('\n'));
console.log('frames', frames.length, 'setCamera lines', lines.length - frames.length, 'max per-frame step (m): position', maxP.toFixed(3), 'look-at', maxG.toFixed(3), 'at', at, 'modes', [...new Set(frames.map((f) => f.m))].join(','));
console.log(lines.filter((l) => l.startsWith('[camlog] setCamera')).slice(0, 8).join('\n'));
console.log('errors', JSON.stringify(errors));
ws.close(); chrome.kill(); process.exit(0);
