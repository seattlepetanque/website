// Background loading of the Kenney "Mini Characters" GLBs (static/models/<name>.glb, CC0).
// Each file is fetched once; every request parses its own copy, so a model can be used by several characters.
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export const MODEL_TIMEOUT = 5000; // ms before a character keeps its stick figure
const MODEL_URL = (name) => '/models/' + name + '.glb';
const bytes = new Map(); // name -> Promise<ArrayBuffer>

function fetchBytes(name) {
  if (!bytes.has(name)) {
    bytes.set(name, fetch(MODEL_URL(name)).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }));
  }
  return bytes.get(name);
}

const withTimeout = (p, ms, label) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(label + ' timed out')), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// -> Promise<THREE.Group>; rejects on any failure or after the timeout
export function loadModel(name, timeout = MODEL_TIMEOUT) {
  const job = fetchBytes(name).then((buf) => new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, '/models/', (gltf) => resolve(gltf.scene), reject);
  }));
  return withTimeout(job, timeout, name + '.glb');
}

// Swap meshes into characters in the background. `wanted` is [{ ch, model }]; a failure leaves the stick figure.
export function attachModels(wanted, timeout = MODEL_TIMEOUT) {
  return Promise.all(wanted.map(({ ch, model }) => loadModel(model, timeout).then(
    (scene) => { ch.attachModel(scene, model); return true; },
    (err) => { console.warn('petanque: model "' + model + '" failed, keeping the stick figure:', err.message || err); return false; },
  )));
}
