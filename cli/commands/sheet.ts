// ant sheet — host CLI parity with ant deck for D.10 sheet cowork.
//
//   ant sheet list                    List sheets visible to this caller
//   ant sheet status <slug>           Show manifest, source, and file snapshot hashes
//                                     (--session <room-id> to use a room token)
//   ant sheet manifest <slug>         Print the raw .ant-sheet.json manifest
//   ant sheet audit <slug>            Show sheet audit events (--limit 50)
//
// Sheets reuse the deck concurrency contract verbatim (whole-file base_hash
// + if_match_mtime guard) and mirror the deck route shape. This CLI mirrors
// cli/commands/deck.ts to keep operator muscle memory consistent.
//
// See docs/m2-2-publish-summary-evidence.md and the D.10 commit (84422df)
// for backend details.

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { fileGet, filePut, SHEET_KIND } from '../lib/artefact-files.js';

function roomOpts(flags: any): { roomToken?: string } | undefined {
  const roomId = flags.session || flags.room || flags.session_id;
  if (!roomId) return undefined;
  const token = config.getRoomToken(String(roomId));
  return token?.token ? { roomToken: token.token } : undefined;
}

function fileCount(manifest: any): number {
  return Array.isArray(manifest?.files) ? manifest.files.length : 0;
}

function printSheetRow(sheet: any, manifest?: any) {
  const rooms = Array.isArray(sheet.allowed_room_ids) ? sheet.allowed_room_ids.length : 0;
  const port = sheet.dev_port ? `:${sheet.dev_port}` : '';
  const files = manifest ? `${fileCount(manifest)} files` : 'no manifest';
  console.log(`${String(sheet.slug).padEnd(32)} ${String(sheet.title || '').padEnd(28)} rooms=${rooms} ${files}${port}`);
}

async function listSheets(flags: any, ctx: any) {
  const data = await api.get(ctx, '/api/sheets', roomOpts(flags));
  const sheets = data.sheets || [];
  if (ctx.json) {
    console.log(JSON.stringify(sheets, null, 2));
    return;
  }
  if (!sheets.length) {
    console.log('No sheets.');
    return;
  }
  for (const sheet of sheets) printSheetRow(sheet);
}

async function showSheet(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant sheet status <slug> [--session <room-id>]');
  const data = await api.get(ctx, `/api/sheets/${encodeURIComponent(slug)}`, roomOpts(flags));
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const sheet = data.sheet;
  const manifest = data.manifest;
  printSheetRow(sheet, manifest);
  console.log(`Directory: ${sheet.sheet_dir}`);
  console.log(`Owner:     ${sheet.owner_session_id}`);
  console.log(`Rooms:     ${(sheet.allowed_room_ids || []).join(', ') || '(none)'}`);
  if (!manifest) {
    console.log('Manifest:  missing');
    return;
  }
  console.log(`Manifest:  ${manifest.updated_at}`);
  console.log(`Source:    ${manifest.source_session_id || '(unknown)'}`);
  if (manifest.source_evidence_hash) console.log(`Evidence:  ${manifest.source_evidence_hash}`);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const file of files.slice(0, Number(flags.limit || 12))) {
    console.log(`  ${file.sha256.slice(0, 12)} ${String(file.size).padStart(8)} ${file.path}`);
  }
  if (files.length > Number(flags.limit || 12)) {
    console.log(`  ... ${files.length - Number(flags.limit || 12)} more`);
  }
}

async function showManifest(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant sheet manifest <slug> [--session <room-id>]');
  const data = await api.get(ctx, `/api/sheets/${encodeURIComponent(slug)}`, roomOpts(flags));
  const manifest = data.manifest;
  if (!manifest) throw new Error('Sheet manifest is missing');
  console.log(JSON.stringify(manifest, null, 2));
}

async function showAudit(slug: string, flags: any, ctx: any) {
  if (!slug) throw new Error('Usage: ant sheet audit <slug> [--limit 50] [--session <room-id>]');
  const limit = Number(flags.limit || 50);
  const data = await api.get(ctx, `/api/sheets/${encodeURIComponent(slug)}/audit?limit=${encodeURIComponent(String(limit))}`, roomOpts(flags));
  const events = data.events || [];
  if (ctx.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (!events.length) {
    console.log('No sheet audit events.');
    return;
  }
  for (const event of events) {
    const path = event.path ? ` ${event.path}` : '';
    const actor = event.actor ? ` ${event.actor}` : '';
    console.log(`${event.ts} ${event.type}${path}${actor}`);
  }
}

export async function sheet(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    await listSheets(flags, ctx);
    return;
  }

  if (sub === 'status' || sub === 'show') {
    await showSheet(args[1], flags, ctx);
    return;
  }

  if (sub === 'manifest') {
    await showManifest(args[1], flags, ctx);
    return;
  }

  if (sub === 'audit' || sub === 'log') {
    await showAudit(args[1], flags, ctx);
    return;
  }

  if (sub === 'file') {
    const op = args[1];
    const slug = args[2];
    const filePath = args[3];
    const tok = roomOpts(flags);
    if (op === 'get') return fileGet(ctx, SHEET_KIND, slug, filePath, flags, tok?.roomToken);
    if (op === 'put') return filePut(ctx, SHEET_KIND, slug, filePath, flags, tok?.roomToken);
    throw new Error(
      `Usage:\n` +
      `  ant sheet file get <slug> <path> [--out PATH] [--json] [--session <room-id>]\n` +
      `  ant sheet file put <slug> <path> [--from-file LOCAL | --content "..."]\n` +
      `                      [--base-hash X --if-match-mtime N] [--session <room-id>]`,
    );
  }

  await showSheet(sub, flags, ctx);
}
