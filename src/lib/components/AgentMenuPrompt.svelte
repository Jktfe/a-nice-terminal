<script lang="ts">
  // ANT — AgentMenuPrompt
  // Renders Claude Code's structured menus (`AskUserQuestion`,
  // `ExitPlanMode`) as a first-class panel above the terminal pane,
  // so users don't have to read the menu inside the tmux TUI.
  //
  // Submission goes through the existing agent_response message flow —
  // POST /api/sessions/{id}/messages with `msg_type='agent_response'` and
  // a synthetic event id (the tool_use id from the menu). The driver's
  // respond() converts the choice into tmux send-keys.
  //
  // Source of the menu data: `claude-code-menu-extractor.extractPendingMenu()`
  // attached to the agent_status WS payload by agent-event-bus.

  import { marked } from 'marked';
  import DOMPurify from 'isomorphic-dompurify';
  import type { AgentMenu } from '$lib/shared/agent-status';

  let {
    menu,
    sessionId,
    onResolved = () => {},
  }: {
    menu: AgentMenu;
    sessionId: string;
    onResolved?: () => void;
  } = $props();

  let selectedIndex = $state(0);
  let otherText = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  function renderMarkdown(text: string): string {
    if (!text) return '';
    const raw = marked.parse(text, { breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(raw);
  }

  async function postChoice(choice: { type: string; index?: number; text?: string }) {
    if (submitting) return;
    submitting = true;
    submitError = null;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'agent_response',
          content: JSON.stringify({
            event_id: menu.toolUseId,
            class: menu.kind === 'AskUserQuestion' ? 'multi_choice' : 'confirmation',
            choice,
          }),
        }),
      });
      if (!res.ok) {
        submitError = `submit failed (${res.status})`;
      } else {
        onResolved();
      }
    } catch (err) {
      submitError = err instanceof Error ? err.message : 'submit failed';
    } finally {
      submitting = false;
    }
  }

  function pickOption(i: number) {
    if (menu.kind !== 'AskUserQuestion') return;
    void postChoice({ type: 'select', index: i });
  }

  function pickOther() {
    if (menu.kind !== 'AskUserQuestion') return;
    if (otherText.trim().length === 0) return;
    void postChoice({ type: 'text', text: otherText.trim() });
  }

  function planAccept() {
    if (menu.kind !== 'ExitPlanMode') return;
    void postChoice({ type: 'select', index: 0 });
  }

  function planReject() {
    if (menu.kind !== 'ExitPlanMode') return;
    void postChoice({ type: 'select', index: 1 });
  }

  function onKey(ev: KeyboardEvent) {
    if (menu.kind !== 'AskUserQuestion') return;
    const max = menu.options.length;
    if (ev.key === 'ArrowDown') {
      selectedIndex = Math.min(max - 1, selectedIndex + 1);
      ev.preventDefault();
    } else if (ev.key === 'ArrowUp') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      ev.preventDefault();
    } else if (ev.key === 'Enter' && !ev.shiftKey) {
      pickOption(selectedIndex);
      ev.preventDefault();
    }
  }

  const focusedPreview = $derived.by(() => {
    if (menu.kind !== 'AskUserQuestion') return null;
    return menu.options[selectedIndex]?.preview ?? null;
  });
</script>

<svelte:window on:keydown={onKey} />

<div class="amp" role="dialog" aria-label="Agent menu">
  {#if menu.kind === 'AskUserQuestion'}
    <div class="amp__head">
      <span class="amp__chip">Question</span>
      {#if menu.header}<span class="amp__header">{menu.header}</span>{/if}
    </div>
    <div class="amp__question">{menu.question}</div>

    <div class="amp__body" class:amp__body--with-preview={!!focusedPreview}>
      <ul class="amp__options" role="listbox">
        {#each menu.options as opt, i}
          <li>
            <button
              type="button"
              class="amp__option"
              class:amp__option--selected={i === selectedIndex}
              role="option"
              aria-selected={i === selectedIndex}
              onmouseenter={() => (selectedIndex = i)}
              onclick={() => pickOption(i)}
              disabled={submitting}
            >
              <span class="amp__option-num">{i + 1}</span>
              <span class="amp__option-body">
                <span class="amp__option-label">{opt.label}</span>
                {#if opt.description}
                  <span class="amp__option-desc">{opt.description}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}

        <li>
          <div class="amp__other">
            <input
              type="text"
              placeholder="Other (free text)"
              bind:value={otherText}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickOther(); } }}
              disabled={submitting}
            />
            <button
              type="button"
              class="amp__option amp__option--submit-other"
              onclick={pickOther}
              disabled={submitting || otherText.trim().length === 0}
            >Send</button>
          </div>
        </li>
      </ul>

      {#if focusedPreview}
        <pre class="amp__preview">{focusedPreview}</pre>
      {/if}
    </div>
  {:else if menu.kind === 'ExitPlanMode'}
    <div class="amp__head">
      <span class="amp__chip amp__chip--plan">Plan</span>
      <span class="amp__header">Review and approve</span>
    </div>
    <div class="amp__plan">{@html renderMarkdown(menu.plan)}</div>
    <div class="amp__plan-actions">
      <button type="button" class="amp__btn amp__btn--accept" onclick={planAccept} disabled={submitting}>
        Accept
      </button>
      <button type="button" class="amp__btn amp__btn--reject" onclick={planReject} disabled={submitting}>
        Reject
      </button>
    </div>
  {/if}

  {#if submitError}
    <div class="amp__error">{submitError}</div>
  {/if}
</div>

<style>
  .amp {
    border: 1px solid var(--border-strong, var(--border-light));
    background: var(--bg-surface);
    border-radius: 8px;
    padding: 12px 14px;
    margin: 8px 0;
    font-size: 13.5px;
    line-height: 1.4;
  }

  .amp__head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .amp__chip {
    background: color-mix(in srgb, var(--accent-blue, #2563eb) 15%, transparent);
    color: var(--accent-blue, #2563eb);
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .amp__chip--plan {
    background: color-mix(in srgb, var(--accent-amber, #d4a017) 15%, transparent);
    color: var(--accent-amber, #d4a017);
  }

  .amp__header {
    font-size: 11.5px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .amp__question {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-strong, var(--text));
    margin-bottom: 10px;
  }

  .amp__body {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .amp__body--with-preview {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .amp__options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .amp__option {
    display: flex;
    width: 100%;
    text-align: left;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }

  .amp__option--selected {
    background: var(--bg-soft, color-mix(in srgb, var(--text) 4%, transparent));
    border-color: var(--border-light);
  }

  .amp__option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .amp__option-num {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    min-width: 18px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .amp__option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .amp__option-label {
    font-weight: 500;
  }

  .amp__option-desc {
    font-size: 12px;
    color: var(--text-muted);
  }

  .amp__other {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    padding: 4px 0;
    border-top: 1px dashed var(--border-light);
  }

  .amp__other input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border-light);
    border-radius: 4px;
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
  }

  .amp__option--submit-other {
    width: auto;
    flex: 0 0 auto;
    padding: 6px 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-soft);
  }

  .amp__preview {
    padding: 10px 12px;
    background: var(--bg-soft, color-mix(in srgb, var(--text) 4%, transparent));
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow: auto;
    max-height: 240px;
    margin: 0;
  }

  .amp__plan {
    padding: 8px 12px;
    background: var(--bg-soft, color-mix(in srgb, var(--text) 4%, transparent));
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.45;
    max-height: 320px;
    overflow: auto;
  }

  .amp__plan-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .amp__btn {
    padding: 6px 14px;
    border-radius: 4px;
    border: 1px solid var(--border-light);
    font-size: 13px;
    cursor: pointer;
  }

  .amp__btn--accept {
    background: color-mix(in srgb, var(--accent-blue, #2563eb) 12%, var(--bg-surface));
    color: var(--accent-blue, #2563eb);
    border-color: color-mix(in srgb, var(--accent-blue, #2563eb) 30%, var(--border-light));
  }

  .amp__btn--reject {
    background: var(--bg-soft);
    color: var(--text-muted);
  }

  .amp__error {
    margin-top: 8px;
    color: var(--accent-red, #c53030);
    font-size: 12px;
  }
</style>
