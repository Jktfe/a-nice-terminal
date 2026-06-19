<!--
  /login — browser login. The old launchd-env demo credential path has been
  removed; this form authenticates stored ANT users.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  type LoginFailure = {
    message?: string;
    code?: string;
    fallbackToStoredLogin?: boolean;
    requestId?: string;
  };

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let errorMessage = $state('');
  // Default to `true` so the form renders during SSR (and if onMount
  // never fires — JS disabled, hydration error, anything). The
  // checkAvailability fetch only DEMOTES this to false if the demo
  // endpoint actually says it's unavailable; the prior `null` default
  // produced a "Checking…" stuck state that masked broken sign-in for
  // anyone whose JS ran but hit a transient fetch error. JWPK
  // 2026-05-19 "redirects to sign in and doesn't ever allow through".
  let loginAvailable = $state<boolean>(true);

  // hooks.server.ts captures the originally-requested URL as ?next= so
  // we can hop the operator back there after sign-in instead of always
  // dumping them at /rooms. Validates the param starts with `/` so a
  // tampered redirect can't bounce to an external origin.
  const nextDestination = $derived.by(() => {
    const raw = page.url.searchParams.get('next');
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/rooms';
    return raw;
  });

  onMount(() => {
    void checkAvailability();
  });

  async function checkAvailability(): Promise<void> {
    try {
      const response = await fetch('/api/auth/demo-login');
      if (!response.ok) {
        loginAvailable = true;
        return;
      }
      const body = (await response.json()) as { available?: boolean };
      loginAvailable = body.available === true;
    } catch {
      loginAvailable = true;
    }
  }

  async function parseLoginFailure(response: Response): Promise<LoginFailure> {
    return (await response.json().catch(() => ({ message: response.statusText }))) as LoginFailure;
  }

  function canTryStoredLogin(response: Response, failure: LoginFailure): boolean {
    if (failure.fallbackToStoredLogin === false) return false;
    return response.status === 401 || response.status === 403 || response.status >= 500;
  }

  function shouldKeepAccountFailureAfterStoredFallback(
    accountResponse: Response,
    accountFailure: LoginFailure | null,
    storedResponse: Response
  ): boolean {
    if (!accountFailure) return false;
    if (accountFailure.fallbackToStoredLogin === false) return true;
    if (accountFailure.code && accountFailure.code !== 'invalid_credentials') return true;
    return accountResponse.status >= 500 && !storedResponse.ok;
  }

  function describeLoginFailure(response: Response, failure: LoginFailure): string {
    const requestSuffix = failure.requestId ? ` Reference: ${failure.requestId}.` : '';
    if (failure.fallbackToStoredLogin === false && failure.message) return `${failure.message}${requestSuffix}`;
    if (response.status === 401 || response.status === 403) {
      return `That email or password did not match. Try again.${requestSuffix}`;
    }
    if (response.status === 503) {
      return `${failure.message ?? 'Login is not configured on this server.'}${requestSuffix}`;
    }
    return `${failure.message ?? `Sign-in failed (${response.status}).`}${requestSuffix}`;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      // Try the real accounts.antonline.dev (Better Auth) login first; fall
      // back to the legacy stored-user login. This lets either your accounts
      // password OR your existing login work, so the swap can never lock you
      // out (verify-before-delete — demo/stored login stays until accounts is
      // proven). Both set the same browser-session cookie server-side.
      const body = JSON.stringify({ email, password });
      const headers = { 'content-type': 'application/json' };
      const accountResponse = await fetch('/api/auth/accounts-login', { method: 'POST', headers, body });
      let response = accountResponse;
      let failure: LoginFailure | null = null;
      if (!response.ok) {
        failure = await parseLoginFailure(response);
      }
      if (!response.ok && canTryStoredLogin(response, failure ?? {})) {
        const accountFailure = failure;
        const storedResponse = await fetch('/api/auth/demo-login', { method: 'POST', headers, body });
        const storedFailure = storedResponse.ok ? null : await parseLoginFailure(storedResponse);
        if (!storedResponse.ok && shouldKeepAccountFailureAfterStoredFallback(accountResponse, accountFailure, storedResponse)) {
          response = accountResponse;
          failure = accountFailure;
        } else {
          response = storedResponse;
          failure = storedFailure;
        }
      }
      if (!response.ok) {
        errorMessage = describeLoginFailure(response, failure ?? {});
        return;
      }
      // Cookie is set server-side via Set-Cookie. Hop back to wherever
      // the operator was originally trying to reach (or /rooms by default).
      await goto(nextDestination);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Sign-in failed.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in | ANT vNext</title></svelte:head>

<main class="login-shell">
  <section class="login-card" aria-labelledby="loginHeading">
    <h1 id="loginHeading">Sign in to ANT</h1>
    {#if loginAvailable === null}
      <p class="muted">Checking…</p>
    {:else if loginAvailable === false}
      <p class="muted">
        Login is not configured on this server.
      </p>
      <a class="muted-link" href="/rooms">Continue anonymously →</a>
    {:else}
      <p class="muted">Team access — credentials provided separately.</p>
      <form class="login-form" onsubmit={handleSubmit} aria-describedby={errorMessage ? 'loginError' : undefined}>
        <label>
          <span>Email</span>
          <input
            type="email"
            bind:value={email}
            required
            autocomplete="email"
            disabled={busy}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            bind:value={password}
            required
            autocomplete="current-password"
            disabled={busy}
          />
        </label>
        {#if errorMessage}
          <p id="loginError" class="error" role="alert">{errorMessage}</p>
        {/if}
        <button type="submit" class="primary" disabled={busy || email.length === 0 || password.length === 0}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    {/if}
  </section>
</main>

<style>
  .login-shell {
    min-height: 100svh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--bg);
  }
  .login-card {
    width: min(28rem, 100%);
    padding: 2rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }
  h1 {
    margin: 0 0 0.85rem;
    font-size: 1.4rem;
    color: var(--ink-strong);
  }
  .muted {
    margin: 0 0 1.1rem;
    color: var(--ink-soft);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .muted-link {
    color: var(--accent);
    font-weight: 700;
    text-decoration: none;
  }
  .muted-link:hover { text-decoration: underline; }
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .login-form label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
    color: var(--ink-soft);
  }
  .login-form input {
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    color: var(--ink-strong);
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--bg);
  }
  .login-form input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .error {
    margin: 0;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
    color: var(--ink-strong);
    font-size: 0.9rem;
  }
  .primary {
    margin-top: 0.4rem;
    padding: 0.65rem 1.2rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
  }
  .primary:hover:not(:disabled) { filter: brightness(1.05); }
  .primary:disabled { opacity: 0.55; cursor: not-allowed; }

  @media (max-width: 768px) {
    .login-shell {
      align-items: start;
      padding:
        calc(env(safe-area-inset-top) + clamp(1rem, 7svh, 3rem))
        1rem
        calc(env(safe-area-inset-bottom) + 1rem);
    }
    .login-card {
      padding: 1.15rem;
      border-radius: 0.85rem;
    }
    h1 {
      font-size: 1.2rem;
    }
    .muted {
      margin-bottom: 0.85rem;
      font-size: 0.88rem;
    }
    .login-form {
      gap: 0.7rem;
    }
    .login-form input,
    .primary {
      min-height: 44px;
    }
    .primary {
      width: 100%;
      border-radius: 0.75rem;
    }
  }
</style>
