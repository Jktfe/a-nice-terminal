#!/usr/bin/env node
/**
 * check-v3-bias — guard active agent-side config from drifting back to
 * v3/default-transition ports.
 *
 * Scans only active defaults, not historical backups or logs, and never
 * prints token values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const ACTIVE_FILES = [
  join(process.env.HOME ?? '', '.ant/config.json'),
  join(REPO_ROOT, '.env'),
  join(REPO_ROOT, 'scripts/ant-cli.mjs'),
  join(REPO_ROOT, 'scripts/seed-ant-vnext-plan-mode-build.mjs')
];

const FORBIDDEN = [
  ':6458',
  'localhost:6460',
  '127.0.0.1:6460',
  'localhost:6461',
  '127.0.0.1:6461'
];

function redactLine(line) {
  return line.replace(/(token|secret|key|password|bearer)([^\\n]*)/ig, '$1=[REDACTED]');
}

export function scanActiveConfig({ files = ACTIVE_FILES } = {}) {
  const findings = [];
  for (const file of files) {
    if (!file || !existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split(/\\r?\\n/);
    lines.forEach((line, index) => {
      for (const needle of FORBIDDEN) {
        if (line.includes(needle)) {
          findings.push({
            file,
            line: index + 1,
            needle,
            preview: redactLine(line.trim())
          });
        }
      }
    });
  }
  return findings;
}

export function runV3BiasCheck({ writeOut = console.log, files } = {}) {
  const findings = scanActiveConfig({ files });
  if (findings.length === 0) {
    writeOut('V3-BIAS OK — active config defaults target v4 :6174.');
    return { ok: true, findings };
  }
  for (const f of findings) {
    writeOut(`${f.file}:${f.line}: ${f.needle} :: ${f.preview}`);
  }
  return { ok: false, findings };
}

const isEntry = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const result = runV3BiasCheck();
  process.exit(result.ok ? 0 : 1);
}
