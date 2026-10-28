<template>
  <div class="network-diagram" :class="{ 'network-diagram-live': live }">
    <svg
      class="network-diagram-svg"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g class="network-diagram-edges">
        <line
          v-for="edge in renderedEdges"
          :key="edge.id"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          class="network-diagram-edge"
        />
      </g>
      <g v-for="col in renderedColumns" :key="col.id" class="network-diagram-col">
        <circle
          v-for="(n, idx) in col.neurons"
          :key="`${col.id}-n${idx}`"
          :cx="col.cx"
          :cy="n.y"
          :r="NEURON_R"
          class="network-diagram-neuron"
          :class="`network-diagram-neuron-${col.kind}`"
        />
        <text
          v-if="col.ellipsisY != null"
          :x="col.cx"
          :y="col.ellipsisY"
          class="network-diagram-ellipsis"
          text-anchor="middle"
          dominant-baseline="middle"
        >⋮</text>
        <text
          :x="col.cx"
          :y="LABEL_TOP_Y"
          class="network-diagram-label"
          text-anchor="middle"
        >{{ col.label }}</text>
        <text
          v-if="col.transform"
          :x="col.cx"
          :y="LABEL_TOP_Y + 12"
          class="network-diagram-sublabel"
          text-anchor="middle"
        >{{ col.transform }}</text>
        <text
          :x="col.cx"
          :y="LABEL_BOTTOM_Y"
          class="network-diagram-dim"
          text-anchor="middle"
        >{{ col.dim }}</text>
        <text
          v-if="col.post && col.post.length"
          :x="col.cx"
          :y="LABEL_BOTTOM_Y + 12"
          class="network-diagram-post"
          text-anchor="middle"
        >+ {{ col.post.join(' + ') }}</text>
      </g>
    </svg>
  </div>
</template>

<script>
const NEURON_R = 3.4;
const MIN_VISIBLE = 3;
const MAX_VISIBLE = 22;
const NEURON_MIN_GAP = 7;
const NEURON_MAX_GAP = 14;
const LABEL_TOP_Y = 14;
const LABEL_BOTTOM_Y = 230;
const BODY_TOP_Y = 38;
const BODY_BOTTOM_Y = 212;
const COL_W = 78;
const PAD_X = 20;

function visibleNeuronCount(dim, maxDim) {
  if (!dim || dim <= 0) return MIN_VISIBLE;
  if (dim <= MAX_VISIBLE) return dim;
  const ratio = Math.sqrt(dim / Math.max(1, maxDim));
  const scaled = Math.round(ratio * MAX_VISIBLE);
  return Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, scaled));
}

export default {
  name: 'NetworkDiagram',
  props: {
    columns: { type: Array, required: true },
    architecture: { type: Object, default: null },
    live: { type: Boolean, default: false }
  },
  data: () => ({
    NEURON_R,
    LABEL_TOP_Y,
    LABEL_BOTTOM_Y
  }),
  computed: {
    width() {
      const cols = this.columns ?? [];
      return Math.max(320, PAD_X * 2 + cols.length * COL_W);
    },
    height() {
      return 264;
    },
    maxDim() {
      const cols = this.columns ?? [];
      let m = 0;
      for (const c of cols) if (c.dim > m) m = c.dim;
      return Math.max(1, m);
    },
    renderedColumns() {
      const cols = this.columns ?? [];
      const maxDim = this.maxDim;
      const bodyMid = (BODY_TOP_Y + BODY_BOTTOM_Y) / 2;
      const bodyH = BODY_BOTTOM_Y - BODY_TOP_Y;
      return cols.map((col, i) => {
        const cx = PAD_X + COL_W / 2 + i * COL_W;
        const visible = visibleNeuronCount(col.dim, maxDim);
        let gap = visible > 1 ? bodyH / (visible - 1) : 0;
        gap = Math.min(NEURON_MAX_GAP, Math.max(NEURON_MIN_GAP, gap));
        const totalH = (visible - 1) * gap;
        const cy0 = bodyMid - totalH / 2;
        const neurons = [];
        for (let k = 0; k < visible; k++) {
          neurons.push({ y: cy0 + k * gap });
        }
        const ellipsisY = (col.dim > visible)
          ? cy0 + Math.floor(visible / 2) * gap
          : null;
        return { ...col, cx, neurons, ellipsisY };
      });
    },
    renderedEdges() {
      const cols = this.renderedColumns;
      const edges = [];
      for (let i = 0; i < cols.length - 1; i++) {
        const a = cols[i];
        const b = cols[i + 1];
        for (const na of a.neurons) {
          for (const nb of b.neurons) {
            edges.push({
              id: `${a.id}-${b.id}-${na.y.toFixed(1)}-${nb.y.toFixed(1)}`,
              x1: a.cx + NEURON_R,
              y1: na.y,
              x2: b.cx - NEURON_R,
              y2: nb.y
            });
          }
        }
      }
      return edges;
    }
  }
};
</script>

<style scoped>
.network-diagram {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.network-diagram-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.network-diagram-edge {
  stroke: rgba(155, 155, 155, 0.18);
  stroke-width: 0.5;
}

.network-diagram-live .network-diagram-edge {
  stroke: rgba(var(--v-theme-primary), 0.22);
}

.network-diagram-neuron {
  fill: var(--viz-raised);
  stroke: rgba(155, 155, 155, 0.7);
  stroke-width: 1;
}

.network-diagram-live .network-diagram-neuron {
  stroke: rgba(var(--v-theme-primary), 0.9);
  fill: rgba(var(--v-theme-primary), 0.18);
}

.network-diagram-neuron-input,
.network-diagram-neuron-output {
  fill: var(--viz-panel);
}

.network-diagram-live .network-diagram-neuron-input,
.network-diagram-live .network-diagram-neuron-output {
  fill: rgba(var(--v-theme-primary), 0.32);
}

.network-diagram-ellipsis {
  font-size: 12px;
  fill: rgba(155, 155, 155, 0.85);
  font-weight: 700;
}

.network-diagram-label {
  font-size: 9px;
  fill: var(--viz-ink);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.network-diagram-sublabel {
  font-size: 8px;
  fill: rgba(155, 155, 155, 0.85);
  font-family: var(--font-mono);
}

.network-diagram-dim {
  font-size: 9.5px;
  fill: rgba(var(--v-theme-primary), 0.95);
  font-weight: 700;
  font-family: var(--font-mono);
}

.network-diagram-post {
  font-size: 7.5px;
  fill: rgba(155, 155, 155, 0.8);
}
</style>
