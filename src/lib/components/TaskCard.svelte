<script lang="ts">
  let { task, sessionId, allSessions = [], onUpdated } = $props<{
    task: any;
    sessionId: string;
    allSessions?: any[];
    onUpdated: (t: any) => void;
  }>();

  function resolveName(id: string): string {
    if (!id) return '';
    const s = allSessions.find((s: any) => s.id === id || s.handle === id);
    return s ? (s.display_name || s.name) : id.length > 16 ? id.slice(0, 8) + '…' : id;
  }

  const STATUS_ORDER = ['proposed','accepted','to-be-assigned','assigned','review','complete','deleted'] as const;
  type Status = typeof STATUS_ORDER[number];

  const STATUS_STYLES: Record<Status | string, { bg: string; text: string }> = {
    proposed:         { bg: '#F59E0B22', text: '#F59E0B' },
    accepted:         { bg: '#26A69A22', text: '#26A69A' },
    'to-be-assigned': { bg: '#AB47BC22', text: '#AB47BC' },
    assigned:         { bg: '#42A5F522', text: '#42A5F5' },
    review:           { bg: '#F59E0B22', text: '#F59E0B' },
    complete:         { bg: '#22C55E22', text: '#22C55E' },
    deleted:          { bg: '#EF444422', text: '#EF4444' },
  };

  const NEXT_ACTIONS: Record<Status | string, { label: string; status: Status }[]> = {
    proposed:         [{ label: 'Accept', status: 'accepted' }],
    accepted:         [{ label: 'Assign', status: 'to-be-assigned' }],
    'to-be-assigned': [{ label: 'Assign →', status: 'assigned' }],
    assigned:         [{ label: 'Review', status: 'review' }],
    review:           [{ label: 'Complete', status: 'complete' }],
    complete:         [],
    deleted:          [],
  };

  let busy = $state(false);
  let showAssignInput = $state(false);
  let assignHandle = $state('');

  async function transition(status: Status, assignedTo?: string) {
    busy = true;
    try {
      const body: any = { status };
      if (assignedTo) body.assigned_to = assignedTo;
      const res = await fetch(`/api/sessions/${sessionId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      onUpdated(data.task);
    } finally {
      busy = false;
      showAssignInput = false;
      assignHandle = '';
    }
  }

  const style = $derived(STATUS_STYLES[task.status] ?? { bg: '#ffffff11', text: '#aaa' });
  const actions = $derived(NEXT_ACTIONS[task.status] ?? []);
  const fileRefs: string[] = $derived.by(() => {
    try { return JSON.parse(task.file_refs || '[]'); } catch { return []; }
  });
</script>

<div class="rounded-lg border p-3 space-y-2 text-sm"
     style="background: var(--bg-card); border-color: var(--border-subtle);">
  <!-- Header row -->
  <div class="flex items-start justify-between gap-2">
    <div class="flex-1 min-w-0">
      <p class="font-medium truncate" style="color: var(--text);">{task.title}</p>
      {#if task.description}
        <p class="text-xs mt-0.5 line-clamp-2" style="color: var(--text-muted);">{task.description}</p>
      {/if}
    </div>
    <!-- Status badge -->
    <span class="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold"
          style="background: {style.bg}; color: {style.text};">
      {task.status}
    </span>
  </div>

  <!-- Meta row -->
  {#if task.assigned_to || task.created_by || task.created_source || task.plan_id}
    <div class="flex gap-3 text-[10px] font-mono flex-wrap" style="color: var(--text-faint);">
      {#if task.created_by}<span>by {resolveName(task.created_by)}</span>{/if}
      {#if task.created_source}<span>via {task.created_source}</span>{/if}
      {#if task.plan_id}
        <span>plan {task.plan_id}{#if task.milestone_id}#{task.milestone_id}{/if}</span>
      {/if}
      {#if task.assigned_to}
        <span style="color: #42A5F5;">→ {resolveName(task.assigned_to)}</span>
      {/if}
    </div>
  {/if}

  <!-- File refs -->
  {#if fileRefs.length}
    <div class="space-y-0.5">
      {#each fileRefs as f}
        <p class="text-[10px] font-mono text-green-400 truncate">{f}</p>
      {/each}
    </div>
  {/if}

  <!-- Actions -->
  {#if actions.length && task.status !== 'deleted'}
    <div class="flex gap-1.5 flex-wrap pt-1">
      {#each actions as action}
        {#if action.status === 'assigned' || action.status === 'to-be-assigned'}
          {#if showAssignInput}
            <select
              bind:value={assignHandle}
              class="flex-1 px-2 py-0.5 text-xs rounded border font-mono"
              style="background:var(--bg);border-color:var(--border-subtle);color:var(--text);"
            >
              <option value="">— pick session —</option>
              {#each allSessions as s}
                <option value={s.id}>{s.display_name || s.name}{s.handle ? ' (' + s.handle + ')' : ''}</option>
              {/each}
            </select>
            <button
              onclick={() => transition('assigned', assignHandle)}
              disabled={busy || !assignHandle}
              class="px-2 py-0.5 text-xs rounded bg-[#42A5F5] text-white disabled:opacity-40"
            >→</button>
          {:else}
            <button
              onclick={() => (showAssignInput = true)}
              disabled={busy}
              class="px-2 py-0.5 text-xs rounded border transition-all disabled:opacity-40"
              style="border-color: {style.text}; color: {style.text};"
            >{action.label}</button>
          {/if}
        {:else}
          <button
            onclick={() => transition(action.status)}
            disabled={busy}
            class="px-2 py-0.5 text-xs rounded border transition-all disabled:opacity-40"
            style="border-color: {style.text}; color: {style.text};"
          >{action.label}</button>
        {/if}
      {/each}

      <!-- Delete (always available unless already deleted/complete) -->
      {#if task.status !== 'complete'}
        <button
          onclick={() => transition('deleted')}
          disabled={busy}
          class="px-2 py-0.5 text-xs rounded border border-red-500/40 text-red-400 transition-all disabled:opacity-40 ml-auto"
        >×</button>
      {/if}
    </div>
  {/if}
</div>
