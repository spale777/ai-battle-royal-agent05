// agent-05 — generalized Langton's Ant (client-side, no backend).
// One ant on a toroidal square grid. Each tick it:
//   reads the colour c of the cell it stands on,
//   turns left/right according to rule[c],
//   flips the cell to (c+1) mod k,
//   steps forward one cell.
// From that trivial rule, after ~10,000 steps the classic "RL" ant spontaneously
// builds a diagonal highway and escapes forever. Other rule strings (RLR, LLRR,
// RRLL, ...) produce chaotic growth, square spirals, or symmetric blooms.
// Langton 1986; the k-colour generalisation is due to Buxhorn / Gale.
(function () {
  "use strict";

  var canvas = document.getElementById("ant");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var playBtn = document.getElementById("play");
  var stepBtn = document.getElementById("step");
  var resetBtn = document.getElementById("reset");
  var shareBtn = document.getElementById("share");

  var speedEl = document.getElementById("speed");
  var cellEl = document.getElementById("cell");
  var antsEl = document.getElementById("ants");
  var ruleEl = document.getElementById("rule");
  var speedVal = document.getElementById("speed-val");
  var cellVal = document.getElementById("cell-val");
  var antsVal = document.getElementById("ants-val");

  // Theme colours, refreshed periodically so the background stays on-palette.
  var bgColor = "#0e1116";
  var markerColor = "#ff4d6d";
  function refreshTheme() {
    try {
      var cs = getComputedStyle(document.documentElement);
      bgColor = (cs.getPropertyValue("--bg") || "").trim() || bgColor;
      markerColor = (cs.getPropertyValue("--accent") || "").trim() || markerColor;
    } catch (e) { /* keep last known */ }
  }

  // Palette for colour states 1..k-1 (state 0 is the empty background).
  function stateColor(c) {
    if (c === 0) return bgColor;
    // Vivid, evenly spaced hues so each rule colour reads distinctly.
    return "hsl(" + Math.round((c - 1) * (360 / Math.max(1, K - 1))) + ", 72%, 56%)";
  }

  var cols = 150, rows = 150, cell = 4, dpr = 1;
  var grid = null;        // Uint8Array, value = colour index 0..K-1
  var ants = [];          // {x, y, h} heading: 0=up,1=right,2=down,3=left
  var K = 2;              // number of colours = rule length
  var rule = "RL";        // "R"=turn right, "L"=turn left
  var steps = 0;
  var running = true;
  var timer = null;

  // ---- setup ----------------------------------------------------------
  function setupCanvas() {
    dpr = window.devicePixelRatio || 1;
    var size = 600;                       // logical square edge (px)
    cell = Math.max(2, parseInt(cellEl.value, 10));
    cols = Math.floor(size / cell);
    rows = cols;                          // square grid
    var px = cols * cell;
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    canvas.style.width = px + "px";
    canvas.style.height = px + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeAnts() {
    var n = Math.max(1, parseInt(antsEl.value, 10));
    var cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    ants = [];
    for (var i = 0; i < n; i++) {
      ants.push({
        x: cx, y: cy,
        // spread headings so multiple ants take different paths
        h: Math.round((i * 4) / n) % 4
      });
    }
  }

  function reset() {
    if (!parseRule(ruleEl.value)) return; // keep last valid rule if invalid
    setupCanvas();
    grid = new Uint8Array(cols * rows);   // all 0 == empty
    steps = 0;
    makeAnts();
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    drawAnts();
    updateReadout();
  }

  // ---- rule parsing ---------------------------------------------------
  function parseRule(s) {
    s = (s || "").toUpperCase().replace(/[^LR]/g, "");
    if (s.length < 1 || s.length > 16) return false;
    K = s.length;
    rule = s;
    return true;
  }

  // ---- simulation step ------------------------------------------------
  function stepOnce() {
    for (var a = 0; a < ants.length; a++) {
      var ant = ants[a];
      var idx = ant.y * cols + ant.x;
      var c = grid[idx];
      // turn according to the rule for colour c
      var turn = rule[c] === "R" ? 1 : 3;   // +1 right, +3 (==-1) left
      ant.h = (ant.h + turn) % 4;
      // flip the cell colour
      var nc = (c + 1) % K;
      grid[idx] = nc;
      // repaint the single changed cell (this also erases the old marker)
      paintCell(ant.x, ant.y, nc);
      // step forward, wrapping toroidally
      if (ant.h === 0) ant.y = (ant.y - 1 + rows) % rows;
      else if (ant.h === 1) ant.x = (ant.x + 1) % cols;
      else if (ant.h === 2) ant.y = (ant.y + 1) % rows;
      else ant.x = (ant.x - 1 + cols) % cols;
    }
    steps++;
  }

  function paintCell(x, y, c) {
    ctx.fillStyle = stateColor(c);
    ctx.fillRect(x * cell, y * cell, cell, cell);
  }

  function drawAnts() {
    ctx.fillStyle = markerColor;
    var m = Math.max(1, Math.floor(cell * 0.7));
    var off = Math.floor((cell - m) / 2);
    for (var a = 0; a < ants.length; a++) {
      var ant = ants[a];
      ctx.fillRect(ant.x * cell + off, ant.y * cell + off, m, m);
    }
  }

  // ---- loop -----------------------------------------------------------
  function frame() {
    if (!running || !grid) return;
    var n = Math.max(1, parseInt(speedEl.value, 10));
    for (var i = 0; i < n; i++) stepOnce();
    drawAnts();
    updateReadout();
    timer = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    playBtn.textContent = "⏸ Pause";
    playBtn.setAttribute("aria-pressed", "true");
    timer = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    playBtn.textContent = "▶ Play";
    playBtn.setAttribute("aria-pressed", "false");
    if (timer) cancelAnimationFrame(timer);
    timer = null;
    drawAnts();
  }

  function updateReadout() {
    readout.textContent =
      "rule " + rule + " · colours " + K +
      " · ants " + ants.length +
      " · step " + steps.toLocaleString() +
      (running ? " · running" : " · paused");
  }

  function flash(text) {
    msg.textContent = text;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { msg.textContent = ""; }, 2200);
  }

  // ---- share link -----------------------------------------------------
  function currentParams() {
    return {
      r: ruleEl.value,
      s: parseInt(speedEl.value, 10),
      c: parseInt(cellEl.value, 10),
      a: parseInt(antsEl.value, 10)
    };
  }
  function applyParams(p) {
    if (p.r != null) ruleEl.value = p.r;
    if (p.s != null) speedEl.value = p.s;
    if (p.c != null) cellEl.value = p.c;
    if (p.a != null) antsEl.value = p.a;
    syncLabels();
  }
  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return;
    try {
      var p = new URLSearchParams(h);
      applyParams({
        r: p.get("r"),
        s: parseInt(p.get("s"), 10),
        c: parseInt(p.get("c"), 10),
        a: parseInt(p.get("a"), 10)
      });
    } catch (e) { /* ignore */ }
  }
  function share() {
    var p = currentParams();
    var h = "#r=" + encodeURIComponent(p.r) + "&s=" + p.s + "&c=" + p.c + "&a=" + p.a;
    history.replaceState(null, "", h);
    var url = location.origin + location.pathname + h;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link (parameters) copied to clipboard"); },
        function () { flash("Link set in the URL bar (copy blocked)"); }
      );
    } else {
      flash("Link set in the URL bar");
    }
  }

  function syncLabels() {
    speedVal.textContent = speedEl.value;
    cellVal.textContent = cellEl.value;
    antsVal.textContent = antsEl.value;
  }

  // ---- wiring ---------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  stepBtn.addEventListener("click", function () {
    if (running) stop();
    stepOnce();
    drawAnts();
    updateReadout();
    flash("Stepped once (step " + steps.toLocaleString() + ")");
  });
  resetBtn.addEventListener("click", function () {
    reset();
    flash("Reset");
  });
  shareBtn.addEventListener("click", share);

  [speedEl, cellEl, antsEl].forEach(function (el) {
    el.addEventListener("input", function () {
      syncLabels();
      if (el === cellEl || el === antsEl) reset();
    });
  });
  ruleEl.addEventListener("change", function () {
    if (parseRule(ruleEl.value)) {
      reset();
      flash("Rule set: " + rule + " (" + K + " colours)");
    } else {
      ruleEl.value = rule;
      flash("Rule must use only L/R, 1–16 letters");
    }
  });

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      ruleEl.value = btn.dataset.rule;
      if (parseRule(ruleEl.value)) {
        reset();
        if (!running) start();
        flash("Rule: " + rule + " (" + btn.textContent + ")");
      }
    });
  });

  window.addEventListener("resize", function () {
    // Canvas is fixed-size; just keep the marker current (no re-layout needed).
    if (!running) drawAnts();
  });

  // ---- boot -----------------------------------------------------------
  refreshTheme();
  setInterval(refreshTheme, 1500);
  restoreFromHash();
  if (!parseRule(ruleEl.value)) ruleEl.value = "RL";
  syncLabels();
  reset();
  start();
})();
