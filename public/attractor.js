// agent-05 — strange-attractor explorer (fully client-side).
// Real chaotic 3D ODE systems integrated live with RK4, rotated on a 2D canvas.
(function () {
  "use strict";

  var canvas = document.getElementById("attractor");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var readout = document.getElementById("readout");
  var msg = document.getElementById("msg");

  function $(id) { return document.getElementById(id); }
  var speedEl = $("speed"), zoomEl = $("zoom"), arEl = $("autorotate"), cbEl = $("colorby");
  var speedVal = $("speed-val"), zoomVal = $("zoom-val");
  var resetBtn = $("reset"), randomBtn = $("random"), shareBtn = $("share");

  var SYS = {
    lorenz: {
      name: "Lorenz",
      p: { sigma: 10, rho: 28, beta: 8 / 3 },
      dt: 0.006,
      center: [0, 0, 25],
      scale: 7.2,
      start: [1, 1, 1],
      eq: function (p, x, y, z) {
        return [p.sigma * (y - x), x * (p.rho - z) - y, x * y - p.beta * z];
      },
      label: "σ=10 ρ=28 β=2.67"
    },
    rossler: {
      name: "Rössler",
      p: { a: 0.2, b: 0.2, c: 5.7 },
      dt: 0.015,
      center: [0, 0, 6],
      scale: 11,
      start: [1, 1, 1],
      eq: function (p, x, y, z) {
        return [-y - z, x + p.a * y, p.b + z * (x - p.c)];
      },
      label: "a=0.2 b=0.2 c=5.7"
    },
    aizawa: {
      name: "Aizawa",
      p: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
      dt: 0.01,
      center: [0, 0, 0.6],
      scale: 130,
      start: [0.1, 0, 0],
      eq: function (p, x, y, z) {
        var r = (z - p.b);
        return [
          r * x - p.d * y,
          p.d * x + r * y,
          p.c + p.a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + p.e * z) + p.f * z * x * x * x
        ];
      },
      label: "a=0.95 b=0.7 c=0.6 d=3.5 e=0.25 f=0.1"
    },
    thomas: {
      name: "Thomas",
      p: { b: 0.19 },
      dt: 0.02,
      center: [0, 0, 0],
      scale: 30,
      start: [1.1, 1.1, -0.01],
      eq: function (p, x, y, z) {
        return [Math.sin(y) - p.b * x, Math.sin(z) - p.b * y, Math.sin(x) - p.b * z];
      },
      label: "b=0.19"
    },
    halvorsen: {
      name: "Halvorsen",
      p: { a: 1.4 },
      dt: 0.006,
      center: [0, 0, 0],
      scale: 15,
      start: [-5, 0, 0],
      eq: function (p, x, y, z) {
        return [
          -p.a * x - 4 * y - 4 * z - y * y,
          -p.a * y - 4 * z - 4 * x - z * z,
          -p.a * z - 4 * x - 4 * y - x * x
        ];
      },
      label: "a=1.4"
    }
  };

  var sysKey = "lorenz";
  var state = null;          // [x,y,z]
  var t = 0;
  var pts = [];              // flat [x,y,z,...] world coords
  var MAXPTS = 4200;
  var yaw = 35, pitch = 18;  // degrees
  var yawRate = 0.18;        // deg/frame when auto-rotating

  // ---- DPI-aware sizing ------------------------------------------------
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = canvas.clientWidth || canvas.width;
    H = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }

  // ---- RK4 -------------------------------------------------------------
  function deriv(sys, x, y, z) {
    var v = sys.eq(sys.p, x, y, z);
    return v;
  }
  function rk4(sys, st, dt) {
    var x = st[0], y = st[1], z = st[2];
    var k1 = deriv(sys, x, y, z);
    var k2 = deriv(sys, x + dt / 2 * k1[0], y + dt / 2 * k1[1], z + dt / 2 * k1[2]);
    var k3 = deriv(sys, x + dt / 2 * k2[0], y + dt / 2 * k2[1], z + dt / 2 * k2[2]);
    var k4 = deriv(sys, x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
    var nx = x + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    var ny = y + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    var nz = z + dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    return [nx, ny, nz];
  }

  function resetCurve(keepView) {
    var sys = SYS[sysKey];
    state = sys.start.slice();
    t = 0;
    pts = [];
    if (!keepView) { yaw = 35; pitch = 18; }
  }

  // ---- projection ------------------------------------------------------
  function project(sys, x, y, z, zoom) {
    var cx = sys.center[0], cy = sys.center[1], cz = sys.center[2];
    var X = x - cx, Y = y - cy, Z = z - cz;
    var a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
    // yaw around z (vertical)
    var x1 = X * Math.cos(a) - Y * Math.sin(a);
    var y1 = X * Math.sin(a) + Y * Math.cos(a);
    var z1 = Z;
    // pitch around x
    var y2 = y1 * Math.cos(b) - z1 * Math.sin(b);
    var z2 = y1 * Math.sin(b) + z1 * Math.cos(b);
    var s = sys.scale * zoom;
    return {
      sx: W / 2 + x1 * s * DPR,
      sy: H / 2 - z2 * s * DPR,
      depth: y2
    };
  }

  // ---- render ----------------------------------------------------------
  function render() {
    var sys = SYS[sysKey];
    var zoom = parseFloat(zoomEl.value);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var n = pts.length / 3;
    if (n < 2) return;
    var colorby = cbEl.checked;

    ctx.lineWidth = Math.max(1, DPR);
    ctx.lineCap = "round";
    var prev = project(sys, pts[0], pts[1], pts[2], zoom);
    for (var i = 1; i < n; i++) {
      var cur = project(sys, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], zoom);
      var age = i / n;                 // 0 = oldest, 1 = newest
      var alpha = 0.12 + 0.78 * age;
      if (colorby) {
        var hue = (sys._hue0 + age * 300) % 360;
        ctx.strokeStyle = "hsla(" + hue.toFixed(0) + ",85%,62%," + alpha.toFixed(3) + ")";
      } else {
        ctx.strokeStyle = "rgba(120,220,170," + alpha.toFixed(3) + ")";
      }
      ctx.beginPath();
      ctx.moveTo(prev.sx, prev.sy);
      ctx.lineTo(cur.sx, cur.sy);
      ctx.stroke();
      prev = cur;
    }
  }

  function updateReadout() {
    var sys = SYS[sysKey];
    var zoom = parseFloat(zoomEl.value);
    var s = sys.name + " · " + sys.label + " · t=" + t.toFixed(2) +
      " · " + (pts.length / 3 | 0) + " pts · dt=" + sys.dt +
      " · yaw=" + yaw.toFixed(0) + "° pitch=" + pitch.toFixed(0) + "° · zoom=" + zoom.toFixed(2) +
      "× · " + (arEl.checked ? "auto-rotate on" : "auto-rotate off");
    readout.textContent = s;
  }

  // ---- loop ------------------------------------------------------------
  var rafId = null;
  function frame() {
    var sys = SYS[sysKey];
    var steps = parseInt(speedEl.value, 10);
    for (var s = 0; s < steps; s++) {
      state = rk4(sys, state, sys.dt);
      if (!isFinite(state[0]) || !isFinite(state[1]) || !isFinite(state[2])) {
        state = sys.start.slice();
      }
      pts.push(state[0], state[1], state[2]);
      t += sys.dt;
    }
    while (pts.length / 3 > MAXPTS) {
      pts.splice(0, 3);
    }
    if (arEl.checked) {
      yaw += yawRate;
      if (yaw > 360) yaw -= 360;
    }
    render();
    updateReadout();
    rafId = requestAnimationFrame(frame);
  }

  // ---- interactions ----------------------------------------------------
  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    arEl.checked = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.4;
    pitch += (e.clientY - lastY) * 0.4;
    pitch = Math.max(-89, Math.min(89, pitch));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", function (e) {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var z = parseFloat(zoomEl.value);
    z *= e.deltaY < 0 ? 1.08 : 0.926;
    z = Math.max(0.3, Math.min(4, z));
    zoomEl.value = z.toFixed(2);
    zoomVal.textContent = z.toFixed(2) + "×";
  }, { passive: false });

  function selectSys(key) {
    sysKey = key;
    for (var k in SYS) {
      var btn = $("sys-" + k);
      if (btn) {
        btn.classList.toggle("active", k === key);
        btn.setAttribute("aria-pressed", k === key ? "true" : "false");
      }
    }
    // give each system a stable hue offset so colors differ between systems
    SYS[key]._hue0 = ({ lorenz: 0, rossler: 40, aizawa: 180, thomas: 280, halvorsen: 320 })[key] || 0;
    resetCurve(false);
  }
  ["lorenz", "rossler", "aizawa", "thomas", "halvorsen"].forEach(function (k) {
    var b = $("sys-" + k);
    if (b) b.addEventListener("click", function () { selectSys(k); });
  });

  speedEl.addEventListener("input", function () { speedVal.textContent = speedEl.value; });
  zoomEl.addEventListener("input", function () { zoomVal.textContent = parseFloat(zoomEl.value).toFixed(2) + "×"; });

  resetBtn.addEventListener("click", function () { resetCurve(false); flash("Curve reset."); });
  randomBtn.addEventListener("click", function () {
    yaw = Math.random() * 360;
    pitch = -40 + Math.random() * 80;
    zoomEl.value = (0.6 + Math.random() * 2.2).toFixed(2);
    zoomVal.textContent = parseFloat(zoomEl.value).toFixed(2) + "×";
    flash("View randomized.");
  });

  function flash(txt) {
    msg.textContent = txt;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { msg.textContent = ""; }, 1600);
  }

  // ---- share link (state in hash) -------------------------------------
  function buildHash() {
    return [sysKey,
      "sp=" + speedEl.value,
      "zm=" + parseFloat(zoomEl.value).toFixed(2),
      "ar=" + (arEl.checked ? 1 : 0),
      "cb=" + (cbEl.checked ? 1 : 0),
      "yw=" + yaw.toFixed(1),
      "pt=" + pitch.toFixed(1)
    ].join(";");
  }
  function parseHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    var parts = h.split(";");
    var set = {};
    parts.forEach(function (seg) {
      var kv = seg.split("=");
      if (kv.length === 2) set[kv[0]] = kv[1];
    });
    if (SYS[parts[0]]) {
      selectSys(parts[0]);
    } else {
      // even without a valid system key, fall through to defaults
    }
    if (set.sp) { speedEl.value = set.sp; speedVal.textContent = set.sp; }
    if (set.zm) { zoomEl.value = set.zm; zoomVal.textContent = parseFloat(set.zm).toFixed(2) + "×"; }
    if (set.ar !== undefined) arEl.checked = set.ar === "1";
    if (set.cb !== undefined) cbEl.checked = set.cb === "1";
    if (set.yw) yaw = parseFloat(set.yw);
    if (set.pt) pitch = Math.max(-89, Math.min(89, parseFloat(set.pt)));
  }
  shareBtn.addEventListener("click", function () {
    location.hash = buildHash();
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { flash("Share link copied to clipboard."); },
        function () { flash("Link set in the address bar (copy failed)."); });
    } else {
      flash("Link set in the address bar.");
    }
  });

  // ---- boot ------------------------------------------------------------
  resize();
  window.addEventListener("resize", function () { resize(); });
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    arEl.checked = false;
  }
  parseHash();
  if (sysKey === "lorenz" && location.hash === "") selectSys("lorenz");
  frame();
})();
