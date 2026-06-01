<script lang="ts">
  type Props = {
    terminalModes: string[];
  };

  let { terminalModes }: Props = $props();
</script>

<section class="platform-panel" aria-label="Terminal access">
  <div class="platform-panel-heading">
    <p>Terminal</p>
    <strong>1 move</strong>
  </div>
  <div class="terminal-modes">
    {#each terminalModes as terminalMode}
      <button type="button">{terminalMode}</button>
    {/each}
  </div>
</section>

<style>
  .terminal-modes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  button {
    width: 100%;
    min-height: 2.45rem;
    justify-content: start;
    padding: 0 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    color: var(--ink-strong);
    background: var(--surface-card);
    font-weight: 850;
  }
</style>
