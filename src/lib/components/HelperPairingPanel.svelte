<script lang="ts">
  // Operator-side pairing & lease management (JWPK 2026-06-12: "there was no
  // settings for what or who or how this would be managed… I can't see where I
  // chose those"). The CHOICE of scope happens HERE, at mint — the operator
  // picks the handle, the role (which fixes the scope, shown in plain words),
  // and the expiry, then mints a single-use code to hand over. Below, every live
  // lease is listed with a Revoke button. Operator-gated: these endpoints accept
  // the operator browser session, which this page already carries.
  import { onMount } from 'svelte';

  type Role = 'reader' | 'agent';
  type Lease = {
    id: string;
    handle: string;
    role: Role;
    owners: string[];
    pairedHost: string | null;
    expiresAtMs: number | null;
  };
  type Minted = { code: string; handle: string; role: Role; expiresAtMs: number | null };

  // Plain-language scope per role — mirrors the server's ATTACHMENT_SCOPES so
  // the operator SEES exactly what a role grants before minting. The server is
  // the enforcer; this is the honest preview.
  const ROLE_SCOPE: Record<Role, { label: string; can: string[]; cannot: string[] }> = {
    reader: {
      label: 'Read-only helper — listens and rings bells, never speaks',
      can: ['Subscribe to the delivery feed (metadata only)', 'Fire routes (file / bell / app nudge)'],
      cannot: ['Post or author messages', 'Post status', 'Claim or change handles', 'Approve asks']
    },
    agent: {
      label: 'Agent — a paneless handle that can post as itself',
      can: ['Subscribe to the delivery feed', 'Fire routes', 'Post status', 'Author messages as its handle'],
      cannot: ['Claim or change handles', 'Approve asks']
    }
  };

  const TTL_CHOICES = [
    { label: '15 minutes', ms: 15 * 60_000 },
    { label: '1 hour', ms: 60 * 60_000 },
    { label: '1 day', ms: 24 * 60 * 60_000 },
    { label: '30 days', ms: 30 * 24 * 60 * 60_000 }
  ];

  // Collapsed by default — it's a lot of real estate to keep open (JWPK).
  let expanded = $state(false);
  // Handle is chosen from existing ANThandles (JWPK: "a dropdown of the
  // ANThandles"), with a "new handle" escape for pairing a brand-new desktop AI.
  let availableHandles = $state<string[]>([]);
  let selectedHandle = $state('');
  let newHandle = $state('');
  const NEW = '__new__';
  const effectiveHandle = $derived(
    (selectedHandle === NEW ? newHandle : selectedHandle).trim()
  );
  let role = $state<Role>('reader');
  let ttlMs = $state(TTL_CHOICES[1].ms);
  let minting = $state(false);
  let mintError = $state<string | null>(null);
  let minted = $state<Minted | null>(null);

  let leases = $state<Lease[]>([]);
  let leasesError = $state<string | null>(null);
  let loadingLeases = $state(true);

  const canMint = $derived(effectiveHandle.replace(/^@+/, '').length > 0 && !minting);

  async function loadHandles() {
    try {
      const res = await fetch('/api/terminals/handles', { credentials: 'include' });
      if (res.ok) availableHandles = ((await res.json()).handles ?? []) as string[];
    } catch { /* dropdown just stays empty; the "new handle" option still works */ }
  }

  async function loadLeases() {
    loadingLeases = true;
    leasesError = null;
    try {
      const res = await fetch('/api/helper/leases', { credentials: 'include' });
      if (res.status === 401) { leasesError = 'Operator login required (open this from the ANT web app while signed in).'; leases = []; return; }
      if (!res.ok) { leasesError = `Couldn't load leases (${res.status}).`; return; }
      leases = ((await res.json()).leases ?? []) as Lease[];
    } catch (e) {
      leasesError = e instanceof Error ? e.message : String(e);
    } finally {
      loadingLeases = false;
    }
  }

  async function mint() {
    mintError = null;
    minted = null;
    minting = true;
    try {
      const res = await fetch('/api/helper/pairing', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: effectiveHandle, role, ttlMs })
      });
      if (res.status === 401) { mintError = 'Operator login required to mint.'; return; }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        mintError = `Mint failed (${res.status}). ${txt.slice(0, 160)}`;
        return;
      }
      const p = await res.json();
      minted = { code: p.code, handle: p.handle, role: p.role, expiresAtMs: p.expiresAtMs };
      selectedHandle = '';
      newHandle = '';
      void loadLeases();
      void loadHandles();
    } catch (e) {
      mintError = e instanceof Error ? e.message : String(e);
    } finally {
      minting = false;
    }
  }

  async function revoke(lease: Lease) {
    try {
      const res = await fetch(`/api/helper/leases/${encodeURIComponent(lease.id)}/revoke`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) await loadLeases();
      else leasesError = `Revoke failed (${res.status}).`;
    } catch (e) {
      leasesError = e instanceof Error ? e.message : String(e);
    }
  }

  function expiryText(ms: number | null): string {
    if (!ms) return 'no expiry';
    return `expires ${new Date(ms).toLocaleString()}`;
  }

  onMount(() => { void loadLeases(); void loadHandles(); });
</script>

<section class="anthandles">
  <button type="button" class="head toggle" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
    <span class="chev" class:open={expanded} aria-hidden="true">▸</span>
    <span class="head-text">
      <strong>Pair an app</strong>
      <span class="sub">Mint a single-use code, choose what it can do, hand it over privately.</span>
    </span>
    <span class="count">{leases.length} live</span>
  </button>

  {#if expanded}
  <div class="grid">
    <form class="mint" onsubmit={(e) => { e.preventDefault(); if (canMint) void mint(); }}>
      <label>
        <span>Handle to pair</span>
        <select bind:value={selectedHandle}>
          <option value="" disabled>Choose an ANThandle…</option>
          {#each availableHandles as h (h)}<option value={h}>{h}</option>{/each}
          <option value={NEW}>+ new handle…</option>
        </select>
      </label>
      {#if selectedHandle === NEW}
        <label>
          <span>New handle</span>
          <input type="text" placeholder="@desktop-claude" bind:value={newHandle} autocomplete="off" />
        </label>
      {/if}

      <fieldset class="roles">
        <legend>Role</legend>
        {#each (['reader', 'agent'] as Role[]) as r (r)}
          <label class="role-opt" class:active={role === r}>
            <input type="radio" name="role" value={r} bind:group={role} />
            <strong>{r === 'reader' ? 'Read-only helper' : 'Agent (can post)'}</strong>
          </label>
        {/each}
      </fieldset>

      <div class="scope-preview">
        <p class="scope-label">{ROLE_SCOPE[role].label}</p>
        <ul class="can">
          {#each ROLE_SCOPE[role].can as line (line)}<li>{line}</li>{/each}
        </ul>
        <ul class="cannot">
          {#each ROLE_SCOPE[role].cannot as line (line)}<li>{line}</li>{/each}
        </ul>
      </div>

      <label>
        <span>Valid for</span>
        <select bind:value={ttlMs}>
          {#each TTL_CHOICES as c (c.ms)}<option value={c.ms}>{c.label}</option>{/each}
        </select>
      </label>

      <button class="primary" type="submit" disabled={!canMint}>{minting ? 'Minting…' : 'Mint pairing code'}</button>
      {#if mintError}<p class="err">{mintError}</p>{/if}
    </form>

    <div class="result">
      {#if minted}
        <div class="code-card">
          <p class="code-label">Pairing code for <strong>{minted.handle}</strong> ({minted.role})</p>
          <code class="code">{minted.code}</code>
          <p class="note">
            Hand this over privately — never paste a pairing code into a room. Single-use,
            {expiryText(minted.expiresAtMs)}. The person enters it in the app's "Connect an app".
          </p>
        </div>
      {:else}
        <p class="placeholder">The code will appear here once minted.</p>
      {/if}
    </div>
  </div>

  <div class="leases">
    <h3>Live attachments</h3>
    {#if loadingLeases}
      <p class="muted">Loading…</p>
    {:else if leasesError}
      <p class="muted">{leasesError}</p>
    {:else if leases.length === 0}
      <p class="muted">No apps paired yet.</p>
    {:else}
      <ul>
        {#each leases as lease (lease.id)}
          <li>
            <span class="pill {lease.role === 'agent' ? 'agent' : 'reader'}">{lease.role}</span>
            <span class="lhandle">{lease.handle}</span>
            <span class="lmeta">{lease.pairedHost ?? 'unknown host'} · {expiryText(lease.expiresAtMs)} · owners: {lease.owners.join(', ') || '—'}</span>
            <button class="revoke" onclick={() => void revoke(lease)}>Revoke</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {/if}
</section>

<style>
  .anthandles {
    border: 1px solid var(--line-soft, #e6ddd4);
    border-radius: 1rem;
    background: var(--surface-card, #fff);
    padding: 1.1rem 1.2rem 1.3rem;
    margin: 1.2rem 0;
  }
  .head.toggle {
    display: flex; align-items: center; gap: 0.6rem; width: 100%;
    background: transparent; border: 0; padding: 0.1rem; cursor: pointer; text-align: left;
  }
  .head-text { display: grid; gap: 0.1rem; margin-right: auto; }
  .head-text strong { font-size: 1.05rem; color: var(--ink-strong, #2a211b); }
  .head .sub { font-size: 0.82rem; color: var(--ink-muted, #8a7f74); }
  .chev { transition: transform 0.15s; font-size: 0.9rem; color: var(--ink-muted, #8a7f74); }
  .chev.open { transform: rotate(90deg); }
  .count {
    font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: var(--ink-muted, #8a7f74);
    background: var(--surface-raised, #f0eae3); border-radius: 999px; padding: 0.2rem 0.6rem;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem; }
  .mint { display: grid; gap: 0.7rem; align-content: start; }
  .mint label { display: grid; gap: 0.25rem; font-size: 0.8rem; font-weight: 700; }
  .mint input, .mint select {
    padding: 0.5rem 0.6rem; border-radius: 0.5rem;
    border: 1px solid var(--line-soft, #e6ddd4); background: var(--surface-raised, #faf6f1); font-size: 0.9rem;
  }
  .roles { border: 0; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
  .roles legend { font-size: 0.8rem; font-weight: 700; padding: 0; margin-bottom: 0.1rem; }
  .role-opt {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem;
    border: 1px solid var(--line-soft, #e6ddd4); border-radius: 0.5rem; font-weight: 600; cursor: pointer;
  }
  .role-opt.active { border-color: var(--accent, #ff3d5a); background: rgb(255 61 90 / 6%); }
  .scope-preview {
    border: 1px dashed var(--line-soft, #e6ddd4); border-radius: 0.6rem; padding: 0.6rem 0.7rem; background: var(--surface-raised, #faf6f1);
  }
  .scope-label { margin: 0 0 0.4rem; font-size: 0.78rem; font-weight: 800; }
  .scope-preview ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; }
  .scope-preview li { font-size: 0.78rem; padding-left: 1.3rem; position: relative; line-height: 1.35; }
  .can li::before { content: '\2713'; position: absolute; left: 0; color: #2e9e5b; font-weight: 900; }
  .cannot li::before { content: '\2715'; position: absolute; left: 0; color: var(--accent, #ff3d5a); font-weight: 900; }
  .cannot li { color: var(--ink-soft, #6d635a); }
  .primary {
    padding: 0.55rem 1rem; border-radius: 999px; border: 1px solid var(--accent, #ff3d5a);
    background: var(--accent, #ff3d5a); color: #fff; font-weight: 800; font-size: 0.85rem; cursor: pointer;
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { color: var(--accent-strong, #d11f3c); font-size: 0.8rem; margin: 0; }
  .result { display: grid; align-content: center; }
  .placeholder { color: var(--ink-muted, #8a7f74); font-size: 0.85rem; text-align: center; }
  .code-card { border: 1px solid var(--warn, #ffb100); border-radius: 0.7rem; padding: 0.9rem; background: rgb(255 177 0 / 8%); }
  .code-label { margin: 0 0 0.5rem; font-size: 0.82rem; }
  .code { display: block; font-family: ui-monospace, monospace; font-size: 1.5rem; font-weight: 900; letter-spacing: 0.2em; user-select: all; }
  .note { margin: 0.5rem 0 0; font-size: 0.74rem; color: var(--ink-muted, #8a7f74); line-height: 1.45; }
  .leases { margin-top: 1.2rem; border-top: 1px solid var(--line-soft, #e6ddd4); padding-top: 0.9rem; }
  .leases h3 { margin: 0 0 0.5rem; font-size: 0.9rem; }
  .leases ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  .leases li { display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; }
  .pill { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; padding: 0.15rem 0.45rem; border-radius: 999px; }
  .pill.agent { background: rgb(255 61 90 / 12%); color: var(--accent-strong, #d11f3c); }
  .pill.reader { background: var(--surface-raised, #f0eae3); color: var(--ink-soft, #6d635a); }
  .lhandle { font-weight: 800; }
  .lmeta { color: var(--ink-muted, #8a7f74); margin-right: auto; }
  .revoke {
    border: 1px solid var(--line-soft, #e6ddd4); background: var(--surface-card, #fff); color: var(--accent-strong, #d11f3c);
    border-radius: 999px; padding: 0.3rem 0.8rem; font-weight: 700; font-size: 0.76rem; cursor: pointer;
  }
  .muted { color: var(--ink-muted, #8a7f74); font-size: 0.85rem; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
