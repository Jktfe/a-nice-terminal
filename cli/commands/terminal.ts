import { api } from '../lib/api.js';
import WebSocket from 'ws';

export async function terminal(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const subsWithId = new Set(['send', 'watch', 'history']);
  const id = subsWithId.has(sub) ? args[1] : sub;

  if (!id) {
    console.error('Usage: ant terminal <session-id>');
    return;
  }

  // Send a single command
  if (sub === 'send') {
    const cmd = flags.cmd || args[2];
    if (!cmd) { console.error('Usage: ant terminal send <id> --cmd "command"'); return; }
    await api.post(ctx, `/api/sessions/${id}/terminal/input`, { data: cmd + '\n' });
    if (ctx.json) { console.log(JSON.stringify({ ok: true })); return; }
    console.log(`Sent: ${cmd}`);
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

  // Watch mode — read-only terminal stream
  if (sub === 'watch') {
    if (!id) { console.error('Usage: ant terminal watch <session-id>'); return; }
    console.log(`Watching terminal session ${id} (read-only, Ctrl+C to exit)...`);

    const wsUrl = ctx.serverUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';
    const ws = new WebSocket(wsUrl, {
      headers: ctx.apiKey ? { 'Authorization': `Bearer ${ctx.apiKey}` } : {},
      rejectUnauthorized: false,
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_session', sessionId: id }));
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

  const wsUrl = ctx.serverUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';
  const ws = new WebSocket(wsUrl, {
    headers: ctx.apiKey ? { 'Authorization': `Bearer ${ctx.apiKey}` } : {},
    rejectUnauthorized: false,
  });

  ws.on('open', () => {
    // Join the session
    ws.send(JSON.stringify({ type: 'join_session', sessionId: id }));

    // Enter raw mode for real terminal experience
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      ws.send(JSON.stringify({ type: 'terminal_input', sessionId: id, data: data.toString() }));
    });

    // Send terminal size
    const { columns, rows } = process.stdout;
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
