<template>
  <div class="stack-shell">
    <p v-if="!layout.ready" class="stack-empty text-caption">
      {{ labels.empty }}
    </p>

    <template v-else>
      <div class="stack-stats">
        <div class="stack-stat">
          <span class="stack-stat-value">{{ layout.frameSize }}D</span>
          <span class="stack-stat-label">{{ labels.frame }}</span>
        </div>
        <span class="stack-stat-op">×</span>
        <div class="stack-stat">
          <span class="stack-stat-value">{{ layout.historyLength }}</span>
          <span class="stack-stat-label">{{ labels.history }}</span>
        </div>
        <span class="stack-stat-op">=</span>
        <div class="stack-stat">
          <span class="stack-stat-value">{{ layout.tensorSize }}D</span>
          <span class="stack-stat-label">{{ labels.tensor }}</span>
        </div>
        <div v-if="inputShapeText" class="stack-stat stack-stat-muted">
          <span class="stack-stat-value">{{ inputShapeText }}</span>
          <span class="stack-stat-label">{{ labels.input }}</span>
        </div>
      </div>

      <div ref="body" class="stack-body" @mouseleave="clearHover">
        <section class="stack-section">
          <h4 class="stack-section-title">{{ labels.frameTitle }}</h4>
          <table class="stack-table">
            <caption class="stack-sr-only">{{ labels.frameTitle }}</caption>
            <thead class="stack-sr-only">
              <tr>
                <th scope="col">{{ labels.colBlock }}</th>
                <th scope="col">{{ labels.colSize }}</th>
                <th scope="col">{{ labels.colRange }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="block in layout.blocks" :key="block.id">
                <tr
                  class="stack-row"
                  :class="{
                    'stack-row-active': hoverBlockId === block.id,
                    'stack-row-muted': hoverBlockId && hoverBlockId !== block.id,
                    'stack-row-clickable': isBlockProbeable(block),
                    'stack-row-probed': isBlockProbed(block)
                  }"
                  @mouseenter="onHoverBlock(block, $event)"
                  @mousemove="moveTooltip($event)"
                  @click="selectBlock(block)"
                >
                  <th scope="row" class="stack-cell-name">
                    <button
                      v-if="isBlockProbeable(block)"
                      type="button"
                      class="stack-name-btn"
                      :aria-label="`${blockFullName(block)} — ${blockHint(block)}`"
                      @click.stop="selectBlock(block)"
                    >
                      <span class="stack-name-text">{{ block.name }}</span>
                      <span
                        v-if="soleModuleTitle(block)"
                        class="stack-name-node"
                      >· {{ soleModuleTitle(block) }}</span>
                      <v-icon
                        icon="ph-wave-sine"
                        size="11"
                        class="stack-name-icon"
                      />
                    </button>
                    <span v-else class="stack-name-text" :title="block.name">{{ block.name }}</span>
                  </th>
                  <td class="stack-cell-bar">
                    <span class="stack-bar-track">
                      <span
                        class="stack-bar-fill"
                        :style="{ width: `${barWidth(block)}%` }"
                      />
                      <span class="stack-bar-value">{{ block.size }}D</span>
                    </span>
                  </td>
                  <td class="stack-cell-range">[{{ block.offset }}, {{ block.end }})</td>
                </tr>
                <tr
                  v-for="(mod, modIdx) in submodules(block)"
                  :key="mod.id"
                  class="stack-subrow"
                  :class="{
                    'stack-row-muted': hoverBlockId && hoverBlockId !== block.id,
                    'stack-subrow-probed': isModuleProbed(mod)
                  }"
                  @mouseenter="onHoverModule(block, mod, $event)"
                  @mousemove="moveTooltip($event)"
                  @click.stop="selectModule(mod)"
                >
                  <th scope="row" class="stack-cell-name stack-cell-subname">
                    <button
                      type="button"
                      class="stack-name-btn"
                      :aria-label="`${block.name} / ${mod.title} — ${moduleHint(mod)}`"
                      @click.stop="selectModule(mod)"
                    >
                      <span class="stack-subrow-branch" aria-hidden="true">
                        {{ modIdx === submodules(block).length - 1 ? '└' : '├' }}
                      </span>
                      <span class="stack-name-text">{{ mod.title }}</span>
                      <v-icon
                        icon="ph-wave-sine"
                        size="10"
                        class="stack-name-icon"
                      />
                    </button>
                  </th>
                  <td class="stack-cell-bar">
                    <span class="stack-bar-track">
                      <span
                        class="stack-bar-fill stack-bar-fill-sub"
                        :style="{ width: `${barWidth(mod)}%` }"
                      />
                      <span class="stack-bar-value">{{ mod.size }}D</span>
                    </span>
                  </td>
                  <td class="stack-cell-range">[{{ mod.offset }}, {{ mod.end }})</td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>

        <section class="stack-section">
          <h4 class="stack-section-title">
            {{ labels.stackTitle }}
            <span class="stack-section-note">{{ stackNote }}</span>
          </h4>
          <div
            class="stack-frames"
            role="img"
            :aria-label="stackAriaLabel"
          >
            <div
              v-for="frame in layout.frames"
              :key="frame.index"
              class="stack-frame"
              :class="{ 'stack-frame-latest': frame.isLatest }"
            >
              <span class="stack-frame-label">{{ frame.label }}</span>
              <div class="stack-strip">
                <span
                  v-for="(block, idx) in layout.blocks"
                  :key="block.id"
                  class="stack-seg"
                  :class="[
                    idx % 2 === 0 ? 'stack-seg-a' : 'stack-seg-b',
                    {
                      'stack-seg-active': hoverBlockId === block.id,
                      'stack-seg-muted': hoverBlockId && hoverBlockId !== block.id,
                      'stack-seg-clickable': isBlockProbeable(block),
                      'stack-seg-probed': isBlockProbed(block)
                    }
                  ]"
                  :style="{ flexGrow: block.size || 0.001 }"
                  @mouseenter="onHoverBlock(block, $event, frame)"
                  @mousemove="moveTooltip($event)"
                  @click="selectBlock(block)"
                >
                  <span v-if="block.share > 0.16" class="stack-seg-label">{{ block.name }}</span>
                </span>
                <span
                  v-if="layout.unmappedSize > 0"
                  class="stack-seg stack-seg-gap"
                  :style="{ flexGrow: layout.unmappedSize }"
                />
              </div>
              <span class="stack-frame-range">
                {{ frame.offset }}–{{ frame.offset + layout.frameSize - 1 }}
              </span>
            </div>
          </div>
          <p class="stack-axis">
            <span>0</span>
            <span class="stack-axis-line" aria-hidden="true" />
            <span>{{ labels.tensor }} {{ layout.tensorSize }}D</span>
          </p>
        </section>

        <div
          v-if="tooltip"
          class="stack-tooltip"
          :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
        >
          <div class="stack-tooltip-title">{{ tooltip.title }}</div>
          <div class="stack-tooltip-line">{{ tooltip.range }}</div>
          <MathText
            v-if="tooltip.description"
            tag="div"
            class="stack-tooltip-desc"
            :text="tooltip.description"
          />
          <div v-if="tooltip.modules" class="stack-tooltip-desc">{{ tooltip.modules }}</div>
          <div v-if="tooltip.hint" class="stack-tooltip-hint">{{ tooltip.hint }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import MathText from '@/components/MathText.vue';

export default {
  name: 'ObsStackChart',
  components: { MathText },
  props: {
    layout: {
      type: Object,
      required: true
    },
    labels: {
      type: Object,
      required: true
    },
    /** Pipeline node ids currently plotted on the oscilloscope. */
    activeNodeIds: {
      type: Array,
      default: () => []
    }
  },
  emits: ['select-block', 'select-module'],
  data: () => ({
    hoverBlockId: null,
    tooltip: null
  }),
  computed: {
    activeNodeIdSet() {
      return new Set(this.activeNodeIds);
    },
    maxBlockSize() {
      return this.layout.blocks.reduce((max, block) => Math.max(max, block.size), 0);
    },
    inputShapeText() {
      const dims = this.layout.inputShape;
      return dims?.length ? `[${dims.join('×')}]` : '';
    },
    stackNote() {
      if (this.layout.historyLength <= 1) {
        return this.labels.singleFrame;
      }
      return this.labels.latestLast;
    },
    stackAriaLabel() {
      const { historyLength, frameSize, tensorSize } = this.layout;
      return `${historyLength} × ${frameSize}D = ${tensorSize}D`;
    }
  },
  methods: {
    isBlockProbeable(block) {
      return (block?.channelCount ?? 0) > 0;
    },
    isBlockProbed(block) {
      return (block?.nodeIds ?? []).some((nodeId) => this.activeNodeIdSet.has(nodeId));
    },
    isModuleProbed(mod) {
      return this.activeNodeIdSet.has(mod?.id);
    },
    /**
     * Graph node title for a block that maps to exactly one node; blocks that
     * decompose into several nodes name them in their own sub-rows instead.
     */
    soleModuleTitle(block) {
      const modules = block?.modules ?? [];
      return modules.length === 1 ? modules[0].title : '';
    },
    submodules(block) {
      const modules = block?.modules ?? [];
      return modules.length > 1 ? modules : [];
    },
    blockFullName(block) {
      const sole = this.soleModuleTitle(block);
      return sole ? `${block.name} · ${sole}` : block.name;
    },
    plotHint(channelCount) {
      return `${this.labels.plot} · ${channelCount} ${this.labels.channels}`;
    },
    blockHint(block) {
      if (!this.isBlockProbeable(block)) {
        return '';
      }
      return this.plotHint(block.channelCount);
    },
    moduleHint(mod) {
      return this.plotHint(mod?.channelCount ?? 0);
    },
    selectBlock(block) {
      if (!this.isBlockProbeable(block)) {
        return;
      }
      this.$emit('select-block', block);
    },
    selectModule(mod) {
      if (!mod?.id) {
        return;
      }
      this.$emit('select-module', mod);
    },
    barWidth(block) {
      if (!this.maxBlockSize) {
        return 0;
      }
      // Floor so a 1D block stays visible next to a 29D one; the ceiling keeps
      // room for the value label that sits at the bar's end.
      return Math.max(1.5, (block.size / this.maxBlockSize) * 88);
    },
    onHoverBlock(block, event, frame = null) {
      this.hoverBlockId = block.id;
      const offset = (frame?.offset ?? 0) + block.offset;
      const modules = block.modules ?? [];
      this.tooltip = {
        title: `${this.blockFullName(block)} · ${block.size}D`,
        range: frame
          ? `${frame.label} · [${offset}, ${offset + block.size})`
          : `[${block.offset}, ${block.end})`,
        description: block.description,
        // Name the graph nodes inside the block so the strip says which module
        // sits where, not just which observation block.
        modules: modules.length > 1
          ? `${this.labels.colModule}: ${modules.map((mod) => mod.title).join(' / ')}`
          : '',
        hint: this.blockHint(block),
        x: 0,
        y: 0
      };
      this.moveTooltip(event);
    },
    onHoverModule(block, mod, event) {
      this.hoverBlockId = block.id;
      this.tooltip = {
        title: `${mod.title} · ${mod.size}D`,
        range: `${block.name} · [${mod.offset}, ${mod.end})`,
        description: '',
        modules: '',
        hint: this.moduleHint(mod),
        x: 0,
        y: 0
      };
      this.moveTooltip(event);
    },
    moveTooltip(event) {
      if (!this.tooltip) {
        return;
      }
      const host = this.$refs.body;
      if (!host) {
        return;
      }
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this.tooltip = {
        ...this.tooltip,
        x: Math.min(Math.max(8, x + 14), Math.max(8, rect.width - 190)),
        y: Math.max(4, y - 52)
      };
    },
    clearHover() {
      this.hoverBlockId = null;
      this.tooltip = null;
    }
  }
};
</script>

<style scoped>
.stack-shell {
  --stack-surface: var(--viz-bg);
  --stack-panel: var(--viz-panel);
  --stack-mark: #4bacd6;
  --stack-seg-a: #8ecbe2;
  --stack-seg-b: #3f9fc9;
  --stack-probe: #00d992;
  --stack-ink: var(--viz-ink);
  --stack-ink-muted: var(--viz-ink-muted);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
}

.stack-empty {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.stack-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-mono);
}

.stack-stat {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.stack-stat-value {
  font-size: 0.95rem;
  color: var(--stack-mark);
}

.stack-stat-label {
  font-size: 0.62rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.stack-stat-muted .stack-stat-value {
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.stack-stat-op {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
  align-self: center;
}

.stack-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background: var(--stack-surface);
  color: var(--stack-ink);
}

.stack-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stack-section-title {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--stack-ink);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stack-section-note {
  font-size: 0.62rem;
  font-weight: 400;
  color: var(--stack-ink-muted);
}

.stack-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.stack-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 0.65rem;
}

.stack-row > * {
  padding: 2px 0;
  vertical-align: middle;
}

.stack-row-muted {
  opacity: 0.45;
}

.stack-row-active .stack-bar-fill {
  filter: brightness(1.15);
}

.stack-row-clickable {
  cursor: pointer;
}

.stack-row-probed .stack-bar-fill {
  background: var(--stack-probe);
}

.stack-subrow {
  cursor: pointer;
  color: var(--stack-ink-muted);
}

.stack-subrow > * {
  padding: 1px 0;
  vertical-align: middle;
}

.stack-subrow .stack-bar-fill {
  height: 6px;
  opacity: 0.75;
}

.stack-subrow-probed {
  color: var(--stack-probe);
}

.stack-subrow-probed .stack-bar-fill,
.stack-subrow:hover .stack-bar-fill {
  background: var(--stack-probe);
  opacity: 1;
}

.stack-subrow-probed .stack-name-icon,
.stack-subrow:hover .stack-name-icon {
  opacity: 1;
  color: var(--stack-probe);
}

.stack-subrow:hover {
  color: var(--stack-probe);
}

.stack-cell-subname {
  padding-left: 8px;
}

.stack-subrow-branch {
  flex: 0 0 auto;
  opacity: 0.55;
}

.stack-cell-name {
  width: 30%;
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-weight: 400;
  color: var(--stack-ink);
  padding-right: 8px;
}

.stack-name-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.stack-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The graph node title next to the raw observation module name. */
.stack-name-node {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--stack-ink-muted);
}

.stack-row-probed .stack-name-node,
.stack-row-clickable:hover .stack-name-node {
  color: var(--stack-probe);
}

.stack-name-icon {
  flex: 0 0 auto;
  opacity: 0.4;
  transition: opacity var(--transition);
}

.stack-row-clickable:hover .stack-name-text,
.stack-name-btn:focus-visible .stack-name-text {
  color: var(--stack-probe);
}

.stack-row-clickable:hover .stack-name-icon,
.stack-name-btn:focus-visible .stack-name-icon,
.stack-row-probed .stack-name-icon {
  opacity: 1;
  color: var(--stack-probe);
}

.stack-row-probed .stack-name-text {
  color: var(--stack-probe);
}

.stack-cell-bar {
  width: auto;
}

.stack-bar-track {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.stack-bar-fill {
  flex: 0 0 auto;
  height: 10px;
  border-radius: 0 4px 4px 0;
  background: var(--stack-mark);
}

.stack-bar-value {
  flex: 0 0 auto;
  color: var(--stack-ink);
}

.stack-cell-range {
  width: 92px;
  text-align: right;
  padding-left: 8px;
  color: var(--stack-ink-muted);
}

.stack-frames {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stack-frame {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
}

.stack-frame-label {
  width: 30px;
  flex-shrink: 0;
  color: var(--stack-ink-muted);
}

.stack-frame-latest .stack-frame-label {
  color: var(--stack-ink);
}

.stack-frame-range {
  width: 84px;
  flex-shrink: 0;
  text-align: right;
  color: var(--stack-ink-muted);
}

.stack-strip {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: 2px;
  height: 18px;
  padding: 2px;
  border-radius: 5px;
  background: var(--stack-panel);
  overflow: hidden;
}

.stack-frame-latest .stack-strip {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.55);
}

.stack-seg {
  /* basis 0 so the segment width comes from flex-grow (= block size) alone;
     with `auto` the inline label would widen its own segment. */
  flex-basis: 0;
  min-width: 2px;
  border-radius: 2px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.stack-seg-a {
  background: var(--stack-seg-a);
}

.stack-seg-b {
  background: var(--stack-seg-b);
}

.stack-seg-gap {
  background: rgba(155, 155, 155, 0.25);
}

.stack-seg-muted {
  opacity: 0.35;
}

.stack-seg-active {
  box-shadow: inset 0 0 0 2px var(--stack-surface);
}

.stack-seg-clickable {
  cursor: pointer;
}

.stack-seg-probed {
  background: var(--stack-probe);
}

.stack-seg-label {
  font-size: 0.55rem;
  color: var(--viz-bg);
  padding: 0 3px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stack-axis {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 0;
  padding-left: 38px;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  color: var(--stack-ink-muted);
}

.stack-axis-line {
  flex: 1 1 auto;
  height: 1px;
  background: rgba(155, 155, 155, 0.3);
}

.stack-tooltip {
  position: absolute;
  z-index: 5;
  max-width: 200px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--viz-line);
  background: rgba(31, 31, 31, 0.97);
  color: var(--stack-ink);
  font-size: 0.6rem;
  line-height: 1.35;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}

.stack-tooltip-title {
  font-family: var(--font-mono);
}

.stack-tooltip-line {
  color: var(--stack-ink-muted);
  font-family: var(--font-mono);
}

.stack-tooltip-desc {
  margin-top: 3px;
  color: var(--stack-ink-muted);
}

.stack-tooltip-hint {
  margin-top: 3px;
  color: var(--stack-probe);
}

@media (max-width: 640px) {
  .stack-cell-range {
    display: none;
  }

  .stack-frame-range {
    width: 62px;
  }
}
</style>
