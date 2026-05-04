<script lang="ts">
  import { AGENTS, NOCTURNE, surfaceTokens, type AgentId, type AgentStatus } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import SignalBars from './SignalBars.svelte';
  import NocturneIcon from './NocturneIcon.svelte';
  import ThinkingShimmer from './ThinkingShimmer.svelte';
  import Grain from './Grain.svelte';

  let {
    id,
    name,
    model = '',
    status = 'idle',
    signal = 4,
    location = 'cloud',
    thinkingLabel,
    themeMode = 'dark',
  }: {
    id: AgentId | string;
    name: string;
    model?: string;
    status?: AgentStatus;
    signal?: number;
    location?: 'cloud' | 'local';
    thinkingLabel?: string;
    themeMode?: 'dark' | 'light';
  } = $props();

  let hover = $state(false);

  const s = $derived(surfaceTokens(themeMode));
  const a = $derived(AGENTS[id as AgentId] ?? { color: '#838173', glow: '#B5B3A7' });
  const isDark = $derived(themeMode === 'dark');

  const statusMeta = $derived.by(() => {
    const map: Record<AgentStatus, { label: string; color: string }> = {
      active:   { label: 'Active',   color: isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600] },
      thinking: { label: thinkingLabel || 'Thinking', color: NOCTURNE.pulse.hot },
      idle:     { label: 'Idle',     color: s.textFaint },
      offline:  { label: 'Offline',  color: s.textFaint },
    };
    return map[status] ?? map.idle;
  });

  const signalColor = $derived(
    signal >= 3
      ? (isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600])
      : signal >= 2
        ? (isDark ? NOCTURNE.amber[400] : NOCTURNE.amber[500])
        : NOCTURNE.semantic.danger
  );

  const signalMuted = $derived(isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative overflow-hidden"
  style="
    background: {s.elev};
    border-radius: var(--radius-card);
    padding: 14px 16px 12px;
    color: {s.text};
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-body);
    box-shadow: inset 0 0 0 0.5px {s.hairlineStrong},
      {isDark
        ? `0 1px 0 rgba(0,0,0,0.25), 0 10px 28px -16px rgba(0,0,0,${hover ? 0.55 : 0.4})`
        : `0 1px 0 rgba(0,0,0,0.02), 0 8px 24px -18px rgba(0,0,0,${hover ? 0.16 : 0.08})`};
    transform: translateY({hover ? -1 : 0}px);
    transition: transform var(--duration-base) var(--spring-quick),
                box-shadow var(--duration-base) var(--spring-default);
    min-width: 256px;
  "
  onmouseenter={() => hover = true}
  onmouseleave={() => hover = false}
>
  <!-- Interior glow -->
  <div
    aria-hidden="true"
    class="absolute inset-0 rounded-[inherit] pointer-events-none"
    style="
      background: radial-gradient(70% 90% at 50% -10%, {a.color}{isDark ? '1F' : '14'} 0%, transparent 60%);
      opacity: {hover ? 1 : 0.8};
      transition: opacity var(--duration-slow) var(--spring-default);
    "
  ></div>
  {#if isDark}
    <Grain opacity={0.025} />
  {/if}

  <!-- Top row: dot + name + status -->
  <div class="relative flex items-center gap-2.5">
    <AgentDot {id} size={12} state={status} />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0" style="font-size: 14px; font-weight: 600; letter-spacing: -0.01em;">
        <span class="flex-shrink-0">{name}</span>
        <span
          class="whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
          style="
            font-family: var(--font-mono);
            font-size: 10.5px;
            font-weight: 400;
            color: {s.textFaint};
            letter-spacing: 0;
            padding: 1px 5px;
            border-radius: 4px;
            background: {isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
          "
        >{model}</span>
      </div>
      <div
        class="flex items-center gap-1.5 mt-0.5"
        style="
          font-size: 11.5px;
          color: {s.textMuted};
          font-family: var(--font-mono);
          letter-spacing: 0;
        "
      >
        <NocturneIcon name={location === 'local' ? 'cpu' : 'cloud'} size={11} color={s.textFaint} />
        {location === 'local' ? 'localhost · mini-m4' : 'cloud'}
      </div>
    </div>
    <button
      aria-label="more"
      class="touch-target p-1 rounded cursor-pointer"
      style="
        background: transparent;
        border: none;
        color: {s.textFaint};
        opacity: {hover ? 1 : 0};
        transition: opacity var(--duration-fast);
      "
    >
      <NocturneIcon name="moreHorizontal" size={14} />
    </button>
  </div>

  <!-- Divider -->
  <div style="height: 1px; background: {s.hairline}; margin: 12px 0 10px;"></div>

  <!-- Bottom row: status + signal + handoff -->
  <div class="relative flex items-center gap-2.5">
    <div class="flex items-center gap-1.5 flex-1">
      {#if status === 'thinking'}
        <ThinkingShimmer text={statusMeta.label} />
      {:else}
        <div
          class="rounded-full"
          style="
            width: 6px;
            height: 6px;
            background: {statusMeta.color};
            box-shadow: {status === 'active' ? `0 0 8px ${statusMeta.color}` : 'none'};
          "
        ></div>
        <span
          style="
            font-size: 11.5px;
            color: {s.textMuted};
            font-family: var(--font-mono);
            letter-spacing: 0;
            font-variant-numeric: tabular-nums;
          "
        >{statusMeta.label}</span>
      {/if}
    </div>

    <SignalBars level={signal} color={signalColor} muted={signalMuted} />

    <!-- Handoff chip — appears on hover -->
    <button
      class="flex items-center gap-1 cursor-pointer"
      style="
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0;
        color: {isDark ? NOCTURNE.blue[300] : NOCTURNE.blue[700]};
        background: {isDark ? `${NOCTURNE.blue[500]}18` : `${NOCTURNE.blue[500]}12`};
        border: 0.5px solid {isDark ? NOCTURNE.blue[500] + '40' : NOCTURNE.blue[500] + '30'};
        padding: 3px 8px;
        border-radius: 6px;
        opacity: {hover ? 1 : 0};
        transform: translateX({hover ? 0 : 4}px);
        transition: opacity var(--duration-base) var(--spring-quick),
                    transform var(--duration-base) var(--spring-quick);
      "
    >
      <span>→ @{id}</span>
    </button>
  </div>
</div>
