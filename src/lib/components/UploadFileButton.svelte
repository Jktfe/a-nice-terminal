<!--
  UploadFileButton — pick a file from disk and share it in this room.
  Backs M11 upload-a-file slice 3 (UI write path).

  Companion to AttachmentsTray (M11 slice 2, list + download). Together
  they form the read+write surface for shared files. The tray re-renders
  via invalidateAll() after a successful upload, so the freshest file
  appears at the top of the list on the next paint.

  Self-contained: owns its own state, reads files with FileReader, strips
  the "data:<mime>;base64," prefix off the data URL, then POSTs base64 to
  the M11 backend endpoint with the current asHandle. Soft-fails on every
  error — never crashes the room page.

  Identity: asHandle defaults to "@you", same convention as ChatComposer
  and MessageReactionsBar, until the auth lane wires real handles. The
  M11 backend rejects non-members with 404, which this component shows
  as an inline error rather than a crash.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  type UploadState = 'idle' | 'readingFile' | 'uploading' | 'failedToUpload';

  type Props = {
    roomId: string;
    asHandle?: string;
  };

  let { roomId, asHandle = '@you' }: Props = $props();

  let uploadState = $state<UploadState>('idle');
  let lastErrorMessage = $state('');
  let fileInputElement = $state<HTMLInputElement | null>(null);

  function openFilePicker() {
    if (uploadState === 'readingFile' || uploadState === 'uploading') return;
    fileInputElement?.click();
  }

  async function onFilePicked(changeEvent: Event) {
    const inputTarget = changeEvent.currentTarget as HTMLInputElement;
    const pickedFile = inputTarget.files?.[0];
    if (!pickedFile) return;

    uploadState = 'readingFile';
    lastErrorMessage = '';
    try {
      const contentsBase64 = await readFileAsBase64(pickedFile);
      uploadState = 'uploading';
      const response = await fetch(`/api/chat-rooms/${roomId}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: pickedFile.name,
          mimeType: pickedFile.type || 'application/octet-stream',
          contentsBase64,
          uploadedByHandle: asHandle
        })
      });
      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not upload the file.');
      }
      uploadState = 'idle';
      inputTarget.value = '';
      await invalidateAll();
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not upload the file.';
      uploadState = 'failedToUpload';
      inputTarget.value = '';
    }
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') {
          reject(new Error('Could not read file bytes.'));
          return;
        }
        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) {
          reject(new Error('File is not a valid data URL.'));
          return;
        }
        resolve(dataUrl.slice(commaIndex + 1));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error.'));
      reader.readAsDataURL(file);
    });
  }

  function dismissError() {
    if (uploadState !== 'failedToUpload') return;
    uploadState = 'idle';
    lastErrorMessage = '';
  }
</script>

<div class="upload-row">
  <!--
    The file input is a side-channel that the visible button drives via
    `.click()` — it must not surface its own control to keyboard users or
    assistive tech (otherwise the a11y tree shows TWO upload buttons: the
    input's implicit "browse" + the visible button below). `hidden` removes
    it from rendering, from the tab order, AND from the accessibility tree.
    `.click()` still triggers the OS picker because the native API ignores
    visibility. visually-hidden / tabindex / aria-hidden are insufficient
    here: they keep the implicit button in the a11y tree on some AT.
  -->
  <input
    type="file"
    hidden
    bind:this={fileInputElement}
    onchange={onFilePicked}
    disabled={uploadState === 'readingFile' || uploadState === 'uploading'}
  />
  <button
    type="button"
    class="upload-button"
    onclick={openFilePicker}
    disabled={uploadState === 'readingFile' || uploadState === 'uploading'}
    aria-label="Share a file in this room"
  >
    {#if uploadState === 'readingFile'}Reading…{:else if uploadState === 'uploading'}Uploading…{:else}Share a file{/if}
  </button>
  {#if uploadState === 'failedToUpload'}
    <p class="upload-error" role="alert">
      {lastErrorMessage}
      <button type="button" class="dismiss-error" onclick={dismissError}>
        Dismiss
      </button>
    </p>
  {/if}
</div>

<style>
  .upload-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin: 0.4rem 0 1rem;
  }

  .upload-button {
    padding: 0.45rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }

  .upload-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .upload-error {
    flex-basis: 100%;
    margin: 0;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    color: var(--ink-strong);
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .dismiss-error {
    margin-left: auto;
    padding: 0.25rem 0.65rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    cursor: pointer;
    font-size: 0.85rem;
  }

</style>
