import * as ort from 'onnxruntime-web/wasm';
import { readResponseBodyWithProgress } from './fetchWithProgress.js';
import { parseOnnxArchitecture } from './onnxArchitecture.js';
import { releaseOnnxSession } from './hostDemoLifecycle.js';

/**
 * Smallest valid ONNX model (opset 13, one float `Identity` node). Creating a session from it
 * makes ORT download, compile and initialize its WebAssembly runtime, which ORT otherwise only
 * starts after the real model has finished downloading.
 */
const WARMUP_MODEL_BASE64 = 'CAc6NwoQCgF4EgF5IghJZGVudGl0eRIBZ1oPCgF4EgoKCAgBEgQKAggBYg8KAXkSCgoICAESBAoCCAFCAhAN';
let ortRuntimeWarmup = null;

function warmUpOrtRuntime() {
  ortRuntimeWarmup ??= ort.InferenceSession.create(
    Uint8Array.from(atob(WARMUP_MODEL_BASE64), (c) => c.charCodeAt(0)),
    { executionProviders: ['wasm'] }
  ).then(releaseOnnxSession, (error) => {
    console.warn('ORT runtime warm-up failed:', error);
  });
}

/**
 * Download an ONNX model and create its session, initializing the ORT runtime in parallel.
 * @param {(ratio: number) => void} [onProgress]
 */
async function loadOnnxModel(modelPath, onProgress) {
  warmUpOrtRuntime();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let modelResponse;
  try {
    modelResponse = await fetch(modelPath, { signal: controller.signal });
    if (!modelResponse.ok) {
      throw new Error(`Failed to fetch ONNX model ${modelPath}: ${modelResponse.status}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
  const bytes = await readResponseBodyWithProgress(modelResponse, (r) => {
    onProgress?.(0.82 * r);
  });
  const architecture = parseOnnxArchitecture(bytes);

  onProgress?.(0.88);
  const session = await ort.InferenceSession.create(bytes.slice().buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  return { architecture, session };
}

/** @type {{ path: string, promise: Promise<{ architecture: unknown, session: ort.InferenceSession }> } | null} */
let preloadedModel = null;

/**
 * Start loading a model ahead of ONNXModule.init() (e.g. while the MuJoCo scene downloads).
 * Only the most recent preload is kept; an unused one is released.
 */
export function preloadOnnxModel(modelPath) {
  if (!modelPath || preloadedModel?.path === modelPath) {
    return;
  }
  discardPreloadedOnnxModel();
  const promise = loadOnnxModel(modelPath);
  // Errors resurface when ONNXModule.init() retries without the preload.
  promise.catch(() => {});
  preloadedModel = { path: modelPath, promise };
}

export function discardPreloadedOnnxModel() {
  if (!preloadedModel) {
    return;
  }
  const { promise } = preloadedModel;
  preloadedModel = null;
  promise.then(({ session }) => releaseOnnxSession(session), () => {});
}

function takePreloadedOnnxModel(modelPath) {
  if (preloadedModel?.path !== modelPath) {
    return null;
  }
  const { promise } = preloadedModel;
  preloadedModel = null;
  return promise.catch(() => null);
}

export class ONNXModule {
  constructor(config) {
    this.modelPath = config.path;
    this.metaData = config.meta;
    this.isRecurrent = config.meta.in_keys.includes("adapt_hx");
    this._onnxInput = {};
    this._result = {};
    this._carry = {};
    this._emptyCarry = {};
    this.architecture = null;
    this._inferenceOutput = [null, this._carry];
    this._inferenceOutputEmpty = [null, this._emptyCarry];
    console.log("isRecurrent", this.isRecurrent);
  }

  /**
   * @param {(ratio: number) => void} [onProgress] ratio in [0,1] for download + WASM session init
   */
  async init(onProgress) {
    const preloaded = await takePreloadedOnnxModel(this.modelPath);
    const { architecture, session } = preloaded ?? await loadOnnxModel(this.modelPath, onProgress);
    onProgress?.(1);
    this.architecture = architecture;
    this.session = session;

    this.inKeys = this.metaData["in_keys"];
    this.outKeys = this.metaData["out_keys"];

    console.log('ONNX model loaded successfully');
    console.log("inKeys", this.inKeys);
    console.log("outKeys", this.outKeys);

    console.log("inputNames", this.session.inputNames);
    console.log("outputNames", this.session.outputNames);
  }

  async release() {
    await releaseOnnxSession(this.session);
    this.session = null;
  }

  initInput() {
    if (this.isRecurrent) {
      if (!this._isInitTrue) {
        this._isInitTrue = new ort.Tensor('bool', [true], [1]);
        this._isInitFalse = new ort.Tensor('bool', [false], [1]);
      }
      return {
        is_init: this._isInitTrue,
        adapt_hx: new ort.Tensor('float32', new Float32Array(128), [1, 128])
      };
    }
    return {};
  }

  async runInference(input) {
    const onnxInput = this._onnxInput;
    for (let i = 0; i < this.inKeys.length; i++) {
      onnxInput[this.session.inputNames[i]] = input[this.inKeys[i]];
    }
    const onnxOutput = await this.session.run(onnxInput);
    const result = this._result;
    for (let i = 0; i < this.outKeys.length; i++) {
      result[this.outKeys[i]] = onnxOutput[this.session.outputNames[i]];
    }
    if (this.isRecurrent) {
      this._carry.is_init = this._isInitFalse;
      this._carry.adapt_hx = result['next,adapt_hx'];
      this._inferenceOutput[0] = result;
      return this._inferenceOutput;
    }
    this._inferenceOutputEmpty[0] = result;
    return this._inferenceOutputEmpty;
  }
}
