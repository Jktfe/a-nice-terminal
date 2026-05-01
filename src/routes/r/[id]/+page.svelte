<script lang="ts">
  // Read-only browser viewer for an ANT room.
  // Auth: same per-room invite/password as CLI/MCP, just rendered as a web
  // form. Token is stored in localStorage with a 24h TTL after which the
  // password gate fires again.
  //
  // Read-only is enforced server-side: tokens exchanged with kind='web'
  // get rejected on POST /messages and MCP post_message. We don't render
  // a compose box anyway — defence in depth.

  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';

  const TTL_MS = 24 * 60 * 60 * 1000;

  type Message = {
    id: string;
    content: string;
    sender_id: string | null;
    target: string | null;
    msg_type: string;
    created_at?: string;
    role?: string;
  };

  let roomId = $derived($page.params.id ?? '');
  let inviteId = $derived($page.url.searchParams.get('invite') || '');
  let storageKey = $derived(`ant_room_token_${roomId}`);

  let token = $state<string | null>(null);
  let handle = $state<string>('@viewer');
  let password = $state('');
  let label = $state('web');
  let busy = $state(false);
  let errorText = $state<string | null>(null);

  let messages = $state<Message[]>([]);
  let connected = $state(false);
  let closedReason = $state<string | null>(null);

  let eventSource: EventSource | null = null;
  let messagesEl: HTMLDivElement | null = $state(null);

  onMount(() => {
    if (!roomId || !inviteId) {
      errorText = 'Missing room id or invite. Ask the host for a fresh link.';
      return;
    }
    const cached = readCachedToken();
    if (cached) {
      token = cached;
      bootstrap();
    }
  });

  onDestroy(() => {
    eventSource?.close();
    eventSource = null;
  });

  function readCachedToken(): string | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.token !== 'string') return null;
      if (typeof parsed?.expires !== 'number') return null;
      if (Date.now() > parsed.expires) {
        localStorage.removeItem(storageKey);
        return null;
      }
      if (parsed?.inviteId && parsed.inviteId !== inviteId) {
        // Different invite for the same room — start fresh
        localStorage.removeItem(storageKey);
        return null;
      }
      return parsed.token;
    } catch {
      return null;
    }
  }

  function writeCachedToken(t: string) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ token: t, expires: Date.now() + TTL_MS, inviteId }),
      );
    } catch {}
  }

  function clearCachedToken() {
    try { localStorage.removeItem(storageKey); } catch {}
  }

  async function submitPassword(e: Event) {
    e.preventDefault();
    if (!password) return;
    busy = true;
    errorText = null;
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(roomId)}/invites/${encodeURIComponent(inviteId)}/exchange`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password,
            handle,
            kind: 'web',
            label,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorText = body?.message || body?.error || `Could not unlock (${res.status})`;
        return;
      }
      const data = await res.json();
      token = data.token;
      if (data.handle) handle = data.handle;
      writeCachedToken(data.token);
      password = '';
      await bootstrap();
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function bootstrap() {
    if (!token) return;
    closedReason = null;
    await loadBackfill();
    openStream();
  }

  async function loadBackfill() {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(roomId)}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        invalidateAndPromptAgain();
        return;
      }
      if (!res.ok) {
        errorText = `Could not load messages (${res.status})`;
        return;
      }
      const data = await res.json();
      const rows: Message[] = Array.isArray(data?.messages) ? data.messages : [];
      messages = rows;
      scrollToBottom();
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    }
  }

  function openStream() {
    if (!token) return;
    eventSource?.close();
    const url = `/mcp/room/${encodeURIComponent(roomId)}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSource = es;

    es.addEventListener('ready', () => {
      connected = true;
      errorText = null;
    });

    es.addEventListener('closed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data || '{}');
        closedReason = String(data?.reason || 'closed');
      } catch {
        closedReason = 'closed';
      }
      connected = false;
      es.close();
      eventSource = null;
      if (closedReason === 'revoked') invalidateAndPromptAgain();
    });

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'message_created') {
          // Avoid duplicating if backfill already had it
          if (!messages.some((m) => m.id === msg.id)) {
            messages = [...messages, normaliseEvent(msg)];
            scrollToBottom();
          }
        }
      } catch {
        // Non-JSON frames (heartbeats won't get here — they're comments)
      }
    };

    es.onerror = () => {
      connected = false;
      // Browser will auto-reconnect; if the token's gone bad, the next
      // connect lands on a 401 and the EventSource keeps retrying. We do
      // a one-shot validity check by re-running backfill.
      loadBackfill();
    };
  }

  function normaliseEvent(msg: Record<string, unknown>): Message {
    return {
      id: String(msg.id ?? ''),
      content: String(msg.content ?? ''),
      sender_id: (msg.sender_id as string) ?? null,
      target: (msg.target as string) ?? null,
      msg_type: String(msg.msg_type ?? 'message'),
      created_at: (msg.created_at as string) ?? new Date().toISOString(),
      role: (msg.role as string) ?? 'user',
    };
  }

  function invalidateAndPromptAgain() {
    clearCachedToken();
    token = null;
    eventSource?.close();
    eventSource = null;
    connected = false;
    errorText = closedReason === 'revoked'
      ? 'Your access was revoked. Ask the host for a fresh invite.'
      : 'Session expired. Enter the password again.';
  }

  function signOut() {
    closedReason = null;
    invalidateAndPromptAgain();
    errorText = 'Signed out.';
  }

  function scrollToBottom() {
    queueMicrotask(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function fmtTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function senderLabel(m: Message): string {
    if (m.sender_id) return m.sender_id;
    if (m.role === 'assistant') return 'assistant';
    return 'system';
  }
</script>

<svelte:head>
  <title>ANT room viewer</title>
</svelte:head>

<div class="wrap">
  <header class="bar">
    <div class="title">ANT room <span class="muted">{roomId}</span></div>
    <div class="status">
      {#if token && connected}
        <span class="dot live"></span> live as <strong>{handle}</strong>
        <button class="link" onclick={signOut}>sign out</button>
      {:else if token}
        <span class="dot connecting"></span> connecting…
      {:else}
        <span class="dot off"></span> locked
      {/if}
    </div>
  </header>

  {#if !token}
    <form class="gate" onsubmit={submitPassword}>
      <h1>Read-only room</h1>
      <p class="muted">
        Enter the invite password to read this room. Your access expires in 24
        hours; one revoke from the host kills it sooner. Read-only — no posting.
      </p>
      <label>
        Password
        <!-- svelte-ignore a11y_autofocus -- this is a single-purpose unlock gate; the only sensible action on landing is typing the password -->
        <input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          required
          autofocus
        />
      </label>
      <label>
        Handle (shown in audit log)
        <input
          type="text"
          bind:value={handle}
          placeholder="@viewer"
        />
      </label>
      <button type="submit" disabled={busy || !password}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      {#if errorText}<p class="err">{errorText}</p>{/if}
    </form>
  {:else}
    <div class="messages" bind:this={messagesEl}>
      {#each messages as m (m.id)}
        <article class="msg" class:agent-event={m.msg_type === 'agent_event'}>
          <header>
            <span class="sender">{senderLabel(m)}</span>
            {#if m.target}<span class="target">→ {m.target}</span>{/if}
            <span class="time">{fmtTime(m.created_at)}</span>
          </header>
          <pre>{m.content}</pre>
        </article>
      {:else}
        <p class="muted center">No messages yet.</p>
      {/each}
    </div>
    {#if errorText}<p class="err">{errorText}</p>{/if}
    {#if closedReason === 'revoked'}
      <p class="err">Connection closed by host.</p>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #d8d8d8;
    background: #0d0d10;
    min-height: 100vh;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 12px;
    border-bottom: 1px solid #2a2a30;
  }
  .title {
    font-weight: 600;
  }
  .muted {
    color: #7a7a82;
    font-weight: 400;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    display: inline-block;
  }
  .dot.live { background: #5dd29c; box-shadow: 0 0 6px #5dd29c80; }
  .dot.connecting { background: #f0c674; }
  .dot.off { background: #b85a5a; }
  .link {
    background: transparent;
    border: 0;
    color: #7aa2f7;
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
  }
  .gate {
    margin-top: 32px;
    display: grid;
    gap: 12px;
    background: #16161b;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #2a2a30;
  }
  .gate h1 { margin: 0; font-size: 18px; }
  .gate label { display: grid; gap: 4px; font-size: 12px; }
  .gate input {
    background: #0a0a0c;
    border: 1px solid #2a2a30;
    color: #d8d8d8;
    padding: 8px 10px;
    border-radius: 4px;
    font: inherit;
  }
  .gate input:focus { outline: 2px solid #7aa2f7; outline-offset: -1px; }
  .gate button {
    background: #2a3656;
    color: #d8d8d8;
    border: 1px solid #3b4a72;
    padding: 8px 14px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
  }
  .gate button:disabled { opacity: 0.5; cursor: default; }
  .messages {
    margin-top: 12px;
    overflow-y: auto;
    height: calc(100vh - 90px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 4px;
  }
  .msg {
    background: #16161b;
    border: 1px solid #2a2a30;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .msg.agent-event { border-color: #3b4a72; }
  .msg header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 11px;
    color: #9a9aa2;
    margin-bottom: 4px;
  }
  .sender { color: #7aa2f7; }
  .target { color: #f0c674; }
  .time { margin-left: auto; }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: #d8d8d8;
    font: inherit;
  }
  .center { text-align: center; }
  .err {
    color: #f78585;
    font-size: 12px;
    margin-top: 8px;
  }
</style>
