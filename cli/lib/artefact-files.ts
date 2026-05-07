// Shared file-operation helpers for deck/sheet artefact CLIs.
//
// Both `ant deck file get/put` and `ant sheet file get/put` (and their antchat
// equivalents) follow the same contract: the server returns raw bytes plus
// X-ANT-{Deck|Sheet}-Sha256 / X-ANT-{Deck|Sheet}-Mtime-Ms headers on GET, and
// requires x-ant-base-hash + x-ant-if-match-mtime headers on PUT to detect
// concurrent writes. This helper wraps both directions so the deck and sheet
// CLIs only differ in the URL prefix.
//
// The 409-conflict shape is identical between deck and sheet (both inherit
// from artefact-fs.ts). Callers handle the conflict by re-fetching and
// retrying — same protocol the web editor uses.

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { getRaw, putRaw, type RawGetResult, type RawConflictResult } from './api.js';

interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

export interface ArtefactKind {
  apiPrefix: '/api/decks' | '/api/sheets';
  shaHeader: string;   // 'x-ant-deck-sha256' or 'x-ant-sheet-sha256'
  mtimeHeader: string; // 'x-ant-deck-mtime-ms' or 'x-ant-sheet-mtime-ms'
  label: string;       // 'deck' or 'sheet' (for usage messages)
}

export const DECK_KIND: ArtefactKind = {
  apiPrefix: '/api/decks',
  shaHeader: 'x-ant-deck-sha256',
  mtimeHeader: 'x-ant-deck-mtime-ms',
  label: 'deck',
};

export const SHEET_KIND: ArtefactKind = {
  apiPrefix: '/api/sheets',
  shaHeader: 'x-ant-sheet-sha256',
  mtimeHeader: 'x-ant-sheet-mtime-ms',
  label: 'sheet',
};

interface ReadResult {
  text: string;
  sha256: string;
  mtimeMs: number;
}

function decodeFromHeaders(raw: RawGetResult, kind: ArtefactKind): { sha: string | null; mtimeMs: number | null } {
  const sha = raw.headers[kind.shaHeader] || null;
  const mtimeRaw = raw.headers[kind.mtimeHeader];
  const mtimeMs = mtimeRaw != null && mtimeRaw !== '' ? Number(mtimeRaw) : null;
  return { sha, mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null };
}

function isLikelyText(contentType: string | null, bytes: Uint8Array): boolean {
  if (contentType && /^text\/|\/(json|xml|csv|tsv|markdown)/.test(contentType)) return true;
  if (contentType && /^application\/octet-stream$/.test(contentType)) {
    // Fall back to a heuristic: if the first 512 bytes look like printable + common controls, assume text.
    const slice = bytes.subarray(0, Math.min(512, bytes.byteLength));
    let textish = 0;
    for (const b of slice) {
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) textish++;
    }
    return textish / Math.max(1, slice.byteLength) > 0.95;
  }
  return false;
}

export async function fileGet(
  ctx: Ctx,
  kind: ArtefactKind,
  slug: string,
  filePath: string,
  flags: any,
  roomToken?: string,
): Promise<void> {
  if (!slug) throw new Error(`Usage: ant ${kind.label} file get <slug> <path> [--out PATH] [--session <room-id>]`);
  if (!filePath) throw new Error(`Usage: ant ${kind.label} file get <slug> <path> [--out PATH] [--session <room-id>]`);

  const url = `${kind.apiPrefix}/${encodeURIComponent(slug)}/files/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const result = await getRaw(ctx, url, roomToken ? { roomToken } : undefined);
  const { sha, mtimeMs } = decodeFromHeaders(result, kind);

  // --out <path>: write bytes to disk. Useful for binary content (images, xlsx).
  if (typeof flags.out === 'string' && flags.out) {
    writeFileSync(flags.out, result.bytes);
    if (ctx.json) {
      console.log(JSON.stringify({ path: flags.out, sha256: sha, mtime_ms: mtimeMs, size: result.bytes.byteLength }, null, 2));
    } else {
      console.log(`✓ wrote ${result.bytes.byteLength} bytes to ${flags.out}`);
      console.log(`  sha256:    ${sha}`);
      console.log(`  mtime_ms:  ${mtimeMs}`);
    }
    return;
  }

  // --json: emit the whole envelope (content + sha + mtime). Best for agents.
  if (ctx.json) {
    const text = isLikelyText(result.contentType, result.bytes) ? new TextDecoder().decode(result.bytes) : null;
    console.log(JSON.stringify({
      path: filePath,
      content: text,
      content_base64: text === null ? Buffer.from(result.bytes).toString('base64') : undefined,
      sha256: sha,
      mtime_ms: mtimeMs,
      size: result.bytes.byteLength,
      content_type: result.contentType,
    }, null, 2));
    return;
  }

  // Default: print readable content to stdout, sha+mtime to stderr so callers
  // can pipe content through a tool while still capturing the guard values.
  if (isLikelyText(result.contentType, result.bytes)) {
    process.stdout.write(result.bytes);
  } else {
    console.error(`(binary content — ${result.bytes.byteLength} bytes; use --out PATH to save or --json to base64-encode)`);
  }
  console.error('---');
  console.error(`sha256:    ${sha}`);
  console.error(`mtime_ms:  ${mtimeMs}`);
}

export async function filePut(
  ctx: Ctx,
  kind: ArtefactKind,
  slug: string,
  filePath: string,
  flags: any,
  roomToken?: string,
): Promise<void> {
  if (!slug || !filePath) {
    throw new Error(
      `Usage: ant ${kind.label} file put <slug> <path> ` +
      `[--from-file LOCAL | --content "..."] ` +
      `[--base-hash X --if-match-mtime N] [--session <room-id>]`,
    );
  }

  let body: Uint8Array;
  if (typeof flags['from-file'] === 'string') {
    body = readFileSync(flags['from-file']);
  } else if (typeof flags.content === 'string') {
    body = new TextEncoder().encode(flags.content);
  } else {
    throw new Error('Provide --from-file LOCAL or --content "..." for the file body.');
  }

  const baseHash = typeof flags['base-hash'] === 'string' ? flags['base-hash'] : null;
  const mtimeRaw = flags['if-match-mtime'];
  const ifMatchMtime = mtimeRaw == null ? null : Number(mtimeRaw);
  if (mtimeRaw != null && !Number.isFinite(ifMatchMtime)) {
    throw new Error(`--if-match-mtime must be a number (ms since epoch); got: ${mtimeRaw}`);
  }

  const url = `${kind.apiPrefix}/${encodeURIComponent(slug)}/files/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const result = await putRaw(ctx, url, body, {
    baseHash,
    ifMatchMtime,
    roomToken,
  });

  if (!result.ok) {
    // 409 — concurrent-write conflict. Surface enough for the agent to retry.
    const conflict: RawConflictResult = result;
    if (ctx.json) {
      console.log(JSON.stringify({ ok: false, status: 409, conflict: conflict.details }, null, 2));
    } else {
      console.error(`✗ 409 conflict — another writer landed first.`);
      console.error(`  expected sha:   ${conflict.details?.expected_base_hash || '(none)'}`);
      console.error(`  actual sha:     ${conflict.details?.actual_hash || '(missing)'}`);
      console.error(`  expected mtime: ${conflict.details?.expected_mtime_ms ?? '(none)'}`);
      console.error(`  actual mtime:   ${conflict.details?.actual_mtime_ms ?? '(missing)'}`);
      console.error(`Re-fetch with 'ant ${kind.label} file get ${slug} ${filePath}', merge, and retry.`);
    }
    process.exitCode = 1;
    return;
  }

  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, ...result.body }, null, 2));
  } else {
    console.log(`✓ wrote ${result.body?.size ?? body.byteLength} bytes to ${filePath}`);
    if (result.body?.sha256) console.log(`  sha256:    ${result.body.sha256}`);
    if (result.body?.mtime_ms) console.log(`  mtime_ms:  ${result.body.mtime_ms}`);
  }
}

// Map common file extensions to a sensible Content-Type for raw uploads.
// The server doesn't strictly require the right value (it stores bytes
// verbatim) but it makes ETag/cache layers behave predictably.
export function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  const map: Record<string, string> = {
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.tsv': 'text/tab-separated-values; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.ts': 'application/typescript; charset=utf-8',
    '.svelte': 'text/plain; charset=utf-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}
