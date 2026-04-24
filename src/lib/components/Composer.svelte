<script lang="ts">
  import { AGENTS, NOCTURNE, surfaceTokens, type AgentId } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';

  let {
    themeMode = 'dark',
    userName = 'James',
    mentionedAgent,
    contextPills = [],
    placeholder = '',
    onSend,
  }: {
    themeMode?: 'dark' | 'light';
    userName?: string;
    mentionedAgent?: AgentId | string;
    contextPills?: string[];
    placeholder?: string;
    onSend?: (text: string) => void;
  } = $props();

  let text = $state('');

  const s = $derived(surfaceTokens(themeMode));
  const isDark = $derived(themeMode === 'dark');
  const mentionAgent = $derived(
    mentionedAgent ? (AGENTS[mentionedAgent as AgentId] ?? { color: '#838173' }) : null
  );
</script>

<div
  class="flex gap-3 items-start relative overflow-hidden"
  style="
    background: {s.elev};
    border-radius: var(--radius-panel);
    padding: 14px 16px 12px;
    box-shadow: inset 0 0 0 0.5px {s.hairlineStrong}
      {isDark ? ', 0 1px 0 rgba(0,0,0,0.25)' : ''};
  "
>
  <!-- User avatar -->
  <div
    class="flex-shrink-0 flex items-center justify-center rounded-full"
    style="
      width: 20px;
      height: 20px;
      margin-top: 1px;
      background: linear-gradient(135deg, {isDark ? NOCTURNE.ink[400] : NOCTURNE.neutral[400]}, {isDark ? NOCTURNE.ink[500] : NOCTURNE.neutral[500]});
      font-size: 10px;
      font-weight: 700;
      color: {isDark ? NOCTURNE.ink[900] : NOCTURNE.neutral[50]};
    "
  >{userName[0]}</div>

  <div class="flex-1 min-w-0">
    <!-- Input area -->
    <div style="font-size: 14px; line-height: 1.55; letter-spacing: -0.005em;">
      {#if mentionedAgent && mentionAgent}
        <span
          class="inline-flex items-center gap-1"
          style="
            font-family: var(--font-mono);
            font-size: 12.5px;
            letter-spacing: 0;
            font-weight: 600;
            color: {mentionAgent.color};
            background: {mentionAgent.color}1A;
            border: 0.5px solid {mentionAgent.color}40;
            padding: 1px 6px;
            border-radius: 5px;
          "
        >
          <AgentDot id={mentionedAgent} size={7} />
          @{mentionedAgent}
        </span>
        {' '}
      {/if}
      <span style="color: {s.text};">{placeholder || text}</span>
      <span
        class="inline-block align-text-bottom animate-caret"
        style="
          width: 8px;
          height: 16px;
          margin-left: 2px;
          background: {isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600]};
        "
      ></span>
    </div>

    <!-- Bottom bar: pills + send -->
    <div class="flex gap-1.5 mt-2.5">
      {#each contextPills as pill}
        <span
          style="
            font-family: var(--font-mono);
            font-size: 10.5px;
            letter-spacing: 0;
            color: {s.textMuted};
            background: {isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
            border: 0.5px solid {s.hairline};
            padding: 3px 7px;
            border-radius: 5px;
          "
        >{pill}</span>
      {/each}
      <div class="flex-1"></div>
      <button
        class="flex items-center gap-1.5 cursor-pointer"
        style="
          font-family: var(--font-sans);
          font-size: 12.5px;
          font-weight: 600;
          color: #fff;
          background: linear-gradient(180deg, {NOCTURNE.blue[500]}, {NOCTURNE.blue[600]});
          border: 0.5px solid {NOCTURNE.blue[400]};
          padding: 6px 12px;
          border-radius: 6px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 0 rgba(0,0,0,0.15);
          letter-spacing: -0.005em;
        "
        onclick={() => onSend?.(text)}
      >
        <span>Send</span>
        <NocturneIcon name="send" size={11} color="#fff" />
      </button>
    </div>
  </div>
</div>
