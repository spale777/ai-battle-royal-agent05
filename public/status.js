// agent-05 — Diagnostics renderer.
// Fetches /api/selfcheck and renders the running server's own health report.
// Every piece of data goes through esc() before it touches the DOM, so there
// is no path for any stored/endpoint value to inject markup.
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtMs(ms) {
    if (ms == null) return "—";
    return (ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms");
  }

  function renderSummary(d) {
    var el = document.getElementById("diag-summary");
    if (!el) return;
    if (!d) {
      el.innerHTML = "<p class='error'>The self-check endpoint did not respond.</p>";
      return;
    }
    var verdict = d.verdict === "ok" ? "all checks passing" : "degraded";
    var okClass = d.verdict === "ok" ? "on" : "off";
    var when = d.generated_epoch
      ? new Date(d.generated_epoch * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
      : "";
    el.innerHTML =
      "<div class='diag-head'>" +
        "<span class='dot " + okClass + "'></span>" +
        "<span class='diag-verdict'>" + esc(verdict) + "</span>" +
        "<span class='diag-pct'>checked " + esc(d.checked) + " endpoints" +
          (d.failures ? ", " + esc(d.failures) + " failing" : "") + "</span>" +
      "</div>" +
      "<div class='diag-meta'>" +
        "<span>server <code>" + esc(d.server || "—") + "</code></span>" +
        "<span>version <code>v" + esc(d.version || "?") + "</code></span>" +
        "<span>commit <code>" + esc((d.commit || "").slice(0, 8) || "unknown") + "</code></span>" +
        "<span>worst latency <code>" + esc(fmtMs(d.worst_ms)) + "</code></span>" +
        (when ? "<span>run at <code>" + esc(when) + "</code></span>" : "") +
      "</div>";
    var whenEl = document.getElementById("diag-when");
    if (whenEl) whenEl.textContent = when ? "last run " + when : "";
  }

  function renderRows(d) {
    var tbody = document.getElementById("diag-rows");
    if (!tbody) return;
    if (!d || !d.results || !d.results.length) {
      tbody.innerHTML = "<tr><td colspan='4'><p class='error'>No endpoint results.</p></td></tr>";
      return;
    }
    tbody.innerHTML = d.results.map(function (r) {
      var statusTxt = r.status ? String(r.status) : "ERR";
      var cls = r.ok ? "ok" : "bad";
      return "<tr class='" + cls + "'>" +
        "<td class='mono'>" + esc(r.path) + "</td>" +
        "<td>" + esc(r.label || "") + "</td>" +
        "<td class='num'><span class='badge " + cls + "'>" + esc(statusTxt) + "</span></td>" +
        "<td class='num mono'>" + esc(fmtMs(r.ms)) + "</td>" +
      "</tr>";
    }).join("");
  }

  function loadCheck() {
    var summary = document.getElementById("diag-summary");
    var rows = document.getElementById("diag-rows");
    if (summary) summary.innerHTML = "<p class='loading'>Running self-check…</p>";
    if (rows) rows.innerHTML = "<tr><td colspan='4'><p class='loading'>Probing endpoints…</p></td></tr>";
    fetch("/api/selfcheck", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        renderSummary(d);
        renderRows(d);
      })
      .catch(function () {
        if (summary) summary.innerHTML = "<p class='error'>Could not reach the self-check endpoint.</p>";
        if (rows) rows.innerHTML = "<tr><td colspan='4'><p class='error'>Self-check failed.</p></td></tr>";
      });
  }

  function init() {
    var btn = document.getElementById("diag-refresh");
    if (btn) btn.addEventListener("click", loadCheck);
    loadCheck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
