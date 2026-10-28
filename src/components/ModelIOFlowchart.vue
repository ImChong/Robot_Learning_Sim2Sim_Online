<template>
  <div
    :class="[
      'model-io-dock',
      {
        'model-io-dock-mobile': isSmallScreen,
        'model-io-dock-sheet-open': isSmallScreen && expanded
      }
    ]"
  >
    <v-btn
      v-show="!isSmallScreen || !expanded"
      class="model-io-toggle"
      :class="{ 'model-io-toggle-mobile': isSmallScreen }"
      size="small"
      :color="expanded ? 'primary' : 'surface-variant'"
      :variant="expanded ? 'flat' : 'elevated'"
      :aria-label="expanded ? t.collapsePanel : t.expandPanel"
      :aria-expanded="expanded"
      @click="togglePanel"
    >
      <v-icon :icon="expanded ? 'mdi-graph-outline' : 'mdi-graph'" />
      <span v-if="!isSmallScreen" class="ml-1">{{ expanded ? t.collapsePanel : t.expandPanel }}</span>
      <span v-else class="ml-1">{{ t.expandShort }}</span>
    </v-btn>

    <div
      v-if="isSmallScreen && expanded"
      class="model-io-backdrop"
      aria-hidden="true"
      @click="closePanel"
    />

    <v-card
      v-show="expanded"
      ref="panelCard"
      :class="[
        'model-io-panel',
        {
          'model-io-panel-sheet': isSmallScreen,
          'model-io-panel-desktop': !isSmallScreen
        }
      ]"
      :style="desktopPanelStyle"
      elevation="8"
      role="region"
      :aria-label="t.panelTitle"
    >
      <v-card-title class="model-io-title">
        <span>{{ t.panelTitle }}</span>
        <v-chip v-if="telemetry.ready" size="x-small" color="primary" variant="tonal">
          {{ t.live }}
        </v-chip>
        <v-chip v-else size="x-small" color="on-surface" variant="outlined">
          {{ t.waiting }}
        </v-chip>
        <v-spacer />
        <v-btn-toggle
          v-if="telemetry.ready"
          v-model="viewTab"
          density="compact"
          mandatory
          color="primary"
          class="model-io-tabs"
          :class="{ 'model-io-tabs-mobile': isSmallScreen }"
        >
          <v-btn
            v-for="tab in tabs"
            :key="tab.value"
            :value="tab.value"
            size="x-small"
            variant="text"
            :aria-label="tab.label"
          >
            <v-icon :icon="tab.icon" size="small" start />
            {{ isSmallScreen ? tab.shortLabel : tab.label }}
          </v-btn>
        </v-btn-toggle>
        <v-btn
          v-if="isSmallScreen"
          class="model-io-close"
          icon="mdi-close"
          size="x-small"
          variant="text"
          :aria-label="t.collapsePanel"
          @click="closePanel"
        />
      </v-card-title>

      <v-card-text class="model-io-body">
        <p v-if="!telemetry.ready" class="text-caption text-medium-emphasis">
          {{ t.notReady }}
        </p>

        <template v-else>
          <ModelIOPipelineGraph
            v-show="viewTab === 'graph'"
            :telemetry="telemetry"
            :language="language"
            :live="telemetry.ready"
            :is-mobile="isSmallScreen"
            :active-probes="activeProbes"
            @probe-node="onProbeNode"
            @open-scope="openScopeTab"
            @open-architecture="openArchitectureTab"
            @open-stack="openStackTab"
          />
          <p v-if="!isSmallScreen && viewTab === 'stack'" class="text-caption text-medium-emphasis pipeline-hint">
            {{ t.stackHint }}
          </p>
          <ObsStackChart
            v-if="viewTab === 'stack'"
            :layout="stackLayout"
            :labels="stackLabels"
            :active-node-ids="probedNodeIds"
            @select-block="onStackBlock"
            @select-module="onStackModule"
          />
          <OnnxNetronViewer
            v-if="viewTab === 'architecture'"
            :model-path="telemetry.model.path"
            :language="language"
          />
          <SignalOscilloscope
            v-show="viewTab === 'scope'"
            :snapshot="scopeSnapshot"
            :active-probe-ids="activeProbeIds"
            :paused="signalScope.paused"
            :channels-label="t.scopeChannels"
            :samples-label="t.scopeSamples"
            :window-label="t.scopeWindow"
            :window-seconds="scopeWindowSeconds"
            :window-min-seconds="scopeWindowMinSeconds"
            :window-max-seconds="scopeWindowMaxSeconds"
            :window-input-aria-label="t.scopeWindowInput"
            :clear-label="t.scopeClear"
            :pause-label="t.scopePause"
            :resume-label="t.scopeResume"
            :empty-label="t.scopeEmpty"
            :hint="t.scopeHint"
            :source="scopeSourceName"
            :source-label="t.scopeSource"
            :hidden-label="t.scopeHidden"
            :hide-series-label="t.scopeHideSeries"
            :show-series-label="t.scopeShowSeries"
            :remove-series-label="t.scopeRemoveSeries"
            @toggle-pause="toggleScopePause"
            @clear="clearScope"
            @remove-probe="onRemoveProbe"
            @toggle-series="onToggleSeries"
            @update-window-seconds="onScopeWindowChange"
          />
        </template>
      </v-card-text>

      <template v-if="!isSmallScreen">
        <div
          class="model-io-resize-handle model-io-resize-e"
          role="separator"
          :aria-label="t.resizeWidth"
          @mousedown.prevent="startPanelResize('e', $event)"
        />
        <div
          class="model-io-resize-handle model-io-resize-n"
          role="separator"
          :aria-label="t.resizeHeight"
          @mousedown.prevent="startPanelResize('n', $event)"
        />
        <div
          class="model-io-resize-handle model-io-resize-ne"
          role="separator"
          :aria-label="t.resizeBoth"
          @mousedown.prevent="startPanelResize('ne', $event)"
        />
      </template>
    </v-card>
  </div>
</template>

<script>
import { buildPolicyTelemetry } from '@/simulation/policyTelemetry.js';
import ModelIOPipelineGraph from '@/components/ModelIOPipelineGraph.vue';
import ObsStackChart from '@/components/ObsStackChart.vue';
import OnnxNetronViewer from '@/components/OnnxNetronViewer.vue';
import SignalOscilloscope from '@/components/SignalOscilloscope.vue';
import { buildObsStackLayout } from '@/simulation/obsStackLayout.js';
import {
  clearScopeBuffer,
  createSignalScope,
  getScopeSnapshot,
  listNodeProbes,
  pushScopeSample,
  removeScopeProbe,
  setScopeProbes,
  setScopeWindowSeconds,
  syncScopeProbes,
  toggleScopeChannelHidden
} from '@/simulation/signalScope.js';
import {
  clampPanelSize,
  loadPanelSize,
  savePanelSize
} from '@/utils/modelIoPanelSize.js';
import {
  loadScopeWindowSeconds,
  MAX_SCOPE_WINDOW_SECONDS,
  MIN_SCOPE_WINDOW_SECONDS,
  saveScopeWindowSeconds
} from '@/utils/scopeWindowPreference.js';
import { MAX_SCOPE_CHANNELS } from '@/simulation/scopeChannels.js';

// A block can decompose into many nodes; the toolbar names the first few and
// counts the rest so the stats row stays on one line.
const MAX_SOURCE_NODE_NAMES = 3;
// The graph and stacking views only show structure and a few slow counters,
// so they are rebuilt far less often than the scope samples.
const TELEMETRY_REFRESH_MS = 500;

const translations = {
  en: {
    panelTitle: 'Model I/O Pipeline',
    expandPanel: 'Model pipeline',
    collapsePanel: 'Hide pipeline',
    expandShort: 'Pipeline',
    live: 'Live',
    waiting: 'Waiting',
    notReady: 'Simulation is loading. The pipeline graph will update once the policy is running.',
    resizeWidth: 'Resize panel width (right edge)',
    resizeHeight: 'Resize panel height (top edge)',
    resizeBoth: 'Resize panel (top-right corner)',
    tabGraph: 'Graph',
    tabStack: 'Stacking',
    tabStackShort: 'Stack',
    tabArchitecture: 'Architecture',
    tabArchitectureShort: 'Arch',
    tabScope: 'Scope',
    stackHint: 'Click an observation block or one of its modules (row, sub-row or frame segment) to plot its live signals in the oscilloscope.',
    stackPlot: 'Click to plot in the oscilloscope',
    stackEmpty: 'The observation layout appears once the policy is running.',
    stackFrame: 'frame',
    stackHistory: 'history',
    stackTensor: 'tensor',
    stackInput: 'ONNX input',
    stackFrameTitle: 'Frame composition (concat order)',
    stackTitle: 'Tensor stacking',
    stackLatestLast: 'oldest first · newest frame last',
    stackSingleFrame: 'single frame · no history window',
    stackColBlock: 'Block',
    stackColSize: 'Size',
    stackColRange: 'Range',
    stackColModule: 'Modules',
    scopeChannels: 'Channels',
    scopeSamples: 'Samples',
    scopeWindow: 'Window',
    scopeSource: 'Source',
    scopeHidden: 'hidden',
    scopeHideSeries: 'Click to hide this curve',
    scopeShowSeries: 'Click to show this curve',
    scopeRemoveSeries: 'Remove this channel',
    scopeWindowInput: 'Oscilloscope window (seconds)',
    scopeClear: 'Clear',
    scopePause: 'Pause',
    scopeResume: 'Resume',
    scopeEmpty: 'Waiting for samples…',
    scopeHint: `Switch to Graph and click a node to plot all of its signals (up to ${MAX_SCOPE_CHANNELS} channels).`,
    scopeMaxChannels: `Maximum ${MAX_SCOPE_CHANNELS} scope channels`
  },
  zh: {
    panelTitle: '模型 I/O 流程',
    expandPanel: '模型流程',
    collapsePanel: '收起流程',
    expandShort: '流程',
    live: '实时',
    waiting: '等待',
    notReady: '仿真仍在加载，策略就绪后将显示实时连接图。',
    resizeWidth: '拖拽右边框调整宽度',
    resizeHeight: '拖拽上边框调整高度',
    resizeBoth: '拖拽右上角同时调整',
    tabGraph: '流程图',
    tabStack: '数据堆叠',
    tabStackShort: '堆叠',
    tabArchitecture: '模型架构',
    tabArchitectureShort: '架构',
    tabScope: '示波器',
    stackHint: '点击观测块或其中的模块（表格行 / 子行 / 帧色块）即可在示波器中查看对应的实时曲线。',
    stackPlot: '点击在示波器中查看曲线',
    stackEmpty: '策略就绪后显示观测张量的堆叠结构。',
    stackFrame: '单帧',
    stackHistory: '历史',
    stackTensor: '张量',
    stackInput: 'ONNX 输入',
    stackFrameTitle: '单帧观测构成（按拼接顺序）',
    stackTitle: '张量堆叠',
    stackLatestLast: '最旧在前 · 最新一帧在末尾',
    stackSingleFrame: '单帧输入 · 无历史窗口',
    stackColBlock: '观测块',
    stackColSize: '维度',
    stackColRange: '区间',
    stackColModule: '模块',
    scopeChannels: '通道',
    scopeSamples: '采样',
    scopeWindow: '窗口',
    scopeSource: '来源',
    scopeHidden: '已隐藏',
    scopeHideSeries: '点击隐藏该曲线',
    scopeShowSeries: '点击显示该曲线',
    scopeRemoveSeries: '移除该通道',
    scopeWindowInput: '示波器显示时长（秒）',
    scopeClear: '清空',
    scopePause: '暂停',
    scopeResume: '继续',
    scopeEmpty: '等待采样数据…',
    scopeHint: `切到「流程图」后点击节点即可绘制该节点的全部信号曲线（最多 ${MAX_SCOPE_CHANNELS} 路）。`,
    scopeMaxChannels: `示波器最多 ${MAX_SCOPE_CHANNELS} 路通道`
  }
};

export default {
  name: 'ModelIOFlowchart',
  components: {
    ModelIOPipelineGraph,
    ObsStackChart,
    OnnxNetronViewer,
    SignalOscilloscope
  },
  props: {
    demo: {
      type: Object,
      default: null
    },
    ready: {
      type: Boolean,
      default: false
    },
    language: {
      type: String,
      default: 'zh'
    },
    isSmallScreen: {
      type: Boolean,
      default: false
    },
    mobileControlsCollapsed: {
      type: Boolean,
      default: true
    }
  },
  data: () => {
    const panelSize = loadPanelSize();
    const scopeWindowSeconds = loadScopeWindowSeconds();
    const signalScope = createSignalScope({ windowSeconds: scopeWindowSeconds });
    return {
      expanded: false,
      viewTab: 'graph',
      telemetry: { ready: false },
      signalScope,
      scopeSnapshot: getScopeSnapshot(signalScope),
      scopeWindowSeconds,
      panelWidth: panelSize.width,
      panelHeight: panelSize.height,
      panelResize: null
    };
  },
  computed: {
    activeProbes() {
      return this.signalScope.channels.map((ch) => ({
        id: ch.id,
        nodeId: ch.nodeId,
        lineKey: ch.lineKey,
        label: ch.label
      }));
    },
    activeProbeIds() {
      return this.activeProbes.map((probe) => probe.id);
    },
    probedNodeIds() {
      return [...new Set(this.activeProbes.map((probe) => probe.nodeId))];
    },
    desktopPanelStyle() {
      if (this.isSmallScreen) {
        return null;
      }
      return {
        width: `${this.panelWidth}px`,
        height: `${this.panelHeight}px`,
        maxHeight: 'none'
      };
    },
    t() {
      return translations[this.language === 'en' ? 'en' : 'zh'];
    },
    tabs() {
      const t = this.t;
      return [
        { value: 'graph', icon: 'mdi-graph-outline', label: t.tabGraph, shortLabel: t.tabGraph },
        { value: 'stack', icon: 'mdi-layers-outline', label: t.tabStack, shortLabel: t.tabStackShort },
        {
          value: 'architecture',
          icon: 'mdi-sitemap-outline',
          label: t.tabArchitecture,
          shortLabel: t.tabArchitectureShort
        },
        { value: 'scope', icon: 'mdi-chart-line-variant', label: t.tabScope, shortLabel: t.tabScope }
      ];
    },
    stackLayout() {
      return buildObsStackLayout(this.telemetry);
    },
    stackLabels() {
      const t = this.t;
      return {
        empty: t.stackEmpty,
        frame: t.stackFrame,
        history: t.stackHistory,
        tensor: t.stackTensor,
        input: t.stackInput,
        frameTitle: t.stackFrameTitle,
        stackTitle: t.stackTitle,
        latestLast: t.stackLatestLast,
        singleFrame: t.stackSingleFrame,
        colBlock: t.stackColBlock,
        colSize: t.stackColSize,
        colRange: t.stackColRange,
        colModule: t.stackColModule,
        plot: t.stackPlot,
        channels: t.scopeChannels
      };
    },
    /**
     * What the scope is currently plotting: the graph node titles, prefixed
     * with the observation block when every channel comes from one block.
     */
    scopeSourceName() {
      const nodeIds = this.probedNodeIds;
      if (nodeIds.length === 0) {
        return '';
      }
      const byId = new Map(
        (this.telemetry.atomicNodes ?? []).map((node) => [node.id, node])
      );
      const titles = nodeIds.map((id) => byId.get(id)?.title ?? id);
      // Not " / ": that already separates the stats in the toolbar row.
      const shown = titles.slice(0, MAX_SOURCE_NODE_NAMES).join(', ');
      const rest = titles.length - MAX_SOURCE_NODE_NAMES;
      const nodeNames = rest > 0 ? `${shown} +${rest}` : shown;
      const block = this.stackLayout.blocks.find(
        (candidate) => nodeIds.every((id) => candidate.nodeIds.includes(id))
      );
      return block ? `${block.name} · ${nodeNames}` : nodeNames;
    },
    scopeWindowMinSeconds() {
      return MIN_SCOPE_WINDOW_SECONDS;
    },
    scopeWindowMaxSeconds() {
      return MAX_SCOPE_WINDOW_SECONDS;
    },
    pollIntervalMs() {
      return this.isSmallScreen ? 100 : 50;
    },
    mobileToggleBottom() {
      const safe = 'env(safe-area-inset-bottom, 0px)';
      const vvp = 'var(--vvp-offset-bottom, 0px)';
      const panelHeight = 'var(--mobile-controls-panel-height, 52px)';
      const gap = 'var(--mobile-flow-controls-gap, 10px)';
      return `calc(12px + ${safe} + ${vvp} + ${panelHeight} + ${gap})`;
    }
  },
  watch: {
    ready(isReady) {
      if (!isReady) {
        this.telemetry = { ready: false };
        clearScopeBuffer(this.signalScope);
        this.scopeSnapshot = getScopeSnapshot(this.signalScope);
        return;
      }
      this.refreshTelemetry();
    },
    language() {
      this.refreshTelemetry();
    },
    viewTab(tab) {
      if (tab === 'graph' || tab === 'stack') {
        this.refreshTelemetry();
      }
    },
    isSmallScreen(isSmall) {
      // Leaving the mobile layout with the sheet open must also release the
      // body scroll lock, or the desktop page stays frozen.
      document.body.classList.toggle('model-io-sheet-open', isSmall && this.expanded);
    },
    expanded(isOpen) {
      if (this.isSmallScreen) {
        document.body.classList.toggle('model-io-sheet-open', isOpen);
      }
    },
    mobileControlsCollapsed(collapsed, wasCollapsed) {
      if (this.isSmallScreen && this.expanded && !collapsed && wasCollapsed) {
        this.closePanel();
      }
    },
    pollIntervalMs() {
      this.startPoll();
    }
  },
  mounted() {
    this.startPoll();
    this._onPanelResizeMove = (e) => this.onPanelResizeMove(e);
    this._onPanelResizeEnd = () => this.endPanelResize();
    window.addEventListener('resize', this.onWindowResize);
  },
  beforeUnmount() {
    this.stopPoll();
    this.endPanelResize();
    window.removeEventListener('resize', this.onWindowResize);
    document.body.classList.remove('model-io-sheet-open');
    document.body.classList.remove('model-io-panel-resizing');
  },
  methods: {
    onWindowResize() {
      if (this.isSmallScreen) {
        return;
      }
      const next = clampPanelSize(this.panelWidth, this.panelHeight);
      this.panelWidth = next.width;
      this.panelHeight = next.height;
    },
    startPanelResize(edge, event) {
      if (this.isSmallScreen) {
        return;
      }
      this.panelResize = {
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startW: this.panelWidth,
        startH: this.panelHeight
      };
      document.addEventListener('mousemove', this._onPanelResizeMove);
      document.addEventListener('mouseup', this._onPanelResizeEnd);
      document.body.classList.add('model-io-panel-resizing');
    },
    onPanelResizeMove(event) {
      if (!this.panelResize) {
        return;
      }
      const dx = event.clientX - this.panelResize.startX;
      const dy = event.clientY - this.panelResize.startY;
      let w = this.panelResize.startW;
      let h = this.panelResize.startH;
      const { edge } = this.panelResize;
      if (edge.includes('e')) {
        w += dx;
      }
      if (edge.includes('n')) {
        h -= dy;
      }
      const clamped = clampPanelSize(w, h);
      this.panelWidth = clamped.width;
      this.panelHeight = clamped.height;
      const cursor =
        edge === 'e' ? 'ew-resize' : edge === 'n' ? 'ns-resize' : 'nesw-resize';
      document.body.style.cursor = cursor;
    },
    endPanelResize() {
      if (!this.panelResize) {
        return;
      }
      this.panelResize = null;
      document.removeEventListener('mousemove', this._onPanelResizeMove);
      document.removeEventListener('mouseup', this._onPanelResizeEnd);
      document.body.classList.remove('model-io-panel-resizing');
      document.body.style.cursor = '';
      savePanelSize(this.panelWidth, this.panelHeight);
    },
    startPoll() {
      this.stopPoll();
      this.pollTimer = setInterval(() => this.pollTick(), this.pollIntervalMs);
    },
    pollTick() {
      if (!this.expanded || !this.ready) {
        return;
      }
      const showsTelemetry = this.viewTab === 'graph' || this.viewTab === 'stack';
      if (showsTelemetry && performance.now() - (this.telemetryAt ?? 0) >= TELEMETRY_REFRESH_MS) {
        this.refreshTelemetry();
      }
      if (this.activeProbes.length > 0) {
        pushScopeSample(this.signalScope, this.demo?.policyRunner, this.demo);
        this.scopeSnapshot = getScopeSnapshot(this.signalScope);
      }
    },
    stopPoll() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },
    togglePanel() {
      this.expanded = !this.expanded;
      if (this.expanded) {
        this.refreshTelemetry();
      }
    },
    closePanel() {
      this.expanded = false;
    },
    refreshTelemetry() {
      this.telemetryAt = performance.now();
      if (!this.ready || !this.demo?.policyRunner) {
        this.telemetry = buildPolicyTelemetry(null, null, { lang: this.language });
        return;
      }
      this.telemetry = buildPolicyTelemetry(this.demo.policyRunner, this.demo, {
        lang: this.language,
        policyId: this.demo.currentPolicyId,
        currentPolicyPath: this.demo.currentPolicyPath
      });
      // After a policy switch the scope may still hold channels of nodes or
      // joints the new policy does not have; those would plot flat zeros.
      if (syncScopeProbes(this.signalScope, this.telemetry.atomicNodes) > 0) {
        this.scopeSnapshot = getScopeSnapshot(this.signalScope);
      }
    },
    onProbeNode(node) {
      this.plotProbes(listNodeProbes(node));
    },
    /**
     * Plot an observation block from the stacking view: one block can span
     * several pipeline nodes (Command → vx / vy / yaw), so every node it owns
     * goes on the scope together.
     */
    onStackBlock(block) {
      const nodeIds = new Set(block?.nodeIds ?? []);
      if (nodeIds.size === 0) {
        return;
      }
      const probes = (this.telemetry.atomicNodes ?? [])
        .filter((node) => nodeIds.has(node.id))
        .flatMap((node) => listNodeProbes(node));
      this.plotProbes(probes, { allowMultipleNodes: true });
    },
    /** Plot a single module (graph node) of an observation block. */
    onStackModule(mod) {
      const node = (this.telemetry.atomicNodes ?? []).find(
        (candidate) => candidate.id === mod?.id
      );
      if (!node) {
        return;
      }
      this.plotProbes(listNodeProbes(node));
    },
    /**
     * Swap the scope over to a new probe set and show it.
     * setScopeProbes rebuilds every channel and clears the sample buffer, so
     * the previous selection needs no separate teardown.
     */
    plotProbes(probes, options = {}) {
      if (!probes.length) {
        return;
      }
      setScopeProbes(this.signalScope, probes, options);
      this.viewTab = 'scope';
      if (this.ready && this.demo?.policyRunner) {
        pushScopeSample(this.signalScope, this.demo.policyRunner, this.demo);
      }
      this.scopeSnapshot = getScopeSnapshot(this.signalScope);
    },
    onRemoveProbe(probeId) {
      removeScopeProbe(this.signalScope, probeId);
      this.scopeSnapshot = getScopeSnapshot(this.signalScope);
    },
    /**
     * Mute a curve instead of dropping it: the channel keeps sampling, so
     * bringing it back shows the history recorded while it was hidden.
     */
    onToggleSeries(probeId) {
      toggleScopeChannelHidden(this.signalScope, probeId);
      this.scopeSnapshot = getScopeSnapshot(this.signalScope);
    },
    onScopeWindowChange(seconds) {
      const next = saveScopeWindowSeconds(seconds);
      this.scopeWindowSeconds = setScopeWindowSeconds(this.signalScope, next);
      this.scopeSnapshot = getScopeSnapshot(this.signalScope);
    },
    openScopeTab() {
      this.viewTab = 'scope';
    },
    openArchitectureTab() {
      this.viewTab = 'architecture';
    },
    openStackTab() {
      this.viewTab = 'stack';
    },
    toggleScopePause() {
      this.signalScope.paused = !this.signalScope.paused;
    },
    clearScope() {
      clearScopeBuffer(this.signalScope);
      this.signalScope.channels = [];
      this.scopeSnapshot = getScopeSnapshot(this.signalScope);
    }
  }
};
</script>

<style scoped>
.model-io-dock {
  position: fixed;
  left: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
  z-index: 1050;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: calc(100vw - 24px);
}

.model-io-dock-mobile {
  left: 0;
  right: 0;
  bottom: 0;
  max-width: none;
  align-items: stretch;
  pointer-events: none;
}

.model-io-dock-mobile .model-io-toggle,
.model-io-dock-mobile .model-io-panel,
.model-io-dock-mobile .model-io-backdrop {
  pointer-events: auto;
}

.model-io-toggle-mobile {
  position: fixed;
  left: 12px;
  bottom: v-bind(mobileToggleBottom);
  z-index: 1051;
  min-height: 40px;
  padding-inline: 12px;
  border-radius: 18px !important;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22);
}

.model-io-toggle-mobile :deep(.v-btn__overlay),
.model-io-toggle-mobile :deep(.v-btn__underlay) {
  border-radius: 18px;
}

.model-io-dock-sheet-open .model-io-toggle-mobile {
  display: none;
}

.model-io-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1095;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.model-io-toggle {
  text-transform: none;
  letter-spacing: 0;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

.model-io-panel {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.model-io-panel-desktop {
  position: relative;
  max-width: calc(100vw - 24px);
}

.model-io-panel-desktop .model-io-body {
  flex: 1 1 auto;
  min-height: 0;
}

.model-io-panel-sheet {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
  width: auto !important;
  max-width: none;
  max-height: min(58vh, calc(100dvh - var(--header-h, 58px) - 24px));
  margin: 0;
  border-radius: 18px;
  z-index: 1100;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22);
}

.model-io-panel-sheet .model-io-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 12px;
}

.model-io-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  padding: 12px 14px 8px;
  flex-shrink: 0;
}

.model-io-tabs {
  margin-right: 4px;
}

/* Mobile: the four tabs get their own full-width row under the title. */
.model-io-tabs-mobile {
  order: 10;
  flex: 1 0 100%;
  margin-right: 0;
}

.model-io-tabs-mobile :deep(.v-btn) {
  flex: 1 1 0;
  min-width: 0;
  padding-inline: 4px;
}

.model-io-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  overscroll-behavior: contain;
  padding-top: 0;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  -webkit-overflow-scrolling: touch;
}

.model-io-body > .onnx-netron-viewer {
  flex: 1 1 auto;
  min-height: 280px;
}

.pipeline-hint {
  margin-bottom: 8px;
  padding: 0 2px;
}

.model-io-resize-handle {
  position: absolute;
  z-index: 3;
  touch-action: none;
}

.model-io-resize-e {
  top: 18px;
  right: 0;
  width: 8px;
  bottom: 12px;
  cursor: ew-resize;
}

.model-io-resize-n {
  top: 0;
  left: 12px;
  right: 12px;
  height: 8px;
  cursor: ns-resize;
}

.model-io-resize-ne {
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  cursor: nesw-resize;
  background: transparent;
}

.model-io-resize-ne::before {
  content: '';
  position: absolute;
  right: 6px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-right: 1.5px solid rgba(var(--v-theme-primary), 0.5);
  border-top: 1.5px solid rgba(var(--v-theme-primary), 0.5);
  border-top-right-radius: 3px;
  pointer-events: none;
  transition: border-color 0.18s ease;
}

.model-io-resize-e:hover,
.model-io-resize-e:active,
.model-io-resize-n:hover,
.model-io-resize-n:active {
  background-color: rgba(var(--v-theme-primary), 0.12);
}

.model-io-resize-ne:hover::before,
.model-io-resize-ne:active::before {
  border-color: rgba(var(--v-theme-primary), 0.9);
}

@media (max-width: 640px), (max-height: 760px) {
  .model-io-panel:not(.model-io-panel-sheet) {
    width: calc(100vw - 16px);
  }
}
</style>

<style>
/* 移动端底部抽屉打开时禁止背景滚动 */
body.model-io-sheet-open {
  overflow: hidden;
  touch-action: none;
}

body.model-io-panel-resizing {
  user-select: none;
}
</style>
