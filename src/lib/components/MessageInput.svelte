<script lang="ts">
  import { NOCTURNE, agentColor } from '$lib/nocturne';
  import AgentDot from './AgentDot.svelte';
  import NocturneIcon from './NocturneIcon.svelte';
  import QuickLaunchBar from './QuickLaunchBar.svelte';
  import { activeRoutingMentions, bracketRoutingMention } from '$lib/utils/mentions';

  let {
    onSend,
    replyTo = null,
    onClearReply,
    handles = [],
    quickLaunchSessionId = null,
    quickLaunchDriver = null,
  }: {
    onSend: (text: string, replyToId?: string | null) => void;
    replyTo?: any;
    onClearReply?: () => void;
    handles?: { handle: string; name: string }[];
    quickLaunchSessionId?: string | null;
    quickLaunchDriver?: string | null;
  } = $props();

  let text = $state('');
  let isFocused = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  // @ mention autocomplete
  let mentionQuery = $state('');
  let showMentions = $state(false);
  let mentionStart = $state(-1);
  let mentionSelectedIdx = $state(0);

  const routingHandles = $derived.by(() => {
    if (handles.some((h) => h.handle === '@everyone')) return handles;
    return [...handles, { handle: '@everyone', name: 'Everyone' }];
  });
  const filteredHandles = $derived(
    routingHandles.filter(h => h.handle.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
  );
  const activeMentionChips = $derived(activeRoutingMentions(text, routingHandles));

  function resizeInput() {
    if (!inputEl) return;
    const maxHeight = typeof window === 'undefined'
      ? 240
      : Math.max(160, Math.floor(window.innerHeight * 0.35));
    inputEl.style.height = 'auto';
    const nextHeight = Math.min(inputEl.scrollHeight, maxHeight);
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function handleInput() {
    detectMention();
    resizeInput();
  }

  $effect(() => {
    text;
    queueMicrotask(resizeInput);
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
    const textBefore = text.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([\w.-]*)$/);
    if (atMatch && routingHandles.length > 0) {
      mentionStart = cursorPos - atMatch[0].length;
      mentionQuery = atMatch[1];
      mentionSelectedIdx = 0;
      showMentions = filteredHandles.length > 0;
    } else {
      showMentions = false;
      mentionStart = -1;
    }
  }

  function selectMention(handle: string) {
    const cursorPos = inputEl?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart);
    const after = text.slice(cursorPos);
    text = before + handle + ' ' + after;
    showMentions = false;
    mentionStart = -1;
    setTimeout(() => {
      inputEl?.focus();
      const pos = (before + handle + ' ').length;
      inputEl?.setSelectionRange(pos, pos);
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

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, replyTo?.id ?? null);
    text = '';
    showMentions = false;
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
    if (showMentions && filteredHandles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionSelectedIdx = Math.min(mentionSelectedIdx + 1, filteredHandles.length - 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); mentionSelectedIdx = Math.max(mentionSelectedIdx - 1, 0); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectMention(filteredHandles[mentionSelectedIdx].handle);
        return;
      }
      if (e.key === 'Escape') { showMentions = false; return; }
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

<div class="relative" style="padding: 0; border-top: 0.5px solid var(--hairline-strong);">
  {#if quickLaunchSessionId}
    <QuickLaunchBar
      sessionId={quickLaunchSessionId}
      driver={quickLaunchDriver}
      onInsertCommand={insertQuickLaunchCommand}
    />
  {/if}

  <div style="padding: 12px 16px;">
  <!-- @ mention dropdown -->
  {#if showMentions && filteredHandles.length > 0}
    <div
      class="absolute bottom-full left-4 right-4 mb-1 overflow-hidden z-10"
      style="
        background: var(--bg-card);
        border-radius: var(--radius-card);
        border: 0.5px solid var(--hairline-strong);
        box-shadow: 0 -8px 24px -12px rgba(0,0,0,0.3);
      "
    >
      {#each filteredHandles as h, i}
        {@const ac = agentColor(h.handle)}
        <button
          onmousedown={(e) => { e.preventDefault(); selectMention(h.handle); }}
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer"
          style="
            font-size: 12px;
            background: {i === mentionSelectedIdx ? 'var(--hairline)' : 'transparent'};
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
      <button onclick={onClearReply} class="cursor-pointer" style="color: var(--text-faint); background: none; border: none; padding: 2px;">
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
    class="flex items-end gap-3"
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
      class="flex-shrink-0 flex items-center justify-center rounded-full"
      style="
        width: 20px; height: 20px; margin-bottom: 2px;
        background: linear-gradient(135deg, var(--text-faint), var(--text-muted));
        font-size: 10px; font-weight: 700; color: var(--bg);
      "
    >J</div>

    <div class="flex-1 min-w-0">
      <textarea
        bind:this={inputEl}
        placeholder="Send a message… (@ to mention)"
        bind:value={text}
        oninput={handleInput}
        onfocus={() => (isFocused = true)}
        onblur={() => (isFocused = false)}
        onkeydown={handleKeydown}
        class="w-full bg-transparent outline-none resize-none"
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
      class="flex-shrink-0 cursor-pointer disabled:opacity-40"
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
      class="flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
