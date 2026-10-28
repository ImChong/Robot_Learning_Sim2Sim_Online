import { formatFloat } from './policyTelemetry.js';
import { nodeHeightForLines } from './pipelineAtomicNodes.js';
import { policyFamilyLabel, findLoopbackPrevActionNode, isPrevActionObsNodeId } from './pipelineObsNodes.js';

const COL_GAP = 72;
const ROW_GAP = 16;
const ROW_GAP_MOBILE = 10;
const MARGIN_X = 28;
const MARGIN_Y = 22;
const LANE_HEADER = 44;
const LANE_PAD_X = 18;
const HISTORY_WIDTH = 232;
// Tall observation stacks (Tracking has ~30 terms) wrap into side-by-side
// sub-columns so the graph keeps a landscape shape and stays readable.
const OBS_SUB_GAP = 36;
const OBS_WRAP_MIN_HEIGHT = 900;
const OBS_WRAP_RATIO = 1.5;

function colX(index, widths) {
  let x = MARGIN_X;
  for (let i = 0; i < index; i++) {
    x += widths[i] + COL_GAP;
  }
  return x;
}

function stackColumn(nodes, x, gap = ROW_GAP, yStart = MARGIN_Y) {
  let y = yStart;
  let maxW = 0;
  for (const node of nodes) {
    node.x = x;
    node.y = y;
    maxW = Math.max(maxW, node.width ?? 120);
    y += (node.height ?? 48) + gap;
  }
  return { height: y + MARGIN_Y, width: maxW };
}

function columnHeight(nodes, gap = ROW_GAP) {
  return nodes.reduce((sum, node) => sum + (node.height ?? 48) + gap, 0);
}

/**
 * Split observation nodes into sub-columns, keeping concat order column-major.
 * Only wraps when the stack is much taller than the simulation column, so
 * typical policies keep a single observation column.
 * @param {Array<{ height?: number }>} obsNodes
 * @param {number} referenceHeight height of the simulation column
 * @returns {Array<Array<object>>}
 */
export function wrapObsColumns(obsNodes, referenceHeight) {
  const target = Math.max(referenceHeight, OBS_WRAP_MIN_HEIGHT);
  const total = columnHeight(obsNodes);
  if (obsNodes.length < 2 || total <= target * OBS_WRAP_RATIO) {
    return [obsNodes];
  }
  const count = Math.min(obsNodes.length, Math.max(2, Math.round(total / target)));
  const perColumn = Math.ceil(obsNodes.length / count);
  const columns = [];
  for (let i = 0; i < obsNodes.length; i += perColumn) {
    columns.push(obsNodes.slice(i, i + perColumn));
  }
  return columns;
}

function laneRange(startCol, endCol, colWidths) {
  const xStart = colX(startCol, colWidths) - LANE_PAD_X;
  const xEnd = colX(endCol, colWidths) + colWidths[endCol] + LANE_PAD_X;
  return { x: xStart, width: xEnd - xStart };
}

const CMD_SOURCE_IDS = ['sim-cmd-vx', 'sim-cmd-vy', 'sim-cmd-yaw'];

/**
 * Simulation / preprocessing nodes an observation node is computed from.
 * Terms without a live source (BootIndicator, compliance flags, zero padding
 * of Command13, unknown blocks) get no incoming edge instead of a made-up one.
 * @returns {string[]}
 */
export function obsSourceIds(obsNode, hasPrepRel) {
  const id = obsNode?.id ?? '';
  const jointPosSource = hasPrepRel ? 'prep-joint-rel' : 'sim-joint-pos';
  if (isPrevActionObsNodeId(id)) {
    // Fed by the action loopback edge.
    return [];
  }
  if (id.includes('JointPos')) {
    return [jointPosSource];
  }
  if (id.includes('JointVel')) {
    return ['sim-joint-vel'];
  }
  if (id.includes('RootAngVel')) {
    return ['sim-root-angvel'];
  }
  if (id.includes('ProjectedGravity')) {
    return ['sim-root-quat'];
  }
  if (id.includes('Command-vx')) {
    return ['sim-cmd-vx'];
  }
  if (id.includes('Command-vy')) {
    return ['sim-cmd-vy'];
  }
  if (id.includes('Command-yaw')) {
    return ['sim-cmd-yaw'];
  }
  if (id === 'obs-Command13-twist') {
    return CMD_SOURCE_IDS;
  }
  if (id.includes('TrackingCommandObsRaw') || id.includes('TargetRootZObs')) {
    return ['sim-root-quat'];
  }
  return [];
}

function pushObsEdges(edges, obs, hasPrepRel) {
  for (const src of obsSourceIds(obs, hasPrepRel)) {
    edges.push({ id: `e-${src}-${obs.id}`, from: src, to: obs.id });
  }
  edges.push({ id: `e-${obs.id}-wh`, from: obs.id, to: 'warehouse' });
}

/**
 * What each stage of the flow does, shown next to the numbered stage chips.
 * @param {string} laneId
 * @param {boolean} zh
 * @param {{ historyLength: number, hasLoopback: boolean }} context
 */
function laneDescription(laneId, zh, { historyLength, hasLoopback }) {
  switch (laneId) {
    case 'sim':
      return zh
        ? '每个控制周期从 MuJoCo 读取根位姿、角速度 $\\omega$、关节角 $q$ 与关节速度 $\\dot q$，以及摇杆/键盘给出的速度指令 $(v_x, v_y, \\omega_z)$。'
        : 'Each control step reads root pose, angular velocity $\\omega$, joint angles $q$ and velocities $\\dot q$ from MuJoCo, plus the joystick/keyboard velocity command $(v_x, v_y, \\omega_z)$.';
    case 'prep':
      return zh
        ? '几何预处理：关节角减去默认站姿 $q_0$，得到相对关节角 $q - q_0$。'
        : 'Geometric preprocessing: subtract the default pose $q_0$ to get relative joint angles $q - q_0$.';
    case 'obs':
      if (hasLoopback) {
        return zh
          ? '按训练时的顺序计算各观测项；虚线回环表示上一步的动作 $a_{t-1}$ 也作为本步观测。'
          : 'Compute each observation term in training order; the dashed loop feeds the previous action $a_{t-1}$ back as an observation.';
      }
      return zh
        ? '按训练时的顺序计算各观测项。'
        : 'Compute each observation term in training order.';
    case 'policy':
      if (historyLength > 1) {
        const stacked = `$\\hat a = \\pi([o_{t-${historyLength - 1}}, \\dots, o_t])$`;
        return zh
          ? `观测项拼接成单帧向量 $o_t$，与最近 ${historyLength} 帧历史堆叠后送入 ONNX 策略网络推理 ${stacked}。`
          : `Concatenate the terms into one frame $o_t$, stack the last ${historyLength} frames and run the ONNX policy ${stacked}.`;
      }
      return zh
        ? '观测项拼接成单帧向量 $o_t$，送入 ONNX 策略网络推理 $\\hat a = \\pi(o_t)$。'
        : 'Concatenate the terms into one frame vector $o_t$ and run the ONNX policy $\\hat a = \\pi(o_t)$.';
    case 'output':
      return zh
        ? '动作裁剪 $a = \\operatorname{clip}(\\hat a, \\pm c)$ → 目标关节角 $q^* = q_0 + s \\cdot a$ → 下发给电机执行。'
        : 'Clip the action $a = \\operatorname{clip}(\\hat a, \\pm c)$ → target joint angle $q^* = q_0 + s \\cdot a$ → sent to the motors.';
    case 'scope':
      return zh
        ? '点击任意信号节点，在示波器中查看它的实时曲线。'
        : 'Click any signal node to plot it live in the oscilloscope.';
    default:
      return '';
  }
}

function annotateLanes(graph, telemetry, zh) {
  const context = {
    historyLength: telemetry.concat?.historyLength ?? 1,
    hasLoopback: graph.edges.some((edge) => edge.kind === 'loopback')
  };
  graph.lanes.forEach((lane, index) => {
    lane.step = index + 1;
    lane.description = laneDescription(lane.id, zh, context);
  });
  return graph;
}

function cloneNodes(list) {
  return list.map((n) => ({ ...n, lines: n.lines ? [...n.lines] : [] }));
}

/**
 * @param {ReturnType<import('./policyTelemetry.js').buildPolicyTelemetry>} telemetry
 * @param {'zh'|'en'} lang
 * @param {{ layout?: 'horizontal' | 'vertical', activeProbes?: Array<{ id: string, nodeId: string, lineKey: string }> }} [options]
 */
export function buildPipelineGraph(telemetry, lang = 'zh', options = {}) {
  const zh = lang === 'zh';
  if (!telemetry?.ready) {
    return { nodes: [], edges: [], lanes: [], width: 480, height: 200, layout: options.layout ?? 'horizontal' };
  }

  const atomic = telemetry.atomicNodes ?? [];
  if (atomic.length === 0) {
    return { nodes: [], edges: [], lanes: [], width: 480, height: 200, layout: options.layout ?? 'horizontal' };
  }

  const activeProbes = options.activeProbes ?? [];
  const graph = options.layout === 'vertical'
    ? buildVerticalAtomicGraph(telemetry, zh, atomic)
    : buildHorizontalAtomicGraph(telemetry, zh, atomic);
  return annotateLanes(appendScopeSink(graph, activeProbes, zh), telemetry, zh);
}

function appendScopeSink(graph, activeProbes, zh) {
  const probes = activeProbes ?? [];
  const uniqueNodeIds = [...new Set(probes.map((p) => p.nodeId))];
  const channelCount = probes.length;
  const previewLines = probes.slice(0, 4).map((probe) => ({
    k: probe.lineKey,
    v: '●'
  }));
  const lines = [
    { k: zh ? '通道' : 'ch', v: String(channelCount) },
    ...previewLines
  ];
  if (channelCount > previewLines.length) {
    lines.push({ k: '…', v: `+${channelCount - previewLines.length}` });
  }

  const scopeHeight = nodeHeightForLines(lines);
  const scopeWidth = 200;
  let scopeX;
  let scopeY;

  if (graph.layout === 'vertical') {
    scopeX = graph.nodes[0]?.x ?? MARGIN_X;
    scopeY = graph.height + ROW_GAP_MOBILE;
    graph.height += scopeHeight + ROW_GAP_MOBILE + 8;
    graph.width = Math.max(graph.width, scopeWidth + MARGIN_X * 2);
  } else {
    const rightmost = graph.nodes.reduce((max, node) => Math.max(max, (node.x ?? 0) + (node.width ?? 0)), 0);
    scopeX = rightmost + COL_GAP;
    const coreY = graph.height / 2;
    scopeY = coreY - scopeHeight / 2;
    graph.width = scopeX + scopeWidth + MARGIN_X;
    graph.lanes.push({
      id: 'scope',
      label: zh ? '可视化' : 'Scope',
      x: scopeX - LANE_PAD_X,
      width: scopeWidth + LANE_PAD_X * 2
    });
  }

  graph.nodes.push({
    id: 'out-scope',
    kind: 'scope',
    title: zh ? '示波器' : 'Scope',
    subtitle: zh ? '实时曲线' : 'live curves',
    width: scopeWidth,
    height: scopeHeight,
    x: scopeX,
    y: scopeY,
    lines
  });

  const prev = graph.nodes
    .filter((n) => n.group === 'motor' || n.group === 'output')
    .map((n) => n.id)
    .pop();
  if (prev && !uniqueNodeIds.length) {
    graph.edges.push({ id: `e-${prev}-scope`, from: prev, to: 'out-scope', kind: 'scope' });
  }
  for (const nodeId of uniqueNodeIds) {
    graph.edges.push({
      id: `e-${nodeId}-scope`,
      from: nodeId,
      to: 'out-scope',
      kind: 'scope'
    });
  }

  return graph;
}

function appendActionLoopbackEdges(graph) {
  const prevNode = findLoopbackPrevActionNode(graph.nodes);
  if (!prevNode || !graph.nodes.some((node) => node.id === 'out-action')) {
    return;
  }
  graph.edges.push({
    id: `e-out-action-${prevNode.id}-loop`,
    from: 'out-action',
    to: prevNode.id,
    kind: 'loopback'
  });
}

function buildHorizontalAtomicGraph(telemetry, zh, atomic) {
  const simNodes = cloneNodes(atomic.filter((n) => n.group === 'sim'));
  const prepNodes = cloneNodes(atomic.filter((n) => n.group === 'preprocess'));
  const obsNodes = cloneNodes(atomic.filter((n) => n.group === 'obs'));
  const outputNodes = cloneNodes(atomic.filter((n) => n.group === 'output'));
  const motorNodes = cloneNodes(atomic.filter((n) => n.group === 'motor'));
  const hasPrepRel = prepNodes.some((n) => n.id === 'prep-joint-rel');
  const hasHistory = (telemetry.concat?.historyLength ?? 1) > 1;
  const onnxColWidth = 220;

  const colWidths = [];
  colWidths.push(Math.max(184, ...simNodes.map((n) => n.width ?? 184)));
  if (prepNodes.length) {
    colWidths.push(Math.max(184, ...prepNodes.map((n) => n.width ?? 184)));
  }
  const obsNodeWidth = Math.max(208, ...obsNodes.map((n) => n.width ?? 208));
  const obsColumns = wrapObsColumns(obsNodes, columnHeight(simNodes));
  colWidths.push(
    obsColumns.length * obsNodeWidth + (obsColumns.length - 1) * OBS_SUB_GAP
  );
  colWidths.push(200);
  if (hasHistory) {
    colWidths.push(HISTORY_WIDTH);
  }
  colWidths.push(onnxColWidth);
  for (const out of outputNodes) {
    colWidths.push(Math.max(208, out.width ?? 208));
  }
  if (motorNodes.length) {
    colWidths.push(Math.max(208, ...motorNodes.map((n) => n.width ?? 208)));
  }

  const nodes = [];
  const edges = [];
  const lanes = [];
  const yStart = MARGIN_Y + LANE_HEADER;
  let col = 0;

  const simStartCol = col;
  const xSim = colX(col, colWidths);
  const simStack = stackColumn(simNodes, xSim, ROW_GAP, yStart);
  nodes.push(...simNodes);
  lanes.push({
    id: 'sim',
    label: zh ? '仿真状态' : 'Simulation',
    ...laneRange(simStartCol, col, colWidths)
  });
  col += 1;

  if (prepNodes.length) {
    const prepStartCol = col;
    const xPrep = colX(col, colWidths);
    stackColumn(prepNodes, xPrep, ROW_GAP, yStart);
    nodes.push(...prepNodes);
    if (hasPrepRel) {
      edges.push({ id: 'e-sim-prep-joint', from: 'sim-joint-pos', to: 'prep-joint-rel' });
    }
    lanes.push({
      id: 'prep',
      label: zh ? '预处理' : 'Preprocess',
      ...laneRange(prepStartCol, col, colWidths)
    });
    col += 1;
  }

  const obsStartCol = col;
  const xObs = colX(col, colWidths);
  const obsStack = { height: 0 };
  obsColumns.forEach((column, index) => {
    const stack = stackColumn(column, xObs + index * (obsNodeWidth + OBS_SUB_GAP), ROW_GAP, yStart);
    obsStack.height = Math.max(obsStack.height, stack.height);
  });
  nodes.push(...obsNodes);
  for (const obs of obsNodes) {
    pushObsEdges(edges, obs, hasPrepRel);
  }
  lanes.push({
    id: 'obs',
    label: zh ? '观测构造' : 'Observation',
    ...laneRange(obsStartCol, col, colWidths)
  });
  col += 1;

  const innerHeight = Math.max(simStack.height, obsStack.height, 200);
  const coreY = yStart + (innerHeight - yStart) / 2;
  const historyLabel = hasHistory
    ? `${telemetry.concat.historyCount}/${telemetry.concat.historyLength}`
    : null;

  const policyStartCol = col;
  const xWarehouse = colX(col, colWidths);
  const warehouseLines = [
    { k: zh ? '单帧' : 'frame', v: `${telemetry.concat.currentFrameSize}D` },
    { k: zh ? '张量' : 'tensor', v: `${telemetry.concat.tensorSize}D` },
    ...(historyLabel ? [{ k: zh ? '历史' : 'hist', v: historyLabel }] : [])
  ];
  const warehouseHeight = nodeHeightForLines(warehouseLines);
  nodes.push({
    id: 'warehouse',
    kind: 'warehouse',
    title: zh ? '观测拼接' : 'Obs Concat',
    subtitle: zh ? '拼成单帧向量' : 'one frame vector',
    width: 200,
    height: warehouseHeight,
    x: xWarehouse,
    y: coreY - warehouseHeight / 2,
    lines: warehouseLines,
    // Structural nodes describe the tensor layout, they carry no plottable signal.
    probeKeys: []
  });
  col += 1;

  let onnxFrom = 'warehouse';
  if (hasHistory) {
    const xHistory = colX(col, colWidths);
    const historyLines = [
      { k: zh ? '窗口' : 'window', v: historyLabel },
      { k: zh ? '预览' : 'preview', v: formatVec(telemetry.concat.tensorPreview, 3) }
    ];
    const historyHeight = nodeHeightForLines(historyLines);
    nodes.push({
      id: 'history',
      kind: 'process',
      title: zh ? '历史缓冲' : 'History buffer',
      subtitle: zh
        ? `堆叠最近 ${telemetry.concat.historyLength} 帧`
        : `last ${telemetry.concat.historyLength} frames`,
      width: HISTORY_WIDTH,
      height: historyHeight,
      x: xHistory,
      y: coreY - historyHeight / 2,
      lines: historyLines,
      probeKeys: []
    });
    edges.push({ id: 'e-wh-hist', from: 'warehouse', to: 'history' });
    onnxFrom = 'history';
    col += 1;
  }

  const modelName = telemetry.model.path?.split('/').pop() ?? 'ONNX';
  const family = telemetry.policyFamily ?? 'generic';
  const familyLabel = policyFamilyLabel(family, zh);
  const xOnnx = colX(col, colWidths);
  const onnxWidth = onnxColWidth;
  const onnxLines = [
    { k: 'in', v: `${telemetry.onnx.inKeys.join(',')} ${shapeStr(telemetry.onnx.inputShape)}` },
    { k: 'out', v: telemetry.onnx.outKeys.join(',') }
  ];
  const onnxHeight = nodeHeightForLines(onnxLines);
  nodes.push({
    id: 'onnx',
    kind: 'model',
    title: zh ? '策略网络' : 'Policy net',
    subtitle: `${familyLabel} · ${modelName}`,
    width: onnxWidth,
    height: onnxHeight,
    x: xOnnx,
    y: coreY - onnxHeight / 2,
    lines: onnxLines,
    probeKeys: []
  });
  edges.push({ id: `e-${onnxFrom}-onnx`, from: onnxFrom, to: 'onnx' });
  lanes.push({
    id: 'policy',
    label: zh ? '策略推理' : 'Policy',
    ...laneRange(policyStartCol, col, colWidths)
  });
  col += 1;

  const outputStartCol = col;
  let prev = 'onnx';
  for (const out of outputNodes) {
    const xOut = colX(col, colWidths);
    out.x = xOut;
    out.y = coreY - (out.height ?? 50) / 2;
    nodes.push(out);
    edges.push({ id: `e-${prev}-${out.id}`, from: prev, to: out.id });
    prev = out.id;
    col += 1;
  }

  for (const motor of motorNodes) {
    const xMotor = colX(col, colWidths);
    motor.x = xMotor;
    motor.y = coreY - (motor.height ?? 50) / 2;
    nodes.push(motor);
    edges.push({ id: `e-${prev}-${motor.id}`, from: prev, to: motor.id });
    col += 1;
  }
  if (outputNodes.length || motorNodes.length) {
    lanes.push({
      id: 'output',
      label: zh ? '动作输出' : 'Output',
      ...laneRange(outputStartCol, col - 1, colWidths)
    });
  }

  const width = colX(col, colWidths) + (colWidths[col - 1] ?? 140) + MARGIN_X;
  const height = Math.max(simStack.height, obsStack.height, 300) + MARGIN_Y;

  const graph = { nodes, edges, lanes, width, height, layout: 'horizontal' };
  appendActionLoopbackEdges(graph);
  return graph;
}

function buildVerticalAtomicGraph(telemetry, zh, atomic) {
  const nodes = [];
  const edges = [];
  const x = MARGIN_X;
  let y = MARGIN_Y;
  const gap = ROW_GAP_MOBILE;
  const hasPrepRel = atomic.some((n) => n.id === 'prep-joint-rel');
  const hasHistory = (telemetry.concat?.historyLength ?? 1) > 1;

  const place = (node) => {
    nodes.push({
      width: Math.min(280, node.width ?? 280),
      ...node,
      x,
      y
    });
    y += (node.height ?? 48) + gap;
  };

  const groups = ['sim', 'preprocess', 'obs'];
  for (const group of groups) {
    for (const node of atomic.filter((n) => n.group === group)) {
      place({ ...node });
    }
  }

  const historyLabel = hasHistory
    ? `${telemetry.concat.historyCount}/${telemetry.concat.historyLength}`
    : null;

  place({
    id: 'warehouse',
    kind: 'warehouse',
    title: zh ? '观测拼接' : 'Obs Concat',
    subtitle: `${telemetry.concat.tensorSize}D`,
    height: 58,
    lines: [
      { k: zh ? '单帧' : 'frame', v: `${telemetry.concat.currentFrameSize}D` },
      ...(historyLabel ? [{ k: zh ? '历史' : 'hist', v: historyLabel }] : [])
    ],
    probeKeys: []
  });

  if (hasHistory) {
    place({
      id: 'history',
      kind: 'process',
      title: zh ? '历史缓冲' : 'History buffer',
      height: 52,
      lines: [{ k: zh ? '窗口' : 'win', v: historyLabel }],
      probeKeys: []
    });
  }

  const modelName = telemetry.model.path?.split('/').pop() ?? 'ONNX';
  place({
    id: 'onnx',
    kind: 'model',
    title: zh ? '策略网络' : 'Policy net',
    subtitle: modelName.length > 24 ? `${modelName.slice(0, 22)}…` : modelName,
    height: 60,
    lines: [
      { k: 'in', v: shapeStr(telemetry.onnx.inputShape) },
      { k: 'act', v: formatVec(telemetry.onnx.clippedAction, 3) }
    ],
    probeKeys: []
  });

  for (const node of atomic.filter((n) => n.group === 'output' || n.group === 'motor')) {
    place({ ...node });
  }

  if (hasPrepRel) {
    edges.push({ id: 'e-sim-prep-joint', from: 'sim-joint-pos', to: 'prep-joint-rel' });
  }
  for (const obs of atomic.filter((n) => n.group === 'obs')) {
    pushObsEdges(edges, obs, hasPrepRel);
  }

  let prev = hasHistory ? 'history' : 'warehouse';
  if (hasHistory) {
    edges.push({ id: 'e-wh-hist', from: 'warehouse', to: 'history' });
  }
  edges.push({ id: `e-${prev}-onnx`, from: prev, to: 'onnx' });
  prev = 'onnx';
  for (const out of atomic.filter((n) => n.group === 'output')) {
    edges.push({ id: `e-${prev}-${out.id}`, from: prev, to: out.id });
    prev = out.id;
  }
  for (const motor of atomic.filter((n) => n.group === 'motor')) {
    edges.push({ id: `e-${prev}-${motor.id}`, from: prev, to: motor.id });
    prev = motor.id;
  }

  const graph = {
    nodes,
    edges,
    lanes: [],
    width: 312,
    height: y + 8,
    layout: 'vertical'
  };
  appendActionLoopbackEdges(graph);
  return graph;
}

function formatVec(values, max = 3) {
  if (!values?.length) {
    return '—';
  }
  return values.slice(0, max).map((v) => formatFloat(v, 2)).join(', ');
}

function shapeStr(dims) {
  if (!dims?.length) {
    return '';
  }
  return `[${dims.join('×')}]`;
}
