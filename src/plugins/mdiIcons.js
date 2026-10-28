/**
 * plugins/mdiIcons.js
 *
 * Material Design Icons used by the app, rendered as inline SVG paths instead of
 * the @mdi/font webfont (~400 KB font + ~320 KB CSS). Templates keep using the
 * `mdi-*` names; add new icons here (tests/mdiIcons.test.mjs checks coverage).
 */
import {
  mdiArrowDownBold,
  mdiArrowLeftBold,
  mdiArrowRightBold,
  mdiChartLineVariant,
  mdiClose,
  mdiFileDocumentOutline,
  mdiGithub,
  mdiGraph,
  mdiGraphOutline,
  mdiHumanMale,
  mdiLayersOutline,
  mdiPause,
  mdiPlay,
  mdiReplay,
  mdiRotate360,
  mdiSeatReclineNormal,
  mdiSitemapOutline,
  mdiUpload,
  mdiWalk,
} from '@mdi/js'

export const mdiIconPaths = {
  'mdi-arrow-down-bold': mdiArrowDownBold,
  'mdi-arrow-left-bold': mdiArrowLeftBold,
  'mdi-arrow-right-bold': mdiArrowRightBold,
  'mdi-chart-line-variant': mdiChartLineVariant,
  'mdi-close': mdiClose,
  'mdi-file-document-outline': mdiFileDocumentOutline,
  'mdi-github': mdiGithub,
  'mdi-graph': mdiGraph,
  'mdi-graph-outline': mdiGraphOutline,
  'mdi-human-male': mdiHumanMale,
  'mdi-layers-outline': mdiLayersOutline,
  'mdi-pause': mdiPause,
  'mdi-play': mdiPlay,
  'mdi-replay': mdiReplay,
  'mdi-rotate-360': mdiRotate360,
  'mdi-seat-recline-normal': mdiSeatReclineNormal,
  'mdi-sitemap-outline': mdiSitemapOutline,
  'mdi-upload': mdiUpload,
  'mdi-walk': mdiWalk,
}

/** Resolve an `mdi-*` name to its SVG path; other values (raw paths) pass through. */
export function resolveMdiIconPath(icon) {
  return mdiIconPaths[icon] ?? icon
}
