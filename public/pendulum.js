// agent-05 — double-pendulum chaos simulator (fully client-side).
// Real equations of motion integrated with RK4. No backend, no tracking.
(function () {
  "use strict";

  var canvas = document.getElementById("pendulum");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  function $(id) { return document.getElementById(id); }
  var speedEl = $("speed"), dampEl = $("damping"), gravEl = $("gravity");
  var mrEl = $("massratio"), lrEl = $("lenratio"), th1El = $("th1"), th2El = $("th2");
  var trailEl = $("trail"), ghostEl = $("ghost");
  var playBtn = $("play"), stepBtn = $("step"), resetBtn = $("reset");
  var randBtn = $("random"), shareBtn = $("share");

  var S = null, G = null;        // main + ghost state {a1,w1,a2,w2}
  var simTime = 0;
  var running = false;
  var rafId = null;
  var trail = [], gtrail = [];   // flat [x,y,...] of bob-2 positions
  var TRAIL_MAX = 1800;
  var DT = 0.006;                // sim seconds per substep

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  function params() {
    return {
      m2: clamp(parseFloat(mrEl.value), 0.2, 3),
      lr: clamp(parseFloat(lrEl.value), 0.2, 3),
      g: clamp(parseFloat(gravEl.value), 1, 30),
      damp: clamp(parseFloat(dampEl.value), 0, 0.6),
      speed: clamp(parseInt(speedEl.value, 10), 1, 40),
      th1: parseFloat(th1El.value),
      th2: parseFloat(th2El.value),
      trail: trailEl.checked,
      ghost: ghostEl.checked
    };
  }

  function makeState(p) {
    return { a1: deg2rad(p.th1), w1: 0, a2: deg2rad(p.th2), w2: 0 };
  }

  // Derivatives of [a1, w1, a2, w2] for the standard double-pendulum Lagrangian.
  function deriv(s, p) {
    var m1 = 1, m2 = p.m2, l1 = 1, l2 = p.lr, g = p.g;
    var a1 = s.a1, w1 = s.w1, a2 = s.a2, w2 = s.w2;
    var d = a1 - a2, sin_d = Math.sin(d), cos_d = Math.cos(d);
    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
    var a1_acc = (
      -g * (2 * m1 + m2) * Math.sin(a1)
      - m2 * g * Math.sin(a1 - 2 * a2)
      - 2 * sin_d * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cos_d)
    ) / (l1 * den);
    var a2_acc = (
      2 * sin_d * (
        w1 * w1 * l1 * (m1 + m2)
        + g * (m1 + m2) * Math.cos(a1)
        + w2 * w2 * l2 * m2 * cos_d
      )
    ) / (l2 * den);
    a1_acc -= p.damp * w1;   // linear damping torque
    a2_acc -= p.damp * w2;
    return { a1: w1, w1: a1_acc, a2: w2, w2: a2_acc };
  }

  function addS(s, k, h) {
    return {
      a1: s.a1 + k.a1 * h, w1: s.w1 + k.w1 * h,
      a2: s.a2 + k.a2 * h, w2: s.w2 + k.w2 * h
    };
  }

  function rk4(s, p, dt) {
    var k1 = deriv(s, p);
    var k2 = deriv(addS(s, k1, dt / 2), p);
    var k3 = deriv(addS(s, k2, dt / 2), p);
    var k4 = deriv(addS(s, k3, dt), p);
    return {
      a1: s.a1 + dt / 6 * (k1.a1 + 2 * k2.a1 + 2 * k3.a1 + k4.a1),
      w1: s.w1 + dt / 6 * (k1.w1 + 2 * k2.w1 + 2 * k3.w1 + k4.w1),
      a2: s.a2 + dt / 6 * (k1.a2 + 2 * k2.a2 + 2 * k3.a2 + k4.a2),
      w2: s.w2 + dt / 6 * (k1.w2 + 2 * k2.w2 + 2 * k3.w2 + k4.w2)
    };
  }

  function layout(p) {
    var W = canvas.width, H = canvas.height;
    var L = 1 + p.lr;                 // l1 + l2 in sim units (l1 = 1)
    var scale = (H * 0.62) / L;
    return { cx: W / 2, cy: H * 0.34, scale: scale };
  }

  function coords(s, p) {
    var L = layout(p);
    var l1 = L.scale, l2 = p.lr * L.scale;
    var x1 = L.cx + l1 * Math.sin(s.a1);
    var y1 = L.cy + l1 * Math.cos(s.a1);
    var x2 = x1 + l2 * Math.sin(s.a2);
    var y2 = y1 + l2 * Math.cos(s.a2);
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  function energy(s, p) {
    var m1 = 1, m2 = p.m2, l1 = 1, l2 = p.lr, g = p.g;
    var v1sq = l1 * l1 * s.w1 * s.w1;
    var v2sq = l1 * l1 * s.w1 * s.w1 + l2 * l2 * s.w2 * s.w2
      + 2 * l1 * l2 * s.w1 * s.w2 * Math.cos(s.a1 - s.a2);
    var KE = 0.5 * m1 * v1sq + 0.5 * m2 * v2sq;
    var PE = -(m1 + m2) * g * l1 * Math.cos(s.a1) - m2 * g * l2 * Math.cos(s.a2);
    return KE + PE;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function dot(x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawTrail(arr, color) {
    if (arr.length < 4) return;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(arr[0], arr[1]);
    for (var i = 2; i < arr.length; i += 2) ctx.lineTo(arr[i], arr[i + 1]);
    ctx.stroke();
  }

  function drawArm(s, p, armColor, bobColor, pivotColor) {
    var L = layout(p);
    var l1 = L.scale, l2 = p.lr * L.scale;
    var x1 = L.cx + l1 * Math.sin(s.a1);
    var y1 = L.cy + l1 * Math.cos(s.a1);
    var x2 = x1 + l2 * Math.sin(s.a2);
    var y2 = y1 + l2 * Math.cos(s.a2);
    ctx.strokeStyle = armColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(L.cx, L.cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    dot(L.cx, L.cy, 4, pivotColor);
    dot(x1, y1, 5, bobColor);
    dot(x2, y2, 7, bobColor);
  }

  function updateReadout(p) {
    var t1 = ((rad2deg(S.a1) % 360) + 360) % 360;
    var t2 = ((rad2deg(S.a2) % 360) + 360) % 360;
    var e = energy(S, p);
    var out = "t = " + simTime.toFixed(2) + " s   θ₁ = " + t1.toFixed(1)
      + "°   θ₂ = " + t2.toFixed(1) + "°   E = " + e.toFixed(2);
    if (p.ghost && G) {
      var eg = energy(G, p);
      out += "   ΔE " + (eg - e).toFixed(2);
    }
    readout.textContent = out;
  }

  function draw(p) {
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = cssVar("--card") || "#1b232e";
    ctx.fillRect(0, 0, W, H);
    if (p.trail) {
      drawTrail(gtrail, "rgba(124,156,245,0.22)");
      drawTrail(trail, cssVar("--accent-2") || "#7c9cf5");
    }
    drawArm(S, p, "#5ad1c4", "#e7edf3", "#9aa7b4");
    if (p.ghost && G) {
      drawArm(G, p, "rgba(124,156,245,0.55)",
              "rgba(231,237,243,0.5)", "rgba(154,167,180,0.5)");
    }
    updateReadout(p);
  }

  function reset() {
    var p = params();
    S = makeState(p);
    G = makeState(p);
    G.a1 += 1e-3;   // ghost starts a hair off — sensitive dependence
    G.a2 += 1e-3;
    simTime = 0;
    trail = [];
    gtrail = [];
    draw(p);
  }

  function substep() {
    var p = params();
    for (var i = 0; i < p.speed; i++) {
      S = rk4(S, p, DT);
      if (G) G = rk4(G, p, DT);
      simTime += DT;
    }
    if (p.trail) {
      var c1 = coords(S, p);
      trail.push(c1.x2, c1.y2);
      if (trail.length > TRAIL_MAX * 2) trail = trail.slice(trail.length - TRAIL_MAX * 2);
      if (G) {
        var c2 = coords(G, p);
        gtrail.push(c2.x2, c2.y2);
        if (gtrail.length > TRAIL_MAX * 2) gtrail = gtrail.slice(gtrail.length - TRAIL_MAX * 2);
      }
    }
    draw(p);
  }

  function frame() {
    if (!running) return;
    substep();
    rafId = requestAnimationFrame(frame);
  }

  function play() {
    if (running) return;
    running = true;
    playBtn.textContent = "⏸ Pause";
    frame();
  }

  function pause() {
    running = false;
    playBtn.textContent = "▶ Play";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---- hash <-> state -------------------------------------------------
  function encodeHash(p) {
    return "#m2=" + p.m2.toFixed(2) + "&lr=" + p.lr.toFixed(2) + "&g=" + p.g.toFixed(1)
      + "&d=" + p.damp.toFixed(2) + "&s=" + p.speed + "&t1=" + p.th1.toFixed(1)
      + "&t2=" + p.th2.toFixed(1) + "&tr=" + (p.trail ? 1 : 0) + "&gh=" + (p.ghost ? 1 : 0);
  }

  function applyHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return;
    var q = {};
    h.split("&").forEach(function (kv) {
      var a = kv.split("=");
      if (a.length === 2) q[a[0]] = a[1];
    });
    if (q.m2) mrEl.value = q.m2;
    if (q.lr) lrEl.value = q.lr;
    if (q.g) gravEl.value = q.g;
    if (q.d) dampEl.value = q.d;
    if (q.s) speedEl.value = q.s;
    if (q.t1) th1El.value = q.t1;
    if (q.t2) th2El.value = q.t2;
    if (q.tr) trailEl.checked = q.tr === "1";
    if (q.gh) ghostEl.checked = q.gh === "1";
  }

  function updateHash() { history.replaceState(null, "", encodeHash(params())); }

  function updateLabels() {
    $("speed-val").textContent = speedEl.value + "×";
    $("gravity-val").textContent = parseFloat(gravEl.value).toFixed(1);
    $("damping-val").textContent = parseFloat(dampEl.value).toFixed(2);
    $("massratio-val").textContent = parseFloat(mrEl.value).toFixed(1);
    $("lenratio-val").textContent = parseFloat(lrEl.value).toFixed(1);
    $("th1-val").textContent = th1El.value + "°";
    $("th2-val").textContent = th2El.value + "°";
  }

  function setMsg(t) { if (msg) msg.textContent = t; }

  function copyLink() {
    var url = location.origin + location.pathname + encodeHash(params());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { setMsg("Share link copied to clipboard."); },
        function () { setMsg("Copy failed — the link is in the address bar."); });
    } else {
      setMsg("The shareable link is the address bar: " + url);
    }
  }

  // ---- wiring ---------------------------------------------------------
  [speedEl, dampEl, gravEl, mrEl, lrEl].forEach(function (el) {
    el.addEventListener("input", function () { updateLabels(); updateHash(); });
  });
  th1El.addEventListener("input", function () { updateLabels(); reset(); updateHash(); });
  th2El.addEventListener("input", function () { updateLabels(); reset(); updateHash(); });
  trailEl.addEventListener("change", function () { updateHash(); draw(params()); });
  ghostEl.addEventListener("change", function () { updateHash(); draw(params()); });

  playBtn.addEventListener("click", function () { running ? pause() : play(); });
  stepBtn.addEventListener("click", function () { pause(); substep(); });
  resetBtn.addEventListener("click", function () { reset(); updateHash(); });
  randBtn.addEventListener("click", function () {
    th1El.value = Math.round((Math.random() * 2 - 1) * 180);
    th2El.value = Math.round((Math.random() * 2 - 1) * 180);
    updateLabels();
    reset();
    updateHash();
  });
  shareBtn.addEventListener("click", copyLink);

  // ---- init -----------------------------------------------------------
  applyHash();
  updateLabels();
  reset();
  updateHash();
})();
