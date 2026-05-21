<!--
  TriggerBuilder — interactive form that emits a copyable `ant plan
  trigger add …` CLI command. No POST; admin mutation stays at the CLI
  tier so the admin bearer never enters the browser.

  Event/action option lists arrive as props (sourced from the server-
  side import of $lib/server/planTriggerStore at load time), so new
  events/actions added by the sibling dispatcher slice show up here
  automatically on next page-load.
-->
<script lang="ts">
  import CopyButton from '$lib/components/CopyButton.svelte';
  import type { PlanTriggerEvent, PlanTriggerAction } from '$lib/server/planTriggerStore';
  import type { PlanRecord } from '$lib/server/planStore';

  type Props = {
    eventOptions: PlanTriggerEvent[];
    actionOptions: PlanTriggerAction[];
    plans: PlanRecord[];
  };
  let { eventOptions, actionOptions, plans }: Props = $props();

  function planLifecycle(p: PlanRecord): 'active' | 'archived' | 'deleted' {
    if (p.deletedAtMs != null) return 'deleted';
    if (p.archivedAtMs != null) return 'archived';
    return 'active';
  }
  function planLabel(p: PlanRecord): string {
    const t = p.title?.trim();
    return t && t.length > 0 ? `${t} · ${p.id}` : p.id;
  }
  const selectablePlans: PlanRecord[] = $derived(
    plans.filter((p) => planLifecycle(p) !== 'deleted')
  );

  function shellQuote(v: string): string {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  // svelte-ignore state_referenced_locally — init-from-prop intentional.
  let selectedEvent = $state<PlanTriggerEvent>(eventOptions[0] ?? ('plan.completed' as PlanTriggerEvent));
  // svelte-ignore state_referenced_locally
  let selectedAction = $state<PlanTriggerAction>(actionOptions[0] ?? ('room.message' as PlanTriggerAction));
  let scope = $state<string>('');
  let messageTemplate = $state<string>('Plan {planTitle} {event} ({completedCount}/{totalCount}, {pct}%)');
  let createdBy = $state<string>('');
  // Action-specific config fields:
  let webhookUrl = $state<string>('https://example.test/hook');
  let taskSubject = $state<string>('Follow-up after {event}: {planTitle}');
  let taskTargetPlan = $state<string>('same'); // 'same' or explicit plan id
  let taskPriority = $state<string>(''); // optional number

  const showMessage = $derived(
    selectedAction === 'room.message' || selectedAction === 'console.log'
  );
  const showWebhook = $derived(selectedAction === 'webhook.post');
  const showTaskCreate = $derived(selectedAction === 'task.create');
  const messageLabel = $derived(
    selectedAction === 'room.message'
      ? 'Message template (markdown-friendly)'
      : selectedAction === 'console.log'
        ? 'Console log message'
        : 'Message'
  );

  const addCommand = $derived.by((): string => {
    const parts: string[] = ['ant', 'plan', 'trigger', 'add', selectedEvent, selectedAction];
    if (scope) parts.push('--plan', scope);
    if (showMessage && messageTemplate.trim().length > 0) {
      parts.push('--message', shellQuote(messageTemplate));
    }
    if (showWebhook && webhookUrl.trim().length > 0) {
      parts.push('--url', shellQuote(webhookUrl.trim()));
    }
    if (showTaskCreate) {
      if (taskSubject.trim().length > 0) parts.push('--subject', shellQuote(taskSubject));
      if (taskTargetPlan.trim().length > 0) parts.push('--target-plan', shellQuote(taskTargetPlan.trim()));
      const pri = taskPriority.trim();
      if (pri.length > 0 && /^-?\d+$/.test(pri)) parts.push('--priority', pri);
    }
    if (createdBy.trim().length > 0) parts.push('--by', shellQuote(createdBy.trim()));
    return parts.join(' ');
  });
</script>

<div class="form-grid">
  <label>
    <span>Event</span>
    <select bind:value={selectedEvent}>
      {#each eventOptions as ev (ev)}
        <option value={ev}>{ev}</option>
      {/each}
    </select>
  </label>

  <label>
    <span>Action</span>
    <select bind:value={selectedAction}>
      {#each actionOptions as ac (ac)}
        <option value={ac}>{ac}</option>
      {/each}
    </select>
  </label>

  <label>
    <span>Scope</span>
    <select bind:value={scope}>
      <option value="">All plans (wildcard)</option>
      {#each selectablePlans as p (p.id)}
        <option value={p.id}>{planLabel(p)}{planLifecycle(p) === 'archived' ? ' (archived)' : ''}</option>
      {/each}
    </select>
  </label>

  <label>
    <span>Created by (optional)</span>
    <input type="text" placeholder="@you" bind:value={createdBy} />
  </label>

  {#if showMessage}
    <label class="span-2">
      <span>{messageLabel}</span>
      <textarea rows="3" bind:value={messageTemplate}></textarea>
      <small class="hint">
        Placeholders:
        <code>{'{planId}'}</code>
        <code>{'{planTitle}'}</code>
        <code>{'{event}'}</code>
        <code>{'{completedCount}'}</code>
        <code>{'{totalCount}'}</code>
        <code>{'{pct}'}</code>
        {#if selectedEvent.startsWith('task.')}
          <code>{'{taskId}'}</code>
          <code>{'{taskSubject}'}</code>
          <code>{'{taskStatus}'}</code>
          <code>{'{taskAgent}'}</code>
        {/if}
      </small>
    </label>
  {/if}

  {#if showWebhook}
    <label class="span-2">
      <span>Webhook URL</span>
      <input type="text" placeholder="https://example.test/hook/{'{planId}'}" bind:value={webhookUrl} />
      <small class="hint">
        Placeholders work inside the URL (e.g. <code>/hook/{'{planId}'}</code>).
        POST body is auto-rendered JSON containing event/planId/completion/task/firedAtMs;
        pass <code>--body-template</code> via direct API call to override.
      </small>
    </label>
  {/if}

  {#if showTaskCreate}
    <label class="span-2">
      <span>Task subject (auto-created task)</span>
      <input type="text" bind:value={taskSubject} />
      <small class="hint">
        Placeholders supported (see <code>{'{planTitle}'}</code> etc).
      </small>
    </label>
    <label>
      <span>Target plan for new task</span>
      <input type="text" placeholder="same | <plan_id>" bind:value={taskTargetPlan} />
      <small class="hint">"same" = same plan as the event; or an explicit plan id; blank = standalone.</small>
    </label>
    <label>
      <span>Priority (optional number)</span>
      <input type="text" placeholder="1" bind:value={taskPriority} />
    </label>
  {/if}
</div>

<div class="cmd-row">
  <pre class="cmd">{addCommand}</pre>
  <CopyButton text={addCommand} label="Copy command" variant="primary" title="Copy add command" />
</div>

<p class="notes">
  Run the copied command in your terminal — <code>ant plan trigger add …</code> requires the admin bearer
  which lives in <code>~/.ant/config.json</code> (or pass <code>--bearer &lt;token&gt; --server &lt;url&gt;</code>
  overrides). After running, reload this page to see the new trigger.
</p>

<style>
  .form-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.85rem; margin-bottom: 0.9rem;
  }
  .form-grid label { display: flex; flex-direction: column; gap: 0.3rem; }
  .form-grid label > span {
    font-size: 0.78rem; color: var(--ink-soft);
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 800;
  }
  .form-grid input, .form-grid select, .form-grid textarea {
    padding: 0.5rem 0.65rem; border-radius: 0.5rem;
    border: 1px solid var(--line-soft); background: var(--surface-raised);
    color: var(--ink-strong); font-size: 0.9rem; font-family: inherit;
  }
  .form-grid textarea {
    resize: vertical; min-height: 4.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .form-grid .span-2 { grid-column: 1 / -1; }
  .hint { color: var(--ink-soft); font-size: 0.74rem; }
  .hint code {
    background: var(--surface-raised); padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .cmd-row {
    display: flex; align-items: stretch; gap: 0.6rem;
    margin-bottom: 0.6rem; flex-wrap: wrap;
  }
  pre.cmd {
    flex: 1; min-width: 18rem; margin: 0;
    padding: 0.7rem 0.85rem;
    background: var(--surface-raised); border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    color: var(--ink-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    white-space: pre-wrap; word-break: break-all;
  }
  .notes { margin: 0.4rem 0 0; color: var(--ink-soft); font-size: 0.85rem; line-height: 1.5; }
  .notes code {
    background: var(--surface-raised); padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
