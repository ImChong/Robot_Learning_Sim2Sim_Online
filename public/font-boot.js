// Google Fonts load as a non-blocking stylesheet (media="print") and switch to
// "all" once downloaded. This used to be an inline onload="" handler, which the
// CSP (script-src without 'unsafe-inline') blocks, so the fonts never applied.
(function () {
  var link = document.getElementById('google-fonts');
  if (!link) {
    return;
  }
  function enable() {
    link.media = 'all';
  }
  // The stylesheet may already have loaded before this deferred script runs.
  if (link.sheet) {
    enable();
  } else {
    link.addEventListener('load', enable);
  }
})();
