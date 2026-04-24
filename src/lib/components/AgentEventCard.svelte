<script lang="ts">
  import { NOCTURNE } from '$lib/nocturne';
  import NocturneIcon from './NocturneIcon.svelte';

  let { message, sessionId, onRespond }: {
    message: any;
    sessionId: string;
    onRespond: (choice: any) => void;
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
  const active = $derived(status === 'pending' || !meta.status);
  const chosenAction: string = $derived(meta.chosen || '');

  const statusPill = $derived.by(() => {
    if (settled) return { color: NOCTURNE.emerald[400], label: 'done' };
    if (responded) return { color: NOCTURNE.emerald[400], label: 'responded' };
    return { color: NOCTURNE.amber[400], label: 'pending' };
  });

  const eventLabel = $derived(event.class.replace(/_/g, ' '));

  function respond(type: string, choice: Record<string, any>) {
    onRespond({ type, event_content: message.content, choice });
  }
</script>

{#if settled}
  <!-- Collapsed summary -->
  <div
    class="flex items-center gap-2"
    style="
      padding: 8px 12px;
      border-radius: var(--radius-input);
      background: var(--hairline);
      border: 0.5px solid var(--hairline-strong);
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--text-muted);
    "
  >
    <span style="color: {NOCTURNE.emerald[400]};">✓</span>
    <span>
      {#if event.class === 'permission_request'}
        Permission {chosenAction || 'handled'}: <code style="color: var(--text);">{event.payload.command || event.payload.file || event.text || '—'}</code>
      {:else if event.class === 'multi_choice'}
        Selected: {chosenAction || 'option'}
      {:else if event.class === 'confirmation'}
        {chosenAction === 'confirm' ? 'Confirmed' : chosenAction === 'cancel' ? 'Cancelled' : 'Handled'}
      {:else if event.class === 'tool_auth'}
        {event.payload.tool || 'Tool'} {chosenAction || 'authorised'}
      {:else}
        Event handled
      {/if}
    </span>
  </div>
{:else}
  <!-- Full Nocturne tool-call card -->
  <div
    style="
      border-radius: var(--radius-card);
      overflow: hidden;
      background: var(--bg-card);
      border: 0.5px solid {active ? NOCTURNE.blue[500] + '40' : 'var(--hairline-strong)'};
      box-shadow: {active ? `0 0 12px ${NOCTURNE.blue[500]}15` : 'none'};
    "
  >
    <!-- Header -->
    <div
      class="flex items-center gap-2"
      style="
        padding: 8px 12px;
        border-bottom: 0.5px solid var(--hairline-strong);
        background: {NOCTURNE.blue[500]}08;
      "
    >
      <NocturneIcon name="terminal" size={12} color={NOCTURNE.blue[400]} />
      <span style="font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0; color: {NOCTURNE.blue[300]};">
        {eventLabel}
      </span>
      <span style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); padding: 1px 6px; border-radius: 4px; background: var(--hairline);">
        agent_event
      </span>
      <div class="flex-1"></div>
      <!-- Status pill -->
      <span class="flex items-center gap-1" style="font-family: var(--font-mono); font-size: 10.5px; color: {statusPill.color}; padding: 1px 6px; border-radius: 4px; background: {statusPill.color}18; border: 0.5px solid {statusPill.color}40;">
        <div class="rounded-full" style="width: 5px; height: 5px; background: {statusPill.color}; box-shadow: 0 0 5px {statusPill.color};"></div>
        {statusPill.label}
      </span>
    </div>

    <!-- Content -->
    <div style="padding: 10px 12px;">
      {#if event.class === 'permission_request'}
        {#if event.payload.command}
          <div class="flex gap-2" style="font-family: var(--font-mono); font-size: 12px; line-height: 1.6;">
            <span style="color: var(--text-faint); min-width: 68px;">command</span>
            <span style="color: var(--text);">{event.payload.command}</span>
          </div>
        {/if}
        {#if event.payload.file}
          <div class="flex gap-2" style="font-family: var(--font-mono); font-size: 12px; line-height: 1.6;">
            <span style="color: var(--text-faint); min-width: 68px;">file</span>
            <span style="color: var(--text);">{event.payload.file}</span>
          </div>
        {/if}
        {#if event.text && !event.payload.command && !event.payload.file}
          <div style="font-size: 13px; color: var(--text);">{event.text}</div>
        {/if}

      {:else if event.class === 'multi_choice'}
        {@const options = event.payload.options || (event.text ? event.text.split('\n').filter(Boolean) : [])}
        <div class="flex flex-col gap-1.5">
          {#each options as opt, i}
            {@const label = typeof opt === 'string' ? opt : (opt.label || opt.name || `Option ${i + 1}`)}
            {#if responded}
              <div style="font-family: var(--font-mono); font-size: 12px; color: {chosenAction === label ? 'var(--text)' : 'var(--text-faint)'}; padding: 4px 8px; border-radius: 6px; background: {chosenAction === label ? NOCTURNE.blue[500] + '22' : 'transparent'};">
                {chosenAction === label ? '✓ ' : ''}{label}
              </div>
            {:else}
              <button
                class="text-left cursor-pointer"
                style="font-family: var(--font-mono); font-size: 12px; color: {NOCTURNE.blue[300]}; background: {NOCTURNE.blue[500]}12; border: 0.5px solid {NOCTURNE.blue[500]}30; padding: 6px 10px; border-radius: 6px;"
                disabled={!active}
                onclick={() => respond('select', { selected: label, index: i })}
              >{label}</button>
            {/if}
          {/each}
        </div>

      {:else if event.class === 'confirmation'}
        <div style="font-size: 13px; color: var(--text); margin-bottom: 8px;">{event.payload.question || event.text || 'Please confirm.'}</div>

      {:else if event.class === 'free_text'}
        <div style="font-size: 13px; color: var(--text); margin-bottom: 8px;">{event.payload.prompt || event.text || 'Enter your response:'}</div>
        {#if !responded}
          {@const inputId = `free-text-${message.id}`}
          <div class="flex gap-2">
            <input
              id={inputId}
              type="text"
              placeholder="Type here…"
              class="flex-1"
              style="font-family: var(--font-mono); font-size: 12px; padding: 6px 10px; border-radius: var(--radius-input); background: var(--bg-input); border: 0.5px solid var(--hairline-strong); color: var(--text);"
              disabled={!active}
            />
            <button
              class="cursor-pointer"
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: #fff; background: linear-gradient(180deg, {NOCTURNE.blue[500]}, {NOCTURNE.blue[600]}); border: 0.5px solid {NOCTURNE.blue[400]}; padding: 6px 12px; border-radius: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 0 rgba(0,0,0,0.15);"
              disabled={!active}
              onclick={() => {
                const el = document.getElementById(inputId) as HTMLInputElement;
                if (el?.value.trim()) respond('text', { value: el.value.trim() });
              }}
            >Submit</button>
          </div>
        {/if}

      {:else if event.class === 'tool_auth'}
        <div style="font-size: 13px; color: var(--text);">
          Authorise <code style="font-family: var(--font-mono); color: {NOCTURNE.blue[300]}; background: {NOCTURNE.blue[500]}14; padding: 1px 5px; border-radius: 4px;">{event.payload.tool || 'tool'}</code>?
        </div>

      {:else if event.class === 'progress'}
        <div class="flex items-center gap-2">
          <div class="rounded-full animate-breathe" style="width: 6px; height: 6px; background: {NOCTURNE.blue[400]};"></div>
          <span style="font-size: 13px; color: var(--text);">{event.payload.message || event.text || 'Working…'}</span>
        </div>

      {:else if event.class === 'error_retry'}
        <div style="font-size: 13px; color: {NOCTURNE.semantic.danger}; margin-bottom: 8px;">{event.payload.error || event.text || 'An error occurred.'}</div>

      {:else}
        <div style="font-size: 13px; color: var(--text);">{event.text || JSON.stringify(event.payload)}</div>
      {/if}

      <!-- Response status -->
      {#if responded}
        <div class="mt-2" style="font-size: 11px; font-family: var(--font-mono); color: {chosenAction === 'deny' || chosenAction === 'cancel' || chosenAction === 'abort' ? NOCTURNE.semantic.danger : NOCTURNE.emerald[400]};">
          ✓ {chosenAction === 'approve' ? 'Approved' : chosenAction === 'deny' ? 'Denied' : chosenAction === 'confirm' ? 'Confirmed' : chosenAction === 'cancel' ? 'Cancelled' : chosenAction === 'retry' ? 'Retried' : chosenAction === 'abort' ? 'Aborted' : chosenAction || 'Responded'}
        </div>
      {/if}
    </div>

    <!-- Approval row (for permission_request, confirmation, tool_auth, error_retry) -->
    {#if active && !responded && (event.class === 'permission_request' || event.class === 'confirmation' || event.class === 'tool_auth' || event.class === 'error_retry')}
      <div
        class="flex gap-2"
        style="
          padding: 10px 12px;
          border-top: 0.5px solid var(--hairline-strong);
          background: {NOCTURNE.amber[400]}08;
        "
      >
        <div class="flex-1 flex items-center gap-1.5">
          <div class="rounded-full" style="width: 6px; height: 6px; background: {NOCTURNE.amber[400]}; box-shadow: 0 0 6px {NOCTURNE.amber[400]};"></div>
          <span style="font-family: var(--font-mono); font-size: 11px; color: {NOCTURNE.amber[300]};">
            Awaiting your approval
          </span>
        </div>

        <!-- Deny / Cancel / Abort -->
        <button
          class="flex items-center gap-1.5 cursor-pointer"
          style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--text); background: transparent; border: 0.5px solid var(--hairline-strong); padding: 5px 10px; border-radius: 6px;"
          onclick={() => respond(
            event.class === 'error_retry' ? 'abort' : event.class === 'confirmation' ? 'confirm' : 'deny',
            event.class === 'error_retry' ? { action: 'abort' } :
            event.class === 'confirmation' ? { yes: false } :
            event.class === 'tool_auth' ? { action: 'deny', tool: event.payload.tool } :
            { action: 'deny' }
          )}
        >
          <NocturneIcon name="x" size={11} />
          <span>{event.class === 'error_retry' ? 'Abort' : event.class === 'confirmation' ? 'Cancel' : 'Deny'}</span>
        </button>

        <!-- Approve / Confirm / Retry -->
        <button
          class="flex items-center gap-1.5 cursor-pointer"
          style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: #fff; background: linear-gradient(180deg, {NOCTURNE.blue[500]}, {NOCTURNE.blue[600]}); border: 0.5px solid {NOCTURNE.blue[400]}; padding: 5px 10px; border-radius: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 0 rgba(0,0,0,0.15);"
          onclick={() => respond(
            event.class === 'error_retry' ? 'retry' : event.class === 'confirmation' ? 'confirm' : 'approve',
            event.class === 'error_retry' ? { action: 'retry' } :
            event.class === 'confirmation' ? { yes: true } :
            event.class === 'tool_auth' ? { action: 'authorise', tool: event.payload.tool } :
            { action: 'approve' }
          )}
        >
          <NocturneIcon name="play" size={11} color="#fff" />
          <span>{event.class === 'error_retry' ? 'Retry' : event.class === 'confirmation' ? 'Confirm' : event.class === 'tool_auth' ? 'Authorise' : 'Run'}</span>
        </button>
      </div>
    {/if}
  </div>
{/if}
