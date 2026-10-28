/**
 * UI strings carry formulas as LaTeX between `$…$` (inline) or `$$…$$`
 * (display), e.g. 'clip to $\pm 10$'. These helpers split such strings, render
 * them with KaTeX and give a plain-text fallback for places that cannot hold
 * markup (title attributes, the moment before KaTeX has loaded).
 */

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/**
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'math', value: string, display?: boolean }>}
 */
export function splitMathSegments(text) {
  const source = String(text ?? '');
  const segments = [];
  let last = 0;
  for (const match of source.matchAll(MATH_PATTERN)) {
    if (match.index > last) {
      segments.push({ type: 'text', value: source.slice(last, match.index) });
    }
    const display = match[1] !== undefined;
    segments.push({ type: 'math', value: (display ? match[1] : match[2]).trim(), display });
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    segments.push({ type: 'text', value: source.slice(last) });
  }
  return segments;
}

export function hasMath(text) {
  return splitMathSegments(text).some((segment) => segment.type === 'math');
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

// Only the commands the UI formulas use; anything else falls back to its name.
const PLAIN_SYMBOLS = {
  cdot: '·',
  times: '×',
  pm: '±',
  tau: 'τ',
  omega: 'ω',
  theta: 'θ',
  pi: 'π',
  Delta: 'Δ',
  top: 'ᵀ',
  dots: '…',
  ldots: '…',
  to: '→',
  odot: '⊙'
};

/** Readable Unicode approximation of a LaTeX snippet, e.g. `q - q_0` → `q − q₀`. */
export function latexToPlain(latex) {
  return String(latex ?? '')
    .replace(/\\(?:operatorname|mathrm|text)\{([^}]*)\}/g, '$1')
    .replace(/\\dot\s*\{?([A-Za-z])\}?/g, '$1̇')
    .replace(/\\hat\s*\{?([A-Za-z])\}?/g, '$1̂')
    .replace(/\\([A-Za-z]+)/g, (whole, name) => PLAIN_SYMBOLS[name] ?? name)
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/_([0-9])/g, (whole, digit) => SUBSCRIPT_DIGITS[Number(digit)])
    .replace(/_\{([^}]*)\}/g, '_$1')
    .replace(/_([A-Za-z])/g, '$1')
    .replace(/\^\{([^}]*)\}/g, '^$1')
    .replace(/\^\*/g, '*')
    .replace(/\^ᵀ/g, 'ᵀ')
    .replace(/[{}]/g, '')
    .replace(/ - /g, ' − ');
}

/** The whole string with every formula replaced by its plain-text form. */
export function mathTextToPlain(text) {
  return splitMathSegments(text)
    .map((segment) => (segment.type === 'math' ? latexToPlain(segment.value) : segment.value))
    .join('');
}

/**
 * HTML for a string with formulas: text is escaped, formulas go through KaTeX
 * (passed in so this module stays free of the KaTeX bundle).
 * @param {string} text
 * @param {{ renderToString: Function }} katex
 */
export function renderMathText(text, katex) {
  return splitMathSegments(text)
    .map((segment) => {
      if (segment.type === 'text') {
        return escapeHtml(segment.value);
      }
      return katex.renderToString(segment.value, {
        displayMode: Boolean(segment.display),
        throwOnError: false
      });
    })
    .join('');
}
