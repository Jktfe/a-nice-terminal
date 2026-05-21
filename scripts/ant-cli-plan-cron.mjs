const BOOLEAN_FLAGS = new Set(['include-deleted', 'json', 'start']);
const LIFECYCLE_ACTIONS = new Set(['start', 'pause', 'stop', 'delete']);

export async function handlePlanCronVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  switch (action) {
    case 'list':
      return runList(args, runtime, CliInputError);
    case 'create':
      return runCreate(args, runtime, CliInputError);
    case 'show':
      return runShow(args, runtime, CliInputError);
    case 'start':
    case 'pause':
    case 'stop':
    case 'delete':
      return runLifecycle(action, args, runtime, CliInputError);
    case undefined:
    case 'help':
    case '--help':
      writeUsage(runtime);
      return action ? 0 : 1;
    default:
      writeUsage(runtime);
      throw new CliInputError(`unknown plan cron verb: ${action}`);
  }
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

function writeUsage(runtime) {
  runtime.writeOut('ant plan cron <list|create|show|start|pause|stop|delete>');
  runtime.writeOut('');
  runtime.writeOut('  list [--include-deleted] [--json]');
  runtime.writeOut('  create --name NAME --every-minutes N [--room ROOM_ID] [--message TEXT]');
  runtime.writeOut('         [--action room.message|console.log|webhook.post|task.create]');
  runtime.writeOut('         [--created-by @handle] [--start] [--json]');
  runtime.writeOut('  show <jobId> [--json]');
  runtime.writeOut('  start|pause|stop|delete <jobId> [--json]');
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function requireJobId(positionals, verb, CliInputError) {
  const jobId = positionals[0];
  if (!jobId) throw new CliInputError(`plan cron ${verb} needs a job id`);
  return jobId;
}

function parseIntervalMs(flags, CliInputError) {
  if (flags['interval-ms'] !== undefined) {
    const intervalMs = Number(flags['interval-ms']);
    if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
      throw new CliInputError('--interval-ms must be a number >= 1000');
    }
    return intervalMs;
  }
  const everyMinutesRaw = requireFlag(flags, 'every-minutes', CliInputError);
  const everyMinutes = Number(everyMinutesRaw);
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    throw new CliInputError('--every-minutes must be a positive number');
  }
  return Math.round(everyMinutes * 60_000);
}

function formatInterval(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function renderJob(job) {
  return [
    job.id ?? '?',
    job.status ?? '?',
    formatInterval(job.intervalMs),
    job.action ?? '?',
    job.name ?? '(unnamed)'
  ].join('\t');
}

async function readJsonResponse(response, context) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${context} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function runList(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const params = new URLSearchParams();
  if (flags['include-deleted'] !== undefined) params.set('includeDeleted', 'true');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await readJsonResponse(
    await runtime.fetchImpl(`${runtime.serverUrl}/api/cron-jobs${suffix}`),
    'GET /api/cron-jobs'
  );
  const jobs = payload.jobs ?? [];
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  if (jobs.length === 0) {
    runtime.writeOut('No cron jobs.');
    return 0;
  }
  for (const job of jobs) runtime.writeOut(renderJob(job));
  return 0;
}

async function runCreate(args, runtime, CliInputError) {
  const { flags } = parseFlags(args, CliInputError);
  const name = requireFlag(flags, 'name', CliInputError);
  const intervalMs = parseIntervalMs(flags, CliInputError);
  const action = flags.action ?? (flags.message || flags.room ? 'room.message' : 'console.log');
  const body = {
    name,
    intervalMs,
    action,
    startImmediately: flags.start !== undefined
  };
  if (flags.room !== undefined) body.targetRoomId = flags.room;
  if (flags.message !== undefined) body.targetMessageTemplate = flags.message;
  if (flags['created-by'] !== undefined) body.createdByHandle = flags['created-by'];
  const payload = await readJsonResponse(
    await runtime.fetchImpl(`${runtime.serverUrl}/api/cron-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    'POST /api/cron-jobs'
  );
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(renderJob(payload.job ?? {}));
  return 0;
}

async function runShow(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  const jobId = requireJobId(positionals, 'show', CliInputError);
  const payload = await readJsonResponse(
    await runtime.fetchImpl(`${runtime.serverUrl}/api/cron-jobs/${encodeURIComponent(jobId)}`),
    `GET /api/cron-jobs/${jobId}`
  );
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(renderJob(payload.job ?? {}));
  return 0;
}

async function runLifecycle(action, args, runtime, CliInputError) {
  if (!LIFECYCLE_ACTIONS.has(action)) {
    throw new CliInputError(`unsupported cron lifecycle action: ${action}`);
  }
  const { flags, positionals } = parseFlags(args, CliInputError);
  const jobId = requireJobId(positionals, action, CliInputError);
  const payload = await readJsonResponse(
    await runtime.fetchImpl(`${runtime.serverUrl}/api/cron-jobs/${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action })
    }),
    `PATCH /api/cron-jobs/${jobId}`
  );
  if (flags.json !== undefined) runtime.writeOut(JSON.stringify(payload));
  else runtime.writeOut(renderJob(payload.job ?? {}));
  return 0;
}
