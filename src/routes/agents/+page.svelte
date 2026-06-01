<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import AgentDot from '$lib/components/AgentDot.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import UsageStrip from '$lib/components/UsageStrip.svelte';
  import UsageBadge from '$lib/components/UsageBadge.svelte';
  import type { UsagePayload } from '$lib/usage/types';

  let { data }: { data: PageData } = $props();

  // Shared UsagePayload pulled at the page level so the strip + every
  // per-card UsageBadge work off one snapshot (avoids N parallel
  // /api/usage fetches). Refreshes every 30 s to match the proxy
  // cache TTL. Handles are used as the agentKind for the loose
  // substring match — e.g. "@claudev4" → claude, "@speedycodex" → codex.
  let pageUsage = $state<UsagePayload | null>(null);
  let usagePollHandle: ReturnType<typeof setInterval> | null = null;

  async function refreshUsage(): Promise<void> {
    try {
      const response = await fetch('/api/usage', { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      pageUsage = (await response.json()) as UsagePayload;
    } catch {
      // Strip handles the empty / error case.
    }
  }

  onMount(() => {
    void refreshUsage();
    usagePollHandle = setInterval(() => void refreshUsage(), 30_000);
  });

  onDestroy(() => {
    if (usagePollHandle !== null) clearInterval(usagePollHandle);
  });

  const agents = $derived(data.agents ?? []);
  let selectedHandle = $state<string | null>(null);
  let timelineCache = $state<Record<string, any[]>>({});
  let timelineLoading = $state<Record<string, boolean>>({});
  let timelineHasMore = $state<Record<string, boolean>>({});
  let timelineNext = $state<Record<string, number|null>>({});
  const selectedAgent = $derived(agents.find(a => a.handle === selectedHandle) ?? null);

  async function loadTimeline(handle: string, before?: number) {
    if (timelineLoading[handle]) return;
    timelineLoading[handle] = true;
    try {
      const url = before
        ? `/api/agents/${encodeURIComponent(handle)}/timeline?limit=20&before=${before}`
        : `/api/agents/${encodeURIComponent(handle)}/timeline?limit=20`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      const d = await res.json();
      const existing = timelineCache[handle] ?? [];
      const merged = before ? [...existing, ...d.entries] : d.entries;
      timelineCache[handle] = merged;
      timelineHasMore[handle] = d.hasMore;
      timelineNext[handle] = d.nextBefore;
    } catch {}
    timelineLoading[handle] = false;
  }

  // Availability-return digest (JWPK msg_x1rkogssez task rover-availability):
  // when an agent is selected, fetch the missed-message digest so JWPK can
  // see at-a-glance what @-tags went un-acted-on during the agent's most-
  // recent idle window. Endpoint shipped earlier today — closes UI half.
  type MissedMessage = {
    messageId: string;
    roomId: string;
    roomName: string;
    authorHandle: string;
    authorDisplayName: string;
    postedAt: string;
    bodyPreview: string;
  };
  type AvailabilityDigest = {
    handle: string;
    terminalId: string | null;
    windowStartMs: number | null;
    windowEndMs: number;
    stillIdle: boolean;
    missed: MissedMessage[];
  };
  let digestCache = $state<Record<string, AvailabilityDigest>>({});
  let digestLoading = $state<Record<string, boolean>>({});

  async function loadAvailabilityDigest(handle: string): Promise<void> {
    if (digestLoading[handle] || digestCache[handle]) return;
    digestLoading[handle] = true;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(handle)}/availability-digest?limit=20`);
      if (!res.ok) return;
      const body = (await res.json()) as { digest?: AvailabilityDigest };
      if (body.digest) digestCache[handle] = body.digest;
    } catch { /* best-effort */ }
    digestLoading[handle] = false;
  }

  function toggleAgent(handle: string) {
    if (selectedHandle === handle) {
      selectedHandle = null;
    } else {
      selectedHandle = handle;
      if (!timelineCache[handle]) {
        loadTimeline(handle);
      }
      void loadAvailabilityDigest(handle);
    }
  }

  function statusLabel(state: string | null) {
    if (!state) return 'Unknown';
    const map: Record<string, string> = {
      idle: 'Idle', thinking: 'Thinking', working: 'Working', 'response-required': 'Response needed',
    };
    return map[state] ?? state;
  }

  function statusClass(state: string | null) {
    if (state === 'working') return 'working';
    if (state === 'thinking') return 'thinking';
    if (state === 'idle') return 'idle';
    if (state === 'response-required') return 'warn';
    return '';
  }

  function dotState(state: string | null) {
    if (state === 'working') return 'active';
    if (state === 'thinking') return 'thinking';
    if (state === 'idle') return 'idle';
    return 'idle';
  }

  function fmtDuration(ms: number | null) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}m`;
  }

  function totalTasks(t: { completed: number; inProgress: number; pending: number; blocked: number }) {
    return t.completed + t.inProgress + t.pending + t.blocked;
  }

  function agentColor(handle: string) {
    const known: Record<string, string> = {
      '@codex': '#2EBD85', '@claude': '#E07856', '@gemini': '#5B8DEF',
      '@ollama': '#F2B65A', '@copilot': '#9B6BF0', '@qwen': '#EC493A',
    };
    return known[handle] ?? '#838173';
  }

  function fmtTime(ts: number) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function maxSparkline(sparkline: number[]) {
    return Math.max(1, ...sparkline);
  }

  function heatmapOpacity(count: number, max: number) {
    if (max === 0) return 0.08;
    return 0.08 + (count / max) * 0.92;
  }

  const activeCount = $derived(agents.filter(a => a.status?.state === 'working' || a.status?.state === 'thinking').length);
  const totalRooms = $derived(new Set(agents.flatMap(a => a.rooms.map(r => r.roomId))).size);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const topAgents = $derived(agents.slice(0, 6));
</script>

<svelte:head><title>Agents — ANT Fleet</title></svelte:head>

{#snippet statusPill()}
  <span class="live-badge">
    <span class="live-dot"></span>
    {activeCount} active
  </span>
{/snippet}

<SimplePageShell eyebrow="Fleet" title="Agents." summary="A living switchboard for your AI fleet. Every card is real-time telemetry." {statusPill}>
  <UsageStrip />
  <!-- Top activity strip -->
  <Explainable explainKey="agents-activity-strip">
  <section class="activity-strip">
    {#each topAgents as agent}
      <button class="activity-chip" onclick={() => toggleAgent(agent.handle)} class:active={selectedHandle === agent.handle}>
        <AgentDot id={agent.handle.replace('@', '')} size={10} state={dotState(agent.status?.state ?? null)} />
        <span class="activity-name">{agent.displayName || agent.handle}</span>
        <span class="activity-pill {statusClass(agent.status?.state ?? null)}">{statusLabel(agent.status?.state ?? null)}</span>
        {#if agent.stats.messages24h > 0}
          <span class="activity-msgs">{agent.stats.messages24h}</span>
        {/if}
      </button>
    {/each}
  </section>
  </Explainable>

  <Explainable explainKey="agents-fleet-stats">
  <section class="fleet-stats">
    <div class="stat"><span class="stat-value">{activeCount}</span><span class="stat-label">Active Now</span></div>
    <div class="stat"><span class="stat-value">{agents.length}</span><span class="stat-label">Registered</span></div>
    <div class="stat"><span class="stat-value">{totalRooms}</span><span class="stat-label">Rooms Occupied</span></div>
  </section>
  </Explainable>

  <section class="agent-grid">
    {#each agents as agent, i}
      {@const color = agentColor(agent.handle)}
      {@const sparkMax = maxSparkline(agent.sparkline ?? [])}
      {@const heatMax = Math.max(1, ...(agent.heatmap ?? []))}
      {@const isExpanded = selectedHandle === agent.handle}
      {@const timeline = timelineCache[agent.handle] ?? []}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role — agent-card IS the click target (full-card affordance) with role=button + tabindex + keyboard handler; <article> chosen for landmark semantics over <button> to keep nested interactive children valid. -->
      <article class="agent-card" style="animation-delay: {i * 60}ms" class:expanded={isExpanded} class:focused={agent.status?.state === 'working'} onclick={() => toggleAgent(agent.handle)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleAgent(agent.handle); }}>
        <div class="interior-glow" style="background: radial-gradient(70% 90% at 50% -10%, {color}22 0%, transparent 60%);"></div>

        <div class="card-content">
          <!-- Header -->
          <div class="card-header">
            <AgentDot id={agent.handle.replace('@', '')} size={12} state={dotState(agent.status?.state ?? null)} />
            <span class="agent-name">{agent.displayName || agent.handle}</span>
            {#if agent.displayName && agent.displayName !== agent.handle}
              <span class="handle-text">{agent.handle}</span>
            {/if}
            {#if agent.streakDays && agent.streakDays > 0}
              <span class="streak-badge">🔥 {agent.streakDays}d</span>
            {/if}
            <UsageBadge agentKind={agent.handle} usage={pageUsage} />
            <span class="reaction-badge">👍 {agent.stats.positiveReactions ?? 0}</span>
            {#if agent.agentKind}
              <span class="cli-badge">{agent.agentKind}{#if agent.model} · {agent.model}{/if}</span>
            {/if}
          </div>

          <!-- Status row -->
          <div class="status-row">
            <span class="status-pill {statusClass(agent.status?.state ?? null)}">{statusLabel(agent.status?.state ?? null)}</span>
            {#if agent.status?.atMs}
              <span class="duration">⏱ {fmtDuration(agent.status.atMs)}</span>
            {/if}
            {#if agent.workspace}
              <span class="workspace">📁 {agent.workspace}</span>
            {/if}
            <!-- Quick-nav to this terminal on the management page (stopPropagation
                 so it navigates instead of toggling the card). Terminal-less
                 agents (remote/offline, no attached pty → empty sessionId) have
                 no terminal to jump to, so we label them instead of linking. -->
            {#if agent.sessionId}
              <a
                class="goto-terminal"
                href={`/terminals#term-${agent.sessionId}`}
                onclick={(e) => e.stopPropagation()}
              >go to terminal →</a>
            {:else}
              <span class="no-terminal">no local terminal</span>
            {/if}
          </div>

          <!-- Productivity score -->
          <div class="productivity-row">
            <span class="productivity-label">Productivity</span>
            <span class="productivity-score" style="color: {color};">{agent.productivityScore ?? 0}</span>
            {#if agent.deliveryRate > 0}
              <span class="delivery-pill">{agent.deliveryRate}% delivery</span>
            {/if}
          </div>

          <!-- Sparkline -->
          <div class="sparkline">
            {#each agent.sparkline ?? [] as h, i}
              <div class="spark-bar" style="height: {Math.max(2, (h / sparkMax) * 18)}px; background: {color}; opacity: {h > 0 ? 0.7 : 0.12};"></div>
            {/each}
          </div>

          <!-- 7-day heatmap -->
          <div class="heatmap">
            {#each agent.heatmap ?? [] as d, i}
              <div class="heat-cell" title="{dayLabels[i]}: {d} msgs">
                <div class="heat-fill" style="background: {color}; opacity: {heatmapOpacity(d, heatMax)};"></div>
              </div>
            {/each}
          </div>

          <!-- Rooms -->
          <div class="room-chips">
            {#each agent.rooms.slice(0, 3) as room}
              <a class="room-chip" href="/r/{room.roomId}">
                <span class="room-dot" style="background: {color};"></span>
                {room.roomName}
              </a>
            {/each}
            {#if agent.rooms.length > 3}
              <span class="room-chip muted">+{agent.rooms.length - 3} more</span>
            {/if}
          </div>

          <!-- Past rooms -->
          {#if agent.collaborators && agent.collaborators.length > 0}
            <div class="collab-row">
              <span class="collab-label">With:</span>
              {#each agent.collaborators.slice(0, 4) as c}
                <span class="collab-chip" style="border-color: {agentColor(c)}33;">
                  <span class="collab-dot" style="background: {agentColor(c)};"></span>
                  {c}
                </span>
              {/each}
              {#if agent.collaborators.length > 4}
                <span class="collab-chip muted">+{agent.collaborators.length - 4}</span>
              {/if}
            </div>
          {/if}
          {#if agent.pastRooms && agent.pastRooms.length > 0}
            <div class="past-room-chips">
              <span class="past-label">Past:</span>
              {#each agent.pastRooms.slice(0, 2) as room}
                <span class="room-chip muted">{room.roomName}</span>
              {/each}
              {#if agent.pastRooms.length > 2}
                <span class="room-chip muted">+{agent.pastRooms.length - 2}</span>
              {/if}
            </div>
          {/if}

          <!-- Achievements -->
          <div class="achievement-row">
            {#if agent.stats.tasks.completed > 0}
              <span class="achievement-pill highlight">✅ {agent.stats.tasks.completed} tasks</span>
            {/if}
            {#if agent.stats.asksPosed.open > 0}
              <span class="achievement-pill warn">❓ {agent.stats.asksPosed.open} asks</span>
            {/if}
            {#if agent.stats.plansCreated > 0}
              <span class="achievement-pill">📋 {agent.stats.plansCreated} plans</span>
            {/if}
            {#if agent.stats.messages24h > 0}
              <span class="achievement-pill">💬 {agent.stats.messages24h} msgs/24h</span>
            {/if}
          </div>

          <!-- Metrics -->
          <div class="metrics">
            <div class="metric"><span class="metric-value" style="color: {color};">{agent.stats.messages24h}</span><span class="metric-label">msgs/24h</span></div>
            <div class="metric"><span class="metric-value">{totalTasks(agent.stats.tasks)}</span><span class="metric-label">tasks</span></div>
            <div class="metric"><span class="metric-value">{agent.stats.runEvents24h}</span><span class="metric-label">events/24h</span></div>
          </div>

          <!-- Expandable Timeline -->
          {#if isExpanded}
            <div class="timeline">
              <div class="timeline-header">
                <span class="timeline-title">Activity Stream</span>
                <span class="timeline-count">{timeline.length} events {timelineLoading[agent.handle] ? '…' : ''}</span>
              </div>
              <div class="timeline-list">
                {#each timeline as event}
                  <div class="timeline-row">
                    <span class="timeline-time">{fmtTime(event.ts)}</span>
                    <span class="timeline-type {event.type}">{event.type}</span>
                    {#if event.roomName}
                      <span class="timeline-room">#{event.roomName}</span>
                    {/if}
                    <span class="timeline-summary">{event.summary}</span>
                  </div>
                {/each}
              </div>
              {#if timelineHasMore[agent.handle]}
                <button class="load-more" onclick={(e) => { e.stopPropagation(); loadTimeline(agent.handle, timelineNext[agent.handle] ?? undefined); }}>
                  Load more
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </article>
    {/each}
  </section>

  <!-- Full-screen focus overlay -->
  {#if selectedAgent}
    <!-- Backdrop click-to-dismiss is supplementary; primary dismiss is the visible close button (✕) inside, and Esc handling lives on a document-level keyboard handler. Adding role/keyboard handler to the backdrop would make it focusable and trap tab order. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="focus-overlay" onclick={() => selectedHandle = null}>
      <!-- stopPropagation wrapper, no semantic interactivity of its own. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="focus-card" onclick={(e) => e.stopPropagation()}>
        <div class="focus-glow" style="background: radial-gradient(60% 80% at 50% 0%, {agentColor(selectedAgent.handle)}33 0%, transparent 70%);"></div>
        <div class="focus-content">
          <div class="focus-header">
            <AgentDot id={selectedAgent.handle.replace('@', '')} size={16} state={dotState(selectedAgent.status?.state ?? null)} />
            <span class="focus-name">{selectedAgent.displayName || selectedAgent.handle}</span>
            <span class="focus-status-pill {statusClass(selectedAgent.status?.state ?? null)}">{statusLabel(selectedAgent.status?.state ?? null)}</span>
            <button class="focus-close" onclick={() => selectedHandle = null}>✕</button>
          </div>
          <div class="focus-stats">
            <div class="focus-stat"><span class="focus-stat-value" style="color: {agentColor(selectedAgent.handle)};">{selectedAgent.productivityScore ?? 0}</span><span class="focus-stat-label">Productivity</span></div>
            <div class="focus-stat"><span class="focus-stat-value">{selectedAgent.stats.messages24h}</span><span class="focus-stat-label">Msgs/24h</span></div>
            <div class="focus-stat"><span class="focus-stat-value">{totalTasks(selectedAgent.stats.tasks)}</span><span class="focus-stat-label">Tasks</span></div>
            <div class="focus-stat"><span class="focus-stat-value">{selectedAgent.stats.runEvents24h}</span><span class="focus-stat-label">Events</span></div>
            <div class="focus-stat"><span class="focus-stat-value">{selectedAgent.collaborators?.length ?? 0}</span><span class="focus-stat-label">Collaborators</span></div>
          </div>
          {#if digestCache[selectedAgent.handle]}
            {@const digest = digestCache[selectedAgent.handle]}
          {#if digest.missed.length > 0 || digest.stillIdle}
            <div class="missed-banner" class:missed-banner-warn={digest.missed.length > 0}>
              <header class="missed-header">
                <strong>
                  {#if digest.stillIdle}
                    Currently idle —
                  {:else}
                    Just returned —
                  {/if}
                  {digest.missed.length}
                  message{digest.missed.length === 1 ? '' : 's'} missed
                </strong>
                {#if digest.missed.length > 0}
                  <span class="missed-sub">bare @-mentions while away (strict-contract; bracketed/@everyone/plain excluded)</span>
                {/if}
              </header>
              {#if digest.missed.length > 0}
                <ul class="missed-list">
                  {#each digest.missed.slice(0, 6) as miss (miss.messageId)}
                    <li>
                      <a href={`/rooms/${miss.roomId}#${miss.messageId}`}>
                        <span class="missed-room">#{miss.roomName}</span>
                        <span class="missed-author">{miss.authorDisplayName || miss.authorHandle}</span>
                        <span class="missed-body">{miss.bodyPreview}</span>
                      </a>
                    </li>
                  {/each}
                  {#if digest.missed.length > 6}
                    <li class="missed-overflow">+{digest.missed.length - 6} more</li>
                  {/if}
                </ul>
              {/if}
            </div>
          {/if}
          {/if}

          <div class="focus-timeline">
            <div class="timeline-header">
              <span class="timeline-title">Activity Stream</span>
            </div>
            <div class="timeline-list" style="max-height: 400px;">
              {#each (timelineCache[selectedAgent.handle] ?? []) as event}
                <div class="timeline-row">
                  <span class="timeline-time">{fmtTime(event.ts)}</span>
                  <span class="timeline-type {event.type}">{event.type}</span>
                  {#if event.roomName}<span class="timeline-room">#{event.roomName}</span>{/if}
                  <span class="timeline-summary">{event.summary}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</SimplePageShell>

<style>
  .live-badge { display: inline-flex; align-items: center; gap: 6px; font-family: ui-monospace, monospace; font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(26, 194, 112, 0.1); border: 0.5px solid rgba(26, 194, 112, 0.25); color: var(--ok); }
  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); animation: breathe 2.4s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.1); } }

  .activity-strip { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
  .activity-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; background: var(--surface-raised); border: 1px solid var(--line-soft); color: var(--ink-soft); font-size: 11px; cursor: pointer; transition: all 180ms ease; white-space: nowrap; flex-shrink: 0; }
  .activity-chip:hover { background: var(--surface-app); transform: translateY(-1px); }
  .activity-chip.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface-raised)); }
  .activity-name { font-weight: 600; }
  .activity-pill { font-family: ui-monospace, monospace; font-size: 9px; padding: 1px 5px; border-radius: 3px; background: var(--surface-card); border: 0.5px solid var(--line-soft); }
  .activity-pill.working { background: rgba(26, 194, 112, 0.1); border-color: rgba(26, 194, 112, 0.25); color: var(--ok); }
  .activity-pill.thinking { background: rgba(10, 133, 240, 0.1); border-color: rgba(10, 133, 240, 0.25); color: var(--info); }
  .activity-pill.warn { background: rgba(255, 179, 0, 0.1); border-color: rgba(255, 179, 0, 0.25); color: var(--warn); }
  .activity-pill.idle { background: rgba(0,0,0,0.03); color: var(--ink-muted); }
  .activity-msgs { font-family: ui-monospace, monospace; font-size: 9px; color: var(--ink-muted); margin-left: 2px; }

  .fleet-stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; padding: 1.2rem 1.5rem; background: var(--surface-raised); border: 1px solid var(--line-soft); border-radius: 12px; }
  .stat { display: flex; flex-direction: column; gap: 0.2rem; }
  .stat-value { font-size: 1.6rem; font-weight: 800; color: var(--ink-strong); line-height: 1; }
  .stat-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-muted); font-weight: 600; }
  .agent-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .agent-card { position: relative; opacity: 0; animation: cardEnter 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards; background: var(--surface-card); border: 1px solid var(--line-soft); border-radius: 12px; padding: 14px 16px 12px; overflow: hidden; transition: transform 180ms ease, box-shadow 220ms ease; cursor: pointer; }
  .agent-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-card); }
  .agent-card.expanded { grid-column: span 2; box-shadow: var(--shadow-card); }
  .agent-card.focused { border-color: rgba(26, 194, 112, 0.35); box-shadow: 0 0 0 1px rgba(26, 194, 112, 0.15), var(--shadow-card); }
  .interior-glow { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0.8; transition: opacity 260ms ease; }
  .agent-card:hover .interior-glow { opacity: 1; }
  .card-content { position: relative; z-index: 1; }
  .card-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .agent-name { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
  .handle-text { font-family: ui-monospace, monospace; font-size: 10px; color: var(--ink-muted); margin-left: auto; }
  .streak-badge { font-family: ui-monospace, monospace; font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(255, 107, 0, 0.1); border: 0.5px solid rgba(255, 107, 0, 0.25); color: #FF6B00; margin-left: auto; }
  .reaction-badge { font-family: ui-monospace, monospace; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(26, 194, 112, 0.1); border: 0.5px solid rgba(26, 194, 112, 0.25); color: var(--ok); }
  /* CLI + model tag — e.g. "claude · opus-4.8" / "codex". */
  .cli-badge { font-family: ui-monospace, monospace; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--surface-raised); border: 0.5px solid var(--line-soft); color: var(--ink-muted); text-transform: lowercase; }
  /* Quick-nav to this terminal on the management page. */
  .goto-terminal { margin-left: auto; font-size: 10px; font-weight: 600; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .goto-terminal:hover { text-decoration: underline; }
  .no-terminal { margin-left: auto; font-size: 10px; font-weight: 600; color: var(--muted); white-space: nowrap; opacity: 0.7; }
  .status-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; flex-wrap: wrap; }
  .status-pill { font-family: ui-monospace, monospace; font-size: 10.5px; padding: 2px 7px; border-radius: 4px; background: var(--surface-raised); border: 0.5px solid var(--line-soft); color: var(--ink-soft); white-space: nowrap; }
  .status-pill.working { background: rgba(26, 194, 112, 0.1); border-color: rgba(26, 194, 112, 0.25); color: var(--ok); }
  .status-pill.thinking { background: rgba(10, 133, 240, 0.1); border-color: rgba(10, 133, 240, 0.25); color: var(--info); }
  .status-pill.warn { background: rgba(255, 179, 0, 0.1); border-color: rgba(255, 179, 0, 0.25); color: var(--warn); }
  .status-pill.idle { background: rgba(0,0,0,0.03); border-color: var(--line-soft); color: var(--ink-muted); }
  .duration { font-family: ui-monospace, monospace; font-size: 10px; color: var(--ink-muted); }
  .workspace { font-family: ui-monospace, monospace; font-size: 10px; color: var(--ink-muted); background: var(--surface-raised); padding: 1px 6px; border-radius: 3px; border: 0.5px solid var(--line-soft); }

  .productivity-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .productivity-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted); font-weight: 600; }
  .productivity-score { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 800; }
  .delivery-pill { font-family: ui-monospace, monospace; font-size: 9px; padding: 1px 5px; border-radius: 3px; background: var(--surface-raised); border: 0.5px solid var(--line-soft); color: var(--ink-muted); }

  .sparkline { display: flex; align-items: flex-end; gap: 2px; height: 20px; margin-bottom: 0.5rem; padding: 2px 0; }
  .spark-bar { flex: 1; min-width: 2px; border-radius: 1px; transition: height 300ms ease; }
  .heatmap { display: flex; gap: 3px; margin-bottom: 0.5rem; }
  .heat-cell { width: 14px; height: 14px; border-radius: 3px; background: var(--surface-raised); border: 0.5px solid var(--line-soft); overflow: hidden; }
  .heat-fill { width: 100%; height: 100%; border-radius: inherit; }
  .room-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.35rem; }
  .past-room-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; align-items: center; }
  .past-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted); font-weight: 600; }
  .room-chip { display: inline-flex; align-items: center; gap: 0.3rem; font-family: ui-monospace, monospace; font-size: 10px; padding: 2px 8px; border-radius: 999px; background: var(--surface-raised); border: 1px solid var(--line-soft); color: var(--ink-soft); text-decoration: none; transition: all 180ms ease; }
  .room-chip:hover { background: var(--surface-app); transform: translateY(-1px); }
  .room-chip.muted { color: var(--ink-muted); background: transparent; border-color: transparent; }
  .room-dot { width: 5px; height: 5px; border-radius: 50%; }
  .achievement-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; }
  .achievement-pill { display: inline-flex; align-items: center; gap: 0.25rem; font-family: ui-monospace, monospace; font-size: 9px; padding: 2px 6px; border-radius: 3px; background: var(--surface-raised); border: 0.5px solid var(--line-soft); color: var(--ink-muted); }
  .achievement-pill.highlight { background: rgba(26, 194, 112, 0.08); border-color: rgba(26, 194, 112, 0.2); color: var(--ok); }
  .achievement-pill.warn { background: rgba(255, 179, 0, 0.08); border-color: rgba(255, 179, 0, 0.2); color: var(--warn); }
  .metrics { display: flex; gap: 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--line-soft); }
  .metric { display: flex; flex-direction: column; }
  .metric-value { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 700; }
  .metric-label { font-size: 9px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .timeline { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--line-soft); }
  .timeline-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .timeline-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-strong); }
  .timeline-count { font-family: ui-monospace, monospace; font-size: 10px; color: var(--ink-muted); }
  .timeline-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 320px; overflow-y: auto; padding-right: 4px; }
  .timeline-row { display: grid; grid-template-columns: 70px 50px 1fr; gap: 0.5rem; align-items: center; font-size: 10.5px; padding: 3px 6px; border-radius: 4px; background: var(--surface-raised); }
  .timeline-time { font-family: ui-monospace, monospace; color: var(--ink-muted); font-size: 10px; }
  .timeline-type { font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; padding: 1px 4px; border-radius: 3px; text-align: center; font-weight: 600; }
  .timeline-type.message { background: rgba(10, 133, 240, 0.1); color: var(--info); }
  .timeline-type.ask { background: rgba(255, 179, 0, 0.1); color: var(--warn); }
  .timeline-type.answer { background: rgba(26, 194, 112, 0.1); color: var(--ok); }
  .timeline-type.event { background: rgba(0,0,0,0.05); color: var(--ink-muted); }
  .timeline-type.task { background: rgba(155, 107, 240, 0.1); color: #9B6BF0; }
  .timeline-type.plan { background: rgba(226, 182, 90, 0.1); color: #D97706; }
  .timeline-room { font-family: ui-monospace, monospace; font-size: 9px; color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .timeline-summary { color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .load-more { width: 100%; margin-top: 0.5rem; padding: 6px; border-radius: 6px; border: 1px solid var(--line-soft); background: var(--surface-raised); color: var(--ink-soft); font-family: ui-monospace, monospace; font-size: 11px; cursor: pointer; transition: all 180ms ease; }
  .collab-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; align-items: center; }
  .collab-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted); font-weight: 600; }
  .collab-chip { display: inline-flex; align-items: center; gap: 0.3rem; font-family: ui-monospace, monospace; font-size: 9px; padding: 1px 6px; border-radius: 999px; background: var(--surface-raised); border: 1px solid var(--line-soft); color: var(--ink-soft); }
  .collab-dot { width: 5px; height: 5px; border-radius: 50%; }
  .load-more:hover { background: var(--surface-app); border-color: var(--accent); }

  .focus-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 260ms ease; }
  .focus-card { position: relative; width: 90%; max-width: 720px; max-height: 85vh; overflow-y: auto; background: var(--surface-card); border: 1px solid var(--line-soft); border-radius: 16px; padding: 24px; animation: scaleIn 300ms cubic-bezier(0.22, 1, 0.36, 1); }
  .focus-glow { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
  .focus-content { position: relative; z-index: 1; }
  .focus-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; }
  .focus-name { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.02em; }
  .focus-close { margin-left: auto; width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line-soft); background: var(--surface-raised); color: var(--ink-soft); font-size: 14px; cursor: pointer; transition: all 180ms ease; }
  .focus-close:hover { background: var(--surface-app); border-color: var(--accent); }
  .focus-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 1.5rem; padding: 1rem; background: var(--surface-raised); border-radius: 10px; border: 1px solid var(--line-soft); }
  .focus-stat { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
  .focus-stat-value { font-family: ui-monospace, monospace; font-size: 1.4rem; font-weight: 800; }
  .focus-stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-muted); font-weight: 600; }
  .focus-timeline { margin-top: 0.5rem; }
  /* Availability-return digest banner — shown when the selected agent's
     terminal is currently idle OR just woke and has missed bare-@-tags.
     Surfaces 'what didn't get picked up' so JWPK can see acted-on gaps
     without leaving /agents. JWPK msg_x1rkogssez. */
  .missed-banner {
    margin: 0.7rem 0;
    padding: 0.7rem 0.95rem;
    border-radius: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--line-soft);
    color: var(--ink-strong);
  }
  .missed-banner-warn {
    border-color: color-mix(in srgb, var(--warn) 35%, var(--line-soft));
    background: color-mix(in srgb, var(--warn) 6%, var(--surface-raised));
  }
  .missed-header { display: flex; flex-direction: column; gap: 0.15rem; margin-bottom: 0.5rem; }
  .missed-header strong { font-size: 0.92rem; }
  .missed-sub { color: var(--ink-soft); font-size: 0.74rem; font-weight: 500; }
  .missed-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .missed-list li a {
    display: grid;
    grid-template-columns: minmax(6rem, auto) minmax(6rem, auto) 1fr;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    text-decoration: none;
    color: var(--ink-strong);
    font-size: 0.82rem;
  }
  .missed-list li a:hover { border-color: var(--accent); }
  .missed-room { color: var(--info, #2563eb); font-family: ui-monospace, monospace; font-size: 0.74rem; }
  .missed-author { color: var(--ink-soft); font-weight: 700; font-size: 0.78rem; }
  .missed-body { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .missed-overflow { color: var(--ink-muted); font-size: 0.78rem; font-style: italic; padding: 0.25rem 0.5rem; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes cardEnter {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (max-width: 900px) {
    .agent-grid { grid-template-columns: repeat(2, 1fr); }
    .agent-card.expanded { grid-column: span 2; }
  }
  @media (max-width: 600px) {
    .agent-grid { grid-template-columns: 1fr; }
    .agent-card.expanded { grid-column: span 1; }
    .fleet-stats { gap: 1rem; flex-wrap: wrap; }
    .timeline-row { grid-template-columns: 60px 45px 1fr; }
  }
</style>
