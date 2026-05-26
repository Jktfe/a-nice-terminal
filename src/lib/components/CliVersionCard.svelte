<!--
  CliVersionCard — Settings "System" section, NMT feedback #E
  (@jstephenson via @james, 2026-05-26).

  Surfaces the latest published `ant` CLI release with copy-to-
  clipboard install + upgrade commands. The browser cannot see the
  operator's locally-installed CLI version, so the page does NOT
  attempt a current-vs-latest delta — instead it shows the latest +
  the upgrade command + an instruction to run `ant --version` in a
  terminal to confirm.

  Data path: GET /api/cli-version/latest (in-memory cache, 1-hour TTL,
  stale-fallback on upstream failure).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  type ReleasePayload = {
    version: string;
    tag: string;
    publishedAt: string;
    releaseNotesUrl: string;
    installCommand: string;
    upgradeCommand: string;
    fetchedAt: string;
  };

  // Hardcoded fallback shown when the endpoint is unreachable so
  // operators still see a usable install command even on offline /
  // upstream-failure days.
  const FALLBACK_INSTALL = 'brew install jktfe/antchat/ant';
  const FALLBACK_UPGRADE = 'brew upgrade jktfe/antchat/ant';

  let payload = $state<ReleasePayload | null>(null);
  let loadError = $state('');
  let loading = $state(true);
  let copiedKey = $state<'install' | 'upgrade' | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (!browser) return;
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/cli-version/latest');
      if (!res.ok) throw new Error(`status ${res.status}`);
      payload = (await res.json()) as ReleasePayload;
    } catch (cause) {
      loadError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function copy(text: string, key: 'install' | 'upgrade'): Promise<void> {
    if (!browser || typeof navigator?.clipboard?.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => { copiedKey = null; }, 1800);
    } catch {
      // Silent — copy failure is rare on modern browsers; user can
      // still hand-copy from the visible <code> block.
    }
  }

  function formatPublishedDate(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10); // YYYY-MM-DD
    } catch {
      return '';
    }
  }

  // Visible commands fall back to the hardcoded strings when the
  // endpoint is unreachable. Operators in offline / rate-limited
  // states still get a usable copy-the-command UX.
  const installCommand = $derived(payload?.installCommand ?? FALLBACK_INSTALL);
  const upgradeCommand = $derived(payload?.upgradeCommand ?? FALLBACK_UPGRADE);
  const versionLabel = $derived(payload?.version ?? '');
  const publishedLabel = $derived(formatPublishedDate(payload?.publishedAt ?? ''));
</script>

<div class="cli-version-card">
  <div class="header">
    <h3>ANT CLI</h3>
    {#if loading}
      <span class="status">checking latest…</span>
    {:else if payload}
      <span class="status">latest: <strong>{versionLabel}</strong>{publishedLabel ? ` · ${publishedLabel}` : ''}</span>
    {:else if loadError}
      <span class="status error" role="alert">offline — showing install command from defaults</span>
    {/if}
  </div>

  <p class="hint">
    Run <code>ant --version</code> in your terminal to check your installed version. If it is behind the latest, copy the upgrade command below.
  </p>

  <div class="command-grid">
    <div class="command-row">
      <span class="command-label">Install (new machine)</span>
      <div class="command-line">
        <code>{installCommand}</code>
        <button
          type="button"
          class="copy-btn"
          class:copied={copiedKey === 'install'}
          aria-label="Copy install command"
          onclick={() => void copy(installCommand, 'install')}
        >{copiedKey === 'install' ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
    <div class="command-row">
      <span class="command-label">Upgrade (already installed)</span>
      <div class="command-line">
        <code>{upgradeCommand}</code>
        <button
          type="button"
          class="copy-btn"
          class:copied={copiedKey === 'upgrade'}
          aria-label="Copy upgrade command"
          onclick={() => void copy(upgradeCommand, 'upgrade')}
        >{copiedKey === 'upgrade' ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  </div>

  {#if payload?.releaseNotesUrl}
    <p class="release-notes">
      <a href={payload.releaseNotesUrl} target="_blank" rel="noopener noreferrer">
        Release notes for {payload.tag} →
      </a>
    </p>
  {/if}
</div>

<style>
  .cli-version-card {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.8rem;
  }
  .header h3 { margin: 0; font-size: 1rem; }
  .status { color: var(--ink-soft, #777); font-size: 0.85rem; }
  .status.error { color: var(--warn, #c92020); }
  .status strong { color: var(--ink-strong); font-weight: 700; }
  .hint { margin: 0; font-size: 0.85rem; color: var(--ink-soft, #777); line-height: 1.5; }
  .hint code {
    padding: 0.05rem 0.35rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    border-radius: 0.25rem;
  }
  .command-grid {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .command-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .command-label {
    font-size: 0.74rem;
    color: var(--ink-soft, #777);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }
  .command-line {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .command-line code {
    flex: 1;
    padding: 0.5rem 0.7rem;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    background: var(--surface-raised);
    border: 1px solid var(--line-soft, #e0e0e0);
    border-radius: 0.4rem;
    color: var(--ink-strong);
    overflow-x: auto;
    white-space: nowrap;
  }
  .copy-btn {
    padding: 0.45rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 700;
    border: 1px solid var(--line-soft, #ccc);
    background: var(--surface-card);
    color: var(--ink-strong);
    border-radius: 0.4rem;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
    min-width: 4.5rem;
  }
  .copy-btn:hover {
    border-color: var(--accent, #4a6cf7);
    color: var(--accent, #4a6cf7);
  }
  .copy-btn.copied {
    background: var(--accent, #4a6cf7);
    border-color: var(--accent, #4a6cf7);
    color: white;
  }
  .release-notes { margin: 0; font-size: 0.83rem; }
  .release-notes a { color: var(--accent, #4a6cf7); text-decoration: none; }
  .release-notes a:hover { text-decoration: underline; }
</style>
