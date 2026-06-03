<!--
  TerminalCard.svelte — FRONT-1 per docs/terminal-t2-frontend-design-2026-05-14.md.
  Wraps TerminalHeader + active view-renderer over a single terminal entity.
  v1 ships Raw view live; Chat + ANT renderers ship in FRONT-2 + FRONT-3 (placeholders here).
  View-mode persists in localStorage keyed by terminalId.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import InterruptConfirmModal from './InterruptConfirmModal.svelte';
  import KillConfirmModal from './KillConfirmModal.svelte';
  import TerminalSettingsModal from './TerminalSettingsModal.svelte';
  import Terminal from './Terminal.svelte';
  import TerminalAntView from './TerminalAntView.svelte';
  import TerminalChatView from './TerminalChatView.svelte';
  import TerminalHeader from './TerminalHeader.svelte';
  import TerminalHookActivity from './TerminalHookActivity.svelte';
  import TerminalFolderPicker from './TerminalFolderPicker.svelte';
  import FolderNavigator from './FolderNavigator.svelte';
  import QuickShortcutsBar from './QuickShortcutsBar.svelte';
  import type { QuickShortcut } from './QuickShortcutsBar.svelte';
  import { postInput as ptyPostInput } from '$lib/terminal/ptyInput';

  type ViewMode = 'chat' | 'ant' | 'raw';

  type Status = 'active' | 'idle' | 'killed';
  type AgentStateSnapshot = {
    sessionId: string;
    stateLabel?: string;
    cwd?: string;
    projectDir?: string;
    mtimeMs?: number;
  };
  type TerminalAccess = {
    tmuxSession: string;
    commands: {
      localTmux: string;
      sshTmux: string;
      iterm2: string;
      ghostty: string;
      terminalApp: string;
      warp: string;
    };
  };
  type Props = {
    terminalId: string;
    userName?: string;
    defaultView?: ViewMode;
    onRename?: (next: string) => void;
    onKilled?: () => void;
  };

  let { terminalId, userName = 'Untitled terminal', defaultView = 'raw', onRename, onKilled }: Props = $props();

  let killModalOpen = $state(false);
  let killError = $state('');
  let interruptModalOpen = $state(false);
  let interruptError = $state('');
  let settingsModalOpen = $state(false);
  let status = $state<Status>('active');
  // Per-terminal default disposition for the kill action (JWPK msg_t42mq5ma6u
  // 2026-05-19). 'prompt' = always show the modal; archive/delete/just-kill
  // = skip the modal and POST that mode directly. Lazily loaded from
  // terminals.meta.killDefault via /api/terminals/:id/settings on mount.
  type KillDefault = 'prompt' | 'archive' | 'delete' | 'just-kill';
  let killDefault = $state<KillDefault>('prompt');

  // Room agent handles for the settings modal's write-grant + only-respond
  // pickers. Loaded best-effort from the terminal's linked room when the
  // settings modal opens; falls back to empty array (modal degrades to
  // 'no candidates' state).
  let roomAgentHandles = $state<string[]>([]);

  async function loadRoomAgentHandles(): Promise<void> {
    if (!linkedChatRoomId) {
      roomAgentHandles = [];
      return;
    }
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(linkedChatRoomId)}`);
      if (!response.ok) {
        roomAgentHandles = [];
        return;
      }
      const body = (await response.json()) as {
        chatRoom?: { members?: Array<{ handle: string; kind?: string }> };
        room?: { members?: Array<{ handle: string; kind?: string }> };
      };
      const room = body.chatRoom ?? body.room ?? {};
      const members = room.members ?? [];
      roomAgentHandles = members
        .filter((m) => m.kind === 'agent')
        .map((m) => m.handle);
    } catch {
      roomAgentHandles = [];
    }
  }

  let linkedChatRoomId = $state<string | null>(null);
  let agentKind = $state<string | null>(null);
  let agentState = $state<AgentStateSnapshot | null>(null);
  let terminalAccess = $state<TerminalAccess | null>(null);
  let copiedAccessCommand = $state<string | null>(null);

  async function loadTerminalRecord(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { linkedChatRoomId?: string | null; agentKind?: string | null };
      linkedChatRoomId = body.linkedChatRoomId ?? null;
      agentKind = body.agentKind ?? null;
      await loadTerminalAccess();
      await loadAgentState();
    } catch { /* non-blocking */ }
  }

  async function loadTerminalAccess(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/access`);
      if (!res.ok) return;
      terminalAccess = (await res.json()) as TerminalAccess;
    } catch { /* non-blocking */ }
  }

  async function loadAgentState(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/agent-state`);
      if (!res.ok) return;
      const body = (await res.json()) as { snapshot?: AgentStateSnapshot | null };
      agentState = body.snapshot ?? null;
    } catch { /* non-blocking */ }
  }

  async function loadKillDefault(): Promise<void> {
    if (!browser) return;
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/settings`);
      if (!res.ok) return;
      const body = (await res.json()) as { killDefault?: KillDefault };
      const incoming = body.killDefault;
      if (incoming === 'archive' || incoming === 'delete' || incoming === 'just-kill' || incoming === 'prompt') {
        killDefault = incoming;
      }
    } catch { /* non-blocking — fall back to 'prompt' */ }
  }

  async function persistKillDefault(next: KillDefault): Promise<void> {
    try {
      await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'killDefault', value: next })
      });
      killDefault = next;
    } catch (cause) {
      console.error('[TerminalCard] persist killDefault failed', cause);
    }
  }

  async function performKill(mode: 'archive' | 'delete' | 'just-kill' = 'archive', rememberChoice = false): Promise<void> {
    killError = '';
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/kill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callerHandle: '@JWPK', mode })
      });
      if (res.status === 403) { killError = 'Not authorised to kill this terminal'; return; }
      if (!res.ok) { killError = `kill failed: ${res.status}`; return; }
      // Persist the remembered choice BEFORE we declare the terminal killed
      // and run onKilled — for 'just-kill' the row stays around so the
      // setting will be visible next time; for archive/delete the record
      // may be gone but the write is harmless (404 on a deleted row just
      // means the next spawn starts fresh from defaults).
      if (rememberChoice && mode !== 'delete') {
        // Skip persisting on delete: the terminal row is being dropped, so
        // there's nothing left to attach the preference to.
        void persistKillDefault(mode);
      }
      status = 'killed';
      killModalOpen = false;
      onKilled?.();
    } catch (cause) {
      killError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function handleKillClick(): void {
    if (killDefault === 'prompt') {
      killModalOpen = true;
      return;
    }
    // Operator has a saved disposition — skip the modal and fire directly.
    // rememberChoice=false because the preference is already saved; we
    // don't need to re-persist on every click.
    void performKill(killDefault, false);
  }

  async function performInterrupt(): Promise<void> {
    interruptError = '';
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/escape`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      });
      if (!res.ok) {
        interruptError = `interrupt failed: ${res.status}`;
        return;
      }
      interruptModalOpen = false;
    } catch (cause) {
      interruptError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function handleAgentKindChange(next: string): Promise<void> {
    const value = next.length > 0 ? next : null;
    agentKind = value;
    await fetch(`/api/terminals/${encodeURIComponent(terminalId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentKind: value })
    }).catch((cause) => {
      console.error('[TerminalCard] agentKind PATCH failed', cause);
    });
    await loadAgentState();
  }

  onMount(() => {
    void loadTerminalRecord();
    void loadKillDefault();

    // Live agent-state via SSE — pushes a frame as soon as the state
    // file changes (~250ms server-side poll cadence), so the status
    // pill stays in sync with what the CLI is actually doing instead
    // of waiting up to 15s for the next REST poll. EventSource auto-
    // reconnects on transient failures; the safety poll below catches
    // the case where the connection silently dies (proxy timeout, etc).
    let es: EventSource | null = null;
    if (browser) {
      try {
        es = new EventSource(`/api/terminals/${encodeURIComponent(terminalId)}/agent-state/stream`);
        es.onmessage = (ev) => {
          try {
            const body = JSON.parse(ev.data) as { snapshot?: AgentStateSnapshot | null };
            agentState = body.snapshot ?? null;
          } catch { /* malformed frame — ignore */ }
        };
      } catch { /* SSE unsupported — the safety poll below still keeps the pill alive */ }
    }
    // Safety net: REST poll at 30s catches dropped SSE connections.
    // Was 15s pre-SSE; now we lean on the stream for responsiveness
    // and only fall back when it goes quiet.
    const poll = setInterval(() => { void loadAgentState(); }, 30_000);
    return () => {
      clearInterval(poll);
      if (es) {
        es.onmessage = null;
        es.close();
      }
    };
  });

  const storageKey = $derived(`ant.terminal.view.${terminalId}`);

  /* eslint-disable svelte/no-reactive-reassign */
  /* svelte-ignore state_referenced_locally */
  let viewMode = $state<ViewMode>((() => {
    if (typeof localStorage === 'undefined') return defaultView;
    const stored = localStorage.getItem(`ant.terminal.view.${terminalId}`);
    return (stored === 'chat' || stored === 'ant' || stored === 'raw') ? stored : defaultView;
  })());

  /* svelte-ignore state_referenced_locally */
  let currentName = $state(userName);

  function switchView(next: ViewMode): void {
    viewMode = next;
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, next);
  }

  async function handleRerun(cmd: string): Promise<void> {
    await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: cmd + '\r' })
    }).catch((cause) => {
      console.error('[TerminalCard] rerun POST failed', cause);
    });
  }

  // Folder picker + FolderNavigator — hoisted from Terminal.svelte so they
  // surface on all three views (Chat / ANT / Raw), not just Raw. Cwd is a
  // single source of truth: seeded from agentState.cwd on terminal-record
  // load, then live-updated via onCwdDetected callbacks from the Raw view's
  // OSC-7 / OSC-1337 detector. Picker actions hit the same /api/terminals/
  // [id]/input endpoint regardless of which view the user is on.
  let currentCwd = $state<string | null>(null);
  let isFolderNavigatorOpen = $state(false);

  $effect(() => {
    const seed = agentState?.cwd ?? agentState?.projectDir;
    if (!currentCwd && seed) currentCwd = seed;
  });

  function handleCwdDetected(path: string): void {
    if (path && path !== currentCwd) currentCwd = path;
  }

  function shellQuote(p: string): string {
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }

  async function handleCd(path: string): Promise<void> {
    // Optimistic update — we just told the shell to go there, so the
    // breadcrumb and the + bookmark target should reflect intent right
    // away. OSC-7/1337 detection on the Raw view (or the next pwd
    // refresh) corrects this if the cd actually fails.
    currentCwd = path;
    // Two-call PTY protocol per banked feedback_pty_paste_buffer_first +
    // feedback_shell_quote_pty_inject. Shell-quote, then CR 5ms later.
    await ptyPostInput(terminalId, 'cd ' + shellQuote(path));
    setTimeout(() => { void ptyPostInput(terminalId, '\r'); }, 5);
  }

  async function handleCwdRefresh(): Promise<void> {
    // Explicit user-clicked one-shot pwd. The shell's pwd output drives
    // OSC-detection on the Raw view's stream which bubbles back up.
    await ptyPostInput(terminalId, 'pwd');
    setTimeout(() => { void ptyPostInput(terminalId, '\r'); }, 5);
  }

  function openFolderNavigator(): void { isFolderNavigatorOpen = true; }
  function closeFolderNavigator(): void { isFolderNavigatorOpen = false; }
  function handleFolderNavigatorSelect(path: string): void {
    isFolderNavigatorOpen = false;
    void handleCd(path);
  }

  async function handleShortcutSend(chip: QuickShortcut): Promise<void> {
    await ptyPostInput(terminalId, chip.text);
    if (chip.autoEnter) {
      // Same 5ms gap as the cd two-call protocol — gives the shell a tick
      // to receive the payload before the CR fires it.
      setTimeout(() => { void ptyPostInput(terminalId, '\r'); }, 5);
    }
  }

  async function copyAccessCommand(label: string, command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      copiedAccessCommand = label;
      setTimeout(() => {
        if (copiedAccessCommand === label) copiedAccessCommand = null;
      }, 1800);
    } catch {
      copiedAccessCommand = null;
    }
  }

  /** Launch a native terminal emulator already attached to this session
   *  via the server-side /launch endpoint. Replaces the older copy-to-
   *  clipboard flow for the iTerm2 / Ghostty buttons so a single click
   *  does what the button label says.
   *
   *  We still flip copiedAccessCommand to drive the same "launched X"
   *  flash state the copy buttons use — keeps the UX coherent. */
  async function launchEmulator(label: string, app: 'iterm' | 'ghostty'): Promise<void> {
    try {
      const res = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app })
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      copiedAccessCommand = label;
      setTimeout(() => {
        if (copiedAccessCommand === label) copiedAccessCommand = null;
      }, 1800);
    } catch (cause) {
      console.error('[TerminalCard] launch failed', cause);
      copiedAccessCommand = null;
    }
  }

  async function handleRename(nextName: string): Promise<void> {
    onRename?.(nextName);
    await fetch(`/api/terminals/${encodeURIComponent(terminalId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: nextName })
    }).catch((cause) => {
      console.error('[TerminalCard] rename PATCH failed', cause);
    });
  }
</script>

<section class="terminal-card" aria-label={`Terminal: ${currentName}`}>
  <TerminalHeader
    bind:userName={currentName}
    {viewMode}
    {agentKind}
    {status}
    agentStateLabel={agentState?.stateLabel ?? null}
    agentStateCwd={agentState?.cwd ?? agentState?.projectDir ?? null}
    agentStateSessionId={agentState?.sessionId ?? null}
    onRename={handleRename}
    onViewChange={switchView}
    onAgentKindChange={(k) => void handleAgentKindChange(k)}
    onInterrupt={() => { interruptModalOpen = true; }}
    onKill={handleKillClick}
    onOpenSettings={() => { void loadRoomAgentHandles(); settingsModalOpen = true; }}
  />

  <div class="card-body">
    <TerminalFolderPicker
      currentCwd={currentCwd}
      onChangeDir={(p) => void handleCd(p)}
      onRefresh={() => void handleCwdRefresh()}
      onBrowseFromRoot={openFolderNavigator}
    />
    <TerminalHookActivity sessionId={agentState?.sessionId} />
    {#if terminalAccess}
      {@const access = terminalAccess}
      <div class="terminal-access" aria-label="Terminal attach commands">
        <span class="terminal-access-label">Attach {access.tmuxSession}</span>
        <button type="button" onclick={() => void copyAccessCommand('Local', access.commands.localTmux)}>
          {copiedAccessCommand === 'Local' ? 'Copied local' : 'Copy local tmux'}
        </button>
        <button type="button" onclick={() => void copyAccessCommand('SSH', access.commands.sshTmux)}>
          {copiedAccessCommand === 'SSH' ? 'Copied SSH' : 'Copy SSH tmux'}
        </button>
        <button type="button" onclick={() => void launchEmulator('iTerm2', 'iterm')}>
          {copiedAccessCommand === 'iTerm2' ? 'Opened iTerm2' : 'iTerm2'}
        </button>
        <button type="button" onclick={() => void launchEmulator('Ghostty', 'ghostty')}>
          {copiedAccessCommand === 'Ghostty' ? 'Opened Ghostty' : 'Ghostty'}
        </button>
      </div>
    {/if}
    {#if viewMode === 'raw'}
      <Terminal
        {terminalId}
        initialCwd={agentState?.cwd ?? agentState?.projectDir ?? null}
        onCwdDetected={handleCwdDetected}
      />
    {:else if viewMode === 'chat'}
      <TerminalChatView {terminalId} {linkedChatRoomId} {agentKind} />
    {:else}
      <TerminalAntView {terminalId} onRerun={handleRerun} />
    {/if}
    <QuickShortcutsBar onSend={(chip) => void handleShortcutSend(chip)} />
  </div>
  {#if interruptError}<p class="interrupt-error" role="alert">{interruptError}</p>{/if}
  {#if killError}<p class="kill-error" role="alert">{killError}</p>{/if}
</section>

<FolderNavigator
  open={isFolderNavigatorOpen}
  startPath="/"
  onSelect={handleFolderNavigatorSelect}
  onCancel={closeFolderNavigator}
/>

<KillConfirmModal
  open={killModalOpen}
  targetKind="ant-terminal"
  targetLabel={currentName}
  allowRemember={true}
  onCancel={() => { killModalOpen = false; killError = ''; }}
  onConfirm={(mode, remember) => performKill(mode, remember)}
/>

<TerminalSettingsModal
  open={settingsModalOpen}
  {terminalId}
  terminalName={currentName}
  {roomAgentHandles}
  onClose={() => { settingsModalOpen = false; }}
/>

<InterruptConfirmModal
  open={interruptModalOpen}
  targetLabel={currentName}
  onCancel={() => { interruptModalOpen = false; interruptError = ''; }}
  onConfirm={performInterrupt}
/>

<style>
  .terminal-card {
    display: flex; flex-direction: column;
    border-radius: 0.6rem; overflow: hidden;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
  }
  .terminal-access {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--bg);
  }
  .terminal-access-label {
    color: var(--ink-soft);
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
    margin-right: 0.2rem;
  }
  .terminal-access button {
    min-height: 1.85rem;
    padding: 0 0.55rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.75rem;
    font-weight: 800;
    cursor: pointer;
  }
  .terminal-access button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .card-body {
    display: flex; flex-direction: column;
    border-top: none;
  }
  .interrupt-error,
  .kill-error {
    margin: 0; padding: 0.45rem 0.7rem;
    background: var(--bg); color: var(--accent, #c63b3b);
    font-weight: 700; font-size: 0.85rem;
    border-top: 1px solid var(--accent, #c63b3b);
  }
</style>
