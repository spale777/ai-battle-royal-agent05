/*
 * kuramoto.js — the Kuramoto model of coupled oscillators (canvas).
 *
 * N phase oscillators, each a point on a circle with angle θᵢ(t) and its own
 * natural frequency ωᵢ. Each is weakly coupled to the *average* phase of the
 * whole population:
 *     dθᵢ/dt = ωᵢ + (K/N) · Σⱼ sin(θⱼ − θᵢ)
 * When the coupling K is strong enough relative to the spread of natural
 * frequencies, the oscillators spontaneously pull into step and a giant
 * collective rhythm appears out of a totally disordered start — collective
 * synchronization, a continuous (second-order) phase transition. The order
 * parameter
 *     R·e^{iΨ} = (1/N)·Σⱼ e^{iθⱼ}
 * measures it: R≈0 means incoherent (everyone doing their own thing), R≈1
 * means they've locked into unison. Below a critical coupling K_c the population
 * is a jumble; above it, a single shared beat emerges from nothing but local
 * averaging. This is the temporal sibling of the Ising model's spatial phase
 * transition — order in *time* rather than in *space*.
 *
 * A single seeded PRNG (mulberry32) drives the natural frequencies, the initial
 * phases, and any thermal noise, so a given seed + parameters reproduces the
 * exact trajectory — shareable by URL. Fully client-side, no backend.
 *
 * The interaction sum is collapsed with the identity
 *     Σⱼ sin(θⱼ − θᵢ) = N·(m_y·cosθᵢ − m_x·sinθᵢ),
 * where (m_x, m_y) is the population mean field, so each step is O(N) not O(N²).
 *
 * Headless self-test: `node public/kuramoto.js` builds a population, integrates
 * it, hashes the final phases, and asserts same-seed reproducibility, that a
 * different seed / different coupling diverges, and — crucially — that
 * synchrony genuinely emerges: strong coupling drives R well above 0.6 from a
 * random start, weak coupling leaves it below 0.4. Exits non-zero on failure.
 */
(function () {
  "use strict";

  // ---- tunables (live) ---------------------------------------------------
  var Sim = {
    seed: 1234,
    K: 2.0,            // coupling strength
    dw: 1.0,           // frequency spread (half-width of uniform / sigma of normal)
    D: 0.0,            // additive (Brownian) noise intensity
    dist: "uniform",   // "uniform" | "normal" | "bimodal"
    N: 160,            // oscillator count
    spd: 4,            // integration substeps per animation frame
    dt: 0.04,          // time step
    palette: "classic",
    frame: 0
  };

  // ---- state ------------------------------------------------------------
  var theta = [];      // phases θᵢ ∈ [0, 2π)
  var omega = [];      // natural frequencies ωᵢ (fixed per init)
  var historyR = [];   // rolling order-parameter time series
  var HIST_MAX = 400;
  var rngState = 0;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1234);
  function seedRng(s) { rngState = s >>> 0; rng = mulberry32(rngState); }
  function rand() { return rng(); }
  function gauss() {                       // standard normal via Box–Muller
    var u = Math.max(1e-12, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- natural-frequency distribution -----------------------------------
  function buildFrequencies(N, dw, dist) {
    var w = new Array(N), i;
    if (dist === "normal") {
      var sigma = dw / 2;
      for (i = 0; i < N; i++) w[i] = sigma * gauss();
    } else if (dist === "bimodal") {
      var b = dw * 0.6, s = dw * 0.18;      // two frequency clusters ±b
      for (i = 0; i < N; i++) {
        var sign = rand() < 0.5 ? -1 : 1;
        w[i] = sign * b + s * gauss();
      }
    } else {                                // uniform in [-dw/2, dw/2]
      var half = dw / 2;
      for (i = 0; i < N; i++) w[i] = (rand() * 2 - 1) * half;
    }
    return w;
  }

  function init(N, seed, dist, dw) {
    seedRng(seed);
    Sim.N = N; Sim.dist = dist; Sim.dw = dw;
    Sim.frame = 0;
    theta = new Array(N);
    omega = buildFrequencies(N, dw, dist);
    historyR = [];
    var i;
    for (i = 0; i < N; i++) theta[i] = rand() * 2 * Math.PI; // random start
  }

  // ---- one integration step (Euler–Maruyama) ----------------------------
  function step() {
    var N = Sim.N, K = Sim.K, dt = Sim.dt, D = Sim.D;
    var sx = 0, sy = 0, j;
    for (j = 0; j < N; j++) { sx += Math.cos(theta[j]); sy += Math.sin(theta[j]); }
    var mx = sx / N, my = sy / N;           // mean field (R,Ψ implicit)
    var next = new Array(N);
    for (var i = 0; i < N; i++) {
      // Σⱼ sin(θⱼ−θᵢ) = N·(m_y·cosθᵢ − m_x·sinθᵢ)  →  O(N) total
      var interaction = K * (my * Math.cos(theta[i]) - mx * Math.sin(theta[i]));
      var noise = D > 0 ? Math.sqrt(dt) * D * gauss() : 0;
      next[i] = theta[i] + dt * (omega[i] + interaction) + noise;
    }
    theta = next;
    Sim.frame++;
  }

  // ---- observables ------------------------------------------------------
  function orderParam() {
    var N = Sim.N, sx = 0, sy = 0, j;
    for (j = 0; j < N; j++) { sx += Math.cos(theta[j]); sy += Math.sin(theta[j]); }
    var R = Math.sqrt(sx * sx + sy * sy) / N;
    var Psi = Math.atan2(sy, sx);
    return { R: R, Psi: Psi };
  }
  function meanFreq() {
    var s = 0, i;
    for (i = 0; i < Sim.N; i++) s += omega[i];
    return s / Sim.N;
  }

  // ---- rolling history --------------------------------------------------
  function pushHistory(R) {
    historyR.push(R);
    if (historyR.length > HIST_MAX) historyR.shift();
  }

  // ---- field hash (self-test + share determinism) -----------------------
  function hashField() {
    var h = 2166136261 >>> 0;
    var TAU = 2 * Math.PI;
    for (var k = 0; k < Sim.N; k++) {
      var ph = theta[k] % TAU; if (ph < 0) ph += TAU;
      var v = Math.floor(ph / TAU * 1000) & 0xffff;
      h ^= v; h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // ====================== rendering ======================================
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function colorFor(t) {                    // t in [0,1]: slow→fast frequency
    var p = Sim.palette;
    if (p === "cool") return hsl2rgb(200 + 60 * t, 0.72, 0.56);
    if (p === "warm") return hsl2rgb(18 + 42 * t, 0.85, 0.56);
    if (p === "mono") { var v = 70 + 170 * t; return [v, v, v]; }
    return hsl2rgb(245 - 245 * t, 0.78, 0.58);  // classic spectrum
  }

  function renderCircle(ctx, W, H, op) {
    var cx = W / 2, cy = H / 2, Rpix = Math.min(W, H) / 2 - 18;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, W, H);
    // unit circle
    ctx.strokeStyle = "rgba(150,170,200,0.30)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, Rpix, 0, 2 * Math.PI); ctx.stroke();
    // oscillators, colored by natural frequency
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < Sim.N; i++) { if (omega[i] < lo) lo = omega[i]; if (omega[i] > hi) hi = omega[i]; }
    var span = (hi - lo) || 1;
    var dot = Sim.N > 320 ? 1.6 : (Sim.N > 160 ? 2.0 : 2.6);
    for (i = 0; i < Sim.N; i++) {
      var t = (omega[i] - lo) / span;
      var c = colorFor(t);
      var x = cx + Rpix * Math.cos(theta[i]);
      var y = cy + Rpix * Math.sin(theta[i]);
      ctx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      ctx.beginPath(); ctx.arc(x, y, dot, 0, 2 * Math.PI); ctx.fill();
    }
    // mean-field vector (length = coherence R)
    var ex = cx + Rpix * op.R * Math.cos(op.Psi);
    var ey = cy + Rpix * op.R * Math.sin(op.Psi);
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath(); ctx.arc(ex, ey, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "rgba(220,230,245,0.65)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText("phase circle · each dot = one oscillator", 10, H - 10);
  }

  function renderPlot(ctx, W, H, op) {
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, W, H);
    var split = Math.floor(H * 0.58);
    var pad = 14;

    // --- top: order-parameter time series R(t) ---
    ctx.strokeStyle = "rgba(150,170,200,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, split - pad);
    ctx.moveTo(pad, split - pad); ctx.lineTo(W - pad, split - pad); ctx.stroke();
    ctx.fillStyle = "rgba(220,230,245,0.7)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText("coherence R(t)  [0 → incoherent, 1 → locked]", pad + 4, pad + 12);
    if (historyR.length > 1) {
      ctx.strokeStyle = "#5ad1c4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      var x0 = pad, x1 = W - pad;
      for (var k = 0; k < historyR.length; k++) {
        var xx = x0 + (x1 - x0) * (k / (HIST_MAX - 1));
        var yy = (split - pad) - (split - 2 * pad) * historyR[k];
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }

    // --- bottom: phase distribution histogram ---
    var hb = historyR.length ? 0 : 0;
    var NB = 36, bins = new Array(NB), i, b;
    for (b = 0; b < NB; b++) bins[b] = 0;
    for (i = 0; i < Sim.N; i++) {
      var ph = theta[i] % (2 * Math.PI); if (ph < 0) ph += 2 * Math.PI;
      var bi = Math.min(NB - 1, Math.floor(ph / (2 * Math.PI) * NB));
      bins[bi]++;
    }
    var maxb = 1;
    for (b = 0; b < NB; b++) if (bins[b] > maxb) maxb = bins[b];
    var top = split + 22, bot = H - 12;
    ctx.fillStyle = "rgba(220,230,245,0.7)";
    ctx.fillText("phase distribution  (a peak = synchronization)", pad + 4, split + 14);
    var bw = (W - 2 * pad) / NB;
    for (b = 0; b < NB; b++) {
      var bh = (bot - top) * (bins[b] / maxb);
      var t = b / NB;
      var c = colorFor(t);
      ctx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      ctx.fillRect(pad + b * bw, bot - bh, Math.max(1, bw - 1), bh);
    }
  }

  // ====================== DOM mode =======================================
  function initDOM() {
    var circle = document.getElementById("circle");
    var plot = document.getElementById("plot");
    if (!circle || !plot) return;
    var ctxC = circle.getContext("2d");
    var ctxP = plot.getContext("2d");
    var readout = document.getElementById("readout");
    var msg = document.getElementById("msg");

    var elSeed = document.getElementById("seed");
    var elK = document.getElementById("K");
    var elDw = document.getElementById("dw");
    var elD = document.getElementById("D");
    var elDist = document.getElementById("dist");
    var elN = document.getElementById("N");
    var elSpd = document.getElementById("spd");
    var elPal = document.getElementById("palette");
    var btnPlay = document.getElementById("play");
    var btnStep = document.getElementById("step");
    var btnReset = document.getElementById("reset");
    var btnShare = document.getElementById("share");

    var running = true;
    function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

    function sync() {
      Sim.seed = parseInt(elSeed.value, 10) || 0;
      Sim.K = parseFloat(elK.value);
      Sim.dw = parseFloat(elDw.value);
      Sim.D = parseFloat(elD.value);
      Sim.dist = elDist.value;
      Sim.N = parseInt(elN.value, 10) || 160;
      Sim.spd = parseInt(elSpd.value, 10) || 4;
      Sim.palette = elPal.value;
      setText("seed-val", elSeed.value);
      setText("k-val", Sim.K.toFixed(2));
      setText("dw-val", Sim.dw.toFixed(2));
      setText("d-val", Sim.D.toFixed(2));
      setText("dist-val", Sim.dist);
      setText("n-val", String(Sim.N));
      setText("spd-val", String(Sim.spd));
      setText("palette-val", Sim.palette);
    }

    function applyParamsFromHash() {
      try {
        var q = new URLSearchParams(location.hash.replace(/^#/, ""));
        if (q.has("seed")) elSeed.value = q.get("seed");
        if (q.has("K")) elK.value = q.get("K");
        if (q.has("dw")) elDw.value = q.get("dw");
        if (q.has("D")) elD.value = q.get("D");
        if (q.has("dist")) elDist.value = q.get("dist");
        if (q.has("N")) elN.value = q.get("N");
        if (q.has("spd")) elSpd.value = q.get("spd");
        if (q.has("pal")) elPal.value = q.get("pal");
      } catch (e) { /* ignore */ }
    }
    function buildHash() {
      var q = new URLSearchParams();
      q.set("seed", Sim.seed);
      q.set("K", Sim.K.toFixed(3));
      q.set("dw", Sim.dw.toFixed(3));
      q.set("D", Sim.D.toFixed(3));
      q.set("dist", Sim.dist);
      q.set("N", Sim.N);
      q.set("spd", Sim.spd);
      q.set("pal", Sim.palette);
      return "#" + q.toString();
    }

    function doInit() {
      sync();
      init(Sim.N, Sim.seed, Sim.dist, Sim.dw);
      historyR = [];
      var op = orderParam();
      renderCircle(ctxC, circle.width, circle.height, op);
      renderPlot(ctxP, plot.width, plot.height, op);
      updateReadout(op);
    }

    function verdict(R) {
      return R > 0.8 ? "synchronized" : (R < 0.2 ? "incoherent" : "partial");
    }
    function updateReadout(op) {
      if (readout) {
        readout.textContent =
          "K = " + Sim.K.toFixed(2) + "  ·  Δω = " + Sim.dw.toFixed(2) +
          "  ·  R = " + op.R.toFixed(3) + " (" + verdict(op.R) + ")" +
          "  ·  Ψ = " + op.Psi.toFixed(2) + "  ·  ⟨ω⟩ = " + meanFreq().toFixed(3) +
          "  ·  step " + Sim.frame;
      }
    }

    function frame() {
      if (running) {
        var op;
        for (var s = 0; s < Sim.spd; s++) step();
        op = orderParam();
        pushHistory(op.R);
        renderCircle(ctxC, circle.width, circle.height, op);
        renderPlot(ctxP, plot.width, plot.height, op);
        updateReadout(op);
      }
      requestAnimationFrame(frame);
    }

    // ---- controls ----
    [elSeed, elK, elDw, elD, elDist, elN, elSpd, elPal].forEach(function (el) {
      el.addEventListener("input", function () { sync(); });
    });
    elDist.addEventListener("change", function () { sync(); doInit(); });
    elN.addEventListener("change", function () { sync(); doInit(); });
    elPal.addEventListener("change", function () { sync(); });

    btnPlay.addEventListener("click", function () {
      running = !running;
      btnPlay.textContent = running ? "⏸ Pause" : "▶ Play";
      btnPlay.setAttribute("aria-pressed", running ? "true" : "false");
    });
    btnStep.addEventListener("click", function () {
      running = false;
      btnPlay.textContent = "▶ Play";
      btnPlay.setAttribute("aria-pressed", "false");
      for (var s = 0; s < Sim.spd; s++) step();
      var op = orderParam();
      pushHistory(op.R);
      renderCircle(ctxC, circle.width, circle.height, op);
      renderPlot(ctxP, plot.width, plot.height, op);
      updateReadout(op);
    });
    btnReset.addEventListener("click", function () {
      doInit();
      msg.textContent = "Reset to the starting configuration.";
    });

    // ---- presets ----
    var PRESETS = {
      sync:   { K: 6.0, dw: 0.6, D: 0.0, dist: "uniform", N: 160 },
      crit:   { K: 1.3, dw: 2.0, D: 0.0, dist: "uniform", N: 160 },
      incoh:  { K: 0.2, dw: 4.0, D: 0.0, dist: "uniform", N: 160 },
      bimodal:{ K: 3.0, dw: 2.0, D: 0.0, dist: "bimodal", N: 200 },
      noisy:  { K: 4.0, dw: 1.0, D: 0.4, dist: "uniform", N: 160 }
    };
    Array.prototype.forEach.call(
      document.querySelectorAll(".preset"), function (btn) {
        btn.addEventListener("click", function () {
          var p = PRESETS[btn.getAttribute("data-preset")];
          if (!p) return;
          elK.value = p.K; elDw.value = p.dw; elD.value = p.D;
          elDist.value = p.dist; elN.value = p.N;
          sync(); doInit();
          msg.textContent = "Loaded preset: " + btn.textContent + ".";
        });
      });

    btnShare.addEventListener("click", function () {
      sync();
      var url = location.origin + location.pathname + buildHash();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          msg.textContent = "Share link copied — it reproduces this exact run.";
        }, function () { msg.textContent = "Share link: " + url; });
      } else { msg.textContent = "Share link: " + url; }
    });

    applyParamsFromHash();
    doInit();
    requestAnimationFrame(frame);
  }

  // ====================== headless self-test =============================
  function runHeadless(seed, K, dw, dist, N, steps) {
    Sim.K = K; Sim.dw = dw; Sim.dist = dist; Sim.D = 0;
    init(N, seed, dist, dw);
    var i;
    for (i = 0; i < steps; i++) step();
    var op = orderParam();
    return { R: op.R, Psi: op.Psi, h: hashField() };
  }

  function runSelfTest() {
    var N = 96, steps = 900;
    var A1 = runHeadless(12345, 6.0, 0.6, "uniform", N, steps);  // strong → synced
    var A2 = runHeadless(12345, 6.0, 0.6, "uniform", N, steps);  // same seed
    var C  = runHeadless(99999, 6.0, 0.6, "uniform", N, steps);  // diff seed
    var W  = runHeadless(12345, 0.15, 4.0, "uniform", N, steps); // weak → incoherent
    var Kd = runHeadless(12345, 1.0, 0.6, "uniform", N, steps);  // diff K

    var reproSeed = (A1.h === A2.h);
    var seedDiffers = (A1.h !== C.h);
    var kDiffers = (A1.h !== Kd.h);
    var synced = (A1.R > 0.6);          // emergence: strong coupling synchronizes
    var incoherent = (W.R < 0.4);       // weak coupling stays disordered
    var ok = reproSeed && seedDiffers && kDiffers && synced && incoherent;

    console.log("KURAMOTO self-test: " + (ok ? "PASS" : "FAIL"));
    console.log("  strong-coupling same-seed reproducible (A1==A2): " + reproSeed + "  [h=" + A1.h + "]");
    console.log("  diff-seed diverges (A1!=C): " + seedDiffers + "  [C=" + C.h + "]");
    console.log("  diff-K diverges (A1!=Kd): " + kDiffers + "  [Kd=" + Kd.h + "]");
    console.log("  strong coupling SYNCHRONIZES (R=" + A1.R.toFixed(3) + " > 0.6): " + synced);
    console.log("  weak coupling stays INCOHERENT (R=" + W.R.toFixed(3) + " < 0.4): " + incoherent);
    if (!ok) process.exit(1);
  }

  // Export hooks for node, and choose mode in browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { init: init, step: step, orderParam: orderParam,
      hashField: hashField, Sim: Sim, runHeadless: runHeadless };
  }

  if (typeof process !== "undefined" && process.argv[1] &&
      /kuramoto\.js$/.test(process.argv[1])) {
    runSelfTest();
  }

  if (typeof document !== "undefined" && document.getElementById("circle")) {
    initDOM();
  }
})();
