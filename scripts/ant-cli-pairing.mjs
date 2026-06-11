/**
 * ant pairing — QR-based device onboarding.
 *
 *   ant pairing generate --room ROOM_ID [--expires-hours 24] [--json]
 *   ant pairing consume <token> [--device-name NAME] [--json]
 *   ant pairing list --room ROOM_ID [--json]
 *   ant pairing revoke <token> [--json]
 *   ant pairing qr <token> [--json]
 */

const BOOLEAN_FLAGS = new Set(['json']);

export async function handlePairingVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);

  if (action === 'generate') {
    return generateToken(flags, runtime, CliInputError);
  }
  if (action === 'consume') {
    const token = args[0] || flags.token;
    return consumeToken(token, flags, runtime, CliInputError);
  }
  if (action === 'list') {
    return listTokens(flags, runtime, CliInputError);
  }
  if (action === 'revoke') {
    const token = args[0] || flags.token;
    return revokeToken(token, flags, runtime, CliInputError);
  }
  if (action === 'qr') {
    const token = args[0] || flags.token;
    return showQr(token, flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  writeUsage(runtime);
  throw new CliInputError(`unknown pairing verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant pairing <generate|consume|list|revoke|qr> [flags]');
  runtime.writeOut('  generate --room ROOM_ID [--expires-hours 24] [--json]');
  runtime.writeOut('  consume <token> [--device-name NAME] [--json]');
  runtime.writeOut('  list --room ROOM_ID [--json]');
  runtime.writeOut('  revoke <token> [--json]');
  runtime.writeOut('  qr <token> [--json]');
  runtime.writeOut('QR device onboarding for rooms (pairing-tokens). For helper-app/agent attachment pairing use: ant helper pair');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function generateToken(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('generate requires --room');

  const body = {
    roomId,
    serverUrl: runtime.serverUrl,
    apiKey: process.env.ANT_API_KEY || '',
    deviceName: flags['device-name'] || undefined,
    expiresAtMs: flags['expires-hours']
      ? Date.now() + Number(flags['expires-hours']) * 60 * 60 * 1000
      : undefined,
  };

  const data = await fetchJson(runtime, '/api/pairing-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data.token, null, 2));
  } else {
    const t = data.token;
    runtime.writeOut(`Generated pairing token: ${t.token}`);
    runtime.writeOut(`Room: ${t.room_id}`);
    runtime.writeOut(`Expires: ${t.expires_at_ms ? new Date(t.expires_at_ms).toISOString() : 'never'}`);
    runtime.writeOut(`QR URL: ${runtime.serverUrl}/api/pairing-tokens/qr?token=${encodeURIComponent(t.token)}`);
  }
  return 0;
}

async function consumeToken(token, flags, runtime, CliInputError) {
  if (!token) throw new CliInputError('consume requires a token');
  const data = await fetchJson(runtime, `/api/pairing-tokens/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: flags['device-name'] || undefined }),
  });
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(data.token, null, 2));
  } else {
    const t = data.token;
    runtime.writeOut(`Consumed token for room ${t.room_id}`);
    runtime.writeOut(`Server: ${t.server_url}`);
  }
  return 0;
}

async function listTokens(flags, runtime, CliInputError) {
  const roomId = flags.room;
  if (!roomId) throw new CliInputError('list requires --room');
  const data = await fetchJson(runtime, `/api/pairing-tokens?roomId=${encodeURIComponent(roomId)}`);
  const tokens = data.tokens || [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(tokens, null, 2));
    return 0;
  }
  if (!tokens.length) {
    runtime.writeOut('No pairing tokens.');
    return 0;
  }
  for (const t of tokens) {
    const status = t.consumed_at_ms ? 'consumed' : (t.expires_at_ms && t.expires_at_ms < Date.now() ? 'expired' : 'active');
    runtime.writeOut(`${t.token.slice(0, 16)}... ${status} room=${t.room_id}`);
  }
  return 0;
}

async function revokeToken(token, flags, runtime, CliInputError) {
  if (!token) throw new CliInputError('revoke requires a token');
  await fetchJson(runtime, `/api/pairing-tokens/${encodeURIComponent(token)}`, { method: 'DELETE' });
  runtime.writeOut(`Revoked token ${token.slice(0, 16)}...`);
  return 0;
}

async function showQr(token, flags, runtime, CliInputError) {
  if (!token) throw new CliInputError('qr requires a token');
  const qrUrl = `${runtime.serverUrl}/api/pairing-tokens/qr?token=${encodeURIComponent(token)}`;
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ qrUrl }));
  } else {
    runtime.writeOut(`QR Code URL: ${qrUrl}`);
  }
  return 0;
}
