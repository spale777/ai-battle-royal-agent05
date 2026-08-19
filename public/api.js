// agent-05 — renders the self-describing API manifest from /api.json.
(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var manifest = null;

  function renderMeta(m) {
    var el = document.getElementById("api-meta");
    if (!el || !m) return;
    function num(n) { return n == null ? "—" : esc(n); }
    el.innerHTML =
      '<div class="stat-grid">' +
        stat("Site", '<a href="' + esc(m.site) + '">' + esc(m.site) + "</a>") +
        stat("Version", num(m.version)) +
        stat("Commit", num(m.commit ? m.commit.slice(0, 8) : null)) +
        stat("Endpoints", num((m.endpoints || []).length)) +
      "</div>" +
      '<p class="muted">Manifest generated ' +
        (m.generated_epoch ? new Date(m.generated_epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—") +
        ' · full docs at <a href="' + esc(m.docs || "/api.html") + '">' + esc(m.docs || "/api.html") + "</a></p>";
  }

  function stat(k, v) {
    return '<div class="stat"><span class="v">' + v + '</span><span class="k">' + k + "</span></div>";
  }

  function methodClass(method) {
    return method === "POST" ? "post" : "get";
  }

  function renderList(m) {
    var el = document.getElementById("api-list");
    if (!el || !m) return;
    var eps = m.endpoints || [];
    if (!eps.length) { el.innerHTML = '<li><p class="muted">No endpoints listed.</p></li>'; return; }
    el.innerHTML = eps.map(function (e) {
      var methods = (e.methods || []).map(function (mt) {
        return '<span class="method ' + methodClass(mt) + '">' + esc(mt) + "</span>";
      }).join(" ");
      var auth = e.auth ? esc(e.auth) : "none";
      return '<li class="api-item">' +
        '<div class="api-item-head">' +
          '<code class="api-path">' + esc(e.path) + "</code>" +
          '<span class="api-methods">' + methods + "</span>" +
          '<span class="api-auth">auth: ' + auth + "</span>" +
        "</div>" +
        "<p class=\"api-summary\">" + esc(e.summary || "") + "</p>" +
      "</li>";
    }).join("");
  }

  function fillTrySelect(m) {
    var sel = document.getElementById("try-endpoint");
    if (!sel || !m) return;
    var gets = (m.endpoints || []).filter(function (e) {
      return (e.methods || []).indexOf("GET") !== -1;
    });
    sel.innerHTML = gets.map(function (e) {
      return '<option value="' + esc(e.path) + '">' + esc(e.path) + "</option>";
    }).join("");
  }

  function truncate(obj) {
    var s = JSON.stringify(obj, null, 2);
    var LIMIT = 4000;
    if (s.length > LIMIT) {
      s = s.slice(0, LIMIT) + "\n… (" + (s.length - LIMIT) + " more chars truncated)";
    }
    return s;
  }

  function bindTry() {
    var form = document.getElementById("try-form");
    var sel = document.getElementById("try-endpoint");
    var out = document.getElementById("try-out");
    if (!form || !sel || !out) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var path = sel.value;
      if (!path) return;
      out.textContent = "→ GET " + path + "\n…";
      fetch(path, { cache: "no-store" }).then(function (r) {
        return r.text().then(function (txt) {
          var pretty = txt;
          try { pretty = truncate(JSON.parse(txt)); } catch (e) { /* leave raw */ }
          out.textContent = "← " + r.status + " " + r.statusText + "\n" + pretty;
        });
      }).catch(function (err) {
        out.textContent = "✗ request failed: " + err;
      });
    });
  }

  function load() {
    fetch("/api.json", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (m) {
        manifest = m;
        renderMeta(m);
        renderList(m);
        fillTrySelect(m);
        bindTry();
      }).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else { load(); }
})();
