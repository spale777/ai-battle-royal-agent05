/*
 * nbody.js — an N-body gravitational simulation (2D, canvas).
 *
 * N point masses pull on each other through plain Newtonian gravity,
 *     F = G · m_i · m_j · r / |r|^3   (with a softening ε to tame close
 *     encounters). Each body feels the sum of every other body's pull, so
 *     the whole thing is an O(N²) all-pairs simulation integrated with a
 *     symplectic Velocity-Verlet scheme — which is what keeps the total
 *     energy nearly constant instead of drifting off to infinity like a
 *     naive Euler step would.
 *
 * What you'll see:
 *   • "galaxy"    — a heavy centre plus a disc of light bodies set on near-
 *                   circular orbits, all spinning the same way: a little
 *                   rotating galaxy that shears into spiral arms.
 *   • "collapse"  — a cold cloud of equal masses with almost no velocity that
 *                   falls in on itself, forms clumps and binaries, and flings
 *                   a few escapees outward (real gravitational structure from
 *                   nothing but 1/r²).
 *   • "binary"    — a central mass and one body on a genuine Kepler ellipse
 *                   (apoapsis/periapsis), with a handful of background moons.
 *   • "solar"     — a sun plus small planets on circular orbits.
 *   • "figure8"   — the famous three-body choreography of Chenciner &
 *                   Montgomery: three equal masses tracing one shared
 *                   figure-eight curve forever. A single exact solution of
 *                   the full equations, not a trick.
 *
 * A single seeded PRNG (mulberry32) drives every random choice (initial
 * positions, velocities, masses), so a given seed + parameters reproduces the
 * exact trajectory — shareable by URL. Fully client-side, no backend.
 *
 * Headless self-test: `node public/nbody.js` builds systems, integrates them,
 * and asserts (1) same seed → identical final state hash, (2) different seed
 * diverges, (3) the symplectic integrator conserves energy (the figure-eight
 * total energy barely moves over thousands of steps), and (4) a two-body
 * orbit stays *bound* (its distance from the primary stays finite — no
 * hyperbolic escape). Exits non-zero on failure.
 */
(function () {
  "use strict";

  // ---- tunables (live, some set per-scenario in init) ------------------
  var Sim = {
    scenario: "galaxy",
    N: 120,
    G: 1.0,             // gravitational constant (scene scale)
    centralMass: 1.0,   // mass of the central body for disc-like scenarios
    soft: 0.025,        // softening length ε (avoids 1/r² blow-ups)
    dt: 0.008,          // integration time step (per-scenario default)
    speed: 3,           // integration substeps per animation frame
    trails: true,
    colorMode: "speed", // "speed" | "mass" | "index"
    spawnedMass: 0.01,  // mass of bodies dropped by clicking the canvas
    t: 0,
    steps: 0,
    E0: 0
  };

  var WORLD = 1.0;      // world half-extent (canvas maps ±WORLD to ±~half)

  // ---- state (parallel Float64Arrays for speed + accuracy) -------------
  var px, py, vx, vy, ax, ay, mass;
  var nax, nay;         // scratch accelerations for the Verlet kick

  // ---- PRNG -------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1234);
  function seedRng(s) { rng = mulberry32(s >>> 0); }
  function rand() { return rng(); }
  function gauss() {                          // standard normal (Box–Muller)
    var u = Math.max(1e-12, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- allocation -------------------------------------------------------
  function allocate(n) {
    px = new Float64Array(n); py = new Float64Array(n);
    vx = new Float64Array(n); vy = new Float64Array(n);
    ax = new Float64Array(n); ay = new Float64Array(n);
    nax = new Float64Array(n); nay = new Float64Array(n);
    mass = new Float64Array(n);
  }

  function pushBody(x, y, vxx, vyy, m) {
    var n = Sim.N;
    var npx = new Float64Array(n + 1), npy = new Float64Array(n + 1);
    var nvx = new Float64Array(n + 1), nvy = new Float64Array(n + 1);
    var nm = new Float64Array(n + 1), nax2 = new Float64Array(n + 1),
        nay2 = new Float64Array(n + 1);
    var i;
    for (i = 0; i < n; i++) {
      npx[i] = px[i]; npy[i] = py[i]; nvx[i] = vx[i];
      nvy[i] = vy[i]; nm[i] = mass[i]; nax2[i] = ax[i]; nay2[i] = ay[i];
    }
    npx[n] = x; npy[n] = y; nvx[n] = vxx; nvy[n] = vyy; nm[n] = m;
    px = npx; py = npy; vx = nvx; vy = nvy; mass = nm; ax = nax2; ay = nay2;
    nax = new Float64Array(n + 1); nay = new Float64Array(n + 1);
    Sim.N = n + 1;
  }

  // ---- accelerations from current positions ----------------------------
  function accelerations(outx, outy) {
    var N = Sim.N, G = Sim.G, eps2 = Sim.soft * Sim.soft, i, j;
    for (i = 0; i < N; i++) { outx[i] = 0; outy[i] = 0; }
    for (i = 0; i < N; i++) {
      var xi = px[i], yi = py[i], mi = mass[i];
      for (j = i + 1; j < N; j++) {
        var dx = px[j] - xi, dy = py[j] - yi;
        var r2 = dx * dx + dy * dy + eps2;
        var invr = 1 / Math.sqrt(r2);
        var invr3 = invr * invr * invr;
        var f = G * invr3;
        var fx = f * dx, fy = f * dy;
        outx[i] += fx * mass[j]; outy[i] += fy * mass[j];
        outx[j] -= fx * mi;      outy[j] -= fy * mi;
      }
    }
  }

  // ---- one Velocity-Verlet step ----------------------------------------
  function step() {
    var N = Sim.N, dt = Sim.dt, i;
    var hdt = 0.5 * dt, hdt2 = 0.5 * dt * dt;
    // drift:  x += v·dt + ½·a·dt²
    for (i = 0; i < N; i++) {
      px[i] += vx[i] * dt + ax[i] * hdt2;
      py[i] += vy[i] * dt + ay[i] * hdt2;
    }
    // new accelerations at the drifted positions
    accelerations(nax, nay);
    // kick:  v += ½·(a_old + a_new)·dt
    for (i = 0; i < N; i++) {
      vx[i] += (ax[i] + nax[i]) * hdt;
      vy[i] += (ay[i] + nay[i]) * hdt;
      ax[i] = nax[i]; ay[i] = nay[i];
    }
    Sim.t += dt; Sim.steps++;
  }

  // ---- observables ------------------------------------------------------
  function energy() {
    var N = Sim.N, G = Sim.G, eps2 = Sim.soft * Sim.soft, i, j;
    var KE = 0, PE = 0;
    for (i = 0; i < N; i++) KE += 0.5 * mass[i] * (vx[i] * vx[i] + vy[i] * vy[i]);
    for (i = 0; i < N; i++) {
      for (j = i + 1; j < N; j++) {
        var dx = px[j] - px[i], dy = py[j] - py[i];
        var r = Math.sqrt(dx * dx + dy * dy + eps2);
        PE -= G * mass[i] * mass[j] / r;
      }
    }
    return { KE: KE, PE: PE, E: KE + PE };
  }

  function comVelocity() {
    var N = Sim.N, i, mx = 0, my = 0, M = 0;
    for (i = 0; i < N; i++) { mx += mass[i] * vx[i]; my += mass[i] * vy[i]; M += mass[i]; }
    if (M === 0) return { x: 0, y: 0 };
    return { x: mx / M, y: my / M };
  }

  function centerCOM() {
    var N = Sim.N, i, M = 0, cx = 0, cy = 0, mvx = 0, mvy = 0;
    for (i = 0; i < N; i++) {
      M += mass[i];
      cx += mass[i] * px[i]; cy += mass[i] * py[i];
      mvx += mass[i] * vx[i]; mvy += mass[i] * vy[i];
    }
    if (M === 0) return;
    cx /= M; cy /= M; mvx /= M; mvy /= M;
    for (i = 0; i < N; i++) {
      px[i] -= cx; py[i] -= cy;
      vx[i] -= mvx; vy[i] -= mvy;
    }
  }

  // ---- initial conditions ----------------------------------------------
  function buildFigure8() {
    // Canonical Chenciner–Montgomery figure-eight (G=1, m=1).
    Sim.G = 1.0; Sim.soft = 1e-4; Sim.dt = 0.0015; Sim.centralMass = 1.0;
    allocate(3);
    var X = 0.97000436, Y = -0.24308753;
    var vx3 = 0.93240737, vy3 = 0.86473146;
    px[0] = X;  py[0] = Y;   vx[0] = -vx3 / 2; vy[0] = -vy3 / 2;
    px[1] = -X; py[1] = -Y;  vx[1] = -vx3 / 2; vy[1] = -vy3 / 2;
    px[2] = 0;  py[2] = 0;   vx[2] = vx3;      vy[2] = vy3;
    mass[0] = 1; mass[1] = 1; mass[2] = 1;
  }

  function buildCommon(scenario, N, G, soft) {
    Sim.G = G; Sim.soft = soft;
    Sim.dt = (scenario === "figure8") ? 0.0015 : 0.008;
    allocate(N);
    var Mc = Sim.centralMass, i, k = 0;
    if (scenario === "collapse") {
      // No central mass: N equal clumps in a cold disc.
      var m = 0.04;
      for (i = 0; i < N; i++) {
        var r = 0.12 + 0.78 * Math.sqrt(rand());
        var a = rand() * 2 * Math.PI;
        px[i] = r * Math.cos(a); py[i] = r * Math.sin(a);
        // tiny random (cold) velocity → gravitational collapse
        vx[i] = gauss() * 0.04; vy[i] = gauss() * 0.04;
        mass[i] = m * (0.7 + 0.6 * rand());
      }
    } else if (scenario === "binary") {
      // central + one body on a real Kepler ellipse (a=0.6, e=0.5)
      px[0] = 0; py[0] = 0; vx[0] = 0; vy[0] = 0; mass[0] = Mc;
      var a = 0.6, e = 0.5;
      var r_apo = a * (1 + e);
      var v_apo = Math.sqrt(G * Mc * (1 - e) / (a * (1 + e)));
      px[1] = r_apo; py[1] = 0; vx[1] = 0; vy[1] = v_apo; mass[1] = 0.002;
      k = 2;
      // a few background circular-orbit moons for prettiness
      for (i = 2; i < N; i++) addDiscBody(i, Mc, G, 0.12, 0.95);
    } else {
      // "galaxy" / "solar": central mass + disc of orbiting bodies
      px[0] = 0; py[0] = 0; vx[0] = 0; vy[0] = 0; mass[0] = Mc;
      k = 1;
      for (i = 1; i < N; i++) addDiscBody(i, Mc, G, 0.12, 0.95);
    }
    centerCOM();
  }

  // place body i on a circular orbit at a random radius (disc scenarios)
  function addDiscBody(i, Mc, G, rmin, rmax) {
    var r = rmin + (rmax - rmin) * Math.sqrt(rand());
    var ang = rand() * 2 * Math.PI;
    px[i] = r * Math.cos(ang); py[i] = r * Math.sin(ang);
    var v = Math.sqrt(G * Mc / r);                 // circular-orbit speed
    var dir = (Sim.scenario === "galaxy") ? 1 : (rand() < 0.5 ? 1 : -1);
    vx[i] = dir * v * (-Math.sin(ang));
    vy[i] = dir * v * (Math.cos(ang));
    mass[i] = (Sim.scenario === "solar" || Sim.scenario === "binary")
      ? 0.0008 + 0.0006 * rand()
      : 0.0015 + 0.0015 * rand();
  }

  function init(scenario, seed, N, G, soft) {
    seedRng(seed);
    Sim.scenario = scenario;
    Sim.N = (scenario === "figure8") ? 3 : (N || 120);
    Sim.t = 0; Sim.steps = 0;
    if (scenario === "figure8") {
      buildFigure8();
    } else {
      buildCommon(scenario, Sim.N, G, soft);
    }
    accelerations(ax, ay);
    Sim.E0 = energy().E;
  }

  // ---- field hash (self-test + share determinism) -----------------------
  function hashState() {
    var h = 2166136261 >>> 0, N = Sim.N, i;
    for (i = 0; i < N; i++) {
      h = (h ^ (Math.round(px[i] * 1000) & 0xffff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
      h = (h ^ (Math.round(py[i] * 1000) & 0xffff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
      h = (h ^ (Math.round(vx[i] * 1000) & 0xffff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
      h = (h ^ (Math.round(vy[i] * 1000) & 0xffff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // ====================== rendering ======================================
  function bodyRadius(m) { return 1.5 + 2.6 * Math.log(1 + m * 8); }

  function hsl(h, s, l) { return "hsl(" + h + "," + (s * 100) + "%," + (l * 100) + "%)"; }

  function render(ctx, W, H) {
    var scale = (Math.min(W, H) / 2) / WORLD * 0.95;
    var N = Sim.N, i;

    if (Sim.trails) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(8,11,18,0.14)";          // fade → motion trails
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#080b12";
      ctx.fillRect(0, 0, W, H);
    }

    // reference scales for colouring
    var maxSpd = 1e-6, maxM = 1e-6;
    for (i = 0; i < N; i++) {
      var sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (sp > maxSpd) maxSpd = sp;
      if (mass[i] > maxM) maxM = mass[i];
    }

    ctx.globalCompositeOperation = "lighter";         // glowing additive dots
    for (i = 0; i < N; i++) {
      var x = W / 2 + px[i] * scale;
      var y = H / 2 + py[i] * scale;
      var r = bodyRadius(mass[i]);
      var col;
      if (Sim.colorMode === "mass") {
        var tm = Math.log(1 + mass[i]) / Math.log(1 + maxM);
        col = hsl(45 + 200 * tm, 0.85, 0.6);
      } else if (Sim.colorMode === "index") {
        col = hsl((360 * i / N) % 360, 0.8, 0.62);
      } else { // speed
        var spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        var ts = Math.min(1, spd / (maxSpd + 1e-9));
        col = hsl(220 - 220 * ts, 0.9, 0.6);          // blue → red (slow→fast)
      }
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
      if (r > 3) {                                    // soft halo for big masses
        ctx.globalAlpha = 0.22;
        ctx.beginPath(); ctx.arc(x, y, r * 2.3, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // subtle centre crosshair so "where is the middle?" is never a mystery
    ctx.strokeStyle = "rgba(120,140,170,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 6, H / 2); ctx.lineTo(W / 2 + 6, H / 2);
    ctx.moveTo(W / 2, H / 2 - 6); ctx.lineTo(W / 2, H / 2 + 6);
    ctx.stroke();
  }

  // ====================== DOM mode =======================================
  function initDOM() {
    var canvas = document.getElementById("nbody");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var readout = document.getElementById("readout");
    var msg = document.getElementById("msg");

    var elSeed = document.getElementById("seed");
    var elScen = document.getElementById("scenario");
    var elN = document.getElementById("N");
    var elG = document.getElementById("G");
    var elMc = document.getElementById("Mc");
    var elSoft = document.getElementById("soft");
    var elSpd = document.getElementById("spd");
    var elTrails = document.getElementById("trails");
    var elColor = document.getElementById("color");
    var btnPlay = document.getElementById("play");
    var btnStep = document.getElementById("step");
    var btnReset = document.getElementById("reset");
    var btnShare = document.getElementById("share");

    var running = true;

    function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

    function sync() {
      Sim.seed = parseInt(elSeed.value, 10) || 0;
      Sim.scenario = elScen.value;
      Sim.N = parseInt(elN.value, 10) || 120;
      Sim.G = parseFloat(elG.value);
      Sim.centralMass = parseFloat(elMc.value);
      Sim.soft = parseFloat(elSoft.value);
      Sim.speed = parseInt(elSpd.value, 10) || 3;
      Sim.trails = elTrails.checked;
      Sim.colorMode = elColor.value;
      setText("seed-val", elSeed.value);
      setText("scenario-val", Sim.scenario);
      setText("n-val", String(Sim.N));
      setText("g-val", Sim.G.toFixed(2));
      setText("mc-val", Sim.centralMass.toFixed(2));
      setText("soft-val", Sim.soft.toFixed(3));
      setText("spd-val", String(Sim.speed));
      setText("trails-val", Sim.trails ? "on" : "off");
      setText("color-val", Sim.colorMode);
    }

    function applyParamsFromHash() {
      try {
        var q = new URLSearchParams(location.hash.replace(/^#/, ""));
        if (q.has("seed")) elSeed.value = q.get("seed");
        if (q.has("sc")) elScen.value = q.get("sc");
        if (q.has("N")) elN.value = q.get("N");
        if (q.has("G")) elG.value = q.get("G");
        if (q.has("Mc")) elMc.value = q.get("Mc");
        if (q.has("soft")) elSoft.value = q.get("soft");
        if (q.has("spd")) elSpd.value = q.get("spd");
        if (q.has("trails")) elTrails.checked = (q.get("trails") === "1");
        if (q.has("col")) elColor.value = q.get("col");
      } catch (e) { /* ignore */ }
    }
    function buildHash() {
      var q = new URLSearchParams();
      q.set("seed", Sim.seed);
      q.set("sc", Sim.scenario);
      q.set("N", Sim.N);
      q.set("G", Sim.G.toFixed(3));
      q.set("Mc", Sim.centralMass.toFixed(3));
      q.set("soft", Sim.soft.toFixed(4));
      q.set("spd", Sim.speed);
      q.set("trails", Sim.trails ? "1" : "0");
      q.set("col", Sim.colorMode);
      return "#" + q.toString();
    }

    function doInit() {
      sync();
      init(Sim.scenario, Sim.seed, Sim.N, Sim.G, Sim.soft);
      // clear the canvas fully on (re)start so old trails don't linger
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#080b12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      updateReadout();
    }

    function updateReadout() {
      var e = energy();
      var cm = comVelocity();
      var drift = (Sim.E0 !== 0) ? (e.E - Sim.E0) / Math.abs(Sim.E0) : 0;
      if (readout) {
        readout.textContent =
          "bodies " + Sim.N +
          "  ·  t = " + Sim.t.toFixed(2) +
          "  ·  KE = " + e.KE.toFixed(3) +
          "  ·  PE = " + e.PE.toFixed(3) +
          "  ·  E = " + e.E.toFixed(3) +
          "  ·  ΔE/E₀ = " + (drift * 100).toFixed(2) + "%" +
          "  ·  |v_com| = " + Math.sqrt(cm.x * cm.x + cm.y * cm.y).toFixed(4);
      }
    }

    function frame() {
      if (running) {
        var s;
        for (s = 0; s < Sim.speed; s++) step();
        render(ctx, canvas.width, canvas.height);
        updateReadout();
      }
      requestAnimationFrame(frame);
    }

    // ---- controls ----
    [elSeed, elN, elG, elMc, elSoft, elSpd].forEach(function (el) {
      el.addEventListener("input", function () { sync(); });
    });
    elScen.addEventListener("change", function () { sync(); doInit(); });
    elColor.addEventListener("change", function () { sync(); });

    btnPlay.addEventListener("click", function () {
      running = !running;
      btnPlay.textContent = running ? "⏸ Pause" : "▶ Play";
      btnPlay.setAttribute("aria-pressed", running ? "true" : "false");
    });
    btnStep.addEventListener("click", function () {
      running = false;
      btnPlay.textContent = "▶ Play";
      btnPlay.setAttribute("aria-pressed", "false");
      var s; for (s = 0; s < Sim.speed; s++) step();
      render(ctx, canvas.width, canvas.height);
      updateReadout();
    });
    btnReset.addEventListener("click", function () {
      doInit();
      msg.textContent = "Reset to the starting configuration.";
    });

    // ---- spawn a body by dragging on the canvas ----
    var dragging = false, downX = 0, downY = 0;
    function toWorld(ev) {
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      var cx = (ev.clientX - rect.left) * sx, cy = (ev.clientY - rect.top) * sy;
      var scale = (Math.min(canvas.width, canvas.height) / 2) / WORLD * 0.95;
      return { x: (cx - canvas.width / 2) / scale, y: (cy - canvas.height / 2) / scale };
    }
    canvas.addEventListener("pointerdown", function (ev) {
      dragging = true;
      var p = toWorld(ev);
      downX = p.x; downY = p.y;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointerup", function (ev) {
      if (!dragging) return;
      dragging = false;
      var p = toWorld(ev);
      // velocity ~ drag vector (flick from start to release)
      var vxx = (downX - p.x) * 1.2, vyy = (downY - p.y) * 1.2;
      pushBody(p.x, p.y, vxx, vyy, Sim.spawnedMass);
      accelerations(ax, ay);                  // refresh forces for the new body
      msg.textContent = "Added a body (mass " + Sim.spawnedMass + ") — flick to give it speed.";
      updateReadout();
    });

    // ---- presets ----
    var PRESETS = {
      galaxy:  { scenario: "galaxy", N: 120, G: 1.0, Mc: 1.0, soft: 0.025, spd: 3, trails: true,  col: "speed" },
      collapse:{ scenario: "collapse", N: 160, G: 1.0, Mc: 0.0, soft: 0.02, spd: 3, trails: true, col: "speed" },
      binary:  { scenario: "binary", N: 24, G: 1.0, Mc: 1.0, soft: 0.02, spd: 3, trails: true,  col: "mass" },
      solar:   { scenario: "solar", N: 90, G: 1.0, Mc: 1.0, soft: 0.025, spd: 3, trails: true,  col: "speed" },
      figure8: { scenario: "figure8", N: 3, G: 1.0, Mc: 1.0, soft: 0.0001, spd: 4, trails: false, col: "index" }
    };
    Array.prototype.forEach.call(
      document.querySelectorAll(".preset"), function (btn) {
        btn.addEventListener("click", function () {
          var p = PRESETS[btn.getAttribute("data-preset")];
          if (!p) return;
          elScen.value = p.scenario; elN.value = p.N; elG.value = p.G;
          elMc.value = p.Mc; elSoft.value = p.soft; elSpd.value = p.spd;
          elTrails.checked = p.trails; elColor.value = p.col;
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
  function runHeadless(scenario, seed, N, G, soft, steps) {
    init(scenario, seed, N, G, soft);
    var E0 = energy().E;
    var i; for (i = 0; i < steps; i++) step();
    return { E: energy().E, E0: E0, h: hashState() };
  }

  function runSelfTest() {
    // Seed reproducibility/divergence on a scenario that actually consumes the
    // PRNG (figure8 is a fixed exact config and ignores the seed by design).
    var A1 = runHeadless("collapse", 12345, 80, 1.0, 0.02, 600);  // repro seed
    var A2 = runHeadless("collapse", 12345, 80, 1.0, 0.02, 600);  // same seed
    var C  = runHeadless("collapse", 99999, 80, 1.0, 0.02, 600);  // diff seed

    var reproSeed = (A1.h === A2.h);
    var seedDiffers = (A1.h !== C.h);

    // Symplectic energy conservation on the exact figure-eight (2000 steps).
    var F = runHeadless("figure8", 12345, 3, 1.0, 1e-4, 2000);
    var drift = (F.E - F.E0) / Math.abs(F.E0);
    var conserves = (Math.abs(drift) < 0.02);   // symplectic: < 2% over 2000 steps

    // bound-orbit test: a two-body Kepler ellipse must stay *bound*
    init("binary", 12345, 2, 1.0, 0.02);
    var maxd = 0, i, d;
    for (i = 0; i < 1500; i++) {
      step();
      var dx = px[1] - px[0], dy = py[1] - py[0];
      d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxd) maxd = d;
    }
    var bound = (maxd < 1.6) && (d > 0.1);      // near apoapsis 0.9, no escape

    // collapse must actually move things (gravity does something)
    init("collapse", 4242, 80, 1.0, 0.02);
    var r0 = Math.sqrt(px[10] * px[10] + py[10] * py[10]);
    for (i = 0; i < 600; i++) step();
    var r1 = Math.sqrt(px[10] * px[10] + py[10] * py[10]);
    var moves = (Math.abs(r1 - r0) > 0.001);

    var ok = reproSeed && seedDiffers && conserves && bound && moves;

    console.log("NBODY self-test: " + (ok ? "PASS" : "FAIL"));
    console.log("  same-seed reproducible (A1==A2): " + reproSeed + "  [h=" + A1.h + "]");
    console.log("  diff-seed diverges (A1!=C):      " + seedDiffers + "  [C=" + C.h + "]");
    console.log("  energy conserved (|ΔE/E₀|=" + (drift * 100).toFixed(3) +
                "% < 2%): " + conserves);
    console.log("  binary orbit stays BOUND (maxdist=" + maxd.toFixed(3) +
                " < 1.6): " + bound);
    console.log("  cold collapse moves bodies:       " + moves);
    if (!ok) process.exit(1);
  }

  // Export hooks for node, and choose mode in browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { init: init, step: step, energy: energy,
      hashState: hashState, Sim: Sim, runHeadless: runHeadless,
      accelerations: accelerations };
  }

  if (typeof process !== "undefined" && process.argv[1] &&
      /nbody\.js$/.test(process.argv[1])) {
    runSelfTest();
  }

  if (typeof document !== "undefined" && document.getElementById("nbody")) {
    initDOM();
  }
})();
