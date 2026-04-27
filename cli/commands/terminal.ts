import { api } from '../lib/api.js';
import { getKeySequence, SPECIAL_KEYS } from '../../src/lib/shared/special-keys.js';
import WebSocket from 'ws';

function formatEventData(kind: string, data: any): string {
  if (!data || typeof data !== 'object') return '';
  switch (kind) {
    case 'window-add':
    case 'window-close':
    case 'unlinked-window-add':
    case 'unlinked-window-close':
      return data.window_id != null ? `window @${data.window_id}` : '';
    case 'window-renamed':
    case 'unlinked-window-renamed':
      return `window @${data.window_id ?? '?'} → "${data.name ?? ''}"`;
    case 'session-changed':
    case 'client-session-changed':
      return `session $${data.session_tmux_id ?? '?'} "${data.name ?? ''}"`;
    case 'session-renamed':
      return `"${data.name ?? ''}"`;
    case 'layout-change':
      return `window @${data.window_id ?? '?'}  ${data.layout ?? ''}`;
    case 'pane-mode-changed':
    case 'continue':
    case 'pause':
      return data.pane_id != null ? `pane %${data.pane_id}` : '';
    case 'exit':
    case 'client-detached':
      return data.reason ?? '';
    default:
      return data.raw ?? '';
  }
}

function wsUrlFor(ctx: any): string {
  return ctx.serverUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';
}

function connectHeaders(ctx: any) {
  return {
    headers: ctx.apiKey ? { 'Authorization': `Bearer ${ctx.apiKey}` } : {},
    rejectUnauthorized: false,
  };
}

async function sendViaSpawnedTerminal(ctx: any, sessionId: string, data: string) {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrlFor(ctx), connectHeaders(ctx));
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('Timed out waiting for terminal session to spawn'));
    }, 8000);

    function done(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve();
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_session', sessionId, spawnPty: true, cols: 120, rows: 30 }));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type !== 'session_health' || msg.sessionId !== sessionId) return;
        if (!msg.alive) {
          done(new Error('Terminal session is not alive'));
          return;
        }
        ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
        setTimeout(() => done(), 150);
      } catch {}
    });

    ws.on('error', (err) => done(err instanceof Error ? err : new Error(String(err))));
    ws.on('close', () => {
      if (!settled) done(new Error('WebSocket closed before terminal input was sent'));
    });
  });
}

export async function terminal(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const subsWithId = new Set(['send', 'watch', 'history', 'events', 'key']);
  const id = subsWithId.has(sub) ? args[1] : sub;

  if (!id) {
    console.error('Usage: ant terminal <session-id>');
    return;
  }

  // Send a single command
  if (sub === 'send') {
    const cmd = flags.cmd || args[2];
    if (!cmd) { console.error('Usage: ant terminal send <id> --cmd "command"'); return; }
    await sendViaSpawnedTerminal(ctx, id, cmd + '\r');
    if (ctx.json) { console.log(JSON.stringify({ ok: true })); return; }
    console.log(`Sent: ${cmd}`);
    return;
  }

  // Send a special key sequence by name
  //   ant terminal key <id> ctrl-c
  //   ant terminal key <id> enter
  //   ant terminal key <id> up
  if (sub === 'key') {
    const keyName = args[2];
    if (!keyName) {
      const valid = [...new Set(SPECIAL_KEYS.map(k => k.cli))].join(', ');
      console.error(`Usage: ant terminal key <id> <key-name>\nValid keys: ${valid}`);
      return;
    }
    const seq = getKeySequence(keyName);
    if (!seq) {
      const valid = [...new Set(SPECIAL_KEYS.map(k => k.cli))].join(', ');
      console.error(`Unknown key: "${keyName}"\nValid keys: ${valid}`);
      return;
    }
    if (seq === '__paste__') {
      console.error('Paste is not supported from the CLI');
      return;
    }
    await sendViaSpawnedTerminal(ctx, id, seq);
    if (ctx.json) { console.log(JSON.stringify({ ok: true, key: keyName })); return; }
    console.log(`Sent key: ${keyName}`);
    return;
  }

  // History — read terminal output from the DB (not xterm scrollback).
  //   ant terminal history <id>                    last 1h, stripped text
  //   ant terminal history <id> --since 5m
  //   ant terminal history <id> --grep "error"     FTS search
  //   ant terminal history <id> --raw              include raw ANSI bytes
  //   ant terminal history <id> --limit 50
  if (sub === 'history') {
    const qs = new URLSearchParams();
    if (flags.since) qs.set('since', String(flags.since));
    if (flags.grep)  qs.set('grep',  String(flags.grep));
    if (flags.limit) qs.set('limit', String(flags.limit));
    if (flags.raw)   qs.set('raw',   '1');
    const path = `/api/sessions/${id}/terminal/history${qs.toString() ? '?' + qs.toString() : ''}`;
    const result = await api.get(ctx, path);

    if (ctx.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const rows = result.rows || [];
    if (!rows.length) {
      console.log(`(no transcript rows for ${id})`);
      return;
    }

    if (result.mode === 'search') {
      console.log(`Matches for "${result.query}" in ${id} (${rows.length} hits):\n`);
      for (const r of rows) {
        const ts = new Date(r.ts_ms).toISOString();
        console.log(`[${ts}] chunk ${r.chunk_index} @${r.byte_offset}  ${r.size}b`);
        console.log(`  ${r.snippet}\n`);
      }
      return;
    }

    // Range mode — chunks come back newest-first; reverse so the tail of
    // history reads naturally top-to-bottom.
    const ordered = [...rows].reverse();
    for (const r of ordered) {
      const ts = new Date(r.ts_ms).toISOString();
      process.stdout.write(`\x1b[90m── ${ts}  chunk ${r.chunk_index}  ${r.size}b\x1b[0m\n`);
      process.stdout.write(r.raw ?? r.text ?? '');
      if (!(r.raw ?? r.text ?? '').endsWith('\n')) process.stdout.write('\n');
    }
    return;
  }

  // Events — tmux control-mode structured timeline (window add/close/rename,
  // session change, layout change, pane mode change, exit). Useful for
  // "what happened in this terminal" questions without parsing raw bytes.
  //   ant terminal events <id>                          last 1h
  //   ant terminal events <id> --since 15m --kind exit
  //   ant terminal events <id> --kind layout-change --limit 20
  if (sub === 'events') {
    const qs = new URLSearchParams();
    if (flags.since) qs.set('since', String(flags.since));
    if (flags.kind)  qs.set('kind',  String(flags.kind));
    if (flags.limit) qs.set('limit', String(flags.limit));
    const path = `/api/sessions/${id}/terminal/events${qs.toString() ? '?' + qs.toString() : ''}`;
    const result = await api.get(ctx, path);

    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }

    const rows = result.rows || [];
    if (!rows.length) {
      const kindLabel = result.kind ? ` kind=${result.kind}` : '';
      console.log(`(no terminal events for ${id}${kindLabel})`);
      return;
    }

    const header = result.kind
      ? `${rows.length} ${result.kind} events in ${id}:`
      : `${rows.length} events in ${id}:`;
    console.log(header + '\n');
    const ordered = [...rows].reverse();
    for (const r of ordered) {
      const ts = new Date(r.ts_ms).toISOString();
      const summary = formatEventData(r.kind, r.data);
      console.log(`\x1b[90m${ts}\x1b[0m  \x1b[1m${r.kind}\x1b[0m  ${summary}`);
    }
    return;
  }

  // Watch mode — read-only terminal stream
  if (sub === 'watch') {
    if (!id) { console.error('Usage: ant terminal watch <session-id>'); return; }
    console.log(`Watching terminal session ${id} (read-only, Ctrl+C to exit)...`);

    const ws = new WebSocket(wsUrlFor(ctx), connectHeaders(ctx));

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_session', sessionId: id, spawnPty: true, cols: 120, rows: 30 }));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'terminal_output' && msg.sessionId === id) {
          process.stdout.write(msg.data);
        }
      } catch {}
    });

    ws.on('close', () => { console.log('\nWatch ended.'); process.exit(0); });
    ws.on('error', (err) => { console.error(`Error: ${err.message}`); process.exit(1); });
    process.on('SIGINT', () => { ws.close(); process.exit(0); });
    return;
  }

  // Interactive terminal connection
  console.log(`Connecting to terminal session ${id}...`);

  const ws = new WebSocket(wsUrlFor(ctx), connectHeaders(ctx));

  ws.on('open', () => {
    // Join the session AND spawn PTY if not alive (same as browser Terminal.svelte)
    const { columns, rows } = process.stdout;
    ws.send(JSON.stringify({ type: 'join_session', sessionId: id, spawnPty: true, cols: columns || 120, rows: rows || 30 }));

    // Enter raw mode for real terminal experience
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId: id, data: data.toString() }));
    });

    // Send terminal size
    ws.send(JSON.stringify({ type: 'terminal_resize', sessionId: id, cols: columns, rows: rows }));

    // Handle terminal resize
    process.stdout.on('resize', () => {
      ws.send(JSON.stringify({
        type: 'terminal_resize',
        sessionId: id,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      }));
    });
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'terminal_output' && msg.sessionId === id) {
        process.stdout.write(msg.data);
      } else if (msg.type === 'session_health') {
        if (!msg.alive) {
          console.error('\nTerminal session is not alive.');
          cleanup();
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log('\nDisconnected from terminal.');
    cleanup();
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error: ${err.message}`);
    cleanup();
  });

  function cleanup() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    // Forward Ctrl+C to the terminal rather than exiting
    ws.send(JSON.stringify({ type: 'terminal_input', sessionId: id, data: '\x03' }));
  });
}
