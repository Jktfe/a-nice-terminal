// antchat open — launch the room's web view in the user's default browser.
//
// Constructs the URL from the saved per-room token (server + room id) and
// hands it to `open` (macOS), `xdg-open` (Linux), or `start` (Windows).
// When --print is set, just emits the URL and exits 0 — handy for piping
// into `pbcopy` or another script.

import { execFile } from 'child_process';
import { config } from '../../cli/lib/config.js';

function platformOpener(): { cmd: string; argv: (url: string) => string[] } | null {
  if (process.platform === 'darwin') return { cmd: 'open', argv: (u) => [u] };
  if (process.platform === 'linux') return { cmd: 'xdg-open', argv: (u) => [u] };
  if (process.platform === 'win32') return { cmd: 'cmd', argv: (u) => ['/c', 'start', '""', u] };
  return null;
}

export async function open(args: string[], flags: any, ctx: any) {
  const roomId = args[0];
  if (!roomId) {
    console.error('Usage: antchat open <room-id> [--print]');
    process.exit(1);
  }

  const tok = config.getRoomToken(roomId, typeof flags.handle === 'string' ? flags.handle : undefined);
  if (!tok) {
    console.error(`antchat open: no token for room ${roomId}. Run: antchat join ...`);
    process.exit(1);
  }

  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat open: no server URL - pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }

  // /r/<id> is the canonical room landing page; the server resolves chat /
  // plan / docs / decks tabs from there.
  const url = `${serverUrl.replace(/\/+$/, '')}/r/${encodeURIComponent(roomId)}`;

  if (flags.print || ctx.json) {
    if (ctx.json) console.log(JSON.stringify({ url }));
    else console.log(url);
    return;
  }

  const opener = platformOpener();
  if (!opener) {
    console.log(url);
    console.error(`antchat open: unsupported platform ${process.platform} - URL printed above for manual launch.`);
    return;
  }

  await new Promise<void>((resolve) => {
    execFile(opener.cmd, opener.argv(url), { timeout: 4000 }, (err) => {
      if (err) {
        console.error(`antchat open: ${opener.cmd} failed - ${err.message}`);
        console.log(url);
      } else {
        console.log(`Opened ${url}`);
      }
      resolve();
    });
  });
}
