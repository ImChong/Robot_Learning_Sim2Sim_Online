import { test } from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {
  hasMath,
  latexToPlain,
  mathTextToPlain,
  renderMathText,
  splitMathSegments
} from '../src/utils/mathText.js';
import { buildPolicyTelemetry } from '../src/simulation/policyTelemetry.js';
import { buildPipelineGraph } from '../src/simulation/pipelineGraphLayout.js';

test('splitMathSegments separates inline and display formulas', () => {
  assert.deepEqual(splitMathSegments('clip $a$ to $$\\pm 1$$ now'), [
    { type: 'text', value: 'clip ' },
    { type: 'math', value: 'a', display: false },
    { type: 'text', value: ' to ' },
    { type: 'math', value: '\\pm 1', display: true },
    { type: 'text', value: ' now' }
  ]);
  // A lone dollar sign is not a formula.
  assert.deepEqual(splitMathSegments('costs $5'), [{ type: 'text', value: 'costs $5' }]);
  assert.equal(hasMath('plain'), false);
  assert.equal(hasMath('$q$'), true);
});

test('renderMathText escapes text and renders formulas with KaTeX', () => {
  const html = renderMathText('<b>x</b> $q_0$', katex);
  assert.match(html, /^&lt;b&gt;x&lt;\/b&gt; /);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<b>/);
});

test('mathTextToPlain gives readable tooltips', () => {
  assert.equal(latexToPlain('q - q_0'), 'q − q₀');
  assert.equal(latexToPlain('q^* = q_0 + s \\cdot a'), 'q* = q₀ + s · a');
  assert.equal(latexToPlain('\\tau = K_p (q^* - q) - K_d \\dot q'), 'τ = Kp (q* − q) − Kd q̇');
  assert.equal(mathTextToPlain('机体系 $\\omega_b$'), '机体系 ωb');
});

function fakeRunner(blocks, { historyLength = 1, relative = true } = {}) {
  const size = blocks.reduce((sum, block) => sum + block.size, 0);
  return {
    config: {
      onnx: { path: './model.onnx', meta: {} },
      obs_config: { policy: blocks.map(({ name, kwargs }) => ({ name, ...kwargs })) }
    },
    module: { inKeys: ['policy'], outKeys: ['action'] },
    obsModules: blocks.map((block) => ({ size: block.size })),
    numObs: size,
    numActions: 2,
    historyLength,
    historyCount: historyLength,
    obsForPolicy: new Float32Array(size),
    fullObs: new Float32Array(size * historyLength),
    lastActions: new Float32Array(2),
    lastRawAction: new Float32Array(2),
    actionScale: new Float32Array([0.5, 0.5]),
    defaultJointPos: new Float32Array(2),
    target: new Float32Array(2),
    cachedJointPosRel: new Float32Array(2),
    obsJointPosRelative: relative,
    actionClip: 10,
    policyJointNames: ['hip', 'knee']
  };
}

const ALL_BLOCKS = [
  { name: 'BootIndicator', size: 1 },
  { name: 'RootAngVelB', size: 3 },
  { name: 'ProjectedGravityB', size: 3 },
  { name: 'Command', size: 3 },
  { name: 'Command13', size: 13 },
  { name: 'JointPos', size: 4, kwargs: { pos_steps: [0, 1] } },
  { name: 'JointVel', size: 2 },
  { name: 'PrevActions', size: 2 },
  { name: 'ComplianceFlagObs', size: 3 },
  { name: 'TrackingCommandObsRaw', size: 9, kwargs: { future_steps: [0, 2] } },
  { name: 'TargetJointPosObs', size: 8, kwargs: { future_steps: [0, 2] } },
  { name: 'TargetRootZObs', size: 2, kwargs: { future_steps: [0, 2] } },
  { name: 'TargetProjectedGravityBObs', size: 6, kwargs: { future_steps: [0, 2] } }
];

test('every formula shown in the pipeline panel is valid LaTeX', () => {
  const texts = [];
  for (const lang of ['zh', 'en']) {
    for (const historyLength of [1, 4]) {
      for (const controlType of ['unitree_position', 'mujoco_position']) {
        const runner = fakeRunner(ALL_BLOCKS, { historyLength });
        const demo = {
          policyRunner: runner,
          control_type: controlType,
          readPolicyState: () => null,
          simulation: { qpos: new Float64Array(4), qvel: new Float64Array(4), ctrl: new Float64Array(2) },
          qpos_adr_policy: [0, 1],
          qvel_adr_policy: [0, 1],
          ctrl_adr_policy: [0, 1]
        };
        const telemetry = buildPolicyTelemetry(runner, demo, { lang });
        const graph = buildPipelineGraph(telemetry, lang);
        texts.push(
          telemetry.postprocess.formula,
          ...telemetry.obsBlocks.map((block) => block.description),
          ...graph.nodes.map((node) => node.subtitle ?? ''),
          ...graph.lanes.map((lane) => lane.description)
        );
      }
    }
  }
  const formulas = texts
    .flatMap((text) => splitMathSegments(text))
    .filter((segment) => segment.type === 'math');
  assert.ok(formulas.length > 30, `found ${formulas.length} formulas`);
  for (const formula of formulas) {
    assert.doesNotThrow(
      () => katex.renderToString(formula.value, { throwOnError: true, strict: 'error' }),
      formula.value
    );
  }
  // Every motor / output stage formula made it into the graph.
  assert.ok(texts.some((text) => text.includes('K_p')));
  assert.ok(texts.some((text) => text.includes('\\operatorname{clip}')));
});
