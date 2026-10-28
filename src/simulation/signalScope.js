import { clampScopeWindowSeconds } from '../utils/scopeWindowPreference.js';
import { registerObsNodeOffsets } from './pipelineObsNodes.js';
import { shortJointName } from './jointLabels.js';
import { MAX_SCOPE_CHANNELS, scopeChannelColor } from './scopeChannels.js';

const DEFAULT_CAPACITY = 3000;
export const DEFAULT_WINDOW_SECONDS = 20;
export const MIN_WINDOW_SECONDS = 10;

export { MAX_SCOPE_CHANNELS, SCOPE_CHANNEL_COLORS, scopeChannelColor } from './scopeChannels.js';

export function buildProbeId(nodeId, lineKey) {
  return `${nodeId}:${lineKey}`;
}

export function parseProbeId(probeId) {
  const idx = probeId.lastIndexOf(':');
  if (idx <= 0) {
    return { nodeId: probeId, lineKey: '' };
  }
  return {
    nodeId: probeId.slice(0, idx),
    lineKey: probeId.slice(idx + 1)
  };
}

// Joint names never change for a loaded policy, so the short-name → index
// lookup is built once per runner instead of scanned per channel per sample.
const jointIndexCache = new WeakMap();

function getJointIndexLookup(runner) {
  if (!runner) {
    return null;
  }
  const names = runner.policyJointNames ?? [];
  const cached = jointIndexCache.get(runner);
  if (cached && cached.names === names) {
    return cached.map;
  }
  const map = new Map();
  for (let i = 0; i < names.length; i++) {
    map.set(shortJointName(names[i]), i);
  }
  jointIndexCache.set(runner, { names, map });
  return map;
}

function findJointIndex(jointIndex, lineKey) {
  if (!jointIndex || !lineKey) {
    return -1;
  }
  const idx = jointIndex.get(lineKey);
  return idx === undefined ? -1 : idx;
}

const VEC3_COMPONENT_INDEX = { x: 0, y: 1, z: 2 };
// Quaternions are stored as [w, x, y, z], so the components shift by one.
const QUAT_COMPONENT_INDEX = { w: 0, x: 1, y: 2, z: 3 };

function vecComponent(values, key, map = VEC3_COMPONENT_INDEX) {
  const idx = map[key];
  if (idx === undefined || !values?.length) {
    return NaN;
  }
  return Number(values[idx]);
}

/**
 * Offset of the newest frame inside the observation buffer.
 * fullObs holds [oldest … newest] (PolicyRunner shifts frames forward), so a
 * within-frame offset has to be rebased or the scope plots the oldest frame.
 */
function obsFrameBase(runner) {
  const historyLength = runner?.historyLength ?? 1;
  if (historyLength > 1) {
    return (historyLength - 1) * (runner.numObs ?? 0);
  }
  return 0;
}

function readObsScalar(runner, offset) {
  if (!runner || !Number.isInteger(offset) || offset < 0) {
    return NaN;
  }
  const data = runner.historyLength > 1 ? runner.fullObs : runner.obsForPolicy;
  const index = obsFrameBase(runner) + offset;
  if (!data || index >= data.length) {
    return NaN;
  }
  return Number(data[index]);
}

/**
 * Resolve a probed signal to a scalar from the live policy runner + demo.
 * @param {import('./policyRunner.js').PolicyRunner | null} runner
 * @param {import('./main.js').MuJoCoDemo | null} demo
 * @param {{ nodeId: string, lineKey: string }} probe
 * @param {{ state?: object | null, obsLookup?: Map | null } | null} [context]
 *   Per-sample cache shared by every channel of one sample. A full joint node
 *   plots dozens of channels, so re-reading the policy state and rebuilding the
 *   observation layout per channel would be O(channels²) work each tick.
 */
export function resolveSignalValue(runner, demo, probe, context = null) {
  if (!runner || !probe?.nodeId) {
    return NaN;
  }
  const { nodeId, lineKey } = probe;
  const state = context && 'state' in context
    ? context.state
    : (demo?.readPolicyState?.() ?? null);
  const jointIndex = getJointIndexLookup(runner);

  if (nodeId === 'sim-cmd-vx') return Number(state?.cmd?.[0] ?? 0);
  if (nodeId === 'sim-cmd-vy') return Number(state?.cmd?.[1] ?? 0);
  if (nodeId === 'sim-cmd-yaw') return Number(state?.cmd?.[2] ?? 0);

  if (nodeId === 'sim-root-pos') return vecComponent(state?.rootPos, lineKey);
  if (nodeId === 'sim-root-angvel') return vecComponent(state?.rootAngVel, lineKey);
  if (nodeId === 'sim-root-quat') {
    return vecComponent(state?.rootQuat, lineKey, QUAT_COMPONENT_INDEX);
  }

  if (nodeId === 'sim-joint-pos') {
    const idx = findJointIndex(jointIndex, lineKey);
    return idx >= 0 ? Number(state?.jointPos?.[idx] ?? NaN) : NaN;
  }
  if (nodeId === 'sim-joint-vel') {
    const idx = findJointIndex(jointIndex, lineKey);
    return idx >= 0 ? Number(state?.jointVel?.[idx] ?? NaN) : NaN;
  }

  if (nodeId === 'prep-joint-rel') {
    const idx = findJointIndex(jointIndex, lineKey);
    return idx >= 0 ? Number(runner.cachedJointPosRel?.[idx] ?? NaN) : NaN;
  }

  if (nodeId === 'out-action') {
    const idx = findJointIndex(jointIndex, lineKey);
    return idx >= 0 ? Number(runner.lastActions?.[idx] ?? NaN) : NaN;
  }
  if (nodeId === 'out-target') {
    const idx = findJointIndex(jointIndex, lineKey);
    return idx >= 0 ? Number(runner.target?.[idx] ?? NaN) : NaN;
  }

  if (nodeId === 'motor-torque') {
    const idx = findJointIndex(jointIndex, lineKey);
    if (idx < 0) {
      return NaN;
    }
    const qposAdr = demo?.qpos_adr_policy?.[idx];
    const qvelAdr = demo?.qvel_adr_policy?.[idx];
    const target = demo?.actionTarget?.[idx] ?? runner.target?.[idx] ?? 0;
    const qpos = Number.isInteger(qposAdr) ? demo.simulation.qpos[qposAdr] : 0;
    const qvel = Number.isInteger(qvelAdr) ? demo.simulation.qvel[qvelAdr] : 0;
    const kp = demo?.kpPolicy?.[idx] ?? 0;
    const kd = demo?.kdPolicy?.[idx] ?? 0;
    const ctrlAdr = demo?.ctrl_adr_policy?.[idx];
    const torque = kp * (target - qpos) + kd * (0 - qvel);
    return Number.isInteger(ctrlAdr) ? demo.simulation.ctrl[ctrlAdr] : torque;
  }

  if (nodeId.startsWith('obs-')) {
    const obsLayout = context?.obsLookup ?? getObsOffsetLookup(runner);
    const entry = obsLayout.get(nodeId);
    if (!entry) {
      return NaN;
    }
    if (entry.kind === 'vec3') {
      return vecComponent(
        readObsSlice(runner, entry.offset, entry.size),
        lineKey
      );
    }
    if (entry.kind === 'joint') {
      const idx = findJointIndex(jointIndex, lineKey);
      return idx >= 0 ? readObsScalar(runner, entry.offset + idx) : NaN;
    }
    if (entry.kind === 'scalar') {
      const idx = entry.keys?.indexOf(lineKey) ?? 0;
      return readObsScalar(runner, entry.offset + Math.max(0, idx));
    }
    const idx = Number.parseInt(lineKey.replace(/^\[/, '').replace(/\]$/, ''), 10);
    if (Number.isInteger(idx)) {
      return readObsScalar(runner, entry.offset + idx);
    }
  }

  return NaN;
}

function readObsSlice(runner, offset, size) {
  const data = runner.historyLength > 1 ? runner.fullObs : runner.obsForPolicy;
  if (!data) {
    return [];
  }
  const start = obsFrameBase(runner) + offset;
  return Array.from(data.subarray(start, start + size));
}

function buildObsOffsetLookup(runner) {
  const map = new Map();
  const obsConfig = runner.config?.obs_config?.policy ?? [];
  let offset = 0;
  for (let i = 0; i < runner.obsModules.length; i++) {
    const obs = runner.obsModules[i];
    const cfg = obsConfig[i] ?? {};
    const name = cfg.name ?? 'Unknown';
    const size = obs.size ?? 0;
    const block = { name, offset, size, kwargs: cfg };
    registerObsNodeOffsets(map, block, runner.numActions);
    offset += size;
  }
  return map;
}

// The layout only changes when a new policy is loaded (which rebuilds
// obsModules), so it is cached per runner instead of per resolved sample.
const obsLookupCache = new WeakMap();

function getObsOffsetLookup(runner) {
  if (!runner?.obsModules) {
    return new Map();
  }
  const cached = obsLookupCache.get(runner);
  if (cached && cached.modules === runner.obsModules && cached.config === runner.config) {
    return cached.map;
  }
  const map = buildObsOffsetLookup(runner);
  obsLookupCache.set(runner, {
    modules: runner.obsModules,
    config: runner.config,
    map
  });
  return map;
}

/**
 * Values shared by every channel of a single sample.
 * @param {object | null} runner
 * @param {object | null} demo
 */
function createSampleContext(runner, demo) {
  return {
    state: demo?.readPolicyState?.() ?? null,
    obsLookup: runner ? getObsOffsetLookup(runner) : null
  };
}

export function setScopeWindowSeconds(scope, seconds) {
  if (!scope) {
    return DEFAULT_WINDOW_SECONDS;
  }
  const clamped = clampScopeWindowSeconds(seconds);
  scope.windowSeconds = clamped;
  return clamped;
}

export function createSignalScope(options = {}) {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const maxChannels = options.maxChannels ?? MAX_SCOPE_CHANNELS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  return {
    capacity,
    maxChannels,
    windowSeconds,
    channels: [],
    times: new Float64Array(capacity),
    head: 0,
    length: 0,
    paused: false,
    timeOrigin: null
  };
}

export function isProbeableLine(line) {
  return Boolean(
    line?.k
    && line.k !== '…'
    && line.k !== 'in'
    && line.k !== 'out'
    && line.k !== 'dim'
    && line.k !== '维度'
  );
}

/**
 * Every scope channel a pipeline node exposes.
 *
 * Node cards summarize wide signals (`维度 23D`), so the full channel list is
 * carried on the node as `probeKeys`; only nodes without that hint fall back to
 * the rendered lines. An explicit empty `probeKeys` means "not a live signal".
 * @param {{ id: string, probeKeys?: string[], lines?: Array<{ k: string }> }} node
 * @returns {string[]}
 */
export function nodeProbeKeys(node) {
  if (!node) {
    return [];
  }
  if (Array.isArray(node.probeKeys)) {
    return node.probeKeys;
  }
  return (node.lines ?? [])
    .filter((line) => isProbeableLine(line))
    .map((line) => line.k);
}

export function nodeHasProbes(node) {
  return nodeProbeKeys(node).length > 0;
}

/**
 * Build the default probe set for a node: all of its curves.
 */
export function listNodeProbes(node) {
  if (!node?.id) {
    return [];
  }
  const title = node.title ?? node.id;
  return nodeProbeKeys(node).map((lineKey) => ({
    id: buildProbeId(node.id, lineKey),
    nodeId: node.id,
    lineKey,
    label: `${title} · ${lineKey}`
  }));
}

/**
 * Replace every scope channel with the given probe set.
 * @param {object} scope
 * @param {Array<{ id: string, nodeId: string, lineKey: string, label: string }>} probes
 * @param {{ allowMultipleNodes?: boolean }} [options]
 *   Probes normally come from one pipeline node, and a mixed list is a caller
 *   bug. One observation block can span several nodes (Command → vx / vy / yaw),
 *   so the stacking view opts in to plotting all of them together.
 */
export function setScopeProbes(scope, probes, options = {}) {
  if (!scope) {
    return null;
  }
  const limited = (probes ?? []).slice(0, scope.maxChannels);
  if (limited.length === 0) {
    scope.channels = [];
    clearScopeBuffer(scope);
    return [];
  }
  const selected = options.allowMultipleNodes
    ? limited
    : limited.filter((probe) => probe.nodeId === limited[0].nodeId);
  scope.channels = selected.map((probe, index) => ({
    id: probe.id,
    nodeId: probe.nodeId,
    lineKey: probe.lineKey,
    label: probe.label,
    color: scopeChannelColor(index),
    hidden: false,
    values: new Float32Array(scope.capacity)
  }));
  clearScopeBuffer(scope);
  return scope.channels;
}

/**
 * Hide or show one channel's curve. Hidden channels keep sampling, so a curve
 * brought back still carries the history recorded while it was off.
 * @returns {boolean | null} the new hidden state, or null when unknown
 */
export function setScopeChannelHidden(scope, probeId, hidden) {
  const channel = scope?.channels?.find((ch) => ch.id === probeId);
  if (!channel) {
    return null;
  }
  channel.hidden = Boolean(hidden);
  return channel.hidden;
}

export function toggleScopeChannelHidden(scope, probeId) {
  const channel = scope?.channels?.find((ch) => ch.id === probeId);
  if (!channel) {
    return null;
  }
  return setScopeChannelHidden(scope, probeId, !channel.hidden);
}

export function toggleScopeProbe(scope, probe) {
  const idx = scope.channels.findIndex((ch) => ch.id === probe.id);
  if (idx >= 0) {
    scope.channels.splice(idx, 1);
    return false;
  }
  if (scope.channels.length >= scope.maxChannels) {
    return null;
  }
  const color = scopeChannelColor(scope.channels.length);
  scope.channels.push({
    id: probe.id,
    nodeId: probe.nodeId,
    lineKey: probe.lineKey,
    label: probe.label,
    color,
    hidden: false,
    values: new Float32Array(scope.capacity)
  });
  return true;
}

/**
 * Keep the scope in step with the current pipeline nodes: channels whose node
 * or signal no longer exists (after a policy switch) are dropped, and the
 * remaining labels follow the node titles (e.g. after a language switch).
 * @param {object} scope
 * @param {Array<{ id: string, title?: string, probeKeys?: string[] }>} nodes
 * @returns {number} how many channels were removed
 */
export function syncScopeProbes(scope, nodes) {
  if (!scope?.channels?.length || !nodes?.length) {
    return 0;
  }
  const probes = new Map();
  for (const node of nodes) {
    for (const probe of listNodeProbes(node)) {
      probes.set(probe.id, probe);
    }
  }
  const kept = scope.channels.filter((ch) => probes.has(ch.id));
  for (const ch of kept) {
    const label = probes.get(ch.id).label;
    if (ch.label !== label) {
      ch.label = label;
    }
  }
  const removed = scope.channels.length - kept.length;
  if (removed > 0) {
    scope.channels = kept;
  }
  return removed;
}

export function removeScopeProbe(scope, probeId) {
  const idx = scope.channels.findIndex((ch) => ch.id === probeId);
  if (idx >= 0) {
    scope.channels.splice(idx, 1);
    return true;
  }
  return false;
}

export function clearScopeBuffer(scope) {
  scope.head = 0;
  scope.length = 0;
  scope.timeOrigin = null;
  for (const ch of scope.channels) {
    ch.values.fill(0);
  }
  scope.times.fill(0);
}

/**
 * Push one sample for all active scope channels.
 */
export function pushScopeSample(scope, runner, demo, timeMs = performance.now()) {
  if (!scope || scope.paused || scope.channels.length === 0) {
    return;
  }
  if (scope.timeOrigin === null) {
    scope.timeOrigin = timeMs;
  }
  const t = (timeMs - scope.timeOrigin) / 1000;
  const idx = scope.head;
  scope.times[idx] = t;
  const context = createSampleContext(runner, demo);
  for (let i = 0; i < scope.channels.length; i++) {
    const ch = scope.channels[i];
    const value = resolveSignalValue(runner, demo, ch, context);
    ch.values[idx] = Number.isFinite(value) ? value : 0;
  }
  scope.head = (scope.head + 1) % scope.capacity;
  if (scope.length < scope.capacity) {
    scope.length += 1;
  }
}

export function getScopeSnapshot(scope) {
  const { capacity, length, head, channels, times } = scope;
  if (length === 0) {
    return {
      sampleCount: 0,
      windowSeconds: scope.windowSeconds ?? DEFAULT_WINDOW_SECONDS,
      labels: channels.map((ch) => ch.label),
      series: channels.map((ch) => ({
        id: ch.id,
        label: ch.label,
        color: ch.color,
        hidden: Boolean(ch.hidden),
        values: []
      })),
      timeRange: [0, scope.windowSeconds ?? DEFAULT_WINDOW_SECONDS]
    };
  }

  const orderedTimes = new Float64Array(length);
  const orderedSeries = channels.map((ch) => ({
    id: ch.id,
    label: ch.label,
    color: ch.color,
    hidden: Boolean(ch.hidden),
    values: new Float32Array(length)
  }));

  const start = length < capacity ? 0 : head;
  for (let i = 0; i < length; i++) {
    const src = (start + i) % capacity;
    orderedTimes[i] = times[src];
    for (let c = 0; c < channels.length; c++) {
      orderedSeries[c].values[i] = channels[c].values[src];
    }
  }

  const windowSeconds = scope.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  let sliceStart = 0;
  if (length > 0) {
    const latestTime = orderedTimes[length - 1];
    const cutoff = latestTime - windowSeconds;
    while (sliceStart < length && orderedTimes[sliceStart] < cutoff) {
      sliceStart += 1;
    }
  }
  const visibleLength = length - sliceStart;
  const visibleTimes = orderedTimes.subarray(sliceStart, length);
  const visibleSeries = orderedSeries.map((series) => ({
    ...series,
    values: series.values.subarray(sliceStart, length)
  }));

  let minY = Infinity;
  let maxY = -Infinity;
  // Hidden channels must not stretch the axis: muting an outlier is the usual
  // reason to hide one, and the remaining curves should expand to fill.
  for (const series of visibleSeries) {
    if (series.hidden) {
      continue;
    }
    for (let i = 0; i < visibleLength; i++) {
      const v = series.values[i];
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = -1;
    maxY = 1;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }

  return {
    sampleCount: visibleLength,
    windowSeconds,
    labels: channels.map((ch) => ch.label),
    series: visibleSeries.map((s) => ({
      ...s,
      values: Array.from(s.values)
    })),
    times: Array.from(visibleTimes),
    timeRange: visibleLength > 0
      ? [visibleTimes[0], visibleTimes[visibleLength - 1]]
      : [0, windowSeconds],
    valueRange: [minY, maxY]
  };
}
