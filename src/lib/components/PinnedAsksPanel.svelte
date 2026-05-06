<script lang="ts">
  import {
    aggregateOpenAsks,
    parseAskMeta,
    toggleResolvedIndex,
    type AskMessage,
    type OpenAsk,
  } from '$lib/utils/asks';

  interface Props {
    messages: AskMessage[];
    sessionId: string;
    senderResolver?: (sender_id: string) => string;
  }

  const { messages, sessionId, senderResolver }: Props = $props();

  const VISIBLE_CAP = 12;

  let collapsed = $state(false);
  let expanded = $state(false);
  // Per-message optimistic overrides: messageId -> resolved index list.
  let optimisticResolved = $state<Record<string, number[]>>({});
  let pending = $state<Record<string, boolean>>({});

  const openAsks = $derived.by<OpenAsk[]>(() => {
    const overlaid: AskMessage[] = messages.map((msg) => {
      if (!msg?.id) return msg;
      const override = optimisticResolved[msg.id];
      if (!override) return msg;
      const parsed = parseAskMeta(msg.meta);
      const nextMeta = {
        asks: parsed.asks,
        inferred_asks: parsed.inferred_asks,
        asks_resolved: override,
      };
      return { ...msg, meta: nextMeta as unknown as AskMessage['meta'] };
    });
    return aggregateOpenAsks(overlaid, senderResolver);
  });

  const visibleAsks = $derived(expanded ? openAsks : openAsks.slice(0, VISIBLE_CAP));
  const hiddenCount = $derived(Math.max(0, openAsks.length - VISIBLE_CAP));

  function askKey(ask: OpenAsk): string {
    return `${ask.messageId}:${ask.index}`;
  }

  function emitJump(messageId: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('jump-to-message', { detail: { messageId } }),
    );
  }

  async function resolveAsk(ask: OpenAsk) {
    const key = askKey(ask);
    if (pending[key]) return;
    pending = { ...pending, [key]: true };

    const msg = messages.find((m) => m.id === ask.messageId);
    if (!msg) {
      pending = { ...pending, [key]: false };
      return;
    }
    const baseResolved = optimisticResolved[ask.messageId]
      ?? parseAskMeta(msg.meta).asks_resolved;
    const previous = baseResolved.slice();
    const next = toggleResolvedIndex(baseResolved, ask.index);
    optimisticResolved = { ...optimisticResolved, [ask.messageId]: next };

    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/messages/${ask.messageId}/asks`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: next }),
        },
      );
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch (err) {
      console.warn('[PinnedAsksPanel] resolve failed, reverting', err);
      optimisticResolved = { ...optimisticResolved, [ask.messageId]: previous };
    } finally {
      pending = { ...pending, [key]: false };
    }
  }
</script>

{#if openAsks.length > 0}
  <div
    class="pinned-asks-panel"
    style="border-color:var(--border-light);background:var(--bg-card);"
    aria-label="Pending decisions"
  >
    <button
      type="button"
      class="header"
      onclick={() => (collapsed = !collapsed)}
      aria-expanded={!collapsed}
      style="color:var(--text);"
    >
      <span class="caret" style="transform:{collapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};">▾</span>
      <span class="title">Pending decisions ({openAsks.length})</span>
    </button>

    {#if !collapsed}
      <ul class="ask-list">
        {#each visibleAsks as ask (askKey(ask))}
          <li class="ask-row" style="border-color:var(--border-subtle);">
            <div class="ask-text" style="color:var(--text);">
              {ask.text}
              {#if ask.sender}
                <span class="sender" style="color:var(--text-muted);">· {ask.sender}</span>
              {/if}
              {#if ask.inferred}
                <span class="tag" title="Inferred from message text">(inferred)</span>
              {/if}
            </div>
            <div class="actions">
              <button
                type="button"
                class="action resolve"
                disabled={pending[askKey(ask)]}
                onclick={() => resolveAsk(ask)}
              >Resolve</button>
              <button
                type="button"
                class="action jump"
                onclick={() => emitJump(ask.messageId)}
              >Jump</button>
            </div>
          </li>
        {/each}
      </ul>

      {#if hiddenCount > 0 && !expanded}
        <button
          type="button"
          class="more-link"
          onclick={() => (expanded = true)}
          style="color:#6366F1;"
        >+{hiddenCount} more</button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .pinned-asks-panel {
    position: sticky;
    top: 0;
    z-index: 5;
    border: 1px solid;
    border-radius: 10px;
    margin: 8px 8px 4px;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: 0;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .caret {
    display: inline-block;
    transition: transform 120ms ease;
    font-size: 10px;
    line-height: 1;
  }
  .title {
    flex: 1;
  }
  .ask-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow-y: auto;
  }
  .ask-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid;
    font-size: 12px;
  }
  .ask-text {
    flex: 1;
    line-height: 1.35;
    word-break: break-word;
  }
  .sender {
    margin-left: 4px;
    font-size: 11px;
  }
  .tag {
    margin-left: 6px;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.12);
    color: #6366F1;
    font-weight: 500;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .action {
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .action:hover:not([disabled]) {
    background: var(--bg-surface);
    color: var(--text);
  }
  .action[disabled] {
    opacity: 0.4;
    cursor: progress;
  }
  .resolve {
    color: #16A34A;
    border-color: rgba(22, 163, 74, 0.3);
  }
  .more-link {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: 0;
    border-top: 1px solid var(--border-subtle);
    text-align: left;
    font-size: 11px;
    cursor: pointer;
  }
</style>
