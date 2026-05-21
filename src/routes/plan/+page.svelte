<!--
  /plan — server-side redirects to /plans (see +page.server.ts).
  This component renders only as a no-JS / edge-case fallback; the
  server-side load throws a 307 redirect before this ever paints.
-->
<svelte:head><title>Redirecting… | ANT vNext</title></svelte:head>

<main id="main-content" class="wrap">
  <p>Redirecting to <a href="/plans">/plans</a>…</p>
</main>

<style>
  .wrap { padding: 2rem; font-family: system-ui, -apple-system, sans-serif; }
  a { color: var(--accent-strong, #d91f3f); }
</style>
