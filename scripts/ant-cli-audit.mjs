/**
 * ant audit — per-room permissions audit surface (M3.1a) + PR-D tools
 * catalog audit subverbs (plan milestone pr-d-tools-catalog of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Subverbs:
 *   permissions   v1 reads room_memberships → terminals via
 *                 /api/chat-rooms/:roomId/audit. Pre-PR-D.
 *   tools         PR-D — list every active tool with grant counts.
 *                 Filters: --org NAME, --include-retired.
 *   grants        PR-D — list every active grant. Filters: --agent H,
 *                 --tool SLUG, --scope SCOPE_KIND.
 *   revocations   PR-D — revocations since --since DURATION (default 7d).
 *                 Filters: --org NAME.
 *   orphans       PR-D — two-section report: orphan grants (active grants
 *                 pointing at retired tools — the nifty-leak case JWPK
 *                 surfaced msg_6gq9zczigb) + orphan tools (active tools
 *                 with zero active grants).
 *
 * Tools/grants/orphans/revocations call the server-side audit endpoint
 * (/api/tools/audit) so the renderer stays pure. permissions stays on the
 * per-room /audit endpoint it already used pre-PR-D.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'include-retired']);

export async function handleAuditVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  if (action === 'permissions') return runPermissions(flags, runtime, CliInputError);
  if (action === 'tools') return runAuditTools(flags, runtime);
  if (action === 'grants') return runAuditGrants(flags, runtime);
  if (action === 'revocations') return runAuditRevocations(flags, runtime, CliInputError);
  if (action === 'orphans') return runAuditOrphans(flags, runtime);
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown audit verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
}

async function fetchJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function runPermissions(flags, runtime, CliInputError) {
  const room = requireFlag(flags, 'room', CliInputError);
  // Room-scoped GET — hooks.server.ts gateChatRoomReadApi requires the
  // caller to thread pidChain (or admin-bearer). Local fetchJson doesn't
  // auto-add identity, so the sender appends it explicitly. Same shape
  // as @speedycodex chat-pending fix (24fba92) and PR #61 rooms members.
  const query = new URLSearchParams({ pidChain: JSON.stringify(processIdentityChain()) });
  const path = `/api/chat-rooms/${encodeURIComponent(room)}/audit?${query.toString()}`;
  const payload = await fetchJson(runtime, path);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const members = payload.members ?? [];
  if (members.length === 0) {
    runtime.writeOut(`(no members in room ${payload.roomId})`);
    return 0;
  }
  for (const m of members) {
    const terminalPrefix = (m.terminal_id ?? '').slice(0, 8);
    const name = m.terminal_name ?? '(no-name)';
    const joinedAgo = formatRelative(m.joined_at);
    runtime.writeOut(`${m.handle}\t${terminalPrefix}\t${name}\t(joined ${joinedAgo})`);
  }
  return 0;
}

async function runAuditTools(flags, runtime) {
  const params = new URLSearchParams();
  params.set('audit', 'tools');
  if (flags.org) params.set('owner_org', flags.org);
  if (flags['include-retired'] === 'true') params.set('includeRetired', '1');
  const payload = await fetchJson(runtime, `/api/tools/audit?${params.toString()}`);
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  if (tools.length === 0) {
    runtime.writeOut('(no tools)');
    return 0;
  }
  runtime.writeOut('slug\tkind\tversion\towner_org\tmin_tier\tgrants\tstatus');
  for (const t of tools) {
    const status = t.retiredAtMs
      ? 'retired'
      : t.deprecatedAtMs
        ? 'deprecated'
        : 'active';
    runtime.writeOut(
      `${t.toolSlug}\t${t.kind}\t${t.version ?? '-'}\t${t.ownerOrg ?? '-'}\t${t.minTier}\t${t.grantCount ?? 0}\t${status}`
    );
  }
  return 0;
}

async function runAuditGrants(flags, runtime) {
  const params = new URLSearchParams();
  params.set('audit', 'grants');
  if (flags.agent) params.set('agent', flags.agent);
  if (flags.tool) params.set('tool', flags.tool);
  if (flags.scope) params.set('scope_kind', flags.scope);
  const payload = await fetchJson(runtime, `/api/tools/audit?${params.toString()}`);
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const grants = Array.isArray(payload?.grants) ? payload.grants : [];
  if (grants.length === 0) {
    runtime.writeOut('(no grants)');
    return 0;
  }
  runtime.writeOut('grant_id\tgrantee\ttool_slug\tscope_kind\tscope_id\tgranted_by\tgranted_at\texpires_at\treason');
  for (const g of grants) {
    runtime.writeOut(
      [
        g.grantId,
        g.granteeHandle,
        g.toolSlug ?? '-',
        g.scopeKind,
        g.scopeId ?? '-',
        g.grantedByHandle,
        formatIsoMs(g.grantedAtMs),
        g.expiresAtMs ? formatIsoMs(g.expiresAtMs) : '-',
        g.reason ?? '-'
      ].join('\t')
    );
  }
  return 0;
}

function parseDuration(text, CliInputError) {
  const match = text.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new CliInputError(`--since must be DURATION (e.g. 7d, 24h, 30m); got "${text}"`);
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multiplier =
    unit === 's' ? 1000
    : unit === 'm' ? 60_000
    : unit === 'h' ? 3_600_000
    : 86_400_000;
  return n * multiplier;
}

async function runAuditRevocations(flags, runtime, CliInputError) {
  const sinceText = flags.since ?? '7d';
  const sinceMs = parseDuration(sinceText, CliInputError);
  const params = new URLSearchParams();
  params.set('audit', 'revocations');
  params.set('since_ms', String(sinceMs));
  if (flags.org) params.set('owner_org', flags.org);
  const payload = await fetchJson(runtime, `/api/tools/audit?${params.toString()}`);
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const revocations = Array.isArray(payload?.revocations) ? payload.revocations : [];
  if (revocations.length === 0) {
    runtime.writeOut(`(no revocations in last ${sinceText})`);
    return 0;
  }
  runtime.writeOut(`Revocations in last ${sinceText}:`);
  runtime.writeOut('grant_id\tgrantee\ttool_slug\tscope_kind\tscope_id\trevoked_at\tgranted_at');
  for (const r of revocations) {
    runtime.writeOut(
      [
        r.grantId,
        r.granteeHandle,
        r.toolSlug ?? '-',
        r.scopeKind,
        r.scopeId ?? '-',
        formatIsoMs(r.revokedAtMs),
        formatIsoMs(r.grantedAtMs)
      ].join('\t')
    );
  }
  return 0;
}

async function runAuditOrphans(flags, runtime) {
  const params = new URLSearchParams();
  params.set('audit', 'orphans');
  const payload = await fetchJson(runtime, `/api/tools/audit?${params.toString()}`);
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const orphanGrants = Array.isArray(payload?.orphanGrants) ? payload.orphanGrants : [];
  const orphanTools = Array.isArray(payload?.orphanTools) ? payload.orphanTools : [];
  runtime.writeOut('=== Orphan grants (active grants pointing at retired tools) ===');
  if (orphanGrants.length === 0) {
    runtime.writeOut('(none)');
  } else {
    for (const g of orphanGrants) {
      runtime.writeOut(
        `${g.granteeHandle}\t${g.toolSlug ?? '(unknown)'}\tgrant_id=${g.grantId}\tgranted_by=${g.grantedByHandle}`
      );
    }
  }
  runtime.writeOut('');
  runtime.writeOut('=== Orphan tools (active tools with zero active grants) ===');
  if (orphanTools.length === 0) {
    runtime.writeOut('(none)');
  } else {
    for (const t of orphanTools) {
      runtime.writeOut(
        `${t.toolSlug}\t${t.kind}\t${t.version ?? '-'}\t${t.ownerOrg ?? '-'}\tadded ${formatIsoMs(t.addedAtMs)}`
      );
    }
  }
  return 0;
}

function formatIsoMs(ms) {
  if (typeof ms !== 'number') return '-';
  return new Date(ms).toISOString();
}

function formatRelative(unixSeconds) {
  if (typeof unixSeconds !== 'number') return 'unknown';
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function writeUsage(runtime) {
  runtime.writeOut('ant audit permissions --room ROOM_ID [--json]');
  runtime.writeOut('ant audit tools [--org NAME] [--include-retired] [--json]');
  runtime.writeOut('ant audit grants [--agent HANDLE] [--tool SLUG] [--scope SCOPE_KIND] [--json]');
  runtime.writeOut('ant audit revocations [--org NAME] [--since DURATION] [--json]');
  runtime.writeOut('ant audit orphans [--json]');
}
