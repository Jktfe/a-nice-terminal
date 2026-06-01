<!--
  AliasAppliedBanner — confirmation banner shown after an alias is saved.
  Wireframe board WTHef state h04 (Claude lane, x=-6200 y=1800).

  Auto-dismisses after 4 seconds. Can also be dismissed manually with the
  close button. The effect cleanup clears the timeout if the banner
  unmounts before the 4s window finishes — important when the user
  triggers a second alias save before the first banner self-dismisses.
-->
<script lang="ts">
  type Props = {
    globalHandle: string;
    alias: string;
    onDismiss: () => void;
  };

  let { globalHandle, alias, onDismiss }: Props = $props();

  $effect(() => {
    const dismissTimeout = setTimeout(onDismiss, 4000);
    return () => clearTimeout(dismissTimeout);
  });
</script>

<div class="alias-applied-banner" role="status" aria-live="polite">
  <span class="check-icon" aria-hidden="true">✓</span>
  <p class="banner-text">
    Alias saved — <strong>{globalHandle}</strong> shown as <strong>{alias}</strong> in this room.
  </p>
  <button
    type="button"
    class="dismiss-button"
    onclick={onDismiss}
    aria-label="Dismiss banner"
  >×</button>
</div>

<style>
  .alias-applied-banner {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.6rem 0.85rem;
    background: var(--ink-strong);
    color: white;
    border: 1px solid var(--ok);
    border-radius: 0.6rem;
  }
  .check-icon {
    font-size: 1.1rem;
    color: var(--ok);
    font-weight: 900;
  }
  .banner-text {
    margin: 0;
    flex: 1 1 auto;
    font-size: 0.9rem;
  }
  .dismiss-button {
    background: transparent;
    color: white;
    border: none;
    font-size: 1.3rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.2rem;
  }
  .dismiss-button:hover {
    opacity: 0.8;
  }
</style>
