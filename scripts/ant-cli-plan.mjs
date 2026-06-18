/**
 * ant plan — Plan Mode CLI write verbs.
 *
 * Hooked from scripts/ant-cli.mjs via a tiny dispatch case. Every verb here
 * builds a PlanEvent body and POSTs to /api/plan/:planId per the pm-endpoint
 * baseline. The server injects ts_millis (monotonic per pm-endpoint) so the
 * CLI never sends a timestamp; it just sends the structural fields.
 *
 * Identity-key facts that shape these verbs:
 *   section:plan:slug(title)
 *   milestone:plan:milestone_id
 *   acceptance:plan:milestone_id:acceptance_id
 *   test:plan:milestone_id:slug(title)
 *   decision:plan:parent_id:slug(title)
 *
 * Status flips and archives re-emit the original kind with the same
 * identity-key inputs + a new status. The CLI never asks the user for an
 * event_id — only for the structural keys we already need.
 *
 * Author identity: --author flag or ANT_AUTHOR env var, defaulting to
 * "@ant-cli" for unattended scripts. author_kind defaults to "agent".
 *
 * Read verbs are NOT in this slice (pm-cli-read follow-up).
 */

const PLAN_VERB_USAGE = [
  'ant plan <verb> <planId> [flags...]',
  '  section <planId> --title TEXT [--body TEXT] [--order N] [--parent PARENT_ID]',
  '  decision <planId> --parent PARENT_ID --title TEXT [--body TEXT]',
  '  milestone <planId> --id ID --title TEXT [--owner @x] [--status S] [--body TEXT]',
  '  milestone-status <planId> --id ID --status S',
  '  milestone-archive <planId> --id ID',
  '  acceptance <planId> --milestone ID --id ACCEPTANCE_ID --title TEXT',
  '  test <planId> --milestone ID --title TEXT [--status S]',
  '  test-status <planId> --milestone ID --title TEXT --status S',
  '  test-archive <planId> --milestone ID --title TEXT',
  '  decision-archive <planId> --parent PARENT_ID --title TEXT',
  '  attach-room <planId> <roomId> [--attached-by @h] [--json]',
  '  list [--include-archived] [--json]',
  '  archive <planId> [--unarchive] [--json]',
  '  show <planId> [--include-archived] [--json]',
  '  trigger add <event> <action> [--plan PLAN_ID] [--message TEXT] [--url URL] [--subject TEXT] [--target-plan same|PLAN_ID] [--by @h] [--bearer TOKEN] [--json]',
  '  trigger list [--plan PLAN_ID] [--event EVENT] [--bearer TOKEN] [--json]',
  '  trigger fire <triggerId> [--plan PLAN_ID] [--bearer TOKEN] [--json]',
  '  trigger remove <triggerId> [--bearer TOKEN] [--json]',
  '  cron list|create|start|stop|pause|delete|show [flags...]'
];

export async function handlePlanVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  // `plan list` has NO planId. Special-case before the planId guard.
  if (action === 'list') {
    return runListPlansVerb(parseFlags(args, CliInputError), runtime);
  }
  if (action === 'cron') {
    const { handlePlanCronVerb } = await import('./ant-cli-plan-cron.mjs');
    return handlePlanCronVerb(args[0], args.slice(1), runtime, ctx);
  }
  if (action === 'trigger') {
    return runTriggerVerb(args[0], args.slice(1), runtime, CliInputError);
  }
  const planId = args[0];
  if (!planId || planId.startsWith('--')) {
    throw new CliInputError(`plan ${action ?? ''} needs a planId as the first arg`);
  }
  if (action === 'attach-room') {
    return runAttachRoomVerb(planId, args.slice(1), runtime, CliInputError);
  }
  const flags = parseFlags(args.slice(1), CliInputError);
  switch (action) {
    case 'archive': return runArchivePlanVerb(planId, flags, runtime, CliInputError);
    case 'section': return runSectionVerb(planId, flags, runtime, CliInputError);
    case 'decision': return runDecisionVerb(planId, flags, runtime, CliInputError);
    case 'milestone': return runMilestoneVerb(planId, flags, runtime, CliInputError);
    case 'milestone-status': return runMilestoneStatusVerb(planId, flags, runtime, CliInputError);
    case 'milestone-archive': return runMilestoneArchiveVerb(planId, flags, runtime, CliInputError);
    case 'acceptance': return runAcceptanceVerb(planId, flags, runtime, CliInputError);
    case 'test': return runTestVerb(planId, flags, runtime, CliInputError);
    case 'test-status': return runTestStatusVerb(planId, flags, runtime, CliInputError);
    case 'test-archive': return runTestArchiveVerb(planId, flags, runtime, CliInputError);
    case 'decision-archive': return runDecisionArchiveVerb(planId, flags, runtime, CliInputError);
    case 'show': {
      const { runShowVerb } = await import('./ant-cli-plan-read.mjs');
      return runShowVerb(planId, flags, runtime, CliInputError);
    }
    case undefined:
    case '--help':
    case 'help':
      writeUsage(runtime);
      return action === undefined ? 1 : 0;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown plan verb: ${action}`);
  }
}

const BOOLEAN_FLAG_NAMES = new Set(['include-archived', 'json', 'unarchive']);

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      throw new CliInputError(`expected --flag, got "${token}"`);
    }
    const flagName = token.slice(2);
    if (BOOLEAN_FLAG_NAMES.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function adminBearer(flags) {
  return flags.bearer ?? flags['admin-token'] ?? process.env.ANT_ADMIN_TOKEN ?? process.env.ANT_ADMIN_BEARER ?? null;
}

function adminHeaders(flags, CliInputError) {
  const token = adminBearer(flags);
  if (!token) {
    throw new CliInputError('admin token required: pass --bearer, pass --admin-token, or set ANT_ADMIN_TOKEN');
  }
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

async function requestJson(runtime, path, init = undefined) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.status === 204 ? {} : response.json().catch(() => ({}));
}

function triggerActionConfig(action, flags, CliInputError) {
  if (action === 'room.message') {
    return flags.message ? { messageTemplate: flags.message } : {};
  }
  if (action === 'console.log') {
    return flags.message ? { message: flags.message } : {};
  }
  if (action === 'webhook.post') {
    return {
      url: requireFlag(flags, 'url', CliInputError),
      ...(flags['body-template'] ? { bodyTemplate: flags['body-template'] } : {})
    };
  }
  if (action === 'task.create') {
    const config = {};
    if (flags.subject) config.subject = flags.subject;
    if (flags.description) config.description = flags.description;
    if (flags['target-plan']) config.planId = flags['target-plan'];
    if (flags['assigned-agent']) config.assignedAgent = flags['assigned-agent'];
    if (flags.priority !== undefined) {
      const priority = Number(flags.priority);
      if (!Number.isInteger(priority)) throw new CliInputError('--priority must be an integer');
      config.priority = priority;
    }
    return config;
  }
  throw new CliInputError('action must be room.message|console.log|webhook.post|task.create');
}

async function runTriggerVerb(subaction, rawArgs, runtime, CliInputError) {
  switch (subaction) {
    case 'add': return runTriggerAdd(rawArgs, runtime, CliInputError);
    case 'list': return runTriggerList(rawArgs, runtime, CliInputError);
    case 'fire': return runTriggerFire(rawArgs, runtime, CliInputError);
    case 'remove': return runTriggerRemove(rawArgs, runtime, CliInputError);
    case undefined:
    case '--help':
    case 'help':
      writeUsage(runtime);
      return subaction === undefined ? 1 : 0;
    default:
      throw new CliInputError(`unknown plan trigger verb: ${subaction}`);
  }
}

async function runTriggerAdd(rawArgs, runtime, CliInputError) {
  const event = rawArgs[0];
  const action = rawArgs[1];
  if (!event || event.startsWith('--')) throw new CliInputError('plan trigger add needs an event');
  if (!action || action.startsWith('--')) throw new CliInputError('plan trigger add needs an action');
  const flags = parseFlags(rawArgs.slice(2), CliInputError);
  const body = {
    event,
    action,
    actionConfig: triggerActionConfig(action, flags, CliInputError)
  };
  if (flags.plan !== undefined && flags.plan !== '') body.planId = flags.plan;
  if (flags.by !== undefined && flags.by !== '') body.createdBy = flags.by;
  const payload = await requestJson(runtime, '/api/plan-triggers', {
    method: 'POST',
    headers: adminHeaders(flags, CliInputError),
    body: JSON.stringify(body)
  });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(`Created trigger ${payload.trigger?.id ?? '?'} (${event} -> ${action}).`);
  return 0;
}

async function runTriggerList(rawArgs, runtime, CliInputError) {
  const flags = parseFlags(rawArgs, CliInputError);
  const query = new URLSearchParams();
  if (flags.plan !== undefined) query.set('planId', flags.plan);
  if (flags.event !== undefined) query.set('event', flags.event);
  const qs = query.toString();
  const token = adminBearer(flags);
  const payload = await requestJson(
    runtime,
    `/api/plan-triggers${qs ? `?${qs}` : ''}`,
    token ? { headers: { authorization: `Bearer ${token}` } } : undefined
  );
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const triggers = payload.triggers ?? [];
  if (triggers.length === 0) {
    runtime.writeOut('No triggers.');
    return 0;
  }
  for (const trigger of triggers) {
    runtime.writeOut(`${trigger.id}\t${trigger.event}\t${trigger.action}\t${trigger.planId ?? 'wildcard'}`);
  }
  return 0;
}

async function runTriggerFire(rawArgs, runtime, CliInputError) {
  const triggerId = rawArgs[0];
  if (!triggerId || triggerId.startsWith('--')) throw new CliInputError('plan trigger fire needs a triggerId');
  const flags = parseFlags(rawArgs.slice(1), CliInputError);
  const body = flags.plan ? { planId: flags.plan } : {};
  const payload = await requestJson(runtime, `/api/plan-triggers/${encodeURIComponent(triggerId)}/fire`, {
    method: 'POST',
    headers: adminHeaders(flags, CliInputError),
    body: JSON.stringify(body)
  });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(`Fired trigger ${payload.triggerId ?? triggerId} for ${payload.planId ?? 'its plan'}.`);
  return 0;
}

async function runTriggerRemove(rawArgs, runtime, CliInputError) {
  const triggerId = rawArgs[0];
  if (!triggerId || triggerId.startsWith('--')) throw new CliInputError('plan trigger remove needs a triggerId');
  const flags = parseFlags(rawArgs.slice(1), CliInputError);
  const payload = await requestJson(runtime, `/api/plan-triggers/${encodeURIComponent(triggerId)}`, {
    method: 'DELETE',
    headers: adminHeaders(flags, CliInputError)
  });
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(`Removed trigger ${triggerId}.`);
  return 0;
}

function writeUsage(runtime) {
  for (const line of PLAN_VERB_USAGE) {
    runtime.writeOut(line);
  }
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function defaultAuthorHandle() {
  return process.env.ANT_AUTHOR ?? '@ant-cli';
}

function makeEventId(planId) {
  const random = Math.random().toString(36).slice(2, 8);
  return `evt-${planId}-${Date.now()}-${random}`;
}

function makeOrder(flags) {
  if (flags.order === undefined) return 0;
  const parsed = Number(flags.order);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function baseEventBody(planId, flags) {
  return {
    id: makeEventId(planId),
    plan_id: planId,
    author_handle: flags.author ?? defaultAuthorHandle(),
    author_kind: 'agent',
    order: makeOrder(flags)
  };
}

async function postPlanEvent(runtime, planId, body) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/plan/${encodeURIComponent(planId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`POST /api/plan/${planId} returned ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const parsed = await response.json();
  runtime.writeOut(`${parsed.event.id}\t${parsed.event.kind}${parsed.event.status ? '\t' + parsed.event.status : ''}`);
  return 0;
}

async function runSectionVerb(planId, flags, runtime, CliInputError) {
  const title = requireFlag(flags, 'title', CliInputError);
  return postPlanEvent(runtime, planId, {
    ...baseEventBody(planId, flags),
    kind: 'plan_section',
    title,
    body: flags.body,
    parent_id: flags.parent
  });
}

async function runDecisionVerb(planId, flags, runtime, CliInputError) {
  const parent = requireFlag(flags, 'parent', CliInputError);
  const title = requireFlag(flags, 'title', CliInputError);
  return postPlanEvent(runtime, planId, {
    ...baseEventBody(planId, flags),
    kind: 'plan_decision',
    title,
    body: flags.body,
    parent_id: parent
  });
}

function milestoneBody(planId, flags, statusOverride, CliInputError) {
  const milestoneId = requireFlag(flags, 'id', CliInputError);
  const title = flags.title ?? milestoneId;
  return {
    ...baseEventBody(planId, flags),
    kind: 'plan_milestone',
    title,
    milestone_id: milestoneId,
    owner: flags.owner,
    body: flags.body,
    status: statusOverride ?? flags.status
  };
}

async function runMilestoneVerb(planId, flags, runtime, CliInputError) {
  requireFlag(flags, 'title', CliInputError);
  return postPlanEvent(runtime, planId, milestoneBody(planId, flags, undefined, CliInputError));
}

async function runMilestoneStatusVerb(planId, flags, runtime, CliInputError) {
  const status = requireFlag(flags, 'status', CliInputError);
  return postPlanEvent(runtime, planId, milestoneBody(planId, flags, status, CliInputError));
}

async function runMilestoneArchiveVerb(planId, flags, runtime, CliInputError) {
  return postPlanEvent(runtime, planId, milestoneBody(planId, flags, 'archived', CliInputError));
}

async function runAcceptanceVerb(planId, flags, runtime, CliInputError) {
  const milestone = requireFlag(flags, 'milestone', CliInputError);
  const acceptanceId = requireFlag(flags, 'id', CliInputError);
  const title = requireFlag(flags, 'title', CliInputError);
  return postPlanEvent(runtime, planId, {
    ...baseEventBody(planId, flags),
    kind: 'plan_acceptance',
    title,
    milestone_id: milestone,
    acceptance_id: acceptanceId,
    body: flags.body
  });
}

function testBody(planId, flags, statusOverride, CliInputError) {
  const milestone = requireFlag(flags, 'milestone', CliInputError);
  const title = requireFlag(flags, 'title', CliInputError);
  return {
    ...baseEventBody(planId, flags),
    kind: 'plan_test',
    title,
    milestone_id: milestone,
    status: statusOverride ?? flags.status
  };
}

async function runTestVerb(planId, flags, runtime, CliInputError) {
  return postPlanEvent(runtime, planId, testBody(planId, flags, undefined, CliInputError));
}

async function runTestStatusVerb(planId, flags, runtime, CliInputError) {
  const status = requireFlag(flags, 'status', CliInputError);
  return postPlanEvent(runtime, planId, testBody(planId, flags, status, CliInputError));
}

async function runTestArchiveVerb(planId, flags, runtime, CliInputError) {
  return postPlanEvent(runtime, planId, testBody(planId, flags, 'archived', CliInputError));
}

async function runDecisionArchiveVerb(planId, flags, runtime, CliInputError) {
  const parent = requireFlag(flags, 'parent', CliInputError);
  const title = requireFlag(flags, 'title', CliInputError);
  return postPlanEvent(runtime, planId, {
    ...baseEventBody(planId, flags),
    kind: 'plan_decision',
    title,
    parent_id: parent,
    status: 'archived'
  });
}

/**
 * `ant plan list [--include-archived] [--json]`
 * Lists every plan. Default hides archived plans.
 * GET /api/plans[?include-archived=1]
 */
async function runListPlansVerb(flags, runtime) {
  const qs = flags['include-archived'] !== undefined ? '?include-archived=1' : '';
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/plans${qs}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  const plans = payload.plans ?? [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (plans.length === 0) {
    runtime.writeOut('No plans.');
    return 0;
  }
  for (const p of plans) {
    const archivedTag = p.archived_at_ms ? ' (archived)' : '';
    runtime.writeOut(`${p.id}\t${p.title ?? '(untitled)'}${archivedTag}`);
  }
  return 0;
}

/**
 * `ant plan archive <planId> [--unarchive]`
 * Archives (or unarchives) a plan. PATCH /api/plans/:planId with
 * { action: 'archive' | 'unarchive' }. Admin-auth required (the route
 * uses requireAdminAuth — caller may need ANT_ADMIN_BEARER env var).
 */
async function runArchivePlanVerb(planId, flags, runtime, CliInputError) {
  const action = flags.unarchive !== undefined ? 'unarchive' : 'archive';
  const headers = { 'content-type': 'application/json' };
  if (process.env.ANT_ADMIN_BEARER) {
    headers.authorization = `Bearer ${process.env.ANT_ADMIN_BEARER}`;
  }
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/plans/${encodeURIComponent(planId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ action })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else {
    runtime.writeOut(`Plan ${planId} ${action}d.`);
  }
  return 0;
}

async function runAttachRoomVerb(planId, rawArgs, runtime, CliInputError) {
  const roomId = rawArgs[0];
  if (!roomId || roomId.startsWith('--')) {
    throw new CliInputError('plan attach-room needs a roomId as the second arg');
  }
  const flags = parseFlags(rawArgs.slice(1), CliInputError);
  const headers = { 'content-type': 'application/json' };
  const adminToken = process.env.ANT_ADMIN_TOKEN ?? process.env.ANT_ADMIN_BEARER;
  if (adminToken) {
    headers.authorization = `Bearer ${adminToken}`;
  }
  const body = { roomId };
  if (flags['attached-by'] !== undefined) body.attachedBy = flags['attached-by'];
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/plans/${encodeURIComponent(planId)}/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
  } else if (payload.alreadyAttached) {
    runtime.writeOut(`Plan ${planId} already attached to room ${roomId}.`);
  } else {
    runtime.writeOut(`Attached plan ${planId} to room ${roomId}.`);
  }
  return 0;
}
