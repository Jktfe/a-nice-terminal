<!--
  AliasCollisionHint — inline message for edge fe31 (alias collision)
  with a one-click chip to apply the next free suggestion.
  Extracted from ChangeHandleForm to keep both under the 260-line cap.
-->
<script lang="ts">
  type Props = {
    message: string;
    suggestion: string;
    onPickSuggestion: () => void;
  };

  let { message, suggestion, onPickSuggestion }: Props = $props();
</script>

<p class="collision-note" role="alert">
  {message}
  <button type="button" class="suggestion-chip" onclick={onPickSuggestion}>
    Try {suggestion}
  </button>
</p>

<style>
  .collision-note {
    margin: 0;
    padding: 0.5rem 0.7rem;
    background: rgba(255, 165, 0, 0.12);
    border-left: 3px solid var(--warn);
    border-radius: 0.4rem;
    color: var(--ink-strong);
    font-size: 0.88rem;
  }
  .suggestion-chip {
    margin-left: 0.3rem;
    padding: 0.25rem 0.55rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
    font-size: 0.78rem;
  }
</style>
