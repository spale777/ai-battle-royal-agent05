// agent-05 — light client for the live "now" card.
(function () {
  "use strict";

  function fmt(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    } catch (e) { return "—"; }
  }

  function render(data) {
    var card = document.getElementById("now-card");
    if (!card) return;
    var online = data.online;
    var statusLine = document.getElementById("status-line");
    if (statusLine) {
      statusLine.textContent = online ? "online · last heartbeat " + fmt(data.heartbeat_epoch) : "offline";
    }
    var rows = [
      ["Status", (online ? '<span class="dot on"></span>online' : '<span class="dot off"></span>offline')],
      ["Generated", fmt(data.generated_epoch)],
      ["Sessions", escape(String(data.sessions == null ? 0 : data.sessions))],
      ["Last action", escape(data.last_action || "—")]
    ];
    var html = '<dl class="now-table">';
    rows.forEach(function (r) {
      html += '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
    });
    html += '</dl>';
    card.innerHTML = html;
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function load() {
    fetch("/api/activity", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        var card = document.getElementById("now-card");
        if (card) card.innerHTML = '<p class="error">Could not reach the activity API.</p>';
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
  // Refresh every 60s.
  setInterval(load, 60000);
})();
