<template>
  <div class="pipeline-shell" :class="{ 'pipeline-shell-mobile': isMobile }">
    <nav v-if="stages.length" class="pipeline-stages" :aria-label="text.stagesAria">
      <template v-for="(lane, idx) in stages" :key="`stage-${lane.id}`">
        <button
          type="button"
          class="pipeline-stage"
          :class="{ 'pipeline-stage-active': focusedLaneId === lane.id }"
          :data-stage-id="lane.id"
          :aria-pressed="focusedLaneId === lane.id"
          @click="focusLane(lane)"
          @mouseenter="hoveredLaneId = lane.id"
          @mouseleave="hoveredLaneId = null"
          @focus="hoveredLaneId = lane.id"
          @blur="hoveredLaneId = null"
        >
          <span class="pipeline-stage-step">{{ lane.step }}</span>
          <span class="pipeline-stage-label">{{ lane.label }}</span>
        </button>
        <v-icon
          v-if="idx < stages.length - 1"
          icon="ph-caret-right"
          size="14"
          class="pipeline-stage-arrow"
          aria-hidden="true"
        />
      </template>
    </nav>
    <p class="pipeline-caption text-caption">
      <template v-if="captionStage">
        <strong class="pipeline-caption-title">{{ captionStage.step }} · {{ captionStage.label }}</strong>
        <MathText :text="captionStage.description" />
      </template>
      <template v-else>{{ isMobile ? text.overviewMobile : text.overview }}</template>
    </p>
    <div
      ref="viewport"
      class="pipeline-viewport pipeline-viewport-zoom"
      :class="{
        'pipeline-viewport-dragging': isDragging,
        'pipeline-viewport-animate': animating
      }"
      :style="viewportStyle"
    >
      <div
        v-if="layout.lanes && layout.lanes.length"
        class="pipeline-lane-headers"
        aria-hidden="true"
      >
        <div
          v-for="lane in layout.lanes"
          :key="`lane-header-${lane.id}`"
          class="pipeline-lane-header"
          :class="{ 'pipeline-lane-header-active': focusedLaneId === lane.id }"
          :style="{
            left: `${lane.x * scale + panX}px`,
            width: `${lane.width * scale}px`
          }"
        >
          <span class="pipeline-lane-header-text">
            <span class="pipeline-lane-header-step">{{ lane.step }}</span>
            <span
              v-if="!isLaneHeaderCompact(lane)"
              class="pipeline-lane-header-label"
            >{{ lane.label }}</span>
          </span>
        </div>
      </div>
      <div
        class="pipeline-transform"
        :style="transformStyle"
      >
        <div
          class="pipeline-canvas"
          :style="{ width: `${layout.width}px`, height: `${layout.height}px` }"
        >
          <div class="pipeline-grid" aria-hidden="true" />
          <div
            v-for="(lane, idx) in layout.lanes"
            :key="`lane-${lane.id}`"
            class="pipeline-lane"
            :class="[
              `pipeline-lane-${lane.id}`,
              {
                'pipeline-lane-alt': idx % 2 === 1,
                'pipeline-lane-focused': focusedLaneId === lane.id
              }
            ]"
            :style="{
              transform: `translate(${lane.x}px, 0)`,
              width: `${lane.width}px`,
              height: `${layout.height}px`
            }"
            aria-hidden="true"
          />
          <svg
            class="pipeline-edges"
            :width="layout.width"
            :height="layout.height"
            aria-hidden="true"
          >
            <defs>
              <marker
                :id="arrowMarkerId"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0,1 L8,5 L0,9 Z" class="pipeline-edge-arrow" />
              </marker>
            </defs>
            <path
              v-for="edge in renderedEdges"
              :key="edge.id"
              :d="edge.d"
              class="pipeline-edge"
              :class="{
                'pipeline-edge-active': live,
                'pipeline-edge-scope': edge.kind === 'scope',
                'pipeline-edge-loopback': edge.kind === 'loopback',
                'pipeline-edge-related': highlight && highlight.edges.has(edge.id),
                'pipeline-edge-dimmed': highlight && !highlight.edges.has(edge.id)
              }"
              :marker-end="edge.kind === 'scope' || edge.kind === 'loopback' ? undefined : `url(#${arrowMarkerId})`"
            />
          </svg>

          <div
            v-for="node in layout.nodes"
            :key="node.id"
            :data-node-id="node.id"
            class="pipeline-node"
            :class="[
              `pipeline-node-${node.kind}`,
              {
                'pipeline-node-live': live,
                'pipeline-node-scope': node.kind === 'scope',
                'pipeline-node-clickable': isNodeClickable(node),
                'pipeline-node-probed': isNodeProbed(node),
                'pipeline-node-hovered': hoveredNodeId === node.id,
                'pipeline-node-dimmed': highlight && !highlight.nodes.has(node.id)
              }
            ]"
            :style="{
              width: `${node.width}px`,
              height: `${node.height}px`,
              transform: `translate(${node.x}px, ${node.y}px)`
            }"
            :title="nodeClickHint(node)"
            @mouseenter="onNodeHover(node)"
            @mouseleave="onNodeLeave(node)"
            @click.stop="onNodeClick(node)"
          >
            <div class="pipeline-node-body">
              <span
                class="pipeline-port pipeline-port-in"
                aria-hidden="true"
              />
              <div class="pipeline-node-inner">
                <div class="pipeline-node-head">
                  <v-icon
                    v-if="isNodeClickable(node)"
                    :icon="nodeHintIcon(node)"
                    size="12"
                    class="pipeline-node-scope-hint"
                  />
                  <div class="pipeline-node-title" :title="node.title">{{ node.title }}</div>
                  <MathText
                    v-if="node.subtitle"
                    tag="div"
                    class="pipeline-node-subtitle"
                    :title="plainText(node.subtitle)"
                    :text="node.subtitle"
                  />
                </div>
                <div
                  class="pipeline-node-card"
                  :class="{ 'pipeline-node-card-clickable': isNodeClickable(node) }"
                  @click.stop="onNodeClick(node)"
                >
                  <div
                    v-for="(line, idx) in nodeLines(node).rows"
                    :key="idx"
                    class="pipeline-node-line"
                    :class="{
                      'pipeline-node-line-probed': isLineProbed(node.id, line.k)
                    }"
                  >
                    <span class="pipeline-node-key" :title="line.k">{{ line.k }}</span>
                    <span
                      class="pipeline-node-val pipeline-node-meta"
                      :title="line.v"
                    >{{ line.v }}</span>
                  </div>
                  <div
                    v-if="nodeLines(node).chips.length"
                    class="pipeline-node-chips"
                  >
                    <span
                      v-for="chip in nodeLines(node).chips"
                      :key="chip.k"
                      class="pipeline-node-chip"
                      :class="{
                        'pipeline-node-chip-probed': isLineProbed(node.id, chip.k)
                      }"
                    >{{ chip.k }}</span>
                  </div>
                </div>
              </div>
              <span
                class="pipeline-port pipeline-port-out"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="layout.nodes.length" class="pipeline-overlay pipeline-legend">
        <span class="pipeline-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" class="pipeline-legend-line pipeline-legend-flow" />
          </svg>
          {{ isMobile ? text.legendFlowShort : text.legendFlow }}
        </span>
        <span v-if="hasLoopback" class="pipeline-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" class="pipeline-legend-line pipeline-legend-loopback" />
          </svg>
          {{ isMobile ? text.legendLoopbackShort : text.legendLoopback }}
        </span>
        <span class="pipeline-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" class="pipeline-legend-line pipeline-legend-scope" />
          </svg>
          {{ isMobile ? text.legendScopeShort : text.legendScope }}
        </span>
      </div>

      <div class="pipeline-overlay pipeline-view-controls">
        <button
          type="button"
          class="pipeline-view-btn"
          :title="text.zoomOut"
          :aria-label="text.zoomOut"
          @click="zoomBy(1 / ZOOM_STEP)"
        >
          <v-icon icon="ph-minus" size="16" />
        </button>
        <button
          type="button"
          class="pipeline-view-btn"
          :title="text.zoomIn"
          :aria-label="text.zoomIn"
          @click="zoomBy(ZOOM_STEP)"
        >
          <v-icon icon="ph-plus" size="16" />
        </button>
        <button
          type="button"
          class="pipeline-view-btn"
          data-action="fit"
          :title="text.fitView"
          :aria-label="text.fitView"
          @click="resetView"
        >
          <v-icon icon="ph-frame-corners" size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import MathText from '@/components/MathText.vue';
import { buildPipelineGraph } from '@/simulation/pipelineGraphLayout.js';
import { splitNodeLines } from '@/simulation/pipelineAtomicNodes.js';
import { mathTextToPlain } from '@/utils/mathText.js';
import { portPointFromLayoutNode } from '@/simulation/pipelineGraphEdgeCoords.js';
import {
  pipelineNodeClickAction,
  pipelineNodeHintIcon
} from '@/utils/pipelineNodeClick.js';

let graphInstanceCounter = 0;

const FIT_MIN_SCALE = 0.12;
const MIN_SCALE = 0.12;
const MAX_SCALE = 3;
const WHEEL_ZOOM_FACTOR = 1.1;
const ZOOM_STEP = 1.25;
// Programmatic fits ease into place; gestures stay immediate.
const VIEW_ANIMATION_MS = 280;
const FIT_PAD = 10;
// The lane header pills and the legend / zoom buttons overlay the viewport.
const HEADER_INSET = 34;
const FOOTER_INSET = 30;
// Focusing a stage zooms at least this far so node text stays legible.
const READABLE_SCALE = 0.85;
const LANE_MAX_SCALE = 1.2;
// Must match loopbackBezierPath: the feedback curve dips below its nodes.
const LOOPBACK_DROP = 72;

const TEXT = {
  en: {
    stagesAria: 'Pipeline stages',
    overview:
      'Every control step, data flows left to right: sim state → observations → policy net → action → motors. Click a step to zoom into it and a node to plot it live; drag to pan, scroll to zoom.',
    overviewMobile:
      'Data flows left to right every control step. Tap a step to zoom in, a node to plot it; drag to pan, pinch to zoom.',
    legendFlow: 'Data flow',
    legendFlowShort: 'Flow',
    legendLoopback: 'Previous action fed back',
    legendLoopbackShort: 'Prev action',
    legendScope: 'Scope probe',
    legendScopeShort: 'Probe',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit the whole pipeline'
  },
  zh: {
    stagesAria: '流程阶段',
    overview:
      '每个控制周期，数据从左到右流动一次：仿真状态 → 观测 → 策略网络 → 动作 → 电机。点击步骤放大该阶段，点击节点查看实时曲线；拖动平移，滚轮缩放。',
    overviewMobile:
      '每个控制周期数据从左到右流动一次。点步骤放大该阶段，点节点看曲线；拖动平移，双指缩放。',
    legendFlow: '数据流',
    legendFlowShort: '数据流',
    legendLoopback: '上一步动作回送',
    legendLoopbackShort: '动作回送',
    legendScope: '示波器探针',
    legendScopeShort: '探针',
    zoomIn: '放大',
    zoomOut: '缩小',
    fitView: '显示完整流程'
  }
};

/** Rough pill width for a lane label, used to fall back to the step number. */
function estimateLabelWidth(label) {
  let width = 0;
  for (const ch of String(label ?? '')) {
    width += ch.codePointAt(0) > 0x2e80 ? 11.5 : 6.8;
  }
  return width;
}

/**
 * Canvas rectangle the graph content occupies, including the loopback curve
 * that dips below the observation column.
 */
function contentRect(nodes, edges = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const centerY = new Map();
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const h = node.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (node.width ?? 0));
    maxY = Math.max(maxY, y + h);
    centerY.set(node.id, y + h / 2);
  }
  for (const edge of edges) {
    if (edge.kind !== 'loopback' || !centerY.has(edge.from) || !centerY.has(edge.to)) {
      continue;
    }
    maxY = Math.max(maxY, Math.max(centerY.get(edge.from), centerY.get(edge.to)) + LOOPBACK_DROP);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function touchCenter(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  };
}

function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export default {
  name: 'ModelIOPipelineGraph',
  components: { MathText },
  props: {
    telemetry: {
      type: Object,
      required: true
    },
    language: {
      type: String,
      default: 'zh'
    },
    live: {
      type: Boolean,
      default: false
    },
    isMobile: {
      type: Boolean,
      default: false
    },
    activeProbes: {
      type: Array,
      default: () => []
    }
  },
  emits: ['probe-node', 'open-scope', 'open-architecture', 'open-stack'],
  data: () => ({
    resizeObserver: null,
    arrowMarkerId: `pipeline-arrow-${++graphInstanceCounter}`,
    panX: 0,
    panY: 0,
    scale: 1,
    gesture: null,
    isDragging: false,
    // 'fit' keeps the whole graph in view, 'lane' keeps the focused stage in
    // view, 'manual' leaves the camera where the user put it.
    viewMode: 'fit',
    focusedLaneId: null,
    hoveredLaneId: null,
    hoveredNodeId: null,
    animating: false,
    ZOOM_STEP
  }),
  computed: {
    text() {
      return TEXT[this.language === 'en' ? 'en' : 'zh'];
    },
    stages() {
      return this.layout.lanes ?? [];
    },
    /** The stage whose description the caption shows: hovered beats focused. */
    captionStage() {
      const id = this.hoveredLaneId ?? this.focusedLaneId;
      return id ? this.stages.find((lane) => lane.id === id) ?? null : null;
    },
    /** Node ids only: a policy switch changes it, live values and probes do not. */
    layoutKey() {
      return this.layout.nodes.map((node) => node.id).join('|');
    },
    hasLoopback() {
      return this.layout.edges.some((edge) => edge.kind === 'loopback');
    },
    nodeLineMap() {
      return new Map(this.layout.nodes.map((node) => [node.id, splitNodeLines(node.lines)]));
    },
    /** Hovering a node lights up where its data comes from and goes to. */
    highlight() {
      const id = this.hoveredNodeId;
      if (!id || this.isDragging) {
        return null;
      }
      const nodes = new Set([id]);
      const edges = new Set();
      for (const edge of this.layout.edges) {
        if (edge.from === id || edge.to === id) {
          edges.add(edge.id);
          nodes.add(edge.from);
          nodes.add(edge.to);
        }
      }
      return { nodes, edges };
    },
    layout() {
      const lang = this.language === 'en' ? 'en' : 'zh';
      return buildPipelineGraph(this.telemetry, lang, {
        layout: 'horizontal',
        activeProbes: this.activeProbes
      });
    },
    activeProbeIds() {
      return new Set(this.activeProbes.map((probe) => probe.id));
    },
    probedNodeIds() {
      return new Set(this.activeProbes.map((probe) => probe.nodeId));
    },
    viewportStyle() {
      if (this.isMobile) {
        return null;
      }
      return {
        flex: '1 1 auto',
        minHeight: '280px'
      };
    },
    transformStyle() {
      return {
        transform: `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`,
        transformOrigin: '0 0',
        width: `${this.layout.width}px`,
        height: `${this.layout.height}px`
      };
    },
    nodeById() {
      return new Map(this.layout.nodes.map((node) => [node.id, node]));
    },
    renderedEdges() {
      const portPoint = (nodeId, side) =>
        portPointFromLayoutNode(this.nodeById.get(nodeId), side);

      return this.layout.edges
        .map((edge) => {
          const from = portPoint(edge.from, 'out');
          const to = portPoint(edge.to, 'in');
          if (!from || !to) {
            return null;
          }
          return {
            id: edge.id,
            d: edge.kind === 'loopback'
              ? this.loopbackBezierPath(from, to)
              : this.horizontalBezierPath(from, to),
            kind: edge.kind
          };
        })
        .filter(Boolean);
    }
  },
  watch: {
    // A new policy brings a different graph: drop the old camera and focus.
    layoutKey() {
      this.viewMode = 'fit';
      this.focusedLaneId = null;
      this.hoveredLaneId = null;
      this.hoveredNodeId = null;
    },
    layout() {
      this.scheduleViewportFit();
    },
    isMobile() {
      this.viewMode = this.focusedLaneId ? 'lane' : 'fit';
      this.scheduleViewportFit();
    }
  },
  mounted() {
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleViewportFit();
    });
    if (this.$refs.viewport) {
      this.resizeObserver.observe(this.$refs.viewport);
    }
    this.setupViewportHandlers();
    this.scheduleViewportFit();
  },
  beforeUnmount() {
    this.teardownViewportHandlers();
    this.resizeObserver?.disconnect();
    if (this._fitRaf) {
      cancelAnimationFrame(this._fitRaf);
    }
    clearTimeout(this._animationTimer);
  },
  methods: {
    shouldIgnorePanStart(target) {
      return Boolean(target?.closest?.('.pipeline-node, .pipeline-overlay'));
    },
    markUserGestured() {
      this.viewMode = 'manual';
    },
    plainText(text) {
      return mathTextToPlain(text);
    },
    nodeLines(node) {
      return this.nodeLineMap.get(node.id) ?? { rows: [], chips: [] };
    },
    isLaneHeaderCompact(lane) {
      return lane.width * this.scale < estimateLabelWidth(lane.label) + 60;
    },
    animateView() {
      this.animating = true;
      clearTimeout(this._animationTimer);
      this._animationTimer = setTimeout(() => {
        this.animating = false;
      }, VIEW_ANIMATION_MS);
    },
    /** Zoom onto one stage; clicking the focused stage again shows everything. */
    focusLane(lane) {
      if (this.focusedLaneId === lane.id && this.viewMode === 'lane') {
        this.resetView();
        return;
      }
      this.focusedLaneId = lane.id;
      this.viewMode = 'lane';
      this.animateView();
      this.fitViewport();
    },
    resetView() {
      this.focusedLaneId = null;
      this.viewMode = 'fit';
      this.animateView();
      this.fitViewport();
    },
    zoomBy(factor) {
      const viewport = this.$refs.viewport;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      this.animateView();
      this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, this.scale * factor);
    },
    onNodeHover(node) {
      if (!this.isDragging) {
        this.hoveredNodeId = node.id;
      }
    },
    onNodeLeave(node) {
      if (this.hoveredNodeId === node.id) {
        this.hoveredNodeId = null;
      }
    },
    setupViewportHandlers() {
      const viewport = this.$refs.viewport;
      if (!viewport || this._interactionViewport === viewport) {
        return;
      }
      this.teardownViewportHandlers();
      this._interactionViewport = viewport;

      this._onWheel = (e) => this.handleWheel(e);
      this._onMouseDown = (e) => this.handleMouseDown(e);
      this._onMouseMove = (e) => this.handleMouseMove(e);
      this._onMouseUp = (e) => this.handleMouseUp(e);
      this._onTouchStart = (e) => this.handleTouchStart(e);
      this._onTouchMove = (e) => this.handleTouchMove(e);
      this._onTouchEnd = (e) => this.handleTouchEnd(e);
      viewport.addEventListener('wheel', this._onWheel, { passive: false });
      viewport.addEventListener('mousedown', this._onMouseDown);
      viewport.addEventListener('touchstart', this._onTouchStart, { passive: true });
      viewport.addEventListener('touchmove', this._onTouchMove, { passive: false });
      viewport.addEventListener('touchend', this._onTouchEnd, { passive: true });
      viewport.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
    },
    teardownViewportHandlers() {
      const viewport = this._interactionViewport;
      if (!viewport) {
        return;
      }
      viewport.removeEventListener('wheel', this._onWheel);
      viewport.removeEventListener('mousedown', this._onMouseDown);
      viewport.removeEventListener('touchstart', this._onTouchStart);
      viewport.removeEventListener('touchmove', this._onTouchMove);
      viewport.removeEventListener('touchend', this._onTouchEnd);
      viewport.removeEventListener('touchcancel', this._onTouchEnd);
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mouseup', this._onMouseUp);
      this._interactionViewport = null;
      this.gesture = null;
      this.isDragging = false;
    },
    zoomAt(clientX, clientY, nextScale) {
      const viewport = this.$refs.viewport;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const focalX = (clientX - rect.left - this.panX) / this.scale;
      const focalY = (clientY - rect.top - this.panY) / this.scale;
      const clamped = clampScale(nextScale);
      this.scale = clamped;
      this.panX = clientX - rect.left - focalX * clamped;
      this.panY = clientY - rect.top - focalY * clamped;
      this.markUserGestured();
    },
    handleWheel(e) {
      if (!this.$refs.viewport?.contains(e.target)) {
        return;
      }
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      this.zoomAt(e.clientX, e.clientY, this.scale * factor);
    },
    handleMouseDown(e) {
      if (e.button !== 0 || this.shouldIgnorePanStart(e.target)) {
        return;
      }
      e.preventDefault();
      this.isDragging = true;
      this.gesture = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: this.panX,
        startPanY: this.panY
      };
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
    },
    handleMouseMove(e) {
      if (!this.gesture || this.gesture.mode !== 'pan' || !this.isDragging) {
        return;
      }
      this.panX = this.gesture.startPanX + (e.clientX - this.gesture.startX);
      this.panY = this.gesture.startPanY + (e.clientY - this.gesture.startY);
      this.markUserGestured();
    },
    handleMouseUp() {
      if (!this.isDragging) {
        return;
      }
      this.isDragging = false;
      this.gesture = null;
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mouseup', this._onMouseUp);
    },
    handleTouchStart(e) {
      const touches = e.touches;
      const rect = this.$refs.viewport.getBoundingClientRect();
      if (touches.length === 1) {
        if (this.shouldIgnorePanStart(e.target)) {
          return;
        }
        this.gesture = {
          mode: 'pan',
          startX: touches[0].clientX,
          startY: touches[0].clientY,
          startPanX: this.panX,
          startPanY: this.panY
        };
        return;
      }
      if (touches.length >= 2) {
        const center = touchCenter(touches);
        const focalX = (center.x - rect.left - this.panX) / this.scale;
        const focalY = (center.y - rect.top - this.panY) / this.scale;
        this.gesture = {
          mode: 'pinch',
          startDistance: touchDistance(touches),
          startScale: this.scale,
          focalX,
          focalY,
          rectLeft: rect.left,
          rectTop: rect.top
        };
      }
    },
    handleTouchMove(e) {
      if (!this.gesture) {
        return;
      }
      const touches = e.touches;
      if (this.gesture.mode === 'pan' && touches.length === 1) {
        e.preventDefault();
        this.panX = this.gesture.startPanX + (touches[0].clientX - this.gesture.startX);
        this.panY = this.gesture.startPanY + (touches[0].clientY - this.gesture.startY);
        this.markUserGestured();
        return;
      }
      if (touches.length >= 2) {
        e.preventDefault();
        const center = touchCenter(touches);
        const distance = touchDistance(touches);
        if (this.gesture.mode === 'pan') {
          const rect = this.$refs.viewport.getBoundingClientRect();
          const focalX = (center.x - rect.left - this.panX) / this.scale;
          const focalY = (center.y - rect.top - this.panY) / this.scale;
          this.gesture = {
            mode: 'pinch',
            startDistance: distance,
            startScale: this.scale,
            focalX,
            focalY,
            rectLeft: rect.left,
            rectTop: rect.top
          };
        }
        const ratio = distance / this.gesture.startDistance;
        const nextScale = clampScale(this.gesture.startScale * ratio);
        this.scale = nextScale;
        this.panX = center.x - this.gesture.rectLeft - this.gesture.focalX * nextScale;
        this.panY = center.y - this.gesture.rectTop - this.gesture.focalY * nextScale;
        this.markUserGestured();
      }
    },
    handleTouchEnd(e) {
      if (!this.gesture) {
        return;
      }
      if (e.touches.length === 0) {
        this.gesture = null;
        return;
      }
      if (e.touches.length === 1 && this.gesture.mode === 'pinch') {
        this.gesture = {
          mode: 'pan',
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startPanX: this.panX,
          startPanY: this.panY
        };
      }
    },
    scheduleViewportFit() {
      if (this._fitRaf) {
        cancelAnimationFrame(this._fitRaf);
      }
      this._fitRaf = requestAnimationFrame(() => {
        this._fitRaf = null;
        this.fitViewport();
      });
    },
    fitViewport() {
      if (this.viewMode === 'manual') {
        return;
      }
      const viewport = this.$refs.viewport;
      if (!viewport || !this.layout.nodes.length) {
        return;
      }
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      if (vw < 1 || vh < 1) {
        return;
      }
      if (this.viewMode === 'lane') {
        const lane = this.stages.find((candidate) => candidate.id === this.focusedLaneId);
        if (lane) {
          this.fitLane(lane, vw, vh);
          return;
        }
        this.viewMode = 'fit';
        this.focusedLaneId = null;
      }
      const content = contentRect(this.layout.nodes, this.layout.edges);
      if (!content) {
        return;
      }
      // Lanes span the full canvas width; their tinted bands frame the flow.
      const rect = {
        x: 0,
        y: content.y - 8,
        width: this.layout.width,
        height: content.height + 16
      };
      const { availW, availH } = this.availableArea(vw, vh);
      const scale = Math.max(
        FIT_MIN_SCALE,
        Math.min(availW / rect.width, availH / rect.height, 1)
      );
      this.applyView(rect, scale, vw, vh);
    },
    fitLane(lane, vw, vh) {
      const inLane = this.layout.nodes.filter(
        (node) => node.x >= lane.x && node.x < lane.x + lane.width
      );
      const content = contentRect(inLane);
      if (!content) {
        return;
      }
      const rect = {
        x: lane.x,
        y: content.y - 8,
        width: lane.width,
        height: content.height + 16
      };
      const { availW, availH } = this.availableArea(vw, vh);
      const fitScale = Math.min(availW / rect.width, availH / rect.height);
      // Large stages would shrink below legible text: keep a readable zoom,
      // anchor at the stage's start and let the user drag through the rest.
      const scale = Math.min(LANE_MAX_SCALE, Math.max(READABLE_SCALE, fitScale));
      this.applyView(rect, clampScale(scale), vw, vh);
    },
    availableArea(vw, vh) {
      return {
        availW: Math.max(1, vw - FIT_PAD * 2),
        availH: Math.max(1, vh - FIT_PAD * 2 - HEADER_INSET - FOOTER_INSET)
      };
    },
    /**
     * Place `rect` (canvas coordinates) in the viewport at `scale`: centred when
     * it fits, otherwise anchored to its start so the flow reads from the left
     * and the top.
     */
    applyView(rect, scale, vw, vh) {
      const { availW, availH } = this.availableArea(vw, vh);
      const width = rect.width * scale;
      const height = rect.height * scale;
      const left = FIT_PAD;
      const top = FIT_PAD + HEADER_INSET;
      this.scale = scale;
      this.panX = (width <= availW ? left + (availW - width) / 2 : left) - rect.x * scale;
      this.panY = (height <= availH ? top + (availH - height) / 2 : top) - rect.y * scale;
    },
    horizontalBezierPath(from, to) {
      const dx = Math.max(56, Math.abs(to.x - from.x) * 0.5);
      const c1x = from.x + dx;
      const c2x = to.x - dx;
      return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
    },
    loopbackBezierPath(from, to) {
      const dropY = Math.max(from.y, to.y) + 72;
      const bend = Math.max(48, Math.abs(from.x - to.x) * 0.18);
      const c1x = from.x + bend;
      const c2x = to.x - bend;
      return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c1x} ${dropY}, ${(from.x + to.x) / 2} ${dropY} C ${c2x} ${dropY}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
    },
    nodeClickAction(node) {
      return pipelineNodeClickAction(node);
    },
    isNodeClickable(node) {
      return this.nodeClickAction(node) !== null;
    },
    nodeHintIcon(node) {
      return pipelineNodeHintIcon(this.nodeClickAction(node));
    },
    nodeClickHint(node) {
      const action = this.nodeClickAction(node);
      if (action === 'open-architecture') {
        return this.language === 'en'
          ? 'Open ONNX architecture'
          : '打开模型架构';
      }
      if (action === 'open-scope') {
        return this.language === 'en'
          ? 'Open oscilloscope'
          : '打开示波器';
      }
      if (action === 'open-stack') {
        return this.language === 'en'
          ? 'Show how the observation tensor is stacked'
          : '查看观测张量的堆叠方式';
      }
      if (action === 'probe-node') {
        return this.language === 'en'
          ? 'Plot all signals of this node in the oscilloscope'
          : '在示波器中查看该节点的全部信号曲线';
      }
      return undefined;
    },
    isNodeProbed(node) {
      // Joint nodes only render a dimension summary, so match on the node id:
      // their channels are keyed by joint name, not by a rendered line.
      return Boolean(node?.id) && this.probedNodeIds.has(node.id);
    },
    isLineProbed(nodeId, lineKey) {
      return this.activeProbeIds.has(`${nodeId}:${lineKey}`);
    },
    onNodeClick(node) {
      const action = this.nodeClickAction(node);
      // Clicking usually switches tabs; a highlight left behind would greet
      // the user when they come back to the graph.
      this.hoveredNodeId = null;
      if (action === 'open-scope') {
        this.$emit('open-scope');
        return;
      }
      if (action === 'open-architecture') {
        this.$emit('open-architecture');
        return;
      }
      if (action === 'open-stack') {
        this.$emit('open-stack');
        return;
      }
      if (action === 'probe-node') {
        this.$emit('probe-node', node);
      }
    }
  }
};
</script>

<style scoped>
.pipeline-shell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 0;
}

.pipeline-shell-mobile .pipeline-caption {
  min-height: 0;
}

.pipeline-shell-mobile .pipeline-legend {
  font-size: 0.6rem;
  gap: 2px 8px;
  max-width: calc(100% - 112px);
  padding: 3px 8px;
}

.pipeline-stages {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 1px 2px;
}

.pipeline-stages::-webkit-scrollbar {
  display: none;
}

.pipeline-stage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 3px 10px 3px 4px;
  border-radius: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.74rem;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--transition), border-color var(--transition), color var(--transition);
}

.pipeline-stage:hover,
.pipeline-stage:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.6);
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.pipeline-stage-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-on-surface));
}

.pipeline-stage-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  background: rgba(var(--v-theme-primary), 0.22);
  color: rgb(var(--v-theme-primary));
}

.pipeline-stage-active .pipeline-stage-step {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.pipeline-stage-arrow {
  flex-shrink: 0;
  opacity: 0.4;
}

.pipeline-caption {
  margin: 0;
  padding: 0 4px;
  flex-shrink: 0;
  min-height: 2.6em;
  color: rgba(var(--v-theme-on-surface), 0.66);
  line-height: 1.3;
}

.pipeline-caption-title {
  margin-right: 4px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.pipeline-viewport {
  position: relative;
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid var(--viz-line);
  background: var(--viz-bg);
  overscroll-behavior: contain;
}

.pipeline-lane {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.018);
  border-left: 1px dashed rgba(255, 255, 255, 0.06);
}

.pipeline-lane:first-of-type {
  border-left: none;
}

.pipeline-lane-alt {
  background: rgba(255, 255, 255, 0.04);
}

.pipeline-lane-focused {
  background: rgba(var(--v-theme-primary), 0.07);
}

.pipeline-lane-headers {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  height: 26px;
  pointer-events: none;
  overflow: hidden;
  z-index: 4;
}

.pipeline-lane-header {
  position: absolute;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  box-sizing: border-box;
  white-space: nowrap;
  /* A narrow lane still shows its whole step badge, centred over the lane. */
  overflow: visible;
}

.pipeline-lane-header-text {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px 2px 3px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--viz-ink-muted);
  background: rgba(24, 24, 24, 0.85);
  border: 1px solid var(--viz-line);
  border-radius: 6px;
  overflow: hidden;
}

.pipeline-lane-header-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 0.64rem;
  background: rgba(var(--v-theme-primary), 0.3);
  color: var(--viz-ink);
}

.pipeline-lane-header-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pipeline-lane-header-active .pipeline-lane-header-text {
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.pipeline-lane-header-active .pipeline-lane-header-step {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.pipeline-viewport-zoom {
  flex: 1 1 auto;
  min-height: 220px;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.pipeline-viewport-dragging {
  cursor: grabbing;
}

.pipeline-transform {
  position: relative;
  will-change: transform;
}

.pipeline-viewport-animate .pipeline-transform {
  transition: transform 0.26s var(--ease);
}

.pipeline-viewport-animate .pipeline-lane-header {
  transition: left 0.26s var(--ease), width 0.26s var(--ease);
}

.pipeline-canvas {
  position: relative;
  flex-shrink: 0;
  margin: 0 auto;
}

.pipeline-grid {
  position: absolute;
  inset: 0;
  background-color: var(--viz-bg);
  background-image:
    radial-gradient(circle at 1px 1px, var(--viz-grid) 1px, transparent 0);
  background-size: 18px 18px;
  pointer-events: none;
}

.pipeline-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.pipeline-edge {
  fill: none;
  stroke: rgba(155, 155, 155, 0.4);
  stroke-width: 1.5;
  transition: stroke var(--transition);
}

.pipeline-edge-active {
  stroke: rgba(var(--v-theme-primary), 0.85);
  stroke-width: 2;
  filter: drop-shadow(0 0 4px rgba(var(--v-theme-primary), 0.35));
}

.pipeline-edge-scope {
  stroke: rgba(var(--v-theme-primary), 0.75);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

.pipeline-edge-loopback {
  stroke: rgba(155, 155, 155, 0.72);
  stroke-width: 1.5;
  stroke-dasharray: 8 5;
}

.pipeline-edge-arrow {
  fill: rgba(var(--v-theme-primary), 0.9);
}

.pipeline-edge-related {
  stroke-width: 2.6;
  opacity: 1;
}

.pipeline-edge-dimmed {
  opacity: 0.12;
}

.pipeline-node-dimmed {
  opacity: 0.38;
}

.pipeline-node-hovered .pipeline-node-card {
  border-color: rgba(var(--v-theme-primary), 0.85);
}

.pipeline-node,
.pipeline-edge {
  transition: opacity var(--transition);
}

.pipeline-node-scope .pipeline-node-card {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: var(--viz-panel);
}

.pipeline-node {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
}

.pipeline-node-body {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.pipeline-node-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 0 6px;
}

.pipeline-node-head {
  position: relative;
  flex-shrink: 0;
  padding: 5px 20px 2px 8px;
  border-radius: 6px 6px 0 0;
}

.pipeline-node-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--viz-line);
  background: var(--viz-panel);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  cursor: default;
  user-select: text;
  position: relative;
}

.pipeline-node-clickable {
  cursor: pointer;
}

.pipeline-node-card-clickable {
  cursor: pointer;
}

.pipeline-node-card-clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: var(--viz-raised);
}

.pipeline-node-probed .pipeline-node-card {
  border-color: rgba(var(--v-theme-primary), 0.8);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.3), 0 4px 14px rgba(0, 0, 0, 0.4);
}

.pipeline-node-scope-hint {
  position: absolute;
  top: 7px;
  right: 4px;
  /* The canvas is dark in both themes, so do not inherit the theme colour. */
  color: var(--viz-ink-muted);
  opacity: 0.8;
  pointer-events: none;
}

.pipeline-node-clickable:hover .pipeline-node-scope-hint {
  opacity: 0.95;
  color: rgb(var(--v-theme-primary));
}

.pipeline-node-live .pipeline-node-card {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.12), 0 4px 14px rgba(0, 0, 0, 0.4);
}

.pipeline-node-warehouse .pipeline-node-card,
.pipeline-node-model .pipeline-node-card {
  border-color: rgba(var(--v-theme-primary), 0.35);
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-title {
  font-size: 0.8rem;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-subtitle {
  font-size: 0.68rem;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-line {
  font-size: 0.68rem;
  margin-top: 4px;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-chip {
  font-size: 0.66rem;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-card {
  padding: 8px 10px;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-node-inner {
  margin: 0 8px;
}

.pipeline-shell:not(.pipeline-shell-mobile) .pipeline-port {
  width: 10px;
  height: 10px;
}

.pipeline-node-title {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--viz-ink);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pipeline-node-subtitle {
  font-size: 0.62rem;
  color: var(--viz-ink-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pipeline-node-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.pipeline-node-chip {
  padding: 0 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  line-height: 15px;
  color: var(--viz-ink-muted);
  background: rgba(155, 155, 155, 0.12);
}

.pipeline-node-chip-probed {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.16);
}

.pipeline-overlay {
  position: absolute;
  z-index: 5;
  cursor: default;
}

.pipeline-legend {
  left: 8px;
  bottom: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  max-width: calc(100% - 120px);
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 0.66rem;
  color: var(--viz-ink-muted);
  background: rgba(24, 24, 24, 0.85);
  border: 1px solid var(--viz-line);
  pointer-events: none;
}

.pipeline-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.pipeline-legend-line {
  stroke-width: 2;
}

.pipeline-legend-flow {
  stroke: rgba(var(--v-theme-primary), 0.9);
}

.pipeline-legend-loopback {
  stroke: rgba(155, 155, 155, 0.8);
  stroke-dasharray: 5 3;
}

.pipeline-legend-scope {
  stroke: rgba(var(--v-theme-primary), 0.75);
  stroke-dasharray: 4 3;
}

.pipeline-view-controls {
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
}

.pipeline-view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--viz-ink);
  background: rgba(24, 24, 24, 0.85);
  border: 1px solid var(--viz-line);
  cursor: pointer;
  transition: border-color var(--transition);
}

.pipeline-view-btn:hover,
.pipeline-view-btn:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.7);
  outline: none;
}

.pipeline-node-line {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  line-height: 1.3;
}

.pipeline-node-line-probed .pipeline-node-key {
  color: rgb(var(--v-theme-primary));
}

.pipeline-shell-mobile .pipeline-node-title {
  font-size: 0.78rem;
}

.pipeline-shell-mobile .pipeline-node-line {
  font-size: 0.65rem;
}

.pipeline-node-key {
  color: var(--viz-ink-faint);
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
}

.pipeline-node-val {
  color: var(--viz-ink-muted);
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
}

.pipeline-node-meta {
  color: var(--viz-ink-muted);
}

.pipeline-port {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
  background: var(--viz-raised);
  border: 2px solid var(--viz-ink-faint);
}

.pipeline-node-live .pipeline-port {
  border-color: rgba(var(--v-theme-primary), 0.9);
  background: rgba(var(--v-theme-primary), 0.25);
  box-shadow: 0 0 6px rgba(var(--v-theme-primary), 0.5);
}

</style>
