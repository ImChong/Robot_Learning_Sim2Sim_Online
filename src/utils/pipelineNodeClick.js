import { nodeHasProbes } from '../simulation/signalScope.js';

export function isArchitectureNode(node) {
  return node?.kind === 'model' || node?.id === 'onnx';
}

/**
 * Structural nodes describe how the observation vector is assembled rather than
 * carrying a signal, so clicking them opens the stacking view.
 */
export function isStackNode(node) {
  return node?.kind === 'warehouse' || node?.id === 'warehouse' || node?.id === 'history';
}

/**
 * Decide what clicking a pipeline graph node should do.
 * @returns {'open-architecture' | 'open-scope' | 'open-stack' | 'probe-node' | null}
 */
export function pipelineNodeClickAction(node) {
  if (!node) {
    return null;
  }
  if (node.kind === 'scope') {
    return 'open-scope';
  }
  if (isArchitectureNode(node)) {
    return 'open-architecture';
  }
  if (isStackNode(node)) {
    return 'open-stack';
  }
  // Not the rendered lines: nodes that only show a dimension summary
  // ("dim 23D") still expose one scope channel per joint.
  if (nodeHasProbes(node)) {
    return 'probe-node';
  }
  return null;
}

export function pipelineNodeHintIcon(action) {
  if (action === 'open-architecture') {
    return 'ph-tree-structure';
  }
  if (action === 'open-stack') {
    return 'ph-stack';
  }
  return 'ph-wave-sine';
}
