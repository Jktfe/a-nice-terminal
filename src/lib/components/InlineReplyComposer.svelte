<script lang="ts">
  import { ensureBrowserSessionForRoom } from '$lib/browserSessionClient';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import {
    buildInlineFullReplyBody,
    buildInlineTargetedReplies,
    splitMessageIntoInlineReplyBlocks
  } from '$lib/chat/inlineReply';
  import type { ChatMessage } from '$lib/server/chatMessageStore';
  import type { RoomMember } from '$lib/server/chatRoomStore';

  type DraftComment = {
    id: string;
    blockIndex: number;
    body: string;
  };

  type Props = {
    roomId: string;
    asHandle: string;
    targetMessage: ChatMessage;
    membersInRoom?: RoomMember[];
    onMessagePosted?: (message?: ChatMessage) => void;
    onCancel?: () => void;
  };

  let {
    roomId,
    asHandle,
    targetMessage,
    membersInRoom = [],
    onMessagePosted,
    onCancel
  }: Props = $props();

  const blocks = $derived(splitMessageIntoInlineReplyBlocks(targetMessage.body));
  const mentionedAgentNames = $derived(
    membersInRoom
      .filter((member) => member.kind === 'agent')
      .map((member) => member.handle)
      .join(' ')
  );

  let comments = $state<DraftComment[]>([]);
  let activeCommentId = $state<string | null>(null);
  let activeBlockIndex = $state<number | null>(null);
  let draftBody = $state('');
  let sendState = $state<'idle' | 'sending'>('idle');
  let lastErrorMessage = $state('');
  let lastTargetMessageId = $state<string | null>(null);

  const cleanComments = $derived(
    comments
      .map((comment) => ({ blockIndex: comment.blockIndex, body: comment.body.trim() }))
      .filter((comment) => comment.body.length > 0)
  );
  const targetedReplies = $derived(
    buildInlineTargetedReplies({
      sourceMessageId: targetMessage.id,
      sourceAuthorHandle: targetMessage.authorHandle,
      blocks,
      comments: cleanComments
    })
  );

  $effect(() => {
    if (targetMessage.id === lastTargetMessageId) return;
    lastTargetMessageId = targetMessage.id;
    comments = [];
    activeCommentId = null;
    activeBlockIndex = null;
    draftBody = '';
    lastErrorMessage = '';
  });

  function commentsForBlock(blockIndex: number): DraftComment[] {
    return comments.filter((comment) => comment.blockIndex === blockIndex);
  }

  function startComment(blockIndex: number): void {
    activeCommentId = null;
    activeBlockIndex = blockIndex;
    draftBody = '';
    lastErrorMessage = '';
  }

  function editComment(comment: DraftComment): void {
    activeCommentId = comment.id;
    activeBlockIndex = comment.blockIndex;
    draftBody = comment.body;
    lastErrorMessage = '';
  }

  function deleteComment(commentId: string): void {
    comments = comments.filter((comment) => comment.id !== commentId);
    if (activeCommentId === commentId) cancelDraft();
  }

  function saveDraft(): void {
    const body = draftBody.trim();
    if (body.length === 0 || activeBlockIndex === null) return;
    if (activeCommentId) {
      comments = comments.map((comment) =>
        comment.id === activeCommentId ? { ...comment, body } : comment
      );
    } else {
      comments = [
        ...comments,
        {
          id: `inline-${Date.now()}-${comments.length}`,
          blockIndex: activeBlockIndex,
          body
        }
      ];
    }
    cancelDraft();
  }

  function cancelDraft(): void {
    activeCommentId = null;
    activeBlockIndex = null;
    draftBody = '';
  }

  function handleBlockKeydown(event: KeyboardEvent, blockIndex: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    startComment(blockIndex);
  }

  async function postRoomMessage(body: string): Promise<ChatMessage | undefined> {
    const browserSessionResult = await ensureBrowserSessionForRoom({
      roomId,
      authorHandle: asHandle,
      force: true
    });
    if (!browserSessionResult.ok) {
      throw new Error(
        browserSessionResult.reason === 'no-handle'
          ? 'No handle resolved yet for this room - refresh and try again.'
          : `Could not establish identity for ${asHandle} in this room: ${browserSessionResult.reason}`
      );
    }

    const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body,
        authorHandle: asHandle,
        parentMessageId: targetMessage.id
      })
    });
    if (!response.ok) {
      const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(failurePayload.message ?? 'Could not post the inline reply.');
    }
    const payload = (await response.json().catch(() => ({}))) as { message?: ChatMessage };
    return payload.message;
  }

  async function sendFullReply(): Promise<void> {
    if (sendState === 'sending') return;
    if (cleanComments.length === 0) {
      lastErrorMessage = 'Add at least one inline response before sending.';
      return;
    }
    sendState = 'sending';
    lastErrorMessage = '';
    try {
      const fullBody = buildInlineFullReplyBody({
        sourceMessageId: targetMessage.id,
        sourceAuthorHandle: targetMessage.authorHandle,
        blocks,
        comments: cleanComments
      });
      const postedFullReply = await postRoomMessage(fullBody);
      onMessagePosted?.(postedFullReply);

      for (const targeted of targetedReplies) {
        const postedTargetedReply = await postRoomMessage(targeted.body);
        onMessagePosted?.(postedTargetedReply);
      }

      comments = [];
      cancelDraft();
      onCancel?.();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not send the inline reply.';
    } finally {
      sendState = 'idle';
    }
  }
</script>

<section class="inline-reply-panel" aria-labelledby="inlineReplyHeading">
  <header class="inline-reply-header">
    <div>
      <h2 id="inlineReplyHeading">Reply in line</h2>
      <p>Comment directly on {targetMessage.authorHandle}'s message.</p>
    </div>
    <button type="button" class="ghost-button" onclick={() => onCancel?.()}>Close</button>
  </header>

  <div class="inline-reply-source" aria-label="Source message blocks">
    {#each blocks as block (block.index)}
      <section class="source-block-wrap" aria-label={`Point ${block.index + 1}`}>
        <div
          class="source-block"
          role="button"
          tabindex="0"
          aria-label={`Add inline response to point ${block.index + 1}`}
          onclick={() => startComment(block.index)}
          onkeydown={(event) => handleBlockKeydown(event, block.index)}
        >
          <span class="point-marker">Point {block.index + 1}</span>
          <div class="source-markdown">{@html renderMarkdown(block.text)}</div>
        </div>

        {#each commentsForBlock(block.index) as comment (comment.id)}
          <div class="comment-bubble">
            <p>{comment.body}</p>
            <div class="comment-actions">
              <button type="button" onclick={() => editComment(comment)}>Edit</button>
              <button type="button" onclick={() => deleteComment(comment.id)}>Remove</button>
            </div>
          </div>
        {/each}

        {#if activeBlockIndex === block.index}
          <div class="comment-editor">
            <textarea
              rows="3"
              value={draftBody}
              placeholder={mentionedAgentNames.length > 0
                ? `Write here. Use ${mentionedAgentNames} to send just this point to an agent.`
                : 'Write your inline response here.'}
              oninput={(event) => (draftBody = event.currentTarget.value)}
            ></textarea>
            <div class="editor-actions">
              <button type="button" class="primary-small" onclick={saveDraft}>
                {activeCommentId ? 'Save comment' : 'Add response/comment'}
              </button>
              <button type="button" class="ghost-small" onclick={cancelDraft}>Cancel</button>
            </div>
          </div>
        {:else}
          <button type="button" class="add-inline-button" onclick={() => startComment(block.index)}>
            Add response/comment
          </button>
        {/if}
      </section>
    {/each}
  </div>

  {#if lastErrorMessage}
    <p class="inline-error" role="alert">{lastErrorMessage}</p>
  {/if}

  <footer class="inline-reply-footer">
    <span>{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
    {#if targetedReplies.length > 0}
      <span>{targetedReplies.length} targeted agent note{targetedReplies.length === 1 ? '' : 's'}</span>
    {/if}
    <button
      type="button"
      class="send-full-reply"
      disabled={sendState === 'sending' || comments.length === 0}
      onclick={() => void sendFullReply()}
    >
      {sendState === 'sending' ? 'Sending...' : 'SEND FULL REPLY'}
    </button>
  </footer>
</section>

<style>
  .inline-reply-panel {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin: 0.75rem 0;
    padding: 0.9rem;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--surface-edge));
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--accent) 4%, var(--surface));
    box-shadow: 0 10px 24px rgb(21 18 12 / 8%);
  }
  .inline-reply-header,
  .inline-reply-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .inline-reply-header h2 {
    margin: 0;
    color: var(--ink-strong);
    font-size: 1rem;
  }
  .inline-reply-header p {
    margin: 0.18rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .inline-reply-source {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .source-block-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .source-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    background: var(--surface-card);
    cursor: text;
  }
  .source-block:hover,
  .source-block:focus-visible {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .point-marker {
    width: fit-content;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 800;
  }
  .source-markdown {
    color: var(--ink-strong);
    line-height: 1.42;
  }
  .source-markdown :global(p:first-child) { margin-top: 0; }
  .source-markdown :global(p:last-child) { margin-bottom: 0; }
  .comment-bubble {
    align-self: flex-end;
    max-width: min(42rem, 92%);
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--ok, #2c8a4d) 34%, var(--surface-edge));
    border-radius: 0.75rem 0.75rem 0.2rem 0.75rem;
    background: color-mix(in srgb, var(--ok, #2c8a4d) 10%, var(--surface-card));
  }
  .comment-bubble p {
    margin: 0;
    white-space: pre-wrap;
  }
  .comment-actions,
  .editor-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.45rem;
  }
  .comment-actions button,
  .ghost-small,
  .primary-small,
  .ghost-button,
  .add-inline-button,
  .send-full-reply {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .comment-actions button,
  .ghost-small,
  .ghost-button,
  .add-inline-button {
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-soft);
  }
  .comment-actions button,
  .ghost-small {
    padding: 0.18rem 0.5rem;
  }
  .ghost-button,
  .add-inline-button {
    padding: 0.35rem 0.7rem;
  }
  .add-inline-button {
    align-self: flex-start;
  }
  .primary-small,
  .send-full-reply {
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
  }
  .primary-small {
    padding: 0.28rem 0.65rem;
  }
  .send-full-reply {
    min-height: 2.35rem;
    padding: 0.48rem 0.9rem;
  }
  .send-full-reply:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .comment-editor {
    padding: 0.65rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 40%, var(--surface-edge));
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--surface-card) 82%, transparent);
  }
  .comment-editor textarea {
    width: 100%;
    min-height: 5rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    resize: vertical;
  }
  .inline-error {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--warn);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--warn) 12%, var(--surface-card));
    color: var(--ink-strong);
    font-size: 0.82rem;
  }
  .inline-reply-footer {
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  @media (max-width: 768px) {
    .inline-reply-panel {
      margin: 0.45rem 0;
      padding: 0.6rem;
      border-radius: 0.7rem;
    }
    .source-block {
      padding: 0.52rem 0.58rem;
    }
    .comment-bubble {
      max-width: 100%;
    }
    .inline-reply-footer {
      align-items: stretch;
      flex-direction: column;
    }
    .send-full-reply {
      width: 100%;
    }
  }
</style>
