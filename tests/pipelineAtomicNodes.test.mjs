import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtomicNodes,
  nodeHeightForLines,
  splitNodeLines
} from '../src/simulation/pipelineAtomicNodes.js';

const runner = {
  policyJointNames: ['hip', 'knee'],
  numActions: 2,
  obsJointPosRelative: true,
  actionClip: 10,
  cachedJointPosRel: new Float32Array([0.1, -0.2]),
  lastActions: new Float32Array([0.5, -0.3]),
  target: new Float32Array([0.05, -0.1])
};

const state = {
  rootPos: new Float32Array([0, 0, 0.9]),
  rootQuat: new Float32Array([1, 0, 0, 0]),
  rootAngVel: new Float32Array([0.1, 0, 0]),
  jointPos: new Float32Array([0.2, 0.4]),
  jointVel: new Float32Array([0, -0.1]),
  cmd: [1, 0, 0.5]
};

const obsLayout = [
  { name: 'RootAngVelB', offset: 0, size: 3 },
  { name: 'Command', offset: 3, size: 3 },
  { name: 'JointPos', offset: 6, size: 2, kwargs: { pos_steps: [0] } }
];

const obsVector = new Float32Array([0.1, 0, 0, 1, 0, 0.5, 0.2, 0.4]);

test('buildAtomicNodes splits command and root signals', () => {
  const nodes = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en');
  assert.ok(nodes.find((n) => n.id === 'sim-root-pos'));
  assert.ok(nodes.find((n) => n.id === 'sim-root-angvel'));
  assert.ok(nodes.find((n) => n.id === 'sim-cmd-vx'));
  assert.ok(nodes.find((n) => n.id === 'obs-Command-vx'));
  const jointPos = nodes.find((n) => n.id === 'sim-joint-pos');
  assert.equal(jointPos.lines.length, 1);
  assert.equal(jointPos.lines[0].k, 'dim');
  assert.equal(jointPos.lines[0].v, '2D');
  const obsJointPos = nodes.find((n) => n.id === 'obs-JointPos');
  assert.equal(obsJointPos.lines[0].k, 'dim');
  assert.equal(obsJointPos.lines[0].v, '2D');
});

test('buildAtomicNodes carries the full channel list on summarized nodes', () => {
  const nodes = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en');
  const jointPos = nodes.find((n) => n.id === 'sim-joint-pos');
  assert.deepEqual(jointPos.probeKeys, ['hip', 'knee']);

  const obsJointPos = nodes.find((n) => n.id === 'obs-JointPos');
  assert.deepEqual(obsJointPos.probeKeys, ['hip', 'knee']);

  assert.deepEqual(nodes.find((n) => n.id === 'sim-root-quat').probeKeys, ['w', 'x', 'y', 'z']);
  assert.deepEqual(nodes.find((n) => n.id === 'sim-root-angvel').probeKeys, ['x', 'y', 'z']);
});

test('buildAtomicNodes folds the action clip into the action node', () => {
  const nodes = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en');
  // The clip runs on the ONNX output, it is not an observation preprocessing step.
  assert.equal(nodes.find((n) => n.id === 'prep-action-clip'), undefined);
  assert.match(nodes.find((n) => n.id === 'out-action').subtitle, /±10/);
});

test('buildAtomicNodes summarizes per-joint output nodes', () => {
  const nodes = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en', [
    { name: 'hip' },
    { name: 'knee' }
  ]);
  for (const id of ['prep-joint-rel', 'out-action', 'out-target', 'motor-torque']) {
    const node = nodes.find((n) => n.id === id);
    assert.deepEqual(node.lines, [{ k: 'dim', v: '2D' }], id);
    assert.deepEqual(node.probeKeys, ['hip', 'knee'], id);
  }
});

test('buildAtomicNodes names the motor node after the control type', () => {
  const motors = [{ name: 'hip' }, { name: 'knee' }];
  const pd = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en', motors, {
    controlType: 'unitree_position'
  }).find((n) => n.id === 'motor-torque');
  assert.equal(pd.title, 'Motor Torque');

  // MuJoCo position actuators receive the target angle, not a torque.
  const servo = buildAtomicNodes(runner, state, obsVector, obsLayout, 'en', motors, {
    controlType: 'mujoco_position'
  }).find((n) => n.id === 'motor-torque');
  assert.equal(servo.title, 'Actuator ctrl');
});

test('nodeHeightForLines packs bare keys into chip rows', () => {
  const single = nodeHeightForLines([{ k: 'dim', v: '2D' }]);
  assert.equal(nodeHeightForLines([{ k: 'x' }, { k: 'y' }, { k: 'z' }]), single);
  assert.ok(nodeHeightForLines([{ k: 'w' }, { k: 'x' }, { k: 'y' }, { k: 'z' }, { k: 'v' }]) > single);
  assert.deepEqual(
    splitNodeLines([{ k: 'dim', v: '2D' }, { k: 'x' }]),
    { rows: [{ k: 'dim', v: '2D' }], chips: [{ k: 'x' }] }
  );
});

test('buildAtomicNodes includes per-joint policy output', () => {
  const nodes = buildAtomicNodes(runner, state, obsVector, obsLayout, 'zh', [
    { name: 'hip', ctrl: 1.2 }
  ]);
  assert.ok(nodes.find((n) => n.id === 'out-action'));
  assert.ok(nodes.find((n) => n.id === 'motor-torque'));
});
