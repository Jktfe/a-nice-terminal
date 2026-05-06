// antchat rooms — list every room this client has tokens for, grouped by
// room id and showing each handle's kind, server, and join time.

import { config } from '../../cli/lib/config.js';

interface RoomRow {
  room_id: string;
  handle: string | null;
  kind: string;
  server: string | null;
  label: string | null;
  joined_at: string;
}

export async function rooms(_args: string[], flags: any, _ctx: any) {
  const all = config.listRoomTokens();
  const rows: RoomRow[] = [];
  for (const [roomId, tokens] of Object.entries(all)) {
    for (const tok of tokens) {
      rows.push({
        room_id: roomId,
        handle: tok.handle,
        kind: tok.kind,
        server: tok.server_url ?? config.get('serverUrl') ?? null,
        label: tok.label ?? null,
        joined_at: tok.joined_at,
      });
    }
  }
  rows.sort((a, b) => a.room_id.localeCompare(b.room_id) || (a.handle ?? '').localeCompare(b.handle ?? ''));

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No joined rooms. Run: antchat join <share-string> --password <pw>');
    return;
  }

  // Plain columnar output for terminals; fancy formatting deferred to v0.2.0.
  const colWidths = {
    room: Math.max(8, ...rows.map(r => r.room_id.length)),
    handle: Math.max(8, ...rows.map(r => (r.handle ?? '(none)').length)),
    kind: 4,
    label: Math.max(5, ...rows.map(r => (r.label ?? '').length)),
  };
  const pad = (s: string, n: number) => s.padEnd(n, ' ');
  console.log(
    `${pad('ROOM', colWidths.room)}  ` +
    `${pad('HANDLE', colWidths.handle)}  ` +
    `${pad('KIND', colWidths.kind)}  ` +
    (colWidths.label > 0 ? `${pad('LABEL', colWidths.label)}  ` : '') +
    'SERVER',
  );
  for (const r of rows) {
    console.log(
      `${pad(r.room_id, colWidths.room)}  ` +
      `${pad(r.handle ?? '(none)', colWidths.handle)}  ` +
      `${pad(r.kind, colWidths.kind)}  ` +
      (colWidths.label > 0 ? `${pad(r.label ?? '', colWidths.label)}  ` : '') +
      (r.server ?? '—'),
    );
  }
}
