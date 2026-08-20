// agent-05 — Conway's Game of Life (client-side cellular automaton).
// Self-contained: no backend, no external calls. The board wraps toroidally.
// State can be encoded into the URL hash so a link reproduces an exact setup.
(function () {
  "use strict";

  var canvas = document.getElementById("life");
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");
  var playBtn = document.getElementById("play");
  var stepBtn = document.getElementById("step");
  var randomBtn = document.getElementById("random");
  var clearBtn = document.getElementById("clear");
  var shareBtn = document.getElementById("share");
  var speed = document.getElementById("speed");
  var speedVal = document.getElementById("speed-val");
  var cellsize = document.getElementById("cellsize");
  var cellsizeVal = document.getElementById("cellsize-val");

  var CELL = 10;          // logical cell size in px
  var COLS = 64;          // grid columns
  var ROWS = 64;          // grid rows
  var grid = makeGrid(COLS, ROWS);
  var next = makeGrid(COLS, ROWS);
  var running = false;
  var generation = 0;
  var population = 0;
  var timer = null;
  var lastGen = 0;
  var drawMode = 1;       // what a drag paints (1 alive, 0 dead)
  var dragging = false;

  function makeGrid(c, r) {
    var g = new Array(r);
    for (var i = 0; i < r; i++) g[i] = new Uint8Array(c);
    return g;
  }

  function resize() {
    CELL = parseInt(cellsize.value, 10) || 10;
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    draw();
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
  }

  function draw() {
    var bg = cssVar("--bg") || "#0e1116";
    var alive = cssVar("--accent") || "#5ad1c4";
    var grid_line = cssVar("--bg-alt") || "#141a22";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    population = 0;
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (grid[y][x]) {
          population++;
          ctx.fillStyle = alive;
          ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
        } else {
          ctx.fillStyle = grid_line;
          ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
        }
      }
    }
    readout.textContent = "Gen " + generation + " · population " + population +
      " · " + COLS + "×" + ROWS + (running ? " · running" : "");
  }

  function neighbors(x, y) {
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var nx = (x + dx + COLS) % COLS;
        var ny = (y + dy + ROWS) % ROWS;
        n += grid[ny][nx];
      }
    }
    return n;
  }

  function tick() {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var n = neighbors(x, y);
        var alive = grid[y][x];
        // Conway's rules on a toroidal wrap.
        next[y][x] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
      }
    }
    var tmp = grid; grid = next; next = tmp;
    generation++;
    draw();
  }

  function loop(ts) {
    if (!running) return;
    var rate = parseInt(speed.value, 10) || 12;
    var interval = 1000 / rate;
    if (ts - lastGen >= interval) {
      lastGen = ts;
      tick();
    }
    timer = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    lastGen = 0;
    playBtn.textContent = "⏸ Pause";
    timer = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    playBtn.textContent = "▶ Play";
    if (timer) cancelAnimationFrame(timer);
    timer = null;
    draw();
  }

  function flash(text) {
    msg.textContent = text;
    if (window.setTimeout) {
      clearTimeout(flash._t);
      flash._t = setTimeout(function () { msg.textContent = ""; }, 2200);
    }
  }

  // ---- patterns ---------------------------------------------------------
  function clearGrid() {
    for (var y = 0; y < ROWS; y++) grid[y].fill(0);
  }

  function place(cx, cy, cells) {
    // cells: array of [dx, dy] relative to (cx, cy)
    for (var i = 0; i < cells.length; i++) {
      var x = ((cx + cells[i][0]) % COLS + COLS) % COLS;
      var y = ((cy + cells[i][1]) % ROWS + ROWS) % ROWS;
      grid[y][x] = 1;
    }
  }

  var PATTERNS = {
    glider: [[1,0],[2,1],[0,2],[1,2],[2,2]],
    lwss: [[0,0],[3,0],[4,1],[0,2],[4,2],[1,3],[2,3],[3,3],[4,3]], // light-weight spaceship
    pulsar: (function () {
      // A period-3 oscillator.
      var base = [2,3,4,8,9,10];
      var pts = [];
      // top/bottom horizontal arms
      [[0,2],[0,7],[0,9],[0,14],[5,2],[5,7],[5,9],[5,14]].forEach(function (p) {
        pts.push([p[0],p[1]]);
      });
      // vertical arms
      [[2,0],[2,5],[2,7],[2,12],[2,14],[7,0],[7,5],[7,7],[7,12],[7,14],
       [9,0],[9,5],[9,7],[9,12],[9,14],[14,0],[14,5],[14,7],[14,12],[14,14]].forEach(function (p) {
        pts.push([p[0],p[1]]);
      });
      return pts;
    })(),
    gosper: [
      [0,4],[0,5],[1,4],[1,5],
      [10,4],[10,5],[10,6],[11,3],[11,7],[12,2],[12,8],[13,2],[13,8],
      [14,5],[15,3],[15,7],[16,4],[16,5],[16,6],[17,5],
      [20,2],[20,3],[20,4],[21,2],[21,3],[21,4],[22,1],[22,5],
      [24,0],[24,1],[24,5],[24,6],
      [34,2],[34,3],[35,2],[35,3]
    ],
    pentadecathlon: [
      [0,1],[1,1],[2,0],[2,2],[3,1],[4,1],[5,1],[6,1],[7,0],[7,2],[8,1],[9,1]
    ],
    acorn: [[1,0],[3,1],[0,2],[1,2],[4,2],[5,2],[6,2]]
  };

  function loadPattern(name) {
    stop();
    clearGrid();
    var cells = PATTERNS[name];
    if (!cells) return;
    generation = 0;
    place(Math.floor(COLS / 2), Math.floor(ROWS / 2), cells);
    draw();
    flash("Loaded " + name);
  }

  function randomize() {
    stop();
    generation = 0;
    for (var y = 0; y < ROWS; y++)
      for (var x = 0; x < COLS; x++)
        grid[y][x] = Math.random() < 0.28 ? 1 : 0;
    draw();
  }

  // ---- share state via URL hash -----------------------------------------
  function encode() {
    // Pack the live cells into a compact run: rows separated by ';', only
    // alive columns listed per row, e.g. "3,7,12;0,4;". Kept short for links.
    var parts = [];
    for (var y = 0; y < ROWS; y++) {
      var row = [];
      for (var x = 0; x < COLS; x++) if (grid[y][x]) row.push(x);
      parts.push(row.join(","));
    }
    return parts.join(";");
  }

  function decode(str) {
    var rows = str.split(";");
    for (var y = 0; y < ROWS; y++) {
      grid[y].fill(0);
      if (y < rows.length && rows[y]) {
        rows[y].split(",").forEach(function (xs) {
          var x = parseInt(xs, 10);
          if (!isNaN(x) && x >= 0 && x < COLS) grid[y][x] = 1;
        });
      }
    }
  }

  function restoreFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return false;
    try {
      var params = new URLSearchParams(h);
      var gen = parseInt(params.get("g"), 10);
      if (!isNaN(gen)) generation = gen;
      var board = params.get("b");
      if (board) { decode(board); return true; }
    } catch (e) { /* ignore malformed hash */ }
    return false;
  }

  function share() {
    var board = encode();
    var h = "#g=" + generation + "&b=" + encodeURIComponent(board);
    history.replaceState(null, "", h);
    var url = location.origin + location.pathname + h;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash("Share link copied to clipboard"); },
        function () { flash("Link set in URL bar (copy failed)"); }
      );
    } else {
      flash("Link set in URL bar");
    }
  }

  // ---- pointer drawing --------------------------------------------------
  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    var py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    var x = Math.floor(px / CELL);
    var y = Math.floor(py / CELL);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null;
    return { x: x, y: y };
  }

  function paint(ev) {
    var c = cellFromEvent(ev);
    if (!c) return;
    grid[c.y][c.x] = drawMode;
    draw();
  }

  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    var c = cellFromEvent(ev);
    if (!c) return;
    drawMode = grid[c.y][c.x] ? 0 : 1; // toggle based on first cell
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    paint(ev);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (dragging) paint(ev);
  });
  canvas.addEventListener("pointerup", function (ev) {
    dragging = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
  });
  canvas.addEventListener("pointercancel", function () { dragging = false; });

  // ---- wiring -----------------------------------------------------------
  playBtn.addEventListener("click", function () { running ? stop() : start(); });
  stepBtn.addEventListener("click", function () { stop(); tick(); });
  randomBtn.addEventListener("click", function () { randomize(); });
  clearBtn.addEventListener("click", function () { stop(); clearGrid(); generation = 0; draw(); });
  shareBtn.addEventListener("click", share);
  speed.addEventListener("input", function () {
    speedVal.textContent = speed.value + " gen/s";
  });
  cellsize.addEventListener("input", function () {
    cellsizeVal.textContent = cellsize.value + " px";
    resize();
  });

  var presets = document.querySelectorAll(".preset");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () { loadPattern(btn.dataset.preset); });
  });

  // Boot: restore a shared board if present, else show a glider.
  resize();
  if (!restoreFromHash()) {
    loadPattern("glider");
  } else {
    draw();
  }
})();
