<!--
  TerminalSettingsModal.svelte — per-terminal controls modal.
  Refactored to ModalShell. Preserves exact API.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';
  import TerminalSettingsOnlyRespond from './TerminalSettingsOnlyRespond.svelte';

  type PersistenceChoice = '1h' | '24h' | '7d' | 'forever';
  type WriteGrant = { handle: string; grantedAtMs: number };
  type KillDefault = 'prompt' | 'archive' | 'delete' | 'just-kill';
  type Settings = {
    persistence: PersistenceChoice;
    onlyRespondTo: string[];
    writeGrants: WriteGrant[];
    killDefault: KillDefault;
  };

  type Props = {
    terminalId: string;
    terminalName: string;
    roomAgentHandles: string[];
    open: boolean;
    onClose: () => void;
  };

  let { terminalId, terminalName, roomAgentHandles, open, onClose }: Props = $props();

  const PERSISTENCE_CHOICES = [
    { value: '1h' as PersistenceChoice, label: '1 hour', description: 'Output history pruned after 1h' },
    { value: '24h' as PersistenceChoice, label: '24 hours', description: 'Output history pruned after 24h' },
    { value: '7d' as PersistenceChoice, label: '7 days', description: 'Output history pruned after 7d' },
    { value: 'forever' as PersistenceChoice, label: 'Forever (default)', description: 'Never auto-pruned — manual prune only' }
  ];

  const KILL_DEFAULT_CHOICES = [
    { value: 'prompt' as KillDefault, label: 'Always ask', description: 'Show the kill confirm modal every time (default)' },
    { value: 'just-kill' as KillDefault, label: 'Just Kill', description: 'Process dies, terminal + linked chat stay for re-attach' },
    { value: 'archive' as KillDefault, label: 'Kill + Archive', description: 'Keep transcript + linked chat history; hides from list' },
    { value: 'delete' as KillDefault, label: 'Kill + Delete', description: 'Drop transcript + linked chat + terminal record entirely' }
  ];

  const DEFAULT_SETTINGS: Settings = { persistence: 'forever', onlyRespondTo: [], writeGrants: [], killDefault: 'prompt' };

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let loading = $state(false);
  let saving = $state(false);
  let endpointReady = $state(true);
  let errorMessage = $state('');
  let dirtyFields = $state<Set<keyof Settings>>(new Set());
  let stagedNewGrantee = $state('');
  let manualGranteeInput = $state('');
  let manualOnlyRespondInput = $state('');

  function normaliseHandleInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    if (withAt.length < 2) return null;
    return withAt.toLowerCase();
  }

  async function loadSettings() {
    if (!terminalId) return;
    loading = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/settings`);
      if (response.status === 404) {
        settings = { ...DEFAULT_SETTINGS };
        dirtyFields.clear();
        return;
      }
      if (!response.ok) {
        errorMessage = `Could not load settings (${response.status}).`;
        return;
      }
      const incoming = (await response.json()) as Partial<Settings>;
      const incomingKillDefault = typeof incoming.killDefault === 'string'
        && ['prompt', 'archive', 'delete', 'just-kill'].includes(incoming.killDefault)
        ? incoming.killDefault as KillDefault
        : 'prompt';
      settings = {
        persistence: (incoming.persistence as Settings['persistence']) ?? 'forever',
        onlyRespondTo: (incoming.onlyRespondTo as string[]) ?? [],
        writeGrants: Array.isArray(incoming.writeGrants)
          ? incoming.writeGrants.map((g) => {
              const obj = g as { handle?: unknown; grantedAtMs?: unknown };
              return {
                handle: typeof obj.handle === 'string' ? obj.handle : '',
                grantedAtMs: typeof obj.grantedAtMs === 'number' ? obj.grantedAtMs : Date.now()
              };
            }).filter((g) => g.handle.length > 0)
          : [],
        killDefault: incomingKillDefault
      };
      dirtyFields.clear();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not load settings.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) void loadSettings();
  });

  function markDirty(field: keyof Settings) {
    dirtyFields = new Set([...dirtyFields, field]);
  }

  async function persistField(field: keyof Settings, value: unknown) {
    if (!endpointReady) return;
    saving = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        errorMessage = failure.message ?? `Save failed (${response.status}).`;
        return;
      }
      dirtyFields.delete(field);
      dirtyFields = new Set(dirtyFields);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }

  async function changePersistence(next: PersistenceChoice) {
    settings.persistence = next;
    markDirty('persistence');
    await persistField('persistence', next);
  }

  async function changeKillDefault(next: KillDefault) {
    settings.killDefault = next;
    markDirty('killDefault');
    await persistField('killDefault', next);
  }

  async function grantWriteTo(handle: string) {
    if (!handle || settings.writeGrants.some((g) => g.handle === handle)) return;
    const nextGrants = [...settings.writeGrants, { handle, grantedAtMs: Date.now() }];
    settings.writeGrants = nextGrants;
    stagedNewGrantee = '';
    markDirty('writeGrants');
    await persistField('writeGrants', nextGrants);
  }

  async function revokeWriteFrom(handle: string) {
    const nextGrants = settings.writeGrants.filter((g) => g.handle !== handle);
    settings.writeGrants = nextGrants;
    markDirty('writeGrants');
    await persistField('writeGrants', nextGrants);
  }

  async function grantWriteToManual() {
    const normalised = normaliseHandleInput(manualGranteeInput);
    if (!normalised) return;
    manualGranteeInput = '';
    await grantWriteTo(normalised);
  }

  async function addOnlyRespondManual() {
    const normalised = normaliseHandleInput(manualOnlyRespondInput);
    if (!normalised) return;
    manualOnlyRespondInput = '';
    if (settings.onlyRespondTo.includes(normalised)) return;
    const next = [...settings.onlyRespondTo, normalised];
    settings.onlyRespondTo = next;
    markDirty('onlyRespondTo');
    await persistField('onlyRespondTo', next);
  }

  async function removeOnlyRespondHandle(handle: string) {
    const next = settings.onlyRespondTo.filter((h) => h !== handle);
    settings.onlyRespondTo = next;
    markDirty('onlyRespondTo');
    await persistField('onlyRespondTo', next);
  }

  function isOnlyRespondActive(): boolean {
    return settings.onlyRespondTo.length > 0;
  }

  async function toggleOnlyRespondTo(handle: string) {
    const existing = settings.onlyRespondTo.includes(handle);
    const next = existing
      ? settings.onlyRespondTo.filter((h) => h !== handle)
      : [...settings.onlyRespondTo, handle];
    settings.onlyRespondTo = next;
    markDirty('onlyRespondTo');
    await persistField('onlyRespondTo', next);
  }

  async function clearOnlyRespondTo() {
    settings.onlyRespondTo = [];
    markDirty('onlyRespondTo');
    await persistField('onlyRespondTo', []);
  }

  const eligibleNewGrantees = $derived(
    roomAgentHandles.filter((h) => !settings.writeGrants.some((g) => g.handle === h))
  );
</script>

<ModalShell {open} onCancel={onClose} size="wide">
  {#snippet title()}
    Terminal settings
    <p class="terminal-label">{terminalName}</p>
  {/snippet}

  {#snippet headerRight()}
    <button type="button" class="close-btn" onclick={onClose} aria-label="Close terminal settings">×</button>
  {/snippet}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !endpointReady}
    <div class="endpoint-pending" role="status">
      <strong>Settings endpoint not deployed yet.</strong>
      <span>The server-side `/api/terminals/{terminalId}/settings` route is coming as part of the terminal-controls slice; this modal is ready and will start writing the moment the endpoint lands.</span>
    </div>
  {:else}
    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}

    <section class="settings-section" aria-labelledby="writeAccessHeading">
      <h3 id="writeAccessHeading">Write access</h3>
      <p class="section-help">Read is open to all room members. Grant write access to let other agents send input to this terminal.</p>

      {#if settings.writeGrants.length === 0}
        <p class="empty-state">No agents have write access yet.</p>
      {:else}
        <ul class="grant-list">
          {#each settings.writeGrants as grant (grant.handle)}
            <li class="grant-row">
              <span class="grant-handle">{grant.handle}</span>
              <button
                type="button"
                class="revoke-btn"
                onclick={() => void revokeWriteFrom(grant.handle)}
                disabled={saving}
                aria-label={`Revoke write access from ${grant.handle}`}
              >Revoke</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if eligibleNewGrantees.length > 0}
        <div class="grant-picker">
          <select bind:value={stagedNewGrantee} disabled={saving} aria-label="Pick agent to grant write access">
            <option value="">— pick a room agent —</option>
            {#each eligibleNewGrantees as handle (handle)}
              <option value={handle}>{handle}</option>
            {/each}
          </select>
          <button
            type="button"
            class="grant-btn"
            onclick={() => void grantWriteTo(stagedNewGrantee)}
            disabled={saving || stagedNewGrantee === ''}
          >Grant</button>
        </div>
      {/if}

      <div class="grant-picker">
        <input
          type="text"
          bind:value={manualGranteeInput}
          placeholder="@handle (type a handle to grant)"
          disabled={saving}
          aria-label="Type a handle to grant write access"
          onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void grantWriteToManual(); } }}
        />
        <button
          type="button"
          class="grant-btn"
          onclick={() => void grantWriteToManual()}
          disabled={saving || manualGranteeInput.trim().length === 0}
        >Grant write access</button>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="persistenceHeading">
      <h3 id="persistenceHeading">Output persistence</h3>
      <p class="section-help">How long this terminal's output history is kept on disk. Default is forever — SURFACE-SIZE-ONLY pattern, manual prune only.</p>
      <div class="persistence-picker" role="radiogroup" aria-label="Persistence duration">
        {#each PERSISTENCE_CHOICES as choice (choice.value)}
          <button
            type="button"
            role="radio"
            class="persistence-choice"
            class:active={settings.persistence === choice.value}
            aria-checked={settings.persistence === choice.value}
            onclick={() => void changePersistence(choice.value)}
            disabled={saving}
            title={choice.description}
          >{choice.label}</button>
        {/each}
      </div>
    </section>

    <section class="settings-section" aria-labelledby="killDefaultHeading">
      <h3 id="killDefaultHeading">Default kill action</h3>
      <p class="section-help">Pick what happens when you click the 🛑 kill button. Default is to ask every time; pick a disposition to skip the confirm modal.</p>
      <div class="persistence-picker" role="radiogroup" aria-label="Default kill disposition">
        {#each KILL_DEFAULT_CHOICES as choice (choice.value)}
          <button
            type="button"
            role="radio"
            class="persistence-choice"
            class:active={settings.killDefault === choice.value}
            aria-checked={settings.killDefault === choice.value}
            onclick={() => void changeKillDefault(choice.value)}
            disabled={saving}
            title={choice.description}
          >{choice.label}</button>
        {/each}
      </div>
    </section>

    <TerminalSettingsOnlyRespond
      onlyRespondTo={settings.onlyRespondTo}
      {roomAgentHandles}
      {manualOnlyRespondInput}
      {saving}
      onManualInputChange={(next) => { manualOnlyRespondInput = next; }}
      onAddManual={() => void addOnlyRespondManual()}
      onToggleHandle={(handle) => void toggleOnlyRespondTo(handle)}
      onRemoveHandle={(handle) => void removeOnlyRespondHandle(handle)}
      onClear={() => void clearOnlyRespondTo()}
      isActive={isOnlyRespondActive()}
    />
  {/if}

  {#snippet actions()}
    <button type="button" class="done-btn" onclick={onClose}>Done</button>
  {/snippet}
</ModalShell>

<style>
  .terminal-label { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
  .close-btn {
    width: 2rem; height: 2rem;
    background: transparent; border: 1px solid var(--line-soft);
    border-radius: 999px; color: var(--ink-soft); font-size: 1.2rem; line-height: 1;
    cursor: pointer;
  }
  .close-btn:hover { color: var(--ink-strong); border-color: var(--ink-strong); }

  .settings-section { display: flex; flex-direction: column; gap: 0.55rem; }
  .settings-section h3 { margin: 0; font-size: 0.95rem; color: var(--ink-strong); }
  .section-help { margin: 0; color: var(--ink-soft); font-size: 0.82rem; line-height: 1.4; }
  .empty-state { margin: 0.2rem 0; color: var(--ink-soft); font-size: 0.82rem; font-style: italic; }
  .error { margin: 0; color: var(--warn, #c92020); font-size: 0.85rem; font-weight: 700; }
  .muted { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }

  .endpoint-pending {
    display: flex; flex-direction: column; gap: 0.3rem;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.7rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.85rem;
  }
  .endpoint-pending strong { color: var(--ink-strong); }
  .endpoint-pending span { color: var(--ink-soft); font-weight: 500; line-height: 1.4; }

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
  .grant-picker select,
  .grant-picker input {
    flex: 1 1 auto;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line-soft); border-radius: 0.4rem;
    background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.82rem;
    min-width: 0;
  }
  .grant-picker input:focus { outline: none; border-color: var(--accent); }
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

  .persistence-picker { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .persistence-choice {
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    font-weight: 700; font-size: 0.82rem;
    cursor: pointer;
  }
  .persistence-choice.active {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  .persistence-choice:disabled { opacity: 0.5; cursor: not-allowed; }

  .done-btn {
    padding: 0.5rem 1.2rem;
    border-radius: 999px;
    border: 1px solid var(--ink-strong);
    background: var(--ink-strong);
    color: var(--surface-card);
    font-weight: 800;
    cursor: pointer;
  }
  .done-btn:hover { filter: brightness(1.1); }
</style>
