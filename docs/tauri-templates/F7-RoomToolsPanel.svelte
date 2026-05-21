<!--
  F7-RoomToolsPanel.svelte — Windows Tauri lift-target for the 11-section
  Room Tools panel.

  wta-10-f7-panel-parity (windows-tauri-antchat-2026-05-19 plan). Lifts
  the shape verified by @antchatdev's room-tools-panel-shape-audit-
  2026-05-19.md against the v4 server (`http://127.0.0.1:6174` dev,
  Tailscale TLS funnel in prod). All 11 sections wired with the
  audit-doc gotchas baked in:

  G1. /attachments returns `{sharedFiles: []}` NOT `attachments`
  G2. /links splits incoming + outgoing — sum both
  G3. /interviews has `active: null | obj` + `recent: []`
  G4. /participants returns 404 today — defer to room.members fallback
  G5. /memory-recall requires `query` param (here: empty string = "all")

  Drop into the Tauri Svelte tree (Jktfe/antchat-windows once forked
  per wta-01). Self-contained: no project-internal imports beyond
  `$lib/stores/serverUrl` (the env-driven ANT_SERVER_URL accessor —
  use whatever shape the host project uses). Defaults to fetching
  every section on mount; revalidates on `roomId` change.

  Conventions:
    - All sections render a count badge; section opens to detail on
      click (detail rendering left to host project — the data shape is
      what this template guarantees).
    - Loading states are per-section (one slow endpoint doesn't block
      the others).
    - 404 / network error degrades gracefully — section shows "—"
      rather than crashing.
    - prefers-color-scheme dark mode + Direction C tokens (light is
      authored; dark fallback supplied).
-->
<script lang="ts">
  type Props = {
    roomId: string;
    /** ANT server base URL. Default localhost:6174 for dev. */
    serverUrl?: string;
    /** Optional Bearer token (Mac antchat pattern). When set, sent on
     *  every fetch. Tauri webview should read from tauri-plugin-store. */
    bearerToken?: string | null;
    /** Local fallback for participants when /participants 404s (G4). */
    fallbackRoomMembers?: Array<{ handle: string }> | null;
  };

  let { roomId, serverUrl = 'http://127.0.0.1:6174', bearerToken = null, fallbackRoomMembers = null }: Props = $props();

  type SectionState<T> = {
    loading: boolean;
    error: string | null;
    data: T | null;
  };

  // One per section. All start in loading=true on mount.
  let participants = $state<SectionState<{ count: number; source: 'endpoint' | 'fallback' | 'missing' }>>({ loading: true, error: null, data: null });
  let focusMode = $state<SectionState<{ focusedMembers: Array<{ handle: string }> }>>({ loading: true, error: null, data: null });
  let openAsks = $state<SectionState<{ asks: Array<{ id: string }> }>>({ loading: true, error: null, data: null });
  let plans = $state<SectionState<{ plans: Array<{ planId: string; completion: { title: string; pct: number; total: number; completed: number } }> }>>({ loading: true, error: null, data: null });
  let tasks = $state<SectionState<{ tasks: Array<{ id: string; subject: string; status: string }> }>>({ loading: true, error: null, data: null });
  let links = $state<SectionState<{ incoming: Array<unknown>; outgoing: Array<unknown> }>>({ loading: true, error: null, data: null });
  let interviews = $state<SectionState<{ active: unknown | null; recent: Array<unknown> }>>({ loading: true, error: null, data: null });
  let artefacts = $state<SectionState<{ artefacts: Array<{ id: string; title: string }> }>>({ loading: true, error: null, data: null });
  let screenshots = $state<SectionState<{ screenshots: Array<{ sha: string }> }>>({ loading: true, error: null, data: null });
  let memoryRecall = $state<SectionState<{ count: number }>>({ loading: true, error: null, data: null });
  let attachments = $state<SectionState<{ sharedFiles: Array<{ id: string; filename: string }> }>>({ loading: true, error: null, data: null });

  function authHeaders(): HeadersInit {
    return bearerToken ? { 'Authorization': `Bearer ${bearerToken}` } : {};
  }

  async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${serverUrl}${path}`, { headers: authHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  async function loadAll(): Promise<void> {
    // Participants — G4: /participants returns 404 today. Try first, fall
    // back to fallbackRoomMembers (the room.members already in chat-room
    // listing response on the host).
    participants = { loading: true, error: null, data: null };
    try {
      const result = await fetchJson<{ members: Array<{ handle: string }> }>(`/api/chat-rooms/${encodeURIComponent(roomId)}/participants`);
      participants = { loading: false, error: null, data: { count: result.members?.length ?? 0, source: 'endpoint' } };
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('404')) {
        const fallbackCount = fallbackRoomMembers?.length ?? 0;
        participants = { loading: false, error: null, data: { count: fallbackCount, source: fallbackRoomMembers ? 'fallback' : 'missing' } };
      } else {
        participants = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
      }
    }

    // Focus mode
    focusMode = { loading: true, error: null, data: null };
    try {
      focusMode = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/focus-mode`) };
    } catch (cause) {
      focusMode = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Open asks — server-side filter: openOnly=1
    openAsks = { loading: true, error: null, data: null };
    try {
      openAsks = { loading: false, error: null, data: await fetchJson(`/api/asks?roomId=${encodeURIComponent(roomId)}&openOnly=1`) };
    } catch (cause) {
      openAsks = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Plans
    plans = { loading: true, error: null, data: null };
    try {
      plans = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/plans`) };
    } catch (cause) {
      plans = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Tasks
    tasks = { loading: true, error: null, data: null };
    try {
      tasks = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/tasks`) };
    } catch (cause) {
      tasks = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Linked rooms — G2: incoming + outgoing both, sum for count
    links = { loading: true, error: null, data: null };
    try {
      links = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/links`) };
    } catch (cause) {
      links = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Interviews — G3: active + recent
    interviews = { loading: true, error: null, data: null };
    try {
      interviews = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/interviews`) };
    } catch (cause) {
      interviews = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Artefacts
    artefacts = { loading: true, error: null, data: null };
    try {
      artefacts = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/artefacts`) };
    } catch (cause) {
      artefacts = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Screenshots
    screenshots = { loading: true, error: null, data: null };
    try {
      screenshots = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/screenshots`) };
    } catch (cause) {
      screenshots = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Room memory — G5: query param required. Empty string = treat as "all"
    // per UX decision in the audit doc (option A). Server may need patching
    // to accept empty-query-means-all; host project's UX may also let the
    // operator type a query and re-fetch.
    memoryRecall = { loading: true, error: null, data: null };
    try {
      const result = await fetchJson<{ results?: Array<unknown> }>(`/api/memory-recall?roomId=${encodeURIComponent(roomId)}&surfaces=all&query=`);
      memoryRecall = { loading: false, error: null, data: { count: result.results?.length ?? 0 } };
    } catch (cause) {
      memoryRecall = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }

    // Attachments — G1: returns sharedFiles, NOT attachments
    attachments = { loading: true, error: null, data: null };
    try {
      attachments = { loading: false, error: null, data: await fetchJson(`/api/chat-rooms/${encodeURIComponent(roomId)}/attachments`) };
    } catch (cause) {
      attachments = { loading: false, error: cause instanceof Error ? cause.message : 'failed', data: null };
    }
  }

  // Re-fetch when roomId changes (operator switches rooms)
  $effect(() => {
    if (roomId) void loadAll();
  });

  // Derived counts — one per section, handles loading/error states
  const participantsCount = $derived(participants.data ? String(participants.data.count) : participants.loading ? '…' : '—');
  const focusModeCount = $derived(focusMode.data ? String(focusMode.data.focusedMembers?.length ?? 0) : focusMode.loading ? '…' : '—');
  const openAsksCount = $derived(openAsks.data ? String(openAsks.data.asks?.length ?? 0) : openAsks.loading ? '…' : '—');
  const plansCount = $derived(plans.data ? String(plans.data.plans?.length ?? 0) : plans.loading ? '…' : '—');
  const tasksCount = $derived(tasks.data ? String(tasks.data.tasks?.length ?? 0) : tasks.loading ? '…' : '—');
  const linksCount = $derived(links.data ? String((links.data.incoming?.length ?? 0) + (links.data.outgoing?.length ?? 0)) : links.loading ? '…' : '—');
  const interviewsCount = $derived(interviews.data ? String((interviews.data.active ? 1 : 0) + (interviews.data.recent?.length ?? 0)) : interviews.loading ? '…' : '—');
  const artefactsCount = $derived(artefacts.data ? String(artefacts.data.artefacts?.length ?? 0) : artefacts.loading ? '…' : '—');
  const screenshotsCount = $derived(screenshots.data ? String(screenshots.data.screenshots?.length ?? 0) : screenshots.loading ? '…' : '—');
  const memoryCount = $derived(memoryRecall.data ? String(memoryRecall.data.count) : memoryRecall.loading ? '…' : '—');
  const attachmentsCount = $derived(attachments.data ? String(attachments.data.sharedFiles?.length ?? 0) : attachments.loading ? '…' : '—');

  // 11 sections in display order
  const SECTIONS = $derived([
    { label: 'Participants', count: participantsCount, error: participants.error, badge: participants.data?.source === 'fallback' ? 'fallback' : null },
    { label: 'Focus mode', count: focusModeCount, error: focusMode.error, badge: null },
    { label: 'Open asks', count: openAsksCount, error: openAsks.error, badge: null },
    { label: 'Plans', count: plansCount, error: plans.error, badge: null },
    { label: 'Tasks', count: tasksCount, error: tasks.error, badge: null },
    { label: 'Linked rooms', count: linksCount, error: links.error, badge: null },
    { label: 'Interviews', count: interviewsCount, error: interviews.error, badge: interviews.data?.active ? 'active' : null },
    { label: 'Artefacts', count: artefactsCount, error: artefacts.error, badge: null },
    { label: 'Screenshots', count: screenshotsCount, error: screenshots.error, badge: null },
    { label: 'Room memory', count: memoryCount, error: memoryRecall.error, badge: null },
    { label: 'Attachments', count: attachmentsCount, error: attachments.error, badge: null }
  ]);
</script>

<aside class="f7-panel" aria-label="Room Tools (11 sections)">
  <header class="panel-header">
    <h2>Room Tools</h2>
    <span class="room-id">{roomId}</span>
  </header>
  <ul class="section-list">
    {#each SECTIONS as section (section.label)}
      <li class="section-row" class:has-error={section.error !== null}>
        <span class="section-label">{section.label}</span>
        <span class="section-count">{section.count}</span>
        {#if section.badge}
          <span class="section-badge badge-{section.badge}">{section.badge}</span>
        {/if}
        {#if section.error}
          <span class="section-error" title={section.error}>!</span>
        {/if}
      </li>
    {/each}
  </ul>
</aside>

<style>
  /* Direction C light tokens with prefers-color-scheme dark fallback */
  .f7-panel {
    --surface: #fff;
    --surface-2: #f1f1ef;
    --ink-strong: #0f172a;
    --ink-soft: #475569;
    --line: #d6d6d6;
    --accent: #6b21a8;
    --ok: #15803d;
    --warn: #b45309;
    --danger: #b91c1c;

    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.85rem;
    padding: 1rem 1.1rem;
    width: 100%;
    max-width: 22rem;
    font-family: system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
    color: var(--ink-strong);
  }
  @media (prefers-color-scheme: dark) {
    .f7-panel {
      --surface: #1e293b;
      --surface-2: #0f172a;
      --ink-strong: #e2e8f0;
      --ink-soft: #94a3b8;
      --line: #334155;
      --accent: #c084fc;
    }
  }
  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 0.85rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--line);
  }
  .panel-header h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .room-id {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
  .section-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .section-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.7rem;
    border-radius: 0.45rem;
    gap: 0.55rem;
  }
  .section-row:hover {
    background: var(--surface-2);
  }
  .section-row.has-error {
    color: var(--danger);
  }
  .section-label {
    font-weight: 600;
    font-size: 0.9rem;
    flex: 1;
  }
  .section-count {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--accent);
    min-width: 2rem;
    text-align: right;
  }
  .section-badge {
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .badge-fallback {
    background: var(--surface-2);
    color: var(--warn);
  }
  .badge-active {
    background: color-mix(in srgb, var(--ok) 18%, var(--surface));
    color: var(--ok);
  }
  .section-error {
    color: var(--danger);
    font-weight: 800;
    cursor: help;
  }
</style>
