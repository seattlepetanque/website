// F102: software renderer detection over sample renderer strings
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRenderer, assessGpu, weakDevice, browserName, gpuMessage, probeGpu } from '../../assets/js/petanque/gpuinfo.js';

test('software renderers are recognised', () => {
  for (const s of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa softpipe', 'Microsoft Basic Render Driver',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple Software Renderer', 'Google SwiftShader',
  ]) assert.equal(isSoftwareRenderer(s), true, s);
});
test('hardware renderers are not', () => {
  for (const s of [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Apple GPU', 'Mali-G78', 'Adreno (TM) 640',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel(R) UHD Graphics 620', 'AMD Radeon Pro 5500M OpenGL Engine', '', undefined, null,
  ]) assert.equal(isSoftwareRenderer(s), false, String(s));
});
test('assessGpu: no context, software by name, software by caveat, ok', () => {
  assert.deepEqual(assessGpu({ hasContext: false }), { ok: false, reason: 'nowebgl', renderer: '' });
  assert.equal(assessGpu({ hasContext: true, renderer: 'llvmpipe' }).reason, 'software');
  assert.equal(assessGpu({ hasContext: true, renderer: 'Apple GPU', caveat: true }).reason, 'software');
  assert.equal(assessGpu({ hasContext: true, renderer: 'Apple GPU' }).ok, true);
  assert.equal(assessGpu(undefined).reason, 'nowebgl');
});
test('weakDevice: soft hints only when the browser reports them', () => {
  assert.equal(weakDevice({ deviceMemory: 2, hardwareConcurrency: 8 }), true);
  assert.equal(weakDevice({ deviceMemory: 8, hardwareConcurrency: 2 }), true);
  assert.equal(weakDevice({ deviceMemory: 4, hardwareConcurrency: 4 }), false);
  assert.equal(weakDevice({}), false); // Safari, Firefox: unknown is not weak
  assert.equal(weakDevice(undefined), false);
});
test('browserName', () => {
  assert.equal(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'), 'Chrome 142');
  assert.equal(browserName('Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.2535.1'), 'Edge 141');
  assert.equal(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox 130');
  assert.equal(browserName('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'), 'Safari 17');
  assert.equal(browserName(''), 'your browser');
});
test('gpuMessage names what is needed, what was detected and how to fix it', () => {
  const m = gpuMessage({ reason: 'software', renderer: 'SwiftShader' }, 'Chrome 142');
  assert.match(m.lead, /hardware/);
  assert.match(m.detected, /Chrome 142/); assert.match(m.detected, /SwiftShader/);
  assert.ok(m.howto.length >= 3 && m.howto.some((h) => /acceleration/.test(h)));
  assert.match(gpuMessage({ reason: 'nowebgl' }, '').lead, /could not start/);
});
test('probeGpu with fake canvases: caveat and renderer name', () => {
  const mk = (hwOk, name) => ({ createElement: () => ({ getContext: (t, o) => (o.failIfMajorPerformanceCaveat && !hwOk ? null : {
    getExtension: (e) => (e === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 } : null),
    getParameter: (p) => (p === 1 ? name : 'v'), RENDERER: 0, VENDOR: 0 }) }) });
  assert.deepEqual(probeGpu(mk(true, 'Apple GPU')), { hasContext: true, renderer: 'Apple GPU', vendor: 'v', caveat: false });
  assert.equal(probeGpu(mk(false, 'SwiftShader')).caveat, true);
  assert.equal(probeGpu({ createElement: () => ({ getContext: () => null }) }).hasContext, false);
});
