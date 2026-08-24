/*
 * ising.js — the Ising model of ferromagnetism (canvas).
 *
 * A square lattice of spins, each either +1 (up) or −1 (down). The energy of a
 * configuration is E = −J·Σ⟨ij⟩ sᵢ·sⱼ − h·Σ sᵢ (nearest-neighbour only). At each
 * Monte-Carlo step we propose flipping a random spin; the flip is accepted with
 * probability min(1, e^(−ΔE/T)) — Metropolis–Hastings at temperature T.
 *
 * This is *statistical mechanics made visible*: at low T the thermal noise is
 * too weak to overcome the aligning J·coupling, so a large magnetised domain
 * (spontaneous symmetry breaking) wins out; near the critical temperature
 * T_c ≈ 2.269/J (for J=1, square lattice) the correlation length diverges and
 * you get fractal domain walls and wild fluctuations; above T_c the spins
 * randomise into a paramagnet. Watch the order parameter M = |Σs|/N fall from
 * ~1 to ~0 as you raise T across the critical point.
 *
 * A single seeded PRNG (mulberry32) drives every random choice, so a given
 * seed + temperature + start reproduces the trajectory — shareable by URL.
 * Fully client-side, no backend.
 *
 * Headless self-test: `node public/ising.js` builds a lattice, runs MC sweeps,
 * hashes the spin field, and asserts same-seed reproducibility, that a different
 * seed / different temperature diverges, and that the order parameter behaves
 * (low-T ordered, high-T disordered). Exits non-zero on failure.
 */
(function () {
  "use strict";

  // ---- lattice ----------------------------------------------------------
  var N = 120;                 // lattice side (N×N spins)
  var NN = N * N;

  // ---- tunables (live) ---------------------------------------------------
  var Sim = {
    seed: 1234,
    T: 1.8,                    // temperature (K); T_c≈2.269 for J=1
    J: 1.0,                    // ferromagnetic coupling
    h: 0.0,                    // external field
    sweepsPerFrame: 4,         // MC sweeps per animation frame
    start: "random",          // "random" | "up" | "down" | "checker"
    palette: "classic",
    frame: 0
  };

  // ---- spin field + RNG --------------------------------------------------
  var spin = new Int8Array(NN);
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

  function idx(i, j) { return i + N * j; }

  function init(startMode, seed) {
    seedRng(seed);
    Sim.frame = 0;
    var i, j, k;
    if (startMode === "up") {
      for (k = 0; k < NN; k++) spin[k] = 1;
    } else if (startMode === "down") {
      for (k = 0; k < NN; k++) spin[k] = -1;
    } else if (startMode === "checker") {
      for (j = 0; j < N; j++) for (i = 0; i < N; i++)
        spin[idx(i, j)] = ((i + j) & 1) ? 1 : -1;
    } else { // random
      for (k = 0; k < NN; k++) spin[k] = rand() < 0.5 ? 1 : -1;
    }
  }

  // Periodic boundary conditions.
  function pbc(v) { return v < 0 ? v + N : (v >= N ? v - N : v); }

  // Energy change from flipping the spin at (i,j).
  // Δ E = 2·(J·Σ_neighbours s_n + h)·s_ij  (since E flips sign of that site's
  // coupling terms). O(1) per proposal — the whole point of Metropolis.
  function deltaE(i, j) {
    var s = spin[idx(i, j)];
    var nb = spin[idx(pbc(i - 1), j)] + spin[idx(pbc(i + 1), j)] +
             spin[idx(i, pbc(j - 1))] + spin[idx(i, pbc(j + 1))];
    return 2 * (Sim.J * nb + Sim.h) * s;
  }

  // One Monte-Carlo sweep: N² single-spin Metropolis proposals.
  function sweep() {
    var i, j;
    for (var n = 0; n < NN; n++) {
      i = (rand() * N) | 0;
      j = (rand() * N) | 0;
      var dE = deltaE(i, j);
      // Acceptance: always if dE<=0, else with prob e^{-dE/T}.
      if (dE <= 0 || rand() < Math.exp(-dE / Sim.T)) {
        spin[idx(i, j)] = -spin[idx(i, j)];
      }
    }
  }

  // ---- observable: magnetisation M = |Σs| / N, in [0,1] ------------------
  function orderParam() {
    var s = 0;
    for (var k = 0; k < NN; k++) s += spin[k];
    return Math.abs(s) / NN;
  }
  // Also a signed (net) magnetisation, useful to watch symmetry breaking.
  function netMag() {
    var s = 0;
    for (var k = 0; k < NN; k++) s += spin[k];
    return s / NN;
  }

  // ---- rendering ---------------------------------------------------------
  var PALETTES = {
    classic: function (s) {   // up = warm red, down = cool blue
      return s > 0 ? [220, 60, 70] : [55, 90, 190];
    },
    mono: function (s) {
      var v = s > 0 ? 250 : 22;
      return [v, v, v];
    },
    fire: function (s) {
      return s > 0 ? [255, 176, 40] : [40, 40, 120];
    },
    ice: function (s) {
      return s > 0 ? [180, 240, 255] : [20, 40, 90];
    }
  };

  function render(canvas) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    // Keep the lattice square on screen, centred.
    var cell = Math.max(1, Math.floor(Math.min(W, H) / N));
    var offx = ((W - cell * N) / 2) | 0;
    var offy = ((H - cell * N) / 2) | 0;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    var pal = PALETTES[Sim.palette] || PALETTES.classic;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var c = pal(spin[idx(i, j)]);
        ctx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
        ctx.fillRect(offx + i * cell, offy + j * cell, cell, cell);
      }
    }
  }

  // ---- deterministic run (for share links / self-test) -------------------
  function runSweeps(count, seed, T, startMode) {
    if (seed !== undefined) { Sim.seed = seed >>> 0; }
    if (T !== undefined) { Sim.T = T; }
    if (startMode !== undefined) { Sim.start = startMode; }
    init(Sim.start, Sim.seed);
    for (var s = 0; s < count; s++) sweep();
    Sim.frame += count;
  }

  // ---- field hash (self-test + share determinism) ------------------------
  function hashField() {
    var h = 2166136261 >>> 0;
    for (var k = 0; k < NN; k++) {
      h ^= (spin[k] + 1);       // map −1,0,+1 → 0,1,2
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // ====================== DOM mode =======================================
  function initDOM() {
    var canvas = document.getElementById("ising");
    if (!canvas) return;
    var readout = document.getElementById("readout");
    var msg = document.getElementById("msg");

    var elSeed = document.getElementById("seed");
    var elT = document.getElementById("temp");
    var elJ = document.getElementById("coupling");
    var elH = document.getElementById("field");
    var elStart = document.getElementById("start");
    var elPal = document.getElementById("palette");
    var elSweeps = document.getElementById("sweeps");
    var btnPlay = document.getElementById("play");
    var btnStep = document.getElementById("step");
    var btnReset = document.getElementById("reset");
    var btnClear = document.getElementById("clear");
    var btnShare = document.getElementById("share");

    var running = true;

    function sync() {
      Sim.seed = parseInt(elSeed.value, 10) || 0;
      Sim.T = parseFloat(elT.value);
      Sim.J = parseFloat(elJ.value);
      Sim.h = parseFloat(elH.value);
      Sim.start = elStart.value;
      Sim.palette = elPal.value;
      Sim.sweepsPerFrame = parseInt(elSweeps.value, 10) || 4;
      if (document.getElementById("seed-val"))
        document.getElementById("seed-val").textContent = elSeed.value;
      if (document.getElementById("temp-val"))
        document.getElementById("temp-val").textContent = Sim.T.toFixed(2);
      if (document.getElementById("coupling-val"))
        document.getElementById("coupling-val").textContent = Sim.J.toFixed(2);
      if (document.getElementById("field-val"))
        document.getElementById("field-val").textContent = Sim.h.toFixed(2);
      if (document.getElementById("sweeps-val"))
        document.getElementById("sweeps-val").textContent = elSweeps.value;
      if (document.getElementById("palette-val"))
        document.getElementById("palette-val").textContent = Sim.palette;
      if (document.getElementById("start-val"))
        document.getElementById("start-val").textContent = Sim.start;
    }

    function applyParamsFromHash() {
      try {
        var q = new URLSearchParams(location.hash.replace(/^#/, ""));
        if (q.has("seed")) elSeed.value = q.get("seed");
        if (q.has("T")) elT.value = q.get("T");
        if (q.has("J")) elJ.value = q.get("J");
        if (q.has("h")) elH.value = q.get("h");
        if (q.has("start")) elStart.value = q.get("start");
        if (q.has("pal")) elPal.value = q.get("pal");
        if (q.has("sweeps")) elSweeps.value = q.get("sweeps");
      } catch (e) { /* ignore */ }
    }

    function buildHash() {
      var q = new URLSearchParams();
      q.set("seed", Sim.seed);
      q.set("T", Sim.T.toFixed(3));
      q.set("J", Sim.J.toFixed(3));
      q.set("h", Sim.h.toFixed(3));
      q.set("start", Sim.start);
      q.set("pal", Sim.palette);
      q.set("sweeps", Sim.sweepsPerFrame);
      return "#" + q.toString();
    }

    function doInit() {
      sync();
      init(Sim.start, Sim.seed);
      render(canvas);
      updateReadout();
    }

    function updateReadout() {
      var M = orderParam(), m = netMag();
      if (readout) {
        readout.textContent =
          "T = " + Sim.T.toFixed(2) + "  ·  M = " + M.toFixed(3) +
          "  ·  m = " + (m >= 0 ? "+" : "") + m.toFixed(3) +
          "  ·  sweep " + Sim.frame + (Sim.T < 2.269 ? "  (ordered side)" :
          Sim.T > 2.269 ? "  (disordered side)" : "  (≈ critical)");
      }
    }

    function frame() {
      if (running) {
        for (var s = 0; s < Sim.sweepsPerFrame; s++) sweep();
        Sim.frame += Sim.sweepsPerFrame;
        render(canvas);
        updateReadout();
      }
      requestAnimationFrame(frame);
    }

    // ---- controls ----
    [elSeed, elT, elJ, elH, elStart, elPal, elSweeps].forEach(function (el) {
      el.addEventListener("input", sync);
    });
    elStart.addEventListener("change", function () {
      sync(); doInit();
    });
    elPal.addEventListener("change", function () { sync(); render(canvas); });

    btnPlay.addEventListener("click", function () {
      running = !running;
      btnPlay.textContent = running ? "⏸ Pause" : "▶ Play";
      btnPlay.setAttribute("aria-pressed", running ? "true" : "false");
    });
    btnStep.addEventListener("click", function () {
      running = false;
      btnPlay.textContent = "▶ Play";
      btnPlay.setAttribute("aria-pressed", "false");
      for (var s = 0; s < Sim.sweepsPerFrame; s++) sweep();
      Sim.frame += Sim.sweepsPerFrame;
      render(canvas); updateReadout();
    });
    btnReset.addEventListener("click", function () {
      doInit();
      msg.textContent = "Reset to starting configuration.";
    });
    btnClear.addEventListener("click", function () {
      sync();
      init(Sim.start, Sim.seed);
      Sim.frame = 0;
      render(canvas); updateReadout();
      msg.textContent = "Cleared and re-seeded.";
    });

    // ---- presets --------------------------------------------------------
    var PRESETS = {
      cold:    { T: 1.0, J: 1.0, h: 0.0, start: "random" },
      warm:    { T: 2.3, J: 1.0, h: 0.0, start: "random" },
      hot:     { T: 4.5, J: 1.0, h: 0.0, start: "random" },
      field:   { T: 2.0, J: 1.0, h: 1.0, start: "random" },
      checker: { T: 1.8, J: 1.0, h: 0.0, start: "checker" }
    };
    Array.prototype.forEach.call(
      document.querySelectorAll(".preset"), function (btn) {
        btn.addEventListener("click", function () {
          var p = PRESETS[btn.getAttribute("data-preset")];
          if (!p) return;
          elT.value = p.T; elJ.value = p.J; elH.value = p.h;
          elStart.value = p.start;
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
        }, function () {
          msg.textContent = "Share link: " + url;
        });
      } else {
        msg.textContent = "Share link: " + url;
      }
    });

    // ---- paint: click/drag flips a patch of spins (a local field) --------
    var painting = false;
    function paintAt(ev) {
      var rect = canvas.getBoundingClientRect();
      var cx = (ev.clientX - rect.left) / rect.width * canvas.width;
      var cy = (ev.clientY - rect.top) / rect.height * canvas.height;
      var cell = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / N));
      var offx = ((canvas.width - cell * N) / 2) | 0;
      var offy = ((canvas.height - cell * N) / 2) | 0;
      var gi = Math.floor((cx - offx) / cell);
      var gj = Math.floor((cy - offy) / cell);
      if (gi < 0 || gj < 0 || gi >= N || gj >= N) return;
      var r = 4;
      var val = (ev.shiftKey) ? -1 : 1;
      for (var dj = -r; dj <= r; dj++) {
        for (var di = -r; di <= r; di++) {
          if (di * di + dj * dj > r * r) continue;
          var ii = pbc(gi + di), jj = pbc(gj + dj);
          spin[idx(ii, jj)] = val;
        }
      }
      render(canvas); updateReadout();
    }
    canvas.addEventListener("mousedown", function (e) { painting = true; paintAt(e); });
    canvas.addEventListener("mousemove", function (e) { if (painting) paintAt(e); });
    window.addEventListener("mouseup", function () { painting = false; });

    applyParamsFromHash();
    if (location.hash.length > 1) {
      sync();
      // If a hash was supplied, honour its starting config but (if random) we
      // still need a concrete seed — build from the hash seed.
      doInit();
    } else {
      doInit();
    }
    requestAnimationFrame(frame);
  }

  // ====================== headless self-test =============================
  function runSelfTest() {
    var sweeps = 200;
    // Ordering test: start fully magnetised (a ground state) at low T — the
    // alignment must *hold* (thermal noise too weak to flip the bulk). Then the
    // same magnetised start at high T must *melt* into disorder. Starting from a
    // ground state sidesteps the long nucleation wait you'd get from random.
    function run(seed, T, startMode) {
      Sim.start = startMode;
      Sim.seed = seed; Sim.T = T;
      runSweeps(sweeps, seed, T, startMode);
      return { h: hashField(), M: orderParam() };
    }
    var A1 = run(12345, 1.0, "up");   // low T, ordered start → stays ordered
    var A2 = run(12345, 1.0, "up");   // same seed → identical
    var C  = run(99999, 1.0, "up");   // diff seed → diverges
    var H1 = run(12345, 5.0, "up");   // high T, ordered start → melts
    var H2 = run(12345, 5.0, "up");

    var reproLow = (A1.h === A2.h);
    var seedDiffers = (A1.h !== C.h);
    var reproHigh = (H1.h === H2.h);
    var tempDiffers = (A1.h !== H1.h);
    // Low-T preserves order; high-T destroys it.
    var ordered = (A1.M > 0.6);
    var disordered = (H1.M < 0.2);
    var ok = reproLow && seedDiffers && reproHigh && tempDiffers &&
             ordered && disordered;
    console.log("ISING self-test: " + (ok ? "PASS" : "FAIL"));
    console.log("  low-T same-seed reproducible (A1==A2): " + reproLow + "  [h=" + A1.h + "]");
    console.log("  low-T diff-seed diverges (A1!=C): " + seedDiffers + "  [C=" + C.h + "]");
    console.log("  high-T same-seed reproducible (H1==H2): " + reproHigh + "  [h=" + H1.h + "]");
    console.log("  temp diverges (low!=high): " + tempDiffers);
    console.log("  low-T preserves order (M=" + A1.M.toFixed(3) + " > 0.6): " + ordered);
    console.log("  high-T melts order (M=" + H1.M.toFixed(3) + " < 0.2): " + disordered);
    if (!ok) process.exit(1);
  }

  // Export hooks for node, and choose mode in browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { init: init, sweep: sweep, runSweeps: runSweeps,
      orderParam: orderParam, hashField: hashField, Sim: Sim, NN: NN };
  }

  if (typeof process !== "undefined" && process.argv[1] &&
      /ising\.js$/.test(process.argv[1])) {
    runSelfTest();
  }

  if (typeof document !== "undefined" && document.getElementById("ising")) {
    initDOM();
  }
})();
