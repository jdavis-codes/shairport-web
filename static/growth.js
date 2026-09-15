(function () {
  const stage = document.getElementById("stage");
  const player = document.getElementById("target");

  if (!stage || !player) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.id = "growth-canvas";
  stage.insertBefore(canvas, stage.firstChild);

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return;
  }

  let nodes = [];
  let tick = 0;
  let rafId = null;
  let warpReady = false;

  // All tuning knobs live here so there are no hidden "magic numbers".
  const SETTINGS = {
    insertDistancePx: 16,
    separationRatio: 2.2,
    maxPoints: 2000,
    obstaclePaddingPx: 10,
    obstacleClearancePx: 10,
    spawnInsetPx: 180,
    edgeSoftMarginPx: 7,
    edgeHardMarginPx: 4,
    neighborSpring: 0.4,
    outwardForce: 0.065,
    wobbleForce: 0.34,
    wobbleSpeedX: 0.006,
    wobbleSpeedY: 0.005,
    wobblePhaseX: 0.71,
    wobblePhaseY: 0.57,
    velocityGain: 0.35,
    velocityDamping: 0.915,
  };

  const insertDistance = SETTINGS.insertDistancePx;
  const separationDistance = insertDistance * SETTINGS.separationRatio;
  const maxPoints = SETTINGS.maxPoints;
  const obstaclePadding = SETTINGS.obstaclePaddingPx;
  const obstacleClearance = SETTINGS.obstacleClearancePx;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function centroid(poly) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < poly.length; i += 1) {
      sx += poly[i].x;
      sy += poly[i].y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  function getFallbackQuad() {
    const r = player.getBoundingClientRect();
    return [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: r.left, y: r.bottom },
    ];
  }

  function getWarpedQuad() {
    const handles = Array.from(stage.querySelectorAll(".handle")).sort(
      (a, b) => Number(a.dataset.i) - Number(b.dataset.i)
    );

    if (handles.length !== 4) {
      return getFallbackQuad();
    }

    const pts = handles.map((h) => {
      const x = parseFloat(h.style.left);
      const y = parseFloat(h.style.top);
      return { x, y };
    });

    const valid = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return valid ? pts : getFallbackQuad();
  }

  function expandQuad(quad, padding) {
    const c = centroid(quad);
    return quad.map((p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      const scale = (len + padding) / len;
      return { x: c.x + dx * scale, y: c.y + dy * scale };
    });
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;

      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi;
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
    return { x: a.x + abx * t, y: a.y + aby * t };
  }

  function nearestPointOnPolygon(p, poly) {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const c = closestPointOnSegment(p, a, b);
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    return best;
  }

  function getObstacleShape() {
    const raw = getWarpedQuad();
    const center = centroid(raw);
    const poly = expandQuad(raw, obstaclePadding);

    let radiusX = 0;
    let radiusY = 0;
    for (let i = 0; i < raw.length; i += 1) {
      radiusX = Math.max(radiusX, Math.abs(raw[i].x - center.x));
      radiusY = Math.max(radiusY, Math.abs(raw[i].y - center.y));
    }

    return {
      poly,
      center,
      radiusX,
      radiusY,
    };
  }

  function pushAwayFromEdges(node) {
    const soft = SETTINGS.edgeSoftMarginPx;

    if (node.x < soft) {
      const d = soft - node.x;
      node.x += d * 0.22;
      node.vx = Math.max(node.vx, 0);
    }
    if (node.x > canvas.width - soft) {
      const d = node.x - (canvas.width - soft);
      node.x -= d * 0.22;
      node.vx = Math.min(node.vx, 0);
    }
    if (node.y < soft) {
      const d = soft - node.y;
      node.y += d * 0.22;
      node.vy = Math.max(node.vy, 0);
    }
    if (node.y > canvas.height - soft) {
      const d = node.y - (canvas.height - soft);
      node.y -= d * 0.22;
      node.vy = Math.min(node.vy, 0);
    }
  }

  function pushOutsideObstacle(node, obstacle) {
    const nearest = nearestPointOnPolygon(node, obstacle.poly);
    const inside = pointInPolygon(node, obstacle.poly);

    if (!nearest) {
      return;
    }

    const dx = node.x - nearest.x;
    const dy = node.y - nearest.y;
    const d = Math.hypot(dx, dy);

    if (inside) {
      const ox = nearest.x - obstacle.center.x;
      const oy = nearest.y - obstacle.center.y;
      const olen = Math.hypot(ox, oy) || 1;
      node.x = nearest.x + (ox / olen) * obstacleClearance;
      node.y = nearest.y + (oy / olen) * obstacleClearance;
      node.vx *= 0.25;
      node.vy *= 0.25;
      return;
    }

    if (d > 0 && d < obstacleClearance) {
      const strength = (obstacleClearance - d) / obstacleClearance;
      node.x += (dx / d) * strength * 5.0;
      node.y += (dy / d) * strength * 5.0;
    }
  }

  function buildSpawnLoop(obstacle) {
    const w = canvas.width;
    const h = canvas.height;
    const cx = obstacle.center.x;
    const cy = obstacle.center.y;

    const inset = SETTINGS.spawnInsetPx;
    const maxRx = Math.max(120, Math.min(cx - inset, w - cx - inset));
    const maxRy = Math.max(90, Math.min(cy - inset, h - cy - inset));

    const minRx = obstacle.radiusX + obstacleClearance + 36;
    const minRy = obstacle.radiusY + obstacleClearance + 36;

    const rx = clamp(maxRx * 0.74, minRx, Math.max(minRx, maxRx));
    const ry = clamp(maxRy * 0.74, minRy, Math.max(minRy, maxRy));

    const perimeter = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) * 0.5);
    const points = Math.max(24, Math.floor(perimeter / 52));
    const out = [];

    for (let i = 0; i < points; i += 1) {
      const a = (i / points) * Math.PI * 2;
      out.push({
        x: cx + Math.cos(a) * rx + Math.sin(i * 0.63) * 2.0,
        y: cy + Math.sin(a) * ry + Math.cos(i * 0.47) * 2.0,
        vx: 0,
        vy: 0,
      });
    }

    return out;
  }

  function ensureCanvasSize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (nodes.length === 0) {
        nodes = buildSpawnLoop(getObstacleShape());
      }
    }
  }

  function buildSpatialHash(cellSize) {
    const buckets = new Map();
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      const cx = Math.floor(n.x / cellSize);
      const cy = Math.floor(n.y / cellSize);
      const key = `${cx},${cy}`;
      const list = buckets.get(key);
      if (list) {
        list.push(i);
      } else {
        buckets.set(key, [i]);
      }
    }
    return buckets;
  }

  function updateNodes() {
    const obstacle = getObstacleShape();
    const cellSize = separationDistance;
    const sep2 = separationDistance * separationDistance;
    const buckets = buildSpatialHash(cellSize);
    const next = new Array(nodes.length);

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const cx = Math.floor(node.x / cellSize);
      const cy = Math.floor(node.y / cellSize);

      let fx = 0;
      let fy = 0;

      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const key = `${cx + ox},${cy + oy}`;
          const candidates = buckets.get(key);
          if (!candidates) {
            continue;
          }
          for (let k = 0; k < candidates.length; k += 1) {
            const j = candidates[k];
            if (j === i) {
              continue;
            }
            const other = nodes[j];
            const dx = node.x - other.x;
            const dy = node.y - other.y;
            const d2 = dx * dx + dy * dy;
            if (d2 === 0 || d2 >= sep2) {
              continue;
            }
            const d = Math.sqrt(d2);
            const strength = (separationDistance - d) / separationDistance;
            fx += (dx / d) * strength;
            fy += (dy / d) * strength;
          }
        }
      }

      // Mild line tension keeps the shape smooth while still allowing wobble.
      const prev = nodes[(i - 1 + nodes.length) % nodes.length];
      const nextNode = nodes[(i + 1) % nodes.length];
      const midX = (prev.x + nextNode.x) * 0.5;
      const midY = (prev.y + nextNode.y) * 0.5;
      fx += (midX - node.x) * SETTINGS.neighborSpring;
      fy += (midY - node.y) * SETTINGS.neighborSpring;

      // Push outward from the warped player center to stay around the outside.
      const pcx = node.x - obstacle.center.x;
      const pcy = node.y - obstacle.center.y;
      const plen = Math.hypot(pcx, pcy) || 1;
      fx += (pcx / plen) * SETTINGS.outwardForce;
      fy += (pcy / plen) * SETTINGS.outwardForce;

      // Slower, larger wobble for a cleaner oscilloscope feel.
      fx += Math.sin(tick * SETTINGS.wobbleSpeedX + i * SETTINGS.wobblePhaseX) * SETTINGS.wobbleForce;
      fy += Math.cos(tick * SETTINGS.wobbleSpeedY + i * SETTINGS.wobblePhaseY) * SETTINGS.wobbleForce;

      const vx = (node.vx + fx * SETTINGS.velocityGain) * SETTINGS.velocityDamping;
      const vy = (node.vy + fy * SETTINGS.velocityGain) * SETTINGS.velocityDamping;

      const updated = {
        x: clamp(node.x + vx, SETTINGS.edgeHardMarginPx, canvas.width - SETTINGS.edgeHardMarginPx),
        y: clamp(node.y + vy, SETTINGS.edgeHardMarginPx, canvas.height - SETTINGS.edgeHardMarginPx),
        vx,
        vy,
      };

      pushAwayFromEdges(updated);
      pushOutsideObstacle(updated, obstacle);
      next[i] = updated;
    }

    nodes = next;
  }

  function insertNodes() {
    if (nodes.length >= maxPoints) {
      return;
    }

    const obstacle = getObstacleShape();
    let i = 0;

    while (i < nodes.length && nodes.length < maxPoints) {
      const n1 = nodes[i];
      const n2 = nodes[(i + 1) % nodes.length];

      if (distance(n1, n2) > insertDistance) {
        const mid = {
          x: (n1.x + n2.x) * 0.5,
          y: (n1.y + n2.y) * 0.5,
          vx: (n1.vx + n2.vx) * 0.5,
          vy: (n1.vy + n2.vy) * 0.5,
        };
        pushOutsideObstacle(mid, obstacle);
        nodes.splice(i + 1, 0, mid);
        i += 2;
      } else {
        i += 1;
      }
    }
  }

  function drawLoop() {
    if (nodes.length < 2) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i += 1) {
      ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    ctx.closePath();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function frame() {
    tick += 1;
    ensureCanvasSize();
    updateNodes();
    insertNodes();
    drawLoop();
    rafId = window.requestAnimationFrame(frame);
  }

  function start() {
    ensureCanvasSize();
    if (nodes.length === 0) {
      nodes = buildSpawnLoop(getObstacleShape());
    }
    if (!rafId) {
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function stop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function handlesHaveCoordinates() {
    const handles = Array.from(stage.querySelectorAll(".handle"));
    if (handles.length !== 4) {
      return false;
    }
    return handles.every((h) => {
      const x = parseFloat(h.style.left);
      const y = parseFloat(h.style.top);
      return Number.isFinite(x) && Number.isFinite(y);
    });
  }

  function startWhenWarpReady() {
    if (warpReady) {
      start();
      return;
    }
    if (handlesHaveCoordinates()) {
      warpReady = true;
      start();
      return;
    }
    window.requestAnimationFrame(startWhenWarpReady);
  }

  window.addEventListener("resize", ensureCanvasSize);
  window.addEventListener("warp:ready", () => {
    warpReady = true;
    start();
  }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      startWhenWarpReady();
    }
  });

  startWhenWarpReady();
})();
