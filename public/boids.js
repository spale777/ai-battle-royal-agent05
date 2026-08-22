// agent-05 — Boids flocking (client-side, no backend).
// Each boid sees only its near neighbours and applies three urges every tick:
//   separation  — steer away from crowding,
//   alignment   — steer toward the average heading of neighbours,
//   cohesion    — steer toward the average position of neighbours.
// From those local rules and nothing else, a living flock emerges, splits,
// and reforms on its own — the textbook case of emergence (Reynolds, 1986).
(function () {
  "use strict";

  var canvas = document.getElementById("boids");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  var playBtn = document.getElementById("play");
  var resetBtn = document.getElementById("reset");
  var scatterBtn = document.getElementById("scatter");
  var shareBtn = document.getElementById("share");

  var countEl = document.getElementById("count");
  var speedEl = document.getElementById("speed");
  var sepEl = document.getElementById("sep");
  var aliEl = document.getElementById("ali");
  var cohEl = document.getElementById("coh");
  var countVal = document.getElementById("count-val");
  var speedVal = document.getElementById("speed-val");
  var sepVal = document.getElementById("sep-val");
  var aliVal = document.getElementById("ali-val");
  var cohVal = document.getElementById("coh-val");

  // Behaviour presets: full parameter sets that reproduce a distinct ecology.
  var PRESETS = {
    flock:   { count: 240, speed: 64, sep: 150, ali: 100, coh: 100 },
    peloton: { count: 300, speed: 80, sep: 90,  ali: 160, coh: 140 },
    river:   { count: 360, speed: 100, sep: 120, ali: 130, coh: 40  },
    wander:  { count: 120, speed: 40, sep: 200, ali: 60,  coh: 50  }
  };

  var W = 760, H = 470;        // logical (CSS-pixel) canvas size
  var dpr = 1;
  var boids = [];
  var running = true;
  var frame = 0;
  var mouse = { x: 0, y: 0, active: false };
  var mouseInside = false;

  // Cached theme colours, refreshed periodically so trails stay on-palette.
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

  // ---- boid setup -----------------------------------------------------
  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeBoid() {
    var ang = rand(0, Math.PI * 2);
    var sp = rand(1, 3);
    return {
      x: rand(0, W), y: rand(0, H),
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      hue: rand(0, 360)
    };
  }

  function seed(n) {
    boids = [];
    for (var i = 0; i < n; i++) boids.push(makeBoid());
    frame = 0;
  }

  // ---- parameters (read live from sliders) ----------------------------
  function maxSpeed() { return Math.max(0.5, parseFloat(speedEl.value) / 10); } // px/frame
  function perception() { return 58; }                  // neighbour radius (px)
  function sepRadius() { return 26; }                   // separation radius (px)
  function wSep() { return parseFloat(sepEl.value) / 100; }
  function wAli() { return parseFloat(aliEl.value) / 100; }
  function wCoh() { return parseFloat(cohEl.value) / 100; }

  // ---- simulation step ------------------------------------------------
  function step() {
    var ms = maxSpeed();
    var R = perception();
    var R2 = R * R;
    var sr = sepRadius();
    var sr2 = sr * sr;
    var ws = wSep(), wa = wAli(), wc = wCoh();
    var n = boids.length;

    // Toroidal distance helper keeps the flock continuous across edges.
    function wrapDelta(d, half) { if (d > half) d -= 2 * half; else if (d < -half) d += 2 * half; return d; }

    for (var i = 0; i < n; i++) {
      var b = boids[i];
      var sx = 0, sy = 0;          // separation accumulator
      var ax = 0, ay = 0;          // alignment accumulator
      var cx = 0, cy = 0;          // cohesion accumulator (positions)
      var seen = 0;

      for (var j = 0; j < n; j++) {
        if (j === i) continue;
        var o = boids[j];
        var dx = wrapDelta(o.x - b.x, W);
        var dy = wrapDelta(o.y - b.y, H);
        var d2 = dx * dx + dy * dy;
        if (d2 > R2 || d2 === 0) continue;
        seen++;
        ax += o.vx; ay += o.vy;            // alignment: sum neighbour velocities
        cx += o.x; cy += o.y;              // cohesion: sum neighbour positions
        if (d2 < sr2) {                    // separation: push away, weighted by 1/d
          var inv = 1 / Math.sqrt(d2);
          sx -= dx * inv;
          sy -= dy * inv;
        }
      }

      var fx = 0, fy = 0;
      if (seen > 0) {
        // Cohesion: steer toward the centre of neighbours.
        cx = cx / seen - b.x; cy = cy / seen - b.y;
        var cl = Math.hypot(cx, cy) || 1;
        fx += (cx / cl) * wc; fy += (cy / cl) * wc;
        // Alignment: steer toward average neighbour heading.
        var al = Math.hypot(ax, ay) || 1;
        fx += (ax / al) * wa; fy += (ay / al) * wa;
        // Separation: steer away from crowding.
        var sl = Math.hypot(sx, sy) || 1;
        fx += (sx / sl) * ws; fy += (sy / sl) * ws;
      }

      // Mouse attraction: pull a local region toward the cursor while dragging.
      if (mouse.active && mouseInside) {
        var mdx = wrapDelta(mouse.x - b.x, W);
        var mdy = wrapDelta(mouse.y - b.y, H);
        var md2 = mdx * mdx + mdy * mdy;
        if (md2 < 180 * 180) {
          var ml = Math.sqrt(md2) || 1;
          fx += (mdx / ml) * 2.2;  // strong, so the flock chases the cursor
          fy += (mdy / ml) * 2.2;
        }
      }

      // Integrate (velocity Verlet-ish: v += f, clamp speed).
      b.vx += fx; b.vy += fy;
      var sp = Math.hypot(b.vx, b.vy);
      if (sp > ms) { b.vx = b.vx / sp * ms; b.vy = b.vy / sp * ms; }
      else if (sp < ms * 0.25 && sp > 0) { // keep things moving
        b.vx = b.vx / sp * ms * 0.25; b.vy = b.vy / sp * ms * 0.25;
      }
      b.x += b.vx; b.y += b.vy;

      // Wrap around the torus.
      if (b.x < 0) b.x += W; else if (b.x >= W) b.x -= W;
      if (b.y < 0) b.y += H; else if (b.y >= H) b.y -= H;
    }
    frame++;
  }

  // ---- rendering ------------------------------------------------------
  function render() {
    // Solid clear (theme-aware) so motion reads cleanly.
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      var sp = Math.hypot(b.vx, b.vy) || 1;
      var ux = b.vx / sp, uy = b.vy / sp;     // unit heading
      var px = -uy, py = ux;                   // perpendicular
      var L = 9, Wd = 4.2;
      // Triangle: nose at +L*heading, two tail corners behind.
      var x1 = b.x + ux * L,            y1 = b.y + uy * L;
      var x2 = b.x - ux * L * 0.5 + px * Wd, y2 = b.y - uy * L * 0.5 + py * Wd;
      var x3 = b.x - ux * L * 0.5 - px * Wd, y3 = b.y - uy * L * 0.5 - py * Wd;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      ctx.fillStyle = "hsl(" + Math.round(b.hue) + ", 72%, 58%)";
      ctx.fill();
    }

    readout.textContent =
      "boids " + boids.length +
      " · speed " + maxSpeed().toFixed(1) +
      " · sep " + parseFloat(sepEl.value) +
      " · ali " + parseFloat(aliEl.value) +
      " · coh " + parseFloat(cohEl.value) +
      (running ? " · running" : " · paused");
  }

  // ---- loop -----------------------------------------------------------
  var timer = null;
  function loop() {
    if (!running) return;
    step();
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

  // ---- share link (encodes the live parameters) ----------------------
  function currentParams() {
    return {
      n: parseInt(countEl.value, 10),
      s: parseInt(speedEl.value, 10),
      sep: parseInt(sepEl.value, 10),
      ali: parseInt(aliEl.value, 10),
      coh: parseInt(cohEl.value, 10)
    };
  }

  function applyParams(p) {
    if (p.n != null) countEl.value = p.n;
    if (p.s != null) speedEl.value = p.s;
    if (p.sep != null) sepEl.value = p.sep;
    if (p.ali != null) aliEl.value = p.ali;
    if (p.coh != null) cohEl.value = p.coh;
    syncLabels();
  }

  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return false;
    try {
      var p = new URLSearchParams(h);
      applyParams({
        n: parseInt(p.get("n"), 10),
        s: parseInt(p.get("s"), 10),
        sep: parseInt(p.get("sep"), 10),
        ali: parseInt(p.get("ali"), 10),
        coh: parseInt(p.get("coh"), 10)
      });
      return true;
    } catch (e) { return false; }
  }

  function share() {
    var p = currentParams();
    var h = "#n=" + p.n + "&s=" + p.s + "&sep=" + p.sep + "&ali=" + p.ali + "&coh=" + p.coh;
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
    countVal.textContent = countEl.value;
    speedVal.textContent = maxSpeed().toFixed(1);
    sepVal.textContent = sepEl.value;
    aliVal.textContent = aliEl.value;
    cohVal.textContent = cohEl.value;
  }

  // ---- wiring ---------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  resetBtn.addEventListener("click", function () {
    seed(parseInt(countEl.value, 10)); render();
    flash("Flock reset");
  });
  scatterBtn.addEventListener("click", function () {
    for (var i = 0; i < boids.length; i++) {
      var ang = rand(0, Math.PI * 2), sp = maxSpeed() * rand(0.8, 1.6);
      boids[i].vx = Math.cos(ang) * sp;
      boids[i].vy = Math.sin(ang) * sp;
    }
    flash("Scattered");
  });
  shareBtn.addEventListener("click", share);

  [countEl, speedEl, sepEl, aliEl, cohEl].forEach(function (el) {
    el.addEventListener("input", function () {
      syncLabels();
      // Re-seed only when the population size actually changes.
      if (el === countEl) seed(parseInt(countEl.value, 10));
    });
  });

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      var p = PRESETS[btn.dataset.preset];
      if (!p) return;
      countEl.value = p.count; speedEl.value = p.speed;
      sepEl.value = p.sep; aliEl.value = p.ali; cohEl.value = p.coh;
      syncLabels();
      seed(p.count);
      if (!running) start();
      flash("Behaviour: " + btn.textContent);
    });
  });

  // Mouse drag pulls a local flock toward the cursor.
  function posFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (W / rect.width),
      y: (ev.clientY - rect.top) * (H / rect.height)
    };
  }
  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    mouse.active = true; mouseInside = true;
    var p = posFromEvent(ev); mouse.x = p.x; mouse.y = p.y;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", function (ev) {
    var p = posFromEvent(ev); mouse.x = p.x; mouse.y = p.y;
    if (ev.pointerType !== "mouse") mouseInside = true;
  });
  function endDrag(ev) {
    mouse.active = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerenter", function () { mouseInside = true; });
  canvas.addEventListener("pointerleave", function (ev) {
    mouseInside = false;
    if (!ev || ev.pointerType === "mouse") mouse.active = false; // mouse leaves -> stop pull
  });

  window.addEventListener("resize", function () {
    resize();
    // Always repaint immediately so the canvas is never left blank after the
    // bitmap is reset by resize() (even while the loop is running but a frame
    // hasn't painted yet).
    render();
  });

  // ---- boot -----------------------------------------------------------
  resize();
  refreshTheme();
  setInterval(refreshTheme, 1500);  // keep trails on-palette across theme switches
  syncLabels();
  restoreFromHash();
  seed(parseInt(countEl.value, 10));
  render();
  start();
})();
