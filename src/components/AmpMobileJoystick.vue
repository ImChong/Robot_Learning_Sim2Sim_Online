<template>
  <div
    class="amp-mobile-controls"
    :class="{
      'amp-mobile-controls--disabled': disabled,
      'amp-mobile-controls--dock-panel': dockAboveMobilePanel
    }"
    role="group"
    :aria-label="labels.group"
  >
    <div class="amp-mobile-controls__pad" :class="{ 'amp-mobile-controls__pad--with-states': hasStateButtons }">
      <div v-if="hasStateButtons" class="amp-mobile-controls__state-grid">
        <button
          v-for="item in stateButtons"
          :key="item.value"
          type="button"
          class="amp-mobile-controls__action-btn amp-mobile-controls__state-btn"
          :class="{ 'amp-mobile-controls__action-btn--active': item.active }"
          :aria-label="item.label"
          :aria-pressed="item.active ? 'true' : 'false'"
          :disabled="disabled"
          :data-test="`microduck-joystick-state-${item.value}`"
          @click.stop="$emit('state', item.value)"
        >
          <v-icon :icon="item.icon" size="20" />
        </button>
      </div>
      <div
        ref="moveBase"
        class="amp-mobile-controls__stick-base"
        :class="{ 'amp-mobile-controls__stick-base--disabled': stickDisabled }"
        :aria-label="labels.move"
        @pointerdown.prevent="onMoveDown"
        @pointermove.prevent="onMoveMove"
        @pointerup.prevent="onMoveUp"
        @pointercancel.prevent="onMoveUp"
      >
        <div
          class="amp-mobile-controls__stick-knob"
          :style="knobStyle"
        ></div>
      </div>
      <div class="amp-mobile-controls__orbit-anchor" aria-hidden="true">
        <button
          v-if="showKnockdown"
          type="button"
          class="amp-mobile-controls__action-btn amp-mobile-controls__knockdown-btn amp-mobile-controls__orbit-btn amp-mobile-controls__orbit-btn--knockdown"
          :class="{ 'amp-mobile-controls__knockdown-btn--pressed': knockdownPressed }"
          :aria-label="labels.knockdown"
          :disabled="disabled"
          data-test="knockdown-test-mobile"
          @pointerdown.prevent="onKnockdownPointerDown"
          @pointerup.prevent="onKnockdownPointerUp"
          @pointercancel.prevent="onKnockdownPointerUp"
          @click.stop="onKnockdownClick"
        >
          <v-icon icon="ph-arrow-fat-down" size="22" />
        </button>
        <button
          type="button"
          class="amp-mobile-controls__action-btn amp-mobile-controls__orbit-btn amp-mobile-controls__orbit-btn--yaw-left"
          :class="{ 'amp-mobile-controls__action-btn--active': strafeDirection === 1 }"
          :aria-label="labels.strafeLeft"
          :disabled="disabled || stickDisabled"
          @pointerdown.prevent="onStrafeDown(1, $event)"
          @pointerup.prevent="onStrafeUp($event)"
          @pointercancel.prevent="onStrafeUp($event)"
          @pointerleave.prevent="onStrafeUp($event)"
        >
          <v-icon icon="ph-arrow-arc-left" size="22" />
        </button>
        <button
          type="button"
          class="amp-mobile-controls__action-btn amp-mobile-controls__orbit-btn amp-mobile-controls__orbit-btn--yaw-right"
          :class="{ 'amp-mobile-controls__action-btn--active': strafeDirection === -1 }"
          :aria-label="labels.strafeRight"
          :disabled="disabled || stickDisabled"
          @pointerdown.prevent="onStrafeDown(-1, $event)"
          @pointerup.prevent="onStrafeUp($event)"
          @pointercancel.prevent="onStrafeUp($event)"
          @pointerleave.prevent="onStrafeUp($event)"
        >
          <v-icon icon="ph-arrow-arc-right" size="22" />
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import {
  AMP_JOYSTICK_PROFILE,
  computeAmpCommandFromJoystick,
  stickVisualFromAmpCommand
} from '@/utils/ampJoystickCommand.js';

/** Brief pressed highlight when knockdown is triggered from keyboard. */
const KNOCKDOWN_PULSE_MS = 180;

export default {
  name: 'AmpMobileJoystick',
  props: {
    disabled: {
      type: Boolean,
      default: false
    },
    /** When true, sit above the docked mobile control panel. */
    dockAboveMobilePanel: {
      type: Boolean,
      default: false
    },
    labels: {
      type: Object,
      required: true
    },
    cmdX: {
      type: Number,
      default: 0
    },
    cmdY: {
      type: Number,
      default: 0
    },
    cmdYaw: {
      type: Number,
      default: 0
    },
    /** Speed / limit table for the stick math (AMP by default, Microduck passes its own). */
    profile: {
      type: Object,
      default: () => AMP_JOYSTICK_PROFILE
    },
    /** AMP-only knockdown test button. */
    showKnockdown: {
      type: Boolean,
      default: true
    },
    /** Dim the stick when the active policy takes no velocity command. */
    stickDisabled: {
      type: Boolean,
      default: false
    },
    /** Optional state-machine buttons beside the stick: { value, icon, label, active }. */
    stateButtons: {
      type: Array,
      default: () => []
    }
  },
  emits: ['command', 'knockdown', 'state'],
  data: () => ({
    moveNormX: 0,
    moveNormY: 0,
    strafeDirection: 0,
    movePointerId: null,
    knockdownPressed: false,
    strafePointerActive: false,
    knobOffsetX: 0,
    knobOffsetY: 0,
    maxRadius: 1
  }),
  computed: {
    hasStateButtons() {
      return this.stateButtons.length > 0;
    },
    knobStyle() {
      return {
        transform: `translate(calc(-50% + ${this.knobOffsetX}px), calc(-50% + ${this.knobOffsetY}px))`
      };
    }
  },
  watch: {
    cmdX: 'syncVisualFromCommand',
    cmdY: 'syncVisualFromCommand',
    cmdYaw: 'syncVisualFromCommand'
  },
  mounted() {
    this.measureBase();
    this.syncVisualFromCommand();
    this._onResize = () => this.measureBase();
    window.addEventListener('resize', this._onResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this._onResize);
    this.clearKnockdownPulse();
    this.releaseMovePointer();
  },
  methods: {
    measureBase() {
      const base = this.$refs.moveBase;
      if (!base) {
        return;
      }
      const rect = base.getBoundingClientRect();
      this.maxRadius = Math.max(24, (Math.min(rect.width, rect.height) - 44) / 2);
      this.syncVisualFromCommand();
    },
    syncVisualFromCommand() {
      const { normX, normY, yawDirection: strafeDirection } = stickVisualFromAmpCommand(
        this.cmdX,
        this.cmdY,
        this.cmdYaw,
        this.profile
      );
      if (this.movePointerId === null) {
        this.moveNormX = normX;
        this.moveNormY = normY;
        this.knobOffsetX = normX * this.maxRadius;
        this.knobOffsetY = -normY * this.maxRadius;
      }
      if (!this.strafePointerActive) {
        this.strafeDirection = strafeDirection;
      }
    },
    emitCommand() {
      if (this.disabled || this.stickDisabled) {
        return;
      }
      const { cmdX, cmdY, cmdYaw } = computeAmpCommandFromJoystick(
        this.moveNormX,
        this.moveNormY,
        this.strafeDirection,
        false,
        true,
        this.profile
      );
      this.$emit('command', { cmdX, cmdY, cmdYaw });
    },
    emitZero() {
      this.$emit('command', { cmdX: 0, cmdY: 0, cmdYaw: 0 });
    },
    onKnockdownPointerDown() {
      if (this.disabled) {
        return;
      }
      this.knockdownPressed = true;
    },
    onKnockdownPointerUp() {
      this.knockdownPressed = false;
    },
    clearKnockdownPulse() {
      if (this._knockdownPulseTimer != null) {
        clearTimeout(this._knockdownPulseTimer);
        this._knockdownPulseTimer = null;
      }
    },
    /** Visual feedback when knockdown is triggered via PC keyboard (Enter). */
    pulseKnockdown() {
      if (this.disabled) {
        return;
      }
      this.knockdownPressed = true;
      this.clearKnockdownPulse();
      this._knockdownPulseTimer = window.setTimeout(() => {
        this.knockdownPressed = false;
        this._knockdownPulseTimer = null;
      }, KNOCKDOWN_PULSE_MS);
    },
    onKnockdownClick() {
      if (this.disabled) {
        return;
      }
      this.$emit('knockdown');
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
      this.emitCommand();
    },
    onMoveDown(event) {
      if (this.disabled || this.stickDisabled) {
        return;
      }
      this.measureBase();
      this.movePointerId = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      this.updateMoveFromClient(event.clientX, event.clientY);
    },
    onMoveMove(event) {
      if (this.disabled || this.stickDisabled || this.movePointerId !== event.pointerId) {
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
      this.emitCommand();
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
    },
    onStrafeDown(direction, event) {
      if (this.disabled || this.stickDisabled) {
        return;
      }
      this.strafePointerActive = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      this.strafeDirection = direction;
      this.emitCommand();
    },
    onStrafeUp(event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      this.strafePointerActive = false;
      this.strafeDirection = 0;
      this.emitCommand();
    }
  }
};
</script>

<style scoped>
.amp-mobile-controls {
  --amp-mobile-glass: rgba(var(--v-theme-on-surface), 0.12);
  --amp-mobile-glass-border: rgba(var(--v-theme-on-surface), 0.16);
  --amp-mobile-glass-active: rgba(var(--v-theme-primary), 0.22);
  --amp-mobile-knockdown: rgba(var(--v-theme-secondary), 0.24);
  --amp-stick-size: 128px;
  --amp-btn-size: 48px;
  --amp-state-btn-size: 40px;
  /* Keep the state column clear of the strafe buttons orbiting the stick. */
  --amp-state-offset: calc(
    var(--amp-stick-size) / 2 + var(--amp-orbit-radius) + var(--amp-btn-size) / 2 + 10px
  );
  --amp-orbit-radius: calc(var(--amp-stick-size) / 2 + var(--amp-btn-size) / 2 + 14px);

  position: fixed;
  right: 16px;
  z-index: var(--z-dock);
  bottom: calc(16px + constant(safe-area-inset-bottom) + var(--vvp-offset-bottom, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px) + var(--vvp-offset-bottom, 0px));
  touch-action: none;
  user-select: none;
  pointer-events: auto;
}

.amp-mobile-controls--disabled {
  opacity: 0.45;
  pointer-events: none;
}

.amp-mobile-controls--dock-panel {
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

.amp-mobile-controls__pad {
  position: relative;
  width: calc(var(--amp-stick-size) + var(--amp-orbit-radius) + var(--amp-btn-size) / 2);
  height: calc(var(--amp-stick-size) + var(--amp-orbit-radius) * 0.52);
}

.amp-mobile-controls__pad--with-states {
  width: calc(var(--amp-state-offset) + var(--amp-state-btn-size) * 2 + 8px);
}

/* State-machine buttons sit left of the stick, clear of the strafe orbit. */
.amp-mobile-controls__state-grid {
  position: absolute;
  right: var(--amp-state-offset);
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(2, var(--amp-state-btn-size));
  gap: 8px;
  z-index: 3;
}

.amp-mobile-controls__state-btn {
  width: var(--amp-state-btn-size);
  height: var(--amp-state-btn-size);
}

.amp-mobile-controls__stick-base {
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--amp-stick-size);
  height: var(--amp-stick-size);
  border-radius: 50%;
  border: 1px solid var(--amp-mobile-glass-border);
  background: var(--amp-mobile-glass);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  touch-action: none;
  z-index: 1;
}

.amp-mobile-controls__stick-base--disabled {
  opacity: 0.4;
  pointer-events: none;
}

.amp-mobile-controls__orbit-anchor {
  position: absolute;
  right: calc(var(--amp-stick-size) / 2);
  bottom: calc(var(--amp-stick-size) / 2);
  width: 0;
  height: 0;
  z-index: 2;
}

.amp-mobile-controls__stick-base::before {
  content: '';
  position: absolute;
  inset: 22%;
  border-radius: 50%;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  pointer-events: none;
}

.amp-mobile-controls__stick-knob {
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

/* 0deg = 12 o'clock; CCW: 10:30 -45deg, 9:30 -75deg, 8:30 -105deg */
.amp-mobile-controls__orbit-btn {
  --orbit-deg: 0deg;
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%) rotate(var(--orbit-deg))
    translateY(calc(-1 * var(--amp-orbit-radius))) rotate(calc(-1 * var(--orbit-deg)));
}

.amp-mobile-controls__orbit-btn--knockdown {
  --orbit-deg: -45deg;
}

.amp-mobile-controls__orbit-btn--yaw-left {
  --orbit-deg: -75deg;
}

.amp-mobile-controls__orbit-btn--yaw-right {
  --orbit-deg: -105deg;
}

.amp-mobile-controls__action-btn {
  width: var(--amp-btn-size);
  height: var(--amp-btn-size);
  border-radius: 50%;
  border: 1px solid var(--amp-mobile-glass-border);
  background: var(--amp-mobile-glass);
  color: rgb(var(--v-theme-on-surface));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background-color var(--transition), border-color var(--transition);
}

.amp-mobile-controls__action-btn:not(.amp-mobile-controls__knockdown-btn):active:not(:disabled),
.amp-mobile-controls__action-btn--active {
  background: var(--amp-mobile-glass-active);
  border-color: rgba(var(--v-theme-primary), 0.4);
}

.amp-mobile-controls__orbit-btn:disabled {
  opacity: 0.4;
}

.amp-mobile-controls__knockdown-btn {
  background: var(--amp-mobile-knockdown);
  border-color: rgba(var(--v-theme-secondary), 0.35);
  color: rgb(var(--v-theme-secondary));
}

.amp-mobile-controls__knockdown-btn--pressed:not(:disabled) {
  background: rgba(var(--v-theme-secondary), 0.38);
  border-color: rgba(var(--v-theme-secondary), 0.55);
}
</style>
