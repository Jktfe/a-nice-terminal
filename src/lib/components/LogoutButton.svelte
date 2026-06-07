<script lang="ts">
  import { onMount } from 'svelte';

  // Hide on the login page itself — nothing to log out of when you're not in.
  let visible = $state(false);

  onMount(() => {
    visible = !window.location.pathname.startsWith('/login');
  });
</script>

{#if visible}
  <a
    href="/api/auth/logout"
    class="logout-button"
    title="Sign out + return to login"
    data-sveltekit-reload
  >
    Sign out
  </a>
{/if}

<style>
  .logout-button {
    position: fixed;
    bottom: calc(12px + env(safe-area-inset-bottom));
    right: calc(12px + env(safe-area-inset-right));
    z-index: 50;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    color: rgb(248 250 252 / 0.75);
    background: rgb(15 23 42 / 0.85);
    border: 1px solid rgb(248 250 252 / 0.15);
    border-radius: 6px;
    text-decoration: none;
    backdrop-filter: blur(8px);
    transition: opacity 120ms, background 120ms;
    opacity: 0.6;
  }
  .logout-button:hover,
  .logout-button:focus-visible {
    opacity: 1;
    background: rgb(15 23 42 / 0.95);
    color: rgb(248 250 252);
    outline: 1px solid rgb(248 250 252 / 0.35);
  }

  @media (max-width: 768px) {
    .logout-button {
      position: static;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-width: 9rem;
      min-height: 44px;
      margin:
        0.75rem
        calc(0.75rem + env(safe-area-inset-right))
        calc(0.75rem + env(safe-area-inset-bottom))
        auto;
      padding: 0 14px;
      border-radius: 12px;
      color: rgb(248 250 252 / 0.92);
      background: rgb(15 23 42 / 0.9);
      opacity: 0.92;
    }
  }
</style>
