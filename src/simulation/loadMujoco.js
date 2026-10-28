import loadMujocoModule from 'mujoco-js';
import mujocoWasmUrl from 'virtual:mujoco-wasm';

/** Fetch and instantiate the stripped MuJoCo wasm (see scripts/vite-plugin-mujoco-wasm.mjs). */
async function instantiateMujocoWasm(imports) {
  const response = await fetch(mujocoWasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch MuJoCo wasm ${mujocoWasmUrl}: ${response.status}`);
  }
  // Streaming compiles while downloading (and enables V8's wasm code cache), but needs the wasm MIME type.
  const isWasmMime = response.headers.get('Content-Type')?.startsWith('application/wasm');
  if (isWasmMime && typeof WebAssembly.instantiateStreaming === 'function') {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance;
  }
  return (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance;
}

/** Load the MuJoCo Emscripten module with the externally served wasm binary. */
export default function loadMujoco() {
  return new Promise((resolve, reject) => {
    loadMujocoModule({
      instantiateWasm(imports, receiveInstance) {
        instantiateMujocoWasm(imports).then((instance) => receiveInstance(instance), reject);
        return {};
      }
    }).then(resolve, reject);
  });
}
