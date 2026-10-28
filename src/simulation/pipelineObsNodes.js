import { shortJointName } from './jointLabels.js';
import { MAX_SCOPE_CHANNELS } from './scopeChannels.js';

const VEC3_KEYS = ['x', 'y', 'z'];

function vec3Lines(prefix = '') {
  return [
    { k: `${prefix}x` },
    { k: `${prefix}y` },
    { k: `${prefix}z` }
  ];
}

/**
 * Scope channel keys for a per-joint block: one curve per policy joint.
 * @param {string[]} jointNames
 */
function jointProbeKeys(jointNames) {
  return (jointNames ?? []).map((name) => shortJointName(name));
}

/**
 * Scope channel keys for a raw slice: one curve per element inside the block.
 * Indices are local to the block, matching how signalScope resolves `[i]`.
 * @param {number} size
 */
function indexProbeKeys(size) {
  const count = Math.min(MAX_SCOPE_CHANNELS, Math.max(0, Math.floor(size) || 0));
  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(`[${i}]`);
  }
  return keys;
}

function jointDimLines(count, zh) {
  return [{ k: zh ? '维度' : 'dim', v: `${count}D` }];
}

function dimLine(size, zh) {
  return [{ k: zh ? '维度' : 'dim', v: `${size}D` }];
}

function futureStepLabel(step, zh) {
  return zh ? `步 +${step}` : `step +${step}`;
}

/**
 * @param {{ config?: object, tracking?: unknown, historyLength?: number, policyId?: string, currentPolicyPath?: string }} runner
 */
export function inferPolicyFamily(runner) {
  if (!runner) {
    return 'generic';
  }
  const policyId = runner.policyId ?? '';
  const policyPath = String(
    runner.currentPolicyPath
    ?? runner.config?.onnx?.path
    ?? ''
  ).toLowerCase();
  if (
    policyId === 'g1-parkour'
    || policyPath.includes('parkour')
    || runner.config?.policy_kind === 'parkour'
  ) {
    return 'parkour';
  }
  if (runner.tracking || runner.config?.tracking) {
    return 'tracking';
  }
  const obsNames = (runner.config?.obs_config?.policy ?? []).map((entry) => entry.name);
  if (obsNames.some((name) => name === 'BootIndicator' || String(name).startsWith('Tracking') || String(name).startsWith('Target'))) {
    return 'tracking';
  }
  if (
    policyId.startsWith('microduck')
    || policyPath.includes('microduck')
    || runner.config?.policy_kind === 'microduck'
  ) {
    return 'microduck';
  }
  if ((runner.historyLength ?? runner.config?.obs_config?.history_length ?? 1) > 1) {
    return 'amp';
  }
  return 'generic';
}

export function policyFamilyLabel(family, lang = 'zh') {
  const zh = lang === 'zh';
  switch (family) {
    case 'amp':
      return zh ? 'AMP' : 'AMP';
    case 'tracking':
      return zh ? 'Tracking' : 'Tracking';
    case 'parkour':
      return zh ? '跑酷 (PHP)' : 'Parkour (PHP)';
    case 'microduck':
      return zh ? 'Microduck' : 'Microduck';
    default:
      return zh ? '策略' : 'Policy';
  }
}

/**
 * @param {Map<string, { offset: number, size: number, kind: string, keys?: string[] }>} map
 * @param {{ name: string, offset: number, size: number, kwargs?: object }} block
 * @param {number} numActions
 */
export function registerObsNodeOffsets(map, block, numActions = 0) {
  const idBase = `obs-${block.name}`;
  const nodes = decomposeObsBlockNodes(block, null, [], 'en', numActions);
  for (const node of nodes) {
    const offset = node.concatOffset ?? block.offset;
    const size = node.concatSize ?? block.size;
    if (node.signalKind === 'vec3') {
      map.set(node.id, { offset, size, kind: 'vec3' });
    } else if (node.signalKind === 'joint') {
      map.set(node.id, { offset, size, kind: 'joint' });
    } else if (node.signalKind === 'scalar') {
      map.set(node.id, { offset, size: 1, kind: 'scalar', keys: node.scalarKeys ?? [] });
    } else {
      map.set(node.id, { offset, size, kind: 'indexed' });
    }
  }
}

/**
 * @param {{ name: string, offset: number, size: number, kwargs?: object }} block
 * @param {Float32Array | number[] | null} slice
 * @param {string[]} jointNames
 * @param {'zh'|'en'} lang
 * @param {number} [numActions]
 */
export function decomposeObsBlockNodes(block, slice, jointNames, lang = 'zh', numActions = jointNames.length) {
  const zh = lang === 'zh';
  const data = slice ?? [];
  const idBase = `obs-${block.name}`;
  const actions = numActions || jointNames.length || 1;

  switch (block.name) {
    case 'RootAngVelB':
      return [{
        id: idBase,
        kind: 'signal',
        group: 'obs',
        signalKind: 'vec3',
        title: zh ? '根角速度' : 'Root AngVel',
        subtitle: zh ? '机体系 $\\omega_b$' : 'body $\\omega_b$',
        lines: vec3Lines(''),
        probeKeys: VEC3_KEYS,
        concatOffset: block.offset,
        concatSize: block.size
      }];
    case 'ProjectedGravityB':
      return [{
        id: idBase,
        kind: 'signal',
        group: 'obs',
        signalKind: 'vec3',
        title: zh ? '投影重力' : 'Proj Gravity',
        subtitle: '$g_b = R^\\top g$',
        lines: vec3Lines(''),
        probeKeys: VEC3_KEYS,
        concatOffset: block.offset,
        concatSize: block.size
      }];
    case 'Command13':
      return [
        {
          id: `${idBase}-twist`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '指令 twist' : 'Cmd twist',
          subtitle: '$v_x, v_y, \\omega_z$',
          lines: dimLine(3, zh),
          probeKeys: ['vx', 'vy', 'yaw'],
          concatOffset: block.offset,
          concatSize: 3
        },
        {
          id: `${idBase}-head`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '指令头部' : 'Cmd head',
          lines: dimLine(4, zh),
          probeKeys: indexProbeKeys(4),
          concatOffset: block.offset + 3,
          concatSize: 4
        },
        {
          id: `${idBase}-body`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '指令躯干' : 'Cmd body',
          lines: dimLine(6, zh),
          probeKeys: indexProbeKeys(6),
          concatOffset: block.offset + 7,
          concatSize: 6
        }
      ];
    case 'Command':
      return [
        {
          id: `${idBase}-vx`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['vx'],
          title: zh ? '指令 vx' : 'Cmd vx',
          lines: [{ k: 'vx' }],
          probeKeys: ['vx'],
          concatOffset: block.offset,
          concatSize: 1
        },
        {
          id: `${idBase}-vy`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['vy'],
          title: zh ? '指令 vy' : 'Cmd vy',
          lines: [{ k: 'vy' }],
          probeKeys: ['vy'],
          concatOffset: block.offset + 1,
          concatSize: 1
        },
        {
          id: `${idBase}-yaw`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['yaw'],
          title: zh ? '指令 yaw' : 'Cmd yaw',
          lines: [{ k: 'yaw' }],
          probeKeys: ['yaw'],
          concatOffset: block.offset + 2,
          concatSize: 1
        }
      ];
    case 'JointPos': {
      const steps = block.kwargs?.pos_steps ?? [0];
      const jointKeys = jointProbeKeys(jointNames);
      if (steps.length <= 1) {
        return [{
          id: idBase,
          kind: 'joints',
          group: 'obs',
          signalKind: 'joint',
          title: zh ? '关节位置' : 'Joint Position',
          subtitle: steps.length ? `step ${JSON.stringify(steps)}` : undefined,
          lines: jointDimLines(block.size, zh),
          probeKeys: jointKeys,
          concatOffset: block.offset,
          concatSize: block.size
        }];
      }
      return steps.map((step, idx) => ({
        id: `${idBase}-s${step}`,
        kind: 'joints',
        group: 'obs',
        signalKind: 'joint',
        title: zh ? `关节位置 ${futureStepLabel(step, zh)}` : `Joint Pos ${futureStepLabel(step, zh)}`,
        lines: jointDimLines(actions, zh),
        probeKeys: jointKeys,
        concatOffset: block.offset + idx * actions,
        concatSize: actions
      }));
    }
    case 'JointVel': {
      const steps = block.kwargs?.vel_steps ?? [0];
      const jointKeys = jointProbeKeys(jointNames);
      if (steps.length <= 1) {
        return [{
          id: idBase,
          kind: 'joints',
          group: 'obs',
          signalKind: 'joint',
          title: zh ? '关节速度' : 'Joint Velocity',
          subtitle: steps.length ? `step ${JSON.stringify(steps)}` : undefined,
          lines: jointDimLines(block.size, zh),
          probeKeys: jointKeys,
          concatOffset: block.offset,
          concatSize: block.size
        }];
      }
      return steps.map((step, idx) => ({
        id: `${idBase}-s${step}`,
        kind: 'joints',
        group: 'obs',
        signalKind: 'joint',
        title: zh ? `关节速度 ${futureStepLabel(step, zh)}` : `Joint Vel ${futureStepLabel(step, zh)}`,
        lines: jointDimLines(actions, zh),
        probeKeys: jointKeys,
        concatOffset: block.offset + idx * actions,
        concatSize: actions
      }));
    }
    case 'PrevActions': {
      const historySteps = Math.max(1, block.kwargs?.history_steps ?? 1);
      const jointKeys = jointProbeKeys(jointNames);
      const nodes = [];
      for (let t = 0; t < historySteps; t += 1) {
        const isLatest = t === 0;
        nodes.push({
          id: historySteps === 1 ? idBase : `${idBase}-t${t}`,
          kind: 'joints',
          group: 'obs',
          signalKind: 'joint',
          loopbackTarget: isLatest,
          title: isLatest
            ? (zh ? '上一动作' : 'Last Action')
            : (zh ? `历史动作 t-${t}` : `Action t-${t}`),
          subtitle: historySteps > 1 ? `×${historySteps}` : undefined,
          lines: jointDimLines(actions, zh),
          probeKeys: jointKeys,
          concatOffset: block.offset + t * actions,
          concatSize: actions,
          scrollable: actions > 6
        });
      }
      return nodes;
    }
    case 'BootIndicator':
      return [{
        id: idBase,
        kind: 'signal',
        group: 'obs',
        signalKind: 'scalar',
        scalarKeys: ['val'],
        title: 'Boot',
        lines: [{ k: 'val' }],
        probeKeys: ['val'],
        concatOffset: block.offset,
        concatSize: block.size
      }];
    case 'ComplianceFlagObs':
      return [
        {
          id: `${idBase}-en`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['on'],
          title: zh ? '顺应 开关' : 'Compliance on',
          lines: [{ k: 'on' }],
          probeKeys: ['on'],
          concatOffset: block.offset,
          concatSize: 1
        },
        {
          id: `${idBase}-th`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['thr'],
          title: zh ? '顺应 阈值' : 'Compliance thr',
          lines: [{ k: 'thr' }],
          probeKeys: ['thr'],
          concatOffset: block.offset + 1,
          concatSize: 1
        },
        {
          id: `${idBase}-kp`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['kp'],
          title: zh ? '顺应 kp' : 'Compliance kp',
          lines: [{ k: 'kp' }],
          probeKeys: ['kp'],
          concatOffset: block.offset + 2,
          concatSize: 1
        }
      ];
    case 'TrackingCommandObsRaw': {
      const futureSteps = block.kwargs?.future_steps ?? [0, 2, 4, 8, 16];
      const dposSize = Math.max(0, (futureSteps.length - 1) * 3);
      const rotSize = futureSteps.length * 6;
      const nodes = [];
      if (dposSize > 0) {
        nodes.push({
          id: `${idBase}-dpos`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '跟踪指令 Δpos' : 'Track Δpos',
          subtitle: zh ? '未来根位移 $\\Delta p$' : 'future root $\\Delta p$',
          lines: dimLine(dposSize, zh),
          probeKeys: indexProbeKeys(dposSize),
          concatOffset: block.offset,
          concatSize: dposSize
        });
      }
      if (rotSize > 0) {
        nodes.push({
          id: `${idBase}-r6`,
          kind: 'signal',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '跟踪指令 rot6d' : 'Track rot6d',
          subtitle: zh ? '未来根姿态' : 'future root rot6d',
          lines: dimLine(rotSize, zh),
          probeKeys: indexProbeKeys(rotSize),
          concatOffset: block.offset + dposSize,
          concatSize: rotSize
        });
      }
      return nodes.length ? nodes : [{
        id: idBase,
        kind: 'signal',
        group: 'obs',
        signalKind: 'indexed',
        title: block.name,
        lines: dimLine(block.size, zh),
        probeKeys: indexProbeKeys(block.size),
        concatOffset: block.offset,
        concatSize: block.size
      }];
    }
    case 'TargetJointPosObs': {
      const futureSteps = block.kwargs?.future_steps ?? [0, 2, 4, 8, 16];
      const half = Math.floor(block.size / 2);
      return [
        {
          id: `${idBase}-target`,
          kind: 'joints',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '目标关节角' : 'Target Joint Pos',
          subtitle: zh ? '参考轨迹 $q^{\\mathrm{ref}}$' : 'reference $q^{\\mathrm{ref}}$',
          lines: dimLine(half, zh),
          probeKeys: indexProbeKeys(half),
          concatOffset: block.offset,
          concatSize: half
        },
        {
          id: `${idBase}-err`,
          kind: 'joints',
          group: 'obs',
          signalKind: 'indexed',
          title: zh ? '关节角误差' : 'Joint Pos Error',
          subtitle: `$q^{\\mathrm{ref}} - q$ ×${futureSteps.length}`,
          lines: dimLine(block.size - half, zh),
          probeKeys: indexProbeKeys(block.size - half),
          concatOffset: block.offset + half,
          concatSize: block.size - half
        }
      ];
    }
    case 'TargetRootZObs': {
      const futureSteps = block.kwargs?.future_steps ?? [0, 2, 4, 8, 16];
      if (futureSteps.length <= 1) {
        return [{
          id: idBase,
          kind: 'signal',
          group: 'obs',
          signalKind: 'scalar',
          scalarKeys: ['z'],
          title: zh ? '目标根高度' : 'Target Root Z',
          lines: [{ k: 'z' }],
          probeKeys: ['z'],
          concatOffset: block.offset,
          concatSize: block.size
        }];
      }
      return futureSteps.map((step, idx) => ({
        id: `${idBase}-s${step}`,
        kind: 'signal',
        group: 'obs',
        signalKind: 'scalar',
        scalarKeys: ['z'],
        title: zh ? `目标根高度 ${futureStepLabel(step, zh)}` : `Target Root Z ${futureStepLabel(step, zh)}`,
        lines: [{ k: 'z' }],
        probeKeys: ['z'],
        concatOffset: block.offset + idx,
        concatSize: 1
      }));
    }
    case 'TargetProjectedGravityBObs': {
      const futureSteps = block.kwargs?.future_steps ?? [0, 2, 4, 8, 16];
      if (futureSteps.length <= 1) {
        return [{
          id: idBase,
          kind: 'signal',
          group: 'obs',
          signalKind: 'vec3',
          title: zh ? '目标重力方向' : 'Target Gravity',
          lines: vec3Lines(''),
          probeKeys: VEC3_KEYS,
          concatOffset: block.offset,
          concatSize: block.size
        }];
      }
      return futureSteps.map((step, idx) => ({
        id: `${idBase}-s${step}`,
        kind: 'signal',
        group: 'obs',
        signalKind: 'vec3',
        title: zh ? `目标重力 ${futureStepLabel(step, zh)}` : `Target Gravity ${futureStepLabel(step, zh)}`,
        lines: vec3Lines(''),
        probeKeys: VEC3_KEYS,
        concatOffset: block.offset + idx * 3,
        concatSize: 3
      }));
    }
    default: {
      // Indices are local to the block: signalScope resolves `[i]` as
      // blockOffset + i, so absolute offsets here would read the wrong slot.
      // The preview is built from a plain array — mapping over the typed-array
      // slice directly would coerce the line objects back to numbers.
      const previewKeys = indexProbeKeys(Math.min(6, data.length));
      return [{
        id: idBase,
        kind: 'signal',
        group: 'obs',
        signalKind: 'indexed',
        title: block.name,
        subtitle: `${block.size}D`,
        lines: previewKeys.map((k) => ({ k })),
        probeKeys: indexProbeKeys(block.size),
        concatOffset: block.offset,
        concatSize: block.size,
        scrollable: data.length > 4
      }];
    }
  }
}

export function isPrevActionObsNodeId(nodeId) {
  return nodeId === 'obs-PrevActions' || /^obs-PrevActions-t\d+$/.test(nodeId ?? '');
}

export function findLoopbackPrevActionNode(nodes) {
  const prevNodes = (nodes ?? []).filter((node) => isPrevActionObsNodeId(node.id));
  return prevNodes.find((node) => node.loopbackTarget)
    ?? prevNodes.find((node) => node.id === 'obs-PrevActions' || node.id === 'obs-PrevActions-t0')
    ?? prevNodes[0];
}
