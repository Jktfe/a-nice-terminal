<!--
  m7.1 PWA offline fallback — served by the service worker when a
  navigation request fails (no network and the requested route is not
  in cache). Stays static + dependency-free so it always renders.
-->
<script>
  function retry() {
    if (typeof window !== 'undefined') window.location.reload();
  }
</script>

<svelte:head>
  <title>ANT — offline</title>
</svelte:head>

<main class="offline">
  <h1>You're offline</h1>
  <p>ANT couldn't reach its server. Check your network connection and try again.</p>
  <p class="hint">Already-loaded routes will continue to work from the cache.</p>
  <button type="button" onclick={retry}>Retry</button>
</main>

<style>
  .offline {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 2rem;
    font-family: system-ui, -apple-system, sans-serif;
    text-align: center;
    color: var(--ant-text-primary, #1f1f1f);
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }
  p {
    margin: 0.5rem 0;
    line-height: 1.5;
  }
  .hint {
    color: var(--ant-text-subtle, #6b6b6b);
    font-size: 0.875rem;
  }
  button {
    margin-top: 1.5rem;
    padding: 0.5rem 1.25rem;
    border-radius: 0.5rem;
    border: 1px solid var(--ant-border, #d4d4d4);
    background: var(--ant-surface, #fff);
    color: var(--ant-text-primary, #1f1f1f);
    cursor: pointer;
    font-size: 0.95rem;
  }
  button:hover {
    background: var(--ant-surface-hover, #f4f4f4);
  }
</style>
