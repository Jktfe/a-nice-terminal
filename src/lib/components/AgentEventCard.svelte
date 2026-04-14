<script lang="ts">
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

  function respond(type: string, choice: Record<string, any>) {
    onRespond({
      type,
      event_content: message.content,
      choice,
    });
  }
</script>

{#if settled}
  <!-- Collapsed single-line summary -->
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
       style="background:#1A1F2B;border:1px solid #30363D;color:#8B949E;font-family:Inter,sans-serif;">
    <span class="opacity-60">✓</span>
    <span>
      {#if event.class === 'permission_request'}
        Permission {chosenAction || 'handled'}: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">{event.payload.command || event.payload.file || event.text || '—'}</code>
      {:else if event.class === 'multi_choice'}
        Selected: {chosenAction || 'option'}
      {:else if event.class === 'confirmation'}
        {chosenAction === 'confirm' ? 'Confirmed' : chosenAction === 'cancel' ? 'Cancelled' : 'Handled'}
      {:else if event.class === 'free_text'}
        Text submitted
      {:else if event.class === 'tool_auth'}
        {event.payload.tool || 'Tool'} {chosenAction || 'authorised'}
      {:else if event.class === 'progress'}
        {event.payload.message || event.text || 'Completed'}
      {:else if event.class === 'error_retry'}
        Error {chosenAction === 'retry' ? 'retried' : 'resolved'}
      {:else}
        Event handled
      {/if}
    </span>
  </div>
{:else}
  <!-- Full card -->
  <div class="rounded-lg overflow-hidden"
       style="background:#1A1F2B;border:1px solid {active ? '#3B82F680' : '#30363D'};font-family:Inter,sans-serif;{active ? 'box-shadow:0 0 8px #3B82F620;' : ''}">
    <div class="px-4 py-3">
      <!-- Event class label -->
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
              style="background:#30363D;color:#8B949E;">
          {event.class.replace('_', ' ')}
        </span>
      </div>

      {#if event.class === 'permission_request'}
        <div class="mb-3">
          {#if event.payload.command}
            <p class="text-xs mb-1" style="color:#8B949E;">Command:</p>
            <code class="block text-sm px-2 py-1.5 rounded" style="background:#0D1117;color:#E6EDF3;font-family:'JetBrains Mono',monospace;">{event.payload.command}</code>
          {/if}
          {#if event.payload.file}
            <p class="text-xs mb-1 {event.payload.command ? 'mt-2' : ''}" style="color:#8B949E;">File:</p>
            <code class="block text-sm px-2 py-1.5 rounded" style="background:#0D1117;color:#E6EDF3;font-family:'JetBrains Mono',monospace;">{event.payload.file}</code>
          {/if}
          {#if event.text && !event.payload.command && !event.payload.file}
            <p class="text-sm" style="color:#E6EDF3;">{event.text}</p>
          {/if}
        </div>
        {#if responded}
          <p class="text-xs font-medium" style="color:{chosenAction === 'approve' ? '#22C55E' : '#EF4444'};">
            ✓ {chosenAction === 'approve' ? 'Approved' : 'Denied'}
          </p>
        {:else}
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#22C55E;" disabled={!active}
                    onclick={() => respond('approve', { action: 'approve' })}>Approve</button>
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#EF4444;" disabled={!active}
                    onclick={() => respond('deny', { action: 'deny' })}>Deny</button>
          </div>
        {/if}

      {:else if event.class === 'multi_choice'}
        {@const options = event.payload.options || (event.text ? event.text.split('\n').filter(Boolean) : [])}
        <div class="flex flex-col gap-1.5 mb-1">
          {#each options as opt, i}
            {@const label = typeof opt === 'string' ? opt : (opt.label || opt.name || `Option ${i + 1}`)}
            {#if responded}
              <p class="text-xs px-2 py-1 rounded" style="color:{chosenAction === label ? '#E6EDF3' : '#8B949E'};background:{chosenAction === label ? '#3B82F6' : 'transparent'};">
                {chosenAction === label ? '✓ ' : ''}{label}
              </p>
            {:else}
              <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white text-left cursor-pointer"
                      style="background:#3B82F6;" disabled={!active}
                      onclick={() => respond('select', { selected: label, index: i })}>{label}</button>
            {/if}
          {/each}
        </div>

      {:else if event.class === 'confirmation'}
        <p class="text-sm mb-3" style="color:#E6EDF3;">{event.payload.question || event.text || 'Please confirm.'}</p>
        {#if responded}
          <p class="text-xs font-medium" style="color:{chosenAction === 'confirm' ? '#22C55E' : '#EF4444'};">
            ✓ {chosenAction === 'confirm' ? 'Confirmed' : 'Cancelled'}
          </p>
        {:else}
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#22C55E;" disabled={!active}
                    onclick={() => respond('confirm', { action: 'confirm' })}>Confirm</button>
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#EF4444;" disabled={!active}
                    onclick={() => respond('confirm', { action: 'cancel' })}>Cancel</button>
          </div>
        {/if}

      {:else if event.class === 'free_text'}
        <p class="text-sm mb-2" style="color:#E6EDF3;">{event.payload.prompt || event.text || 'Enter your response:'}</p>
        {#if responded}
          <p class="text-xs font-medium" style="color:#22C55E;">✓ Submitted</p>
        {:else}
          {@const inputId = `free-text-${message.id}`}
          <div class="flex gap-2">
            <input id={inputId} type="text" placeholder="Type here…"
                   class="flex-1 px-2 py-1.5 text-xs rounded-md border"
                   style="background:#0D1117;border-color:#30363D;color:#E6EDF3;font-family:'JetBrains Mono',monospace;"
                   disabled={!active} />
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#3B82F6;" disabled={!active}
                    onclick={() => {
                      const el = document.getElementById(inputId) as HTMLInputElement;
                      if (el?.value.trim()) respond('text', { text: el.value.trim() });
                    }}>Submit</button>
          </div>
        {/if}

      {:else if event.class === 'tool_auth'}
        <p class="text-sm mb-3" style="color:#E6EDF3;">
          Authorise <code style="font-family:'JetBrains Mono',monospace;color:#3B82F6;">{event.payload.tool || 'tool'}</code>?
        </p>
        {#if responded}
          <p class="text-xs font-medium" style="color:{chosenAction === 'authorise' ? '#22C55E' : '#EF4444'};">
            ✓ {chosenAction === 'authorise' ? 'Authorised' : 'Denied'}
          </p>
        {:else}
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#22C55E;" disabled={!active}
                    onclick={() => respond('approve', { action: 'authorise', tool: event.payload.tool })}>Authorise</button>
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#EF4444;" disabled={!active}
                    onclick={() => respond('deny', { action: 'deny', tool: event.payload.tool })}>Deny</button>
          </div>
        {/if}

      {:else if event.class === 'progress'}
        <div class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full animate-pulse" style="background:#3B82F6;"></span>
          <p class="text-sm" style="color:#E6EDF3;">{event.payload.message || event.text || 'Working…'}</p>
        </div>

      {:else if event.class === 'error_retry'}
        <p class="text-sm mb-3" style="color:#EF4444;">{event.payload.error || event.text || 'An error occurred.'}</p>
        {#if responded}
          <p class="text-xs font-medium" style="color:{chosenAction === 'retry' ? '#3B82F6' : '#EF4444'};">
            ✓ {chosenAction === 'retry' ? 'Retried' : 'Aborted'}
          </p>
        {:else}
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#3B82F6;" disabled={!active}
                    onclick={() => respond('retry', { action: 'retry' })}>Retry</button>
            <button class="px-3 py-1.5 text-xs font-medium rounded-md text-white cursor-pointer"
                    style="background:#EF4444;" disabled={!active}
                    onclick={() => respond('abort', { action: 'abort' })}>Abort</button>
          </div>
        {/if}

      {:else}
        <!-- Unknown event class fallback -->
        <p class="text-sm" style="color:#E6EDF3;">{event.text || JSON.stringify(event.payload)}</p>
      {/if}
    </div>
  </div>
{/if}
