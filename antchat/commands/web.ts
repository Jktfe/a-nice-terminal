// antchat web — local browser UI for non-technical users.
//
// v0.3.0-alpha ships `web` / `web run` (foreground). The daemon family
// (`install/uninstall/status/open/rotate-token`) is wired here as
// stubbed-with-clear-error subcommands so the CLI surface matches the
// final v0.3 design; full implementations land in v0.3.1 when we add
// the launchd plist + Keychain plumbing.

import { createWebServer } from '../web/server.js';
import { mintLaunchToken } from '../web/auth.js';

declare const Bun: any;

const DEFAULT_PORT = 6459;

function help(): never {
  console.error([
    'Usage:',
    '  antchat web [run]                — launch a local browser UI on 127.0.0.1:6459',
    '  antchat web install              — (v0.3.1) install LaunchAgent for autostart',
    '  antchat web uninstall            — (v0.3.1) remove LaunchAgent',
    '  antchat web status               — (v0.3.1) report daemon health',
    '  antchat web open                 — (v0.3.1) open browser on the running daemon',
    '  antchat web rotate-token         — (v0.3.1) re-mint the Keychain launch token',
    '',
    'Flags:',
    '  --port <n>       Port to bind on 127.0.0.1 (default 6459)',
    '  --no-open        Do not open a browser (useful for SSH / launchd)',
  ].join('\n'));
  process.exit(1);
}

async function runForeground(flags: any): Promise<void> {
  const port = typeof flags.port === 'string' || typeof flags.port === 'number'
    ? Number(flags.port) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`antchat web: invalid --port ${flags.port}`);
    process.exit(1);
  }

  const launchToken = mintLaunchToken();

  let handle;
  try {
    handle = createWebServer({ port, launchToken });
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE' || /address already in use/i.test(err?.message || '')) {
      console.error(`antchat web: port ${port} is already in use. Pick another with --port.`);
      process.exit(1);
    }
    throw err;
  }

  const url = `http://127.0.0.1:${port}/#token=${launchToken}`;
  console.log(`antchat web ready at ${url}`);

  // Copy URL to clipboard (best-effort).
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
    proc.stdin.write(url);
    await proc.stdin.end();
  } catch { /* pbcopy not available — never mind */ }

  if (!flags['no-open']) {
    try { Bun.spawn(['open', url]); }
    catch { /* `open` not available — print is enough */ }
  }

  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nantchat web shutting down…');
    try { await handle.close(); }
    finally { process.exit(0); }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Block forever — Bun.serve handles requests; SIGINT triggers cleanup.
  await new Promise<void>(() => { /* never resolves */ });
}

function notImplemented(name: string): never {
  console.error(`antchat web ${name}: not yet implemented (lands in v0.3.1).`);
  console.error('Workaround: run `antchat web` foreground in a terminal multiplexer (tmux/screen) or via `nohup`.');
  process.exit(2);
}

export async function web(args: string[], flags: any, _ctx: any): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'run') return runForeground(flags);
  if (sub === '--help' || sub === '-h') return help();
  switch (sub) {
    case 'install':       return notImplemented('install');
    case 'uninstall':     return notImplemented('uninstall');
    case 'status':        return notImplemented('status');
    case 'open':          return notImplemented('open');
    case 'rotate-token':  return notImplemented('rotate-token');
    default:
      console.error(`antchat web: unknown subcommand "${sub}"`);
      help();
  }
}
