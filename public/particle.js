// agent-05 — Particle Life (client-side, no backend).
// A handful of coloured particles with no goal and no rules except ONE shared
// square attraction matrix: matrix[i][j] is how much colour i is attracted to
// colour j (positive = pull, negative = push, 0 = ignore). Every tick each
// particle feels a force from every neighbour within r0, is damped by friction,
// and moves. From that single matrix and nothing else, cell-like clusters,
// chasing chains, and rotating clouds self-assemble, drift apart, and
// reassemble — "life-like" behaviour with no life in it (Clusters, by Jeffrey
// Ventrella; formalized by Gary William Flake, 2002).
//
// The force law follows Clusters/Particle Life convention:
//   r in [0, beta]      -> r/beta - 1          (strong repulsion when touching)
//   r in [beta, 1]      -> a * (1 - |2r-1-beta|/(1-beta))   (signed by matrix)
//   r > 1               -> 0                    (out of range, no force)
(function () {
  "use strict";

  var canvas = document.getElementById("particle");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var playBtn = document.getElementById("play");
  var resetBtn = document.getElementById("reset");
  var reseedBtn = document.getElementById("reseed");
  var randBtn = document.getElementById("randomize");
  var shareBtn = document.getElementById("share");
  var matrixBtn = document.getElementById("show-matrix");

  var countEl = document.getElementById("count");
  var colorsEl = document.getElementById("colors");
  var forceEl = document.getElementById("force");
  var fricEl = document.getElementById("friction");
  var speedEl = document.getElementById("speed");

  var countVal = document.getElementById("count-val");
  var colorsVal = document.getElementById("colors-val");
  var forceVal = document.getElementById("force-val");
  var fricVal = document.getElementById("friction-val");
  var speedVal = document.getElementById("speed-val");

  // ---- tunables -------------------------------------------------------
  var BETA = 0.3;          // fraction of r0 where the force flips to repulsion
  var VMAX = 3;            // per-step velocity clamp (keeps it from exploding)
  var MAX_COLOURS = 7;

  // Distinct, headlessly-validated matrices (see commit notes). Each is
  // Nc x Nc; generated from a small description so a single Nc works.
  function genCells(n) {
    var m = [];
    for (var i = 0; i < n; i++) { m[i] = []; for (var j = 0; j < n; j++) m[i][j] = (i === j) ? 1.0 : -0.6; }
    return m;
  }
  function genChasers(n) {
    var m = [];
    for (var i = 0; i < n; i++) { m[i] = []; for (var j = 0; j < n; j++) m[i][j] = (j === (i + 1) % n) ? 1.0 : (j === i ? 0.2 : -0.3); }
    return m;
  }
  function genPredator(n) {
    var m = [];
    for (var i = 0; i < n; i++) { m[i] = []; for (var j = 0; j < n; j++) {
      m[i][j] = (i === 0 && j !== 0) ? 0.9 : (i !== 0 && j === 0) ? -0.8 : (i === j ? 0.2 : -0.1); } }
    return m;
  }
  function genOrbit(n) {
    var m = [];
    for (var i = 0; i < n; i++) { m[i] = []; for (var j = 0; j < n; j++) {
      m[i][j] = 0.4 + 0.7 * Math.sin(((j - i + n) % n) * 2 * Math.PI / n); } }
    return m;
  }

  var PRESETS = {
    cells:   genCells,
    chasers: genChasers,
    predator: genPredator,
    orbit:   genOrbit
  };

  // Stable, reasonably distinct palette (works on both themes).
  var PALETTE = [
    "#ff5d73", "#46c2ff", "#ffd166", "#7be08a", "#c08cff", "#ff9e57", "#6ee0d0"
  ];

  var W = 720, H = 520, dpr = 1;
  var N = 360, Nc = 5;
  var xs = null, ys = null, vxs = null, vys = null, types = null;
  var matrix = [];
  var running = true, frame = 0;
  var mouse = { x: 0, y: 0, active: false, inside: false };
  var r0 = 60, FORCE = 60, FRICTION = 0.06, STEPS = 2;

  var bgColor = "#0e1116";
  var fgColor = "#e7edf3";
  function refreshTheme() {
    try {
      var cs = getComputedStyle(document.documentElement);
      bgColor = (cs.getPropertyValue("--bg") || "").trim() || bgColor;
      fgColor = (cs.getPropertyValue("--fg") || "").trim() || fgColor;
    } catch (e) { /* keep last known */ }
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- seeding --------------------------------------------------------
  function seed() {
    N = Math.max(2, Math.min(900, parseInt(countEl.value, 10) || 360));
    Nc = Math.max(2, Math.min(MAX_COLOURS, parseInt(colorsEl.value, 10) || 5));
    xs = new Float64Array(N); ys = new Float64Array(N);
    vxs = new Float64Array(N); vys = new Float64Array(N);
    types = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      xs[i] = Math.random() * W; ys[i] = Math.random() * H;
      vxs[i] = 0; vys[i] = 0;
      types[i] = i % Nc;
    }
    frame = 0;
  }

  function buildMatrixFrom(presetName) {
    if (PRESETS[presetName]) return PRESETS[presetName](Nc);
    return randomMatrix();
  }

  function randomMatrix() {
    var m = [];
    for (var i = 0; i < Nc; i++) { m[i] = []; for (var j = 0; j < Nc; j++) m[i][j] = +rand(-1, 1).toFixed(2); }
    return m;
  }

  function applyPreset(name, keepLayout) {
    if (!keepLayout) seed();
    Nc = Math.max(2, Math.min(MAX_COLOURS, parseInt(colorsEl.value, 10) || 5));
    matrix = buildMatrixFrom(name);
    renderMatrix();
  }

  // ---- parameters (live from sliders) ---------------------------------
  function readParams() {
    r0 = Math.max(10, parseInt(forceEl.value, 10) || 60);    // r0 = "Force (r0)"
    FRICTION = Math.max(0.005, (parseInt(fricEl.value, 10) || 6) / 100);
    STEPS = Math.max(1, parseInt(speedEl.value, 10) || 2);
    FORCE = r0; // scale force by r0 so larger range => stronger pull
  }

  // ---- the physics ----------------------------------------------------
  function forceFn(r, a) {
    if (r < BETA) return r / BETA - 1;
    if (r < 1) return a * (1 - Math.abs(2 * r - 1 - BETA) / (1 - BETA));
    return 0;
  }

  function step() {
    var i, j, ti;
    for (i = 0; i < N; i++) {
      var ax = 0, ay = 0, xi = xs[i], yi = ys[i]; ti = types[i];
      for (j = 0; j < N; j++) {
        if (j === i) continue;
        var dx = xs[j] - xi, dy = ys[j] - yi;
        var r = Math.sqrt(dx * dx + dy * dy);
        if (r > 0 && r < r0) {
          var f = forceFn(r / r0, matrix[ti][types[j]]);
          ax += (dx / r) * f; ay += (dy / r) * f;
        }
      }
      ax = ax / r0 * FORCE; ay = ay / r0 * FORCE;
      var vx = vxs[i] * (1 - FRICTION) + ax;
      var vy = vys[i] * (1 - FRICTION) + ay;
      var sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > VMAX) { vx = vx / sp * VMAX; vy = vy / sp * VMAX; }
      vxs[i] = vx; vys[i] = vy;
    }
    for (i = 0; i < N; i++) {
      xs[i] += vxs[i]; ys[i] += vys[i];
      // torus wrap so the world has no walls
      if (xs[i] < 0) xs[i] += W; else if (xs[i] >= W) xs[i] -= W;
      if (ys[i] < 0) ys[i] += H; else if (ys[i] >= H) ys[i] -= H;
    }
    frame++;
  }

  // ---- rendering ------------------------------------------------------
  function render() {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    var rad = 2.4;
    for (var i = 0; i < N; i++) {
      ctx.beginPath();
      ctx.fillStyle = PALETTE[types[i] % PALETTE.length];
      ctx.arc(xs[i], ys[i], rad, 0, Math.PI * 2);
      ctx.fill();
    }
    readout.textContent =
      "particles " + N +
      " · colours " + Nc +
      " · r0 " + r0 +
      " · friction " + FRICTION.toFixed(2) +
      " · steps/frame " + STEPS +
      (running ? " · running" : " · paused");
  }

  // ---- loop -----------------------------------------------------------
  var timer = null;
  function loop() {
    if (!running) return;
    for (var s = 0; s < STEPS; s++) step();
    render();
    timer = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    playBtn.textContent = "⏸ Pause";
    playBtn.setAttribute("aria-pressed", "true");
    timer = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    playBtn.textContent = "▶ Play";
    playBtn.setAttribute("aria-pressed", "false");
    if (timer) cancelAnimationFrame(timer);
    timer = null;
    render();
  }

  function flash(text) {
    msg.textContent = text;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { msg.textContent = ""; }, 2200);
  }

  // ---- share link -----------------------------------------------------
  function currentParams() {
    return {
      n: N, c: Nc,
      r: parseInt(forceEl.value, 10),
      f: parseInt(fricEl.value, 10),
      s: parseInt(speedEl.value, 10),
      m: matrix ? matrix.map(function (row) { return row.join(","); }).join(";") : ""
    };
  }

  function applyParams(p) {
    if (p.n != null) countEl.value = p.n;
    if (p.c != null) colorsEl.value = p.c;
    if (p.r != null) forceEl.value = p.r;
    if (p.f != null) fricEl.value = p.f;
    if (p.s != null) speedEl.value = p.s;
    syncLabels();
    seed();
    if (p.m) {
      try {
        var rows = p.m.split(";");
        var m = [];
        for (var i = 0; i < rows.length; i++) {
          var cells = rows[i].split(",");
          var row = [];
          for (var j = 0; j < cells.length; j++) row.push(parseFloat(cells[j]) || 0);
          m.push(row);
        }
        if (m.length >= 2) { matrix = m; renderMatrix(); return; }
      } catch (e) { /* fall through to default preset */ }
    }
    matrix = genCells(Nc);
    renderMatrix();
  }

  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return false;
    try {
      var p = new URLSearchParams(h);
      applyParams({
        n: parseInt(p.get("n"), 10),
        c: parseInt(p.get("c"), 10),
        r: parseInt(p.get("r"), 10),
        f: parseInt(p.get("f"), 10),
        s: parseInt(p.get("s"), 10),
        m: p.get("m")
      });
      return true;
    } catch (e) { return false; }
  }

  function share() {
    var p = currentParams();
    var h = "#n=" + p.n + "&c=" + p.c + "&r=" + p.r + "&f=" + p.f + "&s=" + p.s + "&m=" + encodeURIComponent(p.m);
    history.replaceState(null, "", h);
    var url = location.origin + location.pathname + h;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link (this exact universe) copied to clipboard"); },
        function () { flash("Link set in the URL bar (copy blocked)"); }
      );
    } else {
      flash("Link set in the URL bar");
    }
  }

  function syncLabels() {
    countVal.textContent = countEl.value;
    colorsVal.textContent = colorsEl.value;
    forceVal.textContent = forceEl.value;
    fricVal.textContent = (parseInt(fricEl.value, 10) / 100).toFixed(2);
    speedVal.textContent = speedEl.value;
  }

  // ---- matrix viewer --------------------------------------------------
  function renderMatrix() {
    var box = document.getElementById("matrix-box");
    var grid = document.getElementById("matrix-grid");
    if (!grid) return;
    if (!matrix || !matrix.length) { box.hidden = true; return; }
    grid.innerHTML = "";
    var legend = document.createElement("div");
    legend.className = "matrix-legend";
    var html = '<div class="matrix-corner"></div>';
    for (var c = 0; c < matrix.length; c++) {
      html += '<div class="matrix-h" style="color:' + PALETTE[c % PALETTE.length] + '">' + c + "</div>";
    }
    for (var i = 0; i < matrix.length; i++) {
      html += '<div class="matrix-r" style="color:' + PALETTE[i % PALETTE.length] + '">' + i + "</div>";
      for (var j = 0; j < matrix.length; j++) {
        var v = matrix[i][j];
        // colour the cell: green = attract, red = repel, grey = ignore
        var bg;
        if (v > 0.02) bg = "rgba(123,224,138," + (0.15 + 0.5 * Math.min(1, v)) + ")";
        else if (v < -0.02) bg = "rgba(255,93,115," + (0.15 + 0.5 * Math.min(1, -v)) + ")";
        else bg = "rgba(128,128,128,0.12)";
        html += '<div class="matrix-cell" style="background:' + bg + '" title="row ' + i + " likes col " + j + " by " + v.toFixed(2) + '">' + v.toFixed(2) + "</div>";
      }
    }
    grid.innerHTML = html;
  }

  // ---- wiring ---------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  resetBtn.addEventListener("click", function () {
    applyPreset("cells", false);
    flash("Reset to Cells preset");
  });
  reseedBtn.addEventListener("click", function () {
    seed(); render();
    flash("New random layout");
  });
  randBtn.addEventListener("click", function () {
    matrix = randomMatrix();
    renderMatrix();
    if (!running) start();
    flash("Randomized the universe — watch what evolves");
  });
  shareBtn.addEventListener("click", share);
  matrixBtn.addEventListener("click", function () {
    var box = document.getElementById("matrix-box");
    box.hidden = !box.hidden;
    if (!box.hidden) renderMatrix();
  });

  [countEl, colorsEl, forceEl, fricEl, speedEl].forEach(function (el) {
    el.addEventListener("input", function () {
      syncLabels();
      readParams();
      if (el === countEl || el === colorsEl) {
        // changing population or colour count rebuilds the layout/matrix
        seed();
        Nc = Math.min(MAX_COLOURS, parseInt(colorsEl.value, 10) || 5);
        if (matrix.length !== Nc) matrix = genCells(Nc);
        renderMatrix();
      }
    });
  });

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.dataset.preset;
      if (name === "random") {
        seed();
        matrix = randomMatrix();
        renderMatrix();
        if (!running) start();
        flash("Preset: Random universe");
        return;
      }
      applyPreset(name, false);
      if (!running) start();
      flash("Preset: " + btn.textContent);
    });
  });

  function posFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (W / rect.width),
      y: (ev.clientY - rect.top) * (H / rect.height)
    };
  }
  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    mouse.active = true; mouse.inside = true;
    var p = posFromEvent(ev); mouse.x = p.x; mouse.y = p.y;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", function (ev) {
    var p = posFromEvent(ev); mouse.x = p.x; mouse.y = p.y;
    if (ev.pointerType !== "mouse") mouse.inside = true;
  });
  function endDrag(ev) { mouse.active = false; try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {} }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerenter", function () { mouse.inside = true; });
  canvas.addEventListener("pointerleave", function (ev) { mouse.inside = false; if (!ev || ev.pointerType === "mouse") mouse.active = false; });

  window.addEventListener("resize", function () {
    resize();
    render(); // never leave the canvas blank after the bitmap reset
  });

  // ---- boot -----------------------------------------------------------
  resize();
  refreshTheme();
  setInterval(refreshTheme, 1500);
  readParams();
  syncLabels();
  var restored = restoreFromHash();
  if (!restored) {
    seed();
    matrix = genCells(Nc);
    renderMatrix();
  }
  render();
  start();
})();
