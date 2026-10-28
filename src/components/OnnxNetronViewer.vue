<template>
  <div class="onnx-netron-viewer">
    <p v-if="!viewerUrl" class="text-caption text-medium-emphasis onnx-netron-empty">
      {{ emptyLabel }}
    </p>
    <template v-else>
      <div v-if="loading" class="onnx-netron-loading" role="status" :aria-label="loadingLabel">
        <v-progress-circular indeterminate color="primary" size="28" width="2" />
        <span class="onnx-netron-loading-text">{{ loadingLabel }}</span>
      </div>
      <iframe
        ref="frame"
        :key="viewerUrl"
        class="onnx-netron-frame"
        :class="{ 'onnx-netron-frame-ready': !loading }"
        :src="viewerUrl"
        :title="frameTitle"
        referrerpolicy="same-origin"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
        @load="onFrameLoad"
      />
    </template>
  </div>
</template>

<script>
import { buildNetronViewerUrl } from '@/utils/resolveModelAssetUrl.js';

const READY_POLL_MS = 200;
const READY_TIMEOUT_MS = 45000;

export default {
  name: 'OnnxNetronViewer',
  props: {
    modelPath: {
      type: String,
      default: ''
    },
    language: {
      type: String,
      default: 'zh'
    }
  },
  data: () => ({
    loading: true,
    readyPollTimer: null,
    readyTimeoutTimer: null
  }),
  computed: {
    viewerUrl() {
      return buildNetronViewerUrl(this.modelPath);
    },
    frameTitle() {
      return this.language === 'en' ? 'ONNX model architecture (Netron)' : 'ONNX 模型架构（Netron）';
    },
    emptyLabel() {
      return this.language === 'en'
        ? 'No ONNX model path is available yet.'
        : '尚未加载 ONNX 模型路径。';
    },
    loadingLabel() {
      return this.language === 'en'
        ? 'Loading ONNX graph in Netron…'
        : '正在 Netron 中加载 ONNX 计算图…';
    }
  },
  watch: {
    viewerUrl() {
      this.resetLoadingState();
    }
  },
  beforeUnmount() {
    this.clearReadyTimers();
  },
  methods: {
    resetLoadingState() {
      this.clearReadyTimers();
      this.loading = true;
    },
    clearReadyTimers() {
      if (this.readyPollTimer) {
        clearInterval(this.readyPollTimer);
        this.readyPollTimer = null;
      }
      if (this.readyTimeoutTimer) {
        clearTimeout(this.readyTimeoutTimer);
        this.readyTimeoutTimer = null;
      }
    },
    isNetronReady(frameEl) {
      try {
        const doc = frameEl?.contentDocument;
        if (!doc?.body) {
          return false;
        }
        if (doc.body.classList.contains('default')) {
          return true;
        }
        return doc.querySelectorAll('.node').length > 0;
      } catch {
        return false;
      }
    },
    markReady(frameEl) {
      this.loading = false;
      this.clearReadyTimers();
      try {
        frameEl?.contentWindow?.dispatchEvent(new Event('resize'));
      } catch {
        // ignore cross-origin resize failures
      }
    },
    onFrameLoad() {
      const frameEl = this.$refs.frame;
      if (!frameEl) {
        return;
      }
      this.resetLoadingState();
      if (this.isNetronReady(frameEl)) {
        this.markReady(frameEl);
        return;
      }
      this.readyPollTimer = setInterval(() => {
        if (this.isNetronReady(frameEl)) {
          this.markReady(frameEl);
        }
      }, READY_POLL_MS);
      this.readyTimeoutTimer = setTimeout(() => {
        this.loading = false;
        this.clearReadyTimers();
      }, READY_TIMEOUT_MS);
    }
  }
};
</script>

<style scoped>
.onnx-netron-viewer {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.onnx-netron-empty {
  padding: 12px 4px;
}

.onnx-netron-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 10px;
  background: rgba(24, 24, 24, 0.92);
  color: var(--viz-ink);
}

.onnx-netron-loading-text {
  font-size: 0.75rem;
}

.onnx-netron-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 10px;
  background: #ffffff;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition);
}

.onnx-netron-frame-ready {
  opacity: 1;
  pointer-events: auto;
}
</style>
