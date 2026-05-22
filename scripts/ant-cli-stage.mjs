/**
 * ant stage — agent-usable Stage v1 controls.
 *
 * This is intentionally tiny: agents can publish or inspect the current
 * focus of an existing deck. ANT does not become a deck editor here; it
 * just exposes the room-context signal that Stage needs.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleStageVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === 'focus') return runFocus(args, runtime, CliInputError);
  if (action === 'current' || action === 'show') return runCurrent(args, runtime, CliInputError);
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown stage verb: ${action}`);
}

async function runFocus(args, runtime, CliInputError) {
  const deckId = args[0];
  if (!deckId || deckId.startsWith('--')) throw new CliInputError('stage focus needs a deckId');
  const flags = parseFlags(args.slice(1), CliInputError);
  const slideIndex = readRequiredIntegerFlag(flags, 'slide-index', CliInputError);
  const body = {
    slideIndex,
    pidChain: processIdentityChain()
  };
  if (flags['slide-id']) body.slideId = flags['slide-id'];
  if (flags['slide-title']) body.slideTitle = flags['slide-title'];
  if (flags.plan) body.planId = flags.plan;

  const payload = await sendJson(runtime, `/api/decks/${encodeURIComponent(deckId)}/stage-focus`, 'POST', body);
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else {
    runtime.writeOut(formatFocusLine(payload.focus, deckId));
  }
  return 0;
}

async function runCurrent(args, runtime, CliInputError) {
  const deckId = args[0];
  if (!deckId || deckId.startsWith('--')) throw new CliInputError('stage current needs a deckId');
  const flags = parseFlags(args.slice(1), CliInputError);
  const url = new URL(`${runtime.serverUrl}/api/decks/${encodeURIComponent(deckId)}/stage-focus`);
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  const response = await runtime.fetchImpl(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET /api/decks/${deckId}/stage-focus returned ${response.status}: ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else {
    runtime.writeOut(formatFocusLine(payload.focus, deckId));
  }
  return 0;
}

async function sendJson(runtime, path, method, body) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = 'true';
      cursor += 1;
      continue;
    }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function readRequiredIntegerFlag(flags, name, CliInputError) {
  const raw = flags[name];
  if (raw === undefined) throw new CliInputError(`missing required flag --${name}`);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliInputError(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function formatFocusLine(focus, deckId) {
  if (!focus) return `No current stage focus for ${deckId}`;
  const label = focus.label ?? focus.ref ?? 'unknown focus';
  return `${label}\t${focus.ref ?? ''}`;
}

function writeUsage(runtime) {
  runtime.writeOut('ant stage focus <deckId> --slide-index N [--slide-id ID] [--plan PLAN_ID] [--json]');
  runtime.writeOut('ant stage current <deckId> [--json]');
}
