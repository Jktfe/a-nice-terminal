<!--
  ChatComposer — text input + 3-state machine + send. Slash commands and
  mention detection are pure helpers; /break modal and MentionAutocomplete
  are sibling components. M30 + M12 + M03 slice 4 (WTHef h05).
-->
<script lang="ts">
  import ComposerBreakHandler from './ComposerBreakHandler.svelte';
  import MentionAutocomplete from './MentionAutocomplete.svelte';
  import MentionTagsStrip from './MentionTagsStrip.svelte';
  import TypingIndicator from './TypingIndicator.svelte';
  import ChatComposerReplyPill from './ChatComposerReplyPill.svelte';
  import ChatComposerAttachmentChips from './ChatComposerAttachmentChips.svelte';
  import ChatComposerEditingPill from './ChatComposerEditingPill.svelte';
  import ChatComposerAttachButton from './ChatComposerAttachButton.svelte';
  import ChatComposerUploadStatus from './ChatComposerUploadStatus.svelte';
  import ChatComposerSendButton from './ChatComposerSendButton.svelte';
  import ChatComposerErrorMessages from './ChatComposerErrorMessages.svelte';
  import { ensureBrowserSessionForRoom } from '$lib/browserSessionClient';
  import { looksLikeBreakCommand, reasonFromBreakCommand } from '$lib/composer/composerSlashCommands';
  import {
    detectMentionTrigger,
    rankMentionOptions,
    decideMentionKeyAction,
    spliceMentionPick,
    type MentionTrigger
  } from '$lib/composer/composerMentions';
  import {
    extractFilesFromDropEvent,
    extractFilesFromPasteEvent,
    uploadAttachmentToRoom
  } from '$lib/composer/composerAttachments';
  import { loadDraftForRoom, persistDraftForRoom } from '$lib/composer/composerDraftStore';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { ChatMessage } from '$lib/server/chatMessageStore';

  type ComposerState = 'emptyComposerWaitingForBody' | 'bodyBeingTyped' | 'submittingToServer';

  type Props = {
    roomId: string;
    asHandle?: string;
    membersInRoom?: RoomMember[];
    aliasesInRoom?: RoomAliasEntry[];
    onMessagePosted?: (message?: ChatMessage) => void;
    replyingToMessageId?: string;
    onClearReplyingTo?: () => void;
    // #76 — the caller's most recent editable message in this room, if
    // any. When set + the composer is empty, pressing ↑ enters edit
    // mode with this body pre-filled and the next submit will PATCH the
    // existing message instead of POSTing a new one.
    lastOwnEditableMessage?: ChatMessage;
  };

  let {
    roomId,
    asHandle = '@JWPK',
    membersInRoom = [],
    aliasesInRoom = [],
    onMessagePosted,
    replyingToMessageId,
    onClearReplyingTo,
    lastOwnEditableMessage
  }: Props = $props();

  // #76 edit-mode state. editingMessageId is set when ↑ loads a
  // previous message; submit then PATCHes that id instead of POSTing.
  let editingMessageId = $state<string | null>(null);

  // Composer drafts persist PER-ROOM via loadDraftForRoom /
  // persistDraftForRoom (see $lib/composer/composerDraftStore). Storage
  // key is scoped to roomId so room A's draft doesn't leak into room B.
  // Initial draft load reads localStorage for the room the composer
  // mounts into; the $effect below handles room hops by re-loading
  // when roomId changes so a refresh restores the draft immediately.
  // svelte-ignore state_referenced_locally
  let bodyBeingTyped = $state(loadDraftForRoom(roomId));
  // svelte-ignore state_referenced_locally
  let composerState = $state<ComposerState>(
    bodyBeingTyped.trim().length === 0 ? 'emptyComposerWaitingForBody' : 'bodyBeingTyped'
  );
  // Per-room hop: when the route's roomId prop changes, swap the
  // current bodyBeingTyped to that room's saved draft. Without this,
  // hopping rooms would carry room A's draft into room B's composer.
  $effect(() => {
    // Track only the roomId — re-running on every keystroke would
    // bulldoze the user's typing.
    const currentRoomId = roomId;
    const savedDraft = loadDraftForRoom(currentRoomId);
    if (savedDraft !== bodyBeingTyped) {
      bodyBeingTyped = savedDraft;
      composerState =
        savedDraft.trim().length === 0 ? 'emptyComposerWaitingForBody' : 'bodyBeingTyped';
    }
  });
  let lastErrorMessage = $state('');
  let pendingBreakReason = $state<string | null>(null);
  let mentionTrigger = $state<MentionTrigger | null>(null);
  let mentionActiveIndex = $state(0);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let compactComposer = $state(false);
  let isDropTargetHovered = $state(false);
  let uploadsInFlight = $state<string[]>([]);
  // Composer attachment chips: small previews of every attached file
  // (image thumbnail or paperclip icon), with × to drop the chip and
  // strip its markdown link from the body. Cleared on successful send.
  type AttachedChip = {
    attachmentId: string;
    filename: string;
    mimeType: string;
    markdownLink: string;
    previewObjectUrl: string | null;
  };
  let attachedChips = $state<AttachedChip[]>([]);

  function isImageMime(mime: string): boolean {
    return typeof mime === 'string' && mime.startsWith('image/');
  }

  function removeAttachedChip(attachmentId: string) {
    const target = attachedChips.find((chip) => chip.attachmentId === attachmentId);
    if (!target) return;
    if (target.previewObjectUrl) URL.revokeObjectURL(target.previewObjectUrl);
    attachedChips = attachedChips.filter((chip) => chip.attachmentId !== attachmentId);
    // Strip the matching markdown link from the body (best-effort:
    // walks once removing the exact substring; cursor position is not
    // restored — typing resumes wherever it was).
    const stripped = bodyBeingTyped
      .split(target.markdownLink)
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '');
    bodyBeingTyped = stripped;
    composerState = stripped.trim().length === 0 ? 'emptyComposerWaitingForBody' : 'bodyBeingTyped';
  }

  function clearAttachedChips() {
    for (const chip of attachedChips) {
      if (chip.previewObjectUrl) URL.revokeObjectURL(chip.previewObjectUrl);
    }
    attachedChips = [];
  }

  const mentionOptions = $derived(
    mentionTrigger
      ? rankMentionOptions(
          membersInRoom,
          aliasesInRoom,
          mentionTrigger.partialTyped
        )
      : []
  );

  $effect(() => {
    if (mentionActiveIndex >= mentionOptions.length) mentionActiveIndex = 0;
  });

  // Browser-session mint on room mount. Guard against transient empty
  // asHandle so we don't fire a 400 (which used to silently dump the
  // session-mint into the "no I tried, it failed" cache). Surfacing
  // failures into sessionMintError so the composer renders a visible
  // reason — banked from JWPK msg_qyqcuxgbun where "Server-resolved
  // identity required" surfaced with no breadcrumb back to the actual
  // mint failure.
  let sessionMintError = $state('');
  $effect(() => {
    const handle = asHandle?.trim() ?? '';
    if (!roomId || handle.length === 0) return;
    void ensureBrowserSessionForRoom({ roomId, authorHandle: handle }).then((result) => {
      if (!result.ok && result.reason !== 'no-handle') {
        sessionMintError = `Could not establish session for ${handle} in this room: ${result.reason}`;
      } else if (result.ok && sessionMintError.length > 0) {
        sessionMintError = '';
      }
    });
  });

  function refreshMentionTriggerFromTextarea() {
    if (!textareaRef) {
      mentionTrigger = null;
      return;
    }
    mentionTrigger = detectMentionTrigger(bodyBeingTyped, textareaRef.selectionStart);
  }

  function handleBodyInput(value: string) {
    bodyBeingTyped = value;
    lastErrorMessage = '';
    composerState = value.trim().length === 0 ? 'emptyComposerWaitingForBody' : 'bodyBeingTyped';
    // Persist on every keystroke (JWPK msg_ivazv32bya). Cheap synchronous
    // write — fine for the keystroke cadence at this size. Cleared in
    // the success-path of submitMessage below + on draft-empty.
    persistDraftForRoom(roomId, value);
    refreshMentionTriggerFromTextarea();
    autoResizeTextarea();
  }

  // Grow the textarea with content (up to the CSS max-height cap) so
  // long pastes / multi-line messages don't trap text behind scroll.
  // Reset height to auto first to let scrollHeight shrink back when
  // the user deletes lines.
  function autoResizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = `${textareaRef.scrollHeight}px`;
  }

  // queueMicrotask (not setTimeout) so focus lands on the SAME reactive
  // flush as the state writes that empty the body — avoids racing the
  // parent's onMessagePosted re-render and the message-list autoscroll.
  function refocusComposerOnNextTick(): void {
    queueMicrotask(() => {
      if (!textareaRef) return;
      if (document.activeElement !== textareaRef) textareaRef.focus();
      autoResizeTextarea();
    });
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 768px)');
    const apply = () => {
      compactComposer = media.matches;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  });

  function applyMentionPick(handleToInsert: string) {
    if (!mentionTrigger) return;
    const spliced = spliceMentionPick(bodyBeingTyped, mentionTrigger, handleToInsert);
    bodyBeingTyped = spliced.newBody;
    mentionTrigger = null;
    composerState = spliced.newBody.trim().length === 0 ? 'emptyComposerWaitingForBody' : 'bodyBeingTyped';
    // Svelte 5 one-way `value={bodyBeingTyped}` drops programmatic updates
    // when a focused textarea's event handler also called preventDefault.
    // Set the DOM value explicitly AND dispatch a synthetic input so
    // Svelte's bind path re-reads — without both, the pick looks like a
    // no-op even though state updated.
    if (textareaRef) {
      textareaRef.value = spliced.newBody;
      textareaRef.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    setTimeout(() => {
      textareaRef?.focus();
      textareaRef?.setSelectionRange(spliced.newCursorIndex, spliced.newCursorIndex);
    }, 0);
  }

  async function submitMessage() {
    const trimmedBody = bodyBeingTyped.trim();
    if (trimmedBody.length === 0) return;

    if (looksLikeBreakCommand(trimmedBody)) {
      pendingBreakReason = reasonFromBreakCommand(trimmedBody);
      return;
    }

    composerState = 'submittingToServer';
    lastErrorMessage = '';

    // #76 edit branch: PATCH the existing message body instead of
    // POSTing a new one. Break-command + reply pill are bypassed in
    // edit mode by construction (you can't reply to your own edit, and
    // a break is its own thing).
    if (editingMessageId) {
      try {
        const response = await fetch(
          `/api/chat-rooms/${roomId}/messages/${encodeURIComponent(editingMessageId)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: trimmedBody })
          }
        );
        if (!response.ok) {
          const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
          throw new Error(failurePayload.message ?? 'Could not edit the message.');
        }
        const payload = (await response.json().catch(() => ({}))) as { message?: ChatMessage };
        editingMessageId = null;
        bodyBeingTyped = '';
        persistDraftForRoom(roomId, '');
        composerState = 'emptyComposerWaitingForBody';
        clearAttachedChips();
        onMessagePosted?.(payload.message);
      } catch (causeOfFailure) {
        lastErrorMessage =
          causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not edit the message.';
        composerState = 'bodyBeingTyped';
      }
      return;
    }

    try {
      const browserSessionResult = await ensureBrowserSessionForRoom({
        roomId,
        authorHandle: asHandle,
        force: true
      });
      if (!browserSessionResult.ok) {
        // Carry the server's reason verbatim — banked from JWPK
        // msg_qyqcuxgbun: when mint fails the operator should see WHY
        // instead of a generic "could not establish identity" wall.
        throw new Error(
          browserSessionResult.reason === 'no-handle'
            ? 'No handle resolved yet for this room — refresh and try again.'
            : `Could not establish identity for ${asHandle} in this room: ${browserSessionResult.reason}`
        );
      }
      const messageBody = {
        body: trimmedBody,
        authorHandle: asHandle,
        ...(replyingToMessageId !== undefined && { parentMessageId: replyingToMessageId })
      };
      const response = await fetch(`/api/chat-rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(messageBody)
      });
      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not post the message.');
      }
      const payload = (await response.json().catch(() => ({}))) as { message?: ChatMessage };
      bodyBeingTyped = '';
      persistDraftForRoom(roomId, '');
      composerState = 'emptyComposerWaitingForBody';
      clearAttachedChips();
      refocusComposerOnNextTick();
      onMessagePosted?.(payload.message);
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not post the message.';
      composerState = 'bodyBeingTyped';
    }
  }

  async function ingestDroppedOrPastedFiles(files: File[]) {
    if (files.length === 0) return;
    for (const incomingFile of files) {
      uploadsInFlight = [...uploadsInFlight, incomingFile.name];
      try {
        const uploaded = await uploadAttachmentToRoom({
          roomId,
          file: incomingFile,
          uploadedByHandle: asHandle
        });
        const newBody =
          bodyBeingTyped.length === 0
            ? uploaded.markdownLink
            : `${bodyBeingTyped}\n${uploaded.markdownLink}`;
        handleBodyInput(newBody);
        // Attach a chip with a client-side preview URL for image
        // mimes — saves a roundtrip vs fetching the server copy.
        const previewObjectUrl = isImageMime(uploaded.mimeType)
          ? URL.createObjectURL(incomingFile)
          : null;
        attachedChips = [
          ...attachedChips,
          {
            attachmentId: uploaded.attachmentId,
            filename: uploaded.filename,
            mimeType: uploaded.mimeType,
            markdownLink: uploaded.markdownLink,
            previewObjectUrl
          }
        ];
      } catch (uploadFailure) {
        lastErrorMessage =
          uploadFailure instanceof Error
            ? uploadFailure.message
            : 'Could not attach a file.';
      } finally {
        uploadsInFlight = uploadsInFlight.filter((name) => name !== incomingFile.name);
      }
    }
  }

  function handleDragOver(event: DragEvent) {
    if (composerState === 'submittingToServer') return;
    event.preventDefault();
    isDropTargetHovered = true;
  }

  function handleDragLeave() {
    isDropTargetHovered = false;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDropTargetHovered = false;
    void ingestDroppedOrPastedFiles(extractFilesFromDropEvent(event));
  }

  function handlePaste(event: ClipboardEvent) {
    const files = extractFilesFromPasteEvent(event);
    if (files.length === 0) return;
    event.preventDefault();
    void ingestDroppedOrPastedFiles(files);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (mentionTrigger) {
      const result = decideMentionKeyAction(event.key, mentionOptions, mentionActiveIndex);
      if (result.action !== 'pass-through') {
        event.preventDefault();
        if (result.action === 'navigate-down') {
          mentionActiveIndex = (mentionActiveIndex + 1) % mentionOptions.length;
        } else if (result.action === 'navigate-up') {
          mentionActiveIndex = (mentionActiveIndex - 1 + mentionOptions.length) % mentionOptions.length;
        } else if (result.action === 'insert') {
          applyMentionPick(result.handleToInsert);
        } else if (result.action === 'dismiss') {
          mentionTrigger = null;
        }
        return;
      }
    }
    const pressingPlainEnter =
      event.key === 'Enter' && !event.shiftKey && !event.metaKey;
    if (pressingPlainEnter) {
      event.preventDefault();
      submitMessage();
      return;
    }
    // #76: ↑ in an empty composer loads the caller's last own
    // editable message for in-place edit. Standard pattern across
    // messengers (Slack / Discord / iMessage). Esc cancels.
    if (event.key === 'ArrowUp' && bodyBeingTyped.length === 0 && lastOwnEditableMessage && !editingMessageId) {
      event.preventDefault();
      startEditingMessage(lastOwnEditableMessage);
      return;
    }
    if (event.key === 'Escape' && editingMessageId) {
      event.preventDefault();
      cancelEditing();
    }
  }

  function startEditingMessage(target: ChatMessage) {
    editingMessageId = target.id;
    bodyBeingTyped = target.body;
    composerState = 'bodyBeingTyped';
    setTimeout(() => {
      textareaRef?.focus();
      const len = bodyBeingTyped.length;
      textareaRef?.setSelectionRange(len, len);
      autoResizeTextarea();
    }, 0);
  }

  function cancelEditing() {
    editingMessageId = null;
    bodyBeingTyped = '';
    persistDraftForRoom(roomId, '');
    composerState = 'emptyComposerWaitingForBody';
    setTimeout(autoResizeTextarea, 0);
  }

  function handleBreakPosted(message?: ChatMessage) {
    bodyBeingTyped = '';
    persistDraftForRoom(roomId, '');
    pendingBreakReason = null;
    composerState = 'emptyComposerWaitingForBody';
    onMessagePosted?.(message);
  }
</script>

<section class="chat-composer" aria-labelledby="composerHeading">
  <h2 id="composerHeading" class="visually-hidden">Send a message</h2>
  <TypingIndicator {roomId} {asHandle} isUserTyping={composerState === 'bodyBeingTyped'} />
  {#if replyingToMessageId !== undefined}
    <ChatComposerReplyPill
      {replyingToMessageId}
      onClearReplyingTo={onClearReplyingTo ?? (() => {})}
    />
  {/if}
  {#if editingMessageId}
    <ChatComposerEditingPill onCancel={cancelEditing} />
  {/if}
  <MentionTagsStrip body={bodyBeingTyped} onUpdate={(newBody) => handleBodyInput(newBody)} />
  <ChatComposerUploadStatus {uploadsInFlight} />
  <ChatComposerAttachmentChips chips={attachedChips} onRemove={removeAttachedChip} />
  <form
    onsubmit={(submitEvent) => { submitEvent.preventDefault(); submitMessage(); }}
    class:drop-hover={isDropTargetHovered}
    ondragenter={handleDragOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <textarea
      bind:this={textareaRef}
      class="message-body-field"
      placeholder={compactComposer ? 'Message the room…' : 'Say something to the room… (drop or paste files to attach)'}
      rows="2"
      value={bodyBeingTyped}
      oninput={(event) => handleBodyInput(event.currentTarget.value)}
      onkeyup={refreshMentionTriggerFromTextarea}
      onclick={refreshMentionTriggerFromTextarea}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      title="Enter to send · /break for context break · @ to mention · Shift-Enter for newline"
      disabled={composerState === 'submittingToServer'}
    ></textarea>

    <MentionAutocomplete
      options={mentionOptions}
      activeIndex={mentionActiveIndex}
      onPick={applyMentionPick}
      onHover={(newIndex) => (mentionActiveIndex = newIndex)}
    />

    <ChatComposerErrorMessages {sessionMintError} {lastErrorMessage} />

    <div class="composer-footer">
      <div class="composer-actions">
        <ChatComposerAttachButton
          disabled={composerState === 'submittingToServer'}
          onFilesSelected={(files) => void ingestDroppedOrPastedFiles(files)}
        />
        <span class="send-action-slot">
          <ChatComposerSendButton {composerState} {editingMessageId} {bodyBeingTyped} />
        </span>
      </div>
    </div>
  </form>
</section>

<ComposerBreakHandler
  {roomId}
  {asHandle}
  {pendingBreakReason}
  onBreakPosted={handleBreakPosted}
  onCancelled={() => (pendingBreakReason = null)}
  onError={(message) => { lastErrorMessage = message; pendingBreakReason = null; }}
/>

<style>
  .chat-composer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }
  form { position: relative; }
  form.drop-hover {
    outline: 2px dashed var(--accent);
    outline-offset: 4px;
    border-radius: 0.5rem;
  }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  form { display: flex; flex-direction: column; gap: 0.55rem; }
  /* Task #69: stronger affordance — the textarea is the clickable target,
     so a tinted fill + accent-tinged border make it obvious vs the
     surrounding composer chrome. Hover and focus add progressive emphasis. */
  .message-body-field {
    width: 100%;
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
    font-family: inherit;
    border: 1.5px solid color-mix(in srgb, var(--accent) 22%, var(--surface-edge));
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--accent) 3%, var(--bg));
    color: var(--ink-strong);
    /* Auto-grow up to 12 lines (~18rem). After that the textarea
       scrolls internally so the composer stays bounded. The JS
       autoResizeTextarea() flow drives the actual height up to this
       cap; resize:none stops user-drag from racing it. */
    resize: none;
    max-height: 18rem;
    min-height: 3.4rem;
    overflow-y: auto;
    transition: border-color 0.12s, background-color 0.12s;
  }
  .message-body-field::placeholder { color: var(--ink-soft); opacity: 0.85; }
  .message-body-field:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--surface-edge));
    background: color-mix(in srgb, var(--accent) 5%, var(--bg));
  }
  .message-body-field:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    background: var(--bg);
  }
  .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  /* .hint moved to the textarea title attribute (#117) — tooltip-only. */
  .composer-actions { display: inline-flex; align-items: center; gap: 0.45rem; }
  .send-action-slot {
    display: inline-flex;
    margin-left: 0.45rem;
    padding-left: 0.65rem;
    border-left: 1px solid var(--line-soft);
  }

  @media (max-width: 768px) {
    .chat-composer {
      gap: 0.25rem;
      padding: 0.35rem 0.45rem;
      border-radius: 0.8rem 0.8rem 0 0;
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      box-shadow: 0 -8px 24px rgb(27 20 12 / 10%);
    }
    form {
      gap: 0.4rem;
    }
    .message-body-field {
      min-height: 2.25rem;
      max-height: 6.5rem;
      padding: 0.46rem 0.58rem;
      border-radius: 0.7rem;
      /* iOS Safari zooms focused inputs below 16px. Keep the field compact
         with padding/line-height rather than shrinking the text. */
      font-size: 16px;
      line-height: 1.18;
    }
    .message-body-field::placeholder {
      font-size: 16px;
    }
    .composer-footer {
      justify-content: flex-end;
    }
    .composer-actions {
      width: 100%;
      justify-content: space-between;
      gap: 0.25rem;
    }
    .send-action-slot {
      margin-left: 0;
      padding-left: 0;
      border-left: 0;
    }
  }
</style>
