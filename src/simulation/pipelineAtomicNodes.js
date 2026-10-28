import { decomposeObsBlockNodes } from './pipelineObsNodes.js';
import { shortJointName } from './jointLabels.js';

const VEC3_KEYS = ['x', 'y', 'z'];
const QUAT_KEYS = ['w', 'x', 'y', 'z'];

// Card geometry shared with ModelIOPipelineGraph.vue: the layout positions
// nodes before they render, so heights have to be derived from the lines.
const NODE_HEAD = 40;
const NODE_CARD_PAD_V = 20;
const NODE_LINE = 19;
const NODE_MIN_HEIGHT = 64;
// Bare keys (x / y / z, vx, [0] …) render as chips packed into one row.
export const NODE_CHIPS_PER_ROW = 4;

/**
 * Lines with a value render as key/value rows; bare keys render as chips.
 * @param {Array<{ k: string, v?: string }>} lines
 */
export function splitNodeLines(lines) {
  const rows = [];
  const chips = [];
  for (const line of lines ?? []) {
    (line?.v ? rows : chips).push(line);
  }
  return { rows, chips };
}

/** Rendered height of a node card for the given lines. */
export function nodeHeightForLines(lines) {
  const { rows, chips } = splitNodeLines(lines);
  const rowCount = rows.length + Math.ceil(chips.length / NODE_CHIPS_PER_ROW);
  return Math.max(NODE_MIN_HEIGHT, NODE_HEAD + NODE_CARD_PAD_V + rowCount * NODE_LINE);
}

/**
 * Scope channel keys for a per-joint node: one curve per policy joint.
 * Node cards only render a dimension summary, so the full channel list has to
 * travel with the node for the oscilloscope to plot every joint.
 * @param {string[]} jointNames
 */
function jointProbeKeys(jointNames) {
  return (jointNames ?? []).map((name) => shortJointName(name));
}

function vec3Lines(prefix) {
  return [
    { k: `${prefix}x` },
    { k: `${prefix}y` },
    { k: `${prefix}z` }
  ];
}

function jointDimLines(count, zh) {
  return [{ k: zh ? '维度' : 'dim', v: `${count}D` }];
}

function decomposeObsBlock(block, slice, jointNames, lang) {
  return decomposeObsBlockNodes(block, slice, jointNames, lang, jointNames.length);
}

/**
 * Title and formula of the last output node. MuJoCo position actuators run the
 * PD loop themselves, so `ctrl` holds the target angle rather than a torque.
 * @param {string | undefined} controlType
 * @param {boolean} zh
 */
function motorNodeText(controlType, zh) {
  if (controlType === 'mujoco_position') {
    return {
      title: zh ? '执行器指令' : 'Actuator ctrl',
      subtitle: zh ? 'MuJoCo 位置伺服' : 'MuJoCo position servo'
    };
  }
  return {
    title: zh ? '电机力矩' : 'Motor Torque',
    subtitle: 'τ = Kp(q*−q) − Kd·q̇'
  };
}

/**
 * @param {import('./policyRunner.js').PolicyRunner} runner
 * @param {object | null} state
 * @param {Float32Array} obsVector
 * @param {ReturnType<import('./policyTelemetry.js').buildObsLayout>} obsLayout
 * @param {'zh'|'en'} lang
 * @param {Array<{ name: string }>} [motorJoints]
 * @param {{ controlType?: string }} [options]
 */
export function buildAtomicNodes(runner, state, obsVector, obsLayout, lang = 'zh', motorJoints = [], options = {}) {
  const zh = lang === 'zh';
  const jointNames = runner.policyJointNames ?? [];
  const nodes = [];

  const push = (spec) => {
    nodes.push({
      width: spec.kind === 'joints' ? 208 : 184,
      height: nodeHeightForLines(spec.lines),
      ...spec
    });
  };

  const jointKeys = jointProbeKeys(jointNames);

  push({
    id: 'sim-root-pos',
    kind: 'signal',
    group: 'sim',
    title: zh ? '根位置' : 'Root Position',
    subtitle: zh ? '世界系' : 'world frame',
    lines: vec3Lines(''),
    probeKeys: VEC3_KEYS
  });

  push({
    id: 'sim-root-quat',
    kind: 'signal',
    group: 'sim',
    title: zh ? '根姿态' : 'Root Orientation',
    subtitle: zh ? '四元数' : 'quaternion',
    lines: [
      { k: 'w' },
      { k: 'x' },
      { k: 'y' },
      { k: 'z' }
    ],
    probeKeys: QUAT_KEYS
  });

  push({
    id: 'sim-root-angvel',
    kind: 'signal',
    group: 'sim',
    title: zh ? '根角速度' : 'Root AngVel',
    subtitle: zh ? '机体系' : 'body frame',
    lines: vec3Lines(''),
    probeKeys: VEC3_KEYS
  });

  push({
    id: 'sim-joint-pos',
    kind: 'joints',
    group: 'sim',
    title: zh ? '关节位置' : 'Joint Position',
    subtitle: zh ? 'MuJoCo qpos' : 'MuJoCo qpos',
    lines: jointDimLines(jointNames.length, zh),
    probeKeys: jointKeys
  });

  push({
    id: 'sim-joint-vel',
    kind: 'joints',
    group: 'sim',
    title: zh ? '关节速度' : 'Joint Velocity',
    subtitle: zh ? 'MuJoCo qvel' : 'MuJoCo qvel',
    lines: jointDimLines(jointNames.length, zh),
    probeKeys: jointKeys
  });

  push({
    id: 'sim-cmd-vx',
    kind: 'signal',
    group: 'sim',
    title: zh ? '速度指令 vx' : 'Cmd vx',
    subtitle: zh ? '前后' : 'forward',
    lines: [{ k: 'vx' }],
    probeKeys: ['vx']
  });
  push({
    id: 'sim-cmd-vy',
    kind: 'signal',
    group: 'sim',
    title: zh ? '速度指令 vy' : 'Cmd vy',
    subtitle: zh ? '左右' : 'lateral',
    lines: [{ k: 'vy' }],
    probeKeys: ['vy']
  });
  push({
    id: 'sim-cmd-yaw',
    kind: 'signal',
    group: 'sim',
    title: zh ? '速度指令 yaw' : 'Cmd yaw',
    subtitle: zh ? '转向' : 'turn rate',
    lines: [{ k: 'yaw' }],
    probeKeys: ['yaw']
  });

  if (runner.obsJointPosRelative) {
    push({
      id: 'prep-joint-rel',
      kind: 'joints',
      group: 'preprocess',
      title: zh ? '关节相对化' : 'Joint relative',
      subtitle: 'q − q₀',
      lines: jointDimLines(jointNames.length, zh),
      probeKeys: jointKeys
    });
  }

  for (const block of obsLayout) {
    const slice = obsVector.subarray(block.offset, block.offset + block.size);
    const parts = decomposeObsBlock(block, slice, jointNames, lang);
    for (const part of parts) {
      push(part);
    }
  }

  // The clip is applied to the raw ONNX output (PolicyRunner.step), so it is
  // part of the action node rather than a preprocessing step.
  const clip = Number(runner.actionClip);
  push({
    id: 'out-action',
    kind: 'joints',
    group: 'output',
    title: zh ? '动作' : 'Action',
    subtitle: Number.isFinite(clip)
      ? (zh ? `裁剪到 ±${clip}` : `clipped to ±${clip}`)
      : (zh ? '网络输出' : 'network output'),
    lines: jointDimLines(jointNames.length, zh),
    probeKeys: jointKeys
  });

  push({
    id: 'out-target',
    kind: 'joints',
    group: 'output',
    title: zh ? '关节目标' : 'Joint Target',
    subtitle: 'q* = q₀ + s·a',
    lines: jointDimLines(jointNames.length, zh),
    probeKeys: jointKeys
  });

  if (motorJoints.length > 0) {
    push({
      id: 'motor-torque',
      kind: 'joints',
      group: 'motor',
      ...motorNodeText(options.controlType, zh),
      lines: jointDimLines(motorJoints.length, zh),
      probeKeys: motorJoints.map((j) => shortJointName(j.name))
    });
  }

  return nodes;
}
