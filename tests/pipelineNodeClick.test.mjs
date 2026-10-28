import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineGraph } from '../src/simulation/pipelineGraphLayout.js';
import { buildAtomicNodes } from '../src/simulation/pipelineAtomicNodes.js';
import {
  isArchitectureNode,
  isStackNode,
  pipelineNodeClickAction,
  pipelineNodeHintIcon
} from '../src/utils/pipelineNodeClick.js';

const atomic = buildAtomicNodes(
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

const telemetry = {
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
  atomicNodes: atomic,
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

test('pipelineNodeClickAction opens architecture for Policy net', () => {
  const graph = buildPipelineGraph(telemetry, 'en');
  const onnx = graph.nodes.find((n) => n.id === 'onnx');
  assert.ok(onnx);
  assert.equal(onnx.kind, 'model');
  assert.equal(onnx.title, 'Policy net');
  assert.equal(isArchitectureNode(onnx), true);
  assert.equal(pipelineNodeClickAction(onnx), 'open-architecture');
  assert.equal(pipelineNodeHintIcon('open-architecture'), 'ph-tree-structure');
});

test('pipelineNodeClickAction opens architecture for vertical Policy net', () => {
  const graph = buildPipelineGraph(telemetry, 'zh', { layout: 'vertical' });
  const onnx = graph.nodes.find((n) => n.id === 'onnx');
  assert.ok(onnx);
  assert.equal(onnx.title, '策略网络');
  assert.equal(pipelineNodeClickAction(onnx), 'open-architecture');
});

test('pipelineNodeClickAction opens scope for the scope sink', () => {
  const graph = buildPipelineGraph(telemetry, 'zh', {
    activeProbes: [{ id: 'sim-cmd-vx:vx', nodeId: 'sim-cmd-vx', lineKey: 'vx' }]
  });
  const scope = graph.nodes.find((n) => n.id === 'out-scope');
  assert.ok(scope);
  assert.equal(pipelineNodeClickAction(scope), 'open-scope');
});

test('pipelineNodeClickAction opens the stacking view for structural nodes', () => {
  const graph = buildPipelineGraph(telemetry, 'zh');
  const warehouse = graph.nodes.find((n) => n.id === 'warehouse');
  const history = graph.nodes.find((n) => n.id === 'history');
  assert.ok(warehouse);
  assert.ok(history);
  assert.equal(isStackNode(warehouse), true);
  assert.equal(isStackNode(history), true);
  assert.equal(pipelineNodeClickAction(warehouse), 'open-stack');
  assert.equal(pipelineNodeClickAction(history), 'open-stack');
  assert.equal(pipelineNodeHintIcon('open-stack'), 'ph-stack');
});

test('pipelineNodeClickAction plots nodes that only show a dimension summary', () => {
  const graph = buildPipelineGraph(telemetry, 'en');
  const jointPos = graph.nodes.find((n) => n.id === 'sim-joint-pos');
  assert.equal(jointPos.lines.length, 1);
  assert.equal(jointPos.lines[0].k, 'dim');
  assert.equal(pipelineNodeClickAction(jointPos), 'probe-node');
});

test('pipelineNodeClickAction probes signal nodes and ignores empty nodes', () => {
  const graph = buildPipelineGraph(telemetry, 'en');
  const cmd = graph.nodes.find((n) => n.id === 'sim-cmd-vx');
  assert.equal(pipelineNodeClickAction(cmd), 'probe-node');
  assert.equal(pipelineNodeHintIcon('probe-node'), 'ph-wave-sine');
  assert.equal(pipelineNodeClickAction(null), null);
  assert.equal(pipelineNodeClickAction({ id: 'empty', kind: 'process', lines: [] }), null);
  assert.equal(
    pipelineNodeClickAction({
      id: 'meta',
      kind: 'process',
      lines: [{ k: 'in', v: 'policy' }, { k: 'out', v: 'action' }]
    }),
    null
  );
});
