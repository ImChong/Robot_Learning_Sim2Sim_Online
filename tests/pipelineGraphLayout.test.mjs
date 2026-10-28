import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineGraph, obsSourceIds, wrapObsColumns } from '../src/simulation/pipelineGraphLayout.js';
import { buildAtomicNodes } from '../src/simulation/pipelineAtomicNodes.js';

const baseAtomic = buildAtomicNodes(
  {
    policyJointNames: ['hip', 'knee'],
    numActions: 2,
    obsJointPosRelative: false,
    actionClip: 10,
    cachedJointPosRel: new Float32Array(2),
    lastActions: new Float32Array([0.1, -0.2]),
    target: new Float32Array([0.05, -0.1])
  },
  {
    rootPos: new Float32Array([0, 0, 0.9]),
    rootQuat: new Float32Array([1, 0, 0, 0]),
    rootAngVel: new Float32Array([0, 0, 0]),
    jointPos: new Float32Array([0.1, 0.2]),
    jointVel: new Float32Array([0, 0]),
    cmd: [0, 0, 0]
  },
  new Float32Array([0, 0, 0, 1, 0, 0, 0.1, 0.2]),
  [
    { name: 'RootAngVelB', offset: 0, size: 3 },
    { name: 'Command', offset: 3, size: 3 },
    { name: 'JointPos', offset: 6, size: 2, kwargs: {} }
  ],
  'en'
);

const baseTelemetry = {
  ready: true,
  preprocessing: {
    rootPos: [0, 0, 0.9],
    jointPosSample: [0.1, 0.2],
    obsJointPosRelative: true,
    actionClip: 10
  },
  obsBlocks: [
    { name: 'RootAngVelB', offset: 0, size: 3, values: [0, 0, 0], stats: { mean: 0, min: 0, max: 0 } },
    { name: 'Command', offset: 3, size: 3, values: [1, 0, 0], stats: { mean: 0.3, min: 0, max: 1 } }
  ],
  atomicNodes: baseAtomic,
  concat: {
    currentFrameSize: 96,
    historyLength: 4,
    historyCount: 4,
    tensorSize: 384,
    tensorPreview: [0, 0, 0, 0]
  },
  model: { path: './model.onnx' },
  onnx: {
    inKeys: ['policy'],
    outKeys: ['action'],
    inputShape: [1, 384],
    clippedAction: [0.1, -0.2]
  },
  postprocess: {
    targetSample: [0.05, -0.1],
    actionScaleSample: [0.5, 0.5]
  },
  motor: {
    controlType: 'unitree_position',
    decimation: 4,
    policyHz: 50,
    joints: [{ ctrl: 1.2 }]
  }
};

test('buildPipelineGraph creates obs fan-in and history node', () => {
  const graph = buildPipelineGraph(baseTelemetry, 'zh');
  assert.ok(graph.nodes.find((n) => n.id === 'warehouse'));
  assert.ok(graph.nodes.find((n) => n.id === 'history'));
  assert.ok(graph.nodes.find((n) => n.id === 'obs-RootAngVelB'));
  const obsNodeCount = baseTelemetry.atomicNodes.filter((n) => n.group === 'obs').length;
  assert.equal(
    graph.edges.filter((e) => e.to === 'warehouse').length,
    obsNodeCount
  );
  assert.ok(graph.nodes.find((n) => n.id === 'sim-root-pos'));
  assert.ok(graph.nodes.find((n) => n.id === 'sim-joint-pos'));
});

test('buildPipelineGraph skips history node when length is 1', () => {
  const graph = buildPipelineGraph({
    ...baseTelemetry,
    concat: { ...baseTelemetry.concat, historyLength: 1, historyCount: 1, tensorSize: 96 }
  }, 'en');
  assert.equal(graph.nodes.find((n) => n.id === 'history'), undefined);
  assert.ok(graph.edges.some((e) => e.from === 'warehouse' && e.to === 'onnx'));
});

test('buildPipelineGraph vertical layout stacks nodes', () => {
  const graph = buildPipelineGraph(baseTelemetry, 'zh', { layout: 'vertical' });
  assert.equal(graph.layout, 'vertical');
  assert.ok(graph.width <= 320);
  assert.ok(graph.height > 400);
  const rootPos = graph.nodes.find((n) => n.id === 'sim-root-pos');
  const tail = graph.nodes.find((n) => n.id === 'out-target') ?? graph.nodes.find((n) => n.id === 'onnx');
  assert.ok(rootPos);
  assert.ok(tail);
  assert.ok(tail.y > rootPos.y);
});

test('buildPipelineGraph appends scope sink and probe edges', () => {
  const graph = buildPipelineGraph(baseTelemetry, 'zh', {
    activeProbes: [
      { id: 'sim-cmd-vx:vx', nodeId: 'sim-cmd-vx', lineKey: 'vx' },
      { id: 'out-action:L_hip', nodeId: 'out-action', lineKey: 'L_hip' }
    ]
  });
  const scopeNode = graph.nodes.find((n) => n.id === 'out-scope');
  assert.ok(scopeNode);
  assert.equal(scopeNode.kind, 'scope');
  assert.ok(graph.edges.some((e) => e.from === 'sim-cmd-vx' && e.to === 'out-scope' && e.kind === 'scope'));
});

test('buildPipelineGraph numbers the lanes and describes each stage', () => {
  const graph = buildPipelineGraph(baseTelemetry, 'en');
  assert.deepEqual(
    graph.lanes.map((lane) => lane.step),
    graph.lanes.map((_, index) => index + 1)
  );
  assert.equal(graph.lanes.at(-1).id, 'scope');
  for (const lane of graph.lanes) {
    assert.ok(lane.description, `lane ${lane.id} has a description`);
  }
  // History length 4 is reflected in the policy stage description.
  assert.match(graph.lanes.find((lane) => lane.id === 'policy').description, /4 frames/);
});

test('buildPipelineGraph drops the preprocess lane when nothing is preprocessed', () => {
  const graph = buildPipelineGraph(baseTelemetry, 'en');
  // baseAtomic is built without relative joints, and the action clip now
  // lives on the action node, so there is no preprocessing stage at all.
  assert.equal(graph.lanes.find((lane) => lane.id === 'prep'), undefined);
  assert.equal(graph.nodes.find((n) => n.id === 'prep-action-clip'), undefined);
});

test('obsSourceIds only wires observations to the signals they read', () => {
  assert.deepEqual(obsSourceIds({ id: 'obs-Command-vx' }, false), ['sim-cmd-vx']);
  assert.deepEqual(
    obsSourceIds({ id: 'obs-Command13-twist' }, false),
    ['sim-cmd-vx', 'sim-cmd-vy', 'sim-cmd-yaw']
  );
  assert.deepEqual(obsSourceIds({ id: 'obs-JointPos' }, true), ['prep-joint-rel']);
  assert.deepEqual(obsSourceIds({ id: 'obs-JointPos' }, false), ['sim-joint-pos']);
  // Constants, UI flags and the previous action have no simulation source.
  for (const id of [
    'obs-Command13-head',
    'obs-BootIndicator',
    'obs-ComplianceFlagObs-en',
    'obs-PrevActions',
    'obs-SomethingNew'
  ]) {
    assert.deepEqual(obsSourceIds({ id }, false), [], id);
  }
});

test('wrapObsColumns keeps short stacks in one column', () => {
  const nodes = Array.from({ length: 9 }, () => ({ height: 79 }));
  assert.equal(wrapObsColumns(nodes, 740).length, 1);
});

test('wrapObsColumns splits a tall stack into balanced, ordered columns', () => {
  const nodes = Array.from({ length: 29 }, (_, i) => ({ id: `n${i}`, height: 79 }));
  const columns = wrapObsColumns(nodes, 740);
  assert.equal(columns.length, 3);
  assert.deepEqual(columns.map((column) => column.length), [10, 10, 9]);
  // Concat order reads column by column.
  assert.deepEqual(columns.flat().map((node) => node.id), nodes.map((node) => node.id));
});

test('buildPipelineGraph lays a wrapped observation stack out side by side', () => {
  const obsNodes = Array.from({ length: 29 }, (_, i) => ({
    id: `obs-Term${i}`,
    kind: 'signal',
    group: 'obs',
    title: `Term ${i}`,
    width: 184,
    height: 79,
    lines: [{ k: 'x' }],
    probeKeys: ['x']
  }));
  const graph = buildPipelineGraph({
    ...baseTelemetry,
    atomicNodes: [...baseAtomic.filter((n) => n.group !== 'obs'), ...obsNodes]
  }, 'en');
  const placed = graph.nodes.filter((n) => n.id.startsWith('obs-Term'));
  const xs = [...new Set(placed.map((n) => n.x))];
  assert.equal(xs.length, 3);
  const lane = graph.lanes.find((l) => l.id === 'obs');
  for (const node of placed) {
    assert.ok(node.x >= lane.x && node.x + node.width <= lane.x + lane.width, node.id);
  }
  const bottom = Math.max(...placed.map((n) => n.y + n.height));
  assert.ok(bottom < 1200, `wrapped stack bottom ${bottom}`);
});
