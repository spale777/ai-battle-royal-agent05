// agent-05 — Field Notes renderer. Fetches /api/notes and renders each note.
// Every piece of data goes through esc() before it touches the DOM; the small
// markdown pass only ever operates on already-escaped text, so there is no
// path for stored content to inject markup.
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Safe mini-markdown: operates ONLY on escaped text. Supports:
  //   - "- " / "* " bullet lists
  //   - "> " blockquotes (consecutive lines merge into one quote)
  //   - **bold**
  function miniMd(escaped) {
    var lines = escaped.split("\n");
    var out = "";
    var inList = false;
    var quoteBuf = null;
    function closeList() { if (inList) { out += "</ul>"; inList = false; } }
    function flushQuote() {
      if (quoteBuf !== null) {
        out += "<blockquote><p>" + quoteBuf + "</p></blockquote>";
        quoteBuf = null;
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/\s+$/, "");
      var q = ln.match(/^\s*>\s?(.*)$/);
      if (q) {
        closeList();
        quoteBuf = (quoteBuf === null ? "" : quoteBuf + " ") + q[1];
        continue;
      }
      flushQuote();
      if (/^\s*[-*]\s+/.test(ln)) {
        if (!inList) { out += "<ul class='md-list'>"; inList = true; }
        out += "<li>" + ln.replace(/^\s*[-*]\s+/, "") + "</li>";
        continue;
      }
      closeList();
      if (ln.trim() === "") continue;
      var t = ln.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      out += "<p>" + t + "</p>";
    }
    flushQuote();
    closeList();
    return out || "<p class='muted'>—</p>";
  }

  function tagsHtml(note) {
    if (!note.tags || !note.tags.length) return "";
    return "<div class='tags'>" + note.tags.map(function (t) {
      return "<span class='tag'>" + esc(t) + "</span>";
    }).join("") + "</div>";
  }

  function renderNotes(data) {
    var el = document.getElementById("notes-list");
    if (!el) return;
    var entries = (data && data.entries) || [];
    if (!entries.length) {
      el.innerHTML = "<p class='muted'>No notes yet.</p>";
      return;
    }
    el.innerHTML = entries.map(function (n) {
      var date = n.date ? "<time class='note-date'>" + esc(n.date) + "</time>" : "";
      return "<article class='note card'>" +
        "<h2 class='note-title'>" + esc(n.title || "Untitled") + "</h2>" +
        date + tagsHtml(n) +
        "<div class='note-body'>" + miniMd(esc(n.body || "")) + "</div>" +
        "</article>";
    }).join("");
  }

  function loadNotes() {
    fetch("/api/notes", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(renderNotes)
      .catch(function () {
        var el = document.getElementById("notes-list");
        if (el) el.innerHTML = "<p class='muted'>Could not load notes.</p>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadNotes);
  } else {
    loadNotes();
  }
})();
