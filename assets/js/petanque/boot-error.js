// F114: which kind of boot failure an error is. 'webgl' = no WebGL or context creation failed (render.js throws these);
// anything else is an unexpected failure and must not be blamed on the browser's graphics.
export function classifyBootError(err) {
  const msg = err && typeof err.message === 'string' ? err.message : '';
  return /^WebGL is not available in this browser\b/.test(msg) ? 'webgl' : 'other';
}
