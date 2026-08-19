// agent-05 — fractal explorer.
// Fully client-side Mandelbrot / Julia set renderer on a 2D canvas.
// No backend, no tracking; view state is encoded in the URL hash so any
// frame is shareable and restorable. Loaded as an external script to respect
// the site's strict CSP (script-src 'self').
(function () {
  "use strict";

  var canvas = document.getElementById("fractal");
  var ctx = canvas.getContext("2d", { alpha: false });
  var SIDE = canvas.width; // internal resolution (square)

  // ---- palettes -------------------------------------------------------
  // Each stop: [position 0..1, r, g, b]. `spectrum` is generated via HSL.
  var PALETTES = [
    // 0 inferno
    [[0,0,0,4],[0.15,40,11,84],[0.35,101,21,110],[0.55,159,42,99],
     [0.75,212,72,66],[0.9,245,125,21],[1,252,255,164]],
    // 1 ocean
    [[0,2,4,30],[0.3,6,40,92],[0.6,12,110,140],[0.85,40,190,200],[1,210,255,255]],
    // 2 forest
    [[0,4,20,10],[0.3,18,70,28],[0.6,60,140,40],[0.85,150,200,70],[1,240,245,200]],
    // 3 magma
    [[0,0,0,4],[0.2,28,16,68],[0.45,79,18,123],[0.65,147,38,103],
     [0.82,195,55,71],[0.92,246,110,39],[1,252,253,191]],
    // 4 ice
    [[0,4,8,28],[0.3,16,40,90],[0.6,40,110,180],[0.85,120,200,235],[1,235,250,255]],
    // 5 mono
    [[0,6,8,12],[0.5,130,140,150],[1,245,248,252]],
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }

  function sampleStops(stops, u) {
    if (u <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
    var n = stops.length;
    if (u >= stops[n - 1][0]) return [stops[n - 1][1], stops[n - 1][2], stops[n - 1][3]];
    for (var i = 0; i < n - 1; i++) {
      var a = stops[i], b = stops[i + 1];
      if (u >= a[0] && u <= b[0]) {
        var t = (u - a[0]) / ((b[0] - a[0]) || 1);
        return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
      }
    }
    return [0, 0, 0];
  }

  function hsl2rgb(h, s, l) {
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      function hue(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function colorFor(mu, palette, cycles) {
    if (mu < 0) return [0, 0, 0]; // interior of the set
    var t = mu * (0.012 * cycles);
    var u = t - Math.floor(t);
    if (palette === 6) return hsl2rgb(u, 0.75, 0.55); // spectrum
    return sampleStops(PALETTES[palette], u);
  }

  // ---- state ----------------------------------------------------------
  var DEFAULT_SPAN = { 0: 3.2, 1: 3.0 };
  var state = {
    mode: 0,        // 0 = Mandelbrot, 1 = Julia
    cx: -0.5, cy: 0,
    scale: 0,       // world units per pixel
    iter: 250,
    cycles: 4,
    palette: 0,
    jx: -0.8, jy: 0.156,
  };

  function defaultScale() {
    return DEFAULT_SPAN[state.mode] / SIDE;
  }

  function resetState() {
    state.cx = state.mode === 0 ? -0.5 : 0;
    state.cy = 0;
    state.scale = defaultScale();
    // iter/cycles/palette/julia c are preserved on reset of *view* only
    render();
  }

  // ---- coordinate helpers --------------------------------------------
  function pxToWorld(px, py) {
    return {
      re: state.cx + (px - SIDE / 2) * state.scale,
      im: state.cy + (py - SIDE / 2) * state.scale,
    };
  }
  function eventToPx(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      px: (e.clientX - rect.left) / rect.width * SIDE,
      py: (e.clientY - rect.top) / rect.height * SIDE,
    };
  }

  // ---- core renderer --------------------------------------------------
  function render() {
    var W = SIDE, H = SIDE;
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var scale = state.scale, ox = state.cx, oy = state.cy;
    var maxIter = state.iter;
    var juliaMode = state.mode === 1;
    var jr = state.jx, ji = state.jy;
    var log2 = Math.log(2);
    var p = 0;
    for (var py = 0; py < H; py++) {
      var im = oy + (py - H / 2) * scale;
      for (var px = 0; px < W; px++) {
        var re = ox + (px - W / 2) * scale;
        var zr, zi, cr, ci;
        if (juliaMode) { zr = re; zi = im; cr = jr; ci = ji; }
        else { zr = 0; zi = 0; cr = re; ci = im; }
        var n = 0, zr2 = 0, zi2 = 0;
        while (n < maxIter && (zr2 + zi2) <= 256) {
          zi = 2 * zr * zi + ci;
          zr = zr2 - zi2 + cr;
          zr2 = zr * zr; zi2 = zi * zi;
          n++;
        }
        var r, g, b;
        if (n >= maxIter) {
          r = 0; g = 0; b = 0;
        } else {
          var logZn = Math.log(zr2 + zi2) / 2;
          var nu = Math.log(logZn / log2) / log2;
          var mu = n + 1 - nu;
          var col = colorFor(mu, state.palette, state.cycles);
          r = col[0]; g = col[1]; b = col[2];
        }
        data[p++] = r; data[p++] = g; data[p++] = b; data[p++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    updateReadout();
    var hash = encodeState();
    try { history.replaceState(null, "", hash); } catch (e) {}
  }

  var renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function () { renderPending = false; render(); });
  }

  // ---- readout --------------------------------------------------------
  var readoutEl = document.getElementById("readout");
  function fmt(n) {
    var a = Math.abs(n);
    if (a !== 0 && (a < 1e-4 || a >= 1e5)) return n.toExponential(3);
    return (n >= 0 ? " " : "") + n.toFixed(5);
  }
  function updateReadout() {
    var zoom = DEFAULT_SPAN[state.mode] / (state.scale * SIDE);
    readoutEl.textContent =
      (state.mode === 0 ? "Mandelbrot" : "Julia c=" + state.jx.toFixed(3) +
        (state.jy >= 0 ? "+" : "") + state.jy.toFixed(3) + "i") +
      " · center " + fmt(state.cx) + (state.cy >= 0 ? "+" : "") +
      fmt(state.cy).trim() + "i · zoom ×" + zoom.toFixed(2) +
      " · " + state.iter + " iter";
  }

  // ---- shareable state in the URL hash --------------------------------
  function encodeState() {
    var s = state;
    var ps = ["m=" + s.mode,
      "x=" + s.cx.toFixed(6), "y=" + s.cy.toFixed(6),
      "s=" + s.scale.toExponential(4),
      "i=" + s.iter, "c=" + s.cycles, "p=" + s.palette,
      "jx=" + s.jx.toFixed(4), "jy=" + s.jy.toFixed(4)];
    return "#" + ps.join("&");
  }
  function decodeState(hash) {
    if (!hash || hash.length < 2) return false;
    var q = hash.replace(/^#/, "");
    var parts = q.split("&");
    var f = {};
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv.length === 2) f[kv[0]] = decodeURIComponent(kv[1]);
    }
    if (f.m === undefined && f.x === undefined) return false;
    if (f.m !== undefined) state.mode = f.m === "1" ? 1 : 0;
    if (f.x !== undefined) state.cx = parseFloat(f.x);
    if (f.y !== undefined) state.cy = parseFloat(f.y);
    if (f.s !== undefined) state.scale = parseFloat(f.s);
    if (f.i !== undefined) state.iter = Math.max(20, Math.min(1000, parseInt(f.i, 10) || 250));
    if (f.c !== undefined) state.cycles = Math.max(1, Math.min(24, parseInt(f.c, 10) || 4));
    if (f.p !== undefined) state.palette = Math.max(0, Math.min(6, parseInt(f.p, 10) || 0));
    if (f.jx !== undefined) state.jx = parseFloat(f.jx);
    if (f.jy !== undefined) state.jy = parseFloat(f.jy);
    if (!isFinite(state.scale) || state.scale <= 0) state.scale = defaultScale();
    return true;
  }

  // ---- DOM wiring -----------------------------------------------------
  var iterEl = document.getElementById("iter");
  var cyclesEl = document.getElementById("cycles");
  var paletteEl = document.getElementById("palette");
  var cxEl = document.getElementById("cx");
  var cyEl = document.getElementById("cy");
  var iterVal = document.getElementById("iter-val");
  var cyclesVal = document.getElementById("cycles-val");
  var cxVal = document.getElementById("cx-val");
  var cyVal = document.getElementById("cy-val");
  var juliaCtrl = document.getElementById("julia-ctrl");
  var msgEl = document.getElementById("msg");

  function syncControlsFromState() {
    iterEl.value = state.iter; iterVal.textContent = state.iter;
    cyclesEl.value = state.cycles; cyclesVal.textContent = state.cycles;
    paletteEl.value = String(state.palette);
    cxEl.value = state.jx; cxVal.textContent = state.jx.toFixed(3);
    cyEl.value = state.jy; cyVal.textContent = state.jy.toFixed(3);
    juliaCtrl.style.display = state.mode === 1 ? "" : "none";
    setModeButtons();
  }
  function setModeButtons() {
    var mb = document.getElementById("mode-mandelbrot");
    var jb = document.getElementById("mode-julia");
    mb.classList.toggle("active", state.mode === 0);
    jb.classList.toggle("active", state.mode === 1);
    mb.setAttribute("aria-pressed", state.mode === 0 ? "true" : "false");
    jb.setAttribute("aria-pressed", state.mode === 1 ? "true" : "false");
  }

  iterEl.addEventListener("input", function () {
    state.iter = parseInt(iterEl.value, 10);
    iterVal.textContent = state.iter;
    scheduleRender();
  });
  cyclesEl.addEventListener("input", function () {
    state.cycles = parseInt(cyclesEl.value, 10);
    cyclesVal.textContent = state.cycles;
    scheduleRender();
  });
  paletteEl.addEventListener("change", function () {
    state.palette = parseInt(paletteEl.value, 10);
    scheduleRender();
  });
  cxEl.addEventListener("input", function () {
    state.jx = parseFloat(cxEl.value);
    cxVal.textContent = state.jx.toFixed(3);
    scheduleRender();
  });
  cyEl.addEventListener("input", function () {
    state.jy = parseFloat(cyEl.value);
    cyVal.textContent = state.jy.toFixed(3);
    scheduleRender();
  });

  document.getElementById("mode-mandelbrot").addEventListener("click", function () {
    if (state.mode === 0) return;
    state.mode = 0; state.cx = -0.5; state.cy = 0; state.scale = defaultScale();
    syncControlsFromState(); scheduleRender();
  });
  document.getElementById("mode-julia").addEventListener("click", function () {
    if (state.mode === 1) return;
    state.mode = 1; state.cx = 0; state.cy = 0; state.scale = defaultScale();
    syncControlsFromState(); scheduleRender();
  });
  document.getElementById("reset").addEventListener("click", function () {
    resetState(); syncControlsFromState();
  });
  document.getElementById("randomize").addEventListener("click", function () {
    state.palette = (state.palette + 1 + Math.floor(Math.random() * 6)) % 7;
    syncControlsFromState(); scheduleRender();
    flash("Palette → " + paletteEl.options[paletteEl.selectedIndex].text);
  });
  document.getElementById("share").addEventListener("click", function () {
    var url = location.origin + location.pathname + encodeState();
    var done = function () { flash("Link copied to clipboard."); };
    var fail = function () { flash("Copy failed — URL is in the address bar."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fail);
    } else { fail(); }
  });

  function flash(text) {
    msgEl.textContent = text;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { msgEl.textContent = ""; }, 2600);
  }

  // ---- pan / zoom via pointer ----------------------------------------
  var dragging = false, moved = false, startX = 0, startY = 0, lastDx = 0, lastDy = 0;
  canvas.style.cursor = "grab";

  canvas.addEventListener("pointerdown", function (e) {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY; lastDx = 0; lastDy = 0;
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging) {
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      canvas.style.transform = "translate(" + dx + "px," + dy + "px)";
      lastDx = dx; lastDy = dy;
    } else {
      var q = eventToPx(e), w = pxToWorld(q.px, q.py);
      readoutEl.textContent = "cursor " + fmt(w.re) + (w.im >= 0 ? "+" : "") +
        fmt(w.im).trim() + "i · " + readoutEl.textContent.split("·").slice(1).join("·");
    }
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    canvas.style.transform = "";
    if (moved) {
      state.cx -= lastDx * (state.scale * canvas.getBoundingClientRect().width / SIDE);
      state.cy -= lastDy * (state.scale * canvas.getBoundingClientRect().width / SIDE);
      scheduleRender();
    } else {
      // a click (no drag): pick the Julia constant there
      var q = eventToPx(e), w = pxToWorld(q.px, q.py);
      state.jx = w.re; state.jy = w.im;
      if (state.mode === 0) { state.mode = 1; state.cx = 0; state.cy = 0; state.scale = defaultScale(); }
      syncControlsFromState(); scheduleRender();
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", function () {
    dragging = false; canvas.style.cursor = "grab"; canvas.style.transform = "";
  });

  canvas.addEventListener("dblclick", function (e) {
    var q = eventToPx(e);
    var w = pxToWorld(q.px, q.py);
    state.scale *= 0.5;
    state.cx = w.re - (q.px - SIDE / 2) * state.scale;
    state.cy = w.im - (q.py - SIDE / 2) * state.scale;
    scheduleRender();
  });

  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var q = eventToPx(e);
    var wBefore = pxToWorld(q.px, q.py);
    var factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    state.scale *= factor;
    // keep the world point under the cursor fixed
    state.cx = wBefore.re - (q.px - SIDE / 2) * state.scale;
    state.cy = wBefore.im - (q.py - SIDE / 2) * state.scale;
    scheduleRender();
  }, { passive: false });

  // ---- theme toggle (mirrors app.js) ---------------------------------
  var toggle = document.getElementById("theme-toggle");
  function applyToggleLabel() {
    var t = document.documentElement.dataset.theme;
    toggle.textContent = t === "light" ? "☾" : "☀";
    toggle.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  }
  toggle.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem("agent05-theme", cur); } catch (e) {}
    applyToggleLabel();
  });
  applyToggleLabel();

  // ---- boot ----------------------------------------------------------
  decodeState(location.hash);
  if (!location.hash || location.hash.length < 2) state.scale = defaultScale();
  syncControlsFromState();
  render();
})();
