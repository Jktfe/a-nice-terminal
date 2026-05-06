// macOS LaunchAgent plist writer for `antchat watch`.
//
// We hand-roll the XML rather than pull in plist-format-* — the structure is
// dead-simple and the binary stays small. The plist is written to
// ~/Library/LaunchAgents/<label>.plist and loaded with
// `launchctl bootstrap gui/<uid>` (newer) or `launchctl load -w` (10.10+).
// Both surface here so callers can pick whichever works on their host.

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir, userInfo } from 'os';
import { join, dirname } from 'path';
import { execFile } from 'child_process';

const DEFAULT_LABEL = 'com.jktfe.antchat.watch';

export interface PlistOptions {
  label?: string;
  // Absolute path to the antchat binary launchd should spawn.
  binaryPath: string;
  // Args after the binary (typically ['watch', 'run']).
  args: string[];
  // Optional environment variables to inject (e.g. ANT_SERVER, ANT_API_KEY).
  env?: Record<string, string>;
  // Where to write stdout/stderr — defaults to ~/Library/Logs/antchat-watch-*.log.
  stdoutPath?: string;
  stderrPath?: string;
  // Auto-start on login? Default true (the user opted-in by running install).
  runAtLoad?: boolean;
  // Restart on crash? Default true.
  keepAlive?: boolean;
}

export function plistPath(label: string = DEFAULT_LABEL): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function defaultLabel(): string {
  return DEFAULT_LABEL;
}

// Whitelist of safe characters for inline values; anything else gets entity-
// encoded so a label / path with `&` or `<` can't break the plist.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function programArgsXml(binary: string, args: string[]): string {
  const items = [binary, ...args]
    .map((s) => `        <string>${xmlEscape(s)}</string>`)
    .join('\n');
  return `      <key>ProgramArguments</key>\n      <array>\n${items}\n      </array>`;
}

function envXml(env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return '';
  const entries = Object.entries(env)
    .map(([k, v]) => `        <key>${xmlEscape(k)}</key>\n        <string>${xmlEscape(v)}</string>`)
    .join('\n');
  return `      <key>EnvironmentVariables</key>\n      <dict>\n${entries}\n      </dict>\n`;
}

export function buildPlist(opts: PlistOptions): string {
  const label = opts.label ?? DEFAULT_LABEL;
  const stdoutPath = opts.stdoutPath ?? join(homedir(), 'Library', 'Logs', `${label}.out.log`);
  const stderrPath = opts.stderrPath ?? join(homedir(), 'Library', 'Logs', `${label}.err.log`);
  const runAtLoad = opts.runAtLoad ?? true;
  const keepAlive = opts.keepAlive ?? true;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    `      <key>Label</key>`,
    `      <string>${xmlEscape(label)}</string>`,
    programArgsXml(opts.binaryPath, opts.args),
    envXml(opts.env),
    `      <key>RunAtLoad</key>`,
    `      <${runAtLoad}/>`,
    `      <key>KeepAlive</key>`,
    `      <${keepAlive}/>`,
    `      <key>StandardOutPath</key>`,
    `      <string>${xmlEscape(stdoutPath)}</string>`,
    `      <key>StandardErrorPath</key>`,
    `      <string>${xmlEscape(stderrPath)}</string>`,
    '  </dict>',
    '</plist>',
    '',
  ].filter(Boolean).join('\n');
}

export function writePlist(opts: PlistOptions, path: string = plistPath(opts.label)): string {
  const xml = buildPlist(opts);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, xml, 'utf8');
  return path;
}

export function removePlist(label: string = DEFAULT_LABEL): boolean {
  const path = plistPath(label);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

interface LaunchctlResult {
  cmd: string;
  ok: boolean;
  stderr: string;
}

function runLaunchctl(args: string[]): Promise<LaunchctlResult> {
  return new Promise((resolve) => {
    execFile('launchctl', args, { timeout: 8000 }, (err, _stdout, stderr) => {
      resolve({
        cmd: `launchctl ${args.join(' ')}`,
        ok: !err,
        stderr: stderr || (err ? err.message : ''),
      });
    });
  });
}

/**
 * Bootstrap the agent into the current GUI session. Tries the modern
 * `bootstrap gui/<uid>` form first, falling back to `load -w` on older macOS.
 * Returns the list of attempted commands so the caller can surface failures.
 */
export async function loadAgent(label: string = DEFAULT_LABEL): Promise<LaunchctlResult[]> {
  const path = plistPath(label);
  const uid = userInfo().uid;
  const attempts: LaunchctlResult[] = [];
  const a = await runLaunchctl(['bootstrap', `gui/${uid}`, path]);
  attempts.push(a);
  if (!a.ok) {
    const b = await runLaunchctl(['load', '-w', path]);
    attempts.push(b);
  }
  return attempts;
}

export async function unloadAgent(label: string = DEFAULT_LABEL): Promise<LaunchctlResult[]> {
  const path = plistPath(label);
  const uid = userInfo().uid;
  const attempts: LaunchctlResult[] = [];
  const a = await runLaunchctl(['bootout', `gui/${uid}/${label}`]);
  attempts.push(a);
  if (!a.ok) {
    const b = await runLaunchctl(['unload', '-w', path]);
    attempts.push(b);
  }
  return attempts;
}
