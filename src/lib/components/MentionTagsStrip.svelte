<!--
  MentionTagsStrip — chip preview of @-mentions in the composer body.

  Task #52: shows direct-broadcast targets (bare @handle) and informational
  mentions (bracketed [@handle]) as chips above the composer. Each chip can
  be removed, or toggled between bare and bracketed so the author can opt a
  recipient out of direct broadcast before sending.

  Pure presentational; the parent owns the textarea body.
-->
<script lang="ts">
  import {
    detectMentionTags,
    convertBareToBracketed,
    convertBracketedToBare,
    removeMentionFromBody,
    type MentionTag
  } from '$lib/composer/composerMentionTags';

  type Props = {
    body: string;
    onUpdate: (newBody: string) => void;
  };

  let { body, onUpdate }: Props = $props();

  const tags = $derived(detectMentionTags(body));

  function handleToggleKind(tag: MentionTag) {
    const newBody =
      tag.kind === 'bare'
        ? convertBareToBracketed(body, tag)
        : convertBracketedToBare(body, tag);
    onUpdate(newBody);
  }

  function handleRemove(tag: MentionTag) {
    onUpdate(removeMentionFromBody(body, tag));
  }
</script>

{#if tags.length > 0}
  <div class="mention-tags-strip" aria-label="Mentions in this message">
    {#each tags as tag (`${tag.startIndexInBody}-${tag.handle}-${tag.kind}`)}
      <span class="mention-chip" class:bare={tag.kind === 'bare'} class:bracketed={tag.kind === 'bracketed'}>
        <span class="chip-handle">{tag.handle}</span>
        <span class="chip-kind">{tag.kind === 'bare' ? 'direct' : 'note'}</span>
        <button
          type="button"
          class="chip-toggle"
          title={tag.kind === 'bare' ? 'Convert to informational [@…] — skip direct broadcast' : 'Convert back to direct @… mention'}
          aria-label={tag.kind === 'bare' ? `Skip direct broadcast for ${tag.handle}` : `Restore direct broadcast for ${tag.handle}`}
          onclick={() => handleToggleKind(tag)}
        >
          {tag.kind === 'bare' ? '[ ]' : '@'}
        </button>
        <button
          type="button"
          class="chip-remove"
          title={`Remove ${tag.handle}`}
          aria-label={`Remove ${tag.handle}`}
          onclick={() => handleRemove(tag)}
        >×</button>
      </span>
    {/each}
  </div>
{/if}

<style>
  .mention-tags-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.35rem 0.1rem 0.1rem;
  }
  .mention-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.35rem 0.18rem 0.55rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1.2;
  }
  .mention-chip.bare {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .mention-chip.bracketed {
    background: transparent;
    color: var(--ink-soft);
    border: 1px dashed var(--surface-edge);
  }
  .chip-handle { font-weight: 800; }
  .chip-kind {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }
  .chip-toggle,
  .chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.3rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .chip-toggle:hover,
  .chip-remove:hover {
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .chip-toggle:focus-visible,
  .chip-remove:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
