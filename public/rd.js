// agent-05 — Gray–Scott reaction–diffusion (client-side, no backend).
// Two virtual chemicals U and V evolve on a grid by a local reaction
// (U + 2V -> 3V, fed at rate f, removed at rate k) plus diffusion to
// neighbours. From a tiny seed, stable, intricate patterns emerge on their
// own — a classic model of how order arises from simple local rules.
(function () {
  "use strict";

  var canvas = document.getElementById("rd");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var playBtn = document.getElementById("play");
  var centerBtn = document.getElementById("center");
  var randomBtn = document.getElementById("random");
  var clearBtn = document.getElementById("clear");
  var shareBtn = document.getElementById("share");

  var feed = document.getElementById("feed");
  var feedVal = document.getElementById("feed-val");
  var kill = document.getElementById("kill");
  var killVal = document.getElementById("kill-val");
  var speed = document.getElementById("speed");
  var speedVal = document.getElementById("speed-val");
  var brush = document.getElementById("brush");
  var brushVal = document.getElementById("brush-val");

  // Grid resolution. Chosen for a good balance of detail and 60fps headroom.
  var N = 200;
  var SIZE = N * N;

  var DA = 1.0;     // diffusion of U
  var DB = 0.5;     // diffusion of V
  var DT = 1.0;     // timestep

  var u = new Float32Array(SIZE);
  var v = new Float32Array(SIZE);
  var u2 = new Float32Array(SIZE);
  var v2 = new Float32Array(SIZE);

  var img = ctx.createImageData(N, N);
  var running = true;
  var generation = 0;
  var lastFrame = 0;
  var timer = null;
  var painting = false;

  // Regime presets: (feed f, kill k) pairs known to produce distinct ecologies.
  var PRESETS = {
    coral:   { f: 0.0545, k: 0.0620 },
    mitosis: { f: 0.0367, k: 0.0649 },
    worms:   { f: 0.0460, k: 0.0630 },
    maze:    { f: 0.0290, k: 0.0570 },
    spots:   { f: 0.0250, k: 0.0600 },
    holes:   { f: 0.0390, k: 0.0580 },
    waves:   { f: 0.0140, k: 0.0450 },
    uskate:  { f: 0.0620, k: 0.0610 }
  };

  // ---- field setup ----------------------------------------------------
  function clearField() {
    for (var i = 0; i < SIZE; i++) {
      u[i] = 1.0;
      v[i] = 0.0;
    }
    generation = 0;
  }

  function seedSquare(cx, cy, r, vu, vv) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    for (var y = cy - r; y <= cy + r; y++) {
      for (var x = cx - r; x <= cx + r; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        var xx = ((x % N) + N) % N;
        var yy = ((y % N) + N) % N;
        var idx = yy * N + xx;
        u[idx] = vu;
        v[idx] = vv;
      }
    }
  }

  function seedCenter() {
    clearField();
    var c = N / 2;
    seedSquare(c, c, Math.max(4, Math.round(N * 0.04)), 0.5, 0.25);
  }

  function seedRandom() {
    clearField();
    var blobs = 8 + Math.floor(Math.random() * 10);
    for (var i = 0; i < blobs; i++) {
      var x = Math.random() * N;
      var y = Math.random() * N;
      seedSquare(x, y, 2 + Math.random() * 4, 0.5, 0.25);
    }
  }

  // ---- simulation step (9-point Laplacian, toroidal wrap) --------------
  function step() {
    var f = parseFloat(feed.value);
    var k = parseFloat(kill.value);
    for (var y = 0; y < N; y++) {
      var ym = ((y - 1 + N) % N) * N;
      var yp = ((y + 1) % N) * N;
      var yc = y * N;
      for (var x = 0; x < N; x++) {
        var xm = (x - 1 + N) % N;
        var xp = (x + 1) % N;
        var c = yc + x;

        var uc = u[c], vc = v[c];

        // Weighted Laplacian: orthogonal 0.2, diagonal 0.05, centre -1.0.
        var lapU = (u[yc + xm] + u[yc + xp] + u[ym + x] + u[yp + x]) * 0.2 +
                   (u[ym + xm] + u[ym + xp] + u[yp + xm] + u[yp + xp]) * 0.05 -
                   uc;
        var lapV = (v[yc + xm] + v[yc + xp] + v[ym + x] + v[yp + x]) * 0.2 +
                   (v[ym + xm] + v[ym + xp] + v[yp + xm] + v[yp + xp]) * 0.05 -
                   vc;

        var uvv = uc * vc * vc;
        u2[c] = uc + (DA * lapU - uvv + f * (1 - uc)) * DT;
        v2[c] = vc + (DB * lapV + uvv - (k + f) * vc) * DT;
      }
    }
    var tu = u; u = u2; u2 = tu;
    var tv = v; v = v2; v2 = tv;
    generation++;
  }

  // ---- rendering ------------------------------------------------------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "";
  }

  // Smooth dark-field palette indexed by V concentration (0..~0.4).
  function palette(t) {
    // clamp
    if (t < 0) t = 0; else if (t > 1) t = 1;
    // 4-stop gradient: bg -> teal -> accent -> bright
    var stops = [
      [0.00, [10, 14, 22]],
      [0.35, [22, 120, 110]],
      [0.65, [90, 209, 196]],
      [1.00, [234, 253, 248]]
    ];
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
    var data = img.data;
    for (var i = 0; i < SIZE; i++) {
      // V spans roughly 0..0.4 in most regimes; scale for vivid contrast.
      var t = v[i] / 0.4;
      var rgb = palette(t);
      var p = i * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    readout.textContent = "step " + generation +
      " · f " + parseFloat(feed.value).toFixed(4) +
      " · k " + parseFloat(kill.value).toFixed(4) +
      (running ? " · running" : " · paused");
  }

  // ---- loop -----------------------------------------------------------
  function loop(ts) {
    if (!running) return;
    var rate = parseInt(speed.value, 10) || 6;
    for (var s = 0; s < rate; s++) step();
    render();
    timer = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    playBtn.textContent = "⏸ Pause";
    playBtn.setAttribute("aria-pressed", "true");
    lastFrame = 0;
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

  // ---- painting -------------------------------------------------------
  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    var py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    var x = Math.floor(px);
    var y = Math.floor(py);
    if (x < 0 || x >= N || y < 0 || y >= N) return null;
    return { x: x, y: y };
  }

  function paintAt(c) {
    var r = parseInt(brush.value, 10) || 6;
    seedSquare(c.x, c.y, r, 0.5, 0.9);
    if (!running) render();
  }

  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    var c = cellFromEvent(ev);
    if (!c) return;
    painting = true;
    canvas.setPointerCapture(ev.pointerId);
    paintAt(c);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!painting) return;
    var c = cellFromEvent(ev);
    if (c) paintAt(c);
  });
  function endPaint(ev) {
    painting = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  }
  canvas.addEventListener("pointerup", endPaint);
  canvas.addEventListener("pointercancel", endPaint);

  // ---- share link (encodes the regime so a link reproduces the pattern) -
  function currentParams() {
    return { f: parseFloat(feed.value), k: parseFloat(kill.value),
             s: parseInt(speed.value, 10) };
  }

  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return false;
    try {
      var p = new URLSearchParams(h);
      var f = parseFloat(p.get("f"));
      var k = parseFloat(p.get("k"));
      var s = parseInt(p.get("s"), 10);
      if (!isNaN(f)) feed.value = f.toFixed(4);
      if (!isNaN(k)) kill.value = k.toFixed(4);
      if (!isNaN(s)) speed.value = s;
      syncLabels();
      return true;
    } catch (e) { return false; }
  }

  function share() {
    var p = currentParams();
    var h = "#f=" + p.f.toFixed(4) + "&k=" + p.k.toFixed(4) + "&s=" + p.s;
    history.replaceState(null, "", h);
    var url = location.origin + location.pathname + h;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link (regime) copied to clipboard"); },
        function () { flash("Link set in the URL bar (copy blocked)"); }
      );
    } else {
      flash("Link set in the URL bar");
    }
  }

  function syncLabels() {
    feedVal.textContent = parseFloat(feed.value).toFixed(4);
    killVal.textContent = parseFloat(kill.value).toFixed(4);
    speedVal.textContent = speed.value + " steps/frame";
    brushVal.textContent = brush.value + " px";
  }

  // ---- wiring ---------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  centerBtn.addEventListener("click", function () { stop(); seedCenter(); start(); });
  randomBtn.addEventListener("click", function () { stop(); seedRandom(); start(); });
  clearBtn.addEventListener("click", function () { stop(); clearField(); render(); });
  shareBtn.addEventListener("click", share);

  feed.addEventListener("input", syncLabels);
  kill.addEventListener("input", syncLabels);
  speed.addEventListener("input", syncLabels);
  brush.addEventListener("input", syncLabels);

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      var p = PRESETS[btn.dataset.preset];
      if (!p) return;
      feed.value = p.f.toFixed(4);
      kill.value = p.k.toFixed(4);
      syncLabels();
      stop();
      seedCenter();
      start();
      flash("Regime: " + btn.textContent);
    });
  });

  // ---- boot -----------------------------------------------------------
  canvas.width = N;
  canvas.height = N;
  syncLabels();
  restoreFromHash();
  seedCenter();
  render();
  start();
})();
