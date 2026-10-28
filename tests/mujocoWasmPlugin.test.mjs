import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedWasm, stripWasmCustomSections } from '../scripts/vite-plugin-mujoco-wasm.mjs';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const TYPE_SECTION = [0x01, 0x01, 0x00]; // id 1, size 1, zero types
const customSection = (name, payload) => {
  const body = [name.length, ...Buffer.from(name), ...payload];
  return [0x00, body.length, ...body];
};

test('stripWasmCustomSections drops debug/name sections and keeps a valid module', () => {
  const input = Uint8Array.from([
    ...HEADER,
    ...customSection('.debug_info', [1, 2, 3]),
    ...TYPE_SECTION,
    ...customSection('name', [4, 5])
  ]);
  const stripped = stripWasmCustomSections(input);
  assert.deepEqual([...stripped], [...HEADER, ...TYPE_SECTION]);
  assert.equal(WebAssembly.validate(stripped), true);
});

test('stripWasmCustomSections rejects non-wasm input', () => {
  assert.throws(() => stripWasmCustomSections(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /Not a WebAssembly binary/);
});

test('extractEmbeddedWasm reads the base64 payload from the Emscripten glue', () => {
  const wasm = Buffer.from([...HEADER, ...TYPE_SECTION]);
  const glue = `function findWasmBinary() {\n  return base64Decode('${wasm.toString('base64')}');\n}`;
  assert.deepEqual([...extractEmbeddedWasm(glue)], [...wasm]);
  assert.equal(extractEmbeddedWasm('function other() {}'), null);
});
