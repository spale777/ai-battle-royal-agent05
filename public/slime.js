// agent-05 — Physarum (slime mold) agent simulation (client-side, no backend).
// Thousands of identical, blind "agents" are scattered on a plane. Each one
// senses a faint chemical trail just ahead of it — a little to the left, dead
// ahead, a little to the right — turns toward whichever reading is strongest,
// steps forward, and deposits a fresh dab of trail. The trail map then
// diffuses (bleeds into neighbours) and decays (fades). That is the entire
// rulebook: no leader, no map, no goal. And yet, from those selfish little
// walks, a living transport network condenses on its own — the same trick
// real Physarum polycephalum uses to wire up the shortest path between food
// sources (Nakagaki, Yamada & Tóth, 2000). Based on Jeff Jones' "physarum"
// agent model. Everything runs in the browser; nothing is sent anywhere.
//
//     TUNE  — internal mappings from the on-screen sliders; tweak freely.
//     PRESETS — named parameter sets that produce distinct ecologies.
(function () {
  "use strict";

  var canvas = document.getElementById("slime");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var playBtn = document.getElementById("play");
  var resetBtn = document.getElementById("reset");
  var reseedBtn = document.getElementById("reseed");
  var clearBtn = document.getElementById("clear");
  var shareBtn = document.getElementById("share");

  var countEl = document.getElementById("count");
  var speedEl = document.getElementById("speed");
  var saEl = document.getElementById("sa");
  var sdEl = document.getElementById("sd");
  var rotEl = document.getElementById("rot");
  var depEl = document.getElementById("dep");
  var decayEl = document.getElementById("decay");
  var diffEl = document.getElementById("diff");
  var paletteEl = document.getElementById("palette");
  var foodEl = document.getElementById("foodMode");

  var countVal = document.getElementById("count-val");
  var speedVal = document.getElementById("speed-val");
  var saVal = document.getElementById("sa-val");
  var sdVal = document.getElementById("sd-val");
  var rotVal = document.getElementById("rot-val");
  var depVal = document.getElementById("dep-val");
  var decayVal = document.getElementById("decay-val");
  var diffVal = document.getElementById("diff-val");
  var paletteVal = document.getElementById("palette-val");
  var foodVal = document.getElementById("foodMode-val");

  // ---- grid / buffers -------------------------------------------------
  var GW = 320, GH = 232;          // simulation grid (aspect ~= canvas)
  var SIZE = GW * GH;
  var trail = new Float32Array(SIZE);
  var scratch = new Float32Array(SIZE);
  var food = new Float32Array(SIZE);

  // Offscreen buffer the size of the grid; we scale it up to the canvas so the
  // soft, diffuse look survives on screen.
  var buf = document.createElement("canvas");
  buf.width = GW; buf.height = GH;
  var bctx = buf.getContext("2d");
  var img = bctx.createImageData(GW, GH);

  // ---- tunables (mapped from sliders) ---------------------------------
  var SA = 22 * Math.PI / 180;     // sensor angle (radians)
  var SD = 12;                     // sensor distance (grid cells)
  var ROT = 30 * Math.PI / 180;    // turn speed (radians / step)
  var DEPOSIT = 0.02;              // trail added per agent per step
  var DECAY = 0.09;                // fraction of trail removed per step
  var DIFF = 0.72;                 // blend toward 3x3 mean per step
  var STEPS = 2;                   // simulation substeps per animation frame
  var STEP = 1.0;                  // agent move distance (cells / step)
  var GAIN = 1.6;                  // render contrast
  var MAX_TRAIL = 4.0;

  // ---- agent state ----------------------------------------------------
  var N = 4000;
  var ax = null, ay = null, ahead = null;
  var seed = 0;                    // layout seed (for share links)
  var running = true;
  var generation = 0;

  // ---- palettes (pos -> rgb) -----------------------------------------
  var PALETTES = {
    amber:   [[0,[8,6,4]],[0.4,[120,58,10]],[0.7,[240,150,40]],[1,[255,236,182]]],
    mint:    [[0,[4,10,8]],[0.4,[20,120,90]],[0.7,[90,222,170]],[1,[226,255,242]]],
    cyan:    [[0,[4,8,12]],[0.4,[20,90,134]],[0.7,[64,200,232]],[1,[222,250,255]]],
    magenta: [[0,[10,4,10]],[0.4,[120,20,110]],[0.7,[232,72,200]],[1,[255,222,250]]],
    ember:   [[0,[8,4,4]],[0.4,[150,30,20]],[0.7,[242,92,30]],[1,[255,212,122]]],
    violet:  [[0,[6,4,12]],[0.4,[82,40,150]],[0.7,[152,92,242]],[1,[236,222,255]]]
  };

  // ---- presets --------------------------------------------------------
  var PRESETS = {
    classic: { sa: 22, sd: 12, rot: 45, dep: 24, decay: 9,  diff: 72, layout: "scatter" },
    web:     { sa: 15, sd: 16, rot: 26, dep: 22, decay: 7,  diff: 68, layout: "scatter" },
    veins:   { sa: 26, sd: 10, rot: 44, dep: 26, decay: 11, diff: 64, layout: "scatter" },
    swirl:   { sa: 30, sd: 18, rot: 52, dep: 20, decay: 8,  diff: 80, layout: "ring" },
    sparkle: { sa: 12, sd: 8,  rot: 35, dep: 30, decay: 13, diff: 60, layout: "center" }
  };

  // ---- seeded PRNG (mulberry32) so a share link reproduces a layout ---
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = Math.random;

  function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }

  // ---- seeding agents -------------------------------------------------
  function seedAgents(layout) {
    N = Math.max(100, Math.min(8000, parseInt(countEl.value, 10) || 4000));
    ax = new Float32Array(N);
    ay = new Float32Array(N);
    ahead = new Float32Array(N);
    var rng = mulberry32(seed >>> 0);
    for (var i = 0; i < N; i++) {
      if (layout === "ring") {
        var ang = rng() * Math.PI * 2;
        var rad = Math.min(GW, GH) * 0.40;
        ax[i] = GW / 2 + Math.cos(ang) * rad * randRange(rng, 0.85, 1.05);
        ay[i] = GH / 2 + Math.sin(ang) * rad * randRange(rng, 0.85, 1.05);
        ahead[i] = ang + Math.PI / 2;        // start tangential -> swirls
      } else if (layout === "center") {
        var gx = (rng() + rng() + rng() - 1.5) * (GW * 0.22);
        var gy = (rng() + rng() + rng() - 1.5) * (GH * 0.22);
        ax[i] = GW / 2 + gx;
        ay[i] = GH / 2 + gy;
        ahead[i] = rng() * Math.PI * 2;
      } else { // scatter
        ax[i] = rng() * GW;
        ay[i] = rng() * GH;
        ahead[i] = rng() * Math.PI * 2;
      }
    }
    generation = 0;
  }

  function clearTrails() {
    trail.fill(0);
    generation = 0;
  }

  // ---- sensing --------------------------------------------------------
  function sense(x, y, ang, field) {
    var sx = ((x + Math.cos(ang) * SD) % GW + GW) % GW;
    var sy = ((y + Math.sin(ang) * SD) % GH + GH) % GH;
    return field[(sy | 0) * GW + (sx | 0)];
  }

  function wrap(v, m) { return ((v % m) + m) % m; }

  // ---- simulation step ------------------------------------------------
  function step() {
    var mode = foodEl ? foodEl.value : "off";
    var useFood = (mode === "attract" || mode === "repel");
    var fsign = (mode === "attract") ? 1 : -1;
    var fweight = 0.9;

    for (var i = 0; i < N; i++) {
      var x = ax[i], y = ay[i], a = ahead[i];

      // Sample trail (and food) at three sensors.
      var fL = sense(x, y, a - SA, trail), fC = sense(x, y, a, trail), fR = sense(x, y, a + SA, trail);
      var sL = fL, sC = fC, sR = fR;
      if (useFood) {
        var gL = sense(x, y, a - SA, food), gC = sense(x, y, a, food), gR = sense(x, y, a + SA, food);
        sL += fsign * fweight * gL;
        sC += fsign * fweight * gC;
        sR += fsign * fweight * gR;
      }

      // Steer toward the strongest sensor.
      if (sC >= sL && sC >= sR) {
        // hold heading
      } else if (sL > sR) {
        a -= ROT;
      } else if (sR > sL) {
        a += ROT;
      } else {
        // all three sensors read equal: pick a side deterministically from the
        // agent index so a shared seed reproduces the exact same network.
        a += ((i & 1) ? -ROT : ROT);
      }

      // Step forward and wrap around the torus (no walls).
      x = wrap(x + Math.cos(a) * STEP, GW);
      y = wrap(y + Math.sin(a) * STEP, GH);
      ax[i] = x; ay[i] = y; ahead[i] = a;

      // Deposit a dab of trail.
      var ci = (y | 0) * GW + (x | 0);
      var v = trail[ci] + DEPOSIT;
      trail[ci] = v > MAX_TRAIL ? MAX_TRAIL : v;
    }

    diffuseDecay();
    generation++;
  }

  // 3x3 mean blur (diffusion) blended by DIFF, then exponential decay.
  function diffuseDecay() {
    var w = DIFF, keep = 1 - DECAY;
    for (var y = 0; y < GH; y++) {
      var ym = ((y - 1 + GH) % GH) * GW;
      var yp = ((y + 1) % GH) * GW;
      var yc = y * GW;
      for (var x = 0; x < GW; x++) {
        var xm = (x - 1 + GW) % GW;
        var xp = (x + 1) % GW;
        var c = yc + x;
        var sum =
          trail[yc + xm] + trail[yc + xp] + trail[ym + x] + trail[yp + x] +
          trail[ym + xm] + trail[ym + xp] + trail[yp + xm] + trail[yp + xp] + trail[c];
        var mean = sum / 9;
        scratch[c] = (trail[c] * (1 - w) + mean * w) * keep;
      }
    }
    var t = trail; trail = scratch; scratch = t;
  }

  // ---- rendering ------------------------------------------------------
  function samplePalette(stops, t) {
    if (t <= 0) return stops[0][1];
    if (t >= 1) return stops[stops.length - 1][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var s0 = stops[i - 1], s1 = stops[i];
        var a = (t - s0[0]) / (s1[0] - s0[0]);
        return [
          Math.round(s0[1][0] + (s1[1][0] - s0[1][0]) * a),
          Math.round(s0[1][1] + (s1[1][1] - s0[1][1]) * a),
          Math.round(s0[1][2] + (s1[1][2] - s0[1][2]) * a)
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function render() {
    var stops = PALETTES[paletteEl ? paletteEl.value : "amber"] || PALETTES.amber;
    var data = img.data;
    for (var i = 0; i < SIZE; i++) {
      var t = trail[i];
      // soft saturation curve -> good contrast across a wide range of values
      t = 1 - Math.exp(-t * GAIN);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var rgb = samplePalette(stops, t);
      var p = i * 4;
      data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2]; data[p + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
    readout.textContent =
      "agents " + N +
      " · step " + generation +
      " · SA " + (saEl.value | 0) + "°" +
      " · SD " + (sdEl.value | 0) +
      " · rot " + (rotEl.value | 0) + "°" +
      " · dep " + (depEl.value | 0) +
      " · evap " + (decayEl.value | 0) + "%" +
      " · diff " + (diffEl.value | 0) + "%" +
      " · " + (paletteEl ? paletteEl.value : "amber") +
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
    running = true;
    playBtn.textContent = "⏸ Pause";
    playBtn.setAttribute("aria-pressed", "true");
    if (!timer) timer = requestAnimationFrame(loop);
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

  // ---- params (live from sliders) ------------------------------------
  function readParams() {
    SA = (parseInt(saEl.value, 10) || 22) * Math.PI / 180;
    SD = Math.max(1, parseInt(sdEl.value, 10) || 12);
    ROT = (parseInt(rotEl.value, 10) || 30) * Math.PI / 180;
    DEPOSIT = (parseInt(depEl.value, 10) || 24) * 0.02;
    DECAY = Math.min(0.95, (parseInt(decayEl.value, 10) || 9) / 100);
    DIFF = Math.min(0.98, (parseInt(diffEl.value, 10) || 72) / 100);
    STEPS = Math.max(1, parseInt(speedEl.value, 10) || 2);
  }

  function syncLabels() {
    countVal.textContent = countEl.value;
    speedVal.textContent = speedEl.value;
    saVal.textContent = saEl.value;
    sdVal.textContent = sdEl.value;
    rotVal.textContent = rotEl.value;
    depVal.textContent = depEl.value;
    decayVal.textContent = decayEl.value;
    diffVal.textContent = diffEl.value;
    if (paletteVal) paletteVal.textContent = paletteEl.value;
    if (foodVal) foodVal.textContent = foodEl.value;
  }

  // ---- share link (seed + params => reproducible network) ------------
  function currentParams() {
    return {
      n: parseInt(countEl.value, 10),
      s: parseInt(speedEl.value, 10),
      sa: parseInt(saEl.value, 10),
      sd: parseInt(sdEl.value, 10),
      rot: parseInt(rotEl.value, 10),
      dep: parseInt(depEl.value, 10),
      decay: parseInt(decayEl.value, 10),
      diff: parseInt(diffEl.value, 10),
      pal: paletteEl.value,
      food: foodEl.value,
      seed: seed
    };
  }

  function applyParams(p) {
    if (p.n != null) countEl.value = p.n;
    if (p.s != null) speedEl.value = p.s;
    if (p.sa != null) saEl.value = p.sa;
    if (p.sd != null) sdEl.value = p.sd;
    if (p.rot != null) rotEl.value = p.rot;
    if (p.dep != null) depEl.value = p.dep;
    if (p.decay != null) decayEl.value = p.decay;
    if (p.diff != null) diffEl.value = p.diff;
    if (p.pal) paletteEl.value = p.pal;
    if (p.food) foodEl.value = p.food;
    syncLabels();
    readParams();
    seed = (p.seed != null) ? (p.seed >>> 0) : (Math.random() * 4294967296) >>> 0;
    seedAgents("scatter");
  }

  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return false;
    try {
      var p = new URLSearchParams(h);
      var q = {};
      ["n", "s", "sa", "sd", "rot", "dep", "decay", "diff", "seed"].forEach(function (k) {
        var v = p.get(k); if (v != null) q[k] = parseInt(v, 10);
      });
      q.pal = p.get("pal");
      q.food = p.get("food");
      applyParams(q);
      return true;
    } catch (e) { return false; }
  }

  function share() {
    var p = currentParams();
    var h = "#n=" + p.n + "&s=" + p.s + "&sa=" + p.sa + "&sd=" + p.sd +
      "&rot=" + p.rot + "&dep=" + p.dep + "&decay=" + p.decay + "&diff=" + p.diff +
      "&pal=" + encodeURIComponent(p.pal) + "&food=" + encodeURIComponent(p.food) +
      "&seed=" + p.seed;
    history.replaceState(null, "", h);
    var url = location.origin + location.pathname + h;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link (this exact layout + params) copied"); },
        function () { flash("Link set in the URL bar (copy blocked)"); }
      );
    } else {
      flash("Link set in the URL bar");
    }
  }

  // ---- painting food / trail at the cursor ---------------------------
  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    var py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    var gx = (px / canvas.width) * GW;
    var gy = (py / canvas.height) * GH;
    return { gx: gx, gy: gy };
  }

  function paintAt(c) {
    var rad = 5;
    var cx = c.gx | 0, cy = c.gy | 0;
    var mode = foodEl ? foodEl.value : "off";
    for (var dy = -rad; dy <= rad; dy++) {
      for (var dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        var x = wrap(cx + dx, GW), y = wrap(cy + dy, GH);
        var idx = y * GW + x;
        if (mode === "attract") food[idx] = Math.min(1.0, food[idx] + 0.25);
        else if (mode === "repel") food[idx] = Math.max(0.0, food[idx] - 0.25);
        else if (mode === "paint") trail[idx] = Math.min(MAX_TRAIL, trail[idx] + 0.8);
      }
    }
    if (!running) render();
  }

  var painting = false;
  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    if (!foodEl || foodEl.value === "off") return;
    painting = true;
    canvas.setPointerCapture(ev.pointerId);
    paintAt(cellFromEvent(ev));
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!painting) return;
    paintAt(cellFromEvent(ev));
  });
  function endPaint(ev) {
    painting = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  }
  canvas.addEventListener("pointerup", endPaint);
  canvas.addEventListener("pointercancel", endPaint);

  // ---- wiring ---------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  resetBtn.addEventListener("click", function () {
    seed = (Math.random() * 4294967296) >>> 0;
    clearTrails();
    seedAgents("scatter");
    if (!running) start();
    flash("Reset — new random colony");
  });
  reseedBtn.addEventListener("click", function () {
    seed = (Math.random() * 4294967296) >>> 0;
    seedAgents("scatter");
    if (!running) start();
    flash("New layout (new seed)");
  });
  clearBtn.addEventListener("click", function () {
    stop();
    clearTrails();
    food.fill(0);
    render();
    flash("Trails and food cleared");
  });
  shareBtn.addEventListener("click", share);

  [countEl, speedEl, saEl, sdEl, rotEl, depEl, decayEl, diffEl].forEach(function (el) {
    el.addEventListener("input", function () {
      syncLabels();
      readParams();
      if (el === countEl) { seedAgents("scatter"); if (!running) render(); }
    });
  });
  if (paletteEl) paletteEl.addEventListener("change", function () { syncLabels(); if (!running) render(); });
  if (foodEl) foodEl.addEventListener("change", syncLabels);

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      var p = PRESETS[btn.dataset.preset];
      if (!p) return;
      saEl.value = p.sa; sdEl.value = p.sd; rotEl.value = p.rot;
      depEl.value = p.dep; decayEl.value = p.decay; diffEl.value = p.diff;
      syncLabels();
      readParams();
      seed = (Math.random() * 4294967296) >>> 0;
      clearTrails();
      seedAgents(p.layout || "scatter");
      if (!running) start();
      flash("Preset: " + btn.textContent);
    });
  });

  // ---- boot -----------------------------------------------------------
  canvas.width = 720; canvas.height = 520;
  syncLabels();
  var restored = restoreFromHash();
  if (!restored) {
    seed = (Math.random() * 4294967296) >>> 0;
    seedAgents("scatter");
  }
  clearTrails();
  render();
  start();
})();
