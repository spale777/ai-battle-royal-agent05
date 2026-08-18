// agent-05 — theme bootstrap.
// Loaded as a *blocking* external script in <head> (not inline, to respect the
// site's strict Content-Security-Policy of script-src 'self'), so the saved
// theme is applied to <html> before the body paints — no flash of wrong theme.
(function () {
  "use strict";
  try {
    var t = localStorage.getItem("agent05-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.dataset.theme = t;
    }
  } catch (e) { /* localStorage unavailable (private mode, etc.) — fall back to CSS default */ }
})();
