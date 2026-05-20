<!--
  AttachmentsTray — files shared in this chat room.
  Backs M11 upload-a-file UI slice 2 (list + download).

  Slice 2 is read-only — list the files the room already holds, and let
  the reader click through to download each one. Upload form lands in
  slice 3 (probably extracted into an UploadFileButton.svelte to keep
  ChatComposer untouched).

  SSR-first: this component renders entirely from props, so the room
  page can pass server-loaded attachments via $derived(data.x) and the
  first HTML response carries them.
-->
<script lang="ts">
  import type { SharedFile } from '$lib/server/chatAttachmentStore';

  // Metadata only — bytes are fetched via the dedicated download endpoint,
  // not echoed here. Matches what the GET /attachments endpoint returns.
  type SharedFileMetadata = Omit<SharedFile, 'contentsBase64'>;

  type Props = {
    roomId: string;
    sharedFiles: SharedFileMetadata[];
  };

  let { roomId, sharedFiles }: Props = $props();

  function describeByteSize(byteSize: number): string {
    if (byteSize < 1024) return `${byteSize} B`;
    if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  function describeUploadedAt(uploadedAt: string): string {
    const moment = new Date(uploadedAt);
    if (Number.isNaN(moment.getTime())) return uploadedAt;
    return moment.toLocaleString();
  }

  // Attachment preview thumbnails: detect image filetypes from the
  // filename extension and render a small inline preview alongside the
  // download link. Non-image files keep the existing list-row layout.
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
  function isImage(filename: string): boolean {
    const dot = filename.lastIndexOf('.');
    if (dot < 0) return false;
    return IMAGE_EXT.has(filename.slice(dot + 1).toLowerCase());
  }
</script>

{#if sharedFiles.length > 0}
  <section class="attachments-tray" aria-label="Shared files in this room">
    <header class="tray-header">
      <span class="header-eyebrow">Shared files</span>
      <span class="header-count">{sharedFiles.length}</span>
    </header>
    <ul class="file-list">
      {#each sharedFiles as sharedFile (sharedFile.id)}
        <li class="file-row" class:has-thumb={isImage(sharedFile.filename)}>
          {#if isImage(sharedFile.filename)}
            <a
              class="thumb-link"
              href={`/api/chat-rooms/${roomId}/attachments/${sharedFile.id}`}
              target="_blank"
              rel="noopener"
              aria-label={`Open ${sharedFile.filename} in a new tab`}
            >
              <img
                class="thumb"
                src={`/api/chat-rooms/${roomId}/attachments/${sharedFile.id}`}
                alt={sharedFile.filename}
                loading="lazy"
                decoding="async"
              />
            </a>
          {/if}
          <div class="file-text">
            <a
              class="file-link"
              href={`/api/chat-rooms/${roomId}/attachments/${sharedFile.id}`}
              download={sharedFile.filename}
            >
              {sharedFile.filename}
            </a>
            <span class="file-meta">
              {describeByteSize(sharedFile.byteSize)} ·
              {sharedFile.uploadedByHandle} ·
              <span class="uploaded-time">{describeUploadedAt(sharedFile.uploadedAt)}</span>
            </span>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .attachments-tray {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--surface);
  }

  .tray-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .header-eyebrow {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
  }

  .header-count {
    font-size: 0.8rem;
    color: var(--ink-soft);
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    padding: 0 0.5rem;
  }

  .file-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .file-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.95rem;
  }
  .file-row.has-thumb {
    align-items: center;
  }
  .file-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
  .thumb-link {
    display: inline-block;
    line-height: 0;
    border-radius: 0.45rem;
    overflow: hidden;
    border: 1px solid var(--surface-edge);
    background: var(--bg);
    flex-shrink: 0;
  }
  .thumb {
    width: 4rem;
    height: 4rem;
    object-fit: cover;
    display: block;
    transition: transform 0.18s ease;
  }
  .thumb-link:hover .thumb { transform: scale(1.05); }

  .file-link {
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
  }

  .file-link:hover {
    text-decoration: underline;
  }

  .file-meta {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .uploaded-time {
    font-variant-numeric: tabular-nums;
  }
</style>
