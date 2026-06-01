<script lang="ts">
  import AntLogo from './AntLogo.svelte';

  type Props = {
    darkModeIsOn: boolean;
    toggleTheme: () => void;
  };

  let { darkModeIsOn, toggleTheme }: Props = $props();
</script>

<header class="top-bar">
  <AntLogo />
  <nav aria-label="Primary">
    <a href="/">Dashboard</a>
    <a href="/rooms">Rooms</a>
    <a href="/terminals">Terminals</a>
    <a href="/settings">Settings</a>
  </nav>
  <button type="button" class="theme-toggle" onclick={toggleTheme}>
    {darkModeIsOn ? 'Light' : 'Dark'}
  </button>
</header>

<style>
  .top-bar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 1.1rem;
    background: rgb(255 255 255 / 78%);
    backdrop-filter: blur(18px);
  }

  :global(:root[data-theme='dark']) .top-bar {
    background: rgb(18 22 16 / 78%);
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    justify-content: center;
  }

  nav a,
  button {
    min-height: 2.45rem;
    padding: 0 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    color: var(--ink-strong);
    background: var(--surface-card);
    font-weight: 850;
    text-decoration: none;
  }

  .theme-toggle {
    border-color: var(--accent);
    color: white;
    background: var(--accent);
  }

  :global(:root[data-theme='dark']) .theme-toggle {
    color: #101607;
  }

  @media (max-width: 720px) {
    .top-bar {
      grid-template-columns: 1fr auto;
    }

    nav {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
  }
</style>
