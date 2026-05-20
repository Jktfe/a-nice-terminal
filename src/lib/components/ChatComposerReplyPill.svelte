<!--
  ChatComposerReplyPill — visible "Replying to <X>... [Cancel]" pill that
  appears above the composer when the room view has captured a reply target
  (M30 slice 3b). Extracted from ChatComposer pre-emptively to keep
  ChatComposer under its line cap (slice 3b approved split-first plan).

  PURE RENDER + ONE CALLBACK. No fetch, no invalidateAll, no state, no
  store/endpoint imports. Parent (ChatComposer) decides whether to mount
  it; room page owns the underlying replyingToMessageId state machine.

  Per @evolveantcodex slice 3b guardrails:
    - Pill body is role="status" so assistive tech announces it when set.
    - Cancel is a real <button type="button"> with the visible label
      "Cancel reply" (no aria-label needed; the text IS the label).
    - Pill uses id-prefix display only for slice 3b; full parent excerpt
      lookup is slice 3c scope (needs message map plumbing).
-->
<script lang="ts">
  type Props = {
    replyingToMessageId: string;
    onClearReplyingTo: () => void;
  };

  let { replyingToMessageId, onClearReplyingTo }: Props = $props();

  function shortenIdForLabel(messageId: string): string {
    if (messageId.length <= 12) return messageId;
    return `${messageId.slice(0, 12)}…`;
  }
</script>

<section class="reply-pill" role="status">
  <span class="reply-pill-text">
    Replying to <span class="reply-pill-id">{shortenIdForLabel(replyingToMessageId)}</span>
  </span>
  <button type="button" class="reply-pill-cancel" onclick={onClearReplyingTo}>
    Cancel reply
  </button>
</section>

<style>
  .reply-pill {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.7rem;
    margin-bottom: 0.4rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
    background: var(--surface);
    font-size: 0.82rem;
    color: var(--ink);
  }
  .reply-pill-text { flex: 1; color: var(--ink-soft); }
  .reply-pill-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--ink-strong);
    font-weight: 700;
  }
  .reply-pill-cancel {
    padding: 0.2rem 0.65rem;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }
  .reply-pill-cancel:hover { background: var(--surface); }
</style>
