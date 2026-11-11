Vendored three.js 0.170.0 `build/three.module.min.js` from https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js (saved as `three.module.js`), license in `three.LICENSE` (MIT).


Vendored three.js r170 `examples/jsm/loaders/GLTFLoader.js` (from https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js) as `GLTFLoader.js`, and its only dependency `examples/jsm/utils/BufferGeometryUtils.js` (from https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js) as `BufferGeometryUtils.js` (both MIT, same licence as three.js, see `three.LICENSE`). Only edits: the `from 'three'` imports now read `from './three.module.js'`, and GLTFLoader's `'../utils/BufferGeometryUtils.js'` import now reads `'./BufferGeometryUtils.js'`. No other changes.
