<!--
  TerminalSettingsModal.svelte — per-terminal controls modal (JWPK
  msg_oipe096odw screenshot + coord msg_v66nyw5t7x routing).

  Hosts three affordances grouped under one modal so the header stays
  uncluttered and the operator only opens one dialog to configure a
  terminal:
    1. Write access grant — multi-select of room agents who can inject
       input. Read is implicit for every room member (JWPK clarification
       msg_n6asvi0j87 "All should be able to read — it is the rite we are
       giving permission to").
    2. Persistence dropdown — how long the terminal's output history is
       retained. Defaults to 'forever' per SURFACE-SIZE-ONLY pattern.
    3. Only-respond-to-@ toggle — scope the terminal to respond only to
       a specific set of handles (mention-gating). Reuses the room mode
       primitive.

  Reads + writes pass through /api/terminals/:id/settings (a new endpoint
  the server lane owns). Modal degrades to read-only display if the
  endpoint isn't yet deployed (404) so the UI ships ahead of the server.
-->
<script lang="ts">
  type PersistenceChoice = '1h' | '24h' | '7d' | 'forever';
  type WriteGrant = { handle: string; grantedAtMs: number };
  type KillDefault = 'prompt' | 'archive' | 'delete' | 'just-kill';
  type Settings = {
    persistence: PersistenceChoice;
    onlyRespondTo: string[];  // handles; empty = respond to everyone
    writeGrants: WriteGrant[];
    killDefault: KillDefault;
  };

  type Props = {
    terminalId: string;
    terminalName: string;
    roomAgentHandles: string[];  // candidates for write-grant + respond-to multi-selects
    open: boolean;
    onClose: () => void;
  };

  let { terminalId, terminalName, roomAgentHandles, open, onClose }: Props = $props();

  const PERSISTENCE_CHOICES: { value: PersistenceChoice; label: string; description: string }[] = [
    { value: '1h', label: '1 hour', description: 'Output history pruned after 1h' },
    { value: '24h', label: '24 hours', description: 'Output history pruned after 24h' },
    { value: '7d', label: '7 days', description: 'Output history pruned after 7d' },
    { value: 'forever', label: 'Forever (default)', description: 'Never auto-pruned — manual prune only' }
  ];

  const KILL_DEFAULT_CHOICES: { value: KillDefault; label: string; description: string }[] = [
    { value: 'prompt', label: 'Always ask', description: 'Show the kill confirm modal every time (default)' },
    { value: 'just-kill', label: 'Just Kill', description: 'Process dies, terminal + linked chat stay for re-attach' },
    { value: 'archive', label: 'Kill + Archive', description: 'Keep transcript + linked chat history; hides from list' },
    { value: 'delete', label: 'Kill + Delete', description: 'Drop transcript + linked chat + terminal record entirely' }
  ];

  const DEFAULT_SETTINGS: Settings = { persistence: 'forever', onlyRespondTo: [], writeGrants: [], killDefault: 'prompt' };

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let loading = $state(false);
  let saving = $state(false);
  let endpointReady = $state(true);
  let errorMessage = $state('');
  let dirtyFields = $state<Set<keyof Settings>>(new Set());
  // Stage the write-grant picker — operator ticks handles, hits Grant
  // to commit. Read state is implicit so no read picker needed.
  let stagedNewGrantee = $state<string>('');
  // Manual handle inputs (JWPK msg_hdhf0rsdhx 2026-05-19) — surface a
  // text field on BOTH the write-grant picker AND the only-respond picker
  // so the operator can type any handle even when the linked room has no
  // pre-loaded agent members. Without this, terminals like 'localGem'
  // with no linked-room candidates rendered an empty modal with no toggles.
  let manualGranteeInput = $state<string>('');
  let manualOnlyRespondInput = $state<string>('');

  function normaliseHandleInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    if (withAt.length < 2) return null;
    // Lowercase canonicalisation — JWPK msg_iih1ff93u7 case-sensitivity
    // bug 2026-05-19: filter was set as @localGem (capital G) while the
    // operator was typing bare @localgem (lowercase) — strict-contract
    // mismatch silently rejected every message. Lowercase normalisation
    // here means whatever the operator types becomes the canonical form
    // the filter compares against.
    return withAt.toLowerCase();
  }

  async function loadSettings() {
    if (!terminalId) return;
    loading = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/settings`);
      // 404 on GET means the terminal record itself isn't found server-side
      // (per /api/terminals/[id]/settings/+server.ts:79). Treat as 'no
      // settings yet, fall back to defaults but STILL render the 3 sections
      // so the operator can set them. The old branch hid every toggle under
      // an 'endpoint not deployed' card — UX diagnosed JWPK msg_hdhf0rsdhx.
      if (response.status === 404) {
        settings = { ...DEFAULT_SETTINGS };
        dirtyFields.clear();
        return;
      }
      if (!response.ok) {
        errorMessage = `Could not load settings (${response.status}).`;
        return;
      }
      // Server returns the flat settings object (no { settings: ... } wrapper)
      // per /api/terminals/[id]/settings/+server.ts:75-82.
      const incoming = (await response.json()) as Partial<Settings>;
      const incomingKillDefault = typeof incoming.killDefault === 'string'
        && ['prompt', 'archive', 'delete', 'just-kill'].includes(incoming.killDefault)
        ? incoming.killDefault as KillDefault
        : 'prompt';
      settings = {
        persistence: (incoming.persistence as Settings['persistence']) ?? 'forever',
        onlyRespondTo: (incoming.onlyRespondTo as string[]) ?? [],
        // Server may return writeGrants as {handle, mode} pairs — strip mode
        // for v1 (read implicit per JWPK msg_n6asvi0j87; only write is granted).
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
      // Server-side endpoint shape: `{ field, value }` not `{ [field]: value }`
      // per /api/terminals/[id]/settings/+server.ts:84-108 (coord shipped @only
      // end-to-end with this contract). Mismatch was causing 400s on every
      // modal save — JWPK msg_fdi280krd3 'I can't call the agent in till the
      // terminal can be set as @only'.
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

{#if open}
  <div class="settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="terminalSettingsHeading">
    <div class="settings-card">
      <header class="settings-header">
        <h2 id="terminalSettingsHeading">Terminal settings</h2>
        <p class="terminal-label">{terminalName}</p>
        <button type="button" class="close-btn" onclick={onClose} aria-label="Close terminal settings">×</button>
      </header>

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

        <!-- Section 1: Write access -->
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

          <!-- Manual handle input — always visible so the operator can grant
               write access to any handle even when no room candidates loaded
               (the empty-picker case from JWPK msg_hdhf0rsdhx 2026-05-19). -->
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

        <!-- Section 2: Persistence -->
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

        <!-- Section 2b: Default kill disposition -->
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

        <!-- Section 3: Only-respond-to-@ -->
        <section class="settings-section" aria-labelledby="onlyRespondHeading">
          <h3 id="onlyRespondHeading">Only respond to specific handles</h3>
          <p class="section-help">When set, this terminal only reacts to bare <code>@handle</code> mentions of the picked handles (no <code>@everyone</code>, no bracketed mentions, no plain text). Leave empty for default behaviour.</p>
          <p class="section-help membership-tip">
            <strong>Tip:</strong> the handle must be a registered room member for delivery to fire.
            Register a local agent in its shell with
            <code>ant register --handle @yourhandle --room &lt;roomId&gt;</code>,
            or use <code>ant grantagent --pid &lt;PID&gt; --handle @yourhandle</code> from an operator shell.
          </p>

          {#if settings.onlyRespondTo.length > 0}
            <ul class="grant-list">
              {#each settings.onlyRespondTo as handle (handle)}
                <li class="grant-row">
                  <span class="grant-handle">{handle}</span>
                  <button
                    type="button"
                    class="revoke-btn"
                    onclick={() => void removeOnlyRespondHandle(handle)}
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
                {@const active = settings.onlyRespondTo.includes(handle)}
                <button
                  type="button"
                  class="respond-chip"
                  class:active
                  onclick={() => void toggleOnlyRespondTo(handle)}
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
              bind:value={manualOnlyRespondInput}
              placeholder="@handle (only respond to this handle)"
              disabled={saving}
              aria-label="Type a handle to restrict the terminal to"
              onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addOnlyRespondManual(); } }}
            />
            <button
              type="button"
              class="grant-btn"
              onclick={() => void addOnlyRespondManual()}
              disabled={saving || manualOnlyRespondInput.trim().length === 0}
            >Add</button>
          </div>

          {#if isOnlyRespondActive()}
            <button
              type="button"
              class="clear-respond"
              onclick={() => void clearOnlyRespondTo()}
              disabled={saving}
            >Clear — respond to everyone</button>
          {/if}
        </section>
      {/if}

      <footer class="settings-footer">
        <button type="button" class="done-btn" onclick={onClose}>Done</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .settings-backdrop {
    position: fixed; inset: 0; z-index: 1100;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .settings-card {
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.9rem; padding: 1.4rem;
    max-width: 32rem; width: 100%;
    display: flex; flex-direction: column; gap: 1.1rem;
    max-height: 90vh; overflow-y: auto;
  }
  .settings-header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    align-items: start;
    border-bottom: 1px solid var(--line-soft);
    padding-bottom: 0.7rem;
  }
  .settings-header h2 { margin: 0; font-size: 1.1rem; color: var(--ink-strong); grid-column: 1; }
  .terminal-label { margin: 0; color: var(--ink-soft); font-size: 0.85rem; grid-column: 1; }
  .close-btn {
    grid-column: 2; grid-row: 1 / span 2;
    width: 2rem; height: 2rem;
    background: transparent; border: 1px solid var(--line-soft);
    border-radius: 999px; color: var(--ink-soft); font-size: 1.2rem; line-height: 1;
    cursor: pointer;
  }
  .close-btn:hover { color: var(--ink-strong); border-color: var(--ink-strong); }

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

  .settings-footer { display: flex; justify-content: flex-end; padding-top: 0.7rem; border-top: 1px solid var(--line-soft); }
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
