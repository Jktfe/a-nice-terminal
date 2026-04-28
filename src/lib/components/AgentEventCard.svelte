<script lang="ts">
  import { NOCTURNE } from '$lib/nocturne';
  import NocturneIcon from './NocturneIcon.svelte';

  let { message, sessionId, onRespond, onDiscard }: {
    message: any;
    sessionId: string;
    onRespond: (choice: any) => void;
    onDiscard?: (message: any) => void | Promise<void>;
  } = $props();

  interface NormalisedEvent {
    class: string;
    payload: Record<string, any>;
    text?: string;
  }

  const event: NormalisedEvent = $derived.by(() => {
    try { return JSON.parse(message.content); }
    catch { return { class: 'error_retry', payload: {}, text: message.content }; }
  });

  const meta = $derived.by(() => {
    try { return message.meta ? JSON.parse(message.meta) : {}; }
    catch { return {}; }
  });

  const status: string = $derived(meta.status || 'pending');
  const responded = $derived(status === 'responded');
  const settled = $derived(status === 'settled');
  const discarded = $derived(status === 'discarded' || status === 'dismissed');
  const active = $derived(status === 'pending' || !meta.status);
  const chosenAction: string = $derived(meta.chosen || '');
  const eventDetail = $derived.by(() => {
    const payload = event.payload ?? {};
    return String(
      payload.command ||
      payload.file ||
      payload.tool ||
      payload.question ||
      payload.prompt ||
      payload.message ||
      payload.error ||
      event.text ||
      JSON.stringify(payload)
    );
  });
  const discardedLabel = $derived(
    meta.discard_reason === 'agent_moved_on' || chosenAction === 'moved_on'
      ? 'Agent moved on'
      : 'Discarded'
  );

  const isPerm = $derived(event.class === 'permission_request' || event.class === 'tool_auth');
  const isQuestion = $derived(event.class === 'free_text' || event.class === 'multi_choice' || event.class === 'confirmation');
  const isProgress = $derived(event.class === 'progress');
  const isError = $derived(event.class === 'error_retry');

  // Accent colour by type
  const accent = $derived(
    isPerm ? NOCTURNE.amber[400] :
    isError ? NOCTURNE.semantic.danger :
    isProgress ? NOCTURNE.emerald[400] :
    NOCTURNE.blue[400]
  );

  // Icon by type
  const iconName = $derived(
    isPerm ? 'terminal' :
    isError ? 'x' :
    isProgress ? 'sparkle' :
    'cpu'
  );

  // Human-readable label
  const label = $derived(
    isPerm ? (event.class === 'tool_auth' ? 'Tool authorisation' : 'Permission required') :
    isError ? 'Error' :
    isProgress ? (event.payload?.action || event.payload?.tool || 'Working') :
    event.class === 'free_text' ? 'Question' :
    event.class === 'multi_choice' ? 'Choose' :
    event.class === 'confirmation' ? 'Confirm' :
    event.class.replace(/_/g, ' ')
  );

  function respond(type: string, choice: Record<string, any>) {
    onRespond({ type, event_id: message.id, event_content: message.content, choice });
  }

  function discard() {
    onDiscard?.(message);
  }
</script>

<!-- ─── Settled: collapsed single-line summary ─── -->
{#if discarded}
  <div
    class="flex flex-col gap-1"
    style="
      padding: 8px 12px;
      border-radius: var(--radius-input);
      background: var(--hairline);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-faint);
    "
  >
    <div class="flex items-center gap-2">
      <span style="color: var(--text-faint);">✕</span>
      <span>{discardedLabel}: <span style="color: var(--text-muted);">{label}</span></span>
    </div>
    {#if eventDetail && eventDetail !== '{}'}
      <div
        style="
          color: var(--text-muted);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          line-height: 1.4;
        "
      >{eventDetail}</div>
    {/if}
  </div>
{:else if settled}
  <div
    class="flex items-center gap-2"
    style="
      padding: 6px 12px;
      border-radius: var(--radius-input);
      background: var(--hairline);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-faint);
    "
  >
    <span style="color: {NOCTURNE.emerald[400]};">✓</span>
    <span>
      {#if isPerm}
        {chosenAction === 'approve' ? 'Approved' : chosenAction === 'deny' ? 'Denied' : 'Handled'}:
        <span style="color: var(--text-muted);">{event.payload.command || event.payload.file || event.payload.tool || '—'}</span>
      {:else if event.class === 'multi_choice'}
        Selected: <span style="color: var(--text-muted);">{chosenAction || 'option'}</span>
      {:else if event.class === 'confirmation'}
        {chosenAction === 'confirm' ? 'Confirmed' : 'Cancelled'}
      {:else}
        {label} — done
      {/if}
    </span>
  </div>

<!-- ─── Progress: inline indicator, no card frame ─── -->
{:else if isProgress}
  <div
    class="flex items-center gap-2"
    style="
      padding: 6px 0;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    "
  >
    <div class="rounded-full animate-breathe" style="width: 6px; height: 6px; background: {NOCTURNE.emerald[400]};"></div>
    <span>{event.payload?.action || event.payload?.tool || 'Working'}</span>
    {#if event.payload?.detail}
      <span style="color: var(--text-faint);">{event.payload.detail}</span>
    {:else if event.payload?.file}
      <span style="color: var(--text-faint);">{event.payload.file}</span>
    {:else if event.payload?.command}
      <span style="color: var(--text-faint);">{event.payload.command}</span>
    {/if}
  </div>

<!-- ─── Permission Card: security checkpoint style ─── -->
{:else if isPerm}
  <div class="event-card" style="--card-accent: {accent};">
    <!-- Header -->
    <div class="event-header" style="background: {accent}0A;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent} stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span class="event-label" style="color: {accent};">{label}</span>
      <div class="flex-1"></div>
      {#if active}
        <span class="event-badge animate-pulse-subtle" style="color: {accent}; background: {accent}18; border-color: {accent}40;">
          awaiting
        </span>
      {:else if responded}
        <span class="event-badge" style="color: {chosenAction === 'deny' ? NOCTURNE.semantic.danger : NOCTURNE.emerald[400]}; background: {chosenAction === 'deny' ? NOCTURNE.semantic.danger : NOCTURNE.emerald[400]}18; border-color: {chosenAction === 'deny' ? NOCTURNE.semantic.danger : NOCTURNE.emerald[400]}40;">
          {chosenAction === 'approve' ? '✓ approved' : chosenAction === 'deny' ? '✕ denied' : '✓ responded'}
        </span>
      {/if}
    </div>

    <!-- Content -->
    <div class="event-body">
      {#if event.payload.command}
        <code class="event-code">{event.payload.command}</code>
      {:else if event.payload.file}
        <div class="event-field">
          <span class="event-field-label">{event.payload.subclass === 'edit' ? 'edit' : 'file'}</span>
          <code class="event-code-inline">{event.payload.file}</code>
        </div>
      {:else if event.payload.tool}
        <div class="event-field">
          <span class="event-field-label">tool</span>
          <code class="event-code-inline">{event.payload.tool}</code>
        </div>
      {:else if event.text}
        <p class="event-text">{event.text}</p>
      {/if}
    </div>

    <!-- Action row -->
    {#if active && !responded}
      <div class="event-actions" style="background: {accent}06;">
        <div class="flex-1"></div>
        {#if onDiscard}
          <button class="event-btn event-btn-secondary" onclick={discard}>
            <NocturneIcon name="x" size={11} />
            <span>Discard</span>
          </button>
        {/if}
        <button class="event-btn event-btn-secondary" onclick={() => respond(
          event.class === 'tool_auth' ? 'deny' : 'deny',
          event.class === 'tool_auth' ? { action: 'deny', tool: event.payload.tool } : { action: 'deny' }
        )}>
          <NocturneIcon name="x" size={11} />
          <span>Deny</span>
        </button>
        <button class="event-btn event-btn-primary" style="--btn-color: {accent};" onclick={() => respond(
          event.class === 'tool_auth' ? 'approve' : 'approve',
          event.class === 'tool_auth' ? { action: 'authorise', tool: event.payload.tool } : { action: 'approve' }
        )}>
          <NocturneIcon name="play" size={11} color="#fff" />
          <span>{event.class === 'tool_auth' ? 'Authorise' : 'Run'}</span>
        </button>
      </div>
    {/if}
  </div>

<!-- ─── Error Card ─── -->
{:else if isError}
  <div class="event-card" style="--card-accent: {accent};">
    <div class="event-header" style="background: {accent}0A;">
      <NocturneIcon name="x" size={14} color={accent} />
      <span class="event-label" style="color: {accent};">Error</span>
      <div class="flex-1"></div>
      {#if active}
        <span class="event-badge animate-pulse-subtle" style="color: {accent}; background: {accent}18; border-color: {accent}40;">action needed</span>
      {/if}
    </div>
    <div class="event-body">
      <p class="event-text" style="color: {accent};">{event.payload.error || event.payload.message || event.text || 'An error occurred.'}</p>
    </div>
    {#if active && !responded}
      <div class="event-actions" style="background: {accent}06;">
        <div class="flex-1"></div>
        {#if onDiscard}
          <button class="event-btn event-btn-secondary" onclick={discard}>
            <NocturneIcon name="x" size={11} />
            <span>Discard</span>
          </button>
        {/if}
        <button class="event-btn event-btn-secondary" onclick={() => respond('abort', { action: 'abort' })}>
          <NocturneIcon name="x" size={11} />
          <span>Abort</span>
        </button>
        <button class="event-btn event-btn-primary" style="--btn-color: {accent};" onclick={() => respond('retry', { action: 'retry' })}>
          <NocturneIcon name="play" size={11} color="#fff" />
          <span>Retry</span>
        </button>
      </div>
    {/if}
  </div>

<!-- ─── Question Card: conversation style with agent colour ─── -->
{:else if isQuestion}
  <div class="event-card" style="--card-accent: {accent};">
    <div class="event-header" style="background: {accent}08;">
      <NocturneIcon name="cpu" size={14} color={accent} />
      <span class="event-label" style="color: {accent};">{label}</span>
      <div class="flex-1"></div>
      {#if responded}
        <span class="event-badge" style="color: {NOCTURNE.emerald[400]}; background: {NOCTURNE.emerald[400]}18; border-color: {NOCTURNE.emerald[400]}40;">
          ✓ {chosenAction || 'answered'}
        </span>
      {:else if active}
        <span class="event-badge animate-pulse-subtle" style="color: {accent}; background: {accent}18; border-color: {accent}40;">
          waiting
        </span>
      {/if}
    </div>

    <div class="event-body">
      <p class="event-text">{event.payload.question || event.payload.prompt || event.text || 'Please respond.'}</p>

      {#if event.class === 'multi_choice'}
        {@const options = event.payload.options || (event.text ? event.text.split('\n').filter(Boolean) : [])}
        <div class="flex flex-col gap-1.5 mt-2">
          {#each options as opt, i}
            {@const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.name || `Option ${i + 1}`)}
            {#if responded}
              <div class="event-option" class:event-option-selected={chosenAction === optLabel}>
                {chosenAction === optLabel ? '✓ ' : ''}{optLabel}
              </div>
            {:else}
              <button class="event-option event-option-active" disabled={!active}
                onclick={() => respond('select', { selected: optLabel, index: i })}
              >{optLabel}</button>
            {/if}
          {/each}
        </div>
        {#if active && !responded && onDiscard}
          <div class="event-actions mt-3" style="border-top: none; padding: 0;">
            <div class="flex-1"></div>
            <button class="event-btn event-btn-secondary" onclick={discard}>
              <NocturneIcon name="x" size={11} />
              <span>Discard</span>
            </button>
          </div>
        {/if}

      {:else if event.class === 'free_text' && !responded}
        {@const inputId = `free-text-${message.id}`}
        <div class="flex gap-2 mt-3">
          <input id={inputId} type="text" placeholder="Type your response…"
            class="event-input" disabled={!active}
            onkeydown={(e) => { if (e.key === 'Enter') { const el = e.target as HTMLInputElement; if (el.value.trim()) respond('text', { value: el.value.trim() }); } }}
          />
          {#if active && onDiscard}
            <button class="event-btn event-btn-secondary" onclick={discard}>
              <NocturneIcon name="x" size={11} />
              <span>Discard</span>
            </button>
          {/if}
          <button class="event-btn event-btn-primary" style="--btn-color: {accent};" disabled={!active}
            onclick={() => { const el = document.getElementById(inputId) as HTMLInputElement; if (el?.value.trim()) respond('text', { value: el.value.trim() }); }}
          >
            <NocturneIcon name="send" size={11} color="#fff" />
          </button>
        </div>

      {:else if event.class === 'confirmation' && active && !responded}
        <div class="event-actions mt-3" style="border-top: none; padding: 0;">
          <div class="flex-1"></div>
          {#if onDiscard}
            <button class="event-btn event-btn-secondary" onclick={discard}>
              <NocturneIcon name="x" size={11} />
              <span>Discard</span>
            </button>
          {/if}
          <button class="event-btn event-btn-secondary" onclick={() => respond('confirm', { yes: false })}>
            <NocturneIcon name="x" size={11} />
            <span>Cancel</span>
          </button>
          <button class="event-btn event-btn-primary" style="--btn-color: {accent};" onclick={() => respond('confirm', { yes: true })}>
            <NocturneIcon name="check" size={11} color="#fff" />
            <span>Confirm</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

<!-- ─── Fallback ─── -->
{:else}
  <div class="event-card" style="--card-accent: {accent};">
    <div class="event-header">
      <NocturneIcon name="sparkle" size={14} color={accent} />
      <span class="event-label" style="color: {accent};">{label}</span>
    </div>
    <div class="event-body">
      <p class="event-text">{event.text || JSON.stringify(event.payload)}</p>
    </div>
  </div>
{/if}

<style>
  .event-card {
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--bg-card);
    border: 0.5px solid color-mix(in srgb, var(--card-accent) 25%, var(--hairline-strong));
  }

  .event-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 0.5px solid var(--hairline-strong);
  }

  .event-label {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .event-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    border: 0.5px solid;
  }

  .event-body {
    padding: 10px 12px;
  }

  .event-text {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
    margin: 0;
  }

  .event-code {
    display: block;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg-input);
    padding: 8px 10px;
    border-radius: var(--radius-input);
    border: 0.5px solid var(--hairline-strong);
    word-break: break-all;
    white-space: pre-wrap;
  }

  .event-code-inline {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    background: var(--bg-input);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .event-field {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .event-field-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    min-width: 40px;
  }

  .event-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 0.5px solid var(--hairline-strong);
  }

  .event-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all var(--duration-fast) var(--spring-default);
  }

  .event-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .event-btn-secondary {
    color: var(--text);
    background: transparent;
    border: 0.5px solid var(--hairline-strong);
  }

  .event-btn-secondary:hover:not(:disabled) {
    background: var(--hairline);
  }

  .event-btn-primary {
    color: #fff;
    background: linear-gradient(180deg, var(--btn-color, var(--card-accent)), color-mix(in srgb, var(--btn-color, var(--card-accent)) 85%, black));
    border: 0.5px solid color-mix(in srgb, var(--btn-color, var(--card-accent)) 80%, white);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 0 rgba(0,0,0,0.15);
  }

  .event-btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .event-input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-input);
    background: var(--bg-input);
    border: 0.5px solid var(--hairline-strong);
    color: var(--text);
    outline: none;
  }

  .event-input:focus {
    border-color: var(--card-accent);
    box-shadow: 0 0 0 1px var(--bg), 0 0 0 3px color-mix(in srgb, var(--card-accent) 30%, transparent);
  }

  .event-option {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-input);
    color: var(--text-muted);
  }

  .event-option-selected {
    color: var(--text);
    background: color-mix(in srgb, var(--card-accent) 15%, transparent);
    border: 0.5px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
  }

  .event-option-active {
    text-align: left;
    cursor: pointer;
    color: var(--text);
    background: color-mix(in srgb, var(--card-accent) 8%, transparent);
    border: 0.5px solid color-mix(in srgb, var(--card-accent) 25%, transparent);
    transition: all var(--duration-fast) var(--spring-default);
  }

  .event-option-active:hover:not(:disabled) {
    background: color-mix(in srgb, var(--card-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--card-accent) 45%, transparent);
  }
</style>
