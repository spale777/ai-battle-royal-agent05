/*
 * fluid.js — a real-time 2D incompressible fluid simulation (canvas).
 *
 * Method: Jos Stam's "Stable Fluids" (1999) as popularised in his GDC
 * "Real-Time Fluid Dynamics for Games" note. Each step we solve, on a grid:
 *
 *   1. add forces        — mouse drag / emitters push velocity + lay dye
 *   2. diffuse velocity  — viscosity (Gauss–Seidel relaxation)
 *   3. project           — a pressure solve that makes the field
 *                          divergence-free (incompressible), which is what
 *                          makes it swirl instead of just smear
 *   4. advect            — move velocity & dye along the (now divergence-free)
 *                          field, with semi-Lagrangian backtracing
 *   5. project again
 *
 * Dye is three independent fields (r,g,b) advected by the same velocity, so
 * colours fold and mix like real ink. A single seeded PRNG (mulberry32) drives
 * every random choice (scene splats, emitter jitter, rainbow spread), so a given
 * seed + scene reproduces the exact same opening swirl. Fully client-side, no
 * backend.
 *
 * Headless self-test: run `node public/fluid.js` — it builds a scene, steps the
 * solver, hashes the dye, and asserts same-seed reproducibility and that a
 * different seed / different scene diverges. Exits non-zero on failure.
 */
(function () {
  "use strict";

  // ---- grid -------------------------------------------------------------
  var N = 160;                 // interior cells per side (square grid)
  var SIZE = (N + 2) * (N + 2); // includes 1-cell boundary ring
  var ITER = 16;               // Gauss–Seidel iterations for diffusion/project
  var DT = 0.12;               // simulation timestep

  function IX(i, j) { return i + (N + 2) * j; }

  // ---- tunables (live) ---------------------------------------------------
  var Sim = {
    seed: 1234,
    scene: "stir",
    dye: "warm",
    palette: "natural",
    brush: 12,
    force: 9,
    visc: 0,
    fade: 6,
    frame: 0
  };

  // ---- buffers -----------------------------------------------------------
  // All fields live in one object so we can swap references (Stam's SWAP).
  var A = {
    u: new Float32Array(SIZE),  v: new Float32Array(SIZE),
    u0: new Float32Array(SIZE), v0: new Float32Array(SIZE),
    rd: new Float32Array(SIZE), gd: new Float32Array(SIZE), bd: new Float32Array(SIZE),
    rd0: new Float32Array(SIZE), gd0: new Float32Array(SIZE), bd0: new Float32Array(SIZE),
    p: new Float32Array(SIZE),  div: new Float32Array(SIZE)
  };
  function swap(a, b) { var t = A[a]; A[a] = A[b]; A[b] = t; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1234);
  function seedRng(s) { Sim.seed = (s >>> 0) || 0; rng = mulberry32(Sim.seed); }

  // ---- solvers -----------------------------------------------------------
  function add_source(x, s, dt) {
    for (var i = 0; i < SIZE; i++) x[i] += dt * s[i];
  }

  // Boundary handling. b: 0 = scalar (copy), 1 = horizontal vel (reflect x),
  // 2 = vertical vel (reflect y).
  function set_bnd(b, x) {
    for (var i = 1; i <= N; i++) {
      x[IX(0, i)]     = (b === 1) ? -x[IX(1, i)] : x[IX(1, i)];
      x[IX(N + 1, i)] = (b === 1) ? -x[IX(N, i)] : x[IX(N, i)];
      x[IX(i, 0)]     = (b === 2) ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, N + 1)] = (b === 2) ? -x[IX(i, N)] : x[IX(i, N)];
    }
    x[IX(0, 0)]         = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, N + 1)]     = 0.5 * (x[IX(1, N + 1)] + x[IX(0, N)]);
    x[IX(N + 1, 0)]     = 0.5 * (x[IX(N, 0)] + x[IX(N + 1, 1)]);
    x[IX(N + 1, N + 1)] = 0.5 * (x[IX(N, N + 1)] + x[IX(N + 1, N)]);
  }

  function lin_solve(b, x, x0, a, c, iter) {
    var cinv = 1.0 / c;
    for (var k = 0; k < iter; k++) {
      for (var j = 1; j <= N; j++) {
        for (var i = 1; i <= N; i++) {
          var idx = IX(i, j);
          x[idx] = (x0[idx] + a * (x[idx - 1] + x[idx + 1] +
                                   x[idx - (N + 2)] + x[idx + (N + 2)])) * cinv;
        }
      }
      set_bnd(b, x);
    }
  }

  function diffuse(b, x, x0, diff, dt) {
    var a = dt * diff * N * N;
    lin_solve(b, x, x0, a, 1 + 4 * a, ITER);
  }

  function advect(b, d, d0, u, v, dt) {
    var dt0 = dt * N;
    for (var j = 1; j <= N; j++) {
      for (var i = 1; i <= N; i++) {
        var idx = IX(i, j);
        var x = i - dt0 * u[idx];
        var y = j - dt0 * v[idx];
        if (x < 0.5) x = 0.5; if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5; if (y > N + 0.5) y = N + 0.5;
        var i0 = Math.floor(x), i1 = i0 + 1;
        var j0 = Math.floor(y), j1 = j0 + 1;
        var s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
        d[idx] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) +
                 s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
      }
    }
    set_bnd(b, d);
  }

  function project(u, v, p, div) {
    var h = 1.0 / N;
    for (var j = 1; j <= N; j++) {
      for (var i = 1; i <= N; i++) {
        var idx = IX(i, j);
        div[idx] = -0.5 * h * (u[idx + 1] - u[idx - 1] + v[idx + (N + 2)] - v[idx - (N + 2)]);
        p[idx] = 0;
      }
    }
    set_bnd(0, div); set_bnd(0, p);
    lin_solve(0, p, div, 1, 4, ITER);
    for (var j2 = 1; j2 <= N; j2++) {
      for (var i2 = 1; i2 <= N; i2++) {
        var k = IX(i2, j2);
        u[k] -= 0.5 * (p[k + 1] - p[k - 1]) / h;
        v[k] -= 0.5 * (p[k + (N + 2)] - p[k - (N + 2)]) / h;
      }
    }
    set_bnd(1, u); set_bnd(2, v);
  }

  function vel_step(dt) {
    add_source(A.u, A.u0, dt);
    add_source(A.v, A.v0, dt);
    if (Sim.visc > 0) {
      swap("u0", "u"); diffuse(1, A.u, A.u0, Sim.visc, dt);
      swap("v0", "v"); diffuse(2, A.v, A.v0, Sim.visc, dt);
    }
    // NOTE: do NOT swap u/v here when skipping diffusion — the velocity must
    // stay in u/v so project() sees it. project() uses u0/v0 only as scratch
    // (it zeroes and overwrites them), so their contents don't matter.
    project(A.u, A.v, A.u0, A.v0);
    // velocity now lives in u/v; swap so the advect step reads it from u0/v0
    // and writes the result back into the u/v slots.
    swap("u0", "u"); swap("v0", "v");
    advect(1, A.u, A.u0, A.u0, A.v0, dt);
    advect(2, A.v, A.v0, A.u0, A.v0, dt);
    project(A.u, A.v, A.u0, A.v0);
  }

  function dens_step(ch, dt) {
    var d = ch, d0 = ch + "0";
    add_source(A[d], A[d0], dt);
    swap(d, d0);
    advect(0, A[d], A[d0], A.u, A.v, dt);
  }

  // ---- dye colour helpers -----------------------------------------------
  function dyeColor(out, dye, x, y) {
    // Returns [r,g,b] in 0..1 for an injection at grid cell (x,y).
    if (dye === "cool") { out[0] = 0.12; out[1] = 0.55; out[2] = 1.0; }
    else if (dye === "ink") { out[0] = 0.92; out[1] = 0.93; out[2] = 0.97; }
    else if (dye === "rainbow") {
      var hue = ((Sim.seed % 360) + (x / N) * 300 + (y / N) * 60) % 360;
      hsv2rgb(out, hue, 0.85, 1.0);
    } else { // warm
      out[0] = 1.0; out[1] = 0.5; out[2] = 0.16;
    }
  }

  function hsv2rgb(out, h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    out[0] = r + m; out[1] = g + m; out[2] = b + m;
  }

  // ---- emitters (continuous sources) ------------------------------------
  var emitters = [];
  function buildEmitters(scene) {
    emitters = [];
    if (scene === "fountain") {
      var fx = (N / 2) + (Sim.seed % 24 - 12);
      emitters.push({ x: fx, y: N - 6, vx: 0, vy: -6.0, r: 0.9, g: 0.95, b: 0.7, rad: 4 });
    } else if (scene === "vortex") {
      var ox = (Sim.seed % 20) - 10;
      emitters.push({ x: N * 0.35 + ox, y: N * 0.45, vx: 0, vy: 3.0, r: 1.0, g: 0.4, b: 0.15, rad: 5 });
      emitters.push({ x: N * 0.65 - ox, y: N * 0.55, vx: 0, vy: -3.0, r: 0.15, g: 0.55, b: 1.0, rad: 5 });
    }
  }

  function applyEmitters() {
    for (var e = 0; e < emitters.length; e++) {
      var em = emitters[e];
      stampVel(A.u0, A.v0, em.x, em.y, em.vx, em.vy, em.rad);
      stampDye(A.rd0, A.gd0, A.bd0, em.x, em.y, em.r, em.g, em.b, em.rad);
    }
  }

  // Stamp helpers write INTO the buffers passed in. applyScene uses the STATE
  // buffers (u, v, rd, gd, bd); the per-step emitters and the mouse paint use
  // the *0 SOURCE buffers, which frameStep() zeroes at the top of each step.
  function stampVel(tU, tV, cx, cy, vx, vy, rad) {
    var r2 = rad * rad;
    for (var j = -rad; j <= rad; j++) {
      for (var i = -rad; i <= rad; i++) {
        var d2 = i * i + j * j; if (d2 > r2) continue;
        var x = Math.round(cx + i), y = Math.round(cy + j);
        if (x < 1 || x > N || y < 1 || y > N) continue;
        var f = 1 - d2 / r2;
        var idx = IX(x, y);
        tU[idx] += vx * f;
        tV[idx] += vy * f;
      }
    }
  }

  function stampDye(tR, tG, tB, cx, cy, dr, dg, db, rad) {
    var r2 = rad * rad;
    for (var j = -rad; j <= rad; j++) {
      for (var i = -rad; i <= rad; i++) {
        var d2 = i * i + j * j; if (d2 > r2) continue;
        var x = Math.round(cx + i), y = Math.round(cy + j);
        if (x < 1 || x > N || y < 1 || y > N) continue;
        var f = (1 - d2 / r2) * 1.2;
        var idx = IX(x, y);
        tR[idx] += dr * f; tG[idx] += dg * f; tB[idx] += db * f;
      }
    }
  }

  // ---- scenes (initial conditions) --------------------------------------
  function clearAll() {
    A.u.fill(0); A.v.fill(0); A.u0.fill(0); A.v0.fill(0);
    A.rd.fill(0); A.gd.fill(0); A.bd.fill(0);
    A.rd0.fill(0); A.gd0.fill(0); A.bd0.fill(0);
    Sim.frame = 0;
  }

  function addSwirl(cx, cy, r, k) {
    for (var j = -r; j <= r; j++) {
      for (var i = -r; i <= r; i++) {
        var d2 = i * i + j * j; if (d2 > r * r) continue;
        var x = Math.round(cx + i), y = Math.round(cy + j);
        if (x < 2 || x > N - 1 || y < 2 || y > N - 1) continue;
        var idx = IX(x, y);
        A.u[idx] += -j * k;   // tangential
        A.v[idx] += i * k;
      }
    }
  }

  function applyScene(scene) {
    clearAll();
    buildEmitters(scene);
    var col = [0, 0, 0];
    if (scene === "stir") {
      var ang = (Sim.seed / 360) * Math.PI * 2;
      addSwirl(N / 2, N / 2, N * 0.32, 0.9 + (Sim.seed % 7) * 0.12);
      dyeColor(col, Sim.dye, N / 2, N / 2);
      stampDye(A.rd, A.gd, A.bd, N / 2 + Math.cos(ang) * 30, N / 2 + Math.sin(ang) * 30,
               col[0], col[1], col[2], Math.round(N * 0.18));
    } else if (scene === "vortex") {
      addSwirl(N * 0.35, N * 0.45, N * 0.22, 1.4);
      addSwirl(N * 0.65, N * 0.55, N * 0.22, -1.4);
      dyeColor(col, Sim.dye, N * 0.35, N * 0.45);
      stampDye(A.rd, A.gd, A.bd, N * 0.35, N * 0.45, col[0], col[1], col[2], Math.round(N * 0.14));
      dyeColor(col, Sim.dye, N * 0.65, N * 0.55);
      stampDye(A.rd, A.gd, A.bd, N * 0.65, N * 0.55, col[0], col[1], col[2], Math.round(N * 0.14));
    } else if (scene === "splat") {
      var ns = 5 + (Sim.seed % 4);
      for (var s = 0; s < ns; s++) {
        var px = 20 + rng() * (N - 40);
        var py = 20 + rng() * (N - 40);
        var ang2 = rng() * Math.PI * 2;
        var sp = 2 + rng() * 4;
        stampVel(A.u, A.v, px, py, Math.cos(ang2) * sp, Math.sin(ang2) * sp, 6 + Math.round(rng() * 8));
        dyeColor(col, Sim.dye, px, py);
        stampDye(A.rd, A.gd, A.bd, px, py, col[0], col[1], col[2], 8 + Math.round(rng() * 10));
      }
    } else if (scene === "fountain") {
      // initial dye blob + the continuous emitter handles the rest
      dyeColor(col, Sim.dye, N / 2, N - 6);
      stampDye(A.rd, A.gd, A.bd, N / 2, N - 6, col[0], col[1], col[2], 10);
    } // "calm" → nothing
  }

  // ---- one simulation step (pure, no DOM) -------------------------------
  function frameStep() {
    A.u0.fill(0); A.v0.fill(0); A.rd0.fill(0); A.gd0.fill(0); A.bd0.fill(0);
    applyEmitters();
    vel_step(DT);
    dens_step("rd", DT);
    dens_step("gd", DT);
    dens_step("bd", DT);
    if (Sim.fade > 0) {
      var f = 1 - Sim.fade * 0.0006;
      for (var i = 0; i < SIZE; i++) {
        A.rd[i] *= f; A.gd[i] *= f; A.bd[i] *= f;
      }
    }
    Sim.frame++;
  }

  // =====================================================================
  //  DOM layer (browser only)
  // =====================================================================
  function initDOM() {
    var canvas = document.getElementById("fluid");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height; // N x N expected
    var img = ctx.createImageData(W, H);
    var running = true, rafId = null;
    var mouse = { down: false, x: 0, y: 0, px: 0, py: 0 };

    function $(id) { return document.getElementById(id); }
    function flash(text) { var m = $("msg"); if (m) m.textContent = text; }
    function clamp(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }

    function paint(mx, my, dx, dy) {
      var gx = Math.round((mx / W) * N);
      var gy = Math.round((my / H) * N);
      var col = [0, 0, 0]; dyeColor(col, Sim.dye, gx, gy);
      var f = Sim.force * 0.6;
      for (var j = -Sim.brush; j <= Sim.brush; j++) {
        for (var i = -Sim.brush; i <= Sim.brush; i++) {
          var d2 = i * i + j * j; if (d2 > Sim.brush * Sim.brush) continue;
          var x = gx + i, y = gy + j;
          if (x < 1 || x > N || y < 1 || y > N) continue;
          var w = 1 - d2 / (Sim.brush * Sim.brush);
          var idx = IX(x, y);
          A.u0[idx] += dx * f * w;
          A.v0[idx] += dy * f * w;
          A.rd0[idx] += col[0] * w;
          A.gd0[idx] += col[1] * w;
          A.bd0[idx] += col[2] * w;
        }
      }
    }

    function render() {
      var data = img.data;
      for (var j = 1; j <= N; j++) {
        for (var i = 1; i <= N; i++) {
          var idx = IX(i, j);
          // dye lives in ~0..1 (can overshoot); palette tweaks stay in that
          // range, then we scale to 8-bit for the canvas.
          var r = A.rd[idx], g = A.gd[idx], b = A.bd[idx];
          if (Sim.palette === "mono") {
            var y = 0.3 * r + 0.59 * g + 0.11 * b;
            r = y * 0.78; g = y * 0.85; b = y;
          } else if (Sim.palette === "neon") {
            r = r * 1.35; g = g * 1.35; b = b * 1.35;
          } else { // natural: dye dilutes as it mixes, so lift it a touch
            r = r * 2.6; g = g * 2.6; b = b * 2.6;
          }
          r *= 255; g *= 255; b *= 255;
          var p = ((i - 1) + (j - 1) * W) * 4;
          data[p] = clamp(r); data[p + 1] = clamp(g); data[p + 2] = clamp(b); data[p + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function updateReadout() {
      var ro = $("readout"); if (!ro) return;
      var total = 0;
      for (var i = 0; i < SIZE; i++) total += A.rd[i] + A.gd[i] + A.bd[i];
      ro.textContent = "frame " + Sim.frame + "  ·  dye ∑ " + total.toFixed(0) +
        "  ·  " + Sim.scene + " / " + Sim.dye;
    }

    function setRunning(r) {
      running = r;
      var btn = $("play");
      if (btn) { btn.textContent = r ? "⏸ Pause" : "▶ Play"; btn.setAttribute("aria-pressed", r ? "true" : "false"); }
      if (r && !rafId) rafId = requestAnimationFrame(frame);
    }

    function frame() {
      rafId = null;
      if (running) {
        if (mouse.down) paint(mouse.x, mouse.y, mouse.x - mouse.px, mouse.y - mouse.py);
        frameStep();
        render(); updateReadout();
        mouse.px = mouse.x; mouse.py = mouse.y;
      }
      if (running) rafId = requestAnimationFrame(frame);
    }

    // ---- input: mouse + touch ------------------------------------------
    function canvasPos(ev) {
      var rect = canvas.getBoundingClientRect();
      var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      var cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
      return { x: cx / rect.width * W, y: cy / rect.height * H };
    }
    function down(ev) {
      ev.preventDefault();
      var p = canvasPos(ev); mouse.down = true; mouse.x = p.x; mouse.y = p.y; mouse.px = p.x; mouse.py = p.y;
      setRunning(true);
    }
    function move(ev) {
      if (!mouse.down) return;
      ev.preventDefault();
      var p = canvasPos(ev); mouse.x = p.x; mouse.y = p.y;
    }
    function up() { mouse.down = false; }
    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);

    // ---- controls ------------------------------------------------------
    function bindRange(id, valId, fn) {
      var el = $(id); if (!el) return;
      el.addEventListener("input", function () {
        fn(parseInt(this.value, 10));
        var v = $(valId); if (v) v.textContent = this.value;
      });
    }
    bindRange("brush", "brush-val", function (v) { Sim.brush = v; });
    bindRange("force", "force-val", function (v) { Sim.force = v; });
    bindRange("visc", "visc-val", function (v) { Sim.visc = v / 100 * 0.0005; });
    bindRange("fade", "fade-val", function (v) { Sim.fade = v; });
    var pal = $("palette");
    if (pal) pal.addEventListener("change", function () { Sim.palette = this.value; render(); });
    var seedEl = $("seed");
    if (seedEl) seedEl.addEventListener("input", function () {
      seedRng(parseInt(this.value, 10) || 0); applyScene(Sim.scene); render(); updateReadout(); setRunning(true);
    });

    Array.prototype.forEach.call(document.querySelectorAll(".preset"), function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".preset").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        Sim.scene = btn.getAttribute("data-scene");
        seedRng(Sim.seed); applyScene(Sim.scene); render(); updateReadout(); setRunning(true);
        flash("Scene: " + Sim.scene + " (seed " + Sim.seed + ").");
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".mat"), function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".mat").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        Sim.dye = btn.getAttribute("data-dye");
        if (Sim.scene === "calm") { applyScene(Sim.scene); }
        render();
        flash("Dye: " + Sim.dye + ".");
      });
    });

    $("play").addEventListener("click", function () { setRunning(!running); });
    $("step").addEventListener("click", function () {
      setRunning(false); frameStep(); render(); updateReadout();
    });
    $("clear").addEventListener("click", function () {
      A.rd.fill(0); A.gd.fill(0); A.bd.fill(0); render(); updateReadout(); setRunning(true);
      flash("Dye cleared — stir to add more.");
    });
    $("reset").addEventListener("click", function () {
      seedRng(Sim.seed); applyScene(Sim.scene); render(); updateReadout(); setRunning(true);
      flash("Reset — rebuilt the opening swirl from seed " + Sim.seed + ".");
    });
    $("share").addEventListener("click", function () {
      var payload = { s: Sim.seed >>> 0, sc: Sim.scene, dy: Sim.dye };
      var enc = b64url(JSON.stringify(payload));
      var url = location.origin + location.pathname + "#f=" + enc;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { flash("Share link copied — it rebuilds this exact swirl."); },
          function () { location.hash = "f=" + enc; flash("Share link is in the address bar."); });
      } else { location.hash = "f=" + enc; flash("Share link is in the address bar."); }
    });

    // ---- boot ---------------------------------------------------------
    function b64url(s) { return encodeURIComponent(btoa(unescape(encodeURIComponent(s)))); }
    function b64urldec(s) {
      try { return decodeURIComponent(escape(atob(decodeURIComponent(s)))); }
      catch (e) { return ""; }
    }
    function applyShare(hash) {
      var m = hash.match(/[#&]f=([^&]+)/); if (!m) return false;
      try {
        var pl = JSON.parse(b64urldec(m[1]));
        if (typeof pl.s !== "number") return false;
        seedRng(pl.s >>> 0);
        if (pl.sc) Sim.scene = pl.sc;
        if (pl.dy) Sim.dye = pl.dy;
        return true;
      } catch (e) { return false; }
    }
    var fromHash = applyShare(location.hash);
    if (fromHash) {
      // reflect into controls
      if ($("seed")) $("seed").value = Sim.seed;
      Array.prototype.forEach.call(document.querySelectorAll(".preset"), function (b) {
        b.classList.toggle("active", b.getAttribute("data-scene") === Sim.scene);
      });
      Array.prototype.forEach.call(document.querySelectorAll(".mat"), function (b) {
        b.classList.toggle("active", b.getAttribute("data-dye") === Sim.dye);
      });
    }
    seedRng(Sim.seed);
    applyScene(Sim.scene);
    render(); updateReadout(); setRunning(true);
    if (fromHash) flash("Loaded a shared link — that exact swirl is restored.");
    else flash("Welcome — a fluid is settling. Drag to push it around.");
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  // ---- expose a tiny hook for headless harnesses -------------------------
  if (typeof window !== "undefined") {
    window.agentFluid = {
      reset: function (s, scene) { seedRng(s || 0); applyScene(scene || "stir"); },
      step: function (n) { n = n || 1; for (var k = 0; k < n; k++) frameStep(); },
      field: function () { return A; },
      N: N, MAT: {}
    };
  }

  // ---- headless self-test (Node) ---------------------------------------
  if (typeof window === "undefined" && typeof document === "undefined") {
    function hashField() {
      var h = 2166136261 >>> 0;
      var arr = [A.rd, A.gd, A.bd, A.u, A.v];
      for (var a = 0; a < arr.length; a++) {
        var f = arr[a];
        for (var i = 0; i < f.length; i++) {
          h ^= (Math.round(f[i] * 1000) & 0xff);
          h = Math.imul(h, 16777619) >>> 0;
        }
      }
      return h >>> 0;
    }
    function totalDye() {
      var t = 0;
      for (var i = 0; i < SIZE; i++) t += A.rd[i] + A.gd[i] + A.bd[i];
      return t;
    }
    function runSelfTest() {
      var steps = 400;
      function run(seed, scene) {
        Sim.fade = 0;            // isolate the solver: no dissipation, so any
                                 // surviving dye proves advection works.
        seedRng(seed); applyScene(scene);
        for (var s = 0; s < steps; s++) frameStep();
        return { h: hashField(), dye: totalDye() };
      }
      var A1 = run(12345, "splat");
      var A2 = run(12345, "splat");
      var C  = run(99999, "splat");
      var S1 = run(12345, "stir");
      var S2 = run(12345, "stir");
      var V  = run(12345, "vortex");

      var reproSplat = (A1.h === A2.h);
      var seedDiffers = (A1.h !== C.h);
      var reproStir = (S1.h === S2.h);
      var sceneDiffers = (A1.h !== S1.h) && (S1.h !== V.h);
      var nonEmpty = (A1.dye > 0.5) && (S1.dye > 0.5);
      var ok = reproSplat && seedDiffers && reproStir && sceneDiffers && nonEmpty;
      console.log("FLUID self-test: " + (ok ? "PASS" : "FAIL"));
      console.log("  splat same-seed reproducible (A1==A2): " + reproSplat + "  [" + A1.h + "]");
      console.log("  splat diff-seed diverges (A1!=C): " + seedDiffers + "  [C=" + C.h + "]");
      console.log("  stir same-seed reproducible (S1==S2): " + reproStir + "  [" + S1.h + "]");
      console.log("  scene diverges (splat!=stir, stir!=vortex): " + sceneDiffers);
      console.log("  dye present after 400 steps: " + nonEmpty + "  [splat dye=" + A1.dye.toFixed(1) + ", stir dye=" + S1.dye.toFixed(1) + "]");
      if (!ok) process.exit(1);
    }
    runSelfTest();
  }

  if (typeof document !== "undefined" && document.getElementById("fluid")) {
    initDOM();
  }
})();
