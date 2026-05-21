<!--
  /terminal — TWO-TIER-IMPL per docs/terminal-two-tier-chips-design-2026-05-14.md
  delta-5 canonical PASS. Option C: extend POST /api/terminals for BOTH
  spawn-new and attach-existing flows. /api/identity/register untouched.

  Top tier (tmuxSessions): bare panes WITHOUT a terminalsStore row.
  Bottom tier (terminals): handle-bearing ANT terminals.
  Both chip clicks open the same claim modal: top-tier sets sessionId,
  bottom-tier just mounts TerminalCard (already attached).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import KillConfirmModal from '$lib/components/KillConfirmModal.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import TerminalCard from '$lib/components/TerminalCard.svelte';

  type TerminalRecord = {
    sessionId: string;
    name: string;
    handle?: string | null;
    agentKind?: string | null;
    autoForwardRoomId: string | null;
    autoForwardChat: number;
    createdBy?: string;
    allowlist?: string[];
    tmuxTargetPane?: string | null;
    linkedChatRoomId?: string | null;
    createdAtMs: number;
    updatedAtMs: number;
    alive: boolean;
  };
  type TmuxPane = { sessionId: string };

  let terminals = $state<TerminalRecord[]>([]);
  let tmuxSessions = $state<TmuxPane[]>([]);
  let activeId = $state<string | null>(null);
  let activeName = $state<string>('');
  let creating = $state(false);
  let lastError = $state('');

  // Claim modal — shared by spawn-new + attach-existing.
  let modalOpen = $state(false);
  let modalMode = $state<'spawn' | 'attach'>('spawn');
  let modalSessionId = $state<string | null>(null);
  let pendingName = $state('');
  let pendingUser = $state('@you');
  let pendingPickedHandles = $state<string[]>([]);  // multi-select from existing handles

  // PICKER-SAME-SET 2026-05-14: picker source == bottom-tier ANT terminals
  // (one source-of-truth per JWPK). Use record.handle if set (S7 column),
  // else derived @slug from record.name. Per JWPK delete-on-kill spec,
  // every record in `terminals` is by definition alive — no filter needed.
  function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function deriveHandle(r: TerminalRecord): string {
    if (typeof r.handle === 'string' && r.handle.length > 0) return r.handle;
    const slug = slugify(r.name) || r.sessionId.slice(0, 8);
    return '@' + slug;
  }
  const liveTerminals = $derived(terminals.filter((r) => r.alive));
  const staleTerminals = $derived(terminals.filter((r) => !r.alive));

  const availableHandles = $derived.by<string[]>(() => {
    const handles = liveTerminals.map((r) => deriveHandle(r));
    return [...new Set(handles)].sort();
  });

  function toggleHandle(h: string): void {
    pendingPickedHandles = pendingPickedHandles.includes(h)
      ? pendingPickedHandles.filter((x) => x !== h)
      : [...pendingPickedHandles, h];
  }

  async function loadTerminals(): Promise<void> {
    try {
      const res = await fetch('/api/terminals');
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const body = (await res.json()) as { terminals?: TerminalRecord[]; tmuxSessions?: TmuxPane[] };
      terminals = body.terminals ?? [];
      tmuxSessions = body.tmuxSessions ?? [];
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function openSpawnModal(): void {
    modalMode = 'spawn';
    modalSessionId = null;
    pendingName = `Terminal ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    pendingUser = '@you';
    pendingPickedHandles = [];
    modalOpen = true;
  }

  function openAttachModal(pane: TmuxPane): void {
    modalMode = 'attach';
    modalSessionId = pane.sessionId;
    pendingName = `Attached ${pane.sessionId.slice(0, 8)}`;
    pendingUser = '@you';
    pendingPickedHandles = [];
    modalOpen = true;
  }

  function cancelModal(): void {
    modalOpen = false;
    pendingName = '';
    modalSessionId = null;
  }

  async function confirmClaim(): Promise<void> {
    const name = pendingName.trim();
    const user = pendingUser.trim();
    if (!name || !user) return;
    modalOpen = false;
    creating = true;
    lastError = '';
    try {
      const body: Record<string, unknown> = { name, user };
      if (modalSessionId) body.sessionId = modalSessionId;
      if (pendingPickedHandles.length > 0) body.allowlist = [...pendingPickedHandles];
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`${modalMode} failed: ${res.status}`);
      const json = (await res.json()) as { sessionId: string; name: string };
      activeId = json.sessionId;
      activeName = json.name || name;
      await loadTerminals();
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      creating = false;
    }
  }

  // Kill UI shared state (bare-tmux + ANT-terminal both use same endpoint).
  let killModalOpen = $state(false);
  let killTarget = $state<{ sessionId: string; label: string; kind: 'tmux-pane' | 'ant-terminal' } | null>(null);

  function openKillModalForTmux(pane: TmuxPane): void {
    killTarget = { sessionId: pane.sessionId, label: pane.sessionId.slice(0, 16), kind: 'tmux-pane' };
    killModalOpen = true;
  }

  async function performKill(mode: 'archive' | 'delete' | 'just-kill' = 'archive'): Promise<void> {
    if (!killTarget) return;
    const sessionId = killTarget.sessionId;
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(sessionId)}/kill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callerHandle: '@you', mode })
      });
      if (res.status === 403) { lastError = 'Not authorised to kill this pane'; }
      else if (!res.ok) { lastError = `kill failed: ${res.status}`; }
      else {
        // Optimistic: remove from BOTH local state lists (per JWPK
        // delete-on-kill — record is removed by backend). Reconcile via
        // loadTerminals.
        tmuxSessions = tmuxSessions.filter((p) => p.sessionId !== sessionId);
        terminals = terminals.filter((r) => r.sessionId !== sessionId);
        if (activeId === sessionId) { activeId = null; }
        void loadTerminals();
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      killModalOpen = false;
      killTarget = null;
    }
  }

  function attach(record: TerminalRecord): void {
    lastError = '';
    activeId = record.sessionId;
    activeName = record.name;
  }

  function chipLabel(record: TerminalRecord): string {
    return record.name && record.name.length > 0 ? record.name : record.sessionId.slice(0, 12) + '…';
  }

  // Group ANT terminals by agentKind sub-headings per JWPK THREAD 1.
  // Ungrouped (null/empty) section appears last.
  type Group = { kind: string; label: string; records: TerminalRecord[] };
  const groupedTerminals = $derived.by<Group[]>(() => {
    const byKind = new Map<string, TerminalRecord[]>();
    for (const r of liveTerminals) {
      const key = (r.agentKind ?? '').toString();
      const arr = byKind.get(key) ?? [];
      arr.push(r);
      byKind.set(key, arr);
    }
    const known = ['claude-code', 'codex', 'gemini', 'aider', 'copilot'];
    const groups: Group[] = [];
    for (const k of known) {
      const records = byKind.get(k);
      if (records && records.length > 0) groups.push({ kind: k, label: k, records });
    }
    for (const [k, records] of byKind) {
      if (known.includes(k)) continue;
      if (k === '') continue;
      if (records.length > 0) groups.push({ kind: k, label: k, records });
    }
    const ungrouped = byKind.get('') ?? [];
    if (ungrouped.length > 0) groups.push({ kind: '', label: 'no agent (raw PTY)', records: ungrouped });
    return groups;
  });

  onMount(() => { void loadTerminals(); });
</script>

<svelte:head><title>Terminals | ANT vNext</title></svelte:head>

<SimplePageShell eyebrow="Terminals" title="Terminals." summary="Two-tier: tmux panes without a handle on top; handle-bearing ANT terminals below.">
  <section class="terminal-controls">
    <button type="button" class="primary" onclick={openSpawnModal} disabled={creating}>
      {creating ? 'Working…' : '+ New ANT terminal'}
    </button>

    <section class="tier tier-primary" aria-label="ANT terminals">
      <h3 class="tier-heading">ANT terminals <span class="muted">— grouped by agent kind</span></h3>
      {#if liveTerminals.length === 0}
        <p class="tier-empty">No ANT terminals yet — click "+ New ANT terminal" above to create one, or attach an existing tmux pane below.</p>
      {:else}
        {#each groupedTerminals as group (group.kind || 'none')}
          <div class="group">
            <h4 class="group-heading">{group.label}</h4>
            <div class="chips">
              {#each group.records as record (record.sessionId)}
              <button
                type="button"
                class="chip ant-chip"
                class:active={activeId === record.sessionId}
                  title={`${record.sessionId} • ${record.createdBy ?? ''}`}
                  onclick={() => attach(record)}
                >{chipLabel(record)}</button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </section>

    {#if staleTerminals.length > 0}
      <section class="tier tier-stale" aria-label="Archived terminals">
        <h3 class="tier-heading">Archived terminals <span class="muted">— tmux pane gone, kept for history</span></h3>
        <div class="chips">
          {#each staleTerminals as record (record.sessionId)}
            <span class="chip ant-chip dead" title={`${record.sessionId} is archived (tmux pane no longer exists)`}>
              {chipLabel(record)}
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <section class="tier tier-secondary" aria-label="Tmux sessions, no handle">
      <h3 class="tier-heading">Attach existing tmux <span class="muted">— not in ANT yet</span></h3>
      {#if tmuxSessions.length === 0}
        <p class="tier-empty">No unattached tmux panes.</p>
      {:else}
        <div class="chips">
          {#each tmuxSessions as pane (pane.sessionId)}
            <span class="chip-wrap">
              <button type="button" class="chip tmux-chip" onclick={() => openAttachModal(pane)} title={`Attach pane ${pane.sessionId}`}>
                {pane.sessionId.slice(0, 12)}…
                <span class="promote-hint">+ attach handle</span>
              </button>
              <button type="button" class="chip-kill" onclick={(e) => { e.stopPropagation(); openKillModalForTmux(pane); }} title="Kill this pane" aria-label="Kill pane">×</button>
            </span>
          {/each}
        </div>
      {/if}
    </section>

    {#if lastError}<p class="error" role="alert">{lastError}</p>{/if}
  </section>

  {#if activeId}
    <section class="terminal-mount" aria-label="Active terminal">
      {#key activeId}
        <TerminalCard
          terminalId={activeId}
          userName={activeName}
          onKilled={async () => {
            const killedId = activeId;
            activeId = null;
            // Per JWPK delete-on-kill: remove the record from local
            // state; loadTerminals reconciles with backend (which now
            // deletes the row server-side via S6 delta-3).
            terminals = terminals.filter((r) => r.sessionId !== killedId);
            await loadTerminals();
          }}
        />
      {/key}
    </section>
  {/if}

  <KillConfirmModal
    open={killModalOpen}
    targetKind={killTarget?.kind ?? 'tmux-pane'}
    targetLabel={killTarget?.label ?? ''}
    onCancel={() => { killModalOpen = false; killTarget = null; }}
    onConfirm={(mode) => performKill(mode)}
  />

  {#if modalOpen}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={modalMode === 'spawn' ? 'New ANT terminal' : 'Attach existing pane'}>
      <form class="modal-card" onsubmit={(e) => { e.preventDefault(); void confirmClaim(); }}>
        <h2>{modalMode === 'spawn' ? 'New ANT terminal' : 'Attach existing pane'}</h2>
        {#if modalSessionId}
          <p class="muted">Pane: <code>{modalSessionId}</code></p>
        {/if}
        <label>Name <input type="text" bind:value={pendingName} placeholder="e.g. backend work" required /></label>
        <label>User (creator handle) <input type="text" bind:value={pendingUser} placeholder="@you" required /></label>
        <!-- agentKind is set AFTER spawn via TerminalHeader dropdown per JWPK
             Option B 2026-05-14: daemon doesn't launch the CLI, only stores
             the label metadata — removing the field from the create modal
             since it's redundant + canonical edit-point is header. -->

        <fieldset class="allowlist-picker">
          <legend>Allowlist (optional)</legend>
          <p class="picker-hint">Empty = creator + operator only.</p>
          {#if availableHandles.length === 0}
            <p class="picker-empty">No handles registered yet.</p>
          {:else}
            <div class="handle-pills">
              {#each availableHandles as h (h)}
                <button
                  type="button"
                  class="handle-pill"
                  class:selected={pendingPickedHandles.includes(h)}
                  aria-pressed={pendingPickedHandles.includes(h)}
                  onclick={() => toggleHandle(h)}
                >
                  {h}
                </button>
              {/each}
            </div>
          {/if}
        </fieldset>
        <div class="actions">
          <button type="button" class="secondary" onclick={cancelModal}>Cancel</button>
          <button type="submit" class="primary" disabled={pendingName.trim().length === 0 || pendingUser.trim().length === 0}>
            {modalMode === 'spawn' ? 'Create' : 'Attach'}
          </button>
        </div>
      </form>
    </div>
  {/if}
</SimplePageShell>

<style>
  .terminal-controls { margin-bottom: 1.5rem; display: grid; gap: 1rem; }
  button.primary { width: fit-content; padding: 0.55rem 1.1rem; border: 1px solid var(--accent); border-radius: 999px; background: var(--accent); color: white; font-weight: 800; cursor: pointer; }
  button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
  button.secondary { padding: 0.55rem 1.1rem; border-radius: 999px; border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong); font-weight: 700; cursor: pointer; }
  .tier { display: grid; gap: 0.4rem; }
  .tier-heading { margin: 0; font-size: 0.85rem; color: var(--ink-strong); font-weight: 700; }
  .tier-heading .muted { color: var(--ink-soft); font-weight: 400; }
  .tier-empty { margin: 0; color: var(--ink-soft); font-size: 0.85rem; font-style: italic; }
  .tier-secondary { margin-top: 1.5rem; padding-top: 0.85rem; border-top: 1px dashed var(--surface-edge); opacity: 0.85; }
  .tier-secondary .tier-heading { font-size: 0.78rem; font-weight: 600; color: var(--ink-soft); }
  .group { display: grid; gap: 0.25rem; margin-top: 0.45rem; }
  .group-heading { margin: 0; font-size: 0.78rem; color: var(--ink-soft); font-weight: 600; font-family: ui-monospace, monospace; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { padding: 0.35rem 0.65rem; border: 1px solid var(--line-soft); border-radius: 999px; background: var(--surface-card); color: var(--ink-strong); font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; }
  .chip.active { border-color: var(--accent); color: var(--accent); font-weight: 700; }
  .chip.dead { opacity: 0.55; cursor: default; }
  .tier-stale { margin-top: 0.9rem; padding-top: 0.75rem; border-top: 1px dashed var(--surface-edge); }
  .tmux-chip { font-family: ui-monospace, monospace; color: var(--ink-soft); }
  .tmux-chip:hover { color: var(--accent); border-color: var(--accent); }
  .tmux-chip .promote-hint { font-size: 0.7rem; opacity: 0.7; }
  .chip-wrap { display: inline-flex; align-items: center; gap: 0.15rem; }
  .chip-kill {
    width: 1.4rem; height: 1.4rem; padding: 0; border-radius: 50%;
    border: 1px solid transparent; background: transparent;
    color: var(--ink-soft); cursor: pointer; opacity: 0.5;
    font-size: 0.95rem; line-height: 1;
  }
  .chip-kill:hover { color: var(--accent, #c63b3b); border-color: var(--accent, #c63b3b); background: var(--bg); opacity: 1; }
  .error { margin: 0; color: var(--accent); font-weight: 800; }
  .terminal-mount { border-radius: 0.85rem; }
  .modal-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .modal-card { background: var(--surface-card); border: 1px solid var(--line-soft); border-radius: 0.8rem; padding: 1.25rem; max-width: 28rem; width: 100%; display: grid; gap: 0.55rem; }
  .modal-card h2 { margin: 0; color: var(--ink-strong); }
  .modal-card .muted { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
  .modal-card label { display: grid; gap: 0.2rem; font-size: 0.8rem; color: var(--ink-soft); }
  .modal-card input { padding: 0.45rem 0.6rem; border-radius: 0.4rem; border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong); font-size: 0.95rem; }
  .modal-card code { background: var(--bg); padding: 0.1rem 0.35rem; border-radius: 0.3rem; font-family: ui-monospace, monospace; }
  .modal-card .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.4rem; }
  .allowlist-picker { border: 1px solid var(--line-soft); border-radius: 0.45rem; padding: 0.5rem 0.65rem 0.55rem; margin: 0; display: grid; gap: 0.35rem; }
  .allowlist-picker legend { padding: 0 0.3rem; font-size: 0.78rem; color: var(--ink-soft); }
  .picker-hint, .picker-empty { margin: 0; font-size: 0.75rem; color: var(--ink-soft); }
  .handle-pills { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .handle-pill { padding: 0.25rem 0.7rem; border: 1px solid var(--line-soft); border-radius: 999px; background: var(--bg); color: var(--ink-strong); font-size: 0.8rem; font-family: ui-monospace, monospace; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .handle-pill:hover { border-color: var(--accent); color: var(--accent); }
  .handle-pill.selected { background: var(--accent); border-color: var(--accent); color: white; font-weight: 700; }
</style>
