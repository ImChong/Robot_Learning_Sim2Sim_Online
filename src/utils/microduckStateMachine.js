/**
 * Microduck 状态机：下拉栏只保留一个 Microduck 条目，
 * 具体策略（行走 / 站立 / 坐下起立 / 前滚翻）由控制面板内的状态机按钮切换。
 * 所有状态共用 microduck/scene.xml 与 61 维观测合同，切换时只重载 ONNX。
 */
const CHECKPOINT_ROOT = './examples/checkpoints/microduck';

export const MICRODUCK_POLICY_VALUE = 'microduck';
export const MICRODUCK_SCENE_PATH = 'microduck/scene.xml';
export const MICRODUCK_DEFAULT_STATE = 'walk';

/** 状态机轮询自动跳转条件的间隔（毫秒）。 */
export const MICRODUCK_AUTO_NEXT_POLL_MS = 200;

/** Roulade 是瞬态动作，滚完后自动回到行走状态。 */
export const MICRODUCK_STATES = [
  {
    value: 'walk',
    labelKey: 'microduckStateWalk',
    hintKey: 'microduckStateWalkHint',
    icon: 'ph-person-simple-walk',
    policyPath: `${CHECKPOINT_ROOT}/walk_policy.json`,
    onnxPath: `${CHECKPOINT_ROOT}/alpha_walking.onnx`,
    commandMode: 'velocity'
  },
  {
    value: 'stand',
    labelKey: 'microduckStateStand',
    hintKey: 'microduckStateStandHint',
    icon: 'ph-person-simple',
    policyPath: `${CHECKPOINT_ROOT}/stand_policy.json`,
    onnxPath: `${CHECKPOINT_ROOT}/alpha_stand.onnx`,
    commandMode: 'zeros'
  },
  {
    value: 'sitstand',
    labelKey: 'microduckStateSitstand',
    hintKey: 'microduckStateSitstandHint',
    icon: 'ph-chair',
    policyPath: `${CHECKPOINT_ROOT}/sitstand_policy.json`,
    onnxPath: `${CHECKPOINT_ROOT}/alpha_sitstand.onnx`,
    commandMode: 'sitstand'
  },
  {
    value: 'roulade',
    labelKey: 'microduckStateRoulade',
    hintKey: 'microduckStateRouladeHint',
    icon: 'ph-arrows-clockwise',
    policyPath: `${CHECKPOINT_ROOT}/roulade_policy.json`,
    onnxPath: `${CHECKPOINT_ROOT}/roulade.onnx`,
    commandMode: 'zeros',
    autoNext: 'walk',
    // 按仿真时间计，慢设备上滚完整套动作后才切回，不会被墙钟提前打断。
    autoNextSimSeconds: 6
  }
];

export function findMicroduckState(value) {
  return MICRODUCK_STATES.find((state) => state.value === value) ?? null;
}

export function microduckStateOrDefault(value) {
  return findMicroduckState(value) ?? findMicroduckState(MICRODUCK_DEFAULT_STATE);
}

/** 单条下拉栏对应的默认策略资源（默认进入 walk 状态）。 */
export function microduckDefaultPolicyPaths() {
  const state = microduckStateOrDefault(MICRODUCK_DEFAULT_STATE);
  return {
    policyPath: state.policyPath,
    onnxPath: state.onnxPath,
    scenePath: MICRODUCK_SCENE_PATH
  };
}
