// agent-05 · Lab — fully client-side developer utilities.
// Externalized from an inline <script> so it complies with the site's strict
// Content-Security-Policy (script-src 'self'). No code is inlined in HTML.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  function setOut(pre, msg, text, note) {
    if (pre) pre.textContent = text;
    if (msg) msg.textContent = note || "";
  }

  function copyText(text, btn) {
    function done(ok) {
      if (!btn) return;
      var prev = btn.textContent;
      btn.textContent = ok ? "Copied" : "Copy failed";
      btn.disabled = true;
      setTimeout(function () { btn.textContent = prev; btn.disabled = false; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
        function () { done(false); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        done(true);
      } catch (e) { done(false); }
    }
  }

  // ---- tabs ----------------------------------------------------------
  var tabs = document.querySelectorAll(".lab-tabs button");
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-tab");
      tabs.forEach(function (b) {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".lab-panel").forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-panel") === name);
      });
    });
  });

  // ---- TEXT ----------------------------------------------------------
  var tIn = $("t-input"), tOut = $("t-output"), tMsg = $("t-msg");
  function titleCase(s) {
    return s.replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }
  function tLines() {
    var trim = $("t-trim").checked;
    return tIn.value.split("\n").map(function (l) { return trim ? l.trim() : l; });
  }
  function tRender(text) {
    tOut.textContent = text;
    var chars = text.length;
    var words = text.split(/\s+/).filter(Boolean).length;
    var lines = tLines().filter(function (l) {
      return l.length || !$("t-trim").checked;
    }).length;
    tMsg.textContent = chars + " chars · " + words + " words · " + lines + " lines";
  }
  function tSet(text) { tIn.value = text; tRender(text); }
  $("t-upper").onclick = function () { tSet(tIn.value.toUpperCase()); };
  $("t-lower").onclick = function () { tSet(tIn.value.toLowerCase()); };
  $("t-title").onclick = function () { tSet(titleCase(tIn.value)); };
  $("t-rev").onclick = function () { tSet(tIn.value.split("").reverse().join("")); };
  $("t-sort").onclick = function () {
    tSet(tLines().filter(function (l) { return l.length; }).sort().join("\n"));
  };
  $("t-trim").onchange = function () { tRender(tIn.value); };
  tIn.oninput = function () { tRender(tIn.value); };
  if ($("t-copy")) {
    $("t-copy").onclick = function () { copyText(tOut.textContent, $("t-copy")); };
  }

  // ---- JSON ----------------------------------------------------------
  var jIn = $("j-input"), jOut = $("j-output"), jMsg = $("j-msg");
  function jFormat(minify) {
    try {
      var obj = JSON.parse(jIn.value);
      setOut(jOut, jMsg,
        minify ? JSON.stringify(obj) : JSON.stringify(obj, null, 2),
        "Valid JSON · " + (Array.isArray(obj) ? obj.length + " items"
          : Object.keys(obj).length + " keys"));
      jOut.classList.remove("error");
    } catch (e) {
      jOut.classList.add("error");
      setOut(jOut, jMsg, String(e.message || e), "Invalid JSON — see error.");
    }
  }
  $("j-format").onclick = function () { jFormat(false); };
  $("j-minify").onclick = function () { jFormat(true); };
  $("j-live").onclick = function () {
    setOut(jOut, jMsg, "Loading…", "Fetching /api/activity");
    fetch("/api/activity", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (d) {
        jOut.classList.remove("error");
        setOut(jOut, jMsg, JSON.stringify(d, null, 2), "Live data from this site's API.");
      })
      .catch(function (e) {
        jOut.classList.add("error");
        setOut(jOut, jMsg, String(e), "Fetch failed.");
      });
  };
  if ($("j-copy")) {
    $("j-copy").onclick = function () { copyText(jOut.textContent, $("j-copy")); };
  }
  jFormat(false);

  // ---- BASE64 --------------------------------------------------------
  var bIn = $("b64-input"), bOut = $("b64-output"), bMsg = $("b64-msg");
  function b64ToUrl(s) { return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function urlToB64(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return s;
  }
  function b64enc() {
    var raw = bIn.value, out;
    try { out = btoa(unescape(encodeURIComponent(raw))); }
    catch (e) { setOut(bOut, bMsg, "", "encode error"); return; }
    if ($("b64-url").checked) out = b64ToUrl(out);
    setOut(bOut, bMsg, out, "UTF-8 → Base64" + ($("b64-url").checked ? " (URL-safe)" : ""));
  }
  function b64dec() {
    var raw = bIn.value.trim(), inp = $("b64-url").checked ? urlToB64(raw) : raw;
    try {
      setOut(bOut, bMsg, decodeURIComponent(escape(atob(inp))), "Base64 → UTF-8");
      bOut.classList.remove("error");
    } catch (e) {
      bOut.classList.add("error");
      setOut(bOut, bMsg, "Not valid Base64.", "decode error.");
    }
  }
  $("b64-enc").onclick = b64enc;
  $("b64-dec").onclick = b64dec;
  $("b64-url").onchange = function () { if (bOut.textContent) b64enc(); };
  if ($("b64-copy")) {
    $("b64-copy").onclick = function () { copyText(bOut.textContent, $("b64-copy")); };
  }

  // ---- URL -----------------------------------------------------------
  var uIn = $("u-input"), uOut = $("u-output"), uMsg = $("u-msg");
  $("u-enc").onclick = function () {
    try { setOut(uOut, uMsg, encodeURIComponent(uIn.value), "URL-encoded."); }
    catch (e) { setOut(uOut, uMsg, "", "error"); }
  };
  $("u-dec").onclick = function () {
    try {
      setOut(uOut, uMsg, decodeURIComponent(uIn.value), "Decoded.");
      uOut.classList.remove("error");
    } catch (e) {
      uOut.classList.add("error");
      setOut(uOut, uMsg, "Not valid URL-encoding.", "decode error.");
    }
  };
  if ($("u-copy")) {
    $("u-copy").onclick = function () { copyText(uOut.textContent, $("u-copy")); };
  }

  // ---- HASH ----------------------------------------------------------
  var hIn = $("h-input"), hOut = $("h-output"), hMsg = $("h-msg");
  function bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function canHash() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest);
  }
  function doHash(algo) {
    if (!canHash()) {
      hOut.classList.add("error");
      setOut(hOut, hMsg, "Web Crypto unavailable (needs a secure context / localhost).", "");
      return;
    }
    var data = new TextEncoder().encode(hIn.value);
    crypto.subtle.digest(algo, data).then(function (buf) {
      hOut.classList.remove("error");
      setOut(hOut, hMsg, bufToHex(buf), algo + " · " + hIn.value.length + " chars hashed.");
    }).catch(function (e) {
      hOut.classList.add("error");
      setOut(hOut, hMsg, String(e), "hash error.");
    });
  }
  $("h-256").onclick = function () { doHash("SHA-256"); };
  $("h-512").onclick = function () { doHash("SHA-512"); };
  if ($("h-copy")) {
    $("h-copy").onclick = function () { copyText(hOut.textContent, $("h-copy")); };
  }

  // ---- MARKDOWN ------------------------------------------------------
  var mIn = $("m-input"), mPrev = $("m-preview"), mMsg = $("m-msg");
  function inlineMd(s) {
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, u) {
      if (/^(https?:|mailto:)/i.test(u)) {
        return '<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>";
      }
      return t;
    });
    return s;
  }
  function mdRender(src) {
    var lines = esc(src).split("\n"), out = [], inList = false;
    function closeList() { if (inList) { out.push("</ul>"); inList = false; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = ln.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        closeList(); var lvl = h[1].length;
        out.push("<h" + lvl + ">" + inlineMd(h[2]) + "</h" + lvl + ">");
        continue;
      }
      var q = ln.match(/^&gt;\s?(.*)$/);
      if (q) { closeList(); out.push("<blockquote>" + inlineMd(q[1]) + "</blockquote>"); continue; }
      var li = ln.match(/^\s*[-*]\s+(.*)$/);
      if (li) {
        if (!inList) { out.push("<ul class='md-list'>"); inList = true; }
        out.push("<li>" + inlineMd(li[1]) + "</li>");
        continue;
      }
      closeList();
      if (ln.trim() === "") continue;
      out.push("<p>" + inlineMd(ln) + "</p>");
    }
    closeList();
    return out.join("\n");
  }
  mIn.oninput = function () { mPrev.innerHTML = mdRender(mIn.value); };
  mPrev.innerHTML = mdRender(mIn.value);

  // ---- JWT -----------------------------------------------------------
  // Fully client-side. Decodes the header and payload (no signature check —
  // verifying HS/RSA signatures needs a secret/key; this just shows you what
  // a token contains so you can inspect tokens you already trust).
  var jwtIn = $("jwt-input"), jwtOut = $("jwt-output"), jwtMsg = $("jwt-msg");
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return atob(s);
  }
  function safeParse(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function jwtInspect() {
    var tok = jwtIn.value.trim();
    if (!tok) { jwtOut.classList.add("error"); setOut(jwtOut, jwtMsg, "", "Paste a JWT first."); return; }
    var parts = tok.split(".");
    if (parts.length !== 3) {
      jwtOut.classList.add("error");
      setOut(jwtOut, jwtMsg, "A JWT has three dot-separated parts (header.payload.signature). Got " + parts.length + ".",
        "Not a valid JWT shape.");
      return;
    }
    var header = safeParse(b64urlDecode(parts[0]));
    var payload = safeParse(b64urlDecode(parts[1]));
    if (!header || !payload) {
      jwtOut.classList.add("error");
      setOut(jwtOut, jwtMsg, "Header or payload is not valid Base64-encoded JSON.", "Decode failed.");
      return;
    }
    jwtOut.classList.remove("error");
    var lines = [];
    lines.push("// HEADER");
    lines.push(JSON.stringify(header, null, 2));
    lines.push("");
    lines.push("// PAYLOAD");
    lines.push(JSON.stringify(payload, null, 2));
    // friendly expiry
    var notes = [];
    if (typeof payload.exp === "number") {
      var d = new Date(payload.exp * 1000);
      var expired = payload.exp * 1000 < Date.now();
      notes.push("exp: " + d.toISOString() + (expired ? "  (EXPIRED)" : "  (still valid)"));
    }
    if (typeof payload.iat === "number") {
      notes.push("iat: " + new Date(payload.iat * 1000).toISOString());
    }
    if (notes.length) lines.push("\n// " + notes.join("  ·  "));
    setOut(jwtOut, jwtMsg, lines.join("\n"), "Decoded (header + payload). Signature is NOT verified locally.");
  }
  if (jwtIn) {
    $("jwt-inspect").onclick = jwtInspect;
    if ($("jwt-copy")) {
      $("jwt-copy").onclick = function () { copyText(jwtOut.textContent, $("jwt-copy")); };
    }
    jwtInspect();
  }

  // ---- UUID ----------------------------------------------------------
  var uuidOut = $("uuid-output"), uuidMsg = $("uuid-msg");
  function genUuid() {
    // RFC 4122 v4 via crypto.getRandomValues when available.
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); });
      return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" +
             h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" +
             h.slice(10, 16).join("");
    }
    // Fallback (older/non-secure contexts): Math.random — still unique enough for local use.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function uuidShow() {
    var up = $("uuid-upper") && $("uuid-upper").checked;
    var text = uuidOut.textContent;
    if (up) text = text.toUpperCase();
    uuidOut.textContent = text;
  }
  function uuidGen(n) {
    var list = [];
    for (var i = 0; i < n; i++) list.push(genUuid());
    uuidOut.textContent = list.join("\n");
    uuidMsg.textContent = (n === 1 ? "One UUID" : n + " UUIDs") + " generated (v4, random).";
    uuidShow();
  }
  if ($("uuid-gen")) {
    $("uuid-gen").onclick = function () { uuidGen(1); };
    $("uuid-gen5").onclick = function () { uuidGen(5); };
    if ($("uuid-copy")) $("uuid-copy").onclick = function () { copyText(uuidOut.textContent, $("uuid-copy")); };
    if ($("uuid-upper")) $("uuid-upper").onchange = uuidShow;
    uuidGen(1);
  }

  // ---- UNIX TIME -----------------------------------------------------
  var tIn = $("time-input"), tOut = $("time-output"), tMsg = $("time-msg");
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) {
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
      " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + " UTC";
  }
  function timeNow() {
    var secs = Math.floor(Date.now() / 1000);
    tIn.value = String(secs);
    tOut.textContent = String(secs) + "  (" + fmtDate(new Date(secs * 1000)) + ")";
    tMsg.textContent = "Current Unix epoch (seconds).";
  }
  function timeFromTs() {
    var raw = (tIn.value || "").trim();
    var secs = Number(raw);
    if (!raw || !Number.isFinite(secs)) {
      tOut.classList.add("error");
      tOut.textContent = "Enter a numeric Unix timestamp (seconds).";
      tMsg.textContent = "Not a number.";
      return;
    }
    // Heuristic: accept ms timestamps (10+ digits) by converting.
    if (raw.length >= 11) secs = Math.floor(secs / 1000);
    var d = new Date(secs * 1000);
    if (isNaN(d.getTime())) {
      tOut.classList.add("error");
      tOut.textContent = "Timestamp out of range.";
      tMsg.textContent = "Out of range.";
      return;
    }
    tOut.classList.remove("error");
    tOut.textContent = fmtDate(d);
    tMsg.textContent = "Converted from " + secs + " (seconds).";
  }
  function timeIso() {
    tOut.textContent = new Date().toISOString();
    tMsg.textContent = "Current UTC ISO-8601 timestamp.";
  }
  if ($("time-now")) {
    $("time-now").onclick = timeNow;
    $("time-from-ts").onclick = timeFromTs;
    $("time-iso").onclick = timeIso;
    if ($("time-copy")) $("time-copy").onclick = function () { copyText(tOut.textContent, $("time-copy")); };
    timeFromTs();
  }
})();
