/* ===== Pythagoras Interactive Liquid Simulation ===== */
(function () {
  "use strict";

  /* ---------- DOM ---------- */
  var canvas = document.getElementById("mainCanvas");
  var ctx = canvas.getContext("2d");
  var wrap = document.getElementById("canvas-wrap");
  var btnC = document.getElementById("btnFillC");
  var btnAB = document.getElementById("btnFillAB");
  var btnReset = document.getElementById("btnReset");
  var btnSensor = document.getElementById("btnSensor");
  var sensorPanel = document.getElementById("sensor-panel");
  var sAlpha = document.getElementById("sAlpha");
  var sBeta = document.getElementById("sBeta");
  var sGamma = document.getElementById("sGamma");
  var hintOverlay = document.getElementById("hint-overlay");
  var eqVisual = document.getElementById("eqVisual");

  /* ---------- Math constants ---------- */
  var PI = Math.PI;
  var TWO_PI = PI * 2;
  var DEG = PI / 180;
  var sin = Math.sin;
  var cos = Math.cos;
  var abs = Math.abs;
  var sqrt = Math.sqrt;
  var min = Math.min;
  var max = Math.max;
  var floor = Math.floor;
  var atan2 = Math.atan2;

  /* ---------- Triangle sides (3-4-5) ---------- */
  var SIDE_A = 3;
  var SIDE_B = 4;
  var SIDE_C = 5;
  var SCALE = 0.062;

  /* ---------- Colors ---------- */
  var CA = { r: 239, g: 68, b: 68 };   /* red a */
  var CB = { r: 34, g: 197, b: 94 };    /* green b */
  var CC = { r: 234, g: 179, b: 8 };    /* gold c */
  var CW = { r: 59, g: 130, b: 246 };   /* water blue */
  var CD = { r: 29, g: 78, b: 216 };    /* water deep */

  function rgba(c, a) {
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }
  function rgb(c) { return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }
  function lerpColor(c1, c2, t) {
    return {
      r: floor(c1.r + (c2.r - c1.r) * t),
      g: floor(c1.g + (c2.g - c1.g) * t),
      b: floor(c1.b + (c2.b - c1.b) * t)
    };
  }

  /* ---------- State ---------- */
  var W, H, CX, CY, R, unit;
  var dpr = window.devicePixelRatio || 1;

  var rotation = 0;
  var rotVel = 0;
  var targetRot = null;
  var dragging = false;
  var dragStartA = 0;
  var dragStartR = 0;
  var lastPtrA = 0;
  var lastPtrT = 0;

  var fillMode = "none";   /* "none" | "c" | "ab" */
  var liqLevel = 0;
  var liqTarget = 0;
  var liqVel = 0;

  var sensorOn = false;
  var devAlpha = 0, devBeta = 0, devGamma = 0;
  var orientationInit = false;

  var bubbles = [];
  var particles = [];
  var time = 0;
  var hintGone = false;
  var frameCount = 0;

  /* ---------- Geometry ---------- */
  function buildGeo() {
    var s = unit;
    var a = SIDE_A * s;
    var b = SIDE_B * s;
    /* Right angle at P0, side a goes up, side b goes right */
    var oX = -b * 0.12;
    var oY = a * 0.08;
    var P0 = { x: oX, y: oY };
    var P1 = { x: oX + b, y: oY };
    var P2 = { x: oX, y: oY - a };
    return { a: a, b: b, P0: P0, P1: P1, P2: P2 };
  }

  function rot(px, py, angle) {
    var c = cos(angle), s = sin(angle);
    return { x: px * c - py * s, y: px * s + py * c };
  }

  function squareVerts(pA, pB, outward) {
    var dx = pB.x - pA.x, dy = pB.y - pA.y;
    var nx = outward ? -dy : dy;
    var ny = outward ? dx : -dx;
    return [pA, pB, { x: pB.x + nx, y: pB.y + ny }, { x: pA.x + nx, y: pA.y + ny }];
  }

  /* ---------- Canvas sizing ---------- */
  function resize() {
    var rect = wrap.getBoundingClientRect();
    var mW = rect.width - 16;
    var mH = rect.height - 16;
    var dim = min(mW, mH, 720);
    W = H = dim;
    canvas.width = dim * dpr;
    canvas.height = dim * dpr;
    canvas.style.width = dim + "px";
    canvas.style.height = dim + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = dim / 2;
    CY = dim / 2;
    R = dim / 2 - 2;
    unit = dim * SCALE;
  }

  /* ---------- Polygon clipping (Sutherland-Hodgman below Y) ---------- */
  function clipBelow(verts, yLine) {
    var out = [];
    var n = verts.length;
    for (var i = 0; i < n; i++) {
      var cur = verts[i];
      var nxt = verts[(i + 1) % n];
      var cIn = cur.y >= yLine;
      var nIn = nxt.y >= yLine;
      if (cIn) {
        out.push(cur);
        if (!nIn) out.push(interY(cur, nxt, yLine));
      } else if (nIn) {
        out.push(interY(cur, nxt, yLine));
        out.push(nxt);
      }
    }
    return out;
  }
  function interY(a, b, y) {
    var t = (y - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: y };
  }

  /* ---------- Water rendering for a square ---------- */
  function drawWater(localVerts, level, baseColor, angle) {
    if (level < 0.002) return;

    /* Transform to world */
    var wv = localVerts.map(function (v) {
      var r = rot(v.x, v.y, angle);
      return { x: CX + r.x, y: CY + r.y };
    });

    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < wv.length; i++) {
      if (wv[i].y < minY) minY = wv[i].y;
      if (wv[i].y > maxY) maxY = wv[i].y;
    }

    var clampedLevel = min(level, 1);
    var waterY = maxY - (maxY - minY) * clampedLevel;
    var clipped = clipBelow(wv, waterY);
    if (clipped.length < 3) return;

    /* Gradient fill */
    var grad = ctx.createLinearGradient(0, waterY, 0, maxY);
    var topColor = lerpColor(baseColor, CW, 0.3);
    grad.addColorStop(0, rgba(topColor, 0.5));
    grad.addColorStop(0.3, rgba(CW, 0.6));
    grad.addColorStop(0.7, rgba(CW, 0.7));
    grad.addColorStop(1, rgba(CD, 0.82));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(clipped[0].x, clipped[0].y);
    for (var j = 1; j < clipped.length; j++) ctx.lineTo(clipped[j].x, clipped[j].y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* Surface wave line */
    drawSurface(clipped, waterY, baseColor, angle);

    /* Caustic light patches */
    drawCaustics(clipped, waterY, maxY);

    ctx.restore();
  }

  function drawSurface(poly, waterY, baseColor, angle) {
    /* Find left/right extents at water line */
    var leftX = Infinity, rightX = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      if (abs(poly[i].y - waterY) < 3) {
        if (poly[i].x < leftX) leftX = poly[i].x;
        if (poly[i].x > rightX) rightX = poly[i].x;
      }
    }
    if (rightX - leftX < 2) return;

    var segments = 24;
    var waveBase = 1.2 + abs(rotVel) * 8;
    var waveAmp = waveBase + sin(time * 1.8) * 0.6;

    /* Wave path */
    ctx.beginPath();
    ctx.moveTo(leftX, waterY);
    for (var s = 0; s <= segments; s++) {
      var t = s / segments;
      var x = leftX + (rightX - leftX) * t;
      var y = waterY
        + sin(t * PI * 5 + time * 2.5 + angle * 2) * waveAmp
        + sin(t * PI * 8 - time * 1.8) * waveAmp * 0.35
        + sin(t * PI * 13 + time * 4) * waveAmp * 0.15;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(baseColor, 0.6);
    ctx.lineWidth = 1.8;
    ctx.stroke();

    /* Surface highlight */
    ctx.beginPath();
    ctx.moveTo(leftX, waterY - 1);
    for (var s2 = 0; s2 <= segments; s2++) {
      var t2 = s2 / segments;
      var x2 = leftX + (rightX - leftX) * t2;
      var y2 = waterY
        + sin(t2 * PI * 5 + time * 2.5 + angle * 2) * waveAmp
        + sin(t2 * PI * 8 - time * 1.8) * waveAmp * 0.35;
      ctx.lineTo(x2, y2);
    }
    ctx.lineTo(rightX, waterY + 5);
    ctx.lineTo(leftX, waterY + 5);
    ctx.closePath();
    var sg = ctx.createLinearGradient(0, waterY - 2, 0, waterY + 6);
    sg.addColorStop(0, "rgba(255,255,255,0.22)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fill();

    /* Meniscus at edges */
    ctx.beginPath();
    ctx.arc(leftX + 3, waterY, 4, 0, PI, true);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightX - 3, waterY, 4, 0, PI, true);
    ctx.fill();
  }

  function drawCaustics(poly, waterY, maxY) {
    /* Subtle animated light patches inside water */
    var depth = maxY - waterY;
    if (depth < 8) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip();

    var cx = 0, cy = 0;
    for (var j = 0; j < poly.length; j++) { cx += poly[j].x; cy += poly[j].y; }
    cx /= poly.length; cy /= poly.length;

    for (var k = 0; k < 3; k++) {
      var phase = time * 0.8 + k * 2.1;
      var px = cx + sin(phase) * depth * 0.4;
      var py = waterY + depth * (0.3 + k * 0.2) + cos(phase * 1.3) * depth * 0.1;
      var rr = depth * (0.15 + sin(phase * 0.7) * 0.05);
      var cg = ctx.createRadialGradient(px, py, 0, px, py, rr);
      cg.addColorStop(0, "rgba(255,255,255,0.06)");
      cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    }
    ctx.restore();
  }

  /* ---------- Bubbles ---------- */
  function spawnBubbles(localVerts, angle, count) {
    var wv = localVerts.map(function (v) {
      var r = rot(v.x, v.y, angle);
      return { x: CX + r.x, y: CY + r.y };
    });
    var bx = { mn: Infinity, mx: -Infinity };
    var by = { mn: Infinity, mx: -Infinity };
    for (var i = 0; i < wv.length; i++) {
      if (wv[i].x < bx.mn) bx.mn = wv[i].x;
      if (wv[i].x > bx.mx) bx.mx = wv[i].x;
      if (wv[i].y < by.mn) by.mn = wv[i].y;
      if (wv[i].y > by.mx) by.mx = wv[i].y;
    }
    for (var j = 0; j < count; j++) {
      bubbles.push({
        x: bx.mn + Math.random() * (bx.mx - bx.mn),
        y: by.mn + (by.mx - by.mn) * (0.3 + Math.random() * 0.7),
        r: 1 + Math.random() * 3.5,
        vy: -0.25 - Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 0.25,
        wobble: Math.random() * TWO_PI,
        life: 1,
        decay: 0.004 + Math.random() * 0.006
      });
    }
  }

  function updateBubbles() {
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.wobble += 0.08;
      b.x += b.vx + sin(b.wobble) * 0.3;
      b.y += b.vy;
      b.r *= 0.999;
      b.life -= b.decay;
      if (b.life <= 0 || b.r < 0.3) bubbles.splice(i, 1);
    }
  }

  function drawBubbles() {
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i];
      var alpha = b.life * 0.35;
      /* Outer ring */
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TWO_PI);
      ctx.strokeStyle = "rgba(255,255,255," + (alpha * 0.5).toFixed(3) + ")";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      /* Inner fill */
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.85, 0, TWO_PI);
      ctx.fillStyle = "rgba(255,255,255," + (alpha * 0.15).toFixed(3) + ")";
      ctx.fill();
      /* Highlight */
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.3, 0, TWO_PI);
      ctx.fillStyle = "rgba(255,255,255," + (alpha * 0.6).toFixed(3) + ")";
      ctx.fill();
    }
  }

  /* ---------- Splash particles ---------- */
  function spawnSplash(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * TWO_PI;
      var spd = 0.5 + Math.random() * 2;
      particles.push({
        x: x, y: y,
        vx: cos(ang) * spd,
        vy: sin(ang) * spd - 1,
        r: 1 + Math.random() * 2,
        color: color,
        life: 1,
        decay: 0.015 + Math.random() * 0.02,
        gravity: 0.03
      });
    }
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, TWO_PI);
      ctx.fillStyle = rgba(p.color, p.life * 0.6);
      ctx.fill();
    }
  }

  /* ---------- Drawing helpers ---------- */
  function drawPoly(verts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (var i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }

  function drawLabel(text, x, y, color, size, bold) {
    ctx.save();
    ctx.font = (bold ? "700 " : "500 ") + (size || 14) + "px 'Rubik','Heebo',sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 6;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawRightAngle(p, d1, d2, sz, angle) {
    var rp1 = rot(p.x + d1.x * sz, p.y + d1.y * sz, angle);
    var rp2 = rot(p.x + d2.x * sz, p.y + d2.y * sz, angle);
    var rc = rot(p.x + (d1.x + d2.x) * sz, p.y + (d1.y + d2.y) * sz, angle);
    ctx.beginPath();
    ctx.moveTo(CX + rp1.x, CY + rp1.y);
    ctx.lineTo(CX + rc.x, CY + rc.y);
    ctx.lineTo(CX + rp2.x, CY + rp2.y);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* ---------- Main draw ---------- */
  function draw() {
    var geo = buildGeo();
    var P0 = geo.P0, P1 = geo.P1, P2 = geo.P2;
    var angle = rotation;

    ctx.clearRect(0, 0, W, H);

    /* Circular container */
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, TWO_PI);
    var bg = ctx.createRadialGradient(CX * 0.7, CY * 0.6, R * 0.1, CX, CY, R);
    bg.addColorStop(0, "rgba(18,26,52,0.97)");
    bg.addColorStop(0.6, "rgba(12,18,37,0.98)");
    bg.addColorStop(1, "rgba(6,10,20,0.99)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();

    /* Subtle grid */
    ctx.strokeStyle = "rgba(100,160,255,0.025)";
    ctx.lineWidth = 0.5;
    var gs = unit * 1.6;
    for (var gx = -R; gx <= R; gx += gs) {
      ctx.beginPath(); ctx.moveTo(CX + gx, CY - R); ctx.lineTo(CX + gx, CY + R); ctx.stroke();
    }
    for (var gy = -R; gy <= R; gy += gs) {
      ctx.beginPath(); ctx.moveTo(CX - R, CY + gy); ctx.lineTo(CX + R, CY + gy); ctx.stroke();
    }

    /* Build squares */
    var sqA = squareVerts(P0, P2, true);   /* side a */
    var sqB = squareVerts(P1, P0, true);   /* side b */
    var sqC = squareVerts(P2, P1, true);   /* hypotenuse c */

    /* Draw squares */
    function drawSq(verts, baseC, glow) {
      var wv = verts.map(function (v) {
        var r = rot(v.x, v.y, angle);
        return { x: CX + r.x, y: CY + r.y };
      });

      /* Fill with subtle gradient */
      var cx2 = 0, cy2 = 0;
      for (var i = 0; i < wv.length; i++) { cx2 += wv[i].x; cy2 += wv[i].y; }
      cx2 /= 4; cy2 /= 4;
      var side = sqrt((wv[1].x - wv[0].x) * (wv[1].x - wv[0].x) + (wv[1].y - wv[0].y) * (wv[1].y - wv[0].y));
      var grd = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, side * 0.7);
      grd.addColorStop(0, rgba(baseC, 0.12));
      grd.addColorStop(1, rgba(baseC, 0.04));

      drawPoly(wv, grd, rgba(baseC, 0.55), 1.8);

      /* Corner glow */
      if (glow) {
        var cg = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, side * 0.5);
        cg.addColorStop(0, rgba(baseC, 0.08));
        cg.addColorStop(1, rgba(baseC, 0));
        ctx.fillStyle = cg;
        ctx.fillRect(cx2 - side, cy2 - side, side * 2, side * 2);
      }
      return wv;
    }

    var isAActive = fillMode === "ab" && liqLevel > 0.01;
    var isBActive = fillMode === "ab" && liqLevel > 0.01;
    var isCActive = fillMode === "c" && liqLevel > 0.01;

    drawSq(sqA, CA, isAActive);
    drawSq(sqB, CB, isBActive);
    drawSq(sqC, CC, isCActive);

    /* Draw water */
    if (fillMode === "c") {
      drawWater(sqC, liqLevel, CC, angle);
      if (liqLevel > 0.02 && Math.random() < 0.12) spawnBubbles(sqC, angle, 1);
    } else if (fillMode === "ab") {
      drawWater(sqA, liqLevel, CA, angle);
      drawWater(sqB, liqLevel, CB, angle);
      if (liqLevel > 0.02 && Math.random() < 0.1) {
        spawnBubbles(sqA, angle, 1);
        spawnBubbles(sqB, angle, 1);
      }
    }

    updateBubbles();
    drawBubbles();
    updateParticles();
    drawParticles();

    /* Triangle */
    var triW = [P0, P1, P2].map(function (v) {
      var r = rot(v.x, v.y, angle);
      return { x: CX + r.x, y: CY + r.y };
    });

    /* Triangle fill - very subtle */
    drawPoly(triW, "rgba(255,255,255,0.02)", null);

    /* Triangle stroke with glow */
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.15)";
    ctx.shadowBlur = 8;
    drawPoly(triW, null, "rgba(255,255,255,0.55)", 2.2);
    ctx.restore();

    /* Right angle marker */
    drawRightAngle(P0, { x: 0, y: -1 }, { x: 1, y: 0 }, unit * 0.55, angle);

    /* Side labels along edges */
    function edgeLabel(pA, pB, label, col, offset) {
      var mx = (pA.x + pB.x) / 2;
      var my = (pA.y + pB.y) / 2;
      var dx = pB.x - pA.x, dy = pB.y - pA.y;
      var len = sqrt(dx * dx + dy * dy);
      var nx = -dy / len * offset;
      var ny = dx / len * offset;
      var r = rot(mx + nx, my + ny, angle);
      drawLabel(label, CX + r.x, CY + r.y, rgb(col), max(12, floor(unit * 0.68)), true);
    }
    edgeLabel(P0, P2, "a", CA, -unit * 0.75);
    edgeLabel(P1, P0, "b", CB, unit * 0.75);
    edgeLabel(P2, P1, "c", CC, unit * 0.75);

    /* Square center labels */
    function sqCenter(verts) {
      var sx = 0, sy = 0;
      for (var i = 0; i < verts.length; i++) { sx += verts[i].x; sy += verts[i].y; }
      return { x: sx / 4, y: sy / 4 };
    }

    var ctrA = sqCenter(sqA), ctrB = sqCenter(sqB), ctrC = sqCenter(sqC);
    var rA = rot(ctrA.x, ctrA.y, angle);
    var rB = rot(ctrB.x, ctrB.y, angle);
    var rC = rot(ctrC.x, ctrC.y, angle);

    var lsz = max(12, floor(unit * 0.62));
    var vsz = max(9, floor(unit * 0.4));

    /* Hebrew square labels */
    drawLabel("a²", CX + rA.x, CY + rA.y - vsz * 0.5, rgb(CA), lsz, true);
    drawLabel("שטח = " + (SIDE_A * SIDE_A), CX + rA.x, CY + rA.y + lsz * 0.6, rgba(CA, 0.6), vsz, false);

    drawLabel("b²", CX + rB.x, CY + rB.y - vsz * 0.5, rgb(CB), lsz, true);
    drawLabel("שטח = " + (SIDE_B * SIDE_B), CX + rB.x, CY + rB.y + lsz * 0.6, rgba(CB, 0.6), vsz, false);

    drawLabel("c²", CX + rC.x, CY + rC.y - vsz * 0.5, rgb(CC), lsz, true);
    drawLabel("שטח = " + (SIDE_C * SIDE_C), CX + rC.x, CY + rC.y + lsz * 0.6, rgba(CC, 0.6), vsz, false);

    ctx.restore();

    /* Container ring */
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, TWO_PI);
    ctx.strokeStyle = "rgba(100,160,255,0.15)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* Outer glow ring */
    var rimG = ctx.createRadialGradient(CX, CY, R - 4, CX, CY, R + 4);
    rimG.addColorStop(0, "rgba(100,160,255,0)");
    rimG.addColorStop(0.5, "rgba(100,160,255,0.05)");
    rimG.addColorStop(1, "rgba(100,160,255,0)");
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, TWO_PI);
    ctx.strokeStyle = rimG;
    ctx.lineWidth = 10;
    ctx.stroke();

    /* Dynamic glow */
    if (fillMode !== "none" && liqLevel > 0.1) {
      var gc = fillMode === "c" ? CC : CB;
      canvas.style.boxShadow =
        "0 0 40px " + rgba(gc, 0.1) + "," +
        "0 0 80px " + rgba(gc, 0.05);
    } else {
      canvas.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.03),0 0 40px rgba(59,130,246,0.03)";
    }
  }

  /* ---------- Physics update ---------- */
  function update(dt) {
    time += dt;
    frameCount++;

    /* Rotation physics */
    if (!dragging) {
      if (targetRot !== null) {
        var diff = targetRot - rotation;
        var spring = 0.1;
        var damp = 0.82;
        rotVel += diff * spring;
        rotVel *= damp;
        rotation += rotVel;
        if (abs(diff) < 0.0005 && abs(rotVel) < 0.0005) {
          rotation = targetRot;
          rotVel = 0;
          targetRot = null;
        }
      } else {
        rotVel *= 0.965;
        rotation += rotVel;
        if (abs(rotVel) < 0.00005) rotVel = 0;
      }
    }

    /* Device orientation */
    if (sensorOn && orientationInit) {
      var tilt = devGamma * DEG * 0.015;
      rotVel += tilt * 0.008;
    }

    /* Liquid spring animation */
    if (fillMode !== "none") {
      var springK = 0.06;
      var springD = 0.88;
      liqVel += (liqTarget - liqLevel) * springK;
      liqVel *= springD;
      liqLevel += liqVel;
      /* Add rotation-based slosh */
      if (abs(rotVel) > 0.001) {
        liqVel += rotVel * 0.02;
      }
      liqLevel = max(0, min(1.0, liqLevel));
    } else {
      liqVel += (0 - liqLevel) * 0.04;
      liqVel *= 0.85;
      liqLevel += liqVel;
      if (liqLevel < 0.001 && abs(liqVel) < 0.001) {
        liqLevel = 0;
        liqVel = 0;
      }
    }

    /* Equation visual */
    if (fillMode !== "none" && liqLevel > 0.3) {
      eqVisual.classList.add("show");
    } else {
      eqVisual.classList.remove("show");
    }
  }

  /* ---------- Pointer handling ---------- */
  function getAngle(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.clientX !== undefined ? e.clientX : e.touches[0].clientX);
    var cy = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY);
    var x = cx - rect.left - rect.width / 2;
    var y = cy - rect.top - rect.height / 2;
    return atan2(y, x);
  }

  function ptrDown(e) {
    e.preventDefault();
    dismissHint();
    dragging = true;
    targetRot = null;
    dragStartA = getAngle(e);
    dragStartR = rotation;
    lastPtrA = dragStartA;
    lastPtrT = performance.now();
    rotVel = 0;
  }

  function ptrMove(e) {
    if (!dragging) return;
    e.preventDefault();
    var a = getAngle(e);
    var delta = a - dragStartA;
    if (delta > PI) delta -= TWO_PI;
    if (delta < -PI) delta += TWO_PI;
    rotation = dragStartR + delta;

    var now = performance.now();
    var dt = (now - lastPtrT) / 1000;
    if (dt > 0.008) {
      var dA = a - lastPtrA;
      if (dA > PI) dA -= TWO_PI;
      if (dA < -PI) dA += TWO_PI;
      rotVel = dA / dt * 0.035;
      lastPtrA = a;
      lastPtrT = now;
    }
  }

  function ptrUp() {
    dragging = false;
  }

  canvas.addEventListener("mousedown", ptrDown);
  window.addEventListener("mousemove", ptrMove);
  window.addEventListener("mouseup", ptrUp);
  canvas.addEventListener("touchstart", ptrDown, { passive: false });
  window.addEventListener("touchmove", ptrMove, { passive: false });
  window.addEventListener("touchend", ptrUp);

  /* ---------- Buttons ---------- */
  btnC.addEventListener("click", function () {
    dismissHint();
    if (fillMode === "c") {
      fillMode = "none";
      liqTarget = 0;
      btnC.classList.remove("active");
    } else {
      fillMode = "c";
      liqTarget = 1;
      liqVel = 0.02;
      btnC.classList.add("active");
      btnAB.classList.remove("active");
      /* Splash effect */
      var geo = buildGeo();
      var sqC = squareVerts(geo.P2, geo.P1, true);
      var ctr = { x: 0, y: 0 };
      for (var i = 0; i < sqC.length; i++) { ctr.x += sqC[i].x; ctr.y += sqC[i].y; }
      ctr.x /= 4; ctr.y /= 4;
      var rr = rot(ctr.x, ctr.y, rotation);
      spawnSplash(CX + rr.x, CY + rr.y, CC, 8);
    }
  });

  btnAB.addEventListener("click", function () {
    dismissHint();
    if (fillMode === "ab") {
      fillMode = "none";
      liqTarget = 0;
      btnAB.classList.remove("active");
    } else {
      fillMode = "ab";
      liqTarget = 1;
      liqVel = 0.02;
      btnAB.classList.add("active");
      btnC.classList.remove("active");
      var geo = buildGeo();
      var sqA = squareVerts(geo.P0, geo.P2, true);
      var sqB = squareVerts(geo.P1, geo.P0, true);
      var c1 = { x: 0, y: 0 }, c2 = { x: 0, y: 0 };
      for (var i = 0; i < 4; i++) {
        c1.x += sqA[i].x; c1.y += sqA[i].y;
        c2.x += sqB[i].x; c2.y += sqB[i].y;
      }
      c1.x /= 4; c1.y /= 4; c2.x /= 4; c2.y /= 4;
      var r1 = rot(c1.x, c1.y, rotation);
      var r2 = rot(c2.x, c2.y, rotation);
      spawnSplash(CX + r1.x, CY + r1.y, CA, 5);
      spawnSplash(CX + r2.x, CY + r2.y, CB, 5);
    }
  });

  btnReset.addEventListener("click", function () {
    fillMode = "none";
    liqTarget = 0;
    liqVel = 0;
    targetRot = 0;
    btnC.classList.remove("active");
    btnAB.classList.remove("active");
    bubbles = [];
    particles = [];
  });

  btnSensor.addEventListener("click", function () {
    sensorOn = !sensorOn;
    btnSensor.classList.toggle("active", sensorOn);
    sensorPanel.classList.toggle("visible", sensorOn);
    if (sensorOn && !orientationInit && window.DeviceOrientationEvent) {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then(function (state) {
          if (state === "granted") initOrientation();
        }).catch(function () {});
      } else {
        initOrientation();
      }
    }
  });

  function initOrientation() {
    orientationInit = true;
    window.addEventListener("deviceorientation", function (e) {
      devAlpha = e.alpha || 0;
      devBeta = e.beta || 0;
      devGamma = e.gamma || 0;
      sAlpha.textContent = devAlpha.toFixed(1) + "°";
      sBeta.textContent = devBeta.toFixed(1) + "°";
      sGamma.textContent = devGamma.toFixed(1) + "°";
    });
  }

  /* ---------- Hint ---------- */
  function dismissHint() {
    if (hintGone) return;
    hintGone = true;
    hintOverlay.classList.add("hidden");
    setTimeout(function () { hintOverlay.style.display = "none"; }, 500);
  }
  hintOverlay.addEventListener("click", dismissHint);
  hintOverlay.addEventListener("touchstart", dismissHint);

  /* Auto-dismiss hint after 6s */
  setTimeout(function () {
    if (!hintGone) dismissHint();
  }, 6000);

  /* ---------- Keyboard (desktop testing) ---------- */
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { targetRot = (targetRot !== null ? targetRot : rotation) - 0.35; dismissHint(); }
    if (e.key === "ArrowRight") { targetRot = (targetRot !== null ? targetRot : rotation) + 0.35; dismissHint(); }
    if (e.key === "1") btnC.click();
    if (e.key === "2") btnAB.click();
    if (e.key === "0" || e.key === "r") btnReset.click();
  });

  /* ---------- Animation loop ---------- */
  var lastT = 0;
  function loop(ts) {
    var dt = min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------- Init ---------- */
  resize();
  window.addEventListener("resize", resize);

  /* Orientation change handling */
  if (screen.orientation) {
    screen.orientation.addEventListener("change", function () {
      setTimeout(resize, 100);
    });
  }
  window.addEventListener("orientationchange", function () {
    setTimeout(resize, 150);
  });

  requestAnimationFrame(function (ts) {
    lastT = ts;
    loop(ts);
  });
})();