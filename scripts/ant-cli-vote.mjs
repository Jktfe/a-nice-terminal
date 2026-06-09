/**
 * ant vote — durable multi-agent vote primitive.
 *
 *   ant vote create --room ROOM --title TEXT --options a,b [--voters @a,@b] [--rooms R2,R3] [--json]
 *   ant vote list --room ROOM [--json]
 *   ant vote show VOTE_ID [--json]
 *   ant vote cast VOTE_ID --room ROOM --option OPTION_ID [--reason TEXT] [--json]
 *   ant vote close VOTE_ID --room ROOM [--json]
 */
import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { resolveChatRoomIdentifier } from './ant-cli-shared-resolve.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleVoteVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'create': return runCreate(args, runtime, CliInputError);
    case 'list': return runList(args, runtime, CliInputError);
    case 'show': return runShow(args, runtime, CliInputError);
    case 'cast': return runCast(args, runtime, CliInputError);
    case 'close': return runClose(args, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown vote verb: ${action}`);
  }
}

async function runCreate(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const room = await resolveChatRoomIdentifier(runtime, requireFlag(flags, 'room', CliInputError), CliInputError);
  const extraRooms = [];
  for (const roomName of splitList(flags.rooms)) {
    extraRooms.push(await resolveChatRoomIdentifier(runtime, roomName, CliInputError));
  }
  const payload = await fetchJson(runtime, '/api/votes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomId: room.id,
      roomIds: extraRooms.map((r) => r.id),
      title: requireFlag(flags, 'title', CliInputError),
      body: flags.body,
      options: splitList(requireFlag(flags, 'options', CliInputError)),
      eligibleVoters: splitList(flags.voters),
      pidChain: processIdentityChain()
    })
  });
  writeVote(runtime, flags, payload, `Opened vote ${payload.vote.id}: ${payload.vote.title} (${payload.vote.state})`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const room = await resolveChatRoomIdentifier(runtime, requireFlag(flags, 'room', CliInputError), CliInputError);
  const query = new URLSearchParams({ roomId: room.id });
  const payload = await fetchJson(runtime, `/api/votes?${query.toString()}`);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const votes = payload.votes ?? [];
  if (votes.length === 0) {
    runtime.writeOut('No votes.');
    return 0;
  }
  for (const vote of votes) {
    runtime.writeOut(`${vote.id}\t${vote.state}\t${vote.title}\tmissing:${vote.missingVoters?.join(',') || '-'}`);
  }
  return 0;
}

async function runShow(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const voteId = positionals[0];
  if (!voteId) throw new CliInputError('vote show needs VOTE_ID');
  const payload = await fetchJson(runtime, `/api/votes/${encodeURIComponent(voteId)}`);
  writeVote(runtime, flags, payload, formatVote(payload.vote));
  if (!flags.json && Array.isArray(payload.history) && payload.history.length > 0) {
    runtime.writeOut(`  audit (${payload.history.length} cast${payload.history.length === 1 ? '' : 's'}):`);
    for (const e of payload.history) {
      const change = e.previousOptionLabel ? `${e.previousOptionLabel} → ${e.optionLabel}` : e.optionLabel;
      const when = new Date(e.castAtMs).toISOString().slice(11, 19);
      runtime.writeOut(`    ${e.voterHandle}: ${change}${e.reason ? ` ("${e.reason}")` : ''} @${when} [${e.roomId}]`);
    }
  }
  return 0;
}

async function runCast(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const voteId = positionals[0];
  if (!voteId) throw new CliInputError('vote cast needs VOTE_ID');
  const room = await resolveChatRoomIdentifier(runtime, requireFlag(flags, 'room', CliInputError), CliInputError);
  const payload = await fetchJson(runtime, `/api/votes/${encodeURIComponent(voteId)}/cast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomId: room.id,
      optionId: requireFlag(flags, 'option', CliInputError),
      reason: flags.reason,
      pidChain: processIdentityChain()
    })
  });
  writeVote(runtime, flags, payload, `Cast vote ${payload.vote.id}: ${payload.vote.state}`);
  return 0;
}

async function runClose(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const voteId = positionals[0];
  if (!voteId) throw new CliInputError('vote close needs VOTE_ID');
  const room = await resolveChatRoomIdentifier(runtime, requireFlag(flags, 'room', CliInputError), CliInputError);
  const payload = await fetchJson(runtime, `/api/votes/${encodeURIComponent(voteId)}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: room.id, pidChain: processIdentityChain() })
  });
  writeVote(runtime, flags, payload, `Closed vote ${payload.vote.id}: ${payload.vote.state}`);
  return 0;
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
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
  return { flags, positionals };
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function splitList(value) {
  if (typeof value !== 'string') return [];
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

function writeVote(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

function formatVote(vote) {
  const tally = (vote.tally ?? []).map((row) => `${row.label}=${row.count}`).join(' · ');
  return `${vote.id} (${vote.state}) ${vote.title} | voters:${vote.eligibleVoters?.join(',') || '-'} | missing:${vote.missingVoters?.join(',') || '-'} | ${tally}`;
}

function writeUsage(runtime) {
  runtime.writeOut('ant vote <create|list|show|cast|close>');
  runtime.writeOut('  create --room ROOM --title TEXT --options a,b [--voters @a,@b] [--rooms R2,R3] [--json]');
  runtime.writeOut('  list --room ROOM [--json]');
  runtime.writeOut('  show VOTE_ID [--json]');
  runtime.writeOut('  cast VOTE_ID --room ROOM --option OPTION_ID [--reason TEXT] [--json]');
  runtime.writeOut('  close VOTE_ID --room ROOM [--json]');
}
