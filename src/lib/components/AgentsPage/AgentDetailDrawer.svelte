<script lang="ts">
  import { onMount } from 'svelte';
  import AgentDot from '$lib/components/AgentDot.svelte';

  interface TimelineEntry {
    ts: number;
    type: string;
    summary: string;
    sessionId?: string;
    roomId?: string;
  }

  interface RoomActivity {
    roomId: string;
    roomName: string;
    messageCount: number;
    lastActivity: number | null;
    attentionState: string | null;
    role: string;
  }

  interface Agent {
    name: string;
    tier: 1 | 2 | 3;
    available: boolean;
    currentStatus: {
      model?: string;
      contextUsedPct?: number;
      state: string;
      stateLabel?: string;
      activity?: string;
      workspace?: string;
      sessionDurationMs?: number;
      permissionMode?: string;
      hookFreshness: 'live' | 'stale' | 'absent';
    } | null;
    stats: {
      messagesSent24h: number;
      messagesReceived24h: number;
      positiveReactions: number;
      asksPosed: number;
      asksAnswered: number;
      asksOpen: number;
      tasksCompleted: number;
      tasksInProgress: number;
      plansCreated: number;
      totalSessions: number;
      activeSessions: number;
      totalRooms: number;
    };
    rooms: RoomActivity[];
    mostActiveRooms: RoomActivity[];
    timeline: TimelineEntry[];
  }

  let { agent, onClose }: { agent: Agent; onClose: () => void } = $props();
  let timeline = $state<TimelineEntry[]>(agent.timeline || []);
  let isLoading = $state(false);
  let hasMore = $state(true);
  let showHistorical = $state(false);

  onMount(async () => {
    // Load extended timeline from the per-agent endpoint
    await loadTimeline();
  });

  async function loadTimeline() {
    isLoading = true;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/timeline?limit=100`);
      if (res.ok) {
        const data = await res.json();
        timeline = data.timeline || [];
        hasMore = data.hasMore || false;
      }
    } catch (err) {
      console.error('Failed to load timeline:', err);
    } finally {
      isLoading = false;
    }
  }

  async function loadMore() {
    if (!hasMore || isLoading) return;
    isLoading = true;
    try {
      const lastTs = timeline.length > 0 ? timeline[timeline.length - 1].ts : undefined;
      const params = new URLSearchParams({ limit: '50' });
      if (lastTs) params.set('before', new Date(lastTs).toISOString());
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/timeline?${params}`);
      if (res.ok) {
        const data = await res.json();
        const newEntries = (data.timeline || []).filter(
          (e: TimelineEntry) => !timeline.some(t => t.ts === e.ts && t.type === e.type)
        );
        timeline = [...timeline, ...newEntries];
        hasMore = data.hasMore || false;
      }
    } catch (err) {
      console.error('Failed to load more timeline:', err);
    } finally {
      isLoading = false;
    }
  }

  function formatTime(ts: number): string {
    if (!ts) return 'unknown';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }

  function getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'message': '\uD83D\uDCAC',
      'ask_posed': '\u2753',
      'ask_answered': '\u2705',
      'task_completed': '\uD83C\uDFAF',
      'task_started': '\u25B6',
      'plan_created': '\uD83D\uDCCB',
      'reaction_received': '\uD83D\uDC4D',
      'permission': '\uD83D\uDD13',
      'file_edit': '\uD83D\uDCDD',
      'room_join': '\uD83D\uDEAA',
    };
    return icons[type] || '\u2022';
  }

  function getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      'message': 'var(--agent-color, #F2B65A)',
      'ask_posed': 'var(--amber-400)',
      'ask_answered': 'var(--emerald-400)',
      'task_completed': 'var(--blue-400, #5A93F7)',
      'task_started': 'var(--blue-400, #5A93F7)',
      'plan_created': '#B896F5',
      'reaction_received': 'var(--amber-400)',
      'permission': '#FB923C',
      'file_edit': 'var(--text-muted)',
      'room_join': 'var(--text-faint)',
    };
    return colors[type] || 'var(--text-faint)';
  }

  function formatDuration(ms?: number): string {
    if (!ms) return '0m';
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  const currentRooms = $derived(agent.rooms.filter(r => r.attentionState === 'focused' || r.attentionState === 'available'));
  const historicalRooms = $derived(agent.rooms.filter(r => r.attentionState !== 'focused' && r.attentionState !== 'available'));
</script>

<svelte:window onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="drawer-overlay" onclick={onClose} role="presentation">
  <div class="drawer" onclick={(e: Event) => e.stopPropagation()} role="dialog" aria-label="{agent.name} details" tabindex={-1}>
    <!-- Header -->
    <div class="drawer-header">
      <AgentDot id={agent.name} size={16} state={agent.currentStatus?.stateLabel === 'Working' ? 'active' : agent.currentStatus?.stateLabel === 'Permission' ? 'thinking' : agent.available ? 'idle' : 'offline'} ring={true} />
      <h2>{agent.name} <span class="drawer-model">{agent.currentStatus?.model || ''}</span></h2>
      <button class="drawer-close" onclick={onClose} aria-label="Close">&times;</button>
    </div>

    <!-- Summary stats grid -->
    <div class="drawer-stats">
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: var(--agent-color, #F2B65A);">{agent.stats.messagesSent24h}</div>
        <div class="drawer-stat-label">sent</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value">{agent.stats.messagesReceived24h}</div>
        <div class="drawer-stat-label">received</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: var(--amber-400);">{agent.stats.positiveReactions}</div>
        <div class="drawer-stat-label">&#128077; reacts</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: var(--amber-400);">{agent.stats.asksPosed}</div>
        <div class="drawer-stat-label">asks</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: var(--emerald-400);">{agent.stats.asksAnswered}</div>
        <div class="drawer-stat-label">delivered</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: var(--blue-400, #5A93F7);">{agent.stats.tasksCompleted}</div>
        <div class="drawer-stat-label">tasks</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: #B896F5;">{agent.stats.plansCreated}</div>
        <div class="drawer-stat-label">plans</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value">{agent.rooms.length}</div>
        <div class="drawer-stat-label">rooms</div>
      </div>
      <div class="drawer-stat">
        <div class="drawer-stat-value" style="color: {agent.currentStatus?.hookFreshness === 'live' ? 'var(--emerald-400)' : 'var(--text-faint)'};">{agent.currentStatus?.hookFreshness || 'offline'}</div>
        <div class="drawer-stat-label">hook</div>
      </div>
    </div>

    <!-- Current Rooms -->
    {#if currentRooms.length > 0}
      <div class="drawer-section">
        <div class="drawer-section-title">Currently in ({currentRooms.length})</div>
        <div class="room-list">
          {#each currentRooms as room}
            <a href="/r/{room.roomId}" class="room-entry">
              <div class="room-dot" style="background: {room.attentionState === 'focused' ? 'var(--amber-400); box-shadow: 0 0 4px rgba(245,158,11,0.55)' : 'var(--blue-400, #5A93F7)'}"></div>
              <div class="room-info">
                <div class="room-name">#{room.roomName}</div>
                <div class="room-meta">{room.messageCount} msgs &middot; {room.role}</div>
              </div>
              <div class="room-right">
                {#if room.attentionState === 'focused'}
                  <span class="room-attention focus">FOCUS</span>
                {:else if room.attentionState === 'available'}
                  <span class="room-attention available">avail</span>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Historical Rooms -->
    {#if historicalRooms.length > 0}
      <div class="drawer-section">
        <div class="drawer-section-title">
          Has been in ({historicalRooms.length})
          <button class="toggle-btn" onclick={() => showHistorical = !showHistorical}>
            {showHistorical ? 'hide' : 'show all'}
          </button>
        </div>
        {#if showHistorical}
          <div class="room-list">
            {#each historicalRooms as room}
              <a href="/r/{room.roomId}" class="room-entry">
                <div class="room-dot" style="background: var(--text-faint); opacity: 0.4;"></div>
                <div class="room-info">
                  <div class="room-name">#{room.roomName}</div>
                  <div class="room-meta">{room.messageCount} msgs</div>
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Scrollable Timeline -->
    <div class="drawer-section">
      <div class="drawer-section-title">Activity timeline</div>
      <div class="timeline">
        {#if timeline.length > 0}
          {#each timeline as entry}
            <div class="tl-entry" class:clickable={entry.type === 'message' || entry.type === 'ask_posed'}>
              <div class="tl-dot" style="background: {getTypeColor(entry.type)};"></div>
              <div class="tl-content">
                <div class="tl-type" style="color: {getTypeColor(entry.type)};">{getTypeIcon(entry.type)} {entry.type.replace(/_/g, ' ')}</div>
                <p class="tl-summary">{entry.summary || 'No summary'}</p>
                {#if entry.roomId}
                  <div class="tl-room">#{entry.roomId}</div>
                {/if}
              </div>
              <div class="tl-time">{formatTime(entry.ts)}</div>
            </div>
          {/each}
        {:else}
          <div class="tl-empty">No recent activity</div>
        {/if}
      </div>
      {#if isLoading}
        <div class="tl-loading">Loading...</div>
      {/if}
      {#if hasMore && !isLoading}
        <button class="load-more" onclick={loadMore}>Load more</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .drawer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 200;
    display: flex;
    justify-content: flex-end;
  }

  .drawer {
    width: 520px;
    max-width: 100vw;
    height: 100vh;
    background: var(--bg);
    border-left: 1px solid var(--hairline);
    overflow-y: auto;
    animation: slideIn 0.2s cubic-bezier(0.4,0,0.2,1);
  }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

  .drawer-header {
    position: sticky;
    top: 0;
    background: var(--elev);
    border-bottom: 1px solid var(--hairline);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 10;
  }
  .drawer-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
  .drawer-model { font-size: 12px; font-weight: 400; color: var(--text-muted); font-family: var(--font-mono); }
  .drawer-close {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px; border: 1px solid var(--hairline);
    background: transparent; color: var(--text-muted); cursor: pointer; font-size: 16px;
  }
  .drawer-close:hover { background: var(--panel); color: var(--text); }

  .drawer-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--hairline);
  }
  .drawer-stat {
    text-align: center;
    padding: 8px;
    background: var(--elev);
    border-radius: 8px;
    border: 1px solid var(--hairline);
  }
  .drawer-stat-value { font-size: 20px; font-weight: 700; font-family: var(--font-mono); }
  .drawer-stat-label { font-size: 10px; font-family: var(--font-mono); color: var(--text-faint); margin-top: 2px; }

  .drawer-section { padding: 16px 20px; border-bottom: 1px solid var(--hairline); }
  .drawer-section-title {
    font-size: 11px; font-family: var(--font-mono); font-weight: 700;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;
    margin-bottom: 12px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .toggle-btn {
    font-size: 10px; font-family: var(--font-mono);
    padding: 2px 8px; border-radius: 4px;
    border: 1px solid var(--hairline);
    background: transparent; color: var(--text-muted); cursor: pointer;
  }
  .toggle-btn:hover { background: var(--panel); color: var(--text); }

  .room-list { display: flex; flex-direction: column; gap: 0; }
  .room-entry {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid var(--hairline);
    color: var(--text); text-decoration: none; transition: background 120ms;
  }
  .room-entry:last-child { border-bottom: none; }
  .room-entry:hover { background: var(--panel); border-radius: 4px; }
  .room-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .room-info { flex: 1; min-width: 0; }
  .room-name { font-size: 13px; font-weight: 600; }
  .room-meta { font-size: 10px; font-family: var(--font-mono); color: var(--text-faint); }
  .room-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .room-attention { font-size: 9px; font-family: var(--font-mono); font-weight: 700; padding: 2px 6px; border-radius: 4px; }
  .room-attention.focus { color: var(--amber-400); background: rgba(245,158,11,0.1); }
  .room-attention.available { color: var(--emerald-400); background: rgba(34,197,94,0.1); }

  .timeline { display: flex; flex-direction: column; gap: 0; }
  .tl-entry { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--hairline); }
  .tl-entry.clickable { cursor: pointer; }
  .tl-entry.clickable:hover { background: var(--panel); border-radius: 4px; }
  .tl-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
  .tl-content { flex: 1; min-width: 0; }
  .tl-type { font-size: 10px; font-family: var(--font-mono); font-weight: 600; }
  .tl-summary { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl-room { font-size: 10px; font-family: var(--font-mono); color: var(--text-faint); margin-top: 2px; }
  .tl-time { font-size: 10px; font-family: var(--font-mono); color: var(--text-faint); white-space: nowrap; margin-top: 4px; }
  .tl-empty, .tl-loading { text-align: center; padding: 24px; color: var(--text-faint); font-size: 13px; }
  .load-more {
    width: 100%; padding: 10px; border-radius: 8px;
    border: 1px solid var(--hairline); background: transparent;
    color: var(--text); cursor: pointer; font-size: 13px; font-weight: 500;
    margin-top: 8px;
  }
  .load-more:hover { background: var(--panel); }

  @media (max-width: 500px) {
    .drawer { width: 100vw; }
  }
</style>
