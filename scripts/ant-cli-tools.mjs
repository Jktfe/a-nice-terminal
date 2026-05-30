/**
 * ant-cli-tools — PR-D tools catalog CLI verbs (plan milestones
 * pr-d-tools-catalog + pr-d2-import-skills of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Closes JWPK's "nifty-leak" case (msg_mjh7rgi3wa + msg_6gq9zczigb): a
 * deleted skill stayed referenced because there was no canonical
 * catalog to query. This verb is the catalog's CRUD + the one-shot
 * filesystem-to-DB migration.
 *
 * Subverbs:
 *   ant tools register --slug X --kind skill --name "Y" [--version V]
 *                      [--source-path P] [--owner-org O] [--min-tier T]
 *                      [--metadata JSON]
 *   ant tools deprecate --slug X [--reason R]
 *   ant tools retire --slug X [--reason R]
 *   ant tools list [--kind K] [--owner-org O] [--include-retired]
 *   ant tools grant --agent H --tool X [--scope-kind K --scope-id I]
 *                   [--expires-at-ms MS] [--reason R]
 *   ant tools revoke --agent H --tool X [--scope-kind K --scope-id I]
 *   ant tools import-skills --dry-run|--commit [--source-path PATH]
 *
 * Auth: admin-bearer via --admin-token or ANT_ADMIN_TOKEN env. The
 * write surface (register/deprecate/retire/grant/revoke/import-skills)
 * requires it; the read surface (list) does not.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VALID_KINDS = ['skill', 'mcp', 'cli-verb', 'hook', 'plugin', 'bridge'];
const VALID_MIN_TIERS = ['oss', 'premium', 'internal'];
const VALID_SCOPE_KINDS = ['global', 'org', 'room', 'session'];

const BOOLEAN_FLAGS = new Set(['include-retired', 'dry-run', 'commit', 'json']);

export async function handleToolsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === undefined || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'register':
      return runRegister(flags, runtime, CliInputError);
    case 'deprecate':
      return runDeprecate(flags, runtime, CliInputError);
    case 'retire':
      return runRetire(flags, runtime, CliInputError);
    case 'list':
      return runList(flags, runtime, CliInputError);
    case 'grant':
      return runGrant(flags, runtime, CliInputError);
    case 'revoke':
      return runRevoke(flags, runtime, CliInputError);
    case 'import-skills':
      return runImportSkills(flags, runtime, CliInputError);
    default:
      throw new CliInputError(`unknown tools verb: ${action}`);
  }
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
      throw new CliInputError(`expected --flag, got "${token}"`);
    }
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
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

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    throw new CliInputError(`missing required flag --${name}`);
  }
  return value;
}

function resolveAdminToken(flags) {
  return flags['admin-token'] ?? process.env.ANT_ADMIN_TOKEN ?? '';
}

function authHeaders(flags) {
  const token = resolveAdminToken(flags);
  const headers = { 'content-type': 'application/json' };
  if (token.length > 0) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function postJson(runtime, path, body, flags) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'POST',
    headers: authHeaders(flags),
    body: JSON.stringify(body)
  });
  return response;
}

async function deleteJson(runtime, path, body, flags) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'DELETE',
    headers: authHeaders(flags),
    body: JSON.stringify(body)
  });
  return response;
}

async function getJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  return response;
}

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function runRegister(flags, runtime, CliInputError) {
  const slug = requireFlag(flags, 'slug', CliInputError);
  const kind = requireFlag(flags, 'kind', CliInputError);
  if (!VALID_KINDS.includes(kind)) {
    throw new CliInputError(`--kind must be one of: ${VALID_KINDS.join(', ')}`);
  }
  const name = requireFlag(flags, 'name', CliInputError);
  const body = { toolSlug: slug, kind, name };
  if (flags.version) body.version = flags.version;
  if (flags['source-path']) body.sourcePath = flags['source-path'];
  if (flags['owner-org']) body.ownerOrg = flags['owner-org'];
  if (flags['min-tier']) {
    if (!VALID_MIN_TIERS.includes(flags['min-tier'])) {
      throw new CliInputError(`--min-tier must be one of: ${VALID_MIN_TIERS.join(', ')}`);
    }
    body.minTier = flags['min-tier'];
  }
  if (flags.metadata) {
    try {
      body.metadata = JSON.parse(flags.metadata);
    } catch {
      throw new CliInputError('--metadata must be a JSON object');
    }
  }
  const response = await postJson(runtime, '/api/tools', body, flags);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools register failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const out = await readResponseBody(response);
  const toolId = out?.tool?.toolId ?? '?';
  runtime.writeOut(`Registered ${slug} (${kind}) tool_id=${toolId}.`);
  return 0;
}

async function findToolBySlugViaServer(runtime, slug) {
  const response = await getJson(runtime, `/api/tools?includeRetired=1`);
  if (!response.ok) return null;
  const body = await readResponseBody(response);
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  // Prefer the most recent active row for the slug; fall back to any row.
  const active = tools.find((t) => t.toolSlug === slug && t.retiredAtMs === null);
  if (active) return active;
  return tools.find((t) => t.toolSlug === slug) ?? null;
}

async function runDeprecate(flags, runtime, CliInputError) {
  const slug = requireFlag(flags, 'slug', CliInputError);
  const tool = await findToolBySlugViaServer(runtime, slug);
  if (!tool) {
    runtime.writeErr(`ant tools deprecate: no tool with slug "${slug}"`);
    return 1;
  }
  const response = await postJson(
    runtime,
    `/api/tools/${encodeURIComponent(tool.toolId)}/deprecate`,
    {},
    flags
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools deprecate failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  runtime.writeOut(`Deprecated ${slug} (tool_id=${tool.toolId}).`);
  return 0;
}

async function runRetire(flags, runtime, CliInputError) {
  const slug = requireFlag(flags, 'slug', CliInputError);
  const tool = await findToolBySlugViaServer(runtime, slug);
  if (!tool) {
    runtime.writeErr(`ant tools retire: no tool with slug "${slug}"`);
    return 1;
  }
  const response = await runtime.fetchImpl(
    `${runtime.serverUrl}/api/tools/${encodeURIComponent(tool.toolId)}`,
    { method: 'DELETE', headers: authHeaders(flags) }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools retire failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  runtime.writeOut(`Retired ${slug} (tool_id=${tool.toolId}).`);
  return 0;
}

async function runList(flags, runtime) {
  const params = new URLSearchParams();
  if (flags.kind) params.set('kind', flags.kind);
  if (flags['owner-org']) params.set('owner_org', flags['owner-org']);
  if (flags['include-retired'] === 'true') params.set('includeRetired', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await getJson(runtime, `/api/tools${query}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools list failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const body = await readResponseBody(response);
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  if (flags.json === 'true') {
    runtime.writeOut(JSON.stringify(tools));
    return 0;
  }
  if (tools.length === 0) {
    runtime.writeOut('(no tools)');
    return 0;
  }
  for (const t of tools) {
    const marker = t.retiredAtMs ? ' [retired]' : t.deprecatedAtMs ? ' [deprecated]' : '';
    runtime.writeOut(
      `${t.toolSlug}\t${t.kind}\t${t.version ?? '-'}\t${t.ownerOrg ?? '-'}\t${t.minTier}${marker}`
    );
  }
  return 0;
}

async function runGrant(flags, runtime, CliInputError) {
  const agent = requireFlag(flags, 'agent', CliInputError);
  const slug = requireFlag(flags, 'tool', CliInputError);
  const tool = await findToolBySlugViaServer(runtime, slug);
  if (!tool) {
    runtime.writeErr(`ant tools grant: no tool with slug "${slug}"`);
    return 1;
  }
  const scopeKind = flags['scope-kind'] ?? 'global';
  if (!VALID_SCOPE_KINDS.includes(scopeKind)) {
    throw new CliInputError(`--scope-kind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  const body = { granteeHandle: agent, toolId: tool.toolId, scopeKind };
  if (flags['scope-id']) body.scopeId = flags['scope-id'];
  if (flags['expires-at-ms']) {
    const n = Number(flags['expires-at-ms']);
    if (!Number.isFinite(n) || n <= 0) {
      throw new CliInputError('--expires-at-ms must be a positive number');
    }
    body.expiresAtMs = n;
  }
  if (flags.reason) body.reason = flags.reason;
  const response = await postJson(runtime, '/api/tool-grants', body, flags);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools grant failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const out = await readResponseBody(response);
  const grantId = out?.grant?.grantId ?? '?';
  runtime.writeOut(`Granted ${agent} -> ${slug} (grant_id=${grantId}).`);
  return 0;
}

async function runRevoke(flags, runtime, CliInputError) {
  const agent = requireFlag(flags, 'agent', CliInputError);
  const slug = requireFlag(flags, 'tool', CliInputError);
  const tool = await findToolBySlugViaServer(runtime, slug);
  if (!tool) {
    runtime.writeErr(`ant tools revoke: no tool with slug "${slug}"`);
    return 1;
  }
  const scopeKind = flags['scope-kind'] ?? 'global';
  if (!VALID_SCOPE_KINDS.includes(scopeKind)) {
    throw new CliInputError(`--scope-kind must be one of: ${VALID_SCOPE_KINDS.join(', ')}`);
  }
  const body = { granteeHandle: agent, toolId: tool.toolId, scopeKind };
  if (flags['scope-id']) body.scopeId = flags['scope-id'];
  const response = await deleteJson(runtime, '/api/tool-grants', body, flags);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    runtime.writeErr(`ant tools revoke failed (${response.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const out = await readResponseBody(response);
  const count = typeof out?.revokedCount === 'number' ? out.revokedCount : 0;
  runtime.writeOut(`Revoked ${count} grant${count === 1 ? '' : 's'} for ${agent} -> ${slug}.`);
  return 0;
}

/**
 * Parse SKILL.md frontmatter — a YAML-ish block delimited by `---` lines
 * at the top of the file. We deliberately keep the parser tiny (key:
 * "value" or key: value) because skill frontmatter is dialect-narrow.
 */
function parseSkillFrontmatter(text) {
  const trimmed = text.startsWith('﻿') ? text.slice(1) : text;
  if (!trimmed.startsWith('---')) return null;
  const newlineIndex = trimmed.indexOf('\n');
  if (newlineIndex === -1) return null;
  const rest = trimmed.slice(newlineIndex + 1);
  const closeIndex = rest.indexOf('\n---');
  if (closeIndex === -1) return null;
  const block = rest.slice(0, closeIndex);
  const fields = {};
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

function defaultSkillSourcePaths() {
  const paths = [
    join(homedir(), '.claude', 'skills'),
    join(homedir(), 'CascadeProjects', 'a-nice-terminal', '.claude', 'skills')
  ];
  return paths.filter((p) => existsSync(p));
}

/**
 * Scan a skills root for SKILL.md files. Returns an array of
 * { slug, name, description, version, sourcePath } records ready for
 * registration. Subdirectories of the root are treated as one slug
 * each; nested non-skill files are ignored.
 */
function discoverSkillsAt(rootPath, fsImpl = { readdirSync, statSync, readFileSync, existsSync }) {
  const discovered = [];
  let entries;
  try {
    entries = fsImpl.readdirSync(rootPath);
  } catch {
    return discovered;
  }
  for (const entry of entries) {
    const skillDir = join(rootPath, entry);
    let stat;
    try {
      stat = fsImpl.statSync(skillDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!fsImpl.existsSync(skillMdPath)) continue;
    let body;
    try {
      body = fsImpl.readFileSync(skillMdPath, 'utf8');
    } catch {
      continue;
    }
    const front = parseSkillFrontmatter(body);
    if (!front) continue;
    const slug = front.name ?? entry;
    discovered.push({
      slug,
      name: front.name ?? entry,
      description: front.description ?? null,
      version: front.version ?? null,
      sourcePath: skillMdPath
    });
  }
  return discovered;
}

async function runImportSkills(flags, runtime, CliInputError) {
  const dryRun = flags['dry-run'] === 'true';
  const commit = flags.commit === 'true';
  if (dryRun === commit) {
    throw new CliInputError('ant tools import-skills requires exactly one of --dry-run or --commit');
  }
  // Allow the runtime to inject a fake fs for tests.
  const fsImpl = runtime.fsImpl ?? { readdirSync, statSync, readFileSync, existsSync };
  const sourcePaths = flags['source-path']
    ? [flags['source-path']]
    : (runtime.skillSourcePaths ?? defaultSkillSourcePaths());

  if (sourcePaths.length === 0) {
    runtime.writeOut('(no skills directories found — pass --source-path PATH)');
    return 0;
  }

  const discovered = [];
  for (const root of sourcePaths) {
    for (const skill of discoverSkillsAt(root, fsImpl)) {
      discovered.push(skill);
    }
  }

  if (discovered.length === 0) {
    runtime.writeOut('(no SKILL.md files found)');
    return 0;
  }

  if (dryRun) {
    runtime.writeOut(`Would register ${discovered.length} skill${discovered.length === 1 ? '' : 's'}:`);
    for (const s of discovered) {
      runtime.writeOut(`  ${s.slug}\t${s.version ?? '-'}\t${s.sourcePath}`);
    }
    return 0;
  }

  let registered = 0;
  let failed = 0;
  for (const s of discovered) {
    const body = {
      toolSlug: s.slug,
      kind: 'skill',
      name: s.name,
      sourcePath: s.sourcePath
    };
    if (s.description) body.description = s.description;
    if (s.version) body.version = s.version;
    const response = await postJson(runtime, '/api/tools', body, flags);
    if (!response.ok) {
      failed += 1;
      const text = await response.text().catch(() => '');
      runtime.writeErr(`  failed: ${s.slug} (${response.status}): ${text.slice(0, 120)}`);
      continue;
    }
    registered += 1;
  }
  runtime.writeOut(
    `Registered ${registered} skill${registered === 1 ? '' : 's'}; ${failed} failed.`
  );
  return failed === 0 ? 0 : 1;
}

function writeUsage(runtime) {
  runtime.writeOut('ant tools register --slug X --kind skill --name "Y" [--version V] [--source-path P] [--owner-org O] [--min-tier T] [--metadata JSON]');
  runtime.writeOut('ant tools deprecate --slug X');
  runtime.writeOut('ant tools retire --slug X');
  runtime.writeOut('ant tools list [--kind K] [--owner-org O] [--include-retired] [--json]');
  runtime.writeOut('ant tools grant --agent H --tool X [--scope-kind K --scope-id I] [--expires-at-ms MS] [--reason R]');
  runtime.writeOut('ant tools revoke --agent H --tool X [--scope-kind K --scope-id I]');
  runtime.writeOut('ant tools import-skills --dry-run|--commit [--source-path PATH]');
}

// Exposed for unit tests of the frontmatter parser and skill walk.
export const _internals = {
  parseSkillFrontmatter,
  discoverSkillsAt,
  defaultSkillSourcePaths
};
