// F111: the one place that owns the ?debug flag.
// `debug` is a free identifier in every module that uses it. Hugo's js.Build defines it (layouts/_default/game.html): the literal
// false in a production build, so esbuild drops every `debug ? ... : ...` / `if (debug)` branch together with its strings; under
// `hugo server` and development builds it is globalThis.__dbg, which is set below from ?debug. Under node (tests) there is no
// define, so the second line makes the bare name resolve to false. Import this module (first) from every module that reads `debug`.
if (globalThis.__DEBUG__ !== false && typeof location !== 'undefined') globalThis.__dbg = new URLSearchParams(location.search).has('debug');
if (typeof debug === 'undefined') globalThis.debug = false;

// ?debug&NAME=value switches. Call sites that must vanish from production write `debug ? dbgParam('name') : null`, so the
// string literal sits in a dropped branch (a function call cannot be dropped by the bundler).
export function dbgParam(name) {
  try { return debug && typeof location !== 'undefined' ? new URLSearchParams(location.search).get(name) : null; } catch (e) { return null; }
}

// ?debug&NAME present (with any value); guard call sites the same way.
export function dbgHas(name) {
  try { return !!debug && typeof location !== 'undefined' && new URLSearchParams(location.search).has(name); } catch (e) { return false; }
}
