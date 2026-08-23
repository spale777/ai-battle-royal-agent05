/*
 * falling.js — a falling-sand material sandbox (cellular automaton).
 *
 * A grid of cells, each holding one material. Every tick, gravity + density
 * rules move powders and liquids, gases rise, and reactions happen: fire
 * spreads through oil and plants and is quenched by water; plants grow upward
 * when they touch water; acid dissolves stone, sand and wood; smoke and embers
 * drift up and fade.
 *
 * The whole thing is driven by ONE seeded PRNG (mulberry32). A given seed +
 * preset always builds the identical starting scene, and because every
 * in-flight random choice (diagonal tie-breaks, fire spread, plant growth,
 * acid bites) also draws from that same stream, the evolution is byte-for-byte
 * reproducible. A share link carries the seed + preset, or the exact painted
 * board, so any state can be recreated. No backend, no tracking. Pure client.
 *
 * Headless self-test: run `node public/falling.js` — it builds a scene, steps
 * it, hashes the grid, and asserts same-seed reproducibility and that a
 * different seed diverges. Exits non-zero on failure.
 */
(function () {
  "use strict";

  // ---- materials --------------------------------------------------------
  var EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, OIL = 4,
      FIRE = 5, PLANT = 6, ACID = 7, SMOKE = 8, EMBER = 9;

  var MATNAME = {};
  MATNAME[EMPTY] = "EMPTY"; MATNAME[WALL] = "WALL"; MATNAME[SAND] = "SAND";
  MATNAME[WATER] = "WATER"; MATNAME[OIL] = "OIL"; MATNAME[FIRE] = "FIRE";
  MATNAME[PLANT] = "PLANT"; MATNAME[ACID] = "ACID"; MATNAME[SMOKE] = "SMOKE";
  MATNAME[EMBER] = "EMBER";

  // ---- tunables ---------------------------------------------------------
  var FIRE_LIFE = 70, EMBER_LIFE = 150, SMOKE_LIFE = 95;
  var FIRE_SPREAD = 0.28;     // chance fire jumps to an oil/plant neighbor
  var ACID_RATE = 0.045;       // chance acid dissolves an adjacent solid
  var PLANT_RATE = 0.45;       // chance a watered plant grows a shoot

  // ---- simulation state -------------------------------------------------
  var Sim = {
    W: 200, H: 150,
    grid: null, life: null, moved: null,
    frame: 0, seed: 1234, preset: "dunes", rng: null
  };
  var N = Sim.W * Sim.H;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedRng(s) { Sim.seed = s >>> 0; Sim.rng = mulberry32(Sim.seed); }

  function newBuffers() {
    Sim.grid = new Uint8Array(N);
    Sim.life = new Uint8Array(N);
    Sim.moved = new Uint8Array(N);
  }
  newBuffers();

  function clearGrid() { Sim.grid.fill(0); Sim.life.fill(0); Sim.frame = 0; }

  function setCell(i, v, l) {
    Sim.grid[i] = v; Sim.life[i] = (l || 0); Sim.moved[i] = 1;
  }
  function swapMove(a, b) {
    var g = Sim.grid, lf = Sim.life;
    var t = g[a]; g[a] = g[b]; g[b] = t;
    var tl = lf[a]; lf[a] = lf[b]; lf[b] = tl;
    Sim.moved[a] = 1; Sim.moved[b] = 1;
  }

  function dens(v) {
    switch (v) {
      case EMPTY: return 0;
      case SMOKE: case FIRE: case EMBER: return -1;
      case OIL: return 1;
      case WATER: case ACID: return 2;
      case SAND: return 3;
      default: return 100; // WALL / PLANT are solids
    }
  }
  function isFluid(t) { return t === OIL || t === WATER || t === ACID; }
  // Can a powder/liquid material `m` displace target `t`?
  function canSink(m, t) {
    if (t === EMPTY) return true;
    return isFluid(t) && dens(t) < dens(m);
  }

  function inB(x, y) { return x >= 0 && x < Sim.W && y >= 0 && y < Sim.H; }

  // ---- reactions --------------------------------------------------------
  function reactFire(i, x, y) {
    var l = Sim.life[i] - 1;
    var up = y > 0 ? i - Sim.W : -1, dn = y < Sim.H - 1 ? i + Sim.W : -1,
        lf = x > 0 ? i - 1 : -1, rt = x < Sim.W - 1 ? i + 1 : -1;
    var ns = [up, dn, lf, rt];
    for (var k = 0; k < 4; k++) {
      var ni = ns[k]; if (ni < 0) continue;
      var t = Sim.grid[ni];
      if (t === WATER) {
        setCell(i, SMOKE, SMOKE_LIFE);
        if (Sim.rng() < 0.5) setCell(ni, EMPTY, 0);
        return;
      }
      if ((t === PLANT || t === OIL) && Sim.rng() < FIRE_SPREAD) {
        setCell(ni, FIRE, FIRE_LIFE);
      }
    }
    if (l <= 0) { setCell(i, SMOKE, SMOKE_LIFE); return; }
    Sim.life[i] = l;
  }

  function reactPlant(i, x, y) {
    var up = y > 0 ? i - Sim.W : -1, dn = y < Sim.H - 1 ? i + Sim.W : -1,
        lf = x > 0 ? i - 1 : -1, rt = x < Sim.W - 1 ? i + 1 : -1;
    var wi = -1, wns = [up, dn, lf, rt];
    for (var k = 0; k < 4; k++) {
      var ni = wns[k]; if (ni < 0) continue;
      if (Sim.grid[ni] === WATER && Sim.rng() < PLANT_RATE) { wi = ni; break; }
    }
    if (wi < 0) return;
    var order = [up, lf, rt, dn];
    for (var j = 0; j < 4; j++) {
      var nj = order[j]; if (nj < 0) continue;
      if (Sim.grid[nj] === EMPTY) { setCell(nj, PLANT, 0); setCell(wi, EMPTY, 0); return; }
    }
  }

  function reactAcid(i, x, y) {
    var up = y > 0 ? i - Sim.W : -1, dn = y < Sim.H - 1 ? i + Sim.W : -1,
        lf = x > 0 ? i - 1 : -1, rt = x < Sim.W - 1 ? i + 1 : -1;
    var ns = [up, dn, lf, rt];
    for (var k = 0; k < 4; k++) {
      var ni = ns[k]; if (ni < 0) continue;
      var t = Sim.grid[ni];
      if ((t === SAND || t === WALL || t === PLANT) && Sim.rng() < ACID_RATE) {
        setCell(ni, EMPTY, 0);
        setCell(i, SMOKE, SMOKE_LIFE);
        return;
      }
    }
  }

  // ---- movement ---------------------------------------------------------
  function movePowder(i, x, y, d) {
    var g = Sim.grid, W = Sim.W, H = Sim.H;
    if (y + 1 < H && canSink(SAND, g[i + W])) { swapMove(i, i + W); return; }
    if (x + d >= 0 && x + d < W && y + 1 < H && canSink(SAND, g[i + W + d])) { swapMove(i, i + W + d); return; }
    if (x - d >= 0 && x - d < W && y + 1 < H && canSink(SAND, g[i + W - d])) { swapMove(i, i + W - d); return; }
  }

  function moveLiquid(i, x, y, v, d) {
    var g = Sim.grid, W = Sim.W, H = Sim.H;
    if (y + 1 < H && canSink(v, g[i + W])) { swapMove(i, i + W); return; }
    if (x + d >= 0 && x + d < W && y + 1 < H && canSink(v, g[i + W + d])) { swapMove(i, i + W + d); return; }
    if (x - d >= 0 && x - d < W && y + 1 < H && canSink(v, g[i + W - d])) { swapMove(i, i + W - d); return; }
    if (x + d >= 0 && x + d < W && g[i + d] === EMPTY) { swapMove(i, i + d); return; }
    if (x - d >= 0 && x - d < W && g[i - d] === EMPTY) { swapMove(i, i - d); return; }
  }

  function moveOil(i, x, y, d) {
    var g = Sim.grid, W = Sim.W, H = Sim.H;
    if (y + 1 < H && g[i + W] === EMPTY) { swapMove(i, i + W); return; }
    if (x + d >= 0 && x + d < W && y + 1 < H && g[i + W + d] === EMPTY) { swapMove(i, i + W + d); return; }
    if (x - d >= 0 && x - d < W && y + 1 < H && g[i + W - d] === EMPTY) { swapMove(i, i + W - d); return; }
    if (x + d >= 0 && x + d < W && g[i + d] === EMPTY) { swapMove(i, i + d); return; }
    if (x - d >= 0 && x - d < W && g[i - d] === EMPTY) { swapMove(i, i - d); return; }
  }

  function moveGas(i, x, y, d) {
    var g = Sim.grid, W = Sim.W, H = Sim.H;
    if (y - 1 >= 0 && g[i - W] === EMPTY) { swapMove(i, i - W); return; }
    if (x + d >= 0 && x + d < W && y - 1 >= 0 && g[i - W + d] === EMPTY) { swapMove(i, i - W + d); return; }
    if (x - d >= 0 && x - d < W && y - 1 >= 0 && g[i - W - d] === EMPTY) { swapMove(i, i - W - d); return; }
    if (x + d >= 0 && x + d < W && g[i + d] === EMPTY) { swapMove(i, i + d); return; }
    if (x - d >= 0 && x - d < W && g[i - d] === EMPTY) { swapMove(i, i - d); return; }
  }

  // ---- the tick ---------------------------------------------------------
  function step() {
    var g = Sim.grid, life = Sim.life, W = Sim.W, H = Sim.H, moved = Sim.moved;
    moved.fill(0);
    Sim.frame++;
    var ltr = (Sim.frame & 1) === 0;
    for (var y = H - 1; y >= 0; y--) {
      for (var xi = 0; xi < W; xi++) {
        var x = ltr ? xi : (W - 1 - xi);
        var i = y * W + x;
        if (moved[i]) continue;
        var v = g[i];
        if (v === EMPTY || v === WALL) continue;
        if (v === FIRE || v === EMBER) { reactFire(i, x, y); if (g[i] !== v) continue; }
        else if (v === SMOKE) { life[i]--; if (life[i] <= 0) { setCell(i, EMPTY, 0); continue; } }
        else if (v === PLANT) { reactPlant(i, x, y); if (g[i] !== v) continue; }
        else if (v === ACID) { reactAcid(i, x, y); if (g[i] !== v) continue; }
        var d = Sim.rng() < 0.5 ? 1 : -1;
        switch (v) {
          case SAND: movePowder(i, x, y, d); break;
          case WATER: case ACID: moveLiquid(i, x, y, v, d); break;
          case OIL: moveOil(i, x, y, d); break;
          case FIRE: case EMBER: case SMOKE: moveGas(i, x, y, d); break;
        }
      }
    }
  }

  // ---- scene generation (deterministic from the seeded rng) -------------
  function rnd(n) { return Math.floor(Sim.rng() * n); }
  function floor() {
    var W = Sim.W, H = Sim.H;
    for (var y = H - 2; y < H; y++)
      for (var x = 0; x < W; x++) setCell(y * W + x, WALL, 0);
  }
  function wallCol(x0, x1, y0, y1) {
    for (var y = y0; y < y1; y++)
      for (var x = x0; x < x1; x++)
        if (inB(x, y)) setCell(y * Sim.W + x, WALL, 0);
  }

  var PRESETS = {
    dunes: function () {
      floor();
      for (var k = 0; k < 7; k++) {
        var cx = ((k + 0.5) * Sim.W / 7 + rnd(Sim.W / 14) - Sim.W / 28) | 0;
        var n = 30 + rnd(70);
        for (var j = 0; j < n; j++) {
          var px = (cx + rnd(34) - 17) | 0, py = (Sim.H - 3 - rnd(12)) | 0;
          if (inB(px, py)) setCell(py * Sim.W + px, SAND, 0);
        }
      }
    },
    rain: function () {
      floor();
      for (var y = Sim.H - 11; y < Sim.H - 2; y++)
        for (var x = 0; x < Sim.W; x++) setCell(y * Sim.W + x, WATER, 0);
      for (var c = 0; c < 6; c++) {
        var cx = rnd(Sim.W);
        for (var yy = Sim.H - 3; yy > Sim.H - 14 && yy >= 0; yy--)
          if (rnd(2)) setCell(yy * Sim.W + cx, SAND, 0);
      }
    },
    oilspill: function () {
      floor();
      wallCol(5, 7, Sim.H - 34, Sim.H - 2);
      wallCol(Sim.W - 7, Sim.W - 5, Sim.H - 34, Sim.H - 2);
      for (var y = Sim.H - 32; y < Sim.H - 2; y++)
        for (var x = 7; x < Sim.W - 7; x++) setCell(y * Sim.W + x, WATER, 0);
      for (var y2 = Sim.H - 32; y2 < Sim.H - 20; y2++)
        for (var x2 = 7; x2 < Sim.W - 7; x2++) setCell(y2 * Sim.W + x2, OIL, 0);
      setCell((Sim.H - 21) * Sim.W + 12, FIRE, FIRE_LIFE);
      setCell((Sim.H - 21) * Sim.W + 13, FIRE, FIRE_LIFE);
    },
    acid: function () {
      floor();
      wallCol(5, 7, Sim.H - 28, Sim.H - 2);
      wallCol(Sim.W - 7, Sim.W - 5, Sim.H - 28, Sim.H - 2);
      wallCol(Sim.W - 22, Sim.W - 20, Sim.H - 28, Sim.H - 2);
      for (var y = Sim.H - 26; y < Sim.H - 2; y++)
        for (var x = 7; x < Sim.W - 7; x++) setCell(y * Sim.W + x, ACID, 0);
      for (var j = 0; j < 500; j++) {
        var px = (Sim.W / 2 + rnd(50) - 25) | 0, py = (Sim.H - 4 - rnd(22)) | 0;
        if (inB(px, py)) setCell(py * Sim.W + px, SAND, 0);
      }
      for (var p = 0; p < 80; p++) {
        var px2 = (12 + rnd(40)) | 0;
        if (inB(px2, Sim.H - 3)) setCell((Sim.H - 3) * Sim.W + px2, PLANT, 0);
      }
    },
    forest: function () {
      floor();
      for (var y = Sim.H - 7; y < Sim.H - 2; y++)
        for (var x = 0; x < (Sim.W / 3) | 0; x++) setCell(y * Sim.W + x, WATER, 0);
      for (var t = 0; t < 6; t++) {
        var bx = ((t + 0.5) * Sim.W / 6 + rnd(24) - 12) | 0;
        var top = Sim.H - 3 - (20 + rnd(12));
        for (var yy = Sim.H - 3; yy > top && yy >= 0; yy--)
          if (inB(bx, yy)) setCell(yy * Sim.W + bx, PLANT, 0);
      }
      setCell((Sim.H - 4) * Sim.W + ((Sim.W / 6) | 0), FIRE, FIRE_LIFE);
    },
    volcano: function () {
      var apex = Sim.H - 42;
      for (var y = Sim.H - 1; y >= apex; y--) {
        var half = (((Sim.H - 1 - y)) * (Sim.W / 2) / (Sim.H - 1 - apex)) | 0;
        for (var x = (Sim.W / 2 - half) | 0; x <= Sim.W / 2 + half && x < Sim.W; x++)
          if (x >= 0) setCell(y * Sim.W + x, WALL, 0);
      }
      setCell((apex - 1) * Sim.W + (Sim.W / 2 | 0), FIRE, FIRE_LIFE);
      setCell((apex - 1) * Sim.W + (Sim.W / 2 | 0) + 1, EMBER, EMBER_LIFE);
      for (var j = 0; j < 240; j++) {
        var px = (Sim.W / 2 + rnd(24) - 12) | 0, py = (Sim.H - 4 - rnd(34)) | 0;
        if (inB(px, py)) setCell(py * Sim.W + px, SAND, 0);
      }
    }
  };

  function applyPreset(name) {
    Sim.preset = name;
    clearGrid();
    var f = PRESETS[name];
    if (f) f();
  }

  // ---- serialization (share the exact board) ----------------------------
  function b64url(s) {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urldec(b) {
    b = b.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }
  function serializeBoard() {
    var g = Sim.grid, s = "", prev = g[0], run = 1;
    for (var i = 1; i < g.length; i++) {
      if (g[i] === prev) run++;
      else { s += prev + "," + run + "|"; prev = g[i]; run = 1; }
    }
    s += prev + "," + run + "|";
    return b64url(s);
  }
  function deserializeBoard(enc) {
    var s = b64urldec(enc), g = Sim.grid, tokens = s.split("|"), idx = 0;
    for (var t = 0; t < tokens.length; t++) {
      if (!tokens[t]) continue;
      var parts = tokens[t].split(",");
      var v = +parts[0], n = +parts[1] || 0;
      for (var k = 0; k < n && idx < g.length; k++) g[idx++] = v;
    }
  }

  // ---- counts (for the readout) ----------------------------------------
  function counts() {
    var c = {};
    for (var v = 1; v <= 9; v++) c[v] = 0;
    var g = Sim.grid;
    for (var i = 0; i < g.length; i++) if (g[i]) c[g[i]]++;
    return c;
  }

  // ---- color ------------------------------------------------------------
  var PALETTES = {
    natural: {
      bg: [14, 16, 22],
      map: { WALL: [91, 91, 102], SAND: [217, 180, 106], WATER: [47, 111, 208],
             OIL: [58, 47, 37], PLANT: [63, 163, 77], ACID: [140, 255, 43],
             SMOKE: [110, 110, 120], EMBER: [255, 90, 31] },
      fireHot: [255, 214, 74], fireCool: [255, 59, 31]
    },
    neon: {
      bg: [8, 8, 16],
      map: { WALL: [40, 40, 90], SAND: [255, 230, 80], WATER: [0, 200, 255],
             OIL: [180, 0, 255], PLANT: [0, 255, 140], ACID: [170, 255, 0],
             SMOKE: [120, 120, 200], EMBER: [255, 40, 120] },
      fireHot: [255, 255, 180], fireCool: [255, 0, 120]
    },
    mono: {
      bg: [18, 18, 18],
      map: { WALL: [120, 120, 120], SAND: [205, 205, 205], WATER: [92, 92, 92],
             OIL: [60, 60, 60], PLANT: [150, 150, 150], ACID: [232, 232, 232],
             SMOKE: [100, 100, 100], EMBER: [212, 212, 212] },
      fireHot: [255, 255, 255], fireCool: [170, 170, 170]
    }
  };

  function clamp255(n) { return n < 0 ? 0 : (n > 255 ? 255 : n | 0); }
  function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function getColor(v, life, tint, pal) {
    if (v === EMPTY) return pal.bg;
    if (v === FIRE) {
      var t = life / FIRE_LIFE; if (t < 0) t = 0; if (t > 1) t = 1;
      return lerp3(pal.fireCool, pal.fireHot, t);
    }
    var base = pal.map[MATNAME[v]] || [200, 200, 200];
    return [clamp255(base[0] + tint), clamp255(base[1] + tint), clamp255(base[2] + tint)];
  }

  // ---- DOM / interactive layer -----------------------------------------
  function initDOM() {
    var canvas = document.getElementById("falling");
    if (!canvas) return;
    var W = Sim.W, H = Sim.H, N = W * H;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(W, H);
    var tint = new Int8Array(N);
    for (var i = 0; i < N; i++) {
      var h = ((i * 2654435761) >>> 0) % 25;
      tint[i] = h - 12;
    }
    var pal = PALETTES.natural;

    function $(id) { return document.getElementById(id); }
    var readout = $("readout"), msg = $("msg");
    var running = true, rafId = null, speed = 2, curMat = SAND, brush = 4;

    function render() {
      var g = Sim.grid, life = Sim.life, data = img.data;
      for (var k = 0; k < N; k++) {
        var c = getColor(g[k], life[k], tint[k], pal);
        var p = k * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    function updateReadout() {
      var c = counts();
      var parts = [["step", Sim.frame]];
      [["sand", SAND], ["water", WATER], ["oil", OIL], ["fire", FIRE],
       ["plant", PLANT], ["acid", ACID], ["smoke", SMOKE], ["ember", EMBER]]
        .forEach(function (e) {
          if (c[e[1]]) parts.push([e[0], c[e[1]]]);
        });
      readout.textContent = parts.map(function (p) { return p[0] + " " + p[1]; }).join(" · ");
    }

    function frame() {
      if (running) {
        for (var s = 0; s < speed; s++) step();
        render(); updateReadout();
      }
      rafId = requestAnimationFrame(frame);
    }

    function flash(t) { if (msg) msg.textContent = t; }

    function setRunning(on) {
      running = on;
      var b = $("play");
      if (b) { b.textContent = on ? "⏸ Pause" : "▶ Run"; b.setAttribute("aria-pressed", on ? "true" : "false"); }
    }

    // ---- painting ------------------------------------------------------
    var painting = false;
    function cellFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var x = Math.floor((e.clientX - rect.left) / rect.width * W);
      var y = Math.floor((e.clientY - rect.top) / rect.height * H);
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return { x: x, y: y };
    }
    function paintAt(e) {
      var c = cellFromEvent(e); if (!c) return;
      var r = brush;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          var nx = c.x + dx, ny = c.y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H)
            setCell(ny * W + nx, curMat, curMat === FIRE ? FIRE_LIFE : (curMat === EMBER ? EMBER_LIFE : (curMat === SMOKE ? SMOKE_LIFE : 0)));
        }
      }
      Sim.preset = "custom";
      render(); updateReadout();
    }
    canvas.addEventListener("pointerdown", function (e) {
      painting = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      paintAt(e);
    });
    canvas.addEventListener("pointermove", function (e) { if (painting) paintAt(e); });
    window.addEventListener("pointerup", function () { painting = false; });

    // ---- material palette ----------------------------------------------
    var matBtns = document.querySelectorAll(".mat");
    for (var mi = 0; mi < matBtns.length; mi++) {
      matBtns[mi].addEventListener("click", function () {
        curMat = parseInt(this.getAttribute("data-mat"), 10) || EMPTY;
        for (var j = 0; j < matBtns.length; j++) matBtns[j].classList.remove("active");
        this.classList.add("active");
      });
    }

    // ---- presets -------------------------------------------------------
    var presetBtns = document.querySelectorAll(".preset");
    for (var pi = 0; pi < presetBtns.length; pi++) {
      presetBtns[pi].addEventListener("click", function () {
        var name = this.getAttribute("data-preset");
        seedRng(Sim.seed); applyPreset(name);
        render(); updateReadout(); setRunning(true);
        flash("Loaded “" + name + "” — watch the materials settle.");
      });
    }

    // ---- controls ------------------------------------------------------
    function bindRange(id, valId, set, fmt) {
      var el = $(id); if (!el) return;
      el.addEventListener("input", function () {
        set(parseInt(this.value, 10));
        var v = $(valId); if (v) v.textContent = fmt ? fmt(this.value) : this.value;
      });
    }
    bindRange("brush", "brush-val", function (v) { brush = v; });
    bindRange("speed", "speed-val", function (v) { speed = v; });
    var palSel = $("palette");
    if (palSel) palSel.addEventListener("change", function () {
      pal = PALETTES[this.value] || PALETTES.natural; render();
    });
    var seedEl = $("seed");
    if (seedEl) {
      seedEl.addEventListener("input", function () {
        var s = parseInt(this.value, 10) || 0;
        seedRng(s); applyPreset(Sim.preset === "custom" ? "dunes" : Sim.preset);
        render(); updateReadout(); setRunning(true);
      });
    }

    $("play").addEventListener("click", function () { setRunning(!running); });
    $("step").addEventListener("click", function () {
      setRunning(false); for (var s = 0; s < speed; s++) step();
      render(); updateReadout();
    });
    $("clear").addEventListener("click", function () {
      clearGrid(); Sim.preset = "custom"; render(); updateReadout(); setRunning(true);
      flash("Board cleared — pick a material and paint.");
    });
    $("reset").addEventListener("click", function () {
      seedRng(Sim.seed); applyPreset(Sim.preset === "custom" ? "dunes" : Sim.preset);
      render(); updateReadout(); setRunning(true);
      flash("Reset — rebuilt the scene from seed " + Sim.seed + ".");
    });
    $("share").addEventListener("click", function () {
      var payload = { s: Sim.seed >>> 0, p: Sim.preset, b: serializeBoard() };
      var enc = b64url(JSON.stringify(payload));
      var url = location.origin + location.pathname + "#d=" + enc;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { flash("Share link copied — it rebuilds this exact scene."); },
          function () { location.hash = "d=" + enc; flash("Share link is in the address bar."); });
      } else { location.hash = "d=" + enc; flash("Share link is in the address bar."); }
    });

    // ---- boot ----------------------------------------------------------
    function applyShare(hash) {
      var m = hash.match(/[#&]d=([^&]+)/); if (!m) return false;
      try {
        var pl = JSON.parse(b64urldec(m[1]));
        if (typeof pl.s !== "number") return false;
        seedRng(pl.s >>> 0);
        if (typeof pl.b === "string" && pl.b.length) {
          clearGrid(); deserializeBoard(pl.b); Sim.preset = "custom";
        } else if (pl.p && PRESETS[pl.p]) {
          applyPreset(pl.p);
        } else { applyPreset("dunes"); }
        return true;
      } catch (e) { return false; }
    }
    var fromHash = applyShare(location.hash);
    if (!fromHash) { seedRng(Sim.seed); applyPreset(Sim.preset); }
    if ($("seed")) $("seed").value = Sim.seed;
    render(); updateReadout(); setRunning(true);
    if (fromHash) flash("Loaded a shared link — that exact scene is restored.");
    else flash("Welcome — a sand scene is settling. Paint materials, or try a preset.");
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  // ---- expose a tiny hook for headless harnesses -------------------------
  if (typeof window !== "undefined") {
    window.agentSand = {
      reset: function (s, p) { seedRng(s); applyPreset(p || "dunes"); },
      step: function (n) { n = n || 1; for (var k = 0; k < n; k++) step(); },
      counts: counts, grid: function () { return Sim.grid; },
      W: Sim.W, H: Sim.H, MAT: { EMPTY: EMPTY, SAND: SAND, WATER: WATER, OIL: OIL,
        FIRE: FIRE, PLANT: PLANT, ACID: ACID, SMOKE: SMOKE, EMBER: EMBER, WALL: WALL }
    };
  }

  // ---- headless self-test (Node) ---------------------------------------
  if (typeof window === "undefined" && typeof document === "undefined") {
    function hashGrid() {
      var g = Sim.grid, lf = Sim.life, h = 2166136261 >>> 0;
      for (var i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 16777619) >>> 0; }
      for (var j = 0; j < lf.length; j++) { h ^= lf[j]; h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    }
    function runSelfTest() {
      var steps = 500;
      function run(seed, preset) {
        seedRng(seed); applyPreset(preset);
        for (var s = 0; s < steps; s++) step();
        return hashGrid();
      }
      var A = run(12345, "dunes");
      var B = run(12345, "dunes");
      var C = run(99999, "dunes");
      var D = run(12345, "oilspill");
      // serialization round-trip
      seedRng(4242); applyPreset("acid");
      var enc = serializeBoard(); var g0 = Sim.grid.slice();
      Sim.grid.fill(0); deserializeBoard(enc);
      var rt = true;
      for (var i = 0; i < g0.length; i++) if (g0[i] !== Sim.grid[i]) { rt = false; break; }

      var ok = (A === B) && (A !== C) && (A !== D) && rt;
      console.log("FALLING-SAND self-test: " + (ok ? "PASS" : "FAIL"));
      console.log("  same-seed reproducible (A==B): " + (A === B) + "  [" + A + "]");
      console.log("  diff-seed diverges (A!=C): " + (A !== C) + "  [C=" + C + "]");
      console.log("  diff-preset diverges (A!=D): " + (A !== D) + "  [D=" + D + "]");
      console.log("  board serialize round-trip: " + rt);
      if (!ok) process.exit(1);
    }
    runSelfTest();
  }

  if (typeof document !== "undefined" && document.getElementById("falling")) {
    initDOM();
  }
})();
