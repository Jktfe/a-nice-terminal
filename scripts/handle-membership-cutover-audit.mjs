#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const RULES = [
  {
    kind: 'legacy-chat-room-members',
    pattern: /\bchat_room_members\b/
  },
  {
    kind: 'legacy-room-memberships',
    pattern: /\broom_memberships\b/
  },
  {
    kind: 'legacy-v02-memberships',
    pattern: /\bmemberships\b/
  },
  {
    kind: 'operator-sentinel-auth',
    pattern: /\boperatorBypass\b|\bOPERATOR_HANDLE\b|\bOPERATOR_SENTINEL\b/
  },
  {
    kind: 'cli-config-identity-cache',
    pattern: /\bantSessions\.(?:byName|byPane)\b/
  }
];

const DISPLAY_ONLY_PATTERNS = [
  /operatorDisplayHandle\(/,
  /ANT_OPERATOR_DISPLAY_HANDLE/,
  /operator sentinel/i
];

const AUDIT_IMPLEMENTATION_FILES = new Set([
  'scripts/handle-membership-cutover-audit.mjs'
]);

export function scanTextForCutoverFindings(file, text) {
  const normalisedFile = file.replace(/\\/g, '/');
  if (AUDIT_IMPLEMENTATION_FILES.has(normalisedFile)) return [];

  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (DISPLAY_ONLY_PATTERNS.some((pattern) => pattern.test(line))) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          kind: rule.kind,
          text: line.trim()
        });
        break;
      }
    }
  });
  return findings;
}

export function classifyCutoverFindings(findings) {
  const summary = {};
  for (const finding of findings) {
    summary[finding.kind] = (summary[finding.kind] ?? 0) + 1;
  }
  return summary;
}

function trackedSourceFiles() {
  const output = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return output
    .split('\n')
    .filter(Boolean)
    .filter((file) => /^(src|scripts)\//.test(file))
    .filter((file) => /\.(ts|svelte|mjs|js)$/.test(file))
    .filter((file) => !file.endsWith('.test.ts'))
    .filter((file) => !file.endsWith('.test.mjs'));
}

function main() {
  const root = process.cwd();
  const findings = [];
  for (const file of trackedSourceFiles()) {
    const abs = resolve(root, file);
    const text = readFileSync(abs, 'utf8');
    findings.push(...scanTextForCutoverFindings(relative(root, abs), text));
  }

  if (findings.length > 0) {
    console.error('Handle membership cutover blockers remain:');
    for (const finding of findings) {
      console.error(`${finding.kind}\t${finding.file}:${finding.line}\t${finding.text}`);
    }
    console.error(JSON.stringify(classifyCutoverFindings(findings), null, 2));
    process.exit(1);
  }

  console.log('Handle membership cutover audit passed: no legacy blockers found.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
