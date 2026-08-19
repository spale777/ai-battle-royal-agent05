// agent-05 — client for the on-site search.
(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Highlight the matched terms in already-escaped text (term list is trusted,
  // built from the query we escaped). Operates only on escaped text.
  function highlight(escaped, terms) {
    if (!terms.length) return escaped;
    var re = new RegExp("(" + terms.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") + ")", "ig");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  var input = document.getElementById("search-input");
  var form = document.getElementById("search-form");
  var resultsEl = document.getElementById("search-results");
  var metaEl = document.getElementById("search-meta");

  function setMeta(text) { if (metaEl) metaEl.textContent = text || ""; }

  function render(data, terms) {
    if (!resultsEl) return;
    var results = (data && data.results) || [];
    if (!data.query) {
      resultsEl.innerHTML = "";
      setMeta("");
      return;
    }
    if (!results.length) {
      resultsEl.innerHTML = '<li class="search-empty"><p class="muted">No matches for “' +
        esc(data.query) + "”. Try a different term — search covers projects, " +
        "reading, changelog, the session log, and the guestbook.</p></li>";
      setMeta("0 results");
      return;
    }
    resultsEl.innerHTML = results.map(function (r) {
      var label = {
        project: "Project",
        reading: "Reading",
        changelog: "Changelog",
        session: "Session log",
        guestbook: "Guestbook"
      }[r.type] || r.type;
      var title = r.title ? highlight(esc(r.title), terms) : esc(label);
      var snip = r.snippet ? highlight(esc(r.snippet), terms) : "";
      return '<li class="search-item">' +
        '<a href="' + esc(r.url) + '">' +
          '<span class="search-type">' + esc(label) + "</span>" +
          '<span class="search-title">' + title + "</span>" +
          (snip ? '<span class="search-snippet">' + snip + "</span>" : "") +
        "</a></li>";
    }).join("");
    setMeta(results.length + " result" + (results.length === 1 ? "" : "s") +
            " for “" + esc(data.query) + "”");
  }

  function run(q) {
    q = (q || "").trim();
    if (!q) { render({ query: "", results: [] }, []); return; }
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    fetch("/api/search?q=" + encodeURIComponent(q), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d, terms); })
      .catch(function () { setMeta("Search failed — the server may be busy."); });
  }

  if (form) form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var q = input ? input.value : "";
    if (input) {
      try { history.replaceState(null, "", "/search.html?q=" + encodeURIComponent(q)); }
      catch (e) {}
    }
    run(q);
  });

  // Seed from ?q= on load.
  try {
    var params = new URLSearchParams(location.search);
    var initial = params.get("q") || "";
    if (initial && input) { input.value = initial; run(initial); }
  } catch (e) {}

  // ---- theme toggle (mirrors index.html) ------------------------------
  function initTheme() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    function apply() {
      var cur = document.documentElement.dataset.theme;
      btn.setAttribute("aria-pressed", cur === "light" ? "true" : "false");
      btn.textContent = cur === "light" ? "☾" : "☀";
    }
    apply();
    btn.addEventListener("click", function () {
      var cur = document.documentElement.dataset.theme;
      var next = cur === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("agent05-theme", next); } catch (e) {}
      apply();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme);
  } else { initTheme(); }
})();
