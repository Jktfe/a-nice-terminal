/**
 * ant hooks — install / uninstall / status of Claude Code hook bridge
 * to ANT's /api/cli-hook receiver (CLI-HOOK-BRIDGE Phase 1B, 2026-05-15).
 *
 * Verbs:
 *   ant hooks install     write our hook block into ~/.claude/settings.json
 *   ant hooks uninstall   remove our hook entries (identified by URL marker)
 *   ant hooks status      show which events are wired, which aren't
 *
 * Identification: our hook entries are those whose `command` contains the
 * ANT hook marker. Anything else in the user's settings.json is preserved
 * untouched.
 *
 * Settings file path can be overridden via env ANT_HOOKS_SETTINGS_PATH
 * for tests + non-default Claude Code installs.
 *
 * 9-year-old-readable. No network calls — this is a local file operation.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:6174';
const HOOK_COMMAND_MARKER = 'ant hooks receiver-url';
const DEFAULT_TIMEOUT_MS = 5000;
const BOOLEAN_FLAGS = new Set(['json', 'bare']);

// The 8 events we install by default — the high-signal subset of Claude
// Code's 27 hook events for ANT observability. The user can edit the
// settings.json directly to add more.
const DEFAULT_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PreCompact',
  'PostCompact'
];

function resolveSettingsPath() {
  if (process.env.ANT_HOOKS_SETTINGS_PATH) return process.env.ANT_HOOKS_SETTINGS_PATH;
  return join(homedir(), '.claude', 'settings.json');
}

function receiverFromServerUrl(serverUrl) {
  return `${String(serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')}/api/cli-hook`;
}

function resolveReceiverUrl(runtime) {
  return process.env.ANT_HOOKS_RECEIVER_URL
    ?? (process.env.ANT_SERVER_URL ? receiverFromServerUrl(process.env.ANT_SERVER_URL) : null)
    ?? receiverFromServerUrl(runtime?.serverUrl);
}

function buildCurlCommand() {
  return [
    'sh -lc',
    shellQuote([
      'receiver="${ANT_HOOKS_RECEIVER_URL:-}"',
      'if [ -z "$receiver" ] && command -v ant >/dev/null 2>&1; then receiver="$(ant hooks receiver-url --bare 2>/dev/null || true)"; fi',
      'if [ -z "$receiver" ]; then server="${ANT_SERVER_URL:-http://127.0.0.1:6174}"; receiver="${server%/}/api/cli-hook"; fi',
      // Session capture (JWPK reboot-survival, 2026-06-10): enrich the hook
      // stdin JSON with the pane's ANT session id so /api/cli-hook can resolve
      // which ANT terminal the event belongs to on EVERY event (the raw Claude
      // payload only carries Claude's own session UUID). Best-effort: no
      // $ANT_SESSION_ID or no jq → post the raw payload exactly as before.
      'payload="$(cat)"',
      `if [ -n "\${ANT_SESSION_ID:-}" ] && command -v jq >/dev/null 2>&1; then enriched="$(printf %s "$payload" | jq -c --arg a "$ANT_SESSION_ID" '. + {ant_session_id: $a}' 2>/dev/null)" && [ -n "$enriched" ] && payload="$enriched"; fi`,
      'printf %s "$payload" | curl -s -X POST "$receiver?source=claude-code" -H "content-type: application/json" -d @- > /dev/null'
    ].join('; '))
  ].join(' ');
}

function isOurHookEntry(hookEntry, receiverUrl) {
  if (!hookEntry || typeof hookEntry !== 'object') return false;
  if (hookEntry.type !== 'command') return false;
  const command = hookEntry.command;
  return typeof command === 'string' && (
    command.includes(HOOK_COMMAND_MARKER) ||
    command.includes(receiverUrl)
  );
}

async function loadSettings(settingsPath) {
  if (!existsSync(settingsPath)) return { __present: false, data: {} };
  const raw = await readFile(settingsPath, 'utf8');
  if (raw.trim().length === 0) return { __present: true, data: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`settings.json at ${settingsPath} is not a JSON object`);
    }
    return { __present: true, data: parsed };
  } catch (cause) {
    throw new Error(`Could not parse ${settingsPath}: ${cause.message}`);
  }
}

async function saveSettings(settingsPath, data) {
  await mkdir(dirname(settingsPath), { recursive: true });
  const serialised = JSON.stringify(data, null, 2) + '\n';
  await writeFile(settingsPath, serialised, 'utf8');
}

function ensureHooksObject(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  return settings.hooks;
}

function addOurHookToEvent(hooksObject, eventName, receiverUrl) {
  if (!Array.isArray(hooksObject[eventName])) hooksObject[eventName] = [];
  const matchers = hooksObject[eventName];
  // Find a matcher block we can append to (any one without a `matcher`
  // field is the "matches everything" catch-all). If none exists, push
  // a new catch-all matcher block.
  let matcherBlock = matchers.find((entry) => entry && typeof entry === 'object' && entry.matcher === undefined);
  if (!matcherBlock) {
    matcherBlock = { hooks: [] };
    matchers.push(matcherBlock);
  }
  if (!Array.isArray(matcherBlock.hooks)) matcherBlock.hooks = [];

  // If our hook is already present, do nothing (idempotent).
  const alreadyPresent = matcherBlock.hooks.some((h) => isOurHookEntry(h, receiverUrl));
  if (alreadyPresent) return false;

  matcherBlock.hooks.push({
    type: 'command',
    command: buildCurlCommand(),
    timeout: DEFAULT_TIMEOUT_MS
  });
  return true;
}

function removeOurHooksFromEvent(hooksObject, eventName, receiverUrl) {
  if (!Array.isArray(hooksObject[eventName])) return 0;
  let removedCount = 0;
  for (const matcherBlock of hooksObject[eventName]) {
    if (!matcherBlock || typeof matcherBlock !== 'object') continue;
    if (!Array.isArray(matcherBlock.hooks)) continue;
    const before = matcherBlock.hooks.length;
    matcherBlock.hooks = matcherBlock.hooks.filter((h) => !isOurHookEntry(h, receiverUrl));
    removedCount += before - matcherBlock.hooks.length;
  }
  // Clean up matcher blocks whose hooks array is now empty.
  hooksObject[eventName] = hooksObject[eventName].filter((mb) => {
    if (!mb || typeof mb !== 'object') return true;
    if (!Array.isArray(mb.hooks)) return true;
    return mb.hooks.length > 0;
  });
  if (hooksObject[eventName].length === 0) delete hooksObject[eventName];
  return removedCount;
}

function countOurInstalledEvents(hooksObject, receiverUrl) {
  const installed = [];
  if (!hooksObject || typeof hooksObject !== 'object') return installed;
  for (const eventName of Object.keys(hooksObject)) {
    const matchers = hooksObject[eventName];
    if (!Array.isArray(matchers)) continue;
    const hasOurs = matchers.some((mb) =>
      mb && Array.isArray(mb.hooks) && mb.hooks.some((h) => isOurHookEntry(h, receiverUrl))
    );
    if (hasOurs) installed.push(eventName);
  }
  return installed;
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) {
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
  runtime.writeOut('ant hooks <install|uninstall|status|receiver-url|doctor> [--events <a,b,c>] [--json]');
  runtime.writeOut('');
  runtime.writeOut('  install     wire Claude Code hooks → ANT receiver (idempotent)');
  runtime.writeOut('  uninstall   remove only the hooks ANT installed');
  runtime.writeOut('  status      show which events are currently wired');
  runtime.writeOut('  receiver-url print the currently resolved receiver URL for hook scripts');
  runtime.writeOut('  doctor      scan all CLI hook dirs for hardcoded URLs / stale ports / template drift');
  runtime.writeOut('');
  runtime.writeOut(`  default events: ${DEFAULT_EVENTS.join(', ')}`);
  runtime.writeOut(`  settings file: ${resolveSettingsPath()}`);
  runtime.writeOut(`  receiver URL:  ${resolveReceiverUrl()}`);
}

function eventsFromFlag(flags, CliInputError) {
  if (!flags.events) return DEFAULT_EVENTS;
  const names = flags.events.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (names.length === 0) throw new CliInputError('--events list cannot be empty');
  return names;
}

function writeJsonOrText(runtime, flags, payload, textLines) {
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return;
  }
  for (const line of textLines) runtime.writeOut(line);
}

async function runInstall(flags, runtime, CliInputError) {
  const settingsPath = resolveSettingsPath();
  const receiverUrl = resolveReceiverUrl(runtime);
  const events = eventsFromFlag(flags, CliInputError);

  const loaded = await loadSettings(settingsPath);
  const settings = loaded.data;
  const hooksObject = ensureHooksObject(settings);

  const addedEvents = [];
  const skippedEvents = [];
  for (const eventName of events) {
    const added = addOurHookToEvent(hooksObject, eventName, receiverUrl);
    if (added) addedEvents.push(eventName);
    else skippedEvents.push(eventName);
  }

  await saveSettings(settingsPath, settings);

  writeJsonOrText(
    runtime,
    flags,
    { settingsPath, receiverUrl, added: addedEvents, alreadyInstalled: skippedEvents },
    [
      `Wrote ${settingsPath}`,
      `Receiver: ${receiverUrl}`,
      addedEvents.length > 0
        ? `Added hooks for: ${addedEvents.join(', ')}`
        : 'No new hooks added (all already installed)',
      ...(skippedEvents.length > 0 ? [`Already present: ${skippedEvents.join(', ')}`] : [])
    ]
  );
  return 0;
}

async function runUninstall(flags, runtime) {
  const settingsPath = resolveSettingsPath();
  const receiverUrl = resolveReceiverUrl(runtime);

  const loaded = await loadSettings(settingsPath);
  if (!loaded.__present) {
    writeJsonOrText(
      runtime,
      flags,
      { settingsPath, receiverUrl, removed: [], message: 'settings.json not found' },
      [`No settings.json at ${settingsPath} — nothing to uninstall`]
    );
    return 0;
  }
  const settings = loaded.data;
  const hooksObject = ensureHooksObject(settings);

  const removedFrom = [];
  for (const eventName of Object.keys(hooksObject)) {
    const removedCount = removeOurHooksFromEvent(hooksObject, eventName, receiverUrl);
    if (removedCount > 0) removedFrom.push({ event: eventName, count: removedCount });
  }
  // Clean up empty `hooks` object so we don't leave debris.
  if (Object.keys(hooksObject).length === 0) delete settings.hooks;

  await saveSettings(settingsPath, settings);

  writeJsonOrText(
    runtime,
    flags,
    { settingsPath, receiverUrl, removed: removedFrom },
    [
      `Wrote ${settingsPath}`,
      removedFrom.length > 0
        ? `Removed hooks from: ${removedFrom.map((r) => `${r.event} (${r.count})`).join(', ')}`
        : 'No ANT hooks found in settings.json'
    ]
  );
  return 0;
}

async function runStatus(flags, runtime) {
  const settingsPath = resolveSettingsPath();
  const receiverUrl = resolveReceiverUrl(runtime);

  const loaded = await loadSettings(settingsPath);
  const hooksObject = loaded.data?.hooks ?? {};
  const installed = countOurInstalledEvents(hooksObject, receiverUrl);
  const missing = DEFAULT_EVENTS.filter((e) => !installed.includes(e));

  writeJsonOrText(
    runtime,
    flags,
    {
      settingsPath,
      receiverUrl,
      settingsFilePresent: loaded.__present,
      installedEvents: installed,
      missingDefaultEvents: missing
    },
    [
      `Settings file: ${settingsPath}${loaded.__present ? '' : ' (not present)'}`,
      `Receiver: ${receiverUrl}`,
      installed.length > 0
        ? `ANT hooks installed for: ${installed.join(', ')}`
        : 'No ANT hooks installed',
      ...(missing.length > 0 ? [`Default events not yet installed: ${missing.join(', ')}`] : [])
    ]
  );
  return 0;
}

async function runReceiverUrl(flags, runtime) {
  const receiverUrl = resolveReceiverUrl(runtime);
  if (flags.bare !== undefined) runtime.writeOut(receiverUrl);
  else writeJsonOrText(runtime, flags, { receiverUrl }, [`Receiver: ${receiverUrl}`]);
  return 0;
}

/**
 * `ant hooks doctor` — pre-launch health check across all known CLI
 * hook directories. Read-only diagnostic; reports issues without
 * mutating disk. Lifts the rubric from
 * docs/audits/hardcoded-ports-2026-05-19.md + the gold-standard deck
 * (slide 5 § fallback safety) into a one-command run that operators
 * can use to validate their install before going live.
 *
 * Checks:
 *   - Each ~/.{claude,codex,gemini,qwen,pi,copilot}/hooks/ directory:
 *     does it exist? how many scripts?
 *   - For each shell script: hardcoded URLs (https://anything) without
 *     an env-var fallback. Hardcoded `:6457` v3 port defaults that
 *     should now point at `${ANT_SERVER_URL}` or `:6174`.
 *   - Template-parity: does the ant-board.sh + poll-ant-chat.sh on
 *     disk match the canonical template in scripts/ant-hooks-templates/?
 *     (If not, operator's install is stale + needs a re-deploy.)
 *
 * Exit codes:
 *   0 — clean (no findings)
 *   1 — findings present (review the report)
 *   2 — error reading something (transient / permissions)
 */
async function runDoctor(flags, runtime, CliInputError) {
  void CliInputError;
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { homedir } = await import('node:os');

  const CLI_DIRS = ['claude', 'codex', 'gemini', 'qwen', 'pi', 'copilot'];
  const findings = [];
  let scanned = 0;
  let errors = 0;

  for (const cli of CLI_DIRS) {
    const hooksDir = join(homedir(), `.${cli}`, 'hooks');
    let entries;
    try {
      entries = await readdir(hooksDir);
    } catch {
      findings.push({ cli, level: 'info', kind: 'no-hooks-dir', detail: `no ${hooksDir}` });
      continue;
    }
    const scripts = entries.filter((n) => n.endsWith('.sh'));
    for (const name of scripts) {
      const path = join(hooksDir, name);
      let content;
      try {
        content = await readFile(path, 'utf8');
        scanned += 1;
      } catch (cause) {
        errors += 1;
        findings.push({
          cli, level: 'warn', kind: 'read-error', file: path,
          detail: cause instanceof Error ? cause.message : String(cause)
        });
        continue;
      }
      // Stale v3 port default — env-overridable but defaults to 6457
      const v3DefaultMatches = content.match(/HOOK_SERVER_PORT:-6457/g);
      if (v3DefaultMatches) {
        findings.push({
          cli, level: 'medium', kind: 'stale-default-port', file: path,
          detail: `${v3DefaultMatches.length} occurrence(s) of \`:6457\` default (v3); v4 OSS is :6174 or env-driven via ANT_SERVER_URL`
        });
      }
      // Hardcoded production URL without env-fallback (the anthost pattern)
      // Looking for SERVER=" + literal-URL with NO ${ANT_SERVER_URL or ${...:-...} envelope
      const hardcodedUrl = /^\s*SERVER=["'](https?:\/\/[^"'$]+)["']/m;
      const m = hardcodedUrl.exec(content);
      if (m && !content.includes('${ANT_SERVER_URL')) {
        findings.push({
          cli, level: 'high', kind: 'hardcoded-url', file: path,
          detail: `\`${m[1]}\` pinned with no env-override; operator can't redirect to their own ANT instance`
        });
      }
    }
  }

  // Template-parity check: does our shipped template differ from the
  // on-disk script? (Only checks claude + codex since those are the
  // template-deploy targets per scripts/ant-hooks-templates/.)
  const templatesDir = resolve(new URL('.', import.meta.url).pathname, 'ant-hooks-templates');
  for (const templateName of ['ant-board.sh', 'poll-ant-chat.sh']) {
    let templateContent;
    try {
      templateContent = await readFile(join(templatesDir, templateName), 'utf8');
    } catch { continue; }
    for (const cli of ['claude', 'codex']) {
      const installedPath = join(homedir(), `.${cli}`, 'hooks', templateName);
      try {
        const installedContent = await readFile(installedPath, 'utf8');
        if (installedContent.trim() !== templateContent.trim()) {
          findings.push({
            cli, level: 'low', kind: 'template-drift', file: installedPath,
            detail: `on-disk ${templateName} differs from canonical scripts/ant-hooks-templates/${templateName}; consider re-deploy`
          });
        }
      } catch {
        // Not installed; skip (the user may be opt-in)
      }
    }
  }

  const counts = {
    high: findings.filter((f) => f.level === 'high').length,
    medium: findings.filter((f) => f.level === 'medium').length,
    low: findings.filter((f) => f.level === 'low').length,
    info: findings.filter((f) => f.level === 'info').length,
    warn: findings.filter((f) => f.level === 'warn').length
  };

  const lines = [
    `ant hooks doctor — scanned ${scanned} hook script(s) across ${CLI_DIRS.length} CLI dot-folders`,
    `  🚨 high:   ${counts.high}`,
    `  ⚠️ medium: ${counts.medium}`,
    `  🟡 low:    ${counts.low}`,
    `  ℹ️ info:   ${counts.info}`,
    `  ⚙️ warn:   ${counts.warn} (read errors)`,
    ''
  ];
  for (const f of findings) {
    const icon = f.level === 'high' ? '🚨' : f.level === 'medium' ? '⚠️' : f.level === 'low' ? '🟡' : f.level === 'warn' ? '⚙️' : 'ℹ️';
    lines.push(`  ${icon} [${f.cli}] ${f.kind}${f.file ? ` (${f.file})` : ''}: ${f.detail}`);
  }
  if (findings.length === 0) lines.push('  ✅ clean — no findings');

  writeJsonOrText(runtime, flags, { scanned, errors, counts, findings }, lines);
  if (errors > 0) return 2;
  if (counts.high > 0 || counts.medium > 0) return 1;
  return 0;
}

export async function handleHooksVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  switch (action) {
    case 'install': return runInstall(flags, runtime, CliInputError);
    case 'uninstall': return runUninstall(flags, runtime);
    case 'status': return runStatus(flags, runtime);
    case 'receiver-url': return runReceiverUrl(flags, runtime);
    case 'doctor': return runDoctor(flags, runtime, CliInputError);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown hooks verb: ${action}`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
