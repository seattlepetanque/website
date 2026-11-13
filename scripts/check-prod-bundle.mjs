// F84: builds the site twice (production and development) and checks the game bundle.
// Production must not contain any debug-only URL flag or console tag; development must still contain them.
// Usage: npm run check:prod   (needs hugo on PATH)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Strings that only the ?debug code uses (quotes included, so they match the URL-flag reads, not comments or CSS).
const DEBUG_ONLY = ['"mescenario"', '"freezethrow"', '"humanturn"', '"timerframes"', '"jackvis"', '"showtarget"', '"aispot"',
  '"ailog"', '"holdhead"', '"topcam"', '"autotest"', '"fpcam"', '"ringcarry"', '"f02skip"', '"viewyaw"', '"jackshot"',
  '"golden"', '"meneend"', '"sounds"', '"[ailog]', '"[hard cap]', '"[placeJack]', '"debug"',
  // F111: the debug-scenarios module (scenarios, window.__petanque hook) and the debug switches read in other modules
  '__petanque', '__characters', '"mene2"', '"mescenario"', '"characters"', '"jphold"', '"closecall"', '"preview"', '"fpmirror"', '"fpat"', '"pausegame"',
  '"exitclick"', '"f02delay"', '"ringheld"', '"deadjack"', '"measure"', '"tvshot"', '"bshot"',
  '"gfx"', '"fakegpu"', '"bootfail"', '"weak"', '[quality]', '"hideshadows"', '"aimlog"', '[aimlog]', '"shadowhalf"', '"shadowmap"', '"shadowtype"', '"gravel"', '"blobs"', '"butterflies"'];

function build(env) {
  const dir = mkdtempSync(join(tmpdir(), `petanque-${env}-`));
  execFileSync('hugo', ['--environment', env, '--destination', dir, '--quiet'], { stdio: 'inherit' });
  const js = join(dir, 'js', 'petanque');
  const f = readdirSync(js).find((n) => /^main\..*\.js$/.test(n));
  if (!f) throw new Error(`no game bundle in ${js}`);
  const text = readFileSync(join(js, f), 'utf8');
  const size = statSync(join(js, f)).size;
  rmSync(dir, { recursive: true, force: true });
  return { text, size };
}

const prod = build('production');
const dev = build('development');
let bad = 0;
for (const s of DEBUG_ONLY) {
  const inProd = prod.text.includes(s), inDev = dev.text.includes(s);
  if (inProd) { console.error(`FAIL production bundle contains ${s}`); bad++; }
  if (!inDev) { console.error(`FAIL development bundle lacks ${s} (the list is stale or ?debug broke)`); bad++; }
}
console.log(`production ${prod.size} bytes, development ${dev.size} bytes`);
if (bad) process.exit(1);
console.log(`ok: ${DEBUG_ONLY.length} debug-only strings absent from production, present in development`);
