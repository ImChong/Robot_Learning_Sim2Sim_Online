/**
 * Vite plugin: serve the MuJoCo WebAssembly binary as a separate, stripped `.wasm` asset.
 *
 * `mujoco-js` ships a SINGLE_FILE Emscripten build: an ~8 MB wasm binary embedded as a
 * ~10.7 MB base64 string inside `mujoco_wasm.js`, and more than half of that binary is
 * DWARF / name debug sections. This plugin
 *   - extracts the binary, drops all custom sections (debug info only, never executed),
 *   - emits it as a hashed asset (build) or serves it from memory (dev),
 *   - exposes its URL via `import url from 'virtual:mujoco-wasm'`,
 *   - removes the base64 payload from the bundled JS (build).
 * The app then instantiates it with `WebAssembly.instantiateStreaming` through the
 * Emscripten `instantiateWasm` hook (see src/simulation/loadMujoco.js).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const VIRTUAL_ID = 'virtual:mujoco-wasm';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const MUJOCO_JS_RE = /[\\/]mujoco-js[\\/]dist[\\/]mujoco_wasm\.js$/;
const EMBEDDED_WASM_RE = /(function findWasmBinary\(\) \{\s*return base64Decode\(')([A-Za-z0-9+/=]+)('\);)/;
const DEV_PATH = '__mujoco_wasm/mujoco_wasm.wasm';
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

function readLeb128(bytes, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    const byte = bytes[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) {
      return { value: result, next: pos };
    }
  }
}

/** Remove every custom section (id 0: name, producers, .debug_*). Semantics are unchanged. */
export function stripWasmCustomSections(bytes) {
  if (WASM_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('Not a WebAssembly binary');
  }
  const kept = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const sectionStart = offset;
    const id = bytes[offset];
    const { value: size, next } = readLeb128(bytes, offset + 1);
    offset = next + size;
    if (offset > bytes.length) {
      throw new Error('Truncated WebAssembly section');
    }
    if (id !== 0) {
      kept.push(bytes.subarray(sectionStart, offset));
    }
  }
  return Buffer.concat(kept);
}

/** Pull the embedded base64 wasm out of mujoco_wasm.js; returns null if the layout changed. */
export function extractEmbeddedWasm(code) {
  const match = EMBEDDED_WASM_RE.exec(code);
  return match ? Buffer.from(match[2], 'base64') : null;
}

export default function mujocoWasmPlugin() {
  let isBuild = false;
  let base = '/';
  let wasmPromise = null;

  function loadStrippedWasm() {
    wasmPromise ??= (async () => {
      const mujocoJsPath = createRequire(import.meta.url).resolve('mujoco-js');
      const embedded = extractEmbeddedWasm(await readFile(mujocoJsPath, 'utf8'));
      if (!embedded) {
        throw new Error(`[mujoco-wasm] embedded wasm not found in ${mujocoJsPath}; update scripts/vite-plugin-mujoco-wasm.mjs`);
      }
      return stripWasmCustomSections(embedded);
    })();
    return wasmPromise;
  }

  return {
    name: 'mujoco-wasm',
    enforce: 'pre',
    configResolved(config) {
      isBuild = config.command === 'build';
      base = config.base;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return null;
      }
      if (!isBuild) {
        return `export default ${JSON.stringify(`${base}${DEV_PATH}`)};`;
      }
      const ref = this.emitFile({
        type: 'asset',
        name: 'mujoco_wasm.wasm',
        source: await loadStrippedWasm()
      });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    transform(code, id) {
      if (!isBuild || !MUJOCO_JS_RE.test(id)) {
        return null;
      }
      if (!EMBEDDED_WASM_RE.test(code)) {
        this.error('[mujoco-wasm] embedded wasm not found in mujoco_wasm.js; update scripts/vite-plugin-mujoco-wasm.mjs');
      }
      // The binary is loaded via Module.instantiateWasm, so the inline copy is dead weight.
      return { code: code.replace(EMBEDDED_WASM_RE, '$1$3'), map: null };
    },
    configureServer(server) {
      server.middlewares.use(`${base}${DEV_PATH}`, async (_req, res, next) => {
        try {
          const wasm = await loadStrippedWasm();
          res.setHeader('Content-Type', 'application/wasm');
          res.end(wasm);
        } catch (error) {
          next(error);
        }
      });
    }
  };
}
