<script lang="ts">
  import { onMount } from 'svelte';
  import { NOCTURNE, agentColor } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';
  import QuickLaunchBar from './QuickLaunchBar.svelte';
  import BreakConfirmModal from './BreakConfirmModal.svelte';
  import { activeRoutingMentions, bracketRoutingMention } from '$lib/utils/mentions';
  import { useMentionAutocomplete } from '$lib/composables/use-mention-autocomplete.svelte';
  import type { ShortcutScope } from '$lib/shared/personal-settings';

  let {
    onSend,
    replyTo = null,
    onClearReply,
    handles = [],
    quickLaunchScope = null,
    draftKey = null,
    sessionId = null,
  }: {
    onSend: (text: string, replyToId?: string | null) => void;
    replyTo?: any;
    onClearReply?: () => void;
    handles?: { handle: string; name: string }[];
    quickLaunchScope?: ShortcutScope | null;
    draftKey?: string | null;
    /** Required for `/break` — the chat_break marker is a server-side
     *  message kind that needs to know which room it belongs to. When
     *  null the slash-command silently treats `/break` as plain text. */
    sessionId?: string | null;
  } = $props();

  let text = $state('');
  let hydratedDraftKey = $state<string | null>(null);
  let isFocused = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  // @ mention autocomplete — shared with the grid composer via the composable.
  // Fuzzy scoring + @everyone pinning + dropdown navigation all live in
  // src/lib/composables/use-mention-autocomplete.svelte.ts.
  const mention = useMentionAutocomplete(() => handles);
  const activeMentionChips = $derived(activeRoutingMentions(text, mention.routingHandles));

  function draftStorageKey(key: string | null): string | null {
    return key ? `ant.chat.draft.${key}` : null;
  }

  function readDraft(key: string | null): string {
    const storageKey = draftStorageKey(key);
    if (!storageKey || typeof localStorage === 'undefined') return '';
    return localStorage.getItem(storageKey) ?? '';
  }

  function writeDraft(key: string | null, value: string): void {
    const storageKey = draftStorageKey(key);
    if (!storageKey || typeof localStorage === 'undefined') return;
    if (value.length > 0) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  }

  function resizeInput() {
    if (!inputEl) return;
    const viewportHeight = typeof window === 'undefined'
      ? 0
      : (window.visualViewport?.height ?? window.innerHeight);
    const maxHeight = typeof window === 'undefined'
      ? 240
      : Math.max(150, Math.floor(viewportHeight * 0.34));
    inputEl.style.height = 'auto';
    const nextHeight = Math.min(inputEl.scrollHeight, maxHeight);
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function handleInput() {
    detectMention();
    resizeInput();
    if (isFocused) keepComposerVisible();
  }

  function keepComposerVisible() {
    if (!inputEl || typeof window === 'undefined') return;
    window.setTimeout(() => inputEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
    window.setTimeout(() => inputEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
  }

  $effect(() => {
    text;
    queueMicrotask(resizeInput);
  });

  onMount(() => {
    if (!draftKey) return;
    text = readDraft(draftKey);
    hydratedDraftKey = draftKey;
    queueMicrotask(resizeInput);
  });

  $effect(() => {
    if (!draftKey || hydratedDraftKey === draftKey) return;
    text = readDraft(draftKey);
    hydratedDraftKey = draftKey;
    queueMicrotask(resizeInput);
  });

  $effect(() => {
    if (!draftKey || hydratedDraftKey !== draftKey) return;
    writeDraft(draftKey, text);
  });

  $effect(() => {
    if (replyTo) {
      const mention = replyTo.sender_id ? `${replyTo.sender_id} ` : '';
      text = mention;
      setTimeout(() => {
        inputEl?.focus();
        resizeInput();
      }, 0);
    }
  });

  function detectMention() {
    const cursorPos = inputEl?.selectionStart ?? text.length;
    mention.detect(text, cursorPos);
  }

  function selectMention(handle: string) {
    const cursorPos = inputEl?.selectionStart ?? text.length;
    const result = mention.apply(text, cursorPos, handle);
    if (!result) return;
    text = result.text;
    setTimeout(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(result.cursorAfter, result.cursorAfter);
    }, 0);
  }

  function bracketMention(handle: string) {
    text = bracketRoutingMention(text, handle);
    setTimeout(() => {
      inputEl?.focus();
      resizeInput();
    }, 0);
  }

  function insertQuickLaunchCommand(command: string) {
    text = command;
    setTimeout(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(command.length, command.length);
      resizeInput();
    }, 0);
  }

  /** Detect `/break [reason...]` so the composer can post a chat_break
   *  marker instead of a normal user message. The marker bounds future
   *  agent context windows for this room (per
   *  `chat-break-context-window-2026-05-08`). Reason text is optional;
   *  when present it's stored as the marker's content for human
   *  scanning. The marker is rendered as a horizontal divider in
   *  ChatMessages — see the chat_break branch there. */
  const BREAK_COMMAND_RE = /^\/break(?:\s+(.+))?$/i;
  function detectBreakCommand(value: string): { isBreak: boolean; reason: string } {
    const match = value.trim().match(BREAK_COMMAND_RE);
    if (!match) return { isBreak: false, reason: '' };
    return { isBreak: true, reason: (match[1] ?? '').trim() };
  }

  async function postBreakMarker(reason: string): Promise<boolean> {
    if (!sessionId) return false;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'system',
          content: reason || '— break —',
          msg_type: 'chat_break',
          format: 'text',
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // BreakConfirmModal state. The previous flow used a native browser
  // confirm that can silently return false on iOS PWA standalone mode — the
  // break never reached writeMessage and the divider never rendered.
  // The Svelte modal works identically on every surface and lets the
  // operator edit the reason before posting.
  let breakModalOpen = $state(false);
  let breakModalReason = $state('');

  function openBreakModal(reason: string) {
    breakModalReason = reason;
    breakModalOpen = true;
  }

  function cancelBreakModal() {
    breakModalOpen = false;
    // Keep the composer text so the user can edit before retrying.
  }

  async function confirmBreak(reason: string) {
    breakModalOpen = false;
    if (sessionId) {
      await postBreakMarker(reason);
    } else {
      onSend(reason ? `/break ${reason}` : '/break', replyTo?.id ?? null);
    }
    text = '';
    writeDraft(draftKey, '');
    mention.reset();
    onClearReply?.();
    setTimeout(resizeInput, 0);
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;

    const breakIntent = detectBreakCommand(trimmed);
    if (breakIntent.isBreak) {
      // Modal handles confirmation + composer-text reset. Do NOT
      // clear `text` here — cancelBreakModal leaves it intact so
      // the operator can edit the reason and retry.
      openBreakModal(breakIntent.reason);
      return;
    }

    onSend(trimmed, replyTo?.id ?? null);
    text = '';
    writeDraft(draftKey, '');
    mention.reset();
    onClearReply?.();
    setTimeout(resizeInput, 0);
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (res.ok) {
        const { url } = await res.json();
        text += (text && !text.endsWith('\n') ? '\n' : '') + `![image](${url})`;
        inputEl?.focus();
        setTimeout(resizeInput, 0);
      }
    } catch {} finally {
      uploading = false;
      if (fileInputEl) fileInputEl.value = '';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (mention.show && mention.filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mention.arrowDown(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); mention.arrowUp(); return; }
      const current = mention.current();
      if (e.key === 'Tab' && current) {
        e.preventDefault();
        selectMention(current.handle);
        return;
      }
      const cursorPos = inputEl?.selectionStart ?? text.length;
      if (e.key === 'Enter' && current && mention.shouldCompleteOnEnter(text, cursorPos)) {
        e.preventDefault();
        selectMention(current.handle);
        return;
      }
      if (e.key === 'Escape') { mention.reset(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && replyTo) {
      onClearReply?.();
    }
  }
</script>

<BreakConfirmModal
  open={breakModalOpen}
  initialReason={breakModalReason}
  onConfirm={confirmBreak}
  onCancel={cancelBreakModal}
/>

<div class="relative message-input-root" style="padding: 0; border-top: 0.5px solid var(--hairline-strong);">
  {#if quickLaunchScope}
    <QuickLaunchBar
      scope={quickLaunchScope}
      onInsertCommand={insertQuickLaunchCommand}
    />
  {/if}

  <div class="message-input-pad">
  <!-- @ mention dropdown -->
  {#if mention.show && mention.filtered.length > 0}
    <div
      class="absolute bottom-full left-4 right-4 mb-1 overflow-hidden z-10 mention-popover"
      style="
        background: var(--bg-card);
        border-radius: var(--radius-card);
        border: 0.5px solid var(--hairline-strong);
        box-shadow: 0 -8px 24px -12px rgba(0,0,0,0.3);
      "
    >
      {#each mention.filtered as h, i (h.handle)}
        {@const ac = agentColor(h.handle)}
        <button
          onmousedown={(e) => { e.preventDefault(); selectMention(h.handle); }}
          class="w-full touch-target flex items-center justify-start gap-2.5 px-3 py-2 text-left cursor-pointer"
          style="
            font-size: 12px;
            background: {i === mention.selectedIdx ? 'var(--hairline)' : 'transparent'};
            transition: background var(--duration-fast);
          "
        >
          <AgentDot id={h.handle.replace('@', '')} size={8} />
          <span style="font-family: var(--font-mono); font-weight: 600; color: {ac.color};">{h.handle}</span>
          <span style="color: var(--text-muted); font-size: 11px;">{h.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Reply preview -->
  {#if replyTo}
    <div
      class="flex items-center gap-2 mb-2"
      style="
        padding: 8px 12px;
        border-radius: var(--radius-input);
        background: var(--hairline);
        border: 0.5px solid var(--hairline-strong);
        font-size: 12px;
      "
    >
      <NocturneIcon name="reply" size={12} color="var(--text-faint)" />
      <span style="color: var(--text-muted);">Replying to</span>
      <span style="font-family: var(--font-mono); font-weight: 600; color: {agentColor(replyTo.sender_id).color};">
        {replyTo.sender_id ?? (replyTo.role === 'assistant' ? 'Assistant' : 'You')}
      </span>
      <span style="color: var(--text-faint); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {replyTo.content.slice(0, 60)}
      </span>
      <button onclick={onClearReply} class="touch-target cursor-pointer" style="color: var(--text-faint); background: none; border: none; padding: 2px;">
        <NocturneIcon name="x" size={12} />
      </button>
    </div>
  {/if}

  <!-- Active routing mentions -->
  {#if activeMentionChips.length > 0}
    <div
      class="flex items-center gap-1.5 mb-2 overflow-x-auto"
      style="font-size: 11px; color: var(--text-faint);"
    >
      <span class="shrink-0 font-medium">Tagged</span>
      {#each activeMentionChips as h (h.handle)}
        {@const ac = agentColor(h.handle)}
        <span
          class="inline-flex items-center gap-1.5 shrink-0"
          style="
            padding: 3px 6px;
            border-radius: var(--radius-full);
            background: {ac.color}12;
            border: 0.5px solid {ac.color}35;
            color: {ac.color};
          "
          title="This mention will notify {h.name}. Click x to make it visible only."
        >
          <AgentDot id={h.handle.replace('@', '')} size={6} />
          <span style="font-family: var(--font-mono); font-weight: 600;">{h.handle}</span>
          <button
            type="button"
            class="cursor-pointer"
            style="color: {ac.color}; background: none; border: none; padding: 0; line-height: 1;"
            title="Do not notify {h.handle}"
            aria-label="Do not notify {h.handle}"
            onclick={() => bracketMention(h.handle)}
          >
            <NocturneIcon name="x" size={10} color={ac.color} />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- Composer body -->
  <div
    class="composer-shell flex items-end gap-3"
    style="
      background: var(--surface-elev);
      border-radius: var(--radius-panel);
      padding: 12px 14px 10px;
      border: 0.5px solid {isFocused ? NOCTURNE.blue[500] + '60' : 'var(--hairline-strong)'};
      box-shadow: {isFocused ? `0 0 0 1px var(--bg), 0 0 0 3px ${NOCTURNE.blue[600]}40` : 'none'};
      transition: border-color var(--duration-base) var(--spring-default),
                  box-shadow var(--duration-base) var(--spring-default);
    "
  >
    <!-- User avatar -->
    <div
      class="composer-avatar flex-shrink-0 flex items-center justify-center rounded-full"
      style="
        width: 20px; height: 20px; margin-bottom: 2px;
        background: linear-gradient(135deg, var(--text-faint), var(--text-muted));
        font-size: 10px; font-weight: 700; color: var(--bg);
      "
    >J</div>

    <div class="composer-textarea-wrap flex-1 min-w-0">
      <textarea
        bind:this={inputEl}
        placeholder="Send a message… (@ to mention)"
        bind:value={text}
        oninput={handleInput}
        onfocus={() => { isFocused = true; keepComposerVisible(); }}
        onblur={() => (isFocused = false)}
        onkeydown={handleKeydown}
        class="composer-textarea w-full bg-transparent outline-none resize-none"
        style="
          font-family: var(--font-sans);
          font-size: 14px;
          line-height: 1.55;
          letter-spacing: var(--tracking-body);
          color: var(--text);
          min-height: 48px;
          max-height: 35vh;
        "
        rows="2"
      ></textarea>
    </div>

    <!-- Attachment button -->
    <input bind:this={fileInputEl} type="file" accept="image/*" onchange={handleFileSelect} class="hidden" />
    <button
      onclick={() => fileInputEl?.click()}
      disabled={uploading}
      class="composer-attach touch-target flex-shrink-0 cursor-pointer disabled:opacity-40"
      style="color: var(--text-faint); background: none; border: none; padding: 4px; margin-bottom: 2px;"
      title="Attach image"
    >
      {#if uploading}
        <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="8" /></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      {/if}
    </button>

    <!-- Send button -->
    <button
      onclick={handleSubmit}
      disabled={!text.trim()}
      class="composer-send touch-target flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
    >
      <span>Send</span>
      <NocturneIcon name="send" size={11} color="#fff" />
    </button>
  </div>
  </div>
</div>

<style>
  .message-input-root {
    background: var(--bg);
    padding-bottom: max(var(--ant-safe-bottom, 0px), 0px);
    transform: translateY(0);
    transition:
      padding-bottom var(--duration-fast) var(--spring-default),
      transform var(--duration-fast) var(--spring-default);
  }

  .message-input-pad {
    padding: 12px 16px;
    padding-left: max(12px, var(--ant-safe-left, 0px));
    padding-right: max(12px, var(--ant-safe-right, 0px));
  }

  .mention-popover {
    max-height: min(280px, calc(var(--ant-viewport-h, 100vh) * 0.38));
    overflow-y: auto;
  }

  @media (max-width: 640px) {
    .message-input-root {
      position: sticky;
      bottom: 0;
      z-index: 28;
      transform: translateY(calc(-1 * var(--ant-keyboard-h, 0px)));
      will-change: transform;
    }

    .message-input-pad {
      padding: 8px max(8px, var(--ant-safe-right, 0px)) 8px max(8px, var(--ant-safe-left, 0px));
    }

    .composer-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      grid-template-areas:
        "input input input"
        "spacer attach send";
      align-items: end;
      gap: 6px 8px;
      padding: 10px;
      border-radius: 14px;
    }

    .composer-avatar {
      display: none;
    }

    .composer-textarea-wrap {
      grid-area: input;
      width: 100%;
      min-width: 0;
    }

    .composer-textarea {
      min-height: 78px !important;
      max-height: min(190px, calc(var(--ant-viewport-h, 100vh) * 0.32)) !important;
      font-size: 16px !important;
      line-height: 1.45 !important;
    }

    .composer-attach {
      grid-area: attach;
      justify-self: end;
      margin-bottom: 0 !important;
      min-width: 40px;
      min-height: 38px;
    }

    .composer-send {
      grid-area: send;
      justify-self: end;
      min-width: 76px;
      min-height: 38px;
      justify-content: center;
    }
  }
</style>
