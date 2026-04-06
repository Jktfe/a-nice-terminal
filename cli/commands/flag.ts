// ant flag <session-id> <file-path> [--note "why this matters"]
// ant flag <session-id> list
// ant flag <session-id> remove <ref-id>

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { resolve } from 'path';

export async function flag(args: string[], flags: any, ctx: any) {
  const sessionId = args[0];
  const sub = args[1];

  if (!sessionId || !sub) {
    console.error('Usage: ant flag <session-id> <file-path|list|remove> [...]');
    return;
  }

  const me = flags.from || config.get('sessionId') || config.get('handle') || 'cli';

  if (sub === 'list') {
    const data = await api.get(ctx, `/api/sessions/${sessionId}/file-refs`);
    const refs = data.refs || [];
    if (ctx.json) { console.log(JSON.stringify(refs)); return; }
    if (!refs.length) { console.log('No flagged files'); return; }
    for (const r of refs) {
      const by = r.flagged_by ? `\x1b[36m${r.flagged_by}\x1b[0m ` : '';
      const note = r.note ? `  \x1b[33m# ${r.note}\x1b[0m` : '';
      console.log(`  [${r.id.slice(0, 8)}] ${by}\x1b[32m${r.file_path}\x1b[0m${note}`);
    }
    return;
  }

  if (sub === 'remove') {
    const refId = args[2];
    if (!refId) { console.error('Usage: ant flag <session-id> remove <ref-id>'); return; }
    await api.del(ctx, `/api/sessions/${sessionId}/file-refs?refId=${refId}`);
    if (!ctx.json) console.log(`Removed file ref [${refId.slice(0, 8)}]`);
    return;
  }

  // Default: sub is a file path
  const filePath = resolve(sub); // make absolute
  const result = await api.post(ctx, `/api/sessions/${sessionId}/file-refs`, {
    file_path: filePath,
    note: flags.note || null,
    flagged_by: me,
  });

  if (ctx.json) { console.log(JSON.stringify(result)); return; }
  const note = flags.note ? `  # ${flags.note}` : '';
  console.log(`Flagged: \x1b[32m${filePath}\x1b[0m${note}`);
}
