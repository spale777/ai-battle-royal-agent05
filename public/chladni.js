/* Chladni plate / cymatics — agent-05 (v5.2)
 *
 * A standing-wave figure on a square plate. Each point (x,y) in [0,1]^2 has a
 * vibration amplitude given by a superposition of plate modes, e.g.
 *   f(x,y) = sin(a*pi*x)*sin(b*pi*y) + sin(b*pi*x)*sin(a*pi*y)
 * Points where f(x,y) = 0 are the nodal lines — the plate is (nearly) still
 * there. In the classic Chladni experiment you sprinkle sand on a vibrating
 * plate; the grains bounce until they fall into the quiet nodal lines and
 * settle, painting the figure.
 *
 * This sim reproduces that with N independent agents doing a random walk whose
 * step size scales with |f(x,y)| at their current position: where the plate is
 * loud they take big jittery steps, where it is quiet they barely move and get
 * "stuck". Over a few thousand steps the population condenses onto the nodal
 * lines. It is a *stochastic aggregation* model — a different mechanism class
 * from the cellular / lattice / ODE models already in the zoo.
 *
 * Deterministic: every random choice (initial scatter + walk) is driven by a
 * single mulberry32 PRNG seeded from "Seed", so a share link reproduces the
 * exact same settling. Dual-mode: under Node it runs a determinism self-test.
 */
(function (global) {
  "use strict";

  // --- deterministic PRNG -------------------------------------------------
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- the standing-wave field -------------------------------------------
  // Returns the signed vibration amplitude at normalized coords (x,y) in [0,1].
  function field(x, y, p) {
    var pi = Math.PI;
    var a = p.a, b = p.b, m = p.m, n = p.n;
    var v;
    if (p.mode === "cross") {
      v = Math.sin(a * pi * x) * Math.sin(b * pi * y)
        + Math.sin(b * pi * x) * Math.sin(a * pi * y);
    } else if (p.mode === "diag") {
      v = Math.sin(a * pi * (x + y)) * Math.sin(b * pi * (x - y))
        + Math.sin(b * pi * (x + y)) * Math.sin(a * pi * (x - y));
    } else if (p.mode === "radial") {
      // a radial standing wave about the plate centre — concentric rings
      var r = Math.sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)) * 2;
      v = Math.cos(a * pi * r) * Math.cos(b * pi * r);
    } else {
      // "superpose": two orthogonal standing waves with independent mode numbers
      v = Math.sin(m * pi * x) * Math.sin(n * pi * y)
        + Math.sin(a * pi * x) * Math.sin(b * pi * y);
    }
    return v;
  }

  // --- the model (no DOM) --------------------------------------------------
  function ChladniModel(opts) {
    opts = opts || {};
    this.N = opts.N || 4000;
    this.a = (opts.a != null) ? opts.a : 4;
    this.b = (opts.b != null) ? opts.b : 3;
    this.m = (opts.m != null) ? opts.m : 2;
    this.n = (opts.n != null) ? opts.n : 5;
    this.mode = opts.mode || "cross";
    this.minWalk = (opts.minWalk != null) ? opts.minWalk : 0.0008;
    this.maxWalk = (opts.maxWalk != null) ? opts.maxWalk : 0.018;
    this.rng = mulberry32((opts.seed != null ? opts.seed : 1) >>> 0);
    this.steps = 0;
    this.xs = new Float64Array(this.N);
    this.ys = new Float64Array(this.N);
    this._init();
  }

  ChladniModel.prototype._init = function () {
    for (var i = 0; i < this.N; i++) {
      this.xs[i] = this.rng();
      this.ys[i] = this.rng();
    }
    this.steps = 0;
  };

  // One step: every particle jitters proportional to |amplitude| at its spot.
  ChladniModel.prototype.step = function () {
    var a = this.a, b = this.b, m = this.m, n = this.n, mode = this.mode;
    var params = { a: a, b: b, m: m, n: n, mode: mode };
    var minW = this.minWalk, maxW = this.maxWalk;
    var rng = this.rng, xs = this.xs, ys = this.ys, N = this.N;
    for (var i = 0; i < N; i++) {
      var amp = field(xs[i], ys[i], params);
      var w = minW + (maxW - minW) * Math.abs(amp);
      // uniformly random direction in the unit disc
      var ang = rng() * 6.283185307179586;
      var r = Math.sqrt(rng()) * w;
      var nx = xs[i] + Math.cos(ang) * r;
      var ny = ys[i] + Math.sin(ang) * r;
      // reflect at the plate edge (a real plate has fixed boundaries)
      if (nx < 0) nx = -nx; else if (nx > 1) nx = 2 - nx;
      if (ny < 0) ny = -ny; else if (ny > 1) ny = 2 - ny;
      xs[i] = nx; ys[i] = ny;
    }
    this.steps++;
  };

  // Fraction of particles that are "settled" (sitting on a near-node, |amp| tiny).
  ChladniModel.prototype.metrics = function () {
    var p = { a: this.a, b: this.b, m: this.m, n: this.n, mode: this.mode };
    var settled = 0, sumAbs = 0;
    for (var i = 0; i < this.N; i++) {
      var amp = Math.abs(field(this.xs[i], this.ys[i], p));
      sumAbs += amp;
      if (amp < 0.15) settled++;
    }
    return {
      settledFraction: settled / this.N,
      meanAbsAmp: sumAbs / this.N,
      steps: this.steps,
      N: this.N
    };
  };

  // --- palettes (grain colour on the plate) -------------------------------
  var PALETTES = {
    sand:    { grain: [226, 196, 136], plate: [24, 20, 16], line: [120, 96, 60] },
    ink:     { grain: [235, 235, 240], plate: [16, 18, 24], line: [90, 96, 120] },
    ember:   { grain: [255, 152, 64],  plate: [22, 12, 8],  line: [150, 60, 24] },
    ice:     { grain: [120, 210, 255], plate: [10, 20, 34], line: [50, 110, 160] },
    mono:    { grain: [245, 245, 245], plate: [22, 23, 28], line: [120, 120, 120] }
  };

  // --- node density helper for rendering a ghost of the field -------------
  function ampAt(x, y, a, b, m, n, mode) {
    return field(x, y, { a: a, b: b, m: m, n: n, mode: mode });
  }

  // --- node self-test (determinism + condensation) ------------------------
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ChladniModel: ChladniModel, mulberry32: mulberry32, field: field };
    if (require.main === module) {
      function run(seed, a, b, mode, N) {
        var m = new ChladniModel({ seed: seed, a: a, b: b, mode: mode, N: N });
        for (var i = 0; i < 2500; i++) m.step();
        var mt = m.metrics();
        // crude fingerprint of the settled layout for determinism check
        var fp = 0;
        for (var k = 0; k < m.N; k += 37) fp += m.xs[k] * 1e6 + m.ys[k];
        return { metrics: mt, fp: fp };
      }
      var A = run(12345, 4, 3, "cross", 2000);
      var B = run(12345, 4, 3, "cross", 2000);
      var C = run(12346, 4, 3, "cross", 2000);
      var sameSeed = Math.abs(A.fp - B.fp) < 1e-6 && A.metrics.steps === B.metrics.steps;
      var diffSeed = Math.abs(A.fp - C.fp) > 1e-3;
      var condenses = A.metrics.settledFraction > 0.6; // most grains land near nodes
      var ok = sameSeed && diffSeed && condenses;
      console.log(JSON.stringify({
        A: A.metrics, B: B.metrics, C: C.metrics,
        sameSeedIdentical: sameSeed, diffSeedDiverges: diffSeed,
        condensesOntoNodes: condenses, ok: ok
      }, null, 2));
      process.exit(ok ? 0 : 1);
    }
    return;
  }

  // --- browser UI ---------------------------------------------------------
  if (typeof document === "undefined") return;

  function $(id) { return document.getElementById(id); }

  var canvas, ctx, model, raf = null, running = true;
  var state = {
    seed: 12345, a: 4, b: 3, m: 2, n: 5, mode: "cross",
    N: 4000, palette: "sand", speed: 8, ghost: true
  };

  function draw() {
    var W = canvas.width, H = canvas.height;
    var pal = PALETTES[state.palette] || PALETTES.sand;
    // plate background
    ctx.fillStyle = "rgb(" + pal.plate.join(",") + ")";
    ctx.fillRect(0, 0, W, H);

    // optional faint ghost of the amplitude field (blue where loud, dark on nodes)
    if (state.ghost) {
      var g = ctx.createImageData(W, H);
      var pp = { a: state.a, b: state.b, m: state.m, n: state.n, mode: state.mode };
      for (var py = 0; py < H; py++) {
        for (var px = 0; px < W; px++) {
          var amp = Math.abs(field(px / W, py / H, pp));
          var t = Math.min(1, amp / 2); // 0 at node, 1 far away
          var o = (py * W + px) * 4;
          g.data[o]     = pal.plate[0] + (pal.line[0] - pal.plate[0]) * t * 0.5;
          g.data[o + 1] = pal.plate[1] + (pal.line[1] - pal.plate[1]) * t * 0.5;
          g.data[o + 2] = pal.plate[2] + (pal.line[2] - pal.plate[2]) * t * 0.5;
          g.data[o + 3] = 255;
        }
      }
      ctx.putImageData(g, 0, 0);
    }

    // grains
    ctx.fillStyle = "rgb(" + pal.grain.join(",") + ")";
    var xs = model.xs, ys = model.ys, N = model.N;
    var dot = N > 6000 ? 1 : 1.6;
    for (var i = 0; i < N; i++) {
      var cx = xs[i] * W, cy = ys[i] * H;
      ctx.fillRect(cx, cy, dot, dot);
    }
  }

  function readout() {
    var m = model.metrics();
    var pc = (m.settledFraction * 100).toFixed(1);
    var note = m.settledFraction > 0.6
      ? "grains have condensed onto the nodal lines"
      : "still bouncing — loud regions keep scattering the grains";
    $("readout").innerHTML =
      "<div class=\"ro-row\"><span>step</span><b>" + m.steps + "</b></div>" +
      "<div class=\"ro-row\"><span>grains settled on nodes</span><b>" + pc + "%</b></div>" +
      "<div class=\"ro-row\"><span>grains</span><b>" + m.N + "</b></div>" +
      "<div class=\"ro-note\">" + note + "</div>";
  }

  function frame() {
    if (running) {
      for (var i = 0; i < state.speed; i++) model.step();
      draw();
      readout();
    }
    raf = requestAnimationFrame(frame);
  }

  function setRunning(on) {
    running = on;
    var btn = $("play");
    btn.textContent = on ? "⏸ Pause" : "▶ Play";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function rebuild() {
    model = new ChladniModel({
      seed: state.seed, a: state.a, b: state.b, m: state.m, n: state.n,
      mode: state.mode, N: state.N
    });
    draw();
    readout();
  }

  function encodeState() {
    return [state.seed, state.a, state.b, state.m, state.n, state.mode, state.N, state.palette, state.ghost ? 1 : 0].join(",");
  }

  function decodeState(hash) {
    var parts = hash.replace(/^#/, "").split(",");
    if (parts.length < 9) return false;
    var s = state;
    s.seed = parseInt(parts[0], 10) || 1;
    s.a = Math.max(1, Math.min(12, parseInt(parts[1], 10) || 4));
    s.b = Math.max(1, Math.min(12, parseInt(parts[2], 10) || 3));
    s.m = Math.max(1, Math.min(12, parseInt(parts[3], 10) || 2));
    s.n = Math.max(1, Math.min(12, parseInt(parts[4], 10) || 5));
    s.mode = ["cross", "diag", "radial", "superpose"].indexOf(parts[5]) >= 0 ? parts[5] : "cross";
    s.N = [2000, 4000, 8000, 12000].indexOf(parseInt(parts[6], 10)) >= 0 ? parseInt(parts[6], 10) : 4000;
    s.palette = PALETTES[parts[7]] ? parts[7] : "sand";
    s.ghost = parts[8] === "1";
    return true;
  }

  function applyControls() {
    $("seed").value = state.seed; $("seed-val").textContent = state.seed;
    $("a").value = state.a; $("a-val").textContent = state.a;
    $("b").value = state.b; $("b-val").textContent = state.b;
    $("m").value = state.m; $("m-val").textContent = state.m;
    $("n").value = state.n; $("n-val").textContent = state.n;
    $("mode").value = state.mode;
    $("N").value = String(state.N);
    $("palette").value = state.palette;
    $("ghost").checked = state.ghost;
  }

  function syncFromControls() {
    state.seed = parseInt($("seed").value, 10) || 1;
    state.a = parseInt($("a").value, 10);
    state.b = parseInt($("b").value, 10);
    state.m = parseInt($("m").value, 10);
    state.n = parseInt($("n").value, 10);
    state.mode = $("mode").value;
    state.N = parseInt($("N").value, 10);
    state.palette = $("palette").value;
    state.ghost = $("ghost").checked;
    state.speed = parseInt($("speed").value, 10);
  }

  function msg(t) { $("msg").textContent = t || ""; }

  function init() {
    canvas = $("chladni");
    ctx = canvas.getContext("2d");

    if (location.hash && decodeState(location.hash)) applyControls();

    var presets = {
      classic: { a: 4, b: 3, m: 2, n: 5, mode: "cross" },
      web:     { a: 5, b: 5, m: 3, n: 4, mode: "cross" },
      diag:    { a: 3, b: 2, m: 2, n: 6, mode: "diag" },
      rings:   { a: 6, b: 4, m: 2, n: 5, mode: "radial" },
      super:   { a: 3, b: 4, m: 6, n: 2, mode: "superpose" }
    };
    Array.prototype.forEach.call(document.querySelectorAll(".preset"), function (btn) {
      btn.addEventListener("click", function () {
        var p = presets[btn.getAttribute("data-preset")];
        if (!p) return;
        Object.assign(state, p);
        applyControls();
        rebuild();
        msg("Preset loaded — press Play if paused.");
      });
    });

    ["seed", "a", "b", "m", "n", "mode", "N", "palette", "ghost", "speed"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        syncFromControls();
        if (id === "palette" || id === "ghost" || id === "speed") { draw(); readout(); return; }
        rebuild();
      });
    });

    $("play").addEventListener("click", function () { setRunning(!running); });
    $("step").addEventListener("click", function () {
      setRunning(false); model.step(); draw(); readout();
    });
    $("reset").addEventListener("click", function () {
      model = new ChladniModel({
        seed: state.seed, a: state.a, b: state.b, m: state.m, n: state.n,
        mode: state.mode, N: state.N
      });
      draw(); readout();
    });
    $("shake").addEventListener("click", function () {
      // re-scatter the grains evenly across the plate, keep the same field
      model = new ChladniModel({
        seed: state.seed, a: state.a, b: state.b, m: state.m, n: state.n,
        mode: state.mode, N: state.N
      });
      draw(); readout();
      msg("Re-scattered the grains onto a clean plate.");
    });
    $("share").addEventListener("click", function () {
      syncFromControls();
      var url = location.origin + location.pathname + "#" + encodeState();
      history.replaceState(null, "", "#" + encodeState());
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          function () { msg("Share link copied — it reproduces this exact run."); },
          function () { msg("Share link in the address bar."); }
        );
      } else { msg("Share link in the address bar."); }
    });

    rebuild();
    setRunning(true);
    frame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  global.ChladniModel = ChladniModel;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
