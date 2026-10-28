import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const indexHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

/** @param {string} directive */
function getCspDirective(directive) {
  const match = indexHtml.match(
    new RegExp(`Content-Security-Policy"[^>]*content="[\\s\\S]*?${directive}\\s+([^;"]+)`)
  );
  return match?.[1]?.trim() ?? '';
}

test('CSP script-src allows Emscripten glue (MuJoCo / ONNX Runtime Web)', () => {
  const scriptSrc = getCspDirective('script-src');
  assert.match(
    scriptSrc,
    /'unsafe-eval'/,
    "script-src must include 'unsafe-eval': Emscripten uses new Function() at runtime; wasm-unsafe-eval alone is insufficient"
  );
  assert.match(
    scriptSrc,
    /'wasm-unsafe-eval'/,
    "script-src must include 'wasm-unsafe-eval' for WebAssembly compilation"
  );
});

test('index.html has no inline event handlers (CSP blocks them)', () => {
  // script-src has no 'unsafe-inline' / 'unsafe-hashes', so an attribute such
  // as onload="…" is silently dropped — this once left Google Fonts disabled.
  const withoutComments = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
  const handlers = withoutComments.match(/<[^>]*\son[a-z]+\s*=/gi) ?? [];
  assert.deepEqual(handlers, []);
});
