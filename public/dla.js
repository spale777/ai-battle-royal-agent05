/*
 * dla.js — Diffusion-Limited Aggregation (Witten & Sander, 1981)
 *
 * One idea: launch a particle from the rim, let it random-walk blindly, and
 * the instant it touches the cluster it sticks. Because walkers reach the
 * tips of the structure first, branches keep reaching out and intercepting
 * more — a self-reinforcing, fern-like fractal condensation grows.
 *
 * The whole growth is driven by a single seeded PRNG (mulberry32), so a given
 * seed + parameters always reproduces the exact same cluster — and a share
 * link carries that seed. No backend, no tracking. Pure client-side.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("dla");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var SIM = 640;                 // simulation grid is SIM x SIM
  canvas.width = SIM;
  canvas.height = SIM;
  var ctx = canvas.getContext("2d");
  var img = ctx.createImageData(SIM, SIM);
  var N = SIM * SIM;

  var occupied = new Uint8Array(N);   // 1 if part of the cluster / seed
  var order = new Int32Array(N);      // 0 = seed, 1.. = stick order
  var dist = new Int32Array(N);       // distance metric for "radius" coloring

  var clusterCount = 0;
  var maxR = 0;
  var topY = SIM - 1;                 // for wall mode: topmost occupied row
  var walkersLaunched = 0;

  var center = { x: SIM / 2, y: SIM / 2 };
  var launchR = 3;
  var bottomY = SIM - 1;

  // ---- seeded PRNG (mulberry32): fully deterministic growth -------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1);

  // ---- palettes (same shape as the sandpile sim) -------------------------
  var PALETTES = {
    coal:   { stops: [[11,13,20],[60,72,90],[120,140,165],[200,215,235]] },
    ice:    { stops: [[8,18,32],[40,90,140],[110,180,225],[200,235,250]] },
    ember:  { stops: [[18,8,8],[110,40,20],[200,90,30],[250,200,120]] },
    moss:   { stops: [[10,18,12],[40,90,45],[110,170,90],[200,235,170]] },
    violet: { stops: [[14,10,22],[70,45,120],[140,95,205],[220,190,250]] },
    acid:   { stops: [[8,16,6],[60,120,20],[140,210,40],[225,250,140]] }
  };
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rampColor(pal, frac) {
    var s = pal.stops;
    if (frac <= 0) return s[0];
    if (frac >= 1) return s[3];
    var q = frac * 3;
    var i = Math.min(2, Math.floor(q));
    var t = q - i;
    var c0 = s[i], c1 = s[i + 1];
    return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
  }

  // ---- state -------------------------------------------------------------
  var state = {
    seedMode: "point",     // 'point' | 'wall' | 'manual'
    seeds: [{ x: SIM / 2 | 0, y: SIM / 2 | 0 }],
    seed: 1,               // PRNG seed (uint32)
    stick: 1.0,            // 0..1 stickiness
    speed: 24,             // walkers that stick per frame
    target: 4000,          // auto-pause after this many grains
    palette: "coal",
    mode: "order"          // 'order' | 'radius' | 'flat'
  };

  function idx(x, y) { return y * SIM + x; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- seeding -----------------------------------------------------------
  function clearAll() {
    occupied.fill(0);
    order.fill(0);
    dist.fill(0);
    clusterCount = 0;
    maxR = 0;
    topY = SIM - 1;
    walkersLaunched = 0;
    dirty = true;
  }

  function recomputeFrame() {
    // Re-derive center / launch radius / topY from current seeds+cluster.
    if (state.seedMode === "wall") {
      topY = SIM - 1;
      // find actual topmost occupied row
      for (var y = 0; y < SIM; y++) {
        var found = false;
        for (var x = 0; x < SIM; x++) {
          if (occupied[idx(x, y)]) { found = true; break; }
        }
        if (found) { topY = y; break; }
      }
      return;
    }
    var sx = 0, sy = 0, n = 0, mxr = 0;
    for (var i = 0; i < N; i++) {
      if (occupied[i]) {
        var ix = i % SIM, iy = (i / SIM) | 0;
        sx += ix; sy += iy; n++;
        var d = Math.round(Math.sqrt((ix - center.x) * (ix - center.x) +
                                     (iy - center.y) * (iy - center.y)));
        if (d > mxr) mxr = d;
      }
    }
    if (n > 0) { center.x = sx / n; center.y = sy / n; }
    maxR = mxr;
    launchR = Math.max(3, maxR + 3);
  }

  function addSeed(x, y, o) {
    if (x < 0 || y < 0 || x >= SIM || y >= SIM) return;
    var i = idx(x, y);
    if (occupied[i]) return;
    occupied[i] = 1;
    order[i] = o || 0;
    if (state.seedMode === "wall") {
      dist[i] = (bottomY - y);
    } else {
      dist[i] = Math.round(Math.sqrt((x - center.x) * (x - center.x) +
                                     (y - center.y) * (y - center.y)));
    }
    clusterCount++;
    if (y < topY) topY = y;
    walkersLaunched++;
  }

  function stick(x, y) {
    var i = idx(x, y);
    occupied[i] = 1;
    order[i] = clusterCount;          // 0-based add order (seeds are 0)
    var d;
    if (state.seedMode === "wall") {
      d = (bottomY - y);
    } else {
      d = Math.round(Math.sqrt((x - center.x) * (x - center.x) +
                               (y - center.y) * (y - center.y)));
    }
    dist[i] = d;
    clusterCount++;
    walkersLaunched++;
    if (d > maxR) maxR = d;
    if (y < topY) topY = y;
    if (state.seedMode !== "wall") launchR = Math.max(launchR, maxR + 3);
    dirty = true;
  }

  function seedPoint() {
    clearAll();
    state.seedMode = "point";
    center.x = (SIM / 2) | 0; center.y = (SIM / 2) | 0;
    addSeed(center.x, center.y, 0);
    launchR = 3;
  }

  function seedWall() {
    clearAll();
    state.seedMode = "wall";
    bottomY = SIM - 1;
    for (var x = 0; x < SIM; x++) addSeed(x, SIM - 1, 0);
    topY = SIM - 1;
  }

  function seedManual(seeds) {
    clearAll();
    state.seedMode = "manual";
    state.seeds = seeds.slice();
    var sx = 0, sy = 0;
    for (var k = 0; k < seeds.length; k++) {
      addSeed(seeds[k].x, seeds[k].y, 0);
      sx += seeds[k].x; sy += seeds[k].y;
    }
    center.x = seeds.length ? sx / seeds.length : SIM / 2;
    center.y = seeds.length ? sy / seeds.length : SIM / 2;
    recomputeFrame();
  }

  // ---- the random walk ---------------------------------------------------
  var STEP_BUDGET = 60000;

  function spawnWalker() {
    if (state.seedMode === "wall") {
      var ly = Math.max(2, topY - 4);
      var lx = (rng() * SIM) | 0;
      return { x: clamp(lx, 1, SIM - 2), y: ly };
    }
    var ang = rng() * Math.PI * 2;
    var rr = Math.max(3, launchR);
    var px = Math.round(center.x + rr * Math.cos(ang));
    var py = Math.round(center.y + rr * Math.sin(ang));
    return { x: clamp(px, 1, SIM - 2), y: clamp(py, 1, SIM - 2) };
  }

  function adjacent(x, y) {
    if (x > 0 && occupied[idx(x - 1, y)]) return true;
    if (x < SIM - 1 && occupied[idx(x + 1, y)]) return true;
    if (y > 0 && occupied[idx(x, y - 1)]) return true;
    if (y < SIM - 1 && occupied[idx(x, y + 1)]) return true;
    return false;
  }

  // Returns true if it stuck (a grain was added); false if it should respawn.
  function walk() {
    if (state.seedMode === "manual" && state.seeds.length === 0) return false;
    var p = spawnWalker();
    var steps = 0;
    while (steps < STEP_BUDGET) {
      steps++;
      if (adjacent(p.x, p.y)) {
        if (rng() < state.stick) { stick(p.x, p.y); return true; }
      }
      var d = (rng() * 4) | 0;        // 0..3 von Neumann step
      if (d === 0) p.x++; else if (d === 1) p.x--;
      else if (d === 2) p.y++; else p.y--;

      if (state.seedMode === "wall") {
        if (p.y < 1) return false;     // escaped off the top -> relaunch
        if (p.y > SIM - 1) p.y = SIM - 1;
      } else {
        var dx = p.x - center.x, dy = p.y - center.y;
        var lim = launchR + 10;
        if (dx * dx + dy * dy > lim * lim) return false; // drifted away
      }
    }
    return false;
  }

  // ---- rendering ---------------------------------------------------------
  var dirty = true;
  function draw() {
    var pal = PALETTES[state.palette] || PALETTES.coal;
    var bg = pal.stops[0];
    var data = img.data;
    var denom = Math.max(1, clusterCount - 1);
    var rdenom = Math.max(1, maxR);
    var s3 = pal.stops[3];
    for (var i = 0; i < N; i++) {
      var p = i * 4;
      if (occupied[i]) {
        var c;
        if (state.mode === "flat") {
          c = s3;
        } else if (state.mode === "radius") {
          c = rampColor(pal, dist[i] / rdenom);
        } else { // order
          c = rampColor(pal, order[i] / denom);
        }
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2];
      } else {
        data[p] = bg[0]; data[p + 1] = bg[1]; data[p + 2] = bg[2];
      }
      data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function updateReadout() {
    var status = (running ? "growing" : "paused");
    if (clusterCount >= state.target && clusterCount > 0) status = "reached target";
    var D = (clusterCount > 1 && maxR > 1)
      ? (Math.log(clusterCount) / Math.log(maxR)).toFixed(2) : "—";
    readout.textContent =
      "grains stuck: " + clusterCount +
      " · max reach: " + (state.seedMode === "wall" ? (bottomY - topY) : maxR) + " px" +
      " · walkers: " + walkersLaunched +
      " · est. D ≈ " + D +
      " · " + status;
  }

  // ---- animation loop ----------------------------------------------------
  var running = true;
  var rafId = null;

  function frame() {
    if (running && clusterCount < state.target) {
      if (!(state.seedMode === "manual" && state.seeds.length === 0)) {
        var added = 0, attempts = 0, cap = state.speed * 60;
        while (added < state.speed && clusterCount < state.target && attempts < cap) {
          attempts++;
          if (walk()) added++;
        }
      }
      if (dirty) { draw(); dirty = false; }
      updateReadout();
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---- presets -----------------------------------------------------------
  function setPreset(name) {
    state.stick = 1.0;
    if (name === "classic") {
      state.seedMode = "point"; seedPoint();
    } else if (name === "sticky") {
      state.stick = 0.5; state.seedMode = "point"; seedPoint();
    } else if (name === "lawn") {
      state.seedMode = "wall"; seedWall();
    } else if (name === "stripe") {
      state.seedMode = "manual";
      var off = (SIM / 5) | 0, c = (SIM / 2) | 0;
      seedManual([{ x: c - off, y: c }, { x: c + off, y: c }]);
    }
    rng = mulberry32(state.seed >>> 0);
    syncSliders();
    draw();
    updateReadout();
    setRunning(true);
    flash("Preset loaded — growing the cluster now.");
  }

  // ---- pointer interaction (paint seeds in manual mode) -----------------
  var painting = false;
  function cellFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = Math.floor((e.clientX - rect.left) / rect.width * SIM);
    var y = Math.floor((e.clientY - rect.top) / rect.height * SIM);
    if (x < 0 || y < 0 || x >= SIM || y >= SIM) return null;
    return { x: x, y: y };
  }
  function paintSeed(e) {
    var c = cellFromEvent(e);
    if (!c) return;
    if (state.seedMode !== "manual" || !(state.seeds && state.seeds.length)) {
      // begin a fresh manual cluster from this brush stroke
      state.seeds = [];
      // mark centroid as the brush point for now; recomputed on release
      center.x = c.x; center.y = c.y;
      state.seedMode = "manual";
      clearAll();
    }
    // paint a small 3x3 dab of seeds
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var nx = c.x + dx, ny = c.y + dy;
        if (nx >= 0 && ny >= 0 && nx < SIM && ny < SIM && !occupied[idx(nx, ny)]) {
          state.seeds.push({ x: nx, y: ny });
          addSeed(nx, ny, 0);
        }
      }
    }
    recomputeFrame();
    draw();
    updateReadout();
  }
  canvas.addEventListener("pointerdown", function (e) {
    painting = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    paintSeed(e);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (painting) paintSeed(e);
  });
  window.addEventListener("pointerup", function () { painting = false; });

  // ---- controls wiring ---------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function syncSliders() {
    $("stick").value = Math.round(state.stick * 100);
    $("stick-val").textContent = Math.round(state.stick * 100) + "%";
    $("speed").value = state.speed;
    $("speed-val").textContent = state.speed;
    $("target").value = state.target;
    $("target-val").textContent = state.target;
  }
  function setRunning(on) {
    running = on;
    var b = $("drop");
    b.textContent = on ? "⏸ Pause" : "▶ Grow";
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }

  $("stick").addEventListener("input", function () {
    state.stick = parseInt(this.value, 10) / 100;
    $("stick-val").textContent = this.value + "%";
  });
  $("speed").addEventListener("input", function () {
    state.speed = parseInt(this.value, 10);
    $("speed-val").textContent = state.speed;
  });
  $("target").addEventListener("input", function () {
    state.target = parseInt(this.value, 10);
    $("target-val").textContent = state.target;
    if (running && clusterCount >= state.target) { /* keep paused at target */ }
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
  $("seedmode").addEventListener("change", function () {
    state.seedMode = this.value;
    $("seedmode-val").textContent = this.value;
    if (this.value === "point") { seedPoint(); }
    else if (this.value === "wall") { seedWall(); }
    else { clearAll(); state.seeds = []; }
    rng = mulberry32(state.seed >>> 0);
    draw(); updateReadout(); setRunning(true);
    flash("Seed mode changed.");
  });

  $("drop").addEventListener("click", function () { setRunning(!running); });
  $("reset").addEventListener("click", function () {
    // rebuild the current seed layout from scratch with the same seed
    if (state.seedMode === "wall") seedWall();
    else if (state.seedMode === "manual" && state.seeds.length)
      seedManual(state.seeds);
    else seedPoint();
    rng = mulberry32(state.seed >>> 0);
    draw(); updateReadout(); setRunning(true);
    flash("Rebuilt the seeds; regrowing the cluster.");
  });
  $("clear").addEventListener("click", function () {
    clearAll();
    state.seedMode = "manual";
    state.seeds = [];
    draw(); updateReadout(); setRunning(true);
    flash("Board cleared — paint a seed, then watch it grow.");
  });

  // ---- share link (encode seed + params + manual seeds) ------------------
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
      s: state.seed >>> 0,
      k: Math.round(state.stick * 100),
      m: state.seedMode,
      p: state.palette,
      c: state.mode,
      sd: (state.seedMode === "manual") ? state.seeds.slice(0, 512) : undefined
    };
    return "#d=" + b64encode(JSON.stringify(payload));
  }
  function applyShare(hash) {
    var m = hash.match(/[#&]d=([^&]+)/);
    if (!m) return false;
    try {
      var pl = JSON.parse(b64decode(m[1]));
      if (typeof pl.s !== "number") return false;
      state.seed = pl.s >>> 0;
      if (typeof pl.k === "number") state.stick = pl.k / 100;
      if (pl.p && PALETTES[pl.p]) state.palette = pl.p;
      if (pl.c) state.mode = pl.c;
      if (typeof pl.m === "string") state.seedMode = pl.m;
      if (state.seedMode === "wall") {
        seedWall();
      } else if (state.seedMode === "manual" && Array.isArray(pl.sd) && pl.sd.length) {
        var seeds = pl.sd.filter(function (d) {
          return d && typeof d.x === "number" && typeof d.y === "number";
        });
        if (seeds.length) { seedManual(seeds); state.seeds = seeds; }
        else { seedPoint(); }
      } else {
        seedPoint();
      }
      rng = mulberry32(state.seed);
      return true;
    } catch (e) { return false; }
  }

  $("share").addEventListener("click", function () {
    var url = location.origin + location.pathname + buildShare();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link copied — it rebuilds this exact fractal."); },
        function () { fallbackCopy(url); }
      );
    } else { fallbackCopy(url); }
  });
  function fallbackCopy(url) {
    location.hash = buildShare().slice(1);
    flash("Share link is in the address bar.");
  }

  function flash(t) { msg.textContent = t; }

  // ---- presets buttons --------------------------------------------------
  var presetBtns = document.querySelectorAll(".preset");
  for (var pi = 0; pi < presetBtns.length; pi++) {
    presetBtns[pi].addEventListener("click", function () {
      setPreset(this.getAttribute("data-preset"));
    });
  }

  // ---- theme toggle (mirrors app.js / fractal.js) -----------------------
  var toggle = document.getElementById("theme-toggle");
  function applyToggleLabel() {
    var t = document.documentElement.dataset.theme;
    toggle.textContent = t === "light" ? "☾" : "☀";
    toggle.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  }
  toggle.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem("agent05-theme", cur); } catch (e) {}
    applyToggleLabel();
  });
  applyToggleLabel();

  // ---- boot --------------------------------------------------------------
  function boot() {
    var fromHash = applyShare(location.hash);
    $("palette").value = state.palette;
    $("palette-val").textContent = state.palette;
    $("mode").value = state.mode;
    $("mode-val").textContent = state.mode;
    $("seedmode").value = state.seedMode;
    $("seedmode-val").textContent = state.seedMode;
    syncSliders();
    if (fromHash) {
      flash("Loaded a shared link — regrowing that exact fractal.");
    } else {
      seedPoint();
      flash("Welcome — a single seed sits at the center. Watch the fractal condense.");
    }
    draw();
    updateReadout();
    setRunning(true);
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  boot();
})();
