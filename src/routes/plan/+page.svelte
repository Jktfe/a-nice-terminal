<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import PlanView from '$lib/components/PlanView/PlanView.svelte';
  import { samplePlanEvents } from '$lib/components/PlanView/_fixture';
  import type {
    PlanEvent,
    PlanEventPayload,
  } from '$lib/components/PlanView/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let mode: 'dark' | 'light' = $state('light');

  // Events that arrived via the WS subscription after the SSR load. Combined
  // with data.events at render time and re-deduped by identity (latest ts_ms
  // wins), mirroring the server projector's dedupePlanEvents.
  let liveEvents: PlanEvent[] = $state([]);
  let liveError: string | null = $state(null);
  let saving = $state(false);
  let saveError: string | null = $state(null);

  const PLAN_KINDS = new Set([
    'plan_section',
    'plan_decision',
    'plan_milestone',
    'plan_acceptance',
    'plan_test',
  ]);

  function slug(value: string | undefined | null): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function planEventIdentity(ev: PlanEvent): string {
    const p = ev.payload;
    switch (ev.kind) {
      case 'plan_section':
        return `section:${p.acceptance_id || slug(p.title)}`;
      case 'plan_milestone':
        return `milestone:${p.milestone_id || slug(p.title)}`;
      case 'plan_acceptance':
        return `acceptance:${p.milestone_id ?? ''}:${p.acceptance_id || slug(p.title)}`;
      case 'plan_test':
        return `test:${p.milestone_id ?? ''}:${slug(p.title) || `o${p.order}`}`;
      case 'plan_decision':
        return `decision:${p.parent_id ?? ''}:${slug(p.title) || `o${p.order}`}`;
      default:
        return `evt:${ev.id}`;
    }
  }

  function dedupePlanEvents(events: PlanEvent[]): PlanEvent[] {
    const latest = new Map<string, PlanEvent>();
    for (const ev of events) {
      const key = planEventIdentity(ev);
      const prev = latest.get(key);
      const evTs = ev.ts_ms ?? ev.ts ?? 0;
      const prevTs = (prev?.ts_ms ?? prev?.ts) ?? 0;
      if (!prev || evTs > prevTs) latest.set(key, ev);
    }
    return Array.from(latest.values());
  }

  // Filter live events down to the currently-loaded plan so a switch in plan
  // doesn't carry over stale rows from the previous selection.
  const liveForPlan = $derived(
    liveEvents.filter(
      (e) =>
        e.payload?.plan_id === data.plan_id &&
        e.session_id === data.session_id,
    ),
  );

  const combinedEvents = $derived(
    dedupePlanEvents([...data.events, ...liveForPlan]),
  );

  const events = $derived(
    combinedEvents.length ? combinedEvents : samplePlanEvents,
  );
  const isLive = $derived(
    (data.source === 'live' && combinedEvents.length > 0) ||
      liveForPlan.length > 0,
  );
  const selectedPlanKey = $derived(
    data.session_id && data.plan_id
      ? `${data.session_id}::${data.plan_id}`
      : '',
  );
  const subtitle = $derived(
    isLive
      ? `Live run_events · ${data.plan_id} · ${combinedEvents.length} events${liveForPlan.length ? ` (+${liveForPlan.length} live)` : ''}`
      : 'Sample plan fixture · waiting for live plan_* events',
  );

  function selectPlan(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) {
      goto('/plan');
      return;
    }
    const [sessionId, planId] = value.split('::');
    // Switching plans replays SSR — drop any live overlay so we don't keep
    // stale entries from the previous plan in the merged view.
    liveEvents = [];
    goto(
      `/plan?session_id=${encodeURIComponent(sessionId)}&plan_id=${encodeURIComponent(planId)}`,
    );
  }

  onMount(() => {
    document.body.classList.add('plan-view-page');
    const html = document.documentElement;
    const previousTheme = html.getAttribute('data-theme');
    return () => {
      document.body.classList.remove('plan-view-page');
      if (previousTheme === null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', previousTheme);
    };
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (mode === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
  });

  // Live monitor — open WS for the SSR-resolved session_id and listen for
  // run_event_created envelopes whose kind starts with plan_*. The server
  // emits these from /api/plan/events POST/PATCH and from any other source
  // that calls broadcast() with this envelope shape.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const sessionId = data.session_id;
    if (!sessionId) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let destroyed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      try {
        ws = new WebSocket(`${protocol}//${location.host}/ws`);
      } catch (err) {
        liveError = `WebSocket open failed: ${(err as Error)?.message ?? err}`;
        return;
      }

      ws.onopen = () => {
        liveError = null;
        ws?.send(JSON.stringify({ type: 'join_session', sessionId }));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== 'run_event_created') return;
          if (msg.sessionId && msg.sessionId !== sessionId) return;
          const ev = msg.event;
          if (!ev || !PLAN_KINDS.has(ev.kind)) return;
          // Only accept events for the loaded plan; the projector key uses
          // session_id + plan_id together.
          if (ev?.payload?.plan_id !== data.plan_id) return;
          // Append to liveEvents — combinedEvents will re-dedupe.
          liveEvents = [...liveEvents, ev as PlanEvent];
        } catch {
          /* ignore non-JSON heartbeat frames */
        }
      };
      ws.onerror = () => {
        liveError = 'Live monitor connection error — retrying.';
      };
      ws.onclose = () => {
        if (destroyed) return;
        retry = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      destroyed = true;
      if (retry) clearTimeout(retry);
      try {
        ws?.close();
      } catch {
        /* swallow */
      }
    };
  });

  // Inline edit handlers — POST/PATCH to the new endpoints; the WS roundtrip
  // delivers the row back into liveEvents so we don't optimistically render.
  async function postPlanEvent(body: {
    kind: string;
    payload: PlanEventPayload;
    text?: string;
  }) {
    if (!data.session_id) {
      saveError = 'No session selected — cannot write plan events.';
      return;
    }
    saving = true;
    saveError = null;
    try {
      const res = await fetch('/api/plan/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: data.session_id, ...body }),
      });
      if (!res.ok) {
        const text = await res.text();
        saveError = `POST failed: ${res.status} ${text.slice(0, 200)}`;
      }
    } catch (err) {
      saveError = `POST error: ${(err as Error)?.message ?? err}`;
    } finally {
      saving = false;
    }
  }

  async function patchPlanEvent(
    eventId: string,
    body: Partial<PlanEventPayload> & { done?: boolean; text?: string },
  ) {
    saving = true;
    saveError = null;
    try {
      const res = await fetch(
        `/api/plan/events/${encodeURIComponent(eventId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        saveError = `PATCH failed: ${res.status} ${text.slice(0, 200)}`;
      }
    } catch (err) {
      saveError = `PATCH error: ${(err as Error)?.message ?? err}`;
    } finally {
      saving = false;
    }
  }

  function handleRename(ev: PlanEvent, nextTitle: string) {
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === ev.payload.title) return;
    return patchPlanEvent(ev.id, { title: trimmed, text: trimmed });
  }

  function handleToggleDone(ev: PlanEvent) {
    const isDone =
      ev.payload.status === 'done' || ev.payload.status === 'passing';
    return patchPlanEvent(ev.id, { done: !isDone });
  }

  function handleAddMilestone(section: PlanEvent) {
    const planId = section.payload.plan_id ?? data.plan_id;
    if (!planId) {
      saveError = 'Cannot add milestone — plan_id missing.';
      return;
    }
    const titleInput = prompt('New milestone title');
    if (!titleInput?.trim()) return;
    const title = titleInput.trim();
    const id = `m-${slug(title) || Date.now().toString(36)}`;
    return postPlanEvent({
      kind: 'plan_milestone',
      payload: {
        plan_id: planId,
        parent_id: section.payload.acceptance_id || slug(section.payload.title),
        title,
        order: 999,
        status: 'planned',
        milestone_id: id,
      },
      text: title,
    });
  }

  function handleAddDecision(section: PlanEvent) {
    const planId = section.payload.plan_id ?? data.plan_id;
    if (!planId) {
      saveError = 'Cannot add decision — plan_id missing.';
      return;
    }
    const titleInput = prompt('New decision title');
    if (!titleInput?.trim()) return;
    const title = titleInput.trim();
    return postPlanEvent({
      kind: 'plan_decision',
      payload: {
        plan_id: planId,
        parent_id: section.payload.acceptance_id || slug(section.payload.title),
        title,
        order: 999,
      },
      text: title,
    });
  }

  function handleAddSection() {
    const planId = data.plan_id;
    if (!planId) {
      saveError = 'Cannot add section — no plan_id loaded.';
      return;
    }
    const titleInput = prompt('New section title');
    if (!titleInput?.trim()) return;
    const title = titleInput.trim();
    return postPlanEvent({
      kind: 'plan_section',
      payload: {
        plan_id: planId,
        title,
        order: 999,
        acceptance_id: `sec-${slug(title) || Date.now().toString(36)}`,
      },
      text: title,
    });
  }
</script>

<svelte:head>
  <title>ANT · Plan</title>
</svelte:head>

<div class="mode-toggle" role="group" aria-label="Plan theme">
  <button
    type="button"
    class:active={mode === 'light'}
    aria-pressed={mode === 'light'}
    onclick={() => (mode = 'light')}>Light</button
  >
  <button
    type="button"
    class:active={mode === 'dark'}
    aria-pressed={mode === 'dark'}
    onclick={() => (mode = 'dark')}>Dark</button
  >
</div>

<div class="plan-source" data-live={isLive}>
  <span class="plan-source-dot"></span>
  <span>{isLive ? 'Live' : 'Sample'}</span>
  {#if data.plans.length}
    <select
      aria-label="Select plan"
      value={selectedPlanKey}
      onchange={selectPlan}
    >
      {#each data.plans as plan}
        <option value={`${plan.session_id}::${plan.plan_id}`}>
          {plan.plan_id} · {plan.event_count}
        </option>
      {/each}
    </select>
  {/if}
  {#if data.session_id}
    <button
      type="button"
      class="plan-source-add"
      onclick={handleAddSection}
      disabled={saving}
      title="Add section">+ section</button
    >
  {/if}
  {#if liveError}
    <span class="plan-source-warn" title={liveError}>· offline</span>
  {/if}
  {#if saveError}
    <span class="plan-source-warn" title={saveError}>· error</span>
  {/if}
</div>

<PlanView
  {events}
  themeMode={mode}
  {subtitle}
  editable={Boolean(data.session_id)}
  onRenameEvent={handleRename}
  onToggleDone={handleToggleDone}
  onAddMilestone={handleAddMilestone}
  onAddDecision={handleAddDecision}
/>

<style>
  .mode-toggle {
    position: fixed;
    top: 18px;
    right: 18px;
    z-index: 50;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(12px);
  }
  .mode-toggle button {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    background: transparent;
    color: #4b5563;
    border: 0;
    border-radius: 6px;
    padding: 5px 9px;
    cursor: pointer;
    line-height: 1;
  }
  .mode-toggle button.active {
    background: #111827;
    color: #fff;
  }

  .plan-source {
    position: fixed;
    top: 18px;
    left: 18px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(460px, calc(100vw - 132px));
    min-height: 28px;
    padding: 4px 10px;
    border: 0.5px solid currentColor;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.04);
    color: inherit;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-transform: uppercase;
    opacity: 0.72;
  }
  .plan-source:hover,
  .plan-source:focus-within {
    opacity: 1;
  }
  .plan-source-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #ef4444;
    flex: 0 0 auto;
  }
  .plan-source[data-live='true'] .plan-source-dot {
    background: #34d399;
  }
  .plan-source select {
    min-width: 0;
    max-width: 320px;
    height: 20px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-transform: none;
    outline: none;
  }
  .plan-source-add {
    border: 0.5px solid currentColor;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    text-transform: none;
    opacity: 0.85;
  }
  .plan-source-add:hover:not(:disabled) {
    opacity: 1;
  }
  .plan-source-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .plan-source-warn {
    color: #ef4444;
    text-transform: none;
    cursor: help;
  }
  @media (max-width: 560px) {
    .mode-toggle {
      top: 12px;
      right: 12px;
    }
    .plan-source {
      top: 54px;
      max-width: calc(100vw - 36px);
    }
    .plan-source select {
      max-width: 210px;
    }
  }

  :global(body.plan-view-page) {
    overflow: auto;
  }
</style>
