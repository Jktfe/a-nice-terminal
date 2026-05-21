<!--
  F8-BearerAuthFlow.svelte — Windows Tauri lift-target for the Bearer
  auth flow + tauri-plugin-store token persistence.

  wta-03-bearer-auth-wire (windows-tauri-antchat-2026-05-19 plan).
  Matches Mac antchat flow: POST /api/auth/login → receive token →
  persist via tauri-plugin-store → restore on subsequent launches.

  States (single-source state machine):
    idle       → no token, no in-flight request
    authing    → /api/auth/login request in flight
    authed     → token in memory + persisted to tauri-plugin-store
    server-down→ token present but /api/health unreachable (offline mode)
    rejected   → server returned 401 (bad creds / expired token)

  Stronghold deferred per Scaffold B note: tauri-plugin-store is the v1
  choice (simpler, well-known). Upgrade path to Stronghold is a swap of
  the StoreAdapter implementation below — keep the boundary tight.

  Drop into the Tauri Svelte tree (Jktfe/antchat-windows once forked
  per wta-01). Self-contained: only depends on @tauri-apps/plugin-store
  (peer dep, must be installed in host project).

  Audit gotchas (live-verified against v4 :6174):
    A1. POST /api/auth/demo-login returns {token, user} on success.
        Production /api/auth/login may have different response shape;
        adapt the `authResponse` interface below.
    A2. Token persistence MUST happen BEFORE updating UI state — a
        crash during persistence would leave UI showing "authed" with
        no recoverable token.
    A3. On cold launch, ALWAYS check token validity via /api/health
        before showing "authed" UI. A stale token from a wiped server
        (post-NUKE scenario) should fall through to login, not silently
        show empty rooms list.
    A4. Server-down on cold launch: keep token in memory + show offline
        banner. Do NOT delete the token — the server might just be
        restarting (see audit-server-down-fallback.sh 7/7 PASS).
    A5. Server returns 401 on a request with a token: treat as session
        expiry, wipe token from store + transition to "idle". Distinct
        from server-down (preserve token).
-->
<script lang="ts">
  import { Store } from '@tauri-apps/plugin-store';

  type Props = {
    /** ANT server base URL. Default localhost:6174 for dev.
     *  Production Tauri build should pass the Tailscale TLS funnel URL. */
    serverUrl?: string;
    /** Override the auth endpoint for self-hosted or custom routes.
     *  Default is /api/auth/login (production); /api/auth/demo-login is
     *  the dev shortcut. */
    authEndpoint?: string;
    /** Optional callback when auth state changes — host project hooks
     *  this to route to /rooms after authed, etc. */
    onAuthChange?: (state: AuthState, token: string | null) => void;
  };

  let {
    serverUrl = 'http://127.0.0.1:6174',
    authEndpoint = '/api/auth/login',
    onAuthChange = () => {},
  }: Props = $props();

  type AuthState = 'idle' | 'authing' | 'authed' | 'server-down' | 'rejected';

  let state: AuthState = $state('idle');
  let token: string | null = $state(null);
  let user: { handle: string; email: string } | null = $state(null);
  let errorMessage = $state('');
  let email = $state('');
  let password = $state('');

  // tauri-plugin-store wrapper — single boundary so Stronghold swap is
  // a one-file change later. Filename matches Mac antchat's convention.
  const STORE_FILE = '.ant-auth.json';
  const STORE_TOKEN_KEY = 'bearer';
  const STORE_USER_KEY = 'user';

  let store: Store | null = null;

  async function ensureStore(): Promise<Store> {
    if (!store) {
      store = await Store.load(STORE_FILE);
    }
    return store;
  }

  // A3: cold-launch token rehydrate. Runs on mount.
  $effect(() => {
    void rehydrateFromStore();
  });

  async function rehydrateFromStore(): Promise<void> {
    try {
      const s = await ensureStore();
      const persistedToken = (await s.get<string>(STORE_TOKEN_KEY)) ?? null;
      const persistedUser = (await s.get<typeof user>(STORE_USER_KEY)) ?? null;
      if (!persistedToken) {
        transitionTo('idle');
        return;
      }
      token = persistedToken;
      user = persistedUser;

      // A3: validate token before showing "authed" UI
      const isLive = await pingHealth(persistedToken);
      if (isLive === 'ok') {
        transitionTo('authed');
      } else if (isLive === 'server-down') {
        // A4: keep token; show offline mode
        transitionTo('server-down');
      } else {
        // A5: 401 → wipe + idle
        await wipeStore();
        transitionTo('idle');
      }
    } catch (err) {
      console.error('[BearerAuthFlow] rehydrate failed', err);
      transitionTo('idle');
    }
  }

  async function pingHealth(t: string): Promise<'ok' | 'server-down' | 'rejected'> {
    try {
      const res = await fetch(`${serverUrl}/api/health`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) return 'rejected';
      if (!res.ok) return 'server-down';
      return 'ok';
    } catch {
      return 'server-down';
    }
  }

  async function handleLogin(): Promise<void> {
    if (state === 'authing') return;
    if (email.trim().length === 0 || password.length === 0) {
      errorMessage = 'Email and password required.';
      return;
    }
    transitionTo('authing');
    errorMessage = '';
    try {
      const res = await fetch(`${serverUrl}${authEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const message = await safeReadMessage(res);
        errorMessage = message || `Login failed (HTTP ${res.status}).`;
        transitionTo('rejected');
        return;
      }
      const data: { token: string; user: { handle: string; email: string } } = await res.json();
      // A2: persist BEFORE flipping UI state
      const s = await ensureStore();
      await s.set(STORE_TOKEN_KEY, data.token);
      await s.set(STORE_USER_KEY, data.user);
      await s.save();
      token = data.token;
      user = data.user;
      password = '';
      transitionTo('authed');
    } catch (err) {
      console.error('[BearerAuthFlow] login failed', err);
      errorMessage = 'Could not reach server. Try again.';
      transitionTo('server-down');
    }
  }

  async function handleLogout(): Promise<void> {
    await wipeStore();
    token = null;
    user = null;
    transitionTo('idle');
  }

  async function wipeStore(): Promise<void> {
    try {
      const s = await ensureStore();
      await s.delete(STORE_TOKEN_KEY);
      await s.delete(STORE_USER_KEY);
      await s.save();
    } catch (err) {
      console.error('[BearerAuthFlow] wipeStore failed', err);
    }
  }

  function transitionTo(next: AuthState): void {
    state = next;
    onAuthChange(next, token);
  }

  async function safeReadMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string };
      return body.message ?? '';
    } catch {
      return '';
    }
  }
</script>

<section class="bearer-auth-flow" data-state={state}>
  <header>
    <h2>ANT — Sign in</h2>
    <p class="state-pill state-{state}">{state}</p>
  </header>

  {#if state === 'authed'}
    <div class="authed">
      <p>Signed in as <strong>{user?.handle ?? '@?'}</strong></p>
      <p class="muted">{user?.email ?? ''}</p>
      <button onclick={handleLogout}>Sign out</button>
    </div>
  {:else if state === 'server-down'}
    <div class="offline-banner">
      <p><strong>Offline mode.</strong> Server unreachable. Your session is preserved — actions will sync when the server returns.</p>
      <button onclick={rehydrateFromStore}>Retry</button>
    </div>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void handleLogin();
      }}
    >
      <label>
        Email
        <input
          type="email"
          bind:value={email}
          autocomplete="username"
          required
          disabled={state === 'authing'}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          required
          disabled={state === 'authing'}
        />
      </label>
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}
      <button type="submit" disabled={state === 'authing'}>
        {state === 'authing' ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  {/if}
</section>

<style>
  /* Direction C tokens (light) + prefers-color-scheme dark fallback */
  :where(.bearer-auth-flow) {
    --bg: #faf9f6;
    --fg: #1a1a1a;
    --muted: #6a6a6a;
    --border: #d8d4cc;
    --accent: #2d5a87;
    --error: #c0392b;
    --offline: #b8860b;
  }
  @media (prefers-color-scheme: dark) {
    :where(.bearer-auth-flow) {
      --bg: #1a1a1a;
      --fg: #faf9f6;
      --muted: #8a8a8a;
      --border: #2a2a2a;
      --accent: #5a8ec2;
      --error: #e74c3c;
      --offline: #d4a017;
    }
  }

  .bearer-auth-flow {
    max-width: 360px;
    margin: 4rem auto;
    padding: 2rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .state-pill {
    margin: 0;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .state-pill.state-authed { color: var(--accent); border-color: var(--accent); }
  .state-pill.state-server-down { color: var(--offline); border-color: var(--offline); }
  .state-pill.state-rejected { color: var(--error); border-color: var(--error); }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--muted);
  }
  input {
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  button {
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: white;
    background: var(--accent);
    border: 0;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: not-allowed; }

  .error { color: var(--error); margin: 0; font-size: 0.875rem; }
  .offline-banner {
    padding: 1rem;
    background: color-mix(in srgb, var(--offline) 10%, transparent);
    border: 1px solid var(--offline);
    border-radius: 0.25rem;
  }
  .offline-banner p { margin: 0 0 0.75rem; }
  .authed { text-align: center; }
  .authed strong { color: var(--accent); }
  .muted { color: var(--muted); font-size: 0.875rem; }
</style>
