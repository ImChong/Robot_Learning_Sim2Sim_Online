<template>
  <div class="scope-shell">
    <div class="scope-toolbar">
      <div class="scope-stats">
        <span>
          {{ channelsLabel }}: {{ snapshot.series.length }}
          <template v-if="hiddenCount">({{ hiddenCount }} {{ hiddenLabel }})</template>
        </span>
        <span class="scope-stat-sep">/</span>
        <span>{{ samplesLabel }}: {{ snapshot.sampleCount }}</span>
        <span class="scope-stat-sep">/</span>
        <label class="scope-window-control">
          <span class="scope-window-label">{{ windowLabel }}</span>
          <input
            class="scope-window-input"
            type="number"
            :min="windowMinSeconds"
            :max="windowMaxSeconds"
            step="1"
            :value="windowInput"
            :aria-label="windowInputAriaLabel"
            @change="onWindowInputChange"
            @keydown.enter.prevent="onWindowInputChange"
          />
          <span class="scope-window-unit">s</span>
        </label>
        <template v-if="source">
          <span class="scope-stat-sep">/</span>
          <span class="scope-source" :title="source">
            {{ sourceLabel }}: <strong class="scope-source-name">{{ source }}</strong>
          </span>
        </template>
      </div>
      <div class="scope-actions">
        <v-btn
          size="x-small"
          variant="tonal"
          :color="paused ? 'warning' : 'primary'"
          @click="$emit('toggle-pause')"
        >
          <v-icon :icon="paused ? 'mdi-play' : 'mdi-pause'" size="small" start />
          {{ paused ? resumeLabel : pauseLabel }}
        </v-btn>
        <v-btn
          size="x-small"
          variant="text"
          :disabled="snapshot.sampleCount === 0 && activeProbeIds.length === 0"
          @click="$emit('clear')"
        >
          {{ clearLabel }}
        </v-btn>
      </div>
    </div>

    <p v-if="activeProbeIds.length === 0" class="scope-hint text-caption text-medium-emphasis">
      {{ hint }}
    </p>

    <div class="scope-main">
      <div ref="chartHost" class="scope-chart">
        <canvas ref="canvas" class="scope-canvas" />
        <div
          v-if="snapshot.sampleCount === 0"
          class="scope-empty"
        >
          {{ emptyLabel }}
        </div>
      </div>
      <div
        v-if="snapshot.series.length"
        class="scope-legend"
        :class="{ 'scope-legend-dense': isDenseLegend }"
      >
        <div
          v-for="series in snapshot.series"
          :key="series.id"
          class="scope-legend-item"
          :class="{
            'scope-legend-item-active': activeProbeIds.includes(series.id),
            'scope-legend-item-hidden': series.hidden
          }"
        >
          <button
            type="button"
            class="scope-legend-toggle"
            :title="series.hidden ? showSeriesLabel : hideSeriesLabel"
            :aria-pressed="!series.hidden"
            @click="$emit('toggle-series', series.id)"
          >
            <span
              class="scope-legend-swatch"
              :style="series.hidden
                ? { borderColor: series.color }
                : { background: series.color, borderColor: series.color }"
            />
            <span class="scope-legend-label" :title="series.label">{{ series.label }}</span>
          </button>
          <button
            type="button"
            class="scope-legend-remove"
            :title="removeSeriesLabel"
            :aria-label="`${removeSeriesLabel}: ${series.label}`"
            @click="$emit('remove-probe', series.id)"
          >
            <v-icon icon="mdi-close" size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SignalOscilloscope',
  props: {
    snapshot: {
      type: Object,
      required: true
    },
    activeProbeIds: {
      type: Array,
      default: () => []
    },
    paused: {
      type: Boolean,
      default: false
    },
    channelsLabel: {
      type: String,
      default: 'Channels'
    },
    samplesLabel: {
      type: String,
      default: 'Samples'
    },
    windowLabel: {
      type: String,
      default: 'Window'
    },
    windowSeconds: {
      type: Number,
      default: 20
    },
    windowMinSeconds: {
      type: Number,
      default: 10
    },
    windowMaxSeconds: {
      type: Number,
      default: 120
    },
    windowInputAriaLabel: {
      type: String,
      default: 'Oscilloscope window seconds'
    },
    clearLabel: {
      type: String,
      default: 'Clear'
    },
    pauseLabel: {
      type: String,
      default: 'Pause'
    },
    resumeLabel: {
      type: String,
      default: 'Resume'
    },
    emptyLabel: {
      type: String,
      default: 'Waiting for samples…'
    },
    hint: {
      type: String,
      default: 'Switch to the pipeline graph and click a node to plot its signals.'
    },
    /** Name of the pipeline node / observation block feeding the scope. */
    source: {
      type: String,
      default: ''
    },
    sourceLabel: {
      type: String,
      default: 'Source'
    },
    hiddenLabel: {
      type: String,
      default: 'hidden'
    },
    hideSeriesLabel: {
      type: String,
      default: 'Hide this curve'
    },
    showSeriesLabel: {
      type: String,
      default: 'Show this curve'
    },
    removeSeriesLabel: {
      type: String,
      default: 'Remove this channel'
    },
  },
  emits: [
    'toggle-pause',
    'clear',
    'remove-probe',
    'toggle-series',
    'update-window-seconds'
  ],
  data: () => ({
    resizeObserver: null,
    drawRaf: null,
    windowInput: 20
  }),
  computed: {
    // A joint node plots one curve per joint; tighten the legend so the list
    // stays usable instead of turning into a long scroll of tall rows.
    isDenseLegend() {
      return this.snapshot.series.length > 10;
    },
    hiddenCount() {
      return this.snapshot.series.filter((series) => series.hidden).length;
    }
  },
  watch: {
    windowSeconds: {
      immediate: true,
      handler(value) {
        this.windowInput = value;
      }
    },
    // Not deep: the parent hands over a freshly built snapshot on every poll,
    // so identity changes are enough. A deep watcher would walk every sample of
    // every channel each tick, which is costly once a node plots 29 curves.
    snapshot() {
      this.scheduleDraw();
    }
  },
  mounted() {
    this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
    if (this.$refs.chartHost) {
      this.resizeObserver.observe(this.$refs.chartHost);
    }
    this.scheduleDraw();
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect();
    if (this.drawRaf) {
      cancelAnimationFrame(this.drawRaf);
    }
  },
  methods: {
    onWindowInputChange(event) {
      const raw = event?.target?.value ?? this.windowInput;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        this.windowInput = this.windowSeconds;
        return;
      }
      const clamped = Math.min(
        this.windowMaxSeconds,
        Math.max(this.windowMinSeconds, Math.round(parsed))
      );
      this.windowInput = clamped;
      if (event?.target) {
        event.target.value = String(clamped);
      }
      if (clamped !== this.windowSeconds) {
        this.$emit('update-window-seconds', clamped);
      }
    },
    scheduleDraw() {
      if (this.drawRaf) {
        return;
      }
      this.drawRaf = requestAnimationFrame(() => {
        this.drawRaf = null;
        this.draw();
      });
    },
    draw() {
      const canvas = this.$refs.canvas;
      const host = this.$refs.chartHost;
      if (!canvas || !host) {
        return;
      }
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const pad = { left: 42, right: 12, top: 12, bottom: 24 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      if (plotW < 8 || plotH < 8) {
        return;
      }

      ctx.fillStyle = '#0b1018';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#111827';
      ctx.fillRect(pad.left, pad.top, plotW, plotH);

      const { snapshot } = this;
      if (!snapshot.sampleCount || !snapshot.times?.length) {
        return;
      }

      const tMin = snapshot.timeRange?.[0] ?? snapshot.times[0];
      const tMax = snapshot.timeRange?.[1] ?? snapshot.times[snapshot.times.length - 1];
      const vMin = snapshot.valueRange?.[0] ?? -1;
      const vMax = snapshot.valueRange?.[1] ?? 1;
      const tSpan = Math.max(1e-6, tMax - tMin);
      const vSpan = Math.max(1e-6, vMax - vMin);

      const gridColor = 'rgba(148, 163, 184, 0.14)';
      const axisColor = 'rgba(148, 163, 184, 0.55)';
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const x = pad.left + (plotW * i) / 6;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
      }

      ctx.fillStyle = axisColor;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const value = vMax - (vSpan * i) / 4;
        const y = pad.top + (plotH * i) / 4;
        ctx.fillText(value.toFixed(2), pad.left - 6, y);
      }
      ctx.textBaseline = 'top';
      for (let i = 0; i <= 3; i++) {
        const t = tMin + (tSpan * i) / 3;
        const x = pad.left + (plotW * i) / 3;
        // The last tick sits on the right edge: right-align it so it is not clipped.
        ctx.textAlign = i === 3 ? 'right' : 'center';
        ctx.fillText(`${t.toFixed(2)}s`, x, pad.top + plotH + 6);
      }

      const mapX = (t) => pad.left + ((t - tMin) / tSpan) * plotW;
      const mapY = (v) => pad.top + plotH - ((v - vMin) / vSpan) * plotH;

      for (const series of snapshot.series) {
        if (series.hidden) {
          continue;
        }
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < snapshot.times.length; i++) {
          const t = snapshot.times[i];
          if (t < tMin || t > tMax) {
            continue;
          }
          const x = mapX(t);
          const y = mapY(series.values[i]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (started) {
          ctx.stroke();
        }
      }
    }
  }
};
</script>

<style scoped>
.scope-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}

.scope-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.scope-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.scope-stat-sep {
  opacity: 0.45;
}

.scope-source {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-source-name {
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.scope-window-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.scope-window-label {
  white-space: nowrap;
}

.scope-window-input {
  width: 42px;
  padding: 1px 4px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.75);
  color: rgba(226, 232, 240, 0.92);
  font: inherit;
  font-size: 0.72rem;
  text-align: center;
}

.scope-window-input:focus {
  outline: none;
  border-color: rgba(var(--v-theme-primary), 0.65);
}

.scope-window-unit {
  opacity: 0.8;
}

.scope-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.scope-hint {
  margin: 0;
  padding: 0 2px;
}

.scope-main {
  display: flex;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
}

.scope-chart {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 180px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  overflow: hidden;
  background: #0b1018;
}

.scope-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scope-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: rgba(148, 163, 184, 0.75);
  pointer-events: none;
}

.scope-legend {
  width: 168px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  padding-right: 2px;
}

.scope-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: 1px solid rgba(71, 85, 105, 0.55);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.65);
  color: #e2e8f0;
  padding: 6px 8px;
  text-align: left;
}

.scope-legend-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}

.scope-legend-item-hidden {
  border-style: dashed;
}

.scope-legend-item-hidden .scope-legend-label {
  color: rgba(148, 163, 184, 0.65);
}

.scope-legend-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.scope-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.scope-legend-label {
  flex: 1;
  min-width: 0;
  font-size: 0.65rem;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-legend-remove {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  opacity: 0.45;
  flex-shrink: 0;
  cursor: pointer;
}

.scope-legend-remove:hover,
.scope-legend-remove:focus-visible {
  opacity: 1;
  color: rgb(var(--v-theme-error));
}

.scope-legend-dense {
  gap: 3px;
}

.scope-legend-dense .scope-legend-item {
  padding: 2px 6px;
  gap: 5px;
  border-radius: 6px;
}

.scope-legend-dense .scope-legend-swatch {
  width: 8px;
  height: 8px;
}

.scope-legend-dense .scope-legend-label {
  font-size: 0.6rem;
}

@media (max-width: 640px) {
  .scope-main {
    flex-direction: column;
  }

  .scope-legend {
    width: 100%;
    max-height: 96px;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .scope-legend-item {
    width: auto;
    max-width: 100%;
  }
}
</style>
