<!--
  MessageRowReply — the "↳ Reply to @parent: ..." indicator shown above
  a reply's body. Extracted from MessageRow.svelte 2026-05-21 to keep
  the parent under the 600-line component cap; behaviour preserved
  verbatim (rich indicator when parent is loaded, bare indicator when
  paged-out).
-->
<script lang="ts">
  import type { ChatMessage } from '$lib/server/chatMessageStore';

  type Props = {
    parentMessage?: ChatMessage;
  };

  let { parentMessage }: Props = $props();
</script>

<!-- JWPK msg_wcq5fwlhg7: when the parent is loaded, show WHO + a
     truncated preview ("Reply to @parent: 'first 60 chars…'") so
     reading agents + humans don't have to scroll back up to figure
     out what a reply is replying to. Falls back to the bare
     indicator when the parent is paged-out off-screen. Click
     jumps to the parent via anchor link. -->
{#if parentMessage}
  {@const previewBody = (parentMessage.body ?? '').replace(/\s+/g, ' ').trim()}
  {@const previewTruncated = previewBody.length > 60 ? previewBody.slice(0, 60).trimEnd() + '…' : previewBody}
  {@const parentDeleted = Boolean(parentMessage.deletedAtMs)}
  <a
    class="reply-indicator reply-indicator-rich"
    href={`#${parentMessage.id}`}
    title={parentDeleted ? 'Original message was deleted' : `Reply to ${parentMessage.authorHandle}`}
  >
    <span class="reply-arrow" aria-hidden="true">↳</span>
    <span class="reply-prefix">Reply to</span>
    <span class="reply-parent-author">{parentMessage.authorDisplayName ?? parentMessage.authorHandle}</span>
    {#if parentDeleted}
      <span class="reply-parent-body reply-parent-deleted">(deleted)</span>
    {:else if previewTruncated.length > 0}
      <span class="reply-parent-body">{previewTruncated}</span>
    {/if}
  </a>
{:else}
  <span class="reply-indicator" title="Replying to an older message not loaded yet">↳ Reply</span>
{/if}

<style>
  .reply-indicator {
    font-size: 0.72rem;
    color: var(--ink-soft);
    font-style: italic;
  }
  /* JWPK msg_wcq5fwlhg7: rich reply indicator carries author + truncated
     parent body so agents reading the chat see WHAT a reply is responding
     to without scrolling back up. Clickable anchor links to the parent
     row's id so a click scrolls into view. */
  .reply-indicator-rich {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    margin: 0.2rem 0 0.4rem;
    padding: 0.25rem 0.6rem;
    border-left: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    border-radius: 0 0.4rem 0.4rem 0;
    text-decoration: none;
    color: var(--ink-soft);
    font-style: normal;
    line-height: 1.4;
    max-width: 56ch;
  }
  .reply-indicator-rich:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-left-color: var(--accent);
  }
  .reply-arrow {
    color: var(--accent);
    font-weight: 700;
    flex-shrink: 0;
  }
  .reply-prefix {
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .reply-parent-author {
    color: var(--ink-strong);
    font-weight: 700;
    flex-shrink: 0;
  }
  .reply-parent-body {
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .reply-parent-deleted {
    font-style: italic;
    opacity: 0.7;
  }
</style>
