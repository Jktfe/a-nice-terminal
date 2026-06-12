// @ts-nocheck -- faithful vanilla-canvas port of the ANT Crawler design engine; not hand-typed.
// ant-terrain.js — walkable closed-loop surface for the crawling ant.
// The loop traces: floor (left→right, climbing over each block's skyline),
// up the right wall, across the ceiling (right→left), down the left wall.
// Convention: surface normal ("up" for the ant) = left of travel = (ty, -tx).
export const AntTerrain = (function () {
  function roundedLoop(rawPts, defaultR) {
    const out = [];
    const n = rawPts.length;
    for (let i = 0; i < n; i++) {
      const p0 = rawPts[(i - 1 + n) % n], p1 = rawPts[i], p2 = rawPts[(i + 1) % n];
      const r = p1.r != null ? p1.r : defaultR;
      const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
      const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-6 || l2 < 1e-6 || r <= 0.01) { out.push({ x: p1.x, y: p1.y }); continue; }
      const rr = Math.min(r, l1 * 0.49, l2 * 0.49);
      const ax = p1.x - (v1x / l1) * rr, ay = p1.y - (v1y / l1) * rr;
      const bx = p1.x + (v2x / l2) * rr, by = p1.y + (v2y / l2) * rr;
      const steps = 5;
      for (let t = 0; t <= steps; t++) {
        const u = t / steps, w = 1 - u;
        out.push({
          x: w * w * ax + 2 * w * u * p1.x + u * u * bx,
          y: w * w * ay + 2 * w * u * p1.y + u * u * by,
        });
      }
    }
    return out;
  }

  class Terrain {
    constructor(points) { this.setPoints(points); }

    setPoints(points) {
      const segs = [];
      let total = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        segs.push({ a, b, len, s0: total, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len });
        total += len;
      }
      this.segs = segs;
      this.total = total;
    }

    wrap(s) { s %= this.total; if (s < 0) s += this.total; return s; }

    // signed shortest arc from s0 to s1
    delta(s0, s1) {
      let d = this.wrap(s1) - this.wrap(s0);
      if (d > this.total / 2) d -= this.total;
      if (d < -this.total / 2) d += this.total;
      return d;
    }

    pointAt(s) {
      s = this.wrap(s);
      const segs = this.segs;
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].s0 + segs[mid].len < s) lo = mid + 1; else hi = mid;
      }
      const sg = segs[lo];
      const t = Math.max(0, Math.min(1, (s - sg.s0) / sg.len));
      return {
        x: sg.a.x + (sg.b.x - sg.a.x) * t,
        y: sg.a.y + (sg.b.y - sg.a.y) * t,
        tx: sg.tx, ty: sg.ty,
        nx: sg.ty, ny: -sg.tx, // away from surface
      };
    }

    nearest(x, y) {
      let best = null;
      for (const sg of this.segs) {
        const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
        let t = ((x - sg.a.x) * dx + (y - sg.a.y) * dy) / (sg.len * sg.len);
        t = Math.max(0, Math.min(1, t));
        const px = sg.a.x + dx * t, py = sg.a.y + dy * t;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (!best || d2 < best.d2) {
          best = { d2, s: sg.s0 + sg.len * t, x: px, y: py, nx: sg.ty, ny: -sg.tx };
        }
      }
      best.dist = Math.sqrt(best.d2);
      return best;
    }
  }

  // inner: {w,h}; blocks: [{x,w,h,r?}] sitting on the floor (y = inner.h)
  function buildTerrain(inner, blocks) {
    const W = inner.w, H = inner.h;
    const raw = [];
    raw.push({ x: 0, y: H, r: 20 });
    const sorted = [...blocks].sort((a, b) => a.x - b.x);
    for (const b of sorted) {
      const top = H - b.h;
      const r = Math.min(16, (b.r != null ? b.r : 14) + 4);
      raw.push({ x: b.x, y: H, r: 8 });            // base of left wall (concave)
      raw.push({ x: b.x, y: top, r: r });          // top-left (convex)
      raw.push({ x: b.x + b.w, y: top, r: r });    // top-right (convex)
      raw.push({ x: b.x + b.w, y: H, r: 8 });      // base of right wall (concave)
    }
    raw.push({ x: W, y: H, r: 20 });
    raw.push({ x: W, y: 0, r: 20 });
    raw.push({ x: 0, y: 0, r: 20 });
    return new Terrain(roundedLoop(raw, 10));
  }

  return { Terrain, buildTerrain, roundedLoop };
})();