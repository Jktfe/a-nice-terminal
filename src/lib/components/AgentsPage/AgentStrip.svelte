<script lang="ts">
  import AgentDot from '$lib/components/AgentDot.svelte';
  import { agentColorFromSession } from '$lib/nocturne';

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
      state: string;
      stateLabel?: string;
      sessionDurationMs?: number;
      hookFreshness: 'live' | 'stale' | 'absent';
    } | null;
    stats: {
      messagesSent24h: number;
      totalRooms: number;
      positiveReactions: number;
    };
    rooms: RoomActivity[];
  }

  let { agents }: { agents: Agent[] } = $props();

  function getStateLabel(agent: Agent): string {
    if (!agent.available) return 'offline';
    return agent.currentStatus?.stateLabel || agent.currentStatus?.state || 'unknown';
  }

  function getDotState(agent: Agent): 'active' | 'thinking' | 'idle' | 'offline' {
    if (!agent.available || !agent.currentStatus) return 'offline';
    const label = agent.currentStatus.stateLabel;
    if (label === 'Working') return 'active';
    if (label === 'Menu' || label === 'Permission' || label === 'Response needed') return 'thinking';
    if (label === 'Waiting' || label === 'Available') return 'idle';
    return 'idle';
  }

  function getChipColor(agent: Agent): string {
    return agentColorFromSession({ cli_flag: agent.name }).color;
  }

  function formatDuration(ms?: number): string {
    if (!ms) return '';
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }
</script>

<div class="agent-strip">
  {#each agents as agent (agent.name)}
    {@const color = getChipColor(agent)}
    {@const state = getDotState(agent)}
    {@const label = getStateLabel(agent)}
    {@const focused = agent.rooms.some(r => r.attentionState === 'focused')}
    <div
      class="agent-chip"
      style="border-left-color: {color};"
      class:focused={focused}
    >
      <div class="chip-top">
        <AgentDot id={agent.name} size={10} state={state} ring={true} />
        <span class="chip-name">{agent.name}</span>
        <span class="chip-tier">T{agent.tier}</span>
      </div>
      <div class="chip-bottom">
        <span class="chip-status" style="color: {state === 'active' ? 'var(--emerald-400)' : state === 'thinking' ? 'var(--amber-400)' : state === 'offline' ? 'var(--text-faint)' : 'var(--text-muted)'};">
          {label}
        </span>
        <span class="chip-rooms">{agent.stats.totalRooms} room{agent.stats.totalRooms !== 1 ? 's' : ''}</span>
        {#if agent.currentStatus?.sessionDurationMs}
          <span class="chip-uptime">{formatDuration(agent.currentStatus.sessionDurationMs)}</span>
        {/if}
        {#if focused}
          <span class="chip-focus">FOCUS</span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .agent-strip {
    display: flex;
    gap: 8px;
    padding: 12px 24px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--hairline);
  }
  .agent-strip::-webkit-scrollbar { display: none; }

  .agent-chip {
    flex-shrink: 0;
    width: 140px;
    padding: 10px 12px;
    border-radius: var(--radius-card, 10px);
    background: var(--elev);
    border: 1px solid var(--hairline);
    border-left-width: 3px;
    cursor: pointer;
    transition: transform var(--duration-base, 150ms), box-shadow var(--duration-base, 150ms);
  }
  .agent-chip:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px -8px rgba(0,0,0,0.3);
  }
  .agent-chip.focused {
    border-color: var(--amber-400);
    border-left-color: var(--amber-400);
  }

  .chip-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .chip-name {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .chip-tier {
    font-size: 9px;
    font-family: var(--font-mono);
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(255,255,255,0.06);
    color: var(--text-faint);
  }

  .chip-bottom {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .chip-status {
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .chip-rooms {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }

  .chip-uptime {
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }

  .chip-focus {
    font-size: 9px;
    font-weight: 700;
    color: var(--amber-400);
    background: rgba(245,158,11,0.12);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
