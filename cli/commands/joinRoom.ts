// `ant join-room <share-string>` — exchanges an invite password for a room
// token and saves it to ~/.ant/config.json. Subsequent calls scoped to that
// room can present the token as Authorization: Bearer <token>.
//
// Share string formats accepted:
//   ant://host[:port]/r/<roomId>?invite=<inviteId>      — CLI canonical
//   https://host[:port]/r/<roomId>?invite=<inviteId>    — Browser/URL form
//
// Password resolution order: --password flag, ANT_INVITE_PASSWORD env var,
// then interactive prompt (no-echo via stdin raw mode when TTY).

import { createInterface } from 'readline';
import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

export interface ParsedShare {
  serverUrl: string;
  roomId: string;
  inviteId: string;
}

export function parseShareString(raw: string): ParsedShare {
  const trimmed = raw.trim();
  // Accepted schemes:
  //   ant://         — transport-agnostic, defaults to HTTPS (existing behaviour)
  //   ant+http://    — explicit HTTP override (Tailnet-internal, LAN, dev)
  //   ant+https://   — explicit HTTPS (same as ant://, just unambiguous)
  //   http:// / https:// — passthrough
  const m = trimmed.match(/^(ant\+https?|ant|https?):\/\/([^/]+)\/r\/([^/?]+)\?(.+)$/);
  if (!m) throw new Error(`Invalid share string. Expected ant://host/r/<id>?invite=<inviteId>, got: ${trimmed}`);
  const [, scheme, host, roomId, query] = m;
  const params = new URLSearchParams(query);
  const inviteId = params.get('invite');
  if (!inviteId) throw new Error('Share string missing ?invite=<inviteId>');
  let protocol: string;
  if (scheme === 'ant' || scheme === 'ant+https') protocol = 'https';
  else if (scheme === 'ant+http') protocol = 'http';
  else protocol = scheme;
  return { serverUrl: `${protocol}://${host}`, roomId, inviteId };
}

async function readLineFromStdin(promptText: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function readPasswordFromStdin(promptText: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return readLineFromStdin(promptText);
  }
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let buf = '';
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          reject(new Error('Aborted'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        buf += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function joinRoom(args: string[], flags: any, ctx: any) {
  const shareInput = args[0];
  if (!shareInput) {
    console.error('Usage: ant join-room <share-string> [--password X] [--handle @name] [--kind cli|web]');
    console.error('Example: ant join-room "ant://host.example/r/abc123?invite=xyz789" --password hunter2');
    process.exit(1);
  }

  const parsed = parseShareString(shareInput);
  const exchangeCtx = { ...ctx, serverUrl: parsed.serverUrl };

  let password = typeof flags.password === 'string' ? flags.password : process.env.ANT_INVITE_PASSWORD || '';
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('No --password flag, no ANT_INVITE_PASSWORD env, and stdin is not a TTY. Cannot prompt.');
      process.exit(1);
    }
    try {
      password = (await readPasswordFromStdin(`Password for room ${parsed.roomId}: `)).trim();
    } catch {
      console.error('Aborted.');
      process.exit(130);
    }
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

  let result: any;
  try {
    result = await api.post(exchangeCtx, `/api/sessions/${parsed.roomId}/invites/${parsed.inviteId}/exchange`, {
      password,
      kind: kindRaw,
      handle,
      meta: { client: 'ant-cli', host: process.env.HOSTNAME || null },
    });
  } catch (err: any) {
    // Server returns 401 for wrong password, expired/revoked invite, OR
    // tripped failure threshold. The opaque error is intentional — see
    // src/lib/server/room-invites.ts exchangePassword.
    console.error(`Exchange failed: ${err.message}`);
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
  console.log(`  Server:  ${parsed.serverUrl}`);
  console.log(`  Token:   saved to ${config.path}`);
  console.log(`  Kind:    ${result.kind}`);
  console.log('');
  console.log(`Next: ant chat send ${result.room_id} --msg "hello"`);
}
