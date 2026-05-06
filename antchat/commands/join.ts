// antchat join — exchange a share-string invite for a long-lived room token.
//
// Reuses cli/commands/joinRoom for the actual exchange so antchat and the full
// `ant` CLI share semantics, but exposes the same flag surface under a tighter
// `antchat`-shaped help message.

import { parseShareString, type ParsedShare } from '../../cli/commands/joinRoom.js';
import { api } from '../../cli/lib/api.js';
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
  if (!['cli', 'mcp', 'web'].includes(kindRaw)) {
    console.error(`Invalid --kind ${kindRaw}. Must be cli, mcp, or web.`);
    process.exit(1);
  }

  const handleInput = typeof flags.handle === 'string' ? flags.handle : '';
  const handle = handleInput
    ? (handleInput.startsWith('@') ? handleInput : `@${handleInput}`)
    : null;

  const exchangeCtx = { ...ctx, serverUrl: parsed.serverUrl };
  let result: any;
  try {
    result = await api.post(exchangeCtx, `/api/sessions/${parsed.roomId}/invites/${parsed.inviteId}/exchange`, {
      password,
      kind: kindRaw,
      handle,
      meta: { client: 'antchat', host: process.env.HOSTNAME || null },
    });
  } catch (err: any) {
    console.error(`antchat join: exchange failed — ${err.message}`);
    process.exit(1);
  }

  config.set('serverUrl', parsed.serverUrl);
  const labelInput = typeof flags.label === 'string' ? flags.label.trim() : '';
  config.setRoomToken(parsed.roomId, {
    token: result.token,
    token_id: result.token_id,
    invite_id: result.invite_id,
    room_id: result.room_id,
    kind: result.kind,
    handle: result.handle ?? handle,
    joined_at: new Date().toISOString(),
    server_url: parsed.serverUrl,
    ...(labelInput ? { label: labelInput } : {}),
  });

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
