<!--
  InterviewModalThread — transcript list + per-message replay button.
  Extracted 2026-05-21 to keep InterviewModal under the 600-line cap.
  Parent owns scrollEl + TTS state; we expose a bind:scrollEl so the
  parent's auto-scroll $effect can keep working unchanged.
-->
<script lang="ts">
  import NocturneIcon from './NocturneIcon.svelte';

  export interface InterviewMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    agentHandle?: string;
    audioCacheKey?: string | null;
    createdAt: number;
  }

  type Props = {
    messages: InterviewMessage[];
    activeMsgId: string | null;
    scrollEl?: HTMLDivElement | null;
    onReplay: (m: InterviewMessage) => void;
  };

  let {
    messages,
    activeMsgId,
    scrollEl = $bindable(null),
    onReplay,
  }: Props = $props();
</script>

<div
  class="iv-thread"
  bind:this={scrollEl}
  role="log"
  aria-live="polite"
  aria-label="Interview transcript"
>
  {#if messages.length === 0}
    <p class="iv-empty">
      Send a message to start the interview. The
      target agent (and any added agents) will reply here, and
      their responses will be read aloud unless you mute them.
    </p>
  {/if}
  {#each messages as m (m.id)}
    <div class="iv-msg" data-role={m.role}>
      <span class="iv-msg-meta">
        <span>{m.role === 'user' ? 'You' : (m.agentHandle ?? 'agent')}</span>
        {#if m.role === 'agent'}
          <button
            type="button"
            class="iv-replay"
            onclick={() => onReplay(m)}
            title={activeMsgId === m.id ? 'Currently playing' : 'Replay this message'}
            aria-label="Replay message audio"
          >
            <NocturneIcon name={activeMsgId === m.id ? 'mic' : 'play'} size={10} color="currentColor" />
          </button>
        {/if}
      </span>
      <p class="iv-msg-body">{m.content}</p>
    </div>
  {/each}
</div>

<style>
  .iv-thread {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-soft, rgba(0, 0, 0, 0.015));
  }
  .iv-empty {
    color: var(--text-muted, #6b7280);
    font-size: 12.5px;
    margin: 8px 0;
    line-height: 1.55;
  }
  .iv-msg {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 92%;
  }
  .iv-msg[data-role='user'] {
    align-self: flex-end;
    align-items: flex-end;
  }
  .iv-msg-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    color: var(--text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-mono, monospace);
  }
  .iv-replay {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0;
    color: var(--text-muted, #6b7280);
    display: inline-flex;
    align-items: center;
  }
  .iv-replay:hover { color: var(--text, #111); }
  .iv-msg-body {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--surface, #fff);
    border: 0.5px solid var(--hairline, rgba(0, 0, 0, 0.08));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .iv-msg[data-role='user'] .iv-msg-body {
    background: var(--accent-blue, #3b82f6);
    color: #fff;
    border-color: transparent;
  }
</style>
