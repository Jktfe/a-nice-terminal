<!--
  ChatComposerErrorMessages — renders the two error rows the composer
  surfaces inside its form: the session-mint error (banked from JWPK
  msg_qyqcuxgbun — operator needs to see WHY mint failed, not a generic
  "could not establish identity" wall) and the last submit/upload error.

  PURE RENDER. Parent (ChatComposer) owns both error strings; this
  component only renders them when non-empty.

  Extracted from ChatComposer.svelte to keep the parent under the
  600-line cap (scripts/check-component-lines.mjs). Markup + CSS lifted
  verbatim to preserve DOM/class names; no behaviour change.
-->
<script lang="ts">
  type Props = {
    sessionMintError: string;
    lastErrorMessage: string;
  };

  let { sessionMintError, lastErrorMessage }: Props = $props();
</script>

{#if sessionMintError}
  <p class="error-message" role="alert">{sessionMintError}</p>
{/if}

{#if lastErrorMessage}
  <p class="error-message" role="alert">{lastErrorMessage}</p>
{/if}

<style>
  .error-message { margin: 0; color: var(--accent); font-size: 0.85rem; }
</style>
