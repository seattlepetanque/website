// F102: is this a hardware-accelerated WebGL? Pure helpers (node-testable) plus one thin browser probe.
//   isSoftwareRenderer(name)  - SwiftShader, llvmpipe, softpipe, 'Software', 'Microsoft Basic Render' ...
//   assessGpu(info)           - { ok, reason: null | 'nowebgl' | 'software', renderer }
//   weakDevice(nav)           - soft hint only (memory < 4 GB or fewer than 4 cores): start in Low graphics
//   browserName(ua)           - 'Chrome 142' etc, for the support message
//   gpuMessage(info, browser) - { title, lead, detected, howto[] } text for the game area
//   probeGpu(doc)             - the only function that touches the DOM
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function isSoftwareRenderer(name) { return typeof name === 'string' && SOFTWARE.test(name); }

// info: { hasContext, renderer, vendor, caveat }. caveat: a context was refused with failIfMajorPerformanceCaveat
// (the browser itself says WebGL would be software or badly slow) although one works without it.
export function assessGpu(info) {
  const i = info || {};
  if (!i.hasContext) return { ok: false, reason: 'nowebgl', renderer: i.renderer || '' };
  if (isSoftwareRenderer(i.renderer) || i.caveat) return { ok: false, reason: 'software', renderer: i.renderer || '' };
  return { ok: true, reason: null, renderer: i.renderer || '' };
}

export function weakDevice(nav) {
  const n = nav || {};
  return (typeof n.deviceMemory === 'number' && n.deviceMemory < 4) || (typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency > 0 && n.hardwareConcurrency < 4);
}

export function browserName(ua) {
  const s = String(ua || '');
  const m = (re) => { const r = re.exec(s); return r ? r[1] : ''; };
  let name = 'your browser', v = '';
  if (/Edg(e|A|iOS)?\//.test(s)) { name = 'Edge'; v = m(/Edg(?:e|A|iOS)?\/(\d+)/); }
  else if (/OPR\//.test(s)) { name = 'Opera'; v = m(/OPR\/(\d+)/); }
  else if (/Firefox\/|FxiOS\//.test(s)) { name = 'Firefox'; v = m(/(?:Firefox|FxiOS)\/(\d+)/); }
  else if (/Chrome\/|CriOS\//.test(s)) { name = 'Chrome'; v = m(/(?:Chrome|CriOS)\/(\d+)/); }
  else if (/Safari\//.test(s)) { name = 'Safari'; v = m(/Version\/(\d+)/); }
  return v ? name + ' ' + v : name;
}

export function gpuMessage(a, browser) {
  const none = a.reason === 'nowebgl';
  return {
    title: 'The pétanque court needs hardware 3D graphics',
    lead: none
      ? 'This game needs WebGL 3D graphics, and your browser could not start them.'
      : 'This game needs hardware-accelerated WebGL 3D graphics. Your browser is drawing in software, which is far too slow to play.',
    detected: 'Detected: ' + (browser || 'unknown browser') + '; graphics: ' + (a.renderer || (none ? 'no WebGL' : 'unknown')) + '.',
    howto: [
      'Chrome or Edge: Settings, System, turn on "Use graphics acceleration when available", then restart the browser. Check chrome://gpu for the status.',
      'Firefox: Settings, General, Performance, untick "Use recommended performance settings", tick "Use hardware acceleration when available", then restart.',
      'Safari: uses the graphics card by default; update macOS or iOS if this message appears.',
      'Otherwise update your graphics driver, or try another browser or device.',
    ],
  };
}

// Reads the GPU name. Tries a hardware-only context first (failIfMajorPerformanceCaveat), then a plain one.
export function probeGpu(doc) {
  const out = { hasContext: false, renderer: '', vendor: '', caveat: false };
  const get = (cv, caveat) => {
    for (const t of ['webgl2', 'webgl']) {
      try { const gl = cv.getContext(t, { failIfMajorPerformanceCaveat: caveat }); if (gl) return gl; } catch (e) { /* try the next */ }
    }
    return null;
  };
  let hw = null, gl = null;
  try {
    hw = get(doc.createElement('canvas'), true);
    gl = hw || get(doc.createElement('canvas'), false);
    if (gl) {
      out.hasContext = true;
      out.caveat = !hw;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      out.vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) || '');
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    }
  } catch (e) { /* treated as no usable context */ }
  return out;
}
