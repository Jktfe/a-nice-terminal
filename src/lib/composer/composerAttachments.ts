/**
 * Helpers for the composer's drag-and-drop / paste attachments flow
 * (task #62). One file → one POST to /api/chat-rooms/:roomId/attachments
 * → one markdown link the caller can splice into the body.
 *
 * Reads the file as base64 in the browser so this module has no Node-only
 * dependencies; the server-side store does the size cap + sanity checks.
 */

const MAX_FILE_BYTES = 4_500_000;

export type AttachmentUploadResult = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  markdownLink: string;
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = dataUrl.indexOf(',');
      resolve(commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

function escapeForMarkdown(text: string): string {
  return text.replace(/[\\\[\]()`<>]/g, '\\$&');
}

export function buildAttachmentMarkdownLink(input: {
  roomId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
}): string {
  const url = `/api/chat-rooms/${encodeURIComponent(input.roomId)}/attachments/${encodeURIComponent(input.attachmentId)}`;
  const safeFilename = escapeForMarkdown(input.filename);
  const isImage = input.mimeType.startsWith('image/');
  return isImage ? `![${safeFilename}](${url})` : `[📎 ${safeFilename}](${url})`;
}

export async function uploadAttachmentToRoom(input: {
  roomId: string;
  file: File;
  uploadedByHandle: string;
}): Promise<AttachmentUploadResult> {
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error(`File "${input.file.name}" is too big to attach (max ~4.5 MB).`);
  }

  const contentsBase64 = await readAsBase64(input.file);
  const response = await fetch(
    `/api/chat-rooms/${encodeURIComponent(input.roomId)}/attachments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        contentsBase64,
        uploadedByHandle: input.uploadedByHandle
      })
    }
  );

  if (!response.ok) {
    const failure = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(failure.message ?? `Upload failed (${response.status}).`);
  }

  const payload = (await response.json()) as { sharedFile?: { id: string; filename: string; mimeType: string } };
  const sharedFile = payload.sharedFile;
  if (!sharedFile) throw new Error('Upload succeeded but no sharedFile metadata was returned.');

  return {
    attachmentId: sharedFile.id,
    filename: sharedFile.filename,
    mimeType: sharedFile.mimeType,
    markdownLink: buildAttachmentMarkdownLink({
      roomId: input.roomId,
      attachmentId: sharedFile.id,
      filename: sharedFile.filename,
      mimeType: sharedFile.mimeType
    })
  };
}

export function extractFilesFromDropEvent(event: DragEvent): File[] {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return [];
  const fromItems: File[] = [];
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) fromItems.push(file);
      }
    }
  }
  if (fromItems.length > 0) return fromItems;
  return dataTransfer.files ? Array.from(dataTransfer.files) : [];
}

export function extractFilesFromPasteEvent(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const pastedFiles: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) pastedFiles.push(file);
    }
  }
  return pastedFiles;
}
