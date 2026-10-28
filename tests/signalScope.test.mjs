import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProbeId,
  clearScopeBuffer,
  createSignalScope,
  DEFAULT_WINDOW_SECONDS,
  getScopeSnapshot,
  listNodeProbes,
  MAX_SCOPE_CHANNELS,
  nodeHasProbes,
  nodeProbeKeys,
  pushScopeSample,
  resolveSignalValue,
  scopeChannelColor,
  setScopeProbes,
  syncScopeProbes,
  toggleScopeChannelHidden,
  toggleScopeProbe
} from '../src/simulation/signalScope.js';
import { buildAtomicNodes } from '../src/simulation/pipelineAtomicNodes.js';

test('buildProbeId and toggleScopeProbe manage channels', () => {
  const scope = createSignalScope({ capacity: 8, maxChannels: 2 });
  const probe = {
    id: buildProbeId('sim-cmd-vx', 'vx'),
    nodeId: 'sim-cmd-vx',
    lineKey: 'vx',
    label: 'Cmd vx'
  };
  assert.equal(toggleScopeProbe(scope, probe), true);
  assert.equal(scope.channels.length, 1);
  assert.equal(toggleScopeProbe(scope, probe), false);
  assert.equal(scope.channels.length, 0);
});

test('pushScopeSample writes ring buffer samples', () => {
  const scope = createSignalScope({ capacity: 4, maxChannels: 2 });
  toggleScopeProbe(scope, {
    id: 'sim-cmd-vx:vx',
    nodeId: 'sim-cmd-vx',
    lineKey: 'vx',
    label: 'Cmd vx'
  });
  toggleScopeProbe(scope, {
    id: 'sim-cmd-vy:vy',
    nodeId: 'sim-cmd-vy',
    lineKey: 'vy',
    label: 'Cmd vy'
  });

  const runner = {
    policyJointNames: [],
    historyLength: 1,
    obsForPolicy: new Float32Array(0),
    fullObs: new Float32Array(0),
    obsModules: [],
    config: {}
  };
  const demo = {
    readPolicyState: () => ({ cmd: [1, 2, 3] })
  };

  pushScopeSample(scope, runner, demo, 1000);
  pushScopeSample(scope, runner, {
    readPolicyState: () => ({ cmd: [1.5, 2.5, 3.5] })
  }, 1100);

  const snapshot = getScopeSnapshot(scope);
  assert.equal(snapshot.sampleCount, 2);
  assert.equal(snapshot.series.length, 2);
  assert.equal(snapshot.series[0].values[1], 1.5);
  assert.equal(snapshot.series[1].values[1], 2.5);
});

test('resolveSignalValue reads command and joint action signals', () => {
  const runner = {
    policyJointNames: ['left_hip_pitch_joint', 'right_hip_pitch_joint'],
    lastActions: new Float32Array([0.2, -0.1]),
    target: new Float32Array([0.3, -0.2]),
    cachedJointPosRel: new Float32Array([0.01, 0.02]),
    historyLength: 1,
    obsForPolicy: new Float32Array([0.5, -0.25, 0.75]),
    fullObs: new Float32Array([0.5, -0.25, 0.75]),
    obsModules: [{ size: 3 }],
    config: { obs_config: { policy: [{ name: 'Command' }] } }
  };
  const demo = {
    readPolicyState: () => ({
      cmd: [0.8, 0.1, 0.3],
      jointPos: [1.1, 1.2],
      jointVel: [0.4, 0.5],
      rootPos: [0, 0, 0.9],
      rootAngVel: [0.1, 0.2, 0.3],
      rootQuat: [1, 0, 0, 0]
    })
  };

  assert.equal(resolveSignalValue(runner, demo, { nodeId: 'sim-cmd-vx', lineKey: 'vx' }), 0.8);
  assert.ok(Math.abs(resolveSignalValue(runner, demo, { nodeId: 'out-action', lineKey: 'L_hip_pitch' }) - 0.2) < 1e-5);
  assert.equal(resolveSignalValue(runner, demo, { nodeId: 'obs-Command-vx', lineKey: 'vx' }), 0.5);
});

test('setScopeProbes replaces active channels', () => {
  const scope = createSignalScope({ capacity: 8, maxChannels: 4 });
  toggleScopeProbe(scope, {
    id: 'sim-cmd-vx:vx',
    nodeId: 'sim-cmd-vx',
    lineKey: 'vx',
    label: 'Cmd vx'
  });
  const probes = [
    {
      id: buildProbeId('sim-root-angvel', 'x'),
      nodeId: 'sim-root-angvel',
      lineKey: 'x',
      label: 'Root AngVel · x'
    },
    {
      id: buildProbeId('sim-root-angvel', 'y'),
      nodeId: 'sim-root-angvel',
      lineKey: 'y',
      label: 'Root AngVel · y'
    }
  ];
  setScopeProbes(scope, probes);
  assert.equal(scope.channels.length, 2);
  assert.equal(scope.channels[0].id, 'sim-root-angvel:x');
  assert.equal(getScopeSnapshot(scope).sampleCount, 0);
});

test('clearScopeBuffer resets timeline but keeps channels', () => {
  const scope = createSignalScope({ capacity: 4 });
  toggleScopeProbe(scope, {
    id: 'sim-cmd-vx:vx',
    nodeId: 'sim-cmd-vx',
    lineKey: 'vx',
    label: 'Cmd vx'
  });
  pushScopeSample(scope, null, { readPolicyState: () => ({ cmd: [1, 0, 0] }) }, 1000);
  clearScopeBuffer(scope);
  assert.equal(scope.channels.length, 1);
  assert.equal(getScopeSnapshot(scope).sampleCount, 0);
});

test('getScopeSnapshot keeps only the latest windowSeconds of samples', () => {
  const scope = createSignalScope({ capacity: 256, windowSeconds: 20 });
  setScopeProbes(scope, [{
    id: 'sim-cmd-vx:vx',
    nodeId: 'sim-cmd-vx',
    lineKey: 'vx',
    label: 'Cmd vx'
  }]);

  for (let t = 0; t <= 30; t += 1) {
    pushScopeSample(
      scope,
      null,
      { readPolicyState: () => ({ cmd: [t, 0, 0] }) },
      1000 + t * 1000
    );
  }

  const snapshot = getScopeSnapshot(scope);
  assert.equal(snapshot.windowSeconds, 20);
  assert.ok(snapshot.sampleCount <= 21);
  assert.ok(snapshot.times[0] >= 10);
  assert.equal(snapshot.times[0], 10);
  assert.equal(snapshot.times[snapshot.times.length - 1], 30);
});

function buildJointRunnerNodes(jointCount) {
  const jointNames = Array.from(
    { length: jointCount },
    (_, i) => `left_joint_${i}_joint`
  );
  const runner = {
    policyJointNames: jointNames,
    numActions: jointCount,
    obsJointPosRelative: false,
    actionClip: 10,
    lastActions: new Float32Array(jointCount),
    target: new Float32Array(jointCount)
  };
  const state = {
    rootPos: new Float32Array([0, 0, 0.9]),
    rootQuat: new Float32Array([1, 0, 0, 0]),
    rootAngVel: new Float32Array([0, 0, 0]),
    jointPos: Float32Array.from(jointNames, (_, i) => i / 10),
    jointVel: new Float32Array(jointCount),
    cmd: [0, 0, 0]
  };
  const obsLayout = [{ name: 'JointPos', offset: 0, size: jointCount, kwargs: { pos_steps: [0] } }];
  const nodes = buildAtomicNodes(
    runner,
    state,
    new Float32Array(jointCount),
    obsLayout,
    'zh'
  );
  return { runner, state, nodes };
}

test('listNodeProbes expands a node summarized by its dimension', () => {
  const { nodes } = buildJointRunnerNodes(23);
  const jointPos = nodes.find((n) => n.id === 'sim-joint-pos');

  // The card only renders "维度 23D" but every joint must still be plottable.
  assert.equal(jointPos.lines.length, 1);
  assert.equal(nodeHasProbes(jointPos), true);

  const probes = listNodeProbes(jointPos);
  assert.equal(probes.length, 23);
  assert.equal(probes[0].nodeId, 'sim-joint-pos');
  assert.equal(probes[0].lineKey, 'L_joint_0');
  assert.equal(probes[0].id, 'sim-joint-pos:L_joint_0');
});

test('clicking a joint node plots every joint curve', () => {
  const { runner, state, nodes } = buildJointRunnerNodes(23);
  const scope = createSignalScope({ capacity: 8 });
  const probes = listNodeProbes(nodes.find((n) => n.id === 'sim-joint-pos'));

  const channels = setScopeProbes(scope, probes);
  assert.equal(channels.length, 23);
  assert.equal(new Set(channels.map((ch) => ch.color)).size, 23);

  const demo = { readPolicyState: () => state };
  pushScopeSample(scope, runner, demo, 1000);
  const snapshot = getScopeSnapshot(scope);
  assert.equal(snapshot.series.length, 23);
  assert.ok(Math.abs(snapshot.series[7].values[0] - 0.7) < 1e-5);
});

test('nodeProbeKeys treats an empty probeKeys list as not probeable', () => {
  // Structural nodes (warehouse, history, policy net) carry no live signal.
  const structural = { id: 'warehouse', lines: [{ k: 'frame', v: '96D' }], probeKeys: [] };
  assert.deepEqual(nodeProbeKeys(structural), []);
  assert.equal(nodeHasProbes(structural), false);
  assert.deepEqual(listNodeProbes(structural), []);
});

test('nodeProbeKeys falls back to rendered lines when no probeKeys exist', () => {
  const node = { id: 'legacy', lines: [{ k: 'a' }, { k: 'dim', v: '3D' }, { k: '…' }] };
  assert.deepEqual(nodeProbeKeys(node), ['a']);
});

test('setScopeProbes stops at the channel cap', () => {
  const scope = createSignalScope({ capacity: 4 });
  const probes = Array.from({ length: MAX_SCOPE_CHANNELS + 5 }, (_, i) => ({
    id: buildProbeId('obs-Wide', `[${i}]`),
    nodeId: 'obs-Wide',
    lineKey: `[${i}]`,
    label: `Wide · [${i}]`
  }));
  assert.equal(setScopeProbes(scope, probes).length, MAX_SCOPE_CHANNELS);
});

test('scopeChannelColor stays distinct past the curated palette', () => {
  const colors = Array.from({ length: MAX_SCOPE_CHANNELS }, (_, i) => scopeChannelColor(i));
  assert.equal(new Set(colors).size, MAX_SCOPE_CHANNELS);
  assert.equal(colors[0], scopeChannelColor(0));
});

test('resolveSignalValue maps quaternion components onto [w, x, y, z]', () => {
  const runner = { policyJointNames: [], historyLength: 1, obsModules: [], config: {} };
  const demo = { readPolicyState: () => ({ rootQuat: [0.1, 0.2, 0.3, 0.4] }) };
  const read = (lineKey) => resolveSignalValue(runner, demo, { nodeId: 'sim-root-quat', lineKey });

  assert.ok(Math.abs(read('w') - 0.1) < 1e-6);
  assert.ok(Math.abs(read('x') - 0.2) < 1e-6);
  assert.ok(Math.abs(read('y') - 0.3) < 1e-6);
  assert.ok(Math.abs(read('z') - 0.4) < 1e-6);
});

test('resolveSignalValue reads raw observation blocks by block-local index', () => {
  const runner = {
    policyJointNames: [],
    numActions: 0,
    historyLength: 1,
    obsForPolicy: new Float32Array([0, 1, 2, 10, 11, 12, 13]),
    fullObs: new Float32Array([0, 1, 2, 10, 11, 12, 13]),
    obsModules: [{ size: 3 }, { size: 4 }],
    config: { obs_config: { policy: [{ name: 'RootAngVelB' }, { name: 'CustomBlock' }] } }
  };

  assert.equal(resolveSignalValue(runner, null, { nodeId: 'obs-CustomBlock', lineKey: '[0]' }), 10);
  assert.equal(resolveSignalValue(runner, null, { nodeId: 'obs-CustomBlock', lineKey: '[2]' }), 12);
});

test('resolveSignalValue reads the newest frame of a history window', () => {
  const numObs = 3;
  const historyLength = 4;
  const fullObs = new Float32Array(numObs * historyLength);
  // [oldest … newest]: PolicyRunner appends the current frame at the end.
  fullObs.set([0.1, 0.2, 0.3], 0);
  fullObs.set([9.1, 9.2, 9.3], numObs * (historyLength - 1));
  const runner = {
    policyJointNames: [],
    numActions: 0,
    numObs,
    historyLength,
    fullObs,
    obsForPolicy: fullObs.subarray(0, numObs),
    obsModules: [{ size: 3 }],
    config: { obs_config: { policy: [{ name: 'RootAngVelB' }] } }
  };

  const read = (lineKey) => resolveSignalValue(runner, null, { nodeId: 'obs-RootAngVelB', lineKey });
  assert.ok(Math.abs(read('x') - 9.1) < 1e-5);
  assert.ok(Math.abs(read('z') - 9.3) < 1e-5);
});

test('setScopeProbes keeps probes from a single node only', () => {
  const scope = createSignalScope({ capacity: 8, maxChannels: 8 });
  setScopeProbes(scope, [
    {
      id: buildProbeId('sim-cmd-vx', 'vx'),
      nodeId: 'sim-cmd-vx',
      lineKey: 'vx',
      label: 'Cmd vx'
    },
    {
      id: buildProbeId('sim-root-angvel', 'x'),
      nodeId: 'sim-root-angvel',
      lineKey: 'x',
      label: 'Root AngVel · x'
    }
  ]);
  assert.equal(scope.channels.length, 1);
  assert.equal(scope.channels[0].nodeId, 'sim-cmd-vx');
  assert.equal(DEFAULT_WINDOW_SECONDS, 20);
});

test('hiding a channel keeps it sampling and off the value range', () => {
  const scope = createSignalScope({ capacity: 8, maxChannels: 4 });
  const probe = (nodeId, lineKey) => ({
    id: buildProbeId(nodeId, lineKey),
    nodeId,
    lineKey,
    label: `${nodeId} · ${lineKey}`
  });
  setScopeProbes(scope, [probe('sim-cmd-vx', 'vx'), probe('sim-cmd-vy', 'vy')], {
    allowMultipleNodes: true
  });

  const runner = { policyJointNames: [], numActions: 0, numObs: 0, historyLength: 1 };
  // vy is the outlier: hiding it must let vx use the whole axis.
  const demo = { readPolicyState: () => ({ cmd: [0.25, 9, 0] }) };
  pushScopeSample(scope, runner, demo, 0);

  assert.deepEqual(getScopeSnapshot(scope).valueRange, [0.25, 9]);

  assert.equal(toggleScopeChannelHidden(scope, buildProbeId('sim-cmd-vy', 'vy')), true);
  pushScopeSample(scope, runner, demo, 100);

  const snapshot = getScopeSnapshot(scope);
  assert.deepEqual(snapshot.series.map((s) => s.hidden), [false, true]);
  // vx alone is flat at 0.25, so the range is padded around it instead of
  // being stretched to vy's 9.
  assert.deepEqual(snapshot.valueRange, [-0.25, 0.75]);
  // Still recording while hidden, so unhiding shows an unbroken curve.
  assert.deepEqual(Array.from(snapshot.series[1].values), [9, 9]);

  assert.equal(toggleScopeChannelHidden(scope, buildProbeId('sim-cmd-vy', 'vy')), false);
  assert.deepEqual(getScopeSnapshot(scope).valueRange, [0.25, 9]);
  assert.equal(toggleScopeChannelHidden(scope, 'nope:x'), null);
});

test('setScopeProbes spans several nodes when the caller allows it', () => {
  const scope = createSignalScope({ capacity: 8, maxChannels: 8 });
  const probe = (nodeId, lineKey) => ({
    id: buildProbeId(nodeId, lineKey),
    nodeId,
    lineKey,
    label: `${nodeId} · ${lineKey}`
  });
  // One observation block (Command) is drawn as three pipeline nodes.
  const channels = setScopeProbes(
    scope,
    [
      probe('obs-Command-vx', 'vx'),
      probe('obs-Command-vy', 'vy'),
      probe('obs-Command-yaw', 'yaw')
    ],
    { allowMultipleNodes: true }
  );
  assert.deepEqual(
    channels.map((ch) => ch.nodeId),
    ['obs-Command-vx', 'obs-Command-vy', 'obs-Command-yaw']
  );
  assert.equal(new Set(channels.map((ch) => ch.color)).size, 3);
});

test('syncScopeProbes drops channels the current policy no longer has', () => {
  const scope = createSignalScope({ capacity: 4 });
  const oldNodes = [
    { id: 'obs-Command-vx', title: 'Cmd vx', probeKeys: ['vx'] },
    { id: 'out-action', title: 'Action', probeKeys: ['hip', 'knee'] }
  ];
  setScopeProbes(
    scope,
    [...listNodeProbes(oldNodes[0]), ...listNodeProbes(oldNodes[1])],
    { allowMultipleNodes: true }
  );
  assert.equal(scope.channels.length, 3);

  // New policy: no Command block, a different joint set, titles in Chinese.
  const newNodes = [{ id: 'out-action', title: '动作', probeKeys: ['hip', 'ankle'] }];
  assert.equal(syncScopeProbes(scope, newNodes), 2);
  assert.deepEqual(scope.channels.map((ch) => ch.id), ['out-action:hip']);
  assert.equal(scope.channels[0].label, '动作 · hip');
});

test('syncScopeProbes leaves the scope alone without nodes', () => {
  const scope = createSignalScope({ capacity: 4 });
  setScopeProbes(scope, listNodeProbes({ id: 'sim-cmd-vx', title: 'Cmd vx', probeKeys: ['vx'] }));
  // Telemetry that is not ready yet has no nodes; that must not wipe the scope.
  assert.equal(syncScopeProbes(scope, []), 0);
  assert.equal(scope.channels.length, 1);
});
