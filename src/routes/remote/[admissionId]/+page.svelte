<!--
  B2-3 scope-A remote-bridge redeem landing /remote/[admissionId].
  Remote-operator surface: paste the one-time admission code, name this
  instance, pick direction → mint a bridge token. Session-less by design
  (the code IS the auth). The returned bridge_token is shown ONCE: copy
  affordance + save-now warning, never persisted/logged/stored/in-URL,
  no post-success redirect (that would destroy the secret before copy).
  No chrome shell (root layout is already bare).
-->
<script lang="ts">
  import { page } from '$app/stores';

  type Mapping = {
    id: string;
    room_id: string;
    remote_instance_label: string;
    direction: string;
    lifetime_preset: string;
    expires_at_ms: number | null;
  };

  const admissionId = $derived($page.params.admissionId ?? '');

  let code = $state('');
  let label = $state('');
  let direction = $state<'both' | 'in' | 'out'>('both');
  let busy = $state(false);
  let errorMsg = $state<string | null>(null);

  // Success state. bridgeToken lives ONLY here in component memory until
  // the page unloads — never written to a store / localStorage / console.
  let mapping = $state<Mapping | null>(null);
  let bridgeToken = $state<string | null>(null);
  let copied = $state(false);

  function expiresLabel(ms: number | null): string {
    if (ms === null) return 'no fixed expiry';
    return new Date(ms).toLocaleString();
  }

  async function redeem(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    errorMsg = null;
    busy = true;
    try {
      const res = await fetch(
        `/api/remote-ant/admissions/${encodeURIComponent(admissionId)}/redeem`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, remoteInstanceLabel: label, direction })
        }
      );
      if (!res.ok) {
        // 400 + 410 collapsed — never disclose which condition.
        errorMsg =
          "This admission can't be redeemed (wrong code, or it's expired, revoked, or already used). Check the code or ask for a fresh link.";
        return;
      }
      const body = (await res.json()) as { mapping: Mapping; bridge_token: string };
      mapping = body.mapping;
      bridgeToken = body.bridge_token;
    } catch {
      errorMsg = 'Something went wrong reaching the server. Please try again.';
    } finally {
      busy = false;
    }
  }

  async function copyToken(): Promise<void> {
    if (!bridgeToken) return;
    try {
      await navigator.clipboard.writeText(bridgeToken);
      copied = true;
      setTimeout(() => { copied = false; }, 2500);
    } catch {
      // Clipboard unavailable — the token is selectable in the field.
      copied = false;
    }
  }
</script>

<svelte:head><title>Redeem remote bridge · ANT</title></svelte:head>

<main id="main-content" class="wrap">
  <div class="card">
    {#if bridgeToken && mapping}
      <h1>Bridge connected</h1>
      <p class="warn" role="alert">
        This bridge token is shown <strong>once</strong>. Copy it into
        your remote ANT instance now — it cannot be retrieved again.
      </p>
      <label for="tok">Bridge token</label>
      <div class="token-row">
        <input id="tok" type="text" readonly value={bridgeToken} />
        <button type="button" class="copy" onclick={copyToken}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <dl class="summary">
        <div><dt>Room</dt><dd>{mapping.room_id}</dd></div>
        <div><dt>Instance</dt><dd>{mapping.remote_instance_label}</dd></div>
        <div><dt>Direction</dt><dd>{mapping.direction}</dd></div>
        <div><dt>Lifetime</dt><dd>{mapping.lifetime_preset}</dd></div>
        <div><dt>Expires</dt><dd>{expiresLabel(mapping.expires_at_ms)}</dd></div>
      </dl>
      <a class="done" href="/">I've saved the token — done</a>
    {:else}
      <h1>Redeem remote bridge</h1>
      <p class="muted">
        Enter the one-time admission code you were given, name this
        instance, and choose the bridge direction.
      </p>
      <form onsubmit={redeem}>
        <label for="code">Admission code</label>
        <input
          id="code"
          type="text"
          autocomplete="off"
          placeholder="ANT-XXX-YYYY"
          bind:value={code}
          required
          disabled={busy}
        />
        <label for="lbl">This instance's label</label>
        <input
          id="lbl"
          type="text"
          autocomplete="off"
          placeholder="e.g. alex-laptop"
          bind:value={label}
          required
          disabled={busy}
        />
        <label for="dir">Direction</label>
        <select id="dir" bind:value={direction} disabled={busy}>
          <option value="both">Both (send + receive)</option>
          <option value="in">In (receive only)</option>
          <option value="out">Out (send only)</option>
        </select>
        {#if errorMsg}
          <p class="err" role="alert">{errorMsg}</p>
        {/if}
        <button type="submit" disabled={busy || code === '' || label === ''}>
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </form>
    {/if}
  </div>
</main>

<style>
  .wrap {
    min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 1.5rem; background: var(--surface-app);
  }
  .card {
    width: 100%; max-width: 26rem; padding: 1.75rem;
    background: var(--surface-card); border: 1px solid var(--line-soft);
    border-radius: 0.9rem; box-shadow: var(--shadow-card);
  }
  h1 { margin: 0 0 0.5rem; font-size: 1.3rem; color: var(--ink-strong); }
  .muted {
    margin: 0 0 1.25rem; color: var(--ink-muted);
    font-size: 0.9rem; line-height: 1.45;
  }
  .warn {
    margin: 0 0 1rem; padding: 0.7rem 0.85rem; line-height: 1.45;
    border: 1px solid var(--warn); border-radius: 0.55rem;
    background: color-mix(in srgb, var(--warn) 16%, var(--surface-card));
    color: var(--ink-strong); font-size: 0.85rem;
  }
  form { display: flex; flex-direction: column; gap: 0.4rem; }
  label {
    font-size: 0.8rem; font-weight: 600;
    color: var(--ink-soft); margin-top: 0.5rem;
  }
  input, select {
    padding: 0.6rem 0.7rem; border: 1px solid var(--line-soft);
    border-radius: 0.5rem; background: var(--surface-raised);
    color: var(--ink-strong); font-size: 0.95rem;
  }
  input:focus-visible, select:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .token-row { display: flex; gap: 0.4rem; align-items: stretch; }
  .token-row input {
    flex: 1 1 auto; font-size: 0.85rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .copy {
    flex: 0 0 auto; padding: 0 0.9rem; font-weight: 600; cursor: pointer;
    border: 1px solid var(--accent); border-radius: 0.5rem;
    background: var(--accent); color: var(--surface-card);
  }
  .summary { margin: 1rem 0 1.25rem; display: grid; gap: 0.35rem; }
  .summary div { display: flex; justify-content: space-between; gap: 1rem; }
  .summary dt { color: var(--ink-muted); font-size: 0.85rem; }
  .summary dd {
    margin: 0; color: var(--ink-strong); font-size: 0.85rem;
    font-weight: 600; text-align: right; word-break: break-all;
  }
  .err {
    margin: 0.75rem 0 0; color: var(--accent-strong);
    font-size: 0.85rem; line-height: 1.4;
  }
  button[type='submit'], .done {
    margin-top: 1.1rem; padding: 0.65rem 1rem; border: 0;
    border-radius: 0.5rem; background: var(--accent);
    color: var(--surface-card); font-size: 0.95rem; font-weight: 600;
    cursor: pointer; text-align: center; text-decoration: none; display: block;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
