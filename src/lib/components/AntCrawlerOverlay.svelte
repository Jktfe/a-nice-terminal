<script lang="ts">
  // Ant crawler OVERLAY for the real room. Transparent, non-interactive canvas
  // that sits on top of the actual chat UI; the ants' walk surface is built
  // from the LIVE bounding boxes of real elements (the composer + send button),
  // so they crawl the actual screen — not a drawn terrarium box. Re-measured on
  // resize/scroll/new-messages. Each ant is a real room agent (read-only).
  // Floating message-card / room-row climbing is a follow-up (needs free-
  // floating surface terrain rather than the floor-anchored model).
  import { onMount, onDestroy } from 'svelte';
  import { Crawler } from '$lib/crawler/antWorld.js';
  import { subscribeToRoomEvents } from '$lib/stores/realtimeRoom.svelte';

  let { roomId, dark = false }: { roomId: string; dark?: boolean } = $props();

  let containerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engine is vanilla JS
  let world: any = null;
  let teardown: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let realtime: ReturnType<typeof subscribeToRoomEvents> | null = null;

  // The real, climbable elements (bottom-anchored, so they map to the engine's
  // floor-block model). Scoped to this room's .room-main.
  const ELEMENT_SELECTORS = ['.chat-composer', '.send-action-slot', '.composer-actions'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engine block shape
  function measure(): { inner: { w: number; h: number }; blocks: any[] } {
    const base = containerEl.getBoundingClientRect();
    const inner = { w: Math.max(1, base.width), h: Math.max(1, base.height) };
    const root = containerEl.closest('.room-main') ?? document;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];
    const seen = new Set<string>();
    for (const sel of ELEMENT_SELECTORS) {
      root.querySelectorAll(sel).forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width < 12 || r.height < 6) return;
        const x = Math.round(Math.max(0, r.left - base.left));
        const w = Math.round(Math.min(r.width, inner.w - x));
        // The block rises from the floor (inner.h) up to this element's top, so
        // the ant climbs onto the element's top edge and walks across it.
        const h = Math.round(Math.max(8, inner.h - (r.top - base.top)));
        const key = `${x}:${w}:${h}`;
        if (w < 12 || seen.has(key)) return;
        seen.add(key);
        blocks.push({ x, w, h, r: 10 });
      });
    }
    return { inner, blocks };
  }

  function colorForHandle(handle: string): string {
    let n = 0;
    for (const ch of handle) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${n % 360} 62% 56%)`;
  }
  function mapStatus(status: string, openAsk: boolean): string {
    if (openAsk || status === 'response-required') return 'needs';
    if (status === 'working' || status === 'thinking') return status;
    return 'idle';
  }
  async function loadAgents() {
    if (!world) return;
    try {
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/agent-statuses`);
      if (!res.ok) return;
      const data = await res.json();
      const roster = (data.statuses ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server JSON
        .filter((e: any) => e.lifecycleStatus == null || e.lifecycleStatus === 'live')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((e: any) => ({
          name: e.handle,
          kind: '',
          color: colorForHandle(e.handle),
          status: mapStatus(e.status, e.openAsk),
          task: ''
        }));
      if (roster.length) world.setRoster(roster);
    } catch {
      /* best-effort — keep last roster on a transient miss */
    }
  }

  $effect(() => {
    const e = realtime?.lastEvent;
    if (e && (e.type === 'agent_activity' || e.type === 'message_added')) loadAgents();
  });

  onMount(() => {
    // Accessibility: respect prefers-reduced-motion — no animated overlay at all
    // for users who ask for reduced motion.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    // Terrain is measured ONCE and held stable. The previous version rebuilt it
    // on a 1.5s timer, which re-wrapped the ants to new positions every tick —
    // i.e. they teleported/strobed. Measuring once keeps them crawling smoothly.
    const m = measure();
    world = new Crawler.AntWorld({ canvas: canvasEl, inner: m.inner, blocks: m.blocks, fx: null, tip: null, panelEl: null });
    world.setScale(window.devicePixelRatio || 1);
    // Calm, ambient motion: few ants, slow, smooth (not skittery). Status
    // ambience, not a stress animation.
    world.setParams({ dark, count: 2, size: 30, speed: 22, gait: 'smooth', mode: 'wander', color: 'ink', eyeGlow: true });
    teardown = () => { world._stopped = true; };

    loadAgents();
    realtime = subscribeToRoomEvents(roomId, { onConnect: () => loadAgents() });
    pollTimer = setInterval(loadAgents, 30000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    realtime?.close();
    teardown?.();
  });
</script>

<div class="ant-overlay" bind:this={containerEl} aria-hidden="true">
  <canvas class="ant-overlay-canvas" bind:this={canvasEl}></canvas>
</div>

<style>
  .ant-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none; /* never block the real UI */
    overflow: hidden;
    z-index: 14; /* above messages, below the sticky composer dock (z-20) */
  }
  .ant-overlay-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
