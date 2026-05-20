<!--
  AgentDot.svelte — V3-LIFT-1 per docs/v3-renderers-lift-2026-05-15.md.
  REWRITTEN from v3 with scoped Svelte CSS (no Tailwind utility classes —
  fresh-ANT has no Tailwind). Preserves the same AgentDotState props
  contract: `id` (handle/cli) + `size` (px) + `state` (active/thinking/idle/offline) + `ring`.
  Active/thinking states get a soft breathing aura via CSS keyframes.
-->
<script lang="ts">
  import { AGENTS, type AgentId } from '$lib/nocturne';
  import type { AgentDotState } from '$lib/shared/agent-status';

  let {
    id,
    size = 10,
    state = 'idle',
    ring = true
  }: {
    id: AgentId | string;
    size?: number;
    state?: AgentDotState;
    ring?: boolean;
  } = $props();

  const agent = $derived(AGENTS[id as AgentId] ?? { color: '#838173', glow: '#B5B3A7' });
  const breathe = $derived(state === 'active' || state === 'thinking');
  const opacity = $derived(state === 'offline' ? 0.45 : 1);
  const auraInset = $derived(-Math.round(size * 0.4));
</script>

<div class="agent-dot" style="width: {size}px; height: {size}px;">
  {#if breathe}
    <div
      class="aura"
      style="
        inset: {auraInset}px;
        background: radial-gradient(circle, {agent.glow}55 0%, transparent 70%);
      "
    ></div>
  {/if}
  <div
    class="dot"
    style="
      width: {size}px;
      height: {size}px;
      background: {agent.color};
      opacity: {opacity};
      box-shadow: {ring
        ? `0 0 0 2px ${agent.color}22, inset 0 1px 0 rgba(255,255,255,0.25)`
        : 'inset 0 1px 0 rgba(255,255,255,0.25)'};
    "
  ></div>
</div>

<style>
  .agent-dot {
    position: relative;
    flex-shrink: 0;
    display: inline-block;
  }
  .aura {
    position: absolute;
    border-radius: 9999px;
    animation: agent-dot-breathe 1.8s ease-in-out infinite;
    pointer-events: none;
  }
  .dot {
    position: relative;
    border-radius: 9999px;
  }
  @keyframes agent-dot-breathe {
    0%, 100% { opacity: 0.55; transform: scale(0.92); }
    50%      { opacity: 0.95; transform: scale(1.05); }
  }
</style>
