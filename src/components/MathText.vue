<template>
  <!-- Plain text is escaped by renderMathText; KaTeX runs with trust: false. -->
  <component :is="tag" v-if="html" class="math-text" v-html="html" />
  <component :is="tag" v-else class="math-text">{{ plain }}</component>
</template>

<script>
import { katexState, loadKatex } from '@/utils/katexLoader.js';
import { hasMath, mathTextToPlain, renderMathText } from '@/utils/mathText.js';

// Graph nodes re-render on every telemetry refresh and remount on tab
// switches; the formulas themselves rarely change.
const htmlCache = new Map();
const HTML_CACHE_LIMIT = 200;

function cachedHtml(text, katex) {
  let html = htmlCache.get(text);
  if (html === undefined) {
    html = renderMathText(text, katex);
    if (htmlCache.size >= HTML_CACHE_LIMIT) {
      htmlCache.delete(htmlCache.keys().next().value);
    }
    htmlCache.set(text, html);
  }
  return html;
}

/**
 * Text with inline LaTeX (`$…$`) rendered by KaTeX. Until KaTeX has loaded,
 * or if it fails to, the formula shows as readable plain text.
 */
export default {
  name: 'MathText',
  props: {
    text: {
      type: String,
      default: ''
    },
    tag: {
      type: String,
      default: 'span'
    }
  },
  computed: {
    containsMath() {
      return hasMath(this.text);
    },
    html() {
      const katex = katexState.katex;
      if (!this.containsMath || !katex) {
        return '';
      }
      return cachedHtml(this.text, katex);
    },
    plain() {
      return this.containsMath ? mathTextToPlain(this.text) : this.text;
    }
  },
  watch: {
    containsMath: {
      immediate: true,
      handler(containsMath) {
        if (containsMath) {
          loadKatex();
        }
      }
    }
  }
};
</script>

<style scoped>
/* KaTeX defaults to 1.21em, which towers over small captions and node labels. */
.math-text :deep(.katex) {
  font-size: 1.06em;
}
</style>
