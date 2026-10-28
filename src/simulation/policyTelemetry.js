const OBS_META = {
  BootIndicator: {
    en: 'Boot flag (constant 0)',
    zh: '启动标志（常量 0）'
  },
  RootAngVelB: {
    en: 'Root angular velocity in body frame (3)',
    zh: '机体坐标系根角速度 (3)'
  },
  ProjectedGravityB: {
    en: 'Gravity direction in body frame via quatApplyInv (3)',
    zh: '四元数逆变换后的机体重力方向 (3)'
  },
  Command: {
    en: 'Velocity command [vx, vy, yaw_rate] (3)',
    zh: '速度指令 [vx, vy, 偏航角速度] (3)'
  },
  JointPos: {
    en: 'Joint position history (relative to default if enabled)',
    zh: '关节位置历史（若启用则为相对默认姿态）'
  },
  JointVel: {
    en: 'Joint velocity history',
    zh: '关节速度历史'
  },
  PrevActions: {
    en: 'Previous clipped policy actions',
    zh: '上一时刻裁剪后的策略动作'
  },
  ComplianceFlagObs: {
    en: '[enabled, enabled×threshold, enabled×kp] (3)',
    zh: '顺应性标志 [开关, 开关×阈值, 开关×kp] (3)'
  },
  TrackingCommandObsRaw: {
    en: 'Future ref root deltas + rot6d',
    zh: '未来参考根位姿增量 + rot6d'
  },
  TargetJointPosObs: {
    en: 'Future target joint pos and error',
    zh: '未来目标关节角与误差'
  },
  TargetRootZObs: {
    en: 'Future reference root height (+0.035)',
    zh: '未来参考根高度 (+0.035)'
  },
  TargetProjectedGravityBObs: {
    en: 'Future reference body gravity',
    zh: '未来参考机体重力方向'
  }
};

function pickLanguage(lang) {
  return lang === 'zh' ? 'zh' : 'en';
}

export function formatFloat(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toExponential(2);
  }
  if (abs >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(digits);
}

export function sampleArray(data, count = 4) {
  if (!data || data.length === 0) {
    return [];
  }
  const n = Math.min(count, data.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Number(data[i]));
  }
  return out;
}

export function summarizeArray(data) {
  if (!data || data.length === 0) {
    return { min: 0, max: 0, mean: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Number(data[i]);
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / data.length };
}

function describeObsBlock(name, kwargs, lang) {
  const locale = pickLanguage(lang);
  const base = OBS_META[name]?.[locale] ?? name;
  const parts = [base];
  if (kwargs.pos_steps) {
    parts.push(`pos_steps=${JSON.stringify(kwargs.pos_steps)}`);
  }
  if (kwargs.vel_steps) {
    parts.push(`vel_steps=${JSON.stringify(kwargs.vel_steps)}`);
  }
  if (kwargs.history_steps) {
    parts.push(`history_steps=${kwargs.history_steps}`);
  }
  if (kwargs.future_steps) {
    parts.push(`future_steps=${JSON.stringify(kwargs.future_steps)}`);
  }
  return parts.join(' · ');
}

export function buildObsLayout(runner) {
  const obsConfig = runner.config?.obs_config?.policy ?? [];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < runner.obsModules.length; i++) {
    const obs = runner.obsModules[i];
    const cfg = obsConfig[i] ?? {};
    const size = obs.size ?? 0;
    blocks.push({
      name: cfg.name ?? 'Unknown',
      kwargs: { ...cfg, name: undefined },
      offset,
      size
    });
    offset += size;
  }
  return blocks;
}

import { buildAtomicNodes } from './pipelineAtomicNodes.js';
import { inferPolicyFamily } from './pipelineObsNodes.js';

function buildMotorSample(demo, jointCount = 3) {
  if (!demo?.simulation || !demo.policyRunner) {
    return [];
  }
  const runner = demo.policyRunner;
  const n = Math.min(jointCount, runner.numActions);
  const samples = [];

  // Bolt: Cache simulation arrays outside loop to prevent repeated Emscripten TypedArray allocations
  const simQpos = demo.simulation.qpos;
  const simQvel = demo.simulation.qvel;
  const simCtrl = demo.simulation.ctrl;

  for (let i = 0; i < n; i++) {
    const qposAdr = demo.qpos_adr_policy?.[i];
    const qvelAdr = demo.qvel_adr_policy?.[i];
    const ctrlAdr = demo.ctrl_adr_policy?.[i];
    const name = runner.policyJointNames[i] ?? `joint_${i}`;
    const target = demo.actionTarget?.[i] ?? runner.target[i] ?? 0;
    const qpos = Number.isInteger(qposAdr) ? simQpos[qposAdr] : 0;
    const qvel = Number.isInteger(qvelAdr) ? simQvel[qvelAdr] : 0;
    const kp = demo.kpPolicy?.[i] ?? 0;
    const kd = demo.kdPolicy?.[i] ?? 0;
    const torque = kp * (target - qpos) + kd * (0 - qvel);
    const ctrl = Number.isInteger(ctrlAdr) ? simCtrl[ctrlAdr] : torque;
    samples.push({
      name,
      qpos,
      qvel,
      target,
      kp,
      kd,
      torque,
      ctrl
    });
  }
  return samples;
}

/**
 * Build a UI-friendly snapshot of the policy I/O pipeline.
 * @param {import('./policyRunner.js').PolicyRunner | null} runner
 * @param {import('./main.js').MuJoCoDemo | null} demo
 * @param {{ lang?: string }} [options]
 */
export function buildPolicyTelemetry(runner, demo, options = {}) {
  const lang = pickLanguage(options.lang);
  if (!runner) {
    return { ready: false, lang };
  }

  const obsLayout = buildObsLayout(runner);
  const obsVector = runner.historyLength > 1 ? runner.fullObs : runner.obsForPolicy;
  const obsBlocks = obsLayout.map((block) => {
    const slice = obsVector.subarray(block.offset, block.offset + block.size);
    return {
      ...block,
      description: describeObsBlock(block.name, block.kwargs, lang),
      values: sampleArray(slice, 6),
      stats: summarizeArray(slice)
    };
  });

  const onnxMeta = runner.config?.onnx?.meta ?? {};
  const tensorData = runner.historyLength > 1 ? runner.fullObs : runner.obsForPolicy;
  const tensorSize = tensorData.length;
  const state = demo?.readPolicyState?.() ?? null;

  const preprocessing = {
    obsJointPosRelative: runner.obsJointPosRelative,
    actionClip: runner.actionClip,
    cmd: state?.cmd ? [...state.cmd] : [0, 0, 0],
    complianceEnabled: Boolean(state?.complianceEnabled),
    complianceThreshold: state?.complianceThreshold ?? 0,
    rootPos: state?.rootPos ? sampleArray(state.rootPos, 3) : [],
    rootAngVel: state?.rootAngVel ? sampleArray(state.rootAngVel, 3) : [],
    jointPosSample: state?.jointPos ? sampleArray(state.jointPos, 4) : [],
    jointVelSample: state?.jointVel ? sampleArray(state.jointVel, 4) : []
  };

  if (runner.obsJointPosRelative && state?.jointPos) {
    preprocessing.jointPosRelativeSample = sampleArray(runner.cachedJointPosRel, 4);
  }

  if (state?.rootQuat) {
    preprocessing.rootQuat = [state.rootQuat[0], state.rootQuat[1], state.rootQuat[2], state.rootQuat[3]];
  }
  if (state?.jointPos) {
    preprocessing.jointPosAll = Array.from(state.jointPos);
  }
  if (state?.jointVel) {
    preprocessing.jointVelAll = Array.from(state.jointVel);
  }

  const motorJoints = buildMotorSample(demo, runner.numActions);
  const policyFamily = inferPolicyFamily({
    ...runner,
    policyId: options.policyId,
    currentPolicyPath: options.currentPolicyPath ?? demo?.currentPolicyPath
  });
  const atomicNodes = buildAtomicNodes(runner, state, obsVector, obsLayout, lang, motorJoints, {
    controlType: demo?.control_type
  });

  const onnx = {
    inKeys: onnxMeta.in_keys ?? runner.module?.inKeys ?? ['policy'],
    outKeys: onnxMeta.out_keys ?? runner.module?.outKeys ?? ['action'],
    inputShape: [1, tensorSize],
    inputPreview: sampleArray(tensorData, 8),
    rawAction: sampleArray(runner.lastRawAction, 6),
    clippedAction: sampleArray(runner.lastActions, 6),
    extraOutputs: runner.lastExtraOutputs ?? {},
    architecture: runner.module?.architecture ?? null
  };

  const postprocess = {
    formula: lang === 'zh'
      ? 'target[i] = defaultJointPos[i] + actionScale[i] × clip(action[i])'
      : 'target[i] = defaultJointPos[i] + actionScale[i] × clip(action[i])',
    actionScaleSample: sampleArray(runner.actionScale, 4),
    defaultJointPosSample: sampleArray(runner.defaultJointPos, 4),
    targetSample: sampleArray(runner.target, 6),
    targetStats: summarizeArray(runner.target)
  };

  const motor = {
    controlType: demo?.control_type ?? 'unknown',
    decimation: demo?.decimation ?? 1,
    policyHz: demo?.getSimStepHz?.() ?? demo?.simStepHz ?? 0,
    joints: motorJoints
  };

  const normalizerNote = lang === 'zh'
    ? 'AMP 等策略的观测归一化通常已烘焙进 ONNX；浏览器端主要做几何/相对关节等预处理。'
    : 'Observation normalization for AMP-like policies is usually baked into ONNX; the browser applies geometric / relative-joint preprocessing.';

  return {
    ready: true,
    lang,
    timestamp: runner.lastStepAt ?? 0,
    stepCount: runner.stepCount ?? 0,
    model: {
      path: runner.config?.onnx?.path ?? '',
      isRecurrent: Boolean(runner.module?.isRecurrent),
      numActions: runner.numActions,
      numObs: runner.numObs,
      historyLength: runner.historyLength,
      historyCount: runner.historyCount,
      normalizerNote
    },
    preprocessing,
    obsBlocks,
    atomicNodes,
    policyFamily,
    jointNames: runner.policyJointNames.slice(),
    concat: {
      currentFrameSize: runner.numObs,
      historyLength: runner.historyLength,
      historyCount: runner.historyCount,
      tensorSize,
      tensorPreview: sampleArray(tensorData, 8),
      tensorStats: summarizeArray(tensorData)
    },
    onnx,
    postprocess,
    motor
  };
}
