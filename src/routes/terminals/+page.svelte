<!--
  /terminals — Desk directory plus bring-in surface.
  ANT terminals are handle-bearing Desks. Loose tmux panes are shown only so
  the operator can bring them into ANT with an explicit ANThandle.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import KillConfirmModal from '$lib/components/KillConfirmModal.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import TerminalCard from '$lib/components/TerminalCard.svelte';
  import UsageStrip from '$lib/components/UsageStrip.svelte';
  import HelperPairingPanel from '$lib/components/HelperPairingPanel.svelte';
  import UsageBadge from '$lib/components/UsageBadge.svelte';
  import type { UsagePayload } from '$lib/usage/types';
  import { agentKinds } from '$lib/stores/agentKinds.svelte';
  import { terminalClasses } from '$lib/stores/terminalClasses.svelte';
  import { terminalAnchorId } from '$lib/terminal/terminalDeepLink';

  type TerminalRecord = {
    sessionId: string;
    name: string;
    handle?: string | null;
    derivedHandle?: string | null;
    agentKind?: string | null;
    model?: string | null;
    agentStatus?: string | null;
    roomCount?: number;
    accountType?: string | null;
    modelFamily?: string | null;
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
  // Single shared UsagePayload pulled once at the page level so the
  // strip + every UsageBadge work off the same snapshot — avoids N
  // parallel /api/usage calls (one per terminal card). Refreshed every
  // 30 s to match the proxy cache TTL.
  let pageUsage = $state<UsagePayload | null>(null);
  let activeId = $state<string | null>(null);
  let activeName = $state<string>('');
  let shortcutsOpen = $state(false);
  let creating = $state(false);
  let lastError = $state('');

  // Claim modal — shared by spawn-new + attach-existing.
  let modalOpen = $state(false);
  let modalMode = $state<'spawn' | 'attach'>('spawn');
  let modalSessionId = $state<string | null>(null);
  let pendingName = $state('');
  let pendingHandle = $state('');
  let pendingUser = $state('@JWPK');
  let pendingPickedHandles = $state<string[]>([]);  // co-owner multi-select from existing terminal handles
  let pendingHandleOnly = $state(false);

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
  function canonicalHandle(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return '';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }
  function suggestedHandle(name: string, fallback: string): string {
    return '@' + (slugify(name) || fallback);
  }
  function validatePendingHandle(raw: string): string {
    const canonical = canonicalHandle(raw);
    if (canonical.length === 0) return 'Choose the ANThandle this Desk will use.';
    if (canonical.length > 64) return 'ANThandle must be 64 characters or fewer.';
    const local = canonical.slice(1);
    if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?$/.test(local)) {
      return "Use letters, numbers, '_', '-', or '.', and do not start or end with '.' or '-'.";
    }
    return '';
  }
  const pendingHandleError = $derived(validatePendingHandle(pendingHandle));
  const canConfirmClaim = $derived(
    pendingName.trim().length > 0 &&
    pendingUser.trim().length > 0 &&
    pendingHandleError.length === 0
  );
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
    const defaultName = `Terminal ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    pendingName = defaultName;
    pendingHandle = suggestedHandle(defaultName, `term-${Date.now().toString(36).slice(-5)}`);
    pendingUser = '@JWPK';
    pendingPickedHandles = [];
    pendingHandleOnly = false;
    modalOpen = true;
  }

  function openAttachModal(pane: TmuxPane): void {
    modalMode = 'attach';
    modalSessionId = pane.sessionId;
    const defaultName = `Attached ${pane.sessionId.slice(0, 8)}`;
    pendingName = defaultName;
    pendingHandle = suggestedHandle(defaultName, `pane-${pane.sessionId.slice(0, 8)}`);
    pendingUser = '@JWPK';
    pendingPickedHandles = [];
    pendingHandleOnly = false;
    modalOpen = true;
  }

  function cancelModal(): void {
    modalOpen = false;
    pendingName = '';
    pendingHandle = '';
    modalSessionId = null;
  }

  async function confirmClaim(): Promise<void> {
    const name = pendingName.trim();
    const handle = canonicalHandle(pendingHandle);
    const user = pendingUser.trim();
    if (!name || !user || pendingHandleError) return;
    modalOpen = false;
    creating = true;
    lastError = '';
    try {
      const body: Record<string, unknown> = { name, handle, user };
      if (modalSessionId) body.sessionId = modalSessionId;
      if (pendingPickedHandles.length > 0) body.allowlist = [...pendingPickedHandles];
      if (pendingHandleOnly) body.deliveryTargetMode = 'handle_only';
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${modalMode} failed: ${res.status}${detail ? ` — ${detail.slice(0, 180)}` : ''}`);
      }
      const json = (await res.json()) as { sessionId: string; name: string };
      activeId = json.sessionId;
      activeName = json.name || name;
      shortcutsOpen = false;
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
        body: JSON.stringify({ callerHandle: '@JWPK', mode })
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
    shortcutsOpen = false;
  }

  function chipLabel(record: TerminalRecord): string {
    // v2 handle-FIRST (JWPK 2026-06-11): the witnessed handle is the identity;
    // the auto:t_xxx name only shows when no handle exists. This is the fix for
    // "the handles look weird AF" — names stop masquerading as identities.
    const h = (record.handle ?? '').trim();
    if (h.length > 0) return h;
    const derived = (record.derivedHandle ?? '').trim();
    if (derived.length > 0) return derived;
    return record.name && record.name.length > 0 ? record.name : record.sessionId.slice(0, 12) + '…';
  }

  // ─── Session recovery (post-reboot) ──────────────────────────────────────
  // Multi-select archived sessions and recover them in one move: the server
  // recreates each tmux pane in its original cwd, re-runs the agent launch
  // command, and rebinds identity. See src/lib/server/sessionRecovery.ts.
  let selectedStale = $state<Set<string>>(new Set());
  // v2: archived desks are hidden by default (JWPK: the [A] rows cluttered the
  // view). Toggle reveals them for recovery.
  let showArchived = $state(false);
  let resumeOnRecover = $state(false);
  let recovering = $state(false);
  let recoverPreview = $state<string>('');

  function toggleStale(sessionId: string): void {
    const next = new Set(selectedStale);
    if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
    selectedStale = next;
    recoverPreview = '';
  }

  async function recover(sessionIds: string[], dryRun: boolean): Promise<void> {
    if (sessionIds.length === 0) return;
    recovering = true;
    lastError = '';
    try {
      const res = await fetch('/api/terminals/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionIds, resume: resumeOnRecover, dryRun })
      });
      if (!res.ok) throw new Error(`recover failed: ${res.status}`);
      const body = (await res.json()) as { recovered?: Array<{ name: string; command: string | null; error?: string }> };
      const outcomes = body.recovered ?? [];
      if (dryRun) {
        recoverPreview = outcomes
          .map((o) => `${o.name} → ${o.command ?? '(shell only)'}`)
          .join('\n');
      } else {
        recoverPreview = '';
        selectedStale = new Set();
        await loadTerminals();
        // Surface per-session failures so the operator isn't left guessing why
        // a chip stayed archived.
        const errors = outcomes.filter((o) => o.error).map((o) => `${o.name}: ${o.error}`);
        if (errors.length > 0) lastError = `Some sessions failed to recover — ${errors.join('; ')}`;
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      recovering = false;
    }
  }

  function recoverSelected(): void { void recover([...selectedStale], false); }
  function previewSelected(): void { void recover([...selectedStale], true); }
  function recoverAll(): void { void recover(staleTerminals.map((r) => r.sessionId), false); }

  // Group ANT terminals by agentKind sub-headings per JWPK THREAD 1.
  // Ungrouped (null/empty) section appears last.
  //
  // JWPK msg_fespxsi2lu antV4 2026-05-28: now also nested by model
  // within each CLI heading. "Kimi running in codex" vs "codex running
  // in codex" should be visually distinct. Each Group carries a list
  // of ModelSubgroups; unspecified models fold into one "unspecified"
  // subgroup that always renders last.
  type ModelSubgroup = { model: string; label: string; records: TerminalRecord[] };
  type AccountGroup = { account: string; label: string; subgroups: ModelSubgroup[]; deskCount: number };
  type Group = { kind: string; label: string; accounts: AccountGroup[] };

  // Terminals v2 (JWPK sketch 2026-06-11): CLI → ACCOUNT TYPE → model family
  // → desk chips. Account type derived from agent kind; the page surfaces an
  // honest "Unclassified" bucket rather than hiding kind-detection gaps.
  const CLI_LABEL: Record<string, string> = {
    'claude-code': 'Claude', claude: 'Claude', codex: 'Codex', codex_cli: 'Codex',
    gemini: 'Gemini', qwen: 'Qwen', copilot: 'CoPilot', pi: 'Pi', ollama: 'Ollama',
    antigravity: 'Antigravity', minimax: 'MiniMax', kimi: 'Kimi', remote: 'Remote', aider: 'Aider'
  };
  // v3: account type is a STORED, operator-chosen attribute. Unset terminals
  // fold into a visible "No account set" bucket — surfaced, never hidden.
  function accountOf(record: TerminalRecord): string {
    const a = (record.accountType ?? '').trim();
    return a.length > 0 ? a : 'No account set';
  }
  // Desk-chip status → colour. Mirrors the agent_status enum.
  const STATUS_DOT: Record<string, string> = {
    working: '#5aa9ff', thinking: '#b58cff', idle: '#3fd07a',
    'response-required': '#e0a93e'
  };
  function statusDot(s?: string | null): string {
    return STATUS_DOT[(s ?? 'idle')] ?? '#7d8da0';
  }
  // The account panel's usage badge must reflect the ACCOUNT's provider, not
  // the CLI (JWPK 2026-06-11: an Ollama Subscription panel wrongly showed
  // "Codex" usage). Non-billable accounts (Local/External/unset) → null so NO
  // figure shows — a wrong number is worse than none.
  const ACCOUNT_USAGE_KIND: Record<string, string | null> = {
    'Claude Subscription': 'claude', 'Codex Subscription': 'codex',
    'Ollama Subscription': 'ollama', 'Gemini Subscription': 'gemini',
    'Qwen Subscription': 'qwen', 'Copilot Subscription': 'copilot',
    'Quiver Subscription': 'quiver', 'Local': null, 'External': null,
    'No account set': null
  };
  function accountUsageKind(account: string): string | null {
    return ACCOUNT_USAGE_KIND[account] ?? null;
  }

  function buildModelSubgroups(records: TerminalRecord[]): ModelSubgroup[] {
    const byModel = new Map<string, TerminalRecord[]>();
    for (const r of records) {
      // v3: group by the CHOSEN model family, not the free-text model tag.
      const key = (r.modelFamily ?? '').trim();
      const arr = byModel.get(key) ?? [];
      arr.push(r);
      byModel.set(key, arr);
    }
    const subgroups: ModelSubgroup[] = [];
    // Named models first (sorted) so the order is stable across loads.
    const named = [...byModel.keys()].filter((k) => k.length > 0).sort();
    for (const model of named) {
      const recs = byModel.get(model);
      if (recs && recs.length > 0) subgroups.push({ model, label: model, records: recs });
    }
    const unspecified = byModel.get('') ?? [];
    if (unspecified.length > 0) {
      subgroups.push({ model: '', label: 'No family set', records: unspecified });
    }
    return subgroups;
  }

  function buildAccountGroups(records: TerminalRecord[]): AccountGroup[] {
    const byAccount = new Map<string, TerminalRecord[]>();
    for (const r of records) {
      const acct = accountOf(r);
      const arr = byAccount.get(acct) ?? [];
      arr.push(r);
      byAccount.set(acct, arr);
    }
    const accounts: AccountGroup[] = [];
    for (const acct of [...byAccount.keys()].sort()) {
      const recs = byAccount.get(acct) ?? [];
      accounts.push({
        account: acct, label: acct, deskCount: recs.length,
        subgroups: buildModelSubgroups(recs)
      });
    }
    return accounts;
  }

  const groupedTerminals = $derived.by<Group[]>(() => {
    const byKind = new Map<string, TerminalRecord[]>();
    for (const r of liveTerminals) {
      const key = (r.agentKind ?? '').toString();
      const arr = byKind.get(key) ?? [];
      arr.push(r);
      byKind.set(key, arr);
    }
    // Stable CLI order; unknown kinds fold to their own buckets, raw-PTY last.
    const known = ['claude-code', 'claude', 'codex', 'codex_cli', 'gemini', 'antigravity', 'qwen', 'copilot', 'pi', 'ollama', 'aider'];
    const seen = new Set<string>();
    const groups: Group[] = [];
    const pushGroup = (k: string, records: TerminalRecord[]) => {
      if (!records || records.length === 0) return;
      groups.push({ kind: k, label: CLI_LABEL[k] ?? k, accounts: buildAccountGroups(records) });
    };
    for (const k of known) { if (byKind.has(k)) { pushGroup(k, byKind.get(k)!); seen.add(k); } }
    for (const [k, records] of byKind) {
      if (seen.has(k) || k === '') continue;
      pushGroup(k, records);
    }
    const ungrouped = byKind.get('') ?? [];
    if (ungrouped.length > 0) {
      groups.push({ kind: '', label: 'No agent (raw PTY)', accounts: buildAccountGroups(ungrouped) });
    }
    return groups;
  });

  async function refreshUsage(): Promise<void> {
    try {
      const response = await fetch('/api/usage', { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      pageUsage = (await response.json()) as UsagePayload;
    } catch {
      // Strip handles the empty / error case visually.
    }
  }

  // v3 (JWPK msg_om51nvohx5): the desk pane carries account + family
  // selectors alongside the CLI/model controls. Each PATCHes its own field
  // optimistically; loadTerminals() reconciles on error.
  async function patchTerminalClass(
    record: TerminalRecord, field: 'account' | 'family', value: string
  ): Promise<void> {
    const payload = value.trim().length === 0 ? null : value.trim();
    if (field === 'account') record.accountType = payload; else record.modelFamily = payload;
    terminals = [...terminals];
    const bodyKey = field === 'account' ? 'accountType' : 'family';
    try {
      const response = await fetch(`/api/terminals/${encodeURIComponent(record.sessionId)}/${field}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: payload })
      });
      if (!response.ok) { lastError = `Saving ${field} failed (${response.status}).`; await loadTerminals(); }
    } catch (cause) {
      lastError = `Saving ${field} failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      await loadTerminals();
    }
  }

  async function patchTerminalCli(record: TerminalRecord, value: string): Promise<void> {
    const payload = value.trim().length === 0 ? null : value.trim();
    record.agentKind = payload;
    terminals = [...terminals];
    try {
      const response = await fetch(`/api/terminals/${encodeURIComponent(record.sessionId)}/cli`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cli: payload })
      });
      if (!response.ok) { lastError = `Saving CLI failed (${response.status}).`; await loadTerminals(); }
    } catch (cause) {
      lastError = `Saving CLI failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      await loadTerminals();
    }
  }

  onMount(() => {
    void loadTerminals();
    void refreshUsage();
    agentKinds.init();
    terminalClasses.init();
    const usageHandle = setInterval(() => void refreshUsage(), 30_000);
    return () => clearInterval(usageHandle);
  });
</script>

<svelte:head><title>Terminals | ANT vNext</title></svelte:head>

<SimplePageShell eyebrow="Terminals" title="Terminals." summary="ANT Desks first. Loose tmux panes are listed separately so you can bring them into ANT with a handle.">
  <UsageStrip />
  <HelperPairingPanel />
  <section class="terminal-controls">
    <button type="button" class="primary" onclick={openSpawnModal} disabled={creating}>
      {creating ? 'Working…' : '+ New ANT terminal'}
    </button>

    <section class="tier tier-primary" aria-label="ANT terminals">
      <h3 class="tier-heading">The desk directory <span class="muted">— CLI → account → model → desk</span></h3>
      {#if liveTerminals.length === 0}
        <p class="tier-empty">No ANT terminals yet — click "+ New ANT terminal" above to create one, or attach an existing tmux pane below.</p>
      {:else}
        {#each groupedTerminals as group (group.kind || 'none')}
          <div class="cli-group">
            <h4 class="cli-heading">{group.label}</h4>
            {#each group.accounts as acct (acct.account)}
              <div class="acct-group">
                <div class="acct-heading">
                  <span class="acct-name">{acct.label}</span>
                  <span class="acct-usage">
                    <UsageBadge agentKind={accountUsageKind(acct.account)} usage={pageUsage} />
                    <span class="acct-count">{acct.deskCount} desk{acct.deskCount === 1 ? '' : 's'}</span>
                  </span>
                </div>
                {#each acct.subgroups as subgroup (subgroup.model || 'unspecified')}
                  <div class="model-subgroup">
                    <h5 class="model-subheading"><span class="model-marker">●</span>{subgroup.label}</h5>
                    <div class="chips">
                      {#each subgroup.records as record (record.sessionId)}
                        <!-- Anchor target for terminal deep-links. -->
                        <span class="desk-chip" id={terminalAnchorId(record.sessionId)}>
                          <button
                            type="button"
                            class="chip ant-chip"
                            class:active={activeId === record.sessionId}
                            title={`${record.name} • ${record.sessionId} • ${record.createdBy ?? ''}`}
                            onclick={() => attach(record)}
                          >{chipLabel(record)}</button>
                          <span class="chip-bubble">
                            <span class="status-dot" style={`background:${statusDot(record.agentStatus)}`}></span>
                            <span class="bubble-text">{record.agentStatus ?? 'idle'}</span>
                            {#if record.tmuxTargetPane}<span class="bubble-sep">·</span><span class="bubble-pane">{record.tmuxTargetPane}</span>{/if}
                            <span class="bubble-sep">·</span><span class="bubble-rooms">{record.roomCount ?? 0} room{(record.roomCount ?? 0) === 1 ? '' : 's'}</span>
                          </span>
                          <span class="desk-selectors">
                            <select
                              class="class-picker"
                              aria-label={`CLI for ${chipLabel(record)}`}
                              value={record.agentKind ?? ''}
                              onchange={(e) => patchTerminalCli(record, (e.currentTarget as HTMLSelectElement).value)}
                            >
                              <option value="">— CLI —</option>
                              {#each agentKinds.enabled as k (k)}<option value={k}>{k}</option>{/each}
                              {#if record.agentKind && !agentKinds.enabled.includes(record.agentKind)}
                                <option value={record.agentKind}>{record.agentKind}</option>
                              {/if}
                            </select>
                            <select
                              class="class-picker"
                              aria-label={`Account for ${chipLabel(record)}`}
                              value={record.accountType ?? ''}
                              onchange={(e) => patchTerminalClass(record, 'account', (e.currentTarget as HTMLSelectElement).value)}
                            >
                              <option value="">— account —</option>
                              {#each terminalClasses.accountTypes as a (a)}<option value={a}>{a}</option>{/each}
                              {#if record.accountType && !terminalClasses.accountTypes.includes(record.accountType)}
                                <option value={record.accountType}>{record.accountType}</option>
                              {/if}
                            </select>
                            <select
                              class="class-picker"
                              aria-label={`Family for ${chipLabel(record)}`}
                              value={record.modelFamily ?? ''}
                              onchange={(e) => patchTerminalClass(record, 'family', (e.currentTarget as HTMLSelectElement).value)}
                            >
                              <option value="">— family —</option>
                              {#each terminalClasses.modelFamilies as f (f)}<option value={f}>{f}</option>{/each}
                              {#if record.modelFamily && !terminalClasses.modelFamilies.includes(record.modelFamily)}
                                <option value={record.modelFamily}>{record.modelFamily}</option>
                              {/if}
                            </select>
                          </span>
                        </span>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/each}
      {/if}
    </section>

    {#if staleTerminals.length > 0}
      <button type="button" class="archived-toggle" onclick={() => (showArchived = !showArchived)}>
        {showArchived ? '▾ Hide' : '▸ Show'} {staleTerminals.length} archived desk{staleTerminals.length === 1 ? '' : 's'}
      </button>
    {/if}
    {#if staleTerminals.length > 0 && showArchived}
      <section class="tier tier-stale" aria-label="Archived terminals">
        <h3 class="tier-heading">Archived terminals <span class="muted">— tmux pane gone; select to recover</span></h3>
        <div class="recover-bar">
          <button
            type="button"
            class="recover-btn primary"
            disabled={selectedStale.size === 0 || recovering}
            onclick={recoverSelected}
          >Recover selected ({selectedStale.size})</button>
          <button
            type="button"
            class="recover-btn secondary"
            disabled={recovering}
            onclick={recoverAll}
          >Recover all</button>
          <button
            type="button"
            class="recover-btn secondary"
            disabled={selectedStale.size === 0 || recovering}
            onclick={previewSelected}
          >Show command</button>
          <label class="resume-toggle">
            <input type="checkbox" bind:checked={resumeOnRecover} />
            Resume <span class="muted">(append --resume "name")</span>
          </label>
        </div>
        <div class="chips">
          {#each staleTerminals as record (record.sessionId)}
            <button
              type="button"
              class="chip ant-chip dead selectable"
              class:selected={selectedStale.has(record.sessionId)}
              title={`${record.sessionId} is archived — click to select for recovery`}
              onclick={() => toggleStale(record.sessionId)}
            >
              {chipLabel(record)}
            </button>
          {/each}
        </div>
        {#if recoverPreview}
          <pre class="recover-preview">{recoverPreview}</pre>
        {/if}
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
      <div class="active-terminal-toolbar">
        <button
          type="button"
          class="shortcuts-toggle"
          aria-expanded={shortcutsOpen}
          onclick={() => (shortcutsOpen = !shortcutsOpen)}
        >
          <span class="toggle-caret" aria-hidden="true">{shortcutsOpen ? '▾' : '▸'}</span>
          CLIs / Shortcuts
        </button>
      </div>
      {#key activeId}
        <TerminalCard
          terminalId={activeId}
          userName={activeName}
          showShortcuts={shortcutsOpen}
          onKilled={async () => {
            const killedId = activeId;
            activeId = null;
            shortcutsOpen = false;
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
        <label>ANThandle <input type="text" bind:value={pendingHandle} placeholder="@t1" autocapitalize="none" spellcheck="false" required /></label>
        {#if pendingHandleError}<p class="field-error">{pendingHandleError}</p>{/if}
        <label>User (creator handle) <input type="text" bind:value={pendingUser} placeholder="@JWPK" required /></label>
        <!-- agentKind is set AFTER spawn via TerminalHeader dropdown per JWPK
             Option B 2026-05-14: daemon doesn't launch the CLI, only stores
             the label metadata — removing the field from the create modal
             since it's redundant + canonical edit-point is header. -->

        <fieldset class="allowlist-picker">
          <legend>Co-owners (optional)</legend>
          <p class="picker-hint">Empty = creator + operator only. Co-owners can manage this terminal.</p>
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
        <fieldset class="allowlist-picker">
          <legend>Delivery target</legend>
          <label class="check-row">
            <input type="checkbox" bind:checked={pendingHandleOnly} />
            <span>Handle only</span>
          </label>
          <p class="picker-hint">Plain fanout with no @ mention is ignored. ANT-resolved roomHandle/ANThandle mentions and bare @everyone still reach the pane.</p>
        </fieldset>
        <div class="actions">
          <button type="button" class="secondary" onclick={cancelModal}>Cancel</button>
          <button type="submit" class="primary" disabled={!canConfirmClaim}>
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
  /* v2 desk directory (JWPK sketch 2026-06-11): CLI → account → model → desk */
  .cli-group { display: grid; gap: 0.4rem; margin-top: 0.9rem; }
  .cli-heading { margin: 0 0 0.2rem 0; font-size: 0.95rem; font-weight: 700; color: var(--accent); font-family: ui-monospace, monospace; letter-spacing: 0.03em; border-bottom: 1px solid var(--surface-edge); padding-bottom: 0.35rem; }
  .acct-group { display: grid; gap: 0.25rem; margin-left: 0.4rem; padding: 0.55rem 0.65rem; background: var(--surface-card); border: 1px solid var(--line-soft); border-radius: 0.6rem; }
  .acct-heading { display: flex; align-items: center; gap: 0.7rem; }
  .acct-name { font-size: 0.8rem; font-weight: 600; color: var(--ink-strong); font-family: ui-monospace, monospace; }
  .acct-usage { margin-left: auto; display: inline-flex; align-items: center; gap: 0.5rem; }
  .acct-count { font-size: 0.7rem; color: var(--ink-soft); font-family: ui-monospace, monospace; }
  .desk-chip { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; padding: 0.1rem; }
  .chip-bubble { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.66rem; color: var(--ink-soft); font-family: ui-monospace, monospace; padding-left: 0.15rem; }
  .status-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; display: inline-block; flex: none; }
  .bubble-sep { opacity: 0.4; }
  .bubble-pane { color: var(--ink-strong); opacity: 0.75; }
  .desk-selectors { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
  .class-picker { font-size: 0.68rem; padding: 0.12rem 0.28rem; border: 1px solid var(--line-soft); border-radius: 0.35rem; background: var(--surface-card); color: var(--ink-soft); font-family: ui-monospace, monospace; max-width: 8.5rem; }
  .class-picker:focus { outline: 2px solid var(--accent); outline-offset: 1px; color: var(--ink-strong); }
  .archived-toggle { margin-top: 0.8rem; width: fit-content; padding: 0.3rem 0.7rem; border: 1px dashed var(--surface-edge); border-radius: 999px; background: transparent; color: var(--ink-soft); font-size: 0.72rem; font-family: ui-monospace, monospace; cursor: pointer; }
  .archived-toggle:hover { color: var(--ink-strong); border-color: var(--line-soft); }
  .model-subgroup { display: grid; gap: 0.2rem; margin-left: 0.6rem; padding-left: 0.5rem; border-left: 1px solid var(--surface-edge); }
  .model-subheading { margin: 0.2rem 0 0.1rem 0; font-size: 0.7rem; color: var(--ink-soft); font-weight: 500; font-family: ui-monospace, monospace; display: inline-flex; align-items: center; gap: 0.3rem; }
  .model-marker { color: var(--accent); opacity: 0.7; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { padding: 0.35rem 0.65rem; border: 1px solid var(--line-soft); border-radius: 999px; background: var(--surface-card); color: var(--ink-strong); font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; }
  .chip.active { border-color: var(--accent); color: var(--accent); font-weight: 700; }
  .chip.dead { opacity: 0.55; cursor: default; }
  .chip.dead.selectable { cursor: pointer; opacity: 0.7; }
  .chip.dead.selectable:hover { opacity: 1; border-color: var(--accent); }
  .chip.dead.selected { opacity: 1; border-color: var(--accent); color: var(--accent); font-weight: 700; background: var(--surface-card); }
  .tier-stale { margin-top: 0.9rem; padding-top: 0.75rem; border-top: 1px dashed var(--surface-edge); }
  .recover-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; }
  .recover-btn { padding: 0.35rem 0.8rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
  .recover-btn.primary { border: 1px solid var(--accent); background: var(--accent); color: white; }
  .recover-btn.secondary { border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong); }
  .recover-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .resume-toggle { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; color: var(--ink-strong); }
  .recover-preview { margin: 0.5rem 0 0; padding: 0.5rem 0.7rem; border-radius: 0.4rem; background: var(--surface-card); border: 1px solid var(--line-soft); font-family: ui-monospace, monospace; font-size: 0.75rem; white-space: pre-wrap; color: var(--ink-soft); }
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
  .terminal-mount { display: grid; gap: 0.45rem; border-radius: 0.85rem; }
  .active-terminal-toolbar { display: flex; justify-content: flex-end; align-items: center; }
  .shortcuts-toggle {
    width: fit-content;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .shortcuts-toggle:hover,
  .shortcuts-toggle[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .toggle-caret { font-size: 0.8rem; line-height: 1; }
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
  .field-error { margin: -0.2rem 0 0; font-size: 0.75rem; color: var(--accent); font-weight: 700; }
  .check-row { display: inline-flex; align-items: center; gap: 0.45rem; color: var(--ink-strong); font-weight: 700; font-size: 0.85rem; width: fit-content; }
  .check-row input { width: 1rem; height: 1rem; accent-color: var(--accent); }
  .handle-pills { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .handle-pill { padding: 0.25rem 0.7rem; border: 1px solid var(--line-soft); border-radius: 999px; background: var(--bg); color: var(--ink-strong); font-size: 0.8rem; font-family: ui-monospace, monospace; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .handle-pill:hover { border-color: var(--accent); color: var(--accent); }
  .handle-pill.selected { background: var(--accent); border-color: var(--accent); color: white; font-weight: 700; }
</style>
