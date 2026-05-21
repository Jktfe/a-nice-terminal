<!--
  TerminalSettingsOnlyRespond.svelte — extracted from TerminalSettingsModal
  to keep the parent modal under the 600-line component cap. Renders the
  "Only respond to specific handles" section: quick-pick chips for room
  agent handles, a manual @handle text input, a remove list, and the
  "Clear — respond to everyone" escape hatch.

  Zero behaviour change: same DOM, same CSS classes, same handlers — the
  parent owns state + persistence and passes callbacks in.
-->
<script lang="ts">
  type Props = {
    onlyRespondTo: string[];
    roomAgentHandles: string[];
    manualOnlyRespondInput: string;
    saving: boolean;
    onManualInputChange: (next: string) => void;
    onAddManual: () => void;
    onToggleHandle: (handle: string) => void;
    onRemoveHandle: (handle: string) => void;
    onClear: () => void;
    isActive: boolean;
  };

  let {
    onlyRespondTo,
    roomAgentHandles,
    manualOnlyRespondInput,
    saving,
    onManualInputChange,
    onAddManual,
    onToggleHandle,
    onRemoveHandle,
    onClear,
    isActive
  }: Props = $props();
</script>

<section class="settings-section" aria-labelledby="onlyRespondHeading">
  <h3 id="onlyRespondHeading">Only respond to specific handles</h3>
  <p class="section-help">When set, this terminal only reacts to bare <code>@handle</code> mentions of the picked handles (no <code>@everyone</code>, no bracketed mentions, no plain text). Leave empty for default behaviour.</p>
  <p class="section-help membership-tip">
    <strong>Tip:</strong> the handle must be a registered room member for delivery to fire.
    Register a local agent in its shell with
    <code>ant register --handle @yourhandle --room &lt;roomId&gt;</code>,
    or use <code>ant grantagent --pid &lt;PID&gt; --handle @yourhandle</code> from an operator shell.
  </p>

  {#if onlyRespondTo.length > 0}
    <ul class="grant-list">
      {#each onlyRespondTo as handle (handle)}
        <li class="grant-row">
          <span class="grant-handle">{handle}</span>
          <button
            type="button"
            class="revoke-btn"
            onclick={() => onRemoveHandle(handle)}
            disabled={saving}
            aria-label={`Remove ${handle} from only-respond list`}
          >Remove</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if roomAgentHandles.length > 0}
    <div class="respond-picker" role="group" aria-label="Room agents quick-pick">
      {#each roomAgentHandles as handle (handle)}
        {@const active = onlyRespondTo.includes(handle)}
        <button
          type="button"
          class="respond-chip"
          class:active
          onclick={() => onToggleHandle(handle)}
          disabled={saving}
          aria-pressed={active}
        >{handle}</button>
      {/each}
    </div>
  {/if}

  <!-- Manual handle input — same pattern as the write-grant section.
       Always visible so the operator can pin any handle (local agent
       that isn't in the linked room's member list yet, etc). -->
  <div class="grant-picker">
    <input
      type="text"
      value={manualOnlyRespondInput}
      oninput={(event) => onManualInputChange((event.currentTarget as HTMLInputElement).value)}
      placeholder="@handle (only respond to this handle)"
      disabled={saving}
      aria-label="Type a handle to restrict the terminal to"
      onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAddManual(); } }}
    />
    <button
      type="button"
      class="grant-btn"
      onclick={() => onAddManual()}
      disabled={saving || manualOnlyRespondInput.trim().length === 0}
    >Add</button>
  </div>

  {#if isActive}
    <button
      type="button"
      class="clear-respond"
      onclick={() => onClear()}
      disabled={saving}
    >Clear — respond to everyone</button>
  {/if}
</section>

<style>
  .settings-section { display: flex; flex-direction: column; gap: 0.55rem; }
  .settings-section h3 { margin: 0; font-size: 0.95rem; color: var(--ink-strong); }
  .section-help { margin: 0; color: var(--ink-soft); font-size: 0.82rem; line-height: 1.4; }
  .section-help.membership-tip {
    padding: 0.45rem 0.6rem;
    background: color-mix(in srgb, var(--info, #2563eb) 8%, var(--bg));
    border-left: 3px solid var(--info, #2563eb);
    border-radius: 0.4rem;
    color: var(--ink-strong);
  }
  .section-help.membership-tip code {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    background: var(--bg);
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
  }

  .grant-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .grant-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.5rem; padding: 0.45rem 0.7rem;
    border: 1px solid var(--line-soft); border-radius: 0.5rem;
    background: var(--bg);
  }
  .grant-handle { color: var(--ink-strong); font-family: ui-monospace, monospace; font-size: 0.85rem; }
  .revoke-btn {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-soft);
    font-weight: 700; font-size: 0.78rem;
    cursor: pointer;
  }
  .revoke-btn:hover { color: var(--warn, #c92020); border-color: var(--warn, #c92020); }
  .revoke-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .grant-picker { display: flex; gap: 0.5rem; align-items: center; }
  .grant-picker input {
    flex: 1 1 auto;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line-soft); border-radius: 0.4rem;
    background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.82rem;
    min-width: 0;
  }
  .grant-picker input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .grant-btn {
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white; font-weight: 800; font-size: 0.82rem;
    cursor: pointer;
  }
  .grant-btn:hover { filter: brightness(1.05); }
  .grant-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .respond-picker { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .respond-chip {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: ui-monospace, monospace; font-size: 0.78rem; font-weight: 600;
    cursor: pointer;
  }
  .respond-chip.active {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  .respond-chip:disabled { opacity: 0.5; cursor: not-allowed; }
  .clear-respond {
    align-self: flex-start;
    padding: 0.3rem 0.7rem;
    border: 1px dashed var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.78rem; font-weight: 700;
    cursor: pointer;
  }
  .clear-respond:hover { color: var(--ink-strong); border-color: var(--ink-strong); }
</style>
