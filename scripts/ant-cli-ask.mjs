/**
 * ant ask — explicit-ask CLI (asks-as-pill JWPK 2026-05-22).
 *
 * Verbs:
 *   ant ask open --to @<human> --in <roomId> "question body" [--title TXT]
 *     Files an ask targeting a human member of the room. Equivalent to
 *     @-mentioning them in a chat message, but without the chat message —
 *     for agents that want to ask without polluting the channel.
 *
 *   ant ask answer <askId> --body "your answer"
 *     Closes an ask with the supplied answer. Broadcasts the answer back to
 *     the originating room as a system message.
 *
 *   ant ask dismiss <askId>
 *     Closes an ask with no answer. Silent in-chat. Useful when the agent
 *     that opened the ask notices the human already replied inline.
 *
 *   ant ask merge <sourceAskId> --into <intoAskId>
 *     Premium chair-style roll-up. Source flips to 'merged'; askee's pill
 *     stays lit because the merged-into ask still owes a response.
 *
 *   ant ask list [--for @<handle>] [--json]
 *     Lists open + merged asks. With --for, scopes to asks targeting that
 *     handle (i.e. "what's in my inbox").
 *
 * 9-year-old-readable. Stay under 260 lines.
 */

import { makeStandardSendJson, resolveChatRoomIdentifier } from './ant-cli-shared-resolve.mjs';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

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

function writeUsage(runtime) {
  runtime.writeOut('ant ask <open|answer|dismiss|merge|list>');
  runtime.writeOut('  ask open    --to @<human> --in <roomId> "body" [--title TXT]');
  runtime.writeOut('  ask answer  <askId> --body "answer"');
  runtime.writeOut('  ask dismiss <askId>');
  runtime.writeOut('  ask merge   <sourceId> --into <intoId>');
  runtime.writeOut('  ask list    [--for @handle] [--json]');
}

function ensureAtHandle(raw) {
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function callerHandle(runtime) {
  // The CLI's caller handle is whatever the identity-chain helper resolves
  // — we let the existing pidChain machinery fill in the request body, but
  // for asks we need the handle string client-side too. Falls back to @you
  // for human-driven invocations from a local terminal (the common case).
  return runtime.config?.callerHandle ?? '@you';
}

async function runOpen(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const body = positionals.join(' ').trim();
  if (body.length === 0) throw new CliInputError('ask open needs a body (positional arg)');
  if (!flags.to) throw new CliInputError('ask open needs --to @<human>');
  if (!flags.in) throw new CliInputError('ask open needs --in <roomId>');
  const room = await resolveChatRoomIdentifier(runtime, flags.in, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson('/api/asks', 'POST', {
    roomId: room.id,
    openedByHandle: callerHandle(runtime),
    targetHandle: ensureAtHandle(flags.to),
    title: flags.title ?? body.slice(0, 80),
    body
  });
  runtime.writeOut(`opened ${result?.ask?.id ?? '(unknown)'} → ${ensureAtHandle(flags.to)} in ${room.id}`);
  return 0;
}

async function runAnswer(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const askId = positionals[0];
  if (!askId) throw new CliInputError('ask answer needs an askId');
  if (!flags.body) throw new CliInputError('ask answer needs --body "the answer"');
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/asks/${encodeURIComponent(askId)}/answer`, 'POST', {
    answeredByHandle: callerHandle(runtime),
    answer: flags.body
  });
  runtime.writeOut(`answered ${result?.ask?.id ?? askId} (status=${result?.ask?.status ?? '?'})`);
  return 0;
}

async function runDismiss(args, runtime, CliInputError) {
  const { positionals } = parseFlags(args, CliInputError);
  const askId = positionals[0];
  if (!askId) throw new CliInputError('ask dismiss needs an askId');
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/asks/${encodeURIComponent(askId)}/dismiss`, 'POST', {
    dismissedByHandle: callerHandle(runtime)
  });
  runtime.writeOut(`dismissed ${result?.ask?.id ?? askId}`);
  return 0;
}

async function runMerge(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const sourceId = positionals[0];
  if (!sourceId) throw new CliInputError('ask merge needs a sourceAskId');
  if (!flags.into) throw new CliInputError('ask merge needs --into <intoAskId>');
  const sendJson = makeStandardSendJson(runtime);
  const result = await sendJson(`/api/asks/${encodeURIComponent(sourceId)}/merge`, 'POST', {
    intoAskId: flags.into,
    mergedByHandle: callerHandle(runtime)
  });
  runtime.writeOut(`merged ${sourceId} → ${flags.into} (status=${result?.ask?.status ?? '?'})`);
  return 0;
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const sendJson = makeStandardSendJson(runtime);
  // GET /api/asks needs auth — pidChain via query param resolves the
  // caller's terminal → inbox memberships → scope. See per-human inbox
  // slice 4 (2026-05-22). Without this the route returns 401.
  const pidChain = encodeURIComponent(JSON.stringify(processIdentityChain()));
  const result = await sendJson(`/api/asks?pidChain=${pidChain}`, 'GET');
  let asks = (result?.asks ?? []).filter((ask) => ask.status === 'open' || ask.status === 'merged');
  if (flags.for) {
    const handle = ensureAtHandle(flags.for);
    asks = asks.filter((ask) => ask.targetHandle === handle);
  }
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(asks, null, 2));
    return 0;
  }
  if (asks.length === 0) {
    runtime.writeOut('(no open asks)');
    return 0;
  }
  for (const ask of asks) {
    const target = ask.targetHandle ?? '(room broadcast)';
    runtime.writeOut(`${ask.id}  [${ask.status}]  ${ask.openedByHandle} → ${target}  ${ask.title}`);
  }
  return 0;
}

export async function handleAskVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  switch (action) {
    case 'open':    return runOpen(args, runtime, CliInputError);
    case 'answer':  return runAnswer(args, runtime, CliInputError);
    case 'dismiss': return runDismiss(args, runtime, CliInputError);
    case 'merge':   return runMerge(args, runtime, CliInputError);
    case 'list':    return runList(args, runtime, CliInputError);
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown ask verb: ${action}`);
  }
}
