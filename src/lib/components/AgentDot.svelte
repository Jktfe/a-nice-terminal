<script lang="ts">
  import { AGENTS, type AgentId, type AgentStatus } from '$lib/nocturne';

  let {
    id,
    size = 10,
    state = 'idle',
    ring = true,
  }: {
    id: AgentId | string;
    size?: number;
    state?: AgentStatus;
    ring?: boolean;
  } = $props();

  const agent = $derived(AGENTS[id as AgentId] ?? { color: '#838173', glow: '#B5B3A7' });
  const breathe = $derived(state === 'active' || state === 'thinking');
</script>

<div class="relative flex-shrink-0" style="width: {size}px; height: {size}px;">
  {#if breathe}
    <div
      class="absolute rounded-full animate-breathe"
      style="
        inset: -{size * 0.4}px;
        background: radial-gradient(circle, {agent.glow}55 0%, transparent 70%);
      "
    ></div>
  {/if}
  <div
    class="rounded-full"
    style="
      width: {size}px;
      height: {size}px;
      background: {agent.color};
      box-shadow: {ring
        ? `0 0 0 2px ${agent.color}22, inset 0 1px 0 rgba(255,255,255,0.25)`
        : 'inset 0 1px 0 rgba(255,255,255,0.25)'};
    "
  ></div>
</div>
