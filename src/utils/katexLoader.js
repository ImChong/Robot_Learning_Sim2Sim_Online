import { shallowReactive } from 'vue';

/**
 * KaTeX (~270 KB plus fonts) is only needed once a formula is on screen, so it
 * is loaded on demand instead of growing the main bundle. Components read
 * `katexState.katex` and re-render when it arrives.
 */
export const katexState = shallowReactive({
  katex: null,
  failed: false
});

let loading = null;

export function loadKatex() {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([module]) => {
        katexState.katex = module.default ?? module;
        return katexState.katex;
      })
      .catch((error) => {
        // Formulas keep their plain-text fallback.
        console.warn('Failed to load KaTeX:', error);
        katexState.failed = true;
        return null;
      });
  }
  return loading;
}
