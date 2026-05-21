import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleInterviewVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'start': return runStart(flags, runtime, CliInputError);
    case 'end': return runEnd(flags, runtime, CliInputError);
    case 'send': return runSend(flags, runtime, CliInputError);
    case 'summary': return runSummary(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown interview verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      if (flags.interviewId === undefined) { flags.interviewId = token; cursor += 1; continue; }
      throw new CliInputError(`unexpected positional arg: ${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function writeUsage(runtime) {
  runtime.writeOut('ant interview <start|end|send|summary> [flags]\n  start --room <id> --with @handle\n  end <interview-id> [--reason "..."]\n  send <interview-id> --msg "..."\n  summary <interview-id>');
}

async function fetchJson(runtime, path, init = {}) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

function writeJsonOrText(runtime, flags, payload, text) {
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(text);
}

async function runStart(flags, runtime, CliInputError) {
  const room = flags.room;
  if (!room) throw new CliInputError('missing required flag --room');
  const subject = flags.with;
  if (!subject) throw new CliInputError('missing required flag --with');
  const body = { subjectHandle: subject, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/chat-rooms/${encodeURIComponent(room)}/interviews`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const id = payload.interview?.id ?? payload.id;
  writeJsonOrText(runtime, flags, payload, `Interview started: ${id} (${subject} in ${room})`);
  return 0;
}

async function runSend(flags, runtime, CliInputError) {
  const id = flags.interviewId;
  if (!id) throw new CliInputError('missing interview-id positional arg');
  const msg = flags.msg;
  if (!msg) throw new CliInputError('missing required flag --msg');
  const body = { body: msg, pidChain: processIdentityChain() };
  const payload = await fetchJson(runtime, `/api/interviews/${encodeURIComponent(id)}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const messageId = payload.message?.id ?? '<unknown>';
  writeJsonOrText(runtime, flags, payload, `Sent into interview ${id}: ${messageId}`);
  return 0;
}

async function runSummary(flags, runtime, CliInputError) {
  const id = flags.interviewId;
  if (!id) throw new CliInputError('missing interview-id positional arg');
  const payload = await fetchJson(runtime, `/api/interviews/${encodeURIComponent(id)}/summary`);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  runtime.writeOut(formatSummaryText(payload.summary ?? payload));
  return 0;
}

function formatSummaryText(summary) {
  if (!summary || typeof summary !== 'object') return 'No summary available.';
  const iv = summary.interview ?? {};
  const lines = [];
  lines.push(`Interview ${iv.id ?? '<unknown>'} (${summary.status ?? '?'})`);
  lines.push(`  Room:        ${iv.room_id ?? '?'}`);
  lines.push(`  Interviewer: ${iv.interviewer ?? '?'}`);
  lines.push(`  Subject:     ${iv.subject_handle ?? '?'}`);
  lines.push(`  Duration:    ${formatDurationMs(summary.durationMs ?? 0)}`);
  lines.push(`  Messages:    ${summary.messageCountTotal ?? 0}`);
  const byAuthor = Array.isArray(summary.messageCountByAuthor) ? summary.messageCountByAuthor : [];
  for (const row of byAuthor) {
    lines.push(`    ${row.authorHandle}: ${row.count}`);
  }
  if (summary.firstMessage) lines.push(`  First:  ${summary.firstMessage.authorHandle}: ${summary.firstMessage.summary}`);
  if (summary.middleMessage) lines.push(`  Middle: ${summary.middleMessage.authorHandle}: ${summary.middleMessage.summary}`);
  if (summary.lastMessage) lines.push(`  Last:   ${summary.lastMessage.authorHandle}: ${summary.lastMessage.summary}`);
  return lines.join('\n');
}

function formatDurationMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h${remMinutes}m`;
}

async function runEnd(flags, runtime, CliInputError) {
  const id = flags.interviewId;
  if (!id) throw new CliInputError('missing interview-id positional arg');
  const body = { pidChain: processIdentityChain() };
  if (flags.reason) body.reason = flags.reason;
  const payload = await fetchJson(runtime, `/api/interviews/${encodeURIComponent(id)}/end`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  writeJsonOrText(runtime, flags, payload, `Interview ${id} ended.`);
  return 0;
}
