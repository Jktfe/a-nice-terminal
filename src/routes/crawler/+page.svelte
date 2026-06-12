<script lang="ts">
  // ANT Crawler — terrarium playground.
  // Procedural side-profile crawling-ant colony (canvas engine in
  // $lib/crawler) climbing the platform's UI blocks. Pixel-perfect port of
  // the Claude Design handoff (ANT Crawler.html). The dev Tweaks panel from
  // the prototype is intentionally omitted — its chosen values ship as the
  // production defaults below. Live-agent wiring (each ant = a real agent)
  // is a deliberate follow-up; today the roster is the showpiece set.
  import { onMount, onDestroy } from 'svelte';
  import { Crawler } from '$lib/crawler/antWorld.js';

  // The values the design landed on (prototype TWEAK_DEFAULTS).
  const DEFAULTS = {
    dark: true,
    count: 3,
    size: 40,
    speed: 61,
    gait: 'skittery',
    mode: 'wander',
    color: 'ink',
    eyeGlow: true
  } as const;

  let dark = $state<boolean>(DEFAULTS.dark);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engine is vanilla JS
  let world: any = null;
  let teardown: (() => void) | null = null;

  function setDark(value: boolean) {
    dark = value;
    if (world) world.setParams({ dark: value });
  }

  onMount(() => {
    const res = Crawler.initCrawler();
    if (res) {
      world = res.world;
      teardown = res.destroy;
      world.setParams({ ...DEFAULTS });
    }
  });

  onDestroy(() => {
    teardown?.();
  });
</script>

<svelte:head>
  <title>ANT — Crawler</title>
  <link
    href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="crawler-root" data-theme={dark ? 'dark' : 'light'}>
  <div id="stage" data-screen-label="ANT Crawler — terrarium playground">
    <header>
      <div class="brand">
        <span class="wordmark">ANT</span>
        <span class="sub">// crawler study — terrarium-01</span>
      </div>
      <div class="hdr-right">
        <span class="hint">HOVER AN ANT FOR STATUS · CLICK A PACING ANT TO RESPOND · CLICK GLASS FOR A CRUMB</span>
        <div class="seg" role="group" aria-label="Theme">
          <button class:on={!dark} onclick={() => setDark(false)}>Light</button>
          <button class:on={dark} onclick={() => setDark(true)}>Dark</button>
        </div>
      </div>
    </header>
    <div id="panel">
      <div id="walk-area"></div>
      <canvas id="ant-canvas" width="1148" height="532"></canvas>
      <div class="panel-caption">TERRARIUM-01 · COLONY ACTIVE</div>
    </div>
  </div>
</div>

<style>
  /* Scoped under .crawler-root + :global so the rules also reach the scene
     blocks and tooltip the canvas engine creates with createElement (Svelte
     would otherwise only scope template elements). The .crawler-root prefix
     keeps everything from leaking into the rest of the app. */
  :global(.crawler-root) {
    --bg: #fbf9f5;
    --panel: #ffffff;
    --line: #e8e3d7;
    --line-soft: #f4f1ea;
    --ink: #26231a;
    --muted: #7a7363;
    --faint: #a9a190;
    --elev: #fbf9f5;
    --term-bg: #161c27;
    --term-ink: #c5cbd4;
    --clay: #c96442;
    --clay-ink: #fbf9f5;
    --panel-shadow: 0 60px 120px -30px rgba(27, 26, 21, 0.22), 0 12px 28px -14px rgba(27, 26, 21, 0.12);

    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
    display: grid;
    place-items: center;
    font-family: 'Geist', system-ui, sans-serif;
    color: var(--ink);
    transition: background 0.35s ease;
    z-index: 0;
  }
  :global(.crawler-root[data-theme='dark']) {
    --bg: #0a0e1c;
    --panel: #0f1424;
    --line: #222940;
    --line-soft: #161c30;
    --ink: #e3e7f0;
    --muted: #8990a8;
    --faint: #565e7a;
    --elev: #161c30;
    --term-bg: #060814;
    --term-ink: #bfc6d6;
    --clay: #e07856;
    --clay-ink: #0a0e1c;
    --panel-shadow: 0 60px 120px -30px rgba(0, 0, 0, 0.65), 0 12px 28px -14px rgba(0, 0, 0, 0.45);
  }

  :global(.crawler-root #stage) {
    width: 1200px;
    height: 680px;
    position: relative;
    transform-origin: center center;
  }

  /* ── header ── */
  :global(.crawler-root #stage header) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 6px;
    box-sizing: border-box;
  }
  :global(.crawler-root .brand) {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  :global(.crawler-root .wordmark) {
    font-weight: 800;
    font-size: 20px;
    letter-spacing: 0.06em;
  }
  :global(.crawler-root .brand .sub) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--muted);
  }
  :global(.crawler-root .hdr-right) {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  :global(.crawler-root .hint) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--faint);
    letter-spacing: 0.04em;
  }

  :global(.crawler-root .seg) {
    display: flex;
    padding: 2px;
    border-radius: 8px;
    background: var(--line-soft);
    border: 1px solid var(--line);
    gap: 2px;
  }
  :global(.crawler-root .seg button) {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  :global(.crawler-root .seg button.on) {
    background: var(--panel);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  /* ── terrarium panel ── */
  :global(.crawler-root #panel) {
    position: absolute;
    top: 64px;
    left: 0;
    width: 1200px;
    height: 584px;
    box-sizing: border-box;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 22px;
    box-shadow: var(--panel-shadow);
    transition: background 0.35s ease, border-color 0.35s ease;
    cursor: crosshair;
  }
  :global(.crawler-root #walk-area) {
    position: absolute;
    inset: 26px;
    border: 1px solid var(--line-soft);
    border-radius: 14px;
    transition: border-color 0.35s ease;
  }
  :global(.crawler-root #ant-canvas) {
    position: absolute;
    left: 26px;
    top: 26px;
    width: 1148px;
    height: 532px;
    z-index: 5;
    pointer-events: none;
  }
  :global(.crawler-root .panel-caption) {
    position: absolute;
    top: 38px;
    left: 48px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.14em;
    color: var(--faint);
    user-select: none;
    pointer-events: none;
  }

  /* ── scene blocks (the ant climbs these) ── */
  :global(.crawler-root .blk) {
    position: absolute;
    bottom: 0;
    box-sizing: border-box;
    pointer-events: none;
    user-select: none;
    transition: background 0.35s ease, border-color 0.35s ease;
  }
  :global(.crawler-root .blk-composer) {
    background: var(--elev);
    border: 1px solid var(--line);
    border-radius: 12px 12px 4px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 10px;
  }
  :global(.crawler-root .blk-composer .ph) {
    font-size: 13px;
    color: var(--muted);
  }
  :global(.crawler-root .blk-composer .pr) {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 14px;
    color: #3b82f6;
  }
  :global(.crawler-root .blk-send) {
    background: var(--clay);
    border-radius: 12px 12px 4px 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  :global(.crawler-root .blk-send .send-lbl) {
    font-size: 13px;
    font-weight: 700;
    color: var(--clay-ink);
  }
  :global(.crawler-root .blk-terminal) {
    background: var(--term-bg);
    border: 1px solid var(--line);
    border-radius: 12px 12px 4px 4px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
  }
  :global(.crawler-root .blk-terminal .tl) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--term-ink);
    white-space: nowrap;
  }
  :global(.crawler-root .blk-terminal .t-pr) {
    color: #4285f4;
    font-weight: 700;
  }
  :global(.crawler-root .blk-terminal .t-ok) {
    color: #34d06f;
  }
  :global(.crawler-root .blk-terminal .t-dim) {
    color: #566070;
  }
  :global(.crawler-root .blk-terminal .t-cur) {
    display: inline-block;
    width: 6px;
    height: 10px;
    margin-left: 2px;
    background: #22c55e;
    vertical-align: -1px;
    animation: cur-blink 1.1s steps(2, start) infinite;
  }
  @keyframes cur-blink {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  :global(.crawler-root .blk-asks) {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px 12px 4px 4px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 1px 2px rgba(27, 26, 21, 0.05);
  }
  :global(.crawler-root .blk-asks .card-h) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line-soft);
  }
  :global(.crawler-root .blk-asks .badge) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    font-weight: 700;
    background: var(--clay);
    color: var(--clay-ink);
    padding: 1px 7px;
    border-radius: 999px;
  }
  :global(.crawler-root .blk-asks .ask-row) {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
  }
  :global(.crawler-root .blk-asks .ask-row span) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.crawler-root .blk-asks .ask-row i) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── agent tooltip (engine-created) ── */
  :global(.crawler-root #fx-layer) {
    position: absolute;
    inset: 26px;
    z-index: 7;
    pointer-events: none;
    overflow: visible;
  }
  :global(.crawler-root #ant-tip) {
    position: absolute;
    left: 0;
    top: 0;
    background: var(--term-bg);
    color: var(--term-ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 11px 8px;
    pointer-events: none;
    display: none;
    white-space: nowrap;
    box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.45);
  }
  :global(.crawler-root #ant-tip.show) {
    display: block;
  }
  :global(.crawler-root .tip-name) {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 11.5px 'Geist', system-ui, sans-serif;
    color: #ffffff;
  }
  :global(.crawler-root .tip-name i) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  :global(.crawler-root .tip-status) {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 4px;
    font-family: 'JetBrains Mono', monospace;
  }
  :global(.crawler-root .tip-status b) {
    font-size: 8.5px;
    letter-spacing: 0.1em;
    font-weight: 700;
  }
  :global(.crawler-root .tip-status code) {
    font-size: 10px;
    opacity: 0.85;
  }
</style>
