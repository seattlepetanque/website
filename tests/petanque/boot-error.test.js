// F114: boot errors are classified so only missing WebGL is blamed on the browser
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBootError } from '../../assets/js/petanque/boot-error.js';

test('the render.js WebGL errors classify as webgl', () => {
  assert.equal(classifyBootError(new Error('WebGL is not available in this browser, so the 3D game cannot start.')), 'webgl');
});
test('every other failure classifies as other', () => {
  assert.equal(classifyBootError(new TypeError("Cannot read properties of undefined (reading 'x')")), 'other');
  assert.equal(classifyBootError(new Error('WebGL context lost')), 'other');
  assert.equal(classifyBootError(new Error('Something about WebGL is not available')), 'other');
  assert.equal(classifyBootError(new Error('')), 'other');
  assert.equal(classifyBootError('WebGL is not available in this browser, so the 3D game cannot start.'), 'other');
  assert.equal(classifyBootError(undefined), 'other');
  assert.equal(classifyBootError(null), 'other');
  assert.equal(classifyBootError({}), 'other');
});
