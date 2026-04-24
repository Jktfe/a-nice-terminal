<script lang="ts">
  import { NOCTURNE, surfaceTokens } from '$lib/nocturne';
  import NocturneIcon from './NocturneIcon.svelte';

  let {
    name,
    args = [],
    output,
    status = 'pending',
    requiresApproval = false,
    themeMode = 'dark',
    onApprove,
    onDeny,
  }: {
    name: string;
    args?: Array<{ k: string; v: string }>;
    output?: string;
    status?: 'pending' | 'approved' | 'done' | 'denied';
    requiresApproval?: boolean;
    themeMode?: 'dark' | 'light';
    onApprove?: () => void;
    onDeny?: () => void;
  } = $props();

  let currentState = $state('pending');
  $effect(() => { currentState = status; });
  const s = $derived(surfaceTokens(themeMode));
  const isDark = $derived(themeMode === 'dark');

  const bg = $derived(isDark ? NOCTURNE.ink[700] : NOCTURNE.neutral[50]);
  const border = $derived(isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)');

  const statusPill = $derived.by(() => {
    const map: Record<string, { c: string; l: string }> = {
      pending:  { c: isDark ? NOCTURNE.amber[400] : NOCTURNE.amber[600], l: 'pending' },
      approved: { c: isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600], l: 'running' },
      done:     { c: isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600], l: 'done' },
      denied:   { c: NOCTURNE.semantic.danger, l: 'denied' },
    };
    return map[currentState] ?? map.pending;
  });
</script>

<div
  style="
    margin-top: 10px;
    border-radius: var(--radius-card);
    overflow: hidden;
    background: {bg};
    border: 0.5px solid {border};
    box-shadow: {isDark
      ? 'inset 0 0 0 0.5px rgba(255,255,255,0.03)'
      : 'inset 0 0 0 0.5px rgba(255,255,255,0.6)'};
  "
>
  <!-- Header -->
  <div
    class="flex items-center gap-2"
    style="
      padding: 8px 12px;
      border-bottom: 0.5px solid {border};
      background: {isDark ? 'rgba(66,133,244,0.06)' : 'rgba(59,130,246,0.04)'};
    "
  >
    <NocturneIcon name="terminal" size={12} color={isDark ? NOCTURNE.blue[300] : NOCTURNE.blue[600]} />
    <span
      style="
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0;
        color: {isDark ? NOCTURNE.blue[200] : NOCTURNE.blue[800]};
      "
    >{name}</span>
    <span
      style="
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: {s.textFaint};
        letter-spacing: 0;
        padding: 1px 6px;
        border-radius: 4px;
        background: {isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
      "
    >tool_call</span>
    <div class="flex-1"></div>
    <!-- Status pill -->
    <span
      class="flex items-center gap-1"
      style="
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: 0;
        color: {statusPill.c};
        padding: 1px 6px;
        border-radius: 4px;
        background: {statusPill.c}18;
        border: 0.5px solid {statusPill.c}40;
      "
    >
      <div
        class="rounded-full"
        style="width: 5px; height: 5px; background: {statusPill.c}; box-shadow: 0 0 5px {statusPill.c};"
      ></div>
      {statusPill.l}
    </span>
  </div>

  <!-- Args -->
  <div style="padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0; line-height: 1.6;">
    {#each args as arg}
      <div class="flex gap-2">
        <span style="color: {s.textFaint}; min-width: 68px;">{arg.k}</span>
        <span style="color: {s.text};">{arg.v}</span>
      </div>
    {/each}
  </div>

  <!-- Output (if ran) -->
  {#if output}
    <div
      style="
        padding: 10px 12px;
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0;
        line-height: 1.6;
        color: {s.textMuted};
        border-top: 0.5px dashed {border};
        background: {isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.015)'};
      "
    >
      <div
        style="
          color: {isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600]};
          margin-bottom: 2px;
          font-size: 10.5px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          font-weight: 600;
        "
      >✓ output</div>
      {output}
    </div>
  {/if}

  <!-- Approval row -->
  {#if requiresApproval && currentState === 'pending'}
    <div
      class="flex gap-2"
      style="
        padding: 10px 12px;
        border-top: 0.5px solid {border};
        background: {isDark ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.04)'};
      "
    >
      <div class="flex-1 flex items-center gap-1.5">
        <div
          class="rounded-full"
          style="
            width: 6px;
            height: 6px;
            background: {isDark ? NOCTURNE.amber[400] : NOCTURNE.amber[500]};
            box-shadow: 0 0 6px {isDark ? NOCTURNE.amber[400] : NOCTURNE.amber[500]};
          "
        ></div>
        <span
          style="
            font-family: var(--font-mono);
            font-size: 11px;
            letter-spacing: 0;
            color: {isDark ? NOCTURNE.amber[300] : NOCTURNE.amber[700]};
          "
        >Awaiting your approval</span>
      </div>
      <!-- Deny -->
      <button
        class="flex items-center gap-1.5 cursor-pointer"
        style="
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: {isDark ? NOCTURNE.ink[100] : NOCTURNE.neutral[700]};
          background: transparent;
          border: 0.5px solid {isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
          padding: 5px 10px;
          border-radius: 6px;
        "
        onclick={() => { currentState = 'denied'; onDeny?.(); }}
      >
        <NocturneIcon name="x" size={11} color={isDark ? NOCTURNE.ink[100] : NOCTURNE.neutral[700]} />
        <span>Deny</span>
      </button>
      <!-- Run -->
      <button
        class="flex items-center gap-1.5 cursor-pointer"
        style="
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: #fff;
          background: linear-gradient(180deg, {NOCTURNE.blue[500]}, {NOCTURNE.blue[600]});
          border: 0.5px solid {NOCTURNE.blue[400]};
          padding: 5px 10px;
          border-radius: 6px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 0 rgba(0,0,0,0.15);
        "
        onclick={() => { currentState = 'approved'; onApprove?.(); }}
      >
        <NocturneIcon name="play" size={11} color="#fff" />
        <span>Run</span>
      </button>
    </div>
  {/if}
</div>
