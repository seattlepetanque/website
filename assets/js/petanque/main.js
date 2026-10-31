// Temporary B06 demo: static scene with a jack and a few boules (B07 replaces this).
import { C } from './constants.js';
import { createTerrain } from './terrain.js';
import { createRenderer } from './render.js';

const status = document.querySelector('.petanque-status');
const canvas = document.querySelector('#petanque canvas');

try {
  const terrain = createTerrain(1);
  const renderer = createRenderer(canvas, terrain);
  const mk = (id, kind, team, x, y, r) => ({
    id, kind, team, x, y, z: terrain.sample(x, y).h + r, r, wx: 0, wy: 0, wz: 0, dead: false,
  });
  const bodies = [mk('j', 'jack', -1, 2, 8.5, C.jack.r)];
  [[1.8, 8.3, 0], [2.25, 8.7, 1], [2.1, 8.1, 1], [1.7, 8.8, 0], [2.4, 8.35, 0], [1.95, 9.0, 1]]
    .forEach(([x, y, t], i) => bodies.push(mk('b' + i, 'boule', t, x, y, C.boule.r)));
  renderer.sync({ bodies });
  if (status) status.textContent = '';
  const cam = new URLSearchParams(location.search).get('cam'); // demo: ?cam=head|inspect
  if (cam === 'head') renderer.setCamera('head', { target: { x: 2, y: 8.5 } });
  if (cam === 'inspect') renderer.setCamera('inspect', { target: { x: 2, y: 8.5 }, dist: 1.2 });
  let t = 0, last = performance.now(), switched = false;
  const frame = (now) => {
    const dt = (now - last) / 1000;
    last = now; t += dt;
    if (!cam && !switched && t > 2) { switched = true; renderer.setCamera('head', { target: { x: 2, y: 8.5 } }); }
    renderer.render(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
} catch (err) {
  if (status) status.textContent = err.message;
}
