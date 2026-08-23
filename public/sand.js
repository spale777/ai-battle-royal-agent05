/*
 * sand.js — Abelian sandpile (self-organized criticality)
 *
 * One rule: any cell holding >= 4 grains topples, handing one grain to each
 * of its four neighbours (and keeping grid % 4). The avalanche repeats until
 * the whole grid is stable (every cell < 4). From that single, untuned rule a
 * fractal freezes out of a flat plane (Bak, Tang & Wiesenfeld, 1987).
 *
 * Pure client-side: the grid lives in a typed array, the avalanche is advanced
 * by a queue of unstable sites, and the view state is encoded in the URL hash
 * so any finished pattern is shareable and reproducible (the model is fully
 * deterministic). No backend, no tracking.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("sand");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var GRID = 512;            // simulation resolution (square)
  canvas.width = GRID;
  canvas.height = GRID;
  var ctx = canvas.getContext("2d");
  var img = ctx.createImageData(GRID, GRID);

  // grid[i] = number of grains at cell i; topples[i] = total topples there.
  var N = GRID * GRID;
  var grid = new Int32Array(N);
  var topples = new Int32Array(N);
  var queue = [];            // indices of currently-unstable sites
  var qhead = 0;
  var totalTopples = 0;

  // ---- palettes --------------------------------------------------------
  // Each palette: 4 colours for grain counts 0..3, plus a hot colour for the
  // transient >=4 (active avalanche front) and a height-gradient ramp.
  var PALETTES = {
    coal:   { stops: [[11,13,20],[60,72,90],[120,140,165],[200,215,235]], hot: [255,255,255] },
    ice:    { stops: [[8,18,32],[40,90,140],[110,180,225],[200,235,250]], hot: [200,245,255] },
    ember:  { stops: [[18,8,8],[110,40,20],[200,90,30],[250,200,120]], hot: [255,240,200] },
    moss:   { stops: [[10,18,12],[40,90,45],[110,170,90],[200,235,170]], hot: [230,255,210] },
    violet: { stops: [[14,10,22],[70,45,120],[140,95,205],[220,190,250]], hot: [245,225,255] },
    acid:   { stops: [[8,16,6],[60,120,20],[140,210,40],[225,250,140]], hot: [245,255,210] }
  };
  var LOGMAX = 14;           // height-mode log scale ceiling

  function lerp(a, b, t) { return a + (b - a) * t; }
  function rampColor(pal, frac) {
    var s = pal.stops;
    if (frac <= 0) return s[0];
    if (frac >= 1) return s[3];
    var q = frac * 3;         // 0..3 -> 4 stops
    var i = Math.min(2, Math.floor(q));
    var t = q - i;
    var c0 = s[i], c1 = s[i + 1];
    return [lerp(c0[0],c1[0],t), lerp(c0[1],c1[1],t), lerp(c0[2],c1[2],t)];
  }

  // ---- state ------------------------------------------------------------
  var state = {
    drops: [],               // [{x,y,a,r}] source-of-truth initial condition
    palette: "coal",
    mode: "grain",
    grains: 12000,
    radius: 0
  };

  function idx(x, y) { return y * GRID + x; }

  function clearBoard() {
    grid.fill(0);
    topples.fill(0);
    queue.length = 0;
    qhead = 0;
    totalTopples = 0;
  }

  // Add `a` grains in a disk of radius r centered at (cx,cy); push unstable.
  function dropAt(cx, cy, r, a) {
    if (r <= 0) {
      if (cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) return;
      grid[idx(cx, cy)] += a;
      if (grid[idx(cx, cy)] >= 4) queue.push(idx(cx, cy));
      return;
    }
    var r2 = r * r;
    for (var y = Math.max(0, cy - r); y <= Math.min(GRID - 1, cy + r); y++) {
      for (var x = Math.max(0, cx - r); x <= Math.min(GRID - 1, cx + r); x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          var i = idx(x, y);
          grid[i] += a;
          if (grid[i] >= 4) queue.push(i);
        }
      }
    }
  }

  // Rebuild the board from state.drops and start relaxing.
  function applyDrops() {
    clearBoard();
    for (var k = 0; k < state.drops.length; k++) {
      var d = state.drops[k];
      dropAt(d.x, d.y, d.r || 0, d.a);
    }
    draw();
    updateReadout();
  }

  // Advance the avalanche by up to `steps` topplings.
  function step(steps) {
    var did = 0;
    while (did < steps && qhead < queue.length) {
      var i = queue[qhead++];
      var g = grid[i];
      if (g < 4) continue;            // already settled (abstraction gaps)
      var n = (g / 4) | 0;            // how many times this cell topples
      grid[i] = g - n * 4;
      totalTopples += n;
      topples[i] += n;
      var x = i % GRID, y = (i / GRID) | 0;
      if (x > 0)       { var u = i - 1;      grid[u] += n; if (grid[u] >= 4) queue.push(u); }
      if (x < GRID - 1){ var v = i + 1;      grid[v] += n; if (grid[v] >= 4) queue.push(v); }
      if (y > 0)       { var l = i - GRID;   grid[l] += n; if (grid[l] >= 4) queue.push(l); }
      if (y < GRID - 1){ var rr = i + GRID;  grid[rr] += n; if (grid[rr] >= 4) queue.push(rr); }
      did++;
    }
    // Trim the consumed prefix of the queue occasionally to bound memory.
    if (qhead > 4096) { queue.splice(0, qhead); qhead = 0; }
    return did;
  }

  var stable = true;
  function isStable() { return qhead >= queue.length; }

  // ---- rendering -------------------------------------------------------
  function draw() {
    var pal = PALETTES[state.palette] || PALETTES.coal;
    var data = img.data;
    if (state.mode === "height") {
      for (var i = 0; i < N; i++) {
        var t = topples[i];
        var frac = t <= 0 ? 0 : Math.min(1, Math.log2(1 + t) / LOGMAX);
        var c = t >= 4 ? pal.hot : rampColor(pal, frac);
        var p = i * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    } else {
      var s = pal.stops;
      for (var j = 0; j < N; j++) {
        var g = grid[j];
        var col = g >= 4 ? pal.hot : s[g > 3 ? 3 : g];
        var q = j * 4;
        data[q] = col[0]; data[q + 1] = col[1]; data[q + 2] = col[2]; data[q + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- readout ----------------------------------------------------------
  function updateReadout() {
    stable = isStable();
    var label = stable
      ? "stable"
      : "relaxing — " + (queue.length - qhead) + " sites queued";
    readout.textContent =
      "grains on board: " + gridSum() +
      " · total topples: " + totalTopples +
      " · " + label;
  }

  function gridSum() {
    var s = 0;
    for (var i = 0; i < N; i++) s += grid[i];
    return s;
  }

  // ---- animation loop ---------------------------------------------------
  var running = true;
  var speed = 10;
  var rafId = null;

  function frame() {
    if (running && !isStable()) {
      step(speed);
      draw();
      updateReadout();
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---- presets ----------------------------------------------------------
  function center() { return (GRID / 2) | 0; }

  function setPreset(name) {
    state.drops = [];
    var c = center();
    if (name === "single") {
      state.grains = 12000; state.radius = 0;
      state.drops.push({ x: c, y: c, a: state.grains, r: 0 });
    } else if (name === "big") {
      state.grains = 60000; state.radius = 3;
      state.drops.push({ x: c, y: c, a: state.grains, r: 3 });
    } else if (name === "two") {
      state.grains = 9000; state.radius = 0;
      var off = (GRID / 5) | 0;
      state.drops.push({ x: c - off, y: c, a: state.grains, r: 0 });
      state.drops.push({ x: c + off, y: c, a: state.grains, r: 0 });
    } else if (name === "scatter") {
      state.grains = 8000; state.radius = 1;
      for (var k = 0; k < 160; k++) {
        var x = (Math.random() * GRID) | 0;
        var y = (Math.random() * GRID) | 0;
        state.drops.push({ x: x, y: y, a: 8 + ((Math.random() * 20) | 0), r: 1 });
      }
    }
    syncSliders();
    applyDrops();
    setRunning(true);
  }

  // ---- pointer interaction (paint sand) ---------------------------------
  var painting = false;
  function cellFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = Math.floor((e.clientX - rect.left) / rect.width * GRID);
    var y = Math.floor((e.clientY - rect.top) / rect.height * GRID);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return { x: x, y: y };
  }

  function paintAt(e) {
    var c = cellFromEvent(e);
    if (!c) return;
    var r = state.radius;
    var a = r <= 0 ? 4 : Math.max(4, (r * r) | 0);
    dropAt(c.x, c.y, r, a);
    state.drops.push({ x: c.x, y: c.y, a: a, r: r });
    if (state.drops.length > 256) state.drops.shift();
    if (!running) draw();
    updateReadout();
  }

  canvas.addEventListener("pointerdown", function (e) {
    painting = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    paintAt(e);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (painting) paintAt(e);
  });
  window.addEventListener("pointerup", function () { painting = false; });

  // ---- controls wiring --------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function syncSliders() {
    $("grains").value = state.grains;
    $("grains-val").textContent = state.grains;
    $("radius").value = state.radius;
    $("radius-val").textContent = state.radius;
  }

  function setRunning(on) {
    running = on;
    var b = $("drop");
    b.textContent = on ? "⏸ Pause" : "▶ Drop";
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }

  $("grains").addEventListener("input", function () {
    state.grains = parseInt(this.value, 10);
    $("grains-val").textContent = state.grains;
  });
  $("radius").addEventListener("input", function () {
    state.radius = parseInt(this.value, 10);
    $("radius-val").textContent = state.radius;
  });
  $("speed").addEventListener("input", function () {
    speed = parseInt(this.value, 10);
    $("speed-val").textContent = speed;
  });
  $("palette").addEventListener("change", function () {
    state.palette = this.value;
    $("palette-val").textContent = this.value;
    draw();
  });
  $("mode").addEventListener("change", function () {
    state.mode = this.value;
    $("mode-val").textContent = this.value;
    draw();
  });

  $("drop").addEventListener("click", function () { setRunning(!running); });
  $("reset").addEventListener("click", function () {
    applyDrops();
    setRunning(true);
    flash("Rebuilt the board from the current drops.");
  });
  $("clear").addEventListener("click", function () {
    state.drops = [];
    clearBoard();
    draw();
    updateReadout();
    flash("Board cleared.");
  });

  // ---- share link (encode full deterministic state in the hash) ----------
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decode(b) {
    b = b.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }

  function buildShare() {
    var payload = {
      d: state.drops.slice(0, 256),
      p: state.palette,
      m: state.mode,
      g: state.grains,
      r: state.radius
    };
    return "#d=" + b64encode(JSON.stringify(payload));
  }

  function applyShare(hash) {
    var m = hash.match(/[#&]d=([^&]+)/);
    if (!m) return false;
    try {
      var payload = JSON.parse(b64decode(m[1]));
      if (!payload || !Array.isArray(payload.d)) return false;
      state.drops = payload.d.filter(function (d) {
        return d && typeof d.x === "number" && typeof d.y === "number";
      });
      if (payload.p && PALETTES[payload.p]) state.palette = payload.p;
      if (payload.m) state.mode = payload.m;
      if (typeof payload.g === "number") state.grains = payload.g;
      if (typeof payload.r === "number") state.radius = payload.r;
      return true;
    } catch (e) { return false; }
  }

  $("share").addEventListener("click", function () {
    var url = location.origin + location.pathname + buildShare();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link copied — it rebuilds this exact pattern."); },
        function () { fallbackCopy(url); }
      );
    } else { fallbackCopy(url); }
  });
  function fallbackCopy(url) {
    location.hash = buildShare().slice(1);
    flash("Share link is in the address bar.");
  }

  function flash(t) {
    msg.textContent = t;
  }

  // preset buttons
  var presetBtns = document.querySelectorAll(".preset");
  for (var pi = 0; pi < presetBtns.length; pi++) {
    presetBtns[pi].addEventListener("click", function () {
      setPreset(this.getAttribute("data-preset"));
    });
  }

  // ---- boot -------------------------------------------------------------
  function boot() {
    var fromHash = applyShare(location.hash);
    // reflect loaded/state values into the UI
    $("palette").value = state.palette;
    $("palette-val").textContent = state.palette;
    $("mode").value = state.mode;
    $("mode-val").textContent = state.mode;
    syncSliders();
    if (fromHash && state.drops.length) {
      applyDrops();
      flash("Loaded a shared pattern from the link — relaxing it now.");
    } else {
      setPreset("single");
    }
    setRunning(true);
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  boot();
})();
