// @ts-nocheck -- faithful vanilla-canvas port of the ANT Crawler design engine; not hand-typed.
import { AntTerrain } from './antTerrain.js';
import { AntCreature } from './antCreature.js';

// ant-world.js — the terrarium: scene blocks, crumbs, render loop, params API.
export const Crawler = (function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ── scene (single source of truth for DOM blocks + terrain) ──
  const SCENE = [
    { x: 64, w: 320, h: 54, r: 12, type: 'composer' },
    { x: 414, w: 96, h: 54, r: 12, type: 'send' },
    { x: 596, w: 240, h: 96, r: 12, type: 'terminal' },
    { x: 908, w: 184, h: 150, r: 12, type: 'asks' },
  ];

  const TEMPLATES = {
    composer: `
      <span class="ph">Say something to the colony…</span>
      <span class="pr">›</span>`,
    send: `<span class="send-lbl">Send</span>`,
    terminal: `
      <div class="tl"><span class="t-pr">›</span> ant deploy --prod</div>
      <div class="tl t-ok">✓ colony synced · 3 agents</div>
      <div class="tl t-dim">mem 112MB · cpu 3% <span class="t-cur"></span></div>`,
    asks: `
      <div class="card-h"><span>Open asks</span><span class="badge">3</span></div>
      <div class="ask-row"><i style="background:#C96442"></i><span>@marksClaude · trustee?</span></div>
      <div class="ask-row"><i style="background:#10A37F"></i><span>@jamesScodex · checking</span></div>
      <div class="ask-row"><i style="background:#8957E5"></i><span>@jameskPi · Q2 minutes</span></div>`,
  };

  const ANT_COLORS = {
    ink: { light: '#26231A', dark: '#E6E9EE' },
    clay: { light: '#C96442', dark: '#E07856' },
    blue: { light: '#2563EB', dark: '#6E9BF8' },
    emerald: { light: '#0F7D37', dark: '#34D06F' },
  };

  // ── terminal identities the ants represent ──
  const ROSTER = [
    { name: '@marksClaude', kind: 'claude', color: '#C96442' },
    { name: '@jamesScodex', kind: 'codex', color: '#10A37F' },
    { name: '@jameskPi', kind: 'pi-agent', color: '#8957E5' },
    { name: '@nmvcGemini', kind: 'gemini', color: '#4285F4' },
    { name: '@christiansClaude', kind: 'claude', color: '#E07856' },
    { name: '@opsOllama', kind: 'ollama', color: '#E3954E' },
    { name: '@lpRoomLm', kind: 'lm-studio', color: '#E5A3C2' },
    { name: '@auditCodex', kind: 'codex', color: '#2EBD85' },
  ];

  const TASKS = {
    working: ['reconciling Feb export', 'drafting board pack §3', 'running ant deploy --prod', 'indexing Cantor docs', 'summarising LP thread', 'writing Q2 minutes', 'syncing room memory'],
    thinking: ['weighing trustee options…', 'planning next step…', 'reading room context…', 'tracing a £14.20 mismatch…'],
    idle: ['awaiting tasks', 'watching #NMVC-Q1', 'standing by'],
    needs: ['approve send to LP group?', 'confirm trustee = Ankura?', 'ship deploy to prod?', 'pin digest to room?'],
  };

  const STATUS_META = {
    working: { label: 'WORKING', color: '#22C55E' },
    thinking: { label: 'THINKING', color: '#4285F4' },
    idle: { label: 'IDLE', color: '#9AA3AE' },
    needs: { label: 'NEEDS RESPONSE', color: '#F59E0B' },
  };

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function makeCrumbShape() {
    const pts = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = 0.65 + Math.random() * 0.5;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  function drawCrumb(ctx, c, W) {
    if (c.state === 'gone' || c.scale <= 0) return;
    let s = c.scale;
    if (c.state === 'rest') s *= 1 + 0.18 * Math.exp(-(c.land || 0) * 9) * Math.sin((c.land || 0) * 26);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.scale(s, s);
    const dark = W.params.dark;
    ctx.beginPath();
    c.shape.forEach((p, i) => i ? ctx.lineTo(p.x * 4.6, p.y * 4.6) : ctx.moveTo(p.x * 4.6, p.y * 4.6));
    ctx.closePath();
    ctx.fillStyle = dark ? 'rgba(242,182,90,0.85)' : 'rgba(201,169,98,0.55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark ? 'rgba(227,231,240,0.7)' : 'rgba(38,35,26,0.72)';
    ctx.stroke();
    ctx.restore();
  }

  class AntWorld {
    constructor(opts) {
      this.canvas = opts.canvas;
      this.ctx = this.canvas.getContext('2d');
      this.inner = opts.inner;
      this.terrain = AntTerrain.buildTerrain(this.inner, opts.blocks);
      this.params = { dark: false, count: 1, size: 40, speed: 80, gait: 'smooth', mode: 'wander', color: 'ink', eyeGlow: true };
      this.ants = [new AntCreature.Ant(this, this.terrain.total * 0.08)];
      this.fx = opts.fx || null;
      this.tip = opts.tip || null;
      this.panelEl = opts.panelEl || null;
      this.hoverAnt = null;
      if (this.tip) {
        this._tipDot = this.tip.querySelector('.tip-name i');
        this._tipName = this.tip.querySelector('.tip-name span');
        this._tipSt = this.tip.querySelector('.tip-status b');
        this._tipTask = this.tip.querySelector('.tip-status code');
      }
      this._assignAgent(this.ants[0], 0);
      this.crumbs = [];
      this.cursor = null;
      this.k = 1;
      this._last = performance.now();
      this._stopped = false;
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    setScale(k) {
      this.k = k;
      this.canvas.width = Math.max(1, Math.round(this.inner.w * k));
      this.canvas.height = Math.max(1, Math.round(this.inner.h * k));
    }

    // Real-element overlay: rebuild the walk surface from live DOM rects so the
    // ants crawl the ACTUAL screen elements (composer, send, …), not a drawn
    // box. Re-measured on resize/scroll; ants keep walking (s is re-wrapped).
    updateTerrain(inner, blocks) {
      this.inner = inner;
      this.terrain = AntTerrain.buildTerrain(inner, blocks && blocks.length ? blocks : []);
      this.setScale(this.k);
      for (const a of this.ants) { a.s = this.terrain.wrap(a.s); if (a.plantFeet) a.plantFeet(); }
    }

    setParams(p) {
      const prev = this.params;
      this.params = { ...prev, ...p };
      if (p.count != null && p.count !== this.ants.length) {
        while (this.ants.length < p.count) {
          const a = new AntCreature.Ant(this, Math.random() * this.terrain.total * 0.55);
          a.sizeMul = 0.82 + Math.random() * 0.3;
          a.speedMul = 0.88 + Math.random() * 0.24;
          this.ants.push(a);
          this._assignAgent(a, this.ants.length - 1);
        }
        if (this.ants.length > p.count) this.ants.length = p.count;
      }
      if (p.size != null && p.size !== prev.size) {
        for (const a of this.ants) a.plantFeet();
      }
      if (p.mode && p.mode !== prev.mode) {
        for (const a of this.ants) {
          if (a.state !== 'eat') { a.crumb = null; a.setState('idle', 0.2 + Math.random() * 0.4); }
        }
        for (const c of this.crumbs) {
          if (c.claimedBy && c.claimedBy.crumb !== c) c.claimedBy = null;
        }
      }
    }

    _assignAgent(a, i) {
      if (this._liveRoster && this._liveRoster.length) {
        const ag = this._liveRoster[i % this._liveRoster.length];
        a.agent = { name: ag.name, kind: ag.kind || '', color: ag.color || this.antInk() };
        a.setStatus(ag.status || 'idle');
        a.task = ag.task || '';
        return;
      }
      a.agent = ROSTER[i % ROSTER.length];
      a.setStatus(['working', 'idle', 'working', 'thinking'][i % 4]);
      a.statusT *= 0.4 + Math.random();
    }

    // Live-agent mode: each ant maps to a REAL room agent + its real, frozen
    // status. Read-only — the status is the server's truth, not the demo cycle.
    setRoster(agents) {
      this._liveRoster = Array.isArray(agents) && agents.length ? agents : null;
      if (!this._liveRoster) return;
      this.setParams({ count: Math.max(1, Math.min(agents.length, 8)) });
      for (let i = 0; i < this.ants.length; i++) this._assignAgent(this.ants[i], i);
    }

    pickTask(st) {
      const arr = TASKS[st] || [''];
      return arr[Math.floor(Math.random() * arr.length)];
    }

    antAt(x, y) {
      let best = null, bd = 1e9;
      for (const a of this.ants) {
        const p = this.terrain.pointAt(a.s);
        const cx = p.x + p.nx * a.L * 0.3, cy = p.y + p.ny * a.L * 0.3;
        const d = Math.hypot(x - cx, y - cy);
        if (d < Math.max(26, a.L * 0.75) && d < bd) { bd = d; best = a; }
      }
      return best;
    }

    respond(a) { a.setStatus('working'); }

    updateTip() {
      if (!this.tip) return;
      const a = this.cursor ? this.antAt(this.cursor.x, this.cursor.y) : null;
      this.hoverAnt = a;
      if (this.panelEl) this.panelEl.style.cursor = a ? (a.status === 'needs' ? 'pointer' : 'default') : 'crosshair';
      if (!a) { this.tip.classList.remove('show'); return; }
      const meta = STATUS_META[a.status];
      const p = this.terrain.pointAt(a.s);
      const ax = p.x + p.nx * a.L * 1.35, ay = p.y + p.ny * a.L * 1.35;
      const below = p.ny > 0.3;
      this.tip.style.left = Math.max(90, Math.min(this.inner.w - 90, ax)) + 'px';
      this.tip.style.top = Math.max(4, Math.min(this.inner.h - 4, ay)) + 'px';
      this.tip.style.transform = below ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
      this.tip.classList.add('show');
      this._tipDot.style.background = a.agent.color;
      this._tipName.textContent = a.agent.name + ' · ' + a.agent.kind;
      this._tipSt.textContent = meta.label;
      this._tipSt.style.color = meta.color;
      this._tipTask.textContent = a.state === 'eat' ? 'ingesting crumb' : a.state === 'seek' ? 'fetching crumb' : a.task;
    }

    antInk() { const c = ANT_COLORS[this.params.color] || ANT_COLORS.ink; return c[this.params.dark ? 'dark' : 'light']; }
    antFill() {
      // opaque body fill: panel background tinted toward the ink color,
      // so bodies occlude legs/spine instead of reading see-through
      const hex = this.antInk();
      const n = parseInt(hex.slice(1), 16);
      const ir = (n >> 16) & 255, ig = (n >> 8) & 255, ib = n & 255;
      const dark = this.params.dark;
      const br = dark ? 15 : 255, bgc = dark ? 20 : 255, bb = dark ? 36 : 255;
      const t = dark ? 0.20 : 0.13;
      return `rgb(${Math.round(br + (ir - br) * t)},${Math.round(bgc + (ig - bgc) * t)},${Math.round(bb + (ib - bb) * t)})`;
    }
    eyeColor() { return this.params.dark ? '#3DDC72' : '#1CA64F'; }
    shadowColor(a) { return this.params.dark ? `rgba(0,0,0,${a * 1.6})` : `rgba(27,26,21,${a})`; }

    dropCrumb(x, y) {
      const n = this.terrain.nearest(x, y);
      const tx = n.x + n.nx * 2.5, ty = n.y + n.ny * 2.5;
      const falls = ty > y + 4;
      this.crumbs.push({
        x0: x, y0: y, tx, ty, x, y, s: n.s, t: 0,
        dur: falls ? clamp(Math.sqrt(ty - y) * 0.042, 0.16, 0.5) : 0.16,
        state: 'fall', scale: falls ? 1 : 0.01,
        rot: Math.random() * TAU, shape: makeCrumbShape(),
        claimedBy: null, land: 0,
      });
      if (this.crumbs.length > 10) {
        const idle = this.crumbs.find(c => c.state === 'rest' && !c.claimedBy);
        (idle || this.crumbs[0]).state = 'gone';
      }
    }

    claimCrumb(ant) {
      let best = null, bd = Infinity;
      for (const c of this.crumbs) {
        if (c.state !== 'rest') continue;
        if (c.claimedBy && this.ants.includes(c.claimedBy) && c.claimedBy.crumb === c) continue;
        const d = Math.abs(this.terrain.delta(ant.s, c.s));
        if (d < bd) { bd = d; best = c; }
      }
      if (best) best.claimedBy = ant;
      return best;
    }

    _loop(now) {
      if (this._stopped) return;
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;

      for (const c of this.crumbs) {
        if (c.state === 'fall') {
          c.t += dt / c.dur;
          if (c.t >= 1) { c.state = 'rest'; c.x = c.tx; c.y = c.ty; c.scale = 1; c.land = 0; }
          else {
            const e = c.t * c.t;
            c.x = c.x0 + (c.tx - c.x0) * c.t;
            c.y = c.y0 + (c.ty - c.y0) * e;
            c.scale = Math.min(1, c.t * 3 + 0.25);
          }
        } else if (c.state === 'rest') c.land += dt;
      }
      this.crumbs = this.crumbs.filter(c => c.state !== 'gone');

      for (const a of this.ants) a.update(dt);
      this.draw();
      this.updateTip();
      requestAnimationFrame(this._loop);
    }

    draw() {
      const ctx = this.ctx, k = this.k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, this.inner.w, this.inner.h);
      for (const c of this.crumbs) drawCrumb(ctx, c, this);
      for (const a of this.ants) a.draw(ctx);
    }
  }

  // ── page wiring ──
  function init() {
    const stage = document.getElementById('stage');
    const walkArea = document.getElementById('walk-area');
    const canvas = document.getElementById('ant-canvas');
    const panel = document.getElementById('panel');
    if (!stage || !walkArea || !canvas) return;

    const inner = { w: 1148, h: 532 };

    for (const b of SCENE) {
      const el = document.createElement('div');
      el.className = 'blk blk-' + b.type;
      el.style.left = b.x + 'px';
      el.style.width = b.w + 'px';
      el.style.height = b.h + 'px';
      el.innerHTML = TEMPLATES[b.type] || '';
      walkArea.appendChild(el);
    }

    const fx = document.createElement('div');
    fx.id = 'fx-layer';
    panel.appendChild(fx);
    const tip = document.createElement('div');
    tip.id = 'ant-tip';
    tip.innerHTML = '<div class="tip-name"><i></i><span></span></div><div class="tip-status"><b></b><code></code></div>';
    fx.appendChild(tip);

    const world = new AntWorld({ canvas, inner, blocks: SCENE, fx, tip, panelEl: panel });
    window.antWorld = world;

    const fit = () => {
      const sc = Math.min(1, (window.innerWidth - 24) / 1200, (window.innerHeight - 24) / 680);
      stage.style.transform = `scale(${sc})`;
      world.setScale((window.devicePixelRatio || 1) * sc);
    };
    window.addEventListener('resize', fit);
    fit();

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * inner.w, y: (e.clientY - r.top) / r.height * inner.h };
    };
    panel.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      const hit = world.antAt(p.x, p.y);
      if (hit && hit.status === 'needs') { world.respond(hit); return; }
      if (p.x >= -28 && p.y >= -28 && p.x <= inner.w + 28 && p.y <= inner.h + 28) {
        world.dropCrumb(clamp(p.x, 3, inner.w - 3), clamp(p.y, 3, inner.h - 3));
      }
    });
    panel.addEventListener('pointermove', (e) => { world.cursor = toLocal(e); });
    panel.addEventListener('pointerleave', () => { world.cursor = null; });

    const destroy = () => { world._stopped = true; window.removeEventListener('resize', fit); };
    return { world, destroy };
  }

  return { AntWorld, initCrawler: init };
})();