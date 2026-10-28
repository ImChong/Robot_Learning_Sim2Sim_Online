/**
 * Read a fetch Response body and report progress (0..1) when Content-Length is known.
 * @param {Response} response
 * @param {(ratio: number) => void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function readResponseBodyWithProgress(response, onProgress) {
  const total = Number(response.headers.get('content-length'));
  const hasTotal = Number.isFinite(total) && total > 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    onProgress?.(1);
    return buf;
  }

  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value && value.length) {
      chunks.push(value);
      loaded += value.length;
      if (hasTotal) {
        onProgress?.(Math.min(1, loaded / total));
      }
    }
  }

  if (!hasTotal) {
    onProgress?.(1);
  } else {
    onProgress?.(1);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when `bytes` starts with the gzip magic number. */
export function isGzipData(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Inflate gzip data with the browser's DecompressionStream.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {string} url
 * @param {(ratio: number) => void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function fetchUint8ArrayWithProgress(url, onProgress, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return await readResponseBodyWithProgress(response, onProgress);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @param {string} url
 * @param {(ratio: number) => void} [onProgress]
 * @returns {Promise<string>}
 */
export async function fetchTextWithProgress(url, onProgress) {
  const bytes = await fetchUint8ArrayWithProgress(url, onProgress);
  return new TextDecoder('utf-8').decode(bytes);
}

const textCache = new Map();

/**
 * Like fetchTextWithProgress, but each URL is fetched once per page session, so small config
 * files (policy / scene / motion index JSON) cost no round trip when switching policies again.
 * @param {string} url
 * @param {(ratio: number) => void} [onProgress]
 * @returns {Promise<string>}
 */
export function fetchTextCached(url, onProgress) {
  let promise = textCache.get(url);
  if (promise) {
    promise.then(() => onProgress?.(1), () => {});
    return promise;
  }
  promise = fetchTextWithProgress(url, onProgress);
  textCache.set(url, promise);
  promise.catch(() => textCache.delete(url));
  return promise;
}

/**
 * Track parallel downloads: each task reports local 0..1; weights should sum to 1.
 * @param {number[]} weights
 * @param {(overall: number) => void} [onOverall]
 * @returns {(taskIndex: number, localRatio: number) => void}
 */
export function createWeightedProgressReporter(weights, onOverall) {
  if (!onOverall || weights.length === 0) {
    return () => {};
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const norm = weights.map((w) => w / sum);
  const state = new Float64Array(weights.length);
  const report = () => {
    let acc = 0;
    for (let i = 0; i < state.length; i++) {
      acc += norm[i] * state[i];
    }
    onOverall(Math.min(1, Math.max(0, acc)));
  };
  return (taskIndex, localRatio) => {
    if (taskIndex < 0 || taskIndex >= state.length) {
      return;
    }
    state[taskIndex] = Math.min(1, Math.max(0, localRatio));
    report();
  };
}
