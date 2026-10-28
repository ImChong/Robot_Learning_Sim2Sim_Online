<template>
  <div
    class="parkour-mobile-controls"
    :class="{
      'parkour-mobile-controls--disabled': disabled,
      'parkour-mobile-controls--dock-panel': dockAboveMobilePanel
    }"
    role="group"
    :aria-label="labels.group"
  >
    <div class="parkour-mobile-controls__pad">
      <div
        ref="moveBase"
        class="parkour-mobile-controls__stick-base"
        :aria-label="labels.move"
        @pointerdown.prevent="onMoveDown"
        @pointermove.prevent="onMoveMove"
        @pointerup.prevent="onMoveUp"
        @pointercancel.prevent="onMoveUp"
      >
        <div
          class="parkour-mobile-controls__stick-knob"
          :style="knobStyle"
        ></div>
      </div>
      <div class="parkour-mobile-controls__orbit-anchor" aria-hidden="true">
        <button
          type="button"
          class="parkour-mobile-controls__action-btn parkour-mobile-controls__orbit-btn parkour-mobile-controls__orbit-btn--pause"
          :aria-label="labels.pause"
          :disabled="disabled"
          data-test="parkour-pause-mobile"
          @click.stop="onPauseClick"
        >
          <v-icon icon="ph-pause" size="22" />
        </button>
        <button
          type="button"
          class="parkour-mobile-controls__action-btn parkour-mobile-controls__orbit-btn parkour-mobile-controls__orbit-btn--reset"
          :aria-label="labels.resetRun"
          :disabled="disabled"
          data-test="parkour-reset-run-mobile"
          @click.stop="onResetRunClick"
        >
          <v-icon icon="ph-arrow-counter-clockwise" size="22" />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import {
  computeParkourKeysFromStick,
  stickVisualFromParkourKeys
} from '@/utils/parkourJoystickCommand.js';

export default {
  name: 'ParkourMobileJoystick',
  props: {
    disabled: {
      type: Boolean,
      default: false
    },
    dockAboveMobilePanel: {
      type: Boolean,
      default: false
    },
    labels: {
      type: Object,
      required: true
    },
    virtualKeys: {
      type: Object,
      default: () => ({ w: false, a: false, d: false, highSpeed: false })
    }
  },
  emits: ['input', 'pause', 'reset-run'],
  data: () => ({
    moveNormX: 0,
    moveNormY: 0,
    movePointerId: null,
    knobOffsetX: 0,
    knobOffsetY: 0,
    maxRadius: 1
  }),
  computed: {
    knobStyle() {
      return {
        transform: `translate(calc(-50% + ${this.knobOffsetX}px), calc(-50% + ${this.knobOffsetY}px))`
      };
    }
  },
  watch: {
    virtualKeys: {
      deep: true,
      handler: 'syncVisualFromKeys'
    }
  },
  mounted() {
    this.measureBase();
    this.syncVisualFromKeys();
    this._onResize = () => this.measureBase();
    window.addEventListener('resize', this._onResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this._onResize);
    this.releaseMovePointer();
    this.emitInput(false);
  },
  methods: {
    measureBase() {
      const base = this.$refs.moveBase;
      if (!base) {
        return;
      }
      const rect = base.getBoundingClientRect();
      this.maxRadius = Math.max(24, (Math.min(rect.width, rect.height) - 44) / 2);
      this.syncVisualFromKeys();
    },
    syncVisualFromKeys() {
      if (this.movePointerId !== null) {
        return;
      }
      const { normX, normY } = stickVisualFromParkourKeys(this.virtualKeys);
      this.moveNormX = normX;
      this.moveNormY = normY;
      this.knobOffsetX = normX * this.maxRadius;
      this.knobOffsetY = -normY * this.maxRadius;
    },
    emitInput(activeOverride) {
      if (this.disabled) {
        return;
      }
      const keys = computeParkourKeysFromStick(this.moveNormX, this.moveNormY);
      const active = activeOverride ?? keys.active;
      this.$emit('input', {
        active,
        w: active ? keys.w : false,
        a: active ? keys.a : false,
        d: active ? keys.d : false,
        highSpeed: active ? keys.highSpeed : false
      });
    },
    onPauseClick() {
      if (this.disabled) {
        return;
      }
      this.$emit('pause');
    },
    onResetRunClick() {
      if (this.disabled) {
        return;
      }
      this.$emit('reset-run');
    },
    updateMoveFromClient(clientX, clientY) {
      const base = this.$refs.moveBase;
      if (!base) {
        return;
      }
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > this.maxRadius) {
        const scale = this.maxRadius / dist;
        dx *= scale;
        dy *= scale;
      }
      this.knobOffsetX = dx;
      this.knobOffsetY = dy;
      this.moveNormX = dx / this.maxRadius;
      this.moveNormY = -dy / this.maxRadius;
      this.emitInput();
    },
    onMoveDown(event) {
      if (this.disabled) {
        return;
      }
      this.measureBase();
      this.movePointerId = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      this.updateMoveFromClient(event.clientX, event.clientY);
    },
    onMoveMove(event) {
      if (this.disabled || this.movePointerId !== event.pointerId) {
        return;
      }
      this.updateMoveFromClient(event.clientX, event.clientY);
    },
    onMoveUp(event) {
      if (this.movePointerId !== null && event.pointerId !== this.movePointerId) {
        return;
      }
      this.resetMove();
    },
    resetMove() {
      this.movePointerId = null;
      this.moveNormX = 0;
      this.moveNormY = 0;
      this.knobOffsetX = 0;
      this.knobOffsetY = 0;
      this.emitInput(false);
    },
    releaseMovePointer() {
      if (this.movePointerId === null) {
        return;
      }
      try {
        this.$refs.moveBase?.releasePointerCapture(this.movePointerId);
      } catch {
        // ignore if capture was already released
      }
      this.resetMove();
    }
  }
};
</script>

<style scoped>
.parkour-mobile-controls {
  --parkour-mobile-glass: rgba(var(--v-theme-on-surface), 0.12);
  --parkour-mobile-glass-border: rgba(var(--v-theme-on-surface), 0.16);
  --parkour-mobile-glass-active: rgba(var(--v-theme-primary), 0.22);
  --parkour-stick-size: 128px;
  --parkour-btn-size: 48px;
  --parkour-orbit-radius: calc(var(--parkour-stick-size) / 2 + var(--parkour-btn-size) / 2 + 14px);

  position: fixed;
  right: 16px;
  z-index: var(--z-dock);
  bottom: calc(16px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
  touch-action: none;
  user-select: none;
  pointer-events: auto;
}

.parkour-mobile-controls--disabled {
  opacity: 0.45;
  pointer-events: none;
}

.parkour-mobile-controls--dock-panel {
  --parkour-stick-size: 108px;
  --parkour-btn-size: 40px;
  --parkour-orbit-radius: calc(var(--parkour-stick-size) / 2 + var(--parkour-btn-size) / 2 + 12px);
  right: 12px;
  bottom: calc(
    12px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px) +
      var(--mobile-controls-panel-height, 140px) + 12px
  );
  bottom: calc(
    12px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px) +
      var(--mobile-controls-panel-height, 140px) + 12px
  );
}

.parkour-mobile-controls__pad {
  position: relative;
  width: calc(var(--parkour-stick-size) + var(--parkour-orbit-radius) + var(--parkour-btn-size) / 2);
  height: calc(var(--parkour-stick-size) + var(--parkour-orbit-radius) * 0.52);
}

.parkour-mobile-controls--dock-panel .parkour-mobile-controls__stick-knob {
  width: 44px;
  height: 44px;
}

.parkour-mobile-controls--dock-panel .parkour-mobile-controls__action-btn :deep(.v-icon) {
  font-size: 20px !important;
}

.parkour-mobile-controls__stick-base {
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--parkour-stick-size);
  height: var(--parkour-stick-size);
  border-radius: 50%;
  border: 1px solid var(--parkour-mobile-glass-border);
  background: var(--parkour-mobile-glass);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  touch-action: none;
  z-index: 1;
}

.parkour-mobile-controls__orbit-anchor {
  position: absolute;
  right: calc(var(--parkour-stick-size) / 2);
  bottom: calc(var(--parkour-stick-size) / 2);
  width: 0;
  height: 0;
  z-index: 2;
}

.parkour-mobile-controls__stick-base::before {
  content: '';
  position: absolute;
  inset: 22%;
  border-radius: 50%;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  pointer-events: none;
}

.parkour-mobile-controls__stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  will-change: transform;
}

/* 0deg = 12 o'clock; CCW: 9:30 -75deg, 8:30 -105deg */
.parkour-mobile-controls__orbit-btn {
  --orbit-deg: 0deg;
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%) rotate(var(--orbit-deg))
    translateY(calc(-1 * var(--parkour-orbit-radius))) rotate(calc(-1 * var(--orbit-deg)));
}

.parkour-mobile-controls__orbit-btn--reset {
  --orbit-deg: -75deg;
}

.parkour-mobile-controls__orbit-btn--pause {
  --orbit-deg: -105deg;
}

.parkour-mobile-controls__action-btn {
  width: var(--parkour-btn-size);
  height: var(--parkour-btn-size);
  border-radius: 50%;
  border: 1px solid var(--parkour-mobile-glass-border);
  background: var(--parkour-mobile-glass);
  color: rgb(var(--v-theme-on-surface));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background-color var(--transition), border-color var(--transition);
}

.parkour-mobile-controls__action-btn:active:not(:disabled) {
  background: var(--parkour-mobile-glass-active);
  border-color: rgba(var(--v-theme-primary), 0.4);
}
</style>
