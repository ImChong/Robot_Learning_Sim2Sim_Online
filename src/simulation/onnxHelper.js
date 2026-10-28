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
  return { architecture, session, byteLength: bytes.byteLength };
}

/**
 * Sessions of models released by a policy switch, or preloaded but not used yet, kept for
 * reuse (least recently used first out, bounded by model size): switching back to a policy
 * skips the download and session creation.
 */
const MODEL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const modelCache = new Map();
/** Loads started by preloadOnnxModel() that no ONNXModule has taken yet. */
const pendingModels = new Map();
/** Bumped by releaseCachedOnnxModels() so loads finishing after a teardown are dropped. */
let cacheEpoch = 0;

function cacheOnnxModel(modelPath, model) {
  const previous = modelCache.get(modelPath);
  modelCache.delete(modelPath);
  if (previous && previous.session !== model.session) {
    releaseOnnxSession(previous.session);
  }
  modelCache.set(modelPath, model);
  let total = 0;
  for (const entry of modelCache.values()) {
    total += entry.byteLength;
  }
  for (const [path, entry] of modelCache) {
    if (total <= MODEL_CACHE_MAX_BYTES || entry === model) {
      break;
    }
    modelCache.delete(path);
    total -= entry.byteLength;
    releaseOnnxSession(entry.session);
  }
}

function takeCachedOnnxModel(modelPath) {
  const model = modelCache.get(modelPath) ?? null;
  modelCache.delete(modelPath);
  return model;
}

function takePendingOnnxModel(modelPath) {
  const promise = pendingModels.get(modelPath);
  if (!promise) {
    return null;
  }
  pendingModels.delete(modelPath);
  // On failure ONNXModule.init() loads again, surfacing the error.
  return promise.catch(() => null);
}

/** Release every cached and pending session (e.g. when the host demo is torn down). */
export function releaseCachedOnnxModels() {
  cacheEpoch += 1;
  pendingModels.clear();
  for (const { session } of modelCache.values()) {
    releaseOnnxSession(session);
  }
  modelCache.clear();
}

/**
 * Start loading a model (download + session) ahead of ONNXModule.init(), e.g. while the
 * MuJoCo scene downloads or when the user hovers a policy. If no module takes it, the
 * result goes to the session cache.
 */
export function preloadOnnxModel(modelPath) {
  if (!modelPath || modelCache.has(modelPath) || pendingModels.has(modelPath)) {
    return;
  }
  const epoch = cacheEpoch;
  const promise = loadOnnxModel(modelPath);
  pendingModels.set(modelPath, promise);
  promise.then((model) => {
    if (pendingModels.get(modelPath) !== promise) {
      // Taken by ONNXModule.init(), or dropped by a teardown.
      if (epoch !== cacheEpoch) {
        releaseOnnxSession(model.session);
      }
      return;
    }
    pendingModels.delete(modelPath);
    cacheOnnxModel(modelPath, model);
  }, () => {
    if (pendingModels.get(modelPath) === promise) {
      pendingModels.delete(modelPath);
    }
  });
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
    const model = takeCachedOnnxModel(this.modelPath)
      ?? await takePendingOnnxModel(this.modelPath)
      ?? await loadOnnxModel(this.modelPath, onProgress);
    onProgress?.(1);
    this._model = model;
    this.architecture = model.architecture;
    this.session = model.session;

    this.inKeys = this.metaData["in_keys"];
    this.outKeys = this.metaData["out_keys"];

    console.log('ONNX model loaded successfully');
    console.log("inKeys", this.inKeys);
    console.log("outKeys", this.outKeys);

    console.log("inputNames", this.session.inputNames);
    console.log("outputNames", this.session.outputNames);
  }

  /** Hand the session back to the model cache; releaseCachedOnnxModels() frees it. */
  async release() {
    if (this._model) {
      cacheOnnxModel(this.modelPath, this._model);
    }
    this._model = null;
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
