// antchat join — exchange a share-string invite for a long-lived room token.
//
// Reuses cli/commands/joinRoom for the actual exchange so antchat and the full
// `ant` CLI share semantics, but exposes the same flag surface under a tighter
// `antchat`-shaped help message.

import {
  parseShareString,
  exchangeInvite,
  type ParsedShare,
  type InviteKind,
  type ExchangeInviteResult,
} from '../../cli/commands/joinRoom.js';
import { config } from '../../cli/lib/config.js';
import { createInterface } from 'readline';

async function readLineFromStdin(promptText: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function join(args: string[], flags: any, ctx: any) {
  const shareInput = args[0];
  if (!shareInput) {
    console.error('Usage: antchat join <share-string> [--password X] [--handle @name] [--label "..."] [--kind cli|web]');
    console.error('Example: antchat join "ant://host.example/r/abc123?invite=xyz789" --password hunter2 --handle @stevo');
    process.exit(1);
  }

  let parsed: ParsedShare;
  try {
    parsed = parseShareString(shareInput);
  } catch (err: any) {
    console.error(`antchat join: ${err?.message || 'invalid share string'}`);
    process.exit(1);
  }

  let password = typeof flags.password === 'string' ? flags.password : process.env.ANT_INVITE_PASSWORD || '';
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('No --password flag, no ANT_INVITE_PASSWORD env, and stdin is not a TTY. Cannot prompt.');
      process.exit(1);
    }
    password = (await readLineFromStdin(`Password for room ${parsed.roomId}: `)).trim();
  }
  if (!password) {
    console.error('Password required.');
    process.exit(1);
  }

  const kindRaw = typeof flags.kind === 'string' ? flags.kind : 'cli';
  const handleInput = typeof flags.handle === 'string' ? flags.handle : '';
  const handle = handleInput
    ? (handleInput.startsWith('@') ? handleInput : `@${handleInput}`)
    : null;
  const labelInput = typeof flags.label === 'string' ? flags.label : '';

  let result: ExchangeInviteResult;
  try {
    result = await exchangeInvite({
      parsed,
      password,
      kind: kindRaw as InviteKind,
      handle,
      label: labelInput,
      metaClient: 'antchat',
      ctx,
    });
  } catch (err: any) {
    console.error(`antchat join: exchange failed — ${err.message}`);
    process.exit(1);
  }

  if (ctx.json) {
    console.log(JSON.stringify({
      ok: true,
      room_id: result.room_id,
      kind: result.kind,
      handle: result.handle,
      server: parsed.serverUrl,
      config_path: config.path,
    }, null, 2));
    return;
  }

  console.log(`✓ Joined room ${result.room_id} as ${result.handle ?? '(no handle)'}`);
  console.log(`  Server: ${parsed.serverUrl}`);
  console.log(`  Token:  saved to ${config.path}`);
  console.log(`  Kind:   ${result.kind}`);
  console.log('');
  console.log(`Next: antchat msg ${result.room_id} "hello"`);
}
