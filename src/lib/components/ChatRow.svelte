<script lang="ts">
  import { AGENTS, NOCTURNE, surfaceTokens, type AgentId } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';

  let {
    who = 'user',
    agentId,
    timestamp = '',
    themeMode = 'dark',
    userName = 'James',
    children,
  }: {
    who?: 'user' | 'agent';
    agentId?: AgentId | string;
    timestamp?: string;
    themeMode?: 'dark' | 'light';
    userName?: string;
    children?: import('svelte').Snippet;
  } = $props();

  let hover = $state(false);

  const s = $derived(surfaceTokens(themeMode));
  const isUser = $derived(who === 'user');
  const a = $derived(agentId ? (AGENTS[agentId as AgentId] ?? { color: '#838173' }) : null);
  const isDark = $derived(themeMode === 'dark');

  const nameColor = $derived(
    isUser
      ? (isDark ? NOCTURNE.ink[100] : NOCTURNE.neutral[800])
      : (a?.color ?? s.text)
  );

  const AGENT_MODELS: Record<string, string> = {
    claude: 'sonnet-4.5',
    gemini: '2.5-pro',
    codex: 'gpt-5.1',
    copilot: 'gpt-5',
    ollama: 'qwen2.5-coder:32b',
    lmstudio: 'llama-3.3-70b',
  };

  function capitalize(s: string) { return s[0].toUpperCase() + s.slice(1); }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative"
  style="
    padding: 14px 18px 16px;
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-body);
    color: {s.text};
    border-radius: var(--radius-card);
    background: {hover ? (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)') : 'transparent'};
    transition: background var(--duration-base) var(--spring-default);
  "
  onmouseenter={() => hover = true}
  onmouseleave={() => hover = false}
>
  <!-- Identity strip -->
  <div class="flex items-center gap-2.5" style="margin-bottom: 6px;">
    {#if isUser}
      <div
        class="flex items-center justify-center rounded-full"
        style="
          width: 18px;
          height: 18px;
          background: linear-gradient(135deg, {isDark ? NOCTURNE.ink[400] : NOCTURNE.neutral[400]}, {isDark ? NOCTURNE.ink[500] : NOCTURNE.neutral[500]});
          font-size: 9.5px;
          font-weight: 700;
          color: {isDark ? NOCTURNE.ink[900] : NOCTURNE.neutral[50]};
          letter-spacing: 0;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
        "
      >{userName[0]}</div>
    {:else}
      <div class="relative flex items-center justify-center" style="width: 18px; height: 18px;">
        <AgentDot id={agentId ?? 'claude'} size={12} state="idle" />
      </div>
    {/if}

    <div
      style="
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: {nameColor};
      "
    >{isUser ? userName : capitalize(agentId ?? 'Agent')}</div>

    {#if !isUser && agentId}
      <span
        style="
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: {s.textFaint};
          padding: 1px 5px;
          border-radius: 4px;
          background: {isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
        "
      >{AGENT_MODELS[agentId] ?? ''}</span>
    {/if}

    <div class="flex-1"></div>

    <div
      style="
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: {s.textFaint};
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      "
    >{timestamp}</div>
  </div>

  <!-- Body -->
  <div style="font-size: 14px; line-height: 1.55; color: {s.text}; padding-left: 28px;">
    {#if children}
      {@render children()}
    {/if}
  </div>

  <!-- Reply affordances — on hover -->
  <div
    class="flex gap-1.5"
    style="
      padding-left: 28px;
      margin-top: 10px;
      opacity: {hover ? 1 : 0};
      transform: translateY({hover ? 0 : -2}px);
      transition: opacity var(--duration-base) var(--spring-quick),
                  transform var(--duration-base) var(--spring-quick);
    "
  >
    {@render replyChip('reply', 'Reply', isDark)}
    {@render replyChip('cornerDown', 'Thread', isDark)}
    {@render replyChip('sparkle', 'Ask Claude', isDark, AGENTS.claude.color)}
  </div>
</div>

{#snippet replyChip(icon: string, label: string, dark: boolean, accent?: string)}
  {@const c = accent || (dark ? NOCTURNE.ink[200] : NOCTURNE.neutral[600])}
  {@const bg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)'}
  <button
    class="flex items-center gap-1.5 cursor-pointer"
    style="
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0;
      color: {c};
      background: {bg};
      border: 0.5px solid {dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
      padding: 4px 8px;
      border-radius: 6px;
      transition: background var(--duration-fast);
    "
  >
    <NocturneIcon name={icon} size={11} color={c} />
    <span>{label}</span>
  </button>
{/snippet}
