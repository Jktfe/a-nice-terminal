<!--
  LastMessagePreview — small inline renderer for a room card's
  "@author: body…" summary string. Parses the prefix and styles the
  author in the accent colour so the eye can scan "who spoke last"
  at a glance. #134.

  Extracted to a child component so the {@const} can attach to a
  $derived in the script (Svelte 5 won't let {@const} sit as an arbitrary
  template child outside of a logic block).
-->
<script lang="ts">
  import { parseLastMessagePreview } from './parseLastMessagePreview';

  type Props = { summary: string | null | undefined };
  let { summary }: Props = $props();

  const preview = $derived(parseLastMessagePreview(summary));
</script>

<p class="last-message">
  {#if preview.author}
    <span class="last-author">{preview.author}</span>
  {/if}
  <span class="last-body">{preview.body}</span>
</p>

<style>
  .last-message {
    margin: 0.4rem 0 0;
    color: var(--ink-soft);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .last-author {
    color: var(--accent);
    font-weight: 800;
    margin-right: 0.35rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85em;
  }
  .last-body { color: var(--ink-soft); }
</style>
