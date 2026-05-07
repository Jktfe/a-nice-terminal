// antchat sheet — Open-Slide spreadsheet cowork from remote machines.
//
// Sheet-side mirror of antchat deck. Per Decision A (project_cowork_decisions
// _2026_05.md), sheets use whole-file base_hash + if_match_mtime concurrency
// — same protocol as decks, no cell-aware diffs yet. So Marco's agent reads
// the entire spreadsheet, fills in the lawyer-quote numbers from email, and
// uploads the entire spreadsheet back. Cell-aware diffs are the follow-up.

import { config } from '../../cli/lib/config.js';
import { api } from '../../cli/lib/api.js';
import { fileGet, filePut, SHEET_KIND } from '../../cli/lib/artefact-files.js';

interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

function resolveCallCtx(roomId: string, ctx: Ctx, flags: any): { callCtx: Ctx; roomToken: string } {
  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    if (handleFlag) {
      console.error(`antchat sheet: no token for room ${roomId} under handle ${handleFlag}. Run: antchat join …`);
    } else {
      console.error(`antchat sheet: no token for room ${roomId}. Run: antchat join …`);
    }
    process.exit(1);
  }
  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat sheet: no server URL — pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }
  return { callCtx: { ...ctx, serverUrl }, roomToken: tok.token };
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

export async function sheet(args: string[], flags: any, ctx: Ctx) {
  const roomId = args[0];
  const sub = args[1];

  if (!roomId || !sub) {
    printUsage();
    return;
  }

  const { callCtx, roomToken } = resolveCallCtx(roomId, ctx, flags);
  const opts = { roomToken };

  try {
    if (sub === 'list' || sub === 'ls') {
      const data = await api.get(callCtx, '/api/sheets', opts);
      const sheets = data.sheets || [];
      if (callCtx.json) { console.log(JSON.stringify(sheets, null, 2)); return; }
      if (!sheets.length) { console.log('No sheets visible to this room.'); return; }
      for (const s of sheets) printSheetRow(s);
      return;
    }

    if (sub === 'status' || sub === 'show') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat sheet <room> status <slug>');
      const data = await api.get(callCtx, `/api/sheets/${encodeURIComponent(slug)}`, opts);
      if (callCtx.json) { console.log(JSON.stringify(data, null, 2)); return; }
      printSheetRow(data.sheet, data.manifest);
      console.log(`Directory: ${data.sheet.sheet_dir}`);
      console.log(`Owner:     ${data.sheet.owner_session_id}`);
      console.log(`Rooms:     ${(data.sheet.allowed_room_ids || []).join(', ') || '(none)'}`);
      if (!data.manifest) { console.log('Manifest:  missing'); return; }
      console.log(`Manifest:  ${data.manifest.updated_at}`);
      const files = Array.isArray(data.manifest.files) ? data.manifest.files : [];
      const limit = Number(flags.limit || 12);
      for (const f of files.slice(0, limit)) {
        console.log(`  ${f.sha256.slice(0, 12)} ${String(f.size).padStart(8)} ${f.path}`);
      }
      if (files.length > limit) console.log(`  ... ${files.length - limit} more`);
      return;
    }

    if (sub === 'manifest') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat sheet <room> manifest <slug>');
      const data = await api.get(callCtx, `/api/sheets/${encodeURIComponent(slug)}`, opts);
      if (!data.manifest) throw new Error('Sheet manifest is missing');
      console.log(JSON.stringify(data.manifest, null, 2));
      return;
    }

    if (sub === 'audit' || sub === 'log') {
      const slug = args[2];
      if (!slug) throw new Error('Usage: antchat sheet <room> audit <slug> [--limit 50]');
      const limit = Number(flags.limit || 50);
      const data = await api.get(callCtx, `/api/sheets/${encodeURIComponent(slug)}/audit?limit=${encodeURIComponent(String(limit))}`, opts);
      const events = data.events || [];
      if (callCtx.json) { console.log(JSON.stringify(events, null, 2)); return; }
      if (!events.length) { console.log('No sheet audit events.'); return; }
      for (const e of events) {
        const path = e.path ? ` ${e.path}` : '';
        const actor = e.actor ? ` ${e.actor}` : '';
        console.log(`${e.ts} ${e.type}${path}${actor}`);
      }
      return;
    }

    if (sub === 'file') {
      const op = args[2];
      const slug = args[3];
      const filePath = args[4];
      if (op === 'get') return fileGet(callCtx, SHEET_KIND, slug, filePath, flags, roomToken);
      if (op === 'put') return filePut(callCtx, SHEET_KIND, slug, filePath, flags, roomToken);
      throw new Error(
        'Usage:\n' +
        '  antchat sheet <room> file get <slug> <path> [--out PATH] [--json]\n' +
        '  antchat sheet <room> file put <slug> <path> [--from-file LOCAL | --content "..."]\n' +
        '                                                 [--base-hash X --if-match-mtime N]',
      );
    }

    console.error(`antchat sheet: unknown subcommand "${sub}"`);
    printUsage();
    process.exit(1);
  } catch (err: any) {
    console.error(`antchat sheet: ${err.message}`);
    process.exit(1);
  }
}

function printUsage() {
  console.error('Usage: antchat sheet <room-id> <list|status|manifest|audit|file> [args]');
  console.error('');
  console.error('  antchat sheet <room> list');
  console.error('  antchat sheet <room> status <slug>');
  console.error('  antchat sheet <room> manifest <slug>');
  console.error('  antchat sheet <room> audit <slug> [--limit 50]');
  console.error('  antchat sheet <room> file get <slug> <path> [--out PATH] [--json]');
  console.error('  antchat sheet <room> file put <slug> <path> [--from-file LOCAL | --content "..."]');
  console.error('                                                [--base-hash X --if-match-mtime N]');
  console.error('');
  console.error('Whole-file concurrency: download → modify → upload with sha+mtime guards.');
  console.error('Cell-aware diffs are a future follow-up — today, the unit of write is the whole file.');
}
