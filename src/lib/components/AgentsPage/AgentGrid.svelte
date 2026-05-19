<script lang="ts">
  import AgentDot from '$lib/components/AgentDot.svelte';
  import NocturneIcon from '$lib/components/NocturneIcon.svelte';
  import AgentDetailDrawer from './AgentDetailDrawer.svelte';
  import ContextRing from './ContextRing.svelte';
  import ActivityStrip from './ActivityStrip.svelte';
  import { agentColorFromSession } from '$lib/nocturne';

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
      asksPosed: number;
      asksAnswered: number;
      asksOpen: number;
      tasksCompleted: number;
      tasksInProgress: number;
      plansCreated: number;
      positiveReactions: number;
      totalSessions: number;
      activeSessions: number;
      totalRooms: number;
    };
    rooms: Array<{
      roomId: string;
      roomName: string;
      messageCount: number;
      lastActivity: number | null;
      attentionState: string | null;
      role: string;
    }>;
    mostActiveRooms: Array<{
      roomId: string;
      roomName: string;
      messageCount: number;
      lastActivity: number | null;
      attentionState: string | null;
      role: string;
    }>;
    timeline: Array<{
      ts: number;
      type: string;
      summary: string;
      sessionId?: string;
    }>;
  }

  let { agents, onSelect }: { agents: Agent[]; onSelect: (agent: Agent) => void } = $props();
  let selectedAgent = $state<Agent | null>(null);

  // Mock 7-day activity data (will come from API in next iteration)
  function getActivityData(agent: Agent) {
    return [
      { day: 'M', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'T', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'W', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'T', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'F', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'S', count: Math.floor(Math.random() * 20), max: 20 },
      { day: 'S', count: Math.floor(Math.random() * 20), max: 20 }
    ];
  }

  function formatDuration(ms?: number): string {
    if (!ms) return '0m';
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }

  function getAgentColor(agent: Agent): string {
    return agentColorFromSession({ cli_flag: agent.name }).color;
  }

  function getStateLabel(agent: Agent): string {
    return agent.currentStatus?.stateLabel || agent.currentStatus?.state || 'unknown';
  }

  function getLastAction(agent: Agent): string {
    if (agent.currentStatus?.activity) {
      return agent.currentStatus.activity;
    }
    return 'No recent activity';
  }
</script>

{#if selectedAgent}
  <AgentDetailDrawer agent={selectedAgent} onClose={() => selectedAgent = null} />
{/if}

<div class="agent-grid">
  {#each agents as agent (agent.name)}
    {#if agent.available}
      <div 
        class="agent-card" 
        style="--agent-color: {getAgentColor(agent)};"
        onclick={() => selectedAgent = agent}
      >
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- Header with Context Ring -->
          <div class="card-header">
            <div class="agent-dot-wrapper">
              <AgentDot
                id={agent.name}
                size={12}
                state={agent.currentStatus?.stateLabel === 'Working' ? 'active' : agent.currentStatus?.stateLabel === 'Permission' ? 'thinking' : 'idle'}
                ring={false}
              />
              {#if agent.currentStatus?.contextUsedPct !== undefined}
                <div class="context-ring-overlay">
                  <ContextRing 
                    percentage={agent.currentStatus.contextUsedPct} 
                    size={40} 
                    strokeWidth={3}
                  />
                </div>
              {/if}
            </div>
            <div class="agent-info">
              <span class="card-name">{agent.name}</span>
              <div class="agent-meta">
                <span class="card-tier">T{agent.tier}</span>
                {#if agent.currentStatus?.model}
                  <span class="card-model">{agent.currentStatus.model}</span>
                {/if}
              </div>
            </div>
            <div class="card-avail" class:installed={agent.available} class:missing={!agent.available}></div>
          </div>

          <!-- Status + Last Action -->
          <div class="card-status">
            <span class="status-label">{getStateLabel(agent)}</span>
            <span class="last-action">{getLastAction(agent)}</span>
          </div>

          <!-- Stats Row -->
          <div class="card-stats">
            <span class="stat-badge" title="Messages (24h)">💬 {agent.stats.messagesSent24h}</span>
            <span class="stat-badge" title="Positive reactions">👍 {agent.stats.positiveReactions}</span>
            <span class="stat-badge" title="Asks posed">❓ {agent.stats.asksPosed}</span>
            <span class="stat-badge" title="Tasks completed">✅ {agent.stats.tasksCompleted}</span>
            <span class="stat-badge" title="Plans created">📋 {agent.stats.plansCreated}</span>
          </div>

          <!-- 7-Day Activity Strip -->
          <div class="activity-section">
            <span class="activity-label">7 days</span>
            <ActivityStrip activities={getActivityData(agent)} />
          </div>

          <!-- Room Chips with Counts -->
          {#if agent.rooms.length > 0}
            <div class="card-rooms">
              {#each agent.rooms.slice(0, 5) as room}
                <span class="room-chip" class:focus={room.attentionState === 'focused'}>
                  {room.roomName}
                  <span class="room-count">{room.messageCount}</span>
                  {#if room.attentionState === 'focused'}
                    <span class="focus-dot"></span>
                  {/if}
                </span>
              {/each}
            </div>
          {/if}

          <!-- Telemetry -->
          <div class="card-telemetry">
            <span class="telemetry-item">⏱ {formatDuration(agent.currentStatus?.sessionDurationMs)}</span>
            {#if agent.currentStatus?.permissionMode}
              <span class="telemetry-item warning">🔓 {agent.currentStatus.permissionMode}</span>
            {/if}
            <span class="telemetry-item" class:live={agent.currentStatus?.hookFreshness === 'live'} class:stale={agent.currentStatus?.hookFreshness === 'stale'}>
              📡 {agent.currentStatus?.hookFreshness}
            </span>
          </div>
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  .agent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
    padding: 24px;
  }

  .agent-card {
    background: var(--elev);
    border-radius: var(--radius-card, 10px);
    border: 1px solid var(--hairline);
    overflow: hidden;
    position: relative;
    transition: transform var(--duration-base, 150ms), box-shadow var(--duration-base, 150ms);
    cursor: pointer;
  }
  .agent-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px -16px rgba(0,0,0,0.4);
  }

  .card-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0.8;
    pointer-events: none;
    background: radial-gradient(70% 90% at 50% -10%, var(--agent-color) 14%, transparent 60%);
  }

  .card-inner {
    position: relative;
    padding: 14px 16px 12px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .agent-dot-wrapper {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .context-ring-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .agent-info {
    flex: 1;
    min-width: 0;
  }

  .card-name {
    font-size: 14px;
    font-weight: 600;
    display: block;
  }

  .agent-meta {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }

  .card-tier {
    font-size: 9px;
    font-family: var(--font-mono);
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255,255,255,0.06);
    color: var(--text-faint);
  }

  .card-model {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-faint);
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255,255,255,0.04);
  }

  .card-avail {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .card-avail.installed { background: var(--emerald-400); }
  .card-avail.missing { background: var(--danger); }

  .card-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .status-label {
    font-size: 12px;
    font-weight: 500;
  }

  .last-action {
    font-size: 10px;
    color: var(--text-muted);
    max-width: 60%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-stats {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .stat-badge {
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.04);
    color: var(--text-muted);
    cursor: help;
  }

  .activity-section {
    margin-bottom: 10px;
    padding: 8px;
    border-radius: 6px;
    background: rgba(255,255,255,0.03);
  }

  .activity-label {
    display: block;
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-faint);
    margin-bottom: 4px;
  }

  .card-rooms {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }

  .room-chip {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.04);
    color: var(--text-muted);
    border: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .room-chip:focus {
    border-color: var(--agent-color);
  }
  .room-chip .room-count {
    font-size: 9px;
    opacity: 0.7;
  }
  .room-chip .focus-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--amber-400);
  }

  .card-telemetry {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--hairline);
  }

  .telemetry-item {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .telemetry-item.warning { color: var(--amber-400); }
  .telemetry-item.live { color: var(--emerald-400); }
  .telemetry-item.stale { color: var(--amber-400); }
</style>
