<!--
  InterviewModalComposer — bottom textarea + send button.
  Extracted 2026-05-21 to keep InterviewModal under the 600-line cap.
  Parent owns composer text + composerEl ref (used for Enter-to-send focus
  detection in the parent's keydown trap), so we expose both via $bindable.
-->
<script lang="ts">
  import NocturneIcon from './NocturneIcon.svelte';

  type Props = {
    composer?: string;
    composerEl?: HTMLTextAreaElement | null;
    busy: boolean;
    onSubmit: () => void | Promise<void>;
  };

  let {
    composer = $bindable(''),
    composerEl = $bindable(null),
    busy,
    onSubmit,
  }: Props = $props();
</script>

<form
  class="iv-composer"
  onsubmit={(e) => { e.preventDefault(); void onSubmit(); }}
>
  <textarea
    bind:this={composerEl}
    bind:value={composer}
    placeholder="Type a question or use Whisper Flow / system dictation. Enter to send, Shift+Enter for newline."
    rows="2"
    aria-label="Interview message"
    disabled={busy}
  ></textarea>
  <button
    type="submit"
    class="iv-send"
    disabled={busy || composer.trim().length === 0}
    aria-label="Send"
  >
    <NocturneIcon name="send" size={13} color="currentColor" />
    <span>send</span>
  </button>
</form>

<style>
  .iv-composer {
    display: flex;
    gap: 8px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--hairline, rgba(0, 0, 0, 0.08));
    background: var(--surface, #fff);
  }
  .iv-composer textarea {
    flex: 1;
    resize: vertical;
    min-height: 44px;
    max-height: 180px;
    border: 0.5px solid var(--hairline-strong, rgba(0, 0, 0, 0.16));
    background: var(--bg-soft, rgba(0, 0, 0, 0.02));
    color: inherit;
    border-radius: 6px;
    padding: 8px 10px;
    font: inherit;
    font-size: 13px;
  }
  .iv-composer textarea:focus {
    outline: 2px solid var(--accent-blue, #3b82f6);
    outline-offset: -1px;
  }
  .iv-send {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: var(--accent-blue, #3b82f6);
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    padding: 9px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  .iv-send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
