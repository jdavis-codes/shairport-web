(function () {
  const stage = document.getElementById("stage");
  const player = document.getElementById("target");

  if (!stage || !player || !window.p5) {
    return;
  }

  const CFG = {
    insertDistance: 14,
    separationDistance: 30,
    maxPoints: 4800,
    edgeSoftMargin: 14,
    edgeHardMargin: 4,
    obstaclePadding: 10,
    obstacleClearance: 18,
    obstacleInfluenceScale: 2.0,
    obstaclePush: 2.1,
    obstacleInsideCorrection: 0.55,
    obstacleNormalDamping: 0.65,
    obstacleInsideDamping: 0.35,
    obstacleEpsilon: 0.001,
    spawnInset: 170,
    basePoints: 28,
    jitter: 2.0,
    spring: 0.52,
    damping: 0.9,
    wobbleAmp: 0.2,
    wobbleRateX: 0.005,
    wobbleRateY: 0.004,
  };

  let nodes = [];
  let warpReady = false;
  let started = false;

  class Point {
    constructor(x, y, userData) {
      this.x = x;
      this.y = y;
      this.userData = userData;
    }
  }

  class Rect {
    constructor(x, y, w, h) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
    }
    contains(p) {
      return p.x >= this.x - this.w && p.x <= this.x + this.w && p.y >= this.y - this.h && p.y <= this.y + this.h;
    }
    intersects(range) {
      if (range instanceof Circle) {
        const xDist = Math.abs(range.x - this.x);
        const yDist = Math.abs(range.y - this.y);
        const rw = this.w;
        const rh = this.h;
        const r = range.r;
        if (xDist > rw + r || yDist > rh + r) return false;
        if (xDist <= rw || yDist <= rh) return true;
        const dx = xDist - rw;
        const dy = yDist - rh;
        return dx * dx + dy * dy <= r * r;
      }
      return !(
        range.x - range.w > this.x + this.w ||
        range.x + range.w < this.x - this.w ||
        range.y - range.h > this.y + this.h ||
        range.y + range.h < this.y - this.h
      );
    }
  }

  class Circle {
    constructor(x, y, r) {
      this.x = x;
      this.y = y;
      this.r = r;
      this.r2 = r * r;
    }
    contains(p) {
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      return dx * dx + dy * dy <= this.r2;
    }
  }

  class QuadTree {
    constructor(boundary, capacity) {
      this.boundary = boundary;
      this.capacity = capacity;
      this.points = [];
      this.divided = false;
      this.northwest = null;
      this.northeast = null;
      this.southwest = null;
      this.southeast = null;
    }
    clear() {
      this.points.length = 0;
      this.divided = false;
      this.northwest = null;
      this.northeast = null;
      this.southwest = null;
      this.southeast = null;
    }
    subdivide() {
      const x = this.boundary.x;
      const y = this.boundary.y;
      const w = this.boundary.w / 2;
      const h = this.boundary.h / 2;
      this.northeast = new QuadTree(new Rect(x + w, y - h, w, h), this.capacity);
      this.northwest = new QuadTree(new Rect(x - w, y - h, w, h), this.capacity);
      this.southeast = new QuadTree(new Rect(x + w, y + h, w, h), this.capacity);
      this.southwest = new QuadTree(new Rect(x - w, y + h, w, h), this.capacity);
      this.divided = true;
    }
    insert(point) {
      if (!this.boundary.contains(point)) {
        return false;
      }
      if (this.points.length < this.capacity) {
        this.points.push(point);
        return true;
      }
      if (!this.divided) {
        this.subdivide();
      }
      return (
        this.northwest.insert(point) ||
        this.northeast.insert(point) ||
        this.southwest.insert(point) ||
        this.southeast.insert(point)
      );
    }
    query(range, found) {
      if (!this.boundary.intersects(range)) {
        return found;
      }
      for (let i = 0; i < this.points.length; i += 1) {
        if (range.contains(this.points[i])) {
          found.push(this.points[i]);
        }
      }
      if (this.divided) {
        this.northwest.query(range, found);
        this.northeast.query(range, found);
        this.southwest.query(range, found);
        this.southeast.query(range, found);
      }
      return found;
    }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function handlesHaveCoordinates() {
    const handles = Array.from(stage.querySelectorAll(".handle"));
    if (handles.length !== 4) {
      return false;
    }
    return handles.every((h) => Number.isFinite(parseFloat(h.style.left)) && Number.isFinite(parseFloat(h.style.top)));
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
    const handles = Array.from(stage.querySelectorAll(".handle")).sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i));
    if (handles.length !== 4) {
      return getFallbackQuad();
    }
    const pts = handles.map((h) => ({ x: parseFloat(h.style.left), y: parseFloat(h.style.top) }));
    return pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : getFallbackQuad();
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

  function expandQuad(quad, pad) {
    const c = centroid(quad);
    return quad.map((p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: c.x + (dx / len) * (len + pad), y: c.y + (dy / len) * (len + pad) };
    });
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const hit = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  function nearestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1), 0, 1);
    return { x: a.x + abx * t, y: a.y + aby * t };
  }

  function nearestPointOnPolygon(p, poly) {
    let best = null;
    let bestD2 = Infinity;
    let bestA = null;
    let bestB = null;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const q = nearestPointOnSegment(p, a, b);
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = q;
        bestA = a;
        bestB = b;
      }
    }
    if (!best) {
      return null;
    }
    return { point: best, edgeA: bestA, edgeB: bestB };
  }

  function polygonArea(poly) {
    let area = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
  }

  function getObstacle() {
    const raw = getWarpedQuad();
    const center = centroid(raw);
    let radiusX = 0;
    let radiusY = 0;
    for (let i = 0; i < raw.length; i += 1) {
      radiusX = Math.max(radiusX, Math.abs(raw[i].x - center.x));
      radiusY = Math.max(radiusY, Math.abs(raw[i].y - center.y));
    }
    return {
      center,
      radiusX,
      radiusY,
      poly: expandQuad(raw, CFG.obstaclePadding),
      winding: polygonArea(raw) >= 0 ? 1 : -1,
    };
  }

  function spawnLoop(obstacle, p) {
    const w = p.width;
    const h = p.height;
    const cx = obstacle.center.x;
    const cy = obstacle.center.y;
    const maxRx = Math.max(120, Math.min(cx - CFG.spawnInset, w - cx - CFG.spawnInset));
    const maxRy = Math.max(90, Math.min(cy - CFG.spawnInset, h - cy - CFG.spawnInset));
    const minRx = obstacle.radiusX + CFG.obstacleClearance + 24;
    const minRy = obstacle.radiusY + CFG.obstacleClearance + 24;
    const rx = clamp(maxRx * 0.78, minRx, Math.max(minRx, maxRx));
    const ry = clamp(maxRy * 0.78, minRy, Math.max(minRy, maxRy));
    const count = Math.max(CFG.basePoints, Math.floor((2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2)) / 54));

    nodes = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      nodes.push({
        pos: p.createVector(cx + Math.cos(a) * rx + Math.sin(i * 0.7) * CFG.jitter, cy + Math.sin(a) * ry + Math.cos(i * 0.5) * CFG.jitter),
        vel: p.createVector(0, 0),
      });
    }
  }

  function avoidEdges(node, p) {
    const s = CFG.edgeSoftMargin;
    if (node.pos.x < s) {
      node.pos.x += (s - node.pos.x) * 0.25;
      node.vel.x = Math.max(0, node.vel.x);
    }
    if (node.pos.x > p.width - s) {
      node.pos.x -= (node.pos.x - (p.width - s)) * 0.25;
      node.vel.x = Math.min(0, node.vel.x);
    }
    if (node.pos.y < s) {
      node.pos.y += (s - node.pos.y) * 0.25;
      node.vel.y = Math.max(0, node.vel.y);
    }
    if (node.pos.y > p.height - s) {
      node.pos.y -= (node.pos.y - (p.height - s)) * 0.25;
      node.vel.y = Math.min(0, node.vel.y);
    }
  }

  function avoidObstacle(node, obstacle) {
    const here = { x: node.pos.x, y: node.pos.y };
    const nearest = nearestPointOnPolygon(here, obstacle.poly);
    if (!nearest) {
      return;
    }

    const dx = here.x - nearest.point.x;
    const dy = here.y - nearest.point.y;
    const d = Math.hypot(dx, dy);
    const influence = CFG.obstacleClearance * CFG.obstacleInfluenceScale;
    const inside = pointInPolygon(here, obstacle.poly);

    // Edge normal with winding-aware orientation. For screen-space coordinates,
    // this gives a stable outward direction around the obstacle polygon.
    const ex = nearest.edgeB.x - nearest.edgeA.x;
    const ey = nearest.edgeB.y - nearest.edgeA.y;
    let nx;
    let ny;
    if (obstacle.winding >= 0) {
      nx = ey;
      ny = -ex;
    } else {
      nx = -ey;
      ny = ex;
    }
    const nLen = Math.hypot(nx, ny);
    if (nLen > CFG.obstacleEpsilon) {
      nx /= nLen;
      ny /= nLen;
    } else {
      const ox = nearest.point.x - obstacle.center.x;
      const oy = nearest.point.y - obstacle.center.y;
      const oLen = Math.hypot(ox, oy) || 1;
      nx = ox / oLen;
      ny = oy / oLen;
    }

    // Ensure normal points away from center for consistency.
    const cx = nearest.point.x - obstacle.center.x;
    const cy = nearest.point.y - obstacle.center.y;
    if (nx * cx + ny * cy < 0) {
      nx *= -1;
      ny *= -1;
    }

    if (inside) {
      const tx = nearest.point.x + nx * CFG.obstacleClearance;
      const ty = nearest.point.y + ny * CFG.obstacleClearance;
      node.pos.x += (tx - node.pos.x) * CFG.obstacleInsideCorrection;
      node.pos.y += (ty - node.pos.y) * CFG.obstacleInsideCorrection;
      node.vel.mult(CFG.obstacleInsideDamping);
      return;
    }

    if (d < influence) {
      const t = 1 - d / influence;
      const falloff = t * t;
      const dirX = d > CFG.obstacleEpsilon ? dx / d : nx;
      const dirY = d > CFG.obstacleEpsilon ? dy / d : ny;

      // Dampen inward normal velocity to remove high-frequency chatter.
      const vn = node.vel.x * dirX + node.vel.y * dirY;
      if (vn < 0) {
        node.vel.x -= dirX * vn * CFG.obstacleNormalDamping;
        node.vel.y -= dirY * vn * CFG.obstacleNormalDamping;
      }

      const push = falloff * CFG.obstaclePush;
      node.pos.x += dirX * push;
      node.pos.y += dirY * push;
    }
  }

  function insertNodes(p, obstacle) {
    if (nodes.length >= CFG.maxPoints) {
      return;
    }
    for (let i = 0; i < nodes.length && nodes.length < CFG.maxPoints; i += 1) {
      const a = nodes[i].pos;
      const b = nodes[(i + 1) % nodes.length].pos;
      if (p5.Vector.dist(a, b) > CFG.insertDistance) {
        const mid = p5.Vector.add(a, b).mult(0.5);
        const newNode = { pos: mid.copy(), vel: p.createVector(0, 0) };
        avoidObstacle(newNode, obstacle);
        nodes.splice(i + 1, 0, newNode);
        i += 1;
      }
    }
  }

  const sketch = (p) => {
    let qt = null;

    p.setup = () => {
      const c = p.createCanvas(window.innerWidth, window.innerHeight);
      c.parent(stage);
      c.id("growth-canvas");
      c.style("position", "absolute");
      c.style("inset", "0");
      c.style("width", "100%");
      c.style("height", "100%");
      c.style("pointer-events", "none");
      c.style("z-index", "0");
      qt = new QuadTree(new Rect(p.width / 2, p.height / 2, p.width / 2, p.height / 2), 10);
      p.frameRate(60);
      p.noFill();
      p.stroke(255, 235);
      p.strokeWeight(1.6);
    };

    p.windowResized = () => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      if (started) {
        spawnLoop(getObstacle(), p);
      }
    };

    p.draw = () => {
      p.clear();

      if (!warpReady && handlesHaveCoordinates()) {
        warpReady = true;
      }
      if (!warpReady) {
        return;
      }

      if (!started || nodes.length < 3) {
        spawnLoop(getObstacle(), p);
        started = true;
      }

      const obstacle = getObstacle();
      qt = new QuadTree(new Rect(p.width / 2, p.height / 2, p.width / 2, p.height / 2), 10);

      for (let i = 0; i < nodes.length; i += 1) {
        qt.insert(new Point(nodes[i].pos.x, nodes[i].pos.y, i));
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const prev = nodes[(i - 1 + nodes.length) % nodes.length];
        const next = nodes[(i + 1) % nodes.length];

        const neighbors = [];
        qt.query(new Circle(node.pos.x, node.pos.y, CFG.separationDistance), neighbors);

        const f = p.createVector(0, 0);

        for (let n = 0; n < neighbors.length; n += 1) {
          const j = neighbors[n].userData;
          if (j === i) {
            continue;
          }
          const other = nodes[j];
          const d = p5.Vector.dist(node.pos, other.pos);
          if (d > 0 && d < CFG.separationDistance) {
            const away = p5.Vector.sub(node.pos, other.pos).normalize();
            away.mult((CFG.separationDistance - d) / CFG.separationDistance);
            f.add(away);
          }
        }

        const mid = p5.Vector.add(prev.pos, next.pos).mult(0.5);
        f.add(p5.Vector.sub(mid, node.pos).mult(CFG.spring));

        const outward = p5.Vector.sub(node.pos, p.createVector(obstacle.center.x, obstacle.center.y));
        if (outward.magSq() > 0) {
          outward.normalize().mult(0.065);
          f.add(outward);
        }

        f.x += Math.sin(p.frameCount * CFG.wobbleRateX + i * 0.71) * CFG.wobbleAmp;
        f.y += Math.cos(p.frameCount * CFG.wobbleRateY + i * 0.57) * CFG.wobbleAmp;

        node.vel.add(f.mult(0.35));
        node.vel.mult(CFG.damping);
        node.pos.add(node.vel);

        node.pos.x = clamp(node.pos.x, CFG.edgeHardMargin, p.width - CFG.edgeHardMargin);
        node.pos.y = clamp(node.pos.y, CFG.edgeHardMargin, p.height - CFG.edgeHardMargin);

        avoidEdges(node, p);
        avoidObstacle(node, obstacle);
      }

      insertNodes(p, obstacle);

      p.beginShape();
      for (let i = 0; i < nodes.length; i += 1) {
        p.vertex(nodes[i].pos.x, nodes[i].pos.y);
      }
      p.endShape(p.CLOSE);
    };
  };

  window.addEventListener(
    "warp:ready",
    () => {
      warpReady = true;
      started = false;
    },
    { once: false }
  );

  new p5(sketch);
})();
