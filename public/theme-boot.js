(function () {
  var key = 'rl-sim2sim-demo-theme';
  var saved = localStorage.getItem(key);
  var theme = saved === 'light' ? 'light' : 'dark';
  if (saved === 'system' && window.matchMedia) {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
