// @ts-nocheck -- faithful vanilla-canvas port of the ANT Crawler design engine; not hand-typed.
// ant-creature.js — procedural side-profile ant.
// Inked rendering, three body segments anchored to terrain arc positions
// (so the body bends naturally over edges), six 2-bone-IK legs walking an
// alternating tripod gait, waving antennae, emerald eye.
export const AntCreature = (function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // foot/hip offsets along the body axis (×L), femur/tibia lengths (×L)
  function makeLegs() {
    return [
      { foot: 0.50, hip: 0.15, l1: 0.34, l2: 0.46, group: 0, far: false }, // near front
      { foot: 0.10, hip: 0.03, l1: 0.27, l2: 0.37, group: 1, far: false }, // near mid
      { foot: -0.36, hip: -0.10, l1: 0.34, l2: 0.48, group: 0, far: false }, // near rear
      { foot: 0.43, hip: 0.14, l1: 0.34, l2: 0.46, group: 1, far: true },  // far front
      { foot: 0.03, hip: 0.02, l1: 0.27, l2: 0.37, group: 0, far: true },  // far mid
      { foot: -0.43, hip: -0.11, l1: 0.34, l2: 0.48, group: 1, far: true },  // far rear
    ].map(d => ({ ...d, footS: 0, swing: null }));
  }

  function solveIK(hip, foot, l1, l2, up) {
    let dx = foot.x - hip.x, dy = foot.y - hip.y;
    let d = Math.hypot(dx, dy);
    const maxD = (l1 + l2) * 0.999;
    let fx = foot.x, fy = foot.y;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; fx = hip.x + dx; fy = hip.y + dy; }
    if (d < 1e-4) { d = 1e-4; dx = 1e-4; dy = 0; }
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = hip.x + dx * (a / d), my = hip.y + dy * (a / d);
    const px = -dy / d, py = dx / d;
    const k1x = mx + px * h, k1y = my + py * h;
    const k2x = mx - px * h, k2y = my - py * h;
    const d1 = (k1x - hip.x) * up.x + (k1y - hip.y) * up.y;
    const d2 = (k2x - hip.x) * up.x + (k2y - hip.y) * up.y;
    return d1 > d2
      ? { kx: k1x, ky: k1y, fx, fy }
      : { kx: k2x, ky: k2y, fx, fy };
  }

  function ellipsePath(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  }

  class Ant {
    constructor(world, s) {
      this.world = world;
      this.s = s;
      this.facing = Math.random() < 0.5 ? -1 : 1;
      this.speed = 0; this.targetSpeed = 0; this.vel = 0;
      this.state = 'idle'; this.stateT = 0; this.idleDur = 0.5 + Math.random() * 1.5;
      this.targetS = s;
      this.wanderDir = Math.random() < 0.5 ? -1 : 1;
      this.patrolDir = Math.random() < 0.5 ? -1 : 1;
      this.legs = makeLegs();
      this.phase = Math.random() * 10;
      this.time = Math.random() * 100;
      this.seed = Math.random() * 100;
      this.sizeMul = 1; this.speedMul = 1;
      this.burst = 1; this.burstT = 0;
      this.crumb = null; this.eatT = 0;
      this.turning = false;
      this.agent = null;          // terminal identity, assigned by world
      this.status = 'working';    // working | thinking | idle | needs
      this.statusT = 3 + Math.random() * 8;
      this.task = '';
      this.plantFeet();
    }

    get L() { return this.world.params.size * this.sizeMul; }

    plantFeet() {
      for (const leg of this.legs) {
        leg.footS = this.s + this.facing * leg.foot * this.L;
        leg.swing = null;
      }
    }

    setState(st, dur) { this.state = st; this.stateT = 0; if (dur != null) this.idleDur = dur; }

    setStatus(st) {
      this.status = st;
      this.statusT = st === 'working' ? 9 + Math.random() * 14
                   : st === 'thinking' ? 4 + Math.random() * 6
                   : st === 'idle' ? 5 + Math.random() * 9
                   : 14 + Math.random() * 10; // needs — waits for a click (or times out)
      this.task = this.world.pickTask ? this.world.pickTask(st) : '';
      if (st === 'needs') {
        this.paceAnchor = this.s;
        this.paceSpan = 26 + Math.random() * 22;
        this.paceSide = 1;
      }
      // re-time the current state so the new energy level shows promptly
      const T = this.world.terrain;
      if (this.state === 'idle') {
        this.setState('idle', st === 'working' ? 0.2 + Math.random() * 0.5
                            : st === 'needs' ? 0.3
                            : st === 'thinking' ? 0.6 + Math.random() * 0.9
                            : 1.5 + Math.random() * 2.5);
      } else if (this.state === 'walk' && st !== 'working') {
        // wind down: shorten the current leg
        const d = T.delta(this.s, this.targetS);
        this.targetS = T.wrap(this.s + Math.sign(d || 1) * Math.min(Math.abs(d), 50));
        this.targetSpeed = Math.min(this.targetSpeed, this.world.params.speed * this.speedMul * 0.5);
      }
    }

    updateStatus(dt) {
      this.statusT -= dt;
      if (this.statusT > 0) return;
      if (this.world._liveRoster) { this.statusT = 4; return; } // live status: server truth, no demo cycle
      if (this.status === 'needs') { this.setStatus('working'); return; }
      const r = Math.random();
      let next;
      if (this.status === 'working') next = r < 0.42 ? 'thinking' : r < 0.68 ? 'idle' : r < 0.80 ? 'needs' : 'working';
      else next = r < 0.72 ? 'working' : r < 0.88 ? 'thinking' : 'idle';
      this.setStatus(next);
    }

    pickWanderTarget() {
      const T = this.world.terrain;
      if (Math.random() < 0.32) this.wanderDir *= -1;
      const range = 120 + Math.random() * 480;
      this.targetS = T.wrap(this.s + this.wanderDir * range);
      this.targetSpeed = this.world.params.speed * this.speedMul * (0.65 + Math.random() * 0.55);
      this.setState('walk');
    }

    arrived() {
      return Math.abs(this.world.terrain.delta(this.s, this.targetS)) < 3 && Math.abs(this.vel) < 6;
    }

    updateBehavior(dt) {
      const W = this.world, T = W.terrain, P = W.params, L = this.L;
      this.stateT += dt;
      this.updateStatus(dt);

      // crumbs — any status except needs-response (that terminal is blocked)
      if (this.crumb && this.crumb.state === 'gone' && this.state !== 'eat') this.crumb = null;
      if (this.status === 'needs' && this.crumb && this.state !== 'eat') {
        this.crumb.claimedBy = null; this.crumb = null;
        if (this.state === 'seek') this.setState('idle', 0.3);
      }
      if (!this.crumb && this.state !== 'eat' && this.status !== 'needs') {
        const c = W.claimCrumb(this);
        if (c) { this.crumb = c; this.setState('seek'); }
      }

      if (this.state === 'seek') {
        const c = this.crumb;
        if (!c || c.state === 'gone') { this.crumb = null; this.setState('idle', 0.3); return; }
        const d = T.delta(this.s, c.s);
        this.targetS = T.wrap(c.s - (Math.sign(d) || 1) * L * 0.40);
        this.targetSpeed = P.speed * this.speedMul * 1.1;
        if (Math.abs(T.delta(this.s, this.targetS)) < 3 && Math.abs(this.vel) < 6) {
          this.setState('eat'); this.eatT = 0;
        }
        return;
      }

      if (this.state === 'eat') {
        this.targetSpeed = 0; this.eatT += dt;
        const c = this.crumb;
        if (c && c.state !== 'gone') {
          if (this.eatT > 0.5) { c.scale -= dt / 1.1; if (c.scale <= 0) { c.scale = 0; c.state = 'gone'; } }
        }
        if (!c || c.state === 'gone') { this.crumb = null; this.setState('idle', 0.8 + Math.random()); }
        return;
      }

      switch (P.mode) {
        case 'wander': {
          // status-driven locomotion
          const base = P.speed * this.speedMul;
          const walking = this.state === 'walk';
          switch (this.status) {
            case 'idle': // pretty static — rare tiny shuffle
              if (!walking) {
                this.targetSpeed = 0;
                if (this.stateT > this.idleDur) {
                  this.targetS = T.wrap(this.s + (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 45));
                  this.targetSpeed = base * 0.35;
                  this.setState('walk');
                }
              } else if (this.arrived()) this.setState('idle', 6 + Math.random() * 9);
              break;
            case 'thinking': // slow, wondering drift
              if (!walking) {
                this.targetSpeed = 0;
                if (this.stateT > this.idleDur) {
                  if (Math.random() < 0.35) this.wanderDir *= -1;
                  this.targetS = T.wrap(this.s + this.wanderDir * (60 + Math.random() * 150));
                  this.targetSpeed = base * (0.28 + Math.random() * 0.16);
                  this.setState('walk');
                }
              } else if (this.arrived()) this.setState('idle', 1 + Math.random() * 1.8);
              break;
            case 'needs': // pace between two close points
              if (!walking) {
                this.targetSpeed = 0;
                if (this.stateT > this.idleDur) {
                  this.paceSide = -(this.paceSide || 1);
                  this.targetS = T.wrap(this.paceAnchor + this.paceSide * this.paceSpan);
                  this.targetSpeed = base * 0.45;
                  this.setState('walk');
                }
              } else if (this.arrived()) this.setState('idle', 0.35 + Math.random() * 0.5);
              break;
            default: // working — quick, clearly active
              if (!walking) {
                this.targetSpeed = 0;
                if (this.stateT > this.idleDur) {
                  if (Math.random() < 0.25) this.wanderDir *= -1;
                  this.targetS = T.wrap(this.s + this.wanderDir * (200 + Math.random() * 420));
                  this.targetSpeed = base * (1.0 + Math.random() * 0.35);
                  this.setState('walk');
                }
              } else if (this.arrived()) this.setState('idle', 0.3 + Math.random() * 0.9);
          }
          break;
        }
        case 'patrol':
          if (this.state !== 'walk') {
            this.targetSpeed = 0;
            if (this.stateT > this.idleDur) this.setState('walk');
          } else {
            this.targetS = T.wrap(this.s + this.patrolDir * 300);
            this.targetSpeed = P.speed * this.speedMul;
            if (this.stateT > 7 + (this.seed % 5) && Math.random() < dt * 0.4) {
              this.setState('idle', 0.5 + Math.random() * 0.8);
            }
          }
          break;
        case 'follow': {
          const cur = W.cursor;
          if (!cur) { this.targetSpeed = 0; if (this.state !== 'idle') this.setState('idle', 9e9); break; }
          const n = T.nearest(cur.x, cur.y);
          const d = T.delta(this.s, n.s);
          if (Math.abs(d) > L * 1.5) {
            this.state = 'walk';
            this.targetS = T.wrap(n.s - Math.sign(d) * L * 1.1);
            this.targetSpeed = P.speed * this.speedMul * 1.15;
          } else {
            this.targetSpeed = 0;
            this.state = 'idle'; this.stateT = 0; this.idleDur = 9e9;
          }
          break;
        }
      }
    }

    update(dt) {
      const T = this.world.terrain, P = this.world.params, L = this.L;
      this.time += dt;
      this.updateBehavior(dt);

      const delta = T.delta(this.s, this.targetS);
      let want;
      if (this.targetSpeed > 0 && Math.abs(delta) > 2) want = Math.sign(delta);
      else want = this.facing >= 0 ? 1 : -1;

      const rate = dt * 6;
      this.facing = clamp(this.facing + clamp(want - this.facing, -rate, rate), -1, 1);
      this.turning = Math.abs(want - this.facing) > 0.15;

      let desired = this.targetSpeed * clamp(Math.abs(delta) / (L * 0.9), 0, 1);
      if (this.turning) desired *= 0.12;
      if (P.gait === 'skittery' && desired > 1) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          this.burst = Math.random() < 0.22 ? 0.05 : 0.5 + Math.random() * 1.25;
          this.burstT = 0.12 + Math.random() * 0.45;
        }
        desired *= this.burst;
      }
      this.speed += clamp(desired - this.speed, -dt * 900, dt * 650);
      if (this.speed < 0) this.speed = 0;

      let step = want * this.speed * dt;
      if (this.targetSpeed > 0 && Math.abs(step) > Math.abs(delta)) step = delta;
      this.vel = dt > 0 ? step / dt : 0;
      this.s = T.wrap(this.s + step);
      this.phase += dt * Math.abs(this.vel) / (L * 0.55);

      this.updateLegs(dt);
    }

    updateLegs(dt) {
      const T = this.world.terrain, P = this.world.params, L = this.L;
      const sk = P.gait === 'skittery';
      const stride = L * (sk ? 0.38 : 0.58);
      const spd = Math.max(Math.abs(this.vel), this.turning ? L * 1.6 : 0);
      const dur = clamp(stride / Math.max(60, spd * 2.4), sk ? 0.05 : 0.07, sk ? 0.13 : 0.22);

      const swinging = [false, false];
      for (const leg of this.legs) {
        if (leg.swing) {
          leg.swing.t += dt / leg.swing.dur;
          if (leg.swing.t >= 1) { leg.footS = leg.swing.to; leg.swing = null; }
          else swinging[leg.group] = true;
        }
      }

      if (swinging[0] || swinging[1]) return; // strict tripod alternation

      const travel = this.vel !== 0 ? Math.sign(this.vel) : (this.facing >= 0 ? 1 : -1);
      for (let g = 0; g < 2; g++) {
        let need = false;
        for (const leg of this.legs) {
          if (leg.group !== g) continue;
          leg.footS = this.s + T.delta(this.s, leg.footS);
          const ideal = this.s + this.facing * leg.foot * L;
          if (Math.abs(ideal - leg.footS) > stride * 0.5) { need = true; break; }
        }
        if (!need) continue;
        let started = false;
        for (const leg of this.legs) {
          if (leg.group !== g) continue;
          const ideal = this.s + this.facing * leg.foot * L;
          if (Math.abs(ideal - leg.footS) > stride * 0.12) {
            leg.swing = { from: leg.footS, to: ideal + travel * stride * 0.45, t: 0, dur };
            started = true;
          }
        }
        if (started) break;
      }
    }

    footWorld(leg) {
      const T = this.world.terrain, L = this.L;
      if (!leg.swing) {
        const p = T.pointAt(leg.footS);
        return { x: p.x, y: p.y };
      }
      const sw = leg.swing, t = Math.min(1, sw.t);
      const e = t * t * (3 - 2 * t);
      const p = T.pointAt(sw.from + T.delta(sw.from, sw.to) * e);
      const lift = Math.sin(Math.PI * t) * L * (this.world.params.gait === 'skittery' ? 0.07 : 0.11);
      return { x: p.x + p.nx * lift, y: p.y + p.ny * lift };
    }

    // averaged terrain frame — smooths the offset curve at corners so the
    // body doesn't splay apart when bending over an edge
    smoothAt(off) {
      const T = this.world.terrain, L = this.L, f = this.facing;
      let x = 0, y = 0, nx = 0, ny = 0, tx = 0, ty = 0;
      for (const d of [-0.10, 0, 0.10]) {
        const p = T.pointAt(this.s + (off + d) * L * f);
        x += p.x; y += p.y; nx += p.nx; ny += p.ny; tx += p.tx; ty += p.ty;
      }
      x /= 3; y /= 3;
      const nl = Math.hypot(nx, ny) || 1;
      const tl = Math.hypot(tx, ty) || 1;
      return { x, y, nx: nx / nl, ny: ny / nl, tx: tx / tl, ty: ty / tl };
    }

    bodyFrame() {
      const L = this.L;
      const moving = clamp(Math.abs(this.vel) / 60, 0, 1);
      const bob = Math.sin(this.phase * TAU) * L * 0.018 * moving;
      const eat = this.state === 'eat' ? 0.5 - 0.5 * Math.cos(Math.min(1, this.eatT * 2) * Math.PI) : 0;
      const headDip = eat * (0.10 + 0.03 * Math.sin(this.time * 9));
      const at = (off, h) => {
        const p = this.smoothAt(off);
        const lift = h * L + bob;
        return { x: p.x + p.nx * lift, y: p.y + p.ny * lift, p };
      };
      return {
        head: at(0.33, 0.32 - headDip),
        thorax: at(0.02, 0.27),
        waist: at(-0.17, 0.26),
        abd: at(-0.37, 0.30),
        hipH: 0.22,
      };
    }

    draw(ctx) {
      const W = this.world, P = W.params, L = this.L, T = W.terrain;
      const f = this.facing;
      const fxm = (f < 0 ? -1 : 1) * Math.max(0.30, Math.abs(f));
      // Per-agent line-art colour in live-roster mode: each real agent's ant
      // is inked in its own colour (a CSS strokeStyle, so an hsl() is fine).
      // The neutral body fill + emerald eye stay world-level.
      const ink = (W._liveRoster && this.agent && this.agent.color) ? this.agent.color : W.antInk();
      const fill = W.antFill();
      const B = this.bodyFrame();
      const lw = Math.max(0.9, L * 0.034);
      const up = { x: B.thorax.p.nx, y: B.thorax.p.ny };

      // ── contact shadow on the surface ──
      const gp = T.pointAt(this.s);
      ctx.save();
      ctx.translate(gp.x + gp.nx * 0.5, gp.y + gp.ny * 0.5);
      ctx.rotate(Math.atan2(gp.ty, gp.tx));
      ctx.scale(1, 0.16);
      const sr = L * 0.66;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
      grad.addColorStop(0, W.shadowColor(0.16));
      grad.addColorStop(1, W.shadowColor(0));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, sr, 0, TAU); ctx.fill();
      ctx.restore();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // ── far legs + far antenna (behind body) ──
      this.drawLegs(ctx, B, true, ink, lw, up);
      this.drawAntenna(ctx, B, true, ink, lw, fxm);

      // ── spine connector ──
      ctx.beginPath();
      ctx.moveTo(B.head.x, B.head.y);
      ctx.lineTo(B.thorax.x, B.thorax.y);
      ctx.lineTo(B.waist.x, B.waist.y);
      ctx.lineTo(B.abd.x, B.abd.y);
      ctx.strokeStyle = ink; ctx.lineWidth = lw * 0.8; ctx.globalAlpha = 0.5;
      ctx.stroke(); ctx.globalAlpha = 1;

      // ── abdomen (gaster) with segment stripes ──
      ctx.save();
      ctx.translate(B.abd.x, B.abd.y);
      ctx.rotate(Math.atan2(B.abd.p.ty, B.abd.p.tx));
      ctx.scale(fxm, 1);
      ellipsePath(ctx, 0, 0, L * 0.25, L * 0.16);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.stroke();
      ctx.save();
      ellipsePath(ctx, 0, 0, L * 0.25, L * 0.16);
      ctx.clip();
      ctx.globalAlpha = 0.45; ctx.lineWidth = lw * 0.7;
      ctx.beginPath(); ctx.arc(L * 0.30, 0, L * 0.38, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(L * 0.28, 0, L * 0.44, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
      ctx.restore();
      ctx.restore();

      // ── petiole (waist) ──
      ctx.save();
      ctx.translate(B.waist.x, B.waist.y);
      ctx.rotate(Math.atan2(B.waist.p.ty, B.waist.p.tx));
      ctx.scale(fxm, 1);
      ellipsePath(ctx, 0, 0, L * 0.055, L * 0.048);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = lw * 0.85; ctx.stroke();
      ctx.restore();

      // ── thorax ──
      ctx.save();
      ctx.translate(B.thorax.x, B.thorax.y);
      ctx.rotate(Math.atan2(B.thorax.p.ty, B.thorax.p.tx));
      ctx.scale(fxm, 1);
      ellipsePath(ctx, 0, 0, L * 0.148, L * 0.092);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.stroke();
      ctx.restore();

      // ── head + mandibles + eye ──
      ctx.save();
      ctx.translate(B.head.x, B.head.y);
      ctx.rotate(Math.atan2(B.head.p.ty, B.head.p.tx));
      ctx.scale(fxm, 1);
      ellipsePath(ctx, 0, 0, L * 0.128, L * 0.100);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.stroke();
      // mandibles
      ctx.beginPath();
      ctx.moveTo(L * 0.115, L * 0.02); ctx.lineTo(L * 0.185, L * 0.055);
      ctx.moveTo(L * 0.125, L * 0.048); ctx.lineTo(L * 0.165, L * 0.088);
      ctx.lineWidth = lw * 0.75; ctx.stroke();
      // eye — agent identity color; pulses when the terminal needs a response
      const agentCol = (this.agent && this.agent.color) || W.eyeColor();
      let glow = P.eyeGlow ? 1 : 0;
      if (this.status === 'needs') glow = 1.4 + 0.9 * Math.sin(this.time * 6);
      if (glow > 0.05) {
        ctx.shadowColor = agentCol;
        ctx.shadowBlur = L * 0.30 * (W.k || 1) * glow;
      }
      ctx.beginPath(); ctx.arc(L * 0.03, -L * 0.012, L * 0.056, 0, TAU);
      ctx.fillStyle = agentCol; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(L * 0.012, -L * 0.034, L * 0.018, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
      ctx.restore();

      // ── near legs + near antenna (in front) ──
      this.drawLegs(ctx, B, false, ink, lw, up);
      this.drawAntenna(ctx, B, false, ink, lw, fxm);
    }

    drawLegs(ctx, B, far, ink, lw, up) {
      const T = this.world.terrain, L = this.L, f = this.facing;
      ctx.strokeStyle = ink;
      for (const leg of this.legs) {
        if (leg.far !== far) continue;
        const hp = this.smoothAt(leg.hip);
        const hip = { x: hp.x + hp.nx * B.hipH * L, y: hp.y + hp.ny * B.hipH * L };
        const foot = this.footWorld(leg);
        const ik = solveIK(hip, foot, leg.l1 * L, leg.l2 * L, up);
        // tarsus tick beyond the foot
        const tdx = ik.fx - ik.kx, tdy = ik.fy - ik.ky;
        const tl = Math.hypot(tdx, tdy) || 1;
        ctx.globalAlpha = far ? 0.40 : 0.95;
        ctx.lineWidth = lw * (far ? 0.72 : 0.9);
        ctx.beginPath();
        ctx.moveTo(hip.x, hip.y);
        ctx.lineTo(ik.kx, ik.ky);
        ctx.lineTo(ik.fx, ik.fy);
        ctx.lineTo(ik.fx + (tdx / tl) * L * 0.06, ik.fy + (tdy / tl) * L * 0.06);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawAntenna(ctx, B, far, ink, lw, fxm) {
      const L = this.L;
      const hp = B.head.p;
      const ux = hp.tx * fxm, uy = hp.ty * fxm;
      const vx = hp.nx, vy = hp.ny;
      const dirAt = (a) => ({ x: ux * Math.cos(a) + vx * Math.sin(a), y: uy * Math.cos(a) + vy * Math.sin(a) });
      const idle = this.state === 'idle' || this.state === 'eat' || this.state === 'seek' && false;
      const t = this.time, k = far ? 1 : 0;
      const w1 = Math.sin(t * (idle ? 2.6 : 7.5) + this.seed + k * 2.1) * (idle ? 0.30 : 0.14);
      const w2 = Math.sin(t * (idle ? 3.4 : 9.0) + this.seed * 1.7 + k * 1.3) * (idle ? 0.34 : 0.18);
      const eat = this.state === 'eat' ? 0.55 : 0;
      const base = { x: B.head.x + ux * L * 0.11 + vx * L * 0.09, y: B.head.y + uy * L * 0.11 + vy * L * 0.09 };
      const d1 = dirAt(1.05 + w1 - eat * 0.8);
      const elbow = { x: base.x + d1.x * L * 0.20, y: base.y + d1.y * L * 0.20 };
      const d2 = dirAt(0.35 + w2 - eat * 0.9);
      const tip = { x: elbow.x + d2.x * L * 0.30, y: elbow.y + d2.y * L * 0.30 };
      const mid = { x: elbow.x + d2.x * L * 0.15 + vx * L * 0.025, y: elbow.y + d2.y * L * 0.15 + vy * L * 0.025 };
      ctx.strokeStyle = ink;
      ctx.globalAlpha = far ? 0.40 : 0.92;
      ctx.lineWidth = lw * (far ? 0.6 : 0.75);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(tip.x, tip.y, lw * 0.85, 0, TAU);
      ctx.fillStyle = ink; ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  return { Ant };
})();