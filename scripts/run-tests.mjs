// Test runner: `npm test` runs two phases so timing-sensitive tests are not starved by parallel load.
//   phase 1 (parallel):  every other test file, limited concurrency (half the cores, at least 2)
//   phase 2 (serial):    timing-sensitive files, one at a time with --test-concurrency=1
// Exit code is non-zero if either phase fails. New *.test.js files under tests/ are picked up automatically.
//
// A file runs in the serial phase if ANY of these is true:
//   1. its first 5 lines contain a `// @serial` comment (preferred way to mark a file)
//   2. it reads a clock (performance.now / Date.now), i.e. asserts a time threshold
//   3. it imports the AI planner or tactics (ai.js / tactics.js): the planner stops at a wall-clock
//      time guard (AI.timeGuardMs), so seeded results and match speed depend on CPU load
//   4. it is listed in EXTRA_SERIAL below
// Usage: node scripts/run-tests.mjs [all|fast|serial] [--list]
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

const EXTRA_SERIAL = []; // file names to force into the serial phase, e.g. 'court-match.test.js'

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.test.js') ? [join(d, e.name)] : []);
const files = walk('tests').sort();
const isSerial = (f) => {
  const src = readFileSync(f, 'utf8');
  return EXTRA_SERIAL.some((n) => f.endsWith(n))
    || src.split('\n', 5).some((l) => /^\/\/\s*@serial\b/.test(l))
    || /performance\.now|Date\.now/.test(src)
    || /from\s+'[^']*\/(ai|tactics)\.js'/.test(src);
};
const serial = files.filter(isSerial);
const fast = files.filter((f) => !isSerial(f));
const conc = Math.max(2, Math.floor(availableParallelism() / 2));

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) || 'all';
if (args.includes('--list')) { console.log('fast:\n ' + fast.join('\n ') + '\nserial:\n ' + serial.join('\n ')); process.exit(0); }

const run = (list, concurrency) => list.length === 0 ? 0 :
  spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...list], { stdio: 'inherit' }).status ?? 1;

let status = 0;
if (mode === 'fast' || mode === 'all') status = run(fast, conc);
if (mode === 'serial' || mode === 'all') status = run(serial, 1) || status;
process.exit(status);
