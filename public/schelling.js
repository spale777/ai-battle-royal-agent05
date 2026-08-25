/* Schelling's model of segregation — agent-05 (v5.1)
 *
 * A classic agent-based model of emergent social segregation (Schelling, 1971).
 * Two "types" of agent (red / blue) are scattered on a grid with some empty
 * cells. Each agent is HAPPY if at least `threshold` of its occupied neighbours
 * are the same type; otherwise it is UNHAPPY and relocates to a random empty
 * cell. With only a mild individual preference for same-type neighbours, the
 * collective outcome is severe, large-scale segregation — a small local bias
 * produces a large global pattern. No central planner, no racism encoded in
 * the rules; the macro structure is an emergent property of the micro rule.
 *
 * Deterministic: every random choice (initial placement, the shuffle of
 * unhappy agents, and the choice of destination) is driven by a single
 * mulberry32 PRNG seeded from the "Seed" control, so a share link reproduces
 * the exact same run. The file is dual-mode: in a browser it renders the UI;
 * under Node (`node public/schelling.js`) it runs a determinism self-test.
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

  // Fisher-Yates shuffle driven by a provided rng (deterministic).
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var EMPTY = 0, RED = 1, BLUE = 2;

  // --- the model (no DOM) --------------------------------------------------
  function SchellingModel(opts) {
    opts = opts || {};
    this.size = opts.size || 120;
    this.threshold = (opts.threshold != null) ? opts.threshold : 0.35;
    this.redPct = (opts.red != null) ? opts.red : 45;
    this.bluePct = (opts.blue != null) ? opts.blue : 45;
    this.rng = mulberry32((opts.seed != null ? opts.seed : 1) >>> 0);
    this.steps = 0;
    this.grid = new Int8Array(this.size * this.size);
    this._init();
  }

  SchellingModel.prototype._init = function () {
    var N = this.size * this.size;
    var red = Math.round(N * this.redPct / 100);
    var blue = Math.round(N * this.bluePct / 100);
    var idx = new Array(N);
    for (var i = 0; i < N; i++) idx[i] = i;
    shuffle(idx, this.rng);
    this.grid.fill(0);
    for (var r = 0; r < red; r++) this.grid[idx[r]] = RED;
    for (var b = red; b < red + blue; b++) this.grid[idx[b]] = BLUE;
    this.steps = 0;
  };

  SchellingModel.prototype.neighbourStats = function (x, y) {
    var g = this.grid, N = this.size, self = g[y * N + x];
    var same = 0, other = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var nx = (x + dx + N) % N, ny = (y + dy + N) % N; // toroidal
        var v = g[ny * N + nx];
        if (v === self) same++;
        else if (v !== EMPTY) other++;
      }
    }
    return { same: same, other: other };
  };

  SchellingModel.prototype.happy = function (x, y) {
    var v = this.grid[y * this.size + x];
    if (v === EMPTY) return true;
    var s = this.neighbourStats(x, y);
    var tot = s.same + s.other;
    if (tot === 0) return true; // no occupied neighbours -> satisfied
    return (s.same / tot) >= this.threshold;
  };

  // One Schelling sweep: relocate every unhappy agent to a random empty cell.
  SchellingModel.prototype.step = function () {
    var N = this.size, g = this.grid;
    var unhappy = [], empty = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var c = y * N + x;
        if (g[c] === EMPTY) empty.push(c);
        else if (!this.happy(x, y)) unhappy.push(c);
      }
    }
    shuffle(unhappy, this.rng);
    shuffle(empty, this.rng);
    var ei = 0;
    for (var k = 0; k < unhappy.length; k++) {
      if (ei >= empty.length) break;
      var from = unhappy[k];
      var dest = empty[ei++];
      g[dest] = g[from];
      g[from] = EMPTY;
      empty.push(from); // vacated cell now available to later movers
    }
    this.steps++;
  };

  SchellingModel.prototype.metrics = function () {
    var N = this.size, g = this.grid;
    var sumSame = 0, sumTot = 0, happyCount = 0, occ = 0;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = g[y * N + x];
        if (v === EMPTY) continue;
        occ++;
        var s = this.neighbourStats(x, y);
        var tot = s.same + s.other;
        if (tot === 0) { happyCount++; continue; }
        sumSame += s.same; sumTot += tot;
        if (s.same / tot >= this.threshold) happyCount++;
      }
    }
    return {
      avgSimilarity: occ ? sumSame / sumTot : 0,
      happyPct: occ ? happyCount / occ : 0,
      steps: this.steps,
      occupied: occ
    };
  };

  // --- palettes -----------------------------------------------------------
  var PALETTES = {
    classic: { red: [226, 74, 59], blue: [59, 141, 226], empty: [21, 23, 28] },
    sunset:  { red: [255, 112, 67], blue: [255, 202, 40], empty: [27, 20, 16] },
    ocean:   { red: [0, 188, 212], blue: [30, 136, 229], empty: [10, 22, 34] },
    mono:    { red: [245, 245, 245], blue: [158, 158, 158], empty: [21, 23, 28] },
    forest:  { red: [239, 83, 80], blue: [102, 187, 106], empty: [16, 26, 18] }
  };

  // --- node self-test (determinism) --------------------------------------
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SchellingModel: SchellingModel, mulberry32: mulberry32 };
    if (require.main === module) {
      function run(seed, thr, red, blue, size) {
        var m = new SchellingModel({ seed: seed, threshold: thr, red: red, blue: blue, size: size });
        for (var i = 0; i < 60; i++) m.step();
        return m.metrics();
      }
      var a = run(12345, 0.35, 45, 45, 120);
      var b = run(12345, 0.35, 45, 45, 120); // identical seed
      var c = run(12346, 0.35, 45, 45, 120); // different seed
      var sameSeed = (a.avgSimilarity === b.avgSimilarity) && (a.happyPct === b.happyPct) && (a.steps === b.steps);
      var diffSeed = (a.avgSimilarity !== c.avgSimilarity) || (a.happyPct !== c.happyPct);
      var segregated = a.avgSimilarity > 0.6; // mild preference -> high segregation
      var ok = sameSeed && diffSeed && segregated;
      console.log(JSON.stringify({
        seed12345: a, seed12345_b: b, seed12346: c,
        sameSeedIdentical: sameSeed, diffSeedDiverges: diffSeed,
        mildPrefSegregates: segregated, ok: ok
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
    seed: 12345, threshold: 0.35, red: 45, blue: 45, size: 120,
    palette: "classic", speed: 4
  };

  function draw() {
    var N = model.size, g = model.grid;
    // Render the grid at native resolution onto an offscreen canvas, then
    // upscale to fill the visible canvas with crisp (non-smoothed) pixels.
    var off = document.createElement("canvas");
    off.width = N; off.height = N;
    var octx = off.getContext("2d");
    var img = octx.createImageData(N, N);
    var pal = PALETTES[state.palette] || PALETTES.classic;
    for (var i = 0; i < N * N; i++) {
      var v = g[i];
      var col = v === RED ? pal.red : v === BLUE ? pal.blue : pal.empty;
      var o = i * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1];
      img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, N, N, 0, 0, canvas.width, canvas.height);
  }

  function readout() {
    var m = model.metrics();
    var pct = (m.avgSimilarity * 100).toFixed(1);
    var hp = (m.happyPct * 100).toFixed(1);
    var note = m.avgSimilarity > 0.6
      ? "mild individual bias &rarr; strong collective segregation"
      : (m.avgSimilarity < 0.45 ? "stays integrated" : "partial clustering");
    $("readout").innerHTML =
      "<div class=\"ro-row\"><span>step</span><b>" + m.steps + "</b></div>" +
      "<div class=\"ro-row\"><span>% happy</span><b>" + hp + "%</b></div>" +
      "<div class=\"ro-row\"><span>avg same-neighbour</span><b>" + pct + "%</b></div>" +
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
    model = new SchellingModel({
      seed: state.seed, threshold: state.threshold,
      red: state.red, blue: state.blue, size: state.size
    });
    draw();
    readout();
  }

  function encodeState() {
    return [state.seed, state.threshold, state.red, state.blue, state.size, state.palette].join(",");
  }

  function decodeState(hash) {
    var parts = hash.replace(/^#/, "").split(",");
    if (parts.length < 6) return false;
    var s = state;
    s.seed = parseInt(parts[0], 10) || 1;
    s.threshold = Math.max(0.05, Math.min(0.95, parseFloat(parts[1]) || 0.35));
    s.red = Math.max(0, Math.min(90, parseInt(parts[2], 10) || 45));
    s.blue = Math.max(0, Math.min(90, parseInt(parts[3], 10) || 45));
    s.size = [80, 120, 160].indexOf(parseInt(parts[4], 10)) >= 0 ? parseInt(parts[4], 10) : 120;
    s.palette = PALETTES[parts[5]] ? parts[5] : "classic";
    return true;
  }

  function applyControls() {
    $("seed").value = state.seed; $("seed-val").textContent = state.seed;
    $("threshold").value = state.threshold; $("threshold-val").textContent = state.threshold.toFixed(2);
    $("red").value = state.red; $("red-val").textContent = state.red + "%";
    $("blue").value = state.blue; $("blue-val").textContent = state.blue + "%";
    $("size").value = String(state.size);
    $("palette").value = state.palette;
  }

  function syncFromControls() {
    state.seed = parseInt($("seed").value, 10) || 1;
    state.threshold = parseFloat($("threshold").value);
    state.red = parseInt($("red").value, 10);
    state.blue = parseInt($("blue").value, 10);
    state.size = parseInt($("size").value, 10);
    state.palette = $("palette").value;
    state.speed = parseInt($("speed").value, 10);
  }

  function msg(t) { $("msg").textContent = t || ""; }

  function init() {
    canvas = $("schelling");
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    if (location.hash && decodeState(location.hash)) applyControls();

    // presets
    var presets = {
      mild:    { threshold: 0.35, red: 45, blue: 45, size: 120 },
      strong:  { threshold: 0.70, red: 45, blue: 45, size: 120 },
      tolerant: { threshold: 0.15, red: 45, blue: 45, size: 120 },
      unequal: { threshold: 0.40, red: 60, blue: 30, size: 120 },
      roomy:   { threshold: 0.35, red: 40, blue: 40, size: 120 }
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

    ["seed", "threshold", "red", "blue", "size", "palette", "speed"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        syncFromControls();
        if (id === "palette" || id === "speed") { draw(); return; }
        rebuild();
      });
    });

    $("play").addEventListener("click", function () { setRunning(!running); });
    $("step").addEventListener("click", function () {
      setRunning(false); model.step(); draw(); readout();
    });
    $("reset").addEventListener("click", function () {
      model = new SchellingModel({
        seed: state.seed, threshold: state.threshold,
        red: state.red, blue: state.blue, size: state.size
      });
      draw(); readout();
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

    // stamp a small patch of red (drag) / blue (shift) by clicking
    var stamping = false, stampType = RED;
    function stamp(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = Math.floor((ev.clientX - rect.left) / rect.width * model.size);
      var y = Math.floor((ev.clientY - rect.top) / rect.height * model.size);
      var r = 3, N = model.size;
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        var nx = (x + dx + N) % N, ny = (y + dy + N) % N;
        model.grid[ny * N + nx] = stampType;
      }
      draw(); readout();
    }
    canvas.addEventListener("mousedown", function (ev) {
      stamping = true; stampType = ev.shiftKey ? BLUE : RED; stamp(ev);
    });
    canvas.addEventListener("mousemove", function (ev) { if (stamping) stamp(ev); });
    window.addEventListener("mouseup", function () { stamping = false; });

    rebuild();
    setRunning(true);
    frame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  global.SchellingModel = SchellingModel;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
