#!/usr/bin/env node
/**
 * OSS-readiness pre-flight audit.
 *
 * Read-only scan over the working tree + full git history. Produces a
 * markdown report suitable for JWPK review. Drives the choice between
 * aggressive squash (any historical leak found) vs surgical filter-repo
 * (history clean enough to preserve) for the Phase 4 history-wipe.
 *
 * Coordinated in lz0udiayuh as part of the ant → a-nice-terminal
 * migration plan (msg_jv0518n1w2 green-light). Runs AFTER claude+codex's
 * docs/research-to-obsidian move so the audit signal isn't drowned in
 * internal coordination noise that's already on its way out.
 *
 * USAGE
 *   node scripts/oss-audit.mjs [--output PATH] [--no-history]
 *
 * OUTPUT
 *   Default: ${OBSIDIANT_AUDITS_DIR:-../ObsidiANT/audits}/YYYY-MM-DD-pre-oss-audit.md
 *   Override with --output or set OBSIDIANT_AUDITS_DIR env var.
 *
 * DEPENDENCIES (script reports missing + bails with install hints)
 *   - gitleaks  (`brew install gitleaks`)
 *   - trufflehog (`brew install trufflesecurity/trufflehog/trufflehog`)
 *   Both are widely-used scanners — running both catches different
 *   secret families. Either alone misses some leak shapes.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO_DATE = new Date().toISOString().slice(0, 10);
const OBSIDIANT_AUDITS_DIR = process.env.OBSIDIANT_AUDITS_DIR
  ?? resolve(REPO_ROOT, '..', 'ObsidiANT', 'audits');
const DEFAULT_OUTPUT = `${OBSIDIANT_AUDITS_DIR}/${ISO_DATE}-pre-oss-audit.md`;

const args = parseArgs(process.argv.slice(2));
const outputPath = args.output ?? DEFAULT_OUTPUT;
const scanHistory = !args.noHistory;

// PERSONAL-INFO patterns from JWPK's CLAUDE.md banked memory.
// Broader email-domain catch-all is included so any colleague email leaks
// surface too, not just JWPK's own addresses.
const PERSONAL_PATTERNS = [
  { label: 'JWPK personal email', re: /j\.w\.p\.king@gmail\.com/g },
  { label: 'JWPK work email', re: /james@newmodel\.vc/g },
  { label: 'newmodel.vc domain (colleagues)', re: /@newmodel\.vc/g },
  { label: 'JWPK personal phone', re: /REDACTED-PHONE/g },
  { label: 'JWPK work phone', re: /REDACTED-PHONE/g },
  { label: 'Full legal name', re: /James William Peter King/g }
];

// HARDCODED-INFRASTRUCTURE patterns — anything that anchors the repo to
// JWPK's specific machine + would break on a stranger's clone.
const INFRA_PATTERNS = [
  { label: 'Absolute /Users/jamesking path', re: /\/Users\/jamesking/g },
  { label: 'Hardcoded localhost:6174', re: /localhost:6174/g },
  { label: 'Hardcoded localhost:6458', re: /localhost:6458/g },
  { label: 'Hardcoded localhost:6461', re: /localhost:6461/g },
  { label: 'Hardcoded 127.0.0.1', re: /127\.0\.0\.1/g }
];

function parseArgs(argv) {
  const out = { output: undefined, noHistory: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output' && i + 1 < argv.length) {
      out.output = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--no-history') {
      out.noHistory = true;
    }
  }
  return out;
}

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function runCapturing(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: REPO_ROOT, ...opts });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function checkTooling() {
  const tools = ['gitleaks', 'trufflehog', 'git', 'grep'];
  const status = {};
  for (const t of tools) status[t] = which(t);
  const missing = Object.entries(status).filter(([, p]) => p === null).map(([n]) => n);
  return { status, missing };
}

function workingTreeGrep(pattern, label) {
  // grep -rIn excludes binaries (-I), recurses (-r), shows line numbers (-n).
  // --exclude-dir matches important skips for noise control.
  const r = runCapturing('grep', [
    '-rInE',
    '--exclude-dir=.git',
    '--exclude-dir=node_modules',
    '--exclude-dir=.svelte-kit',
    '--exclude-dir=build',
    '--exclude-dir=dist',
    '--exclude-dir=.ant-runtime',
    pattern,
    '.'
  ]);
  const lines = r.stdout.split('\n').filter((line) => line.length > 0);
  return { label, pattern, hitCount: lines.length, hits: lines.slice(0, 50) };
}

function historyGrep(pattern, label) {
  // `git log -p -S<term>` shows commits that ADDED or REMOVED the term.
  // -S is "pickaxe" matching — finds the commit that introduced (or
  // removed) the string. Combine with --all to walk every ref.
  const r = runCapturing('git', ['log', '--all', '-p', `-S${pattern}`, '--pretty=format:%H %s']);
  const summary = r.stdout
    .split('\n')
    .filter((line) => /^[0-9a-f]{40}\s/.test(line))
    .map((line) => line.trim());
  return { label, pattern, commitsAddingOrRemoving: summary };
}

function runGitleaks() {
  const out = runCapturing('gitleaks', [
    'detect',
    '--no-banner',
    '--source', '.',
    '--report-format', 'json',
    '--report-path', '/tmp/gitleaks-oss-audit.json',
    '--exit-code', '0'
  ]);
  let findings = [];
  try {
    const text = spawnSync('cat', ['/tmp/gitleaks-oss-audit.json'], { encoding: 'utf8' }).stdout;
    findings = JSON.parse(text);
  } catch {
    findings = [];
  }
  return { stderr: out.stderr.slice(0, 2000), findings };
}

function runTrufflehog() {
  // Local repo scan. --json one finding per line. --no-update so it
  // doesn't try to self-update mid-audit.
  const out = runCapturing('trufflehog', [
    'git',
    `file://${REPO_ROOT}`,
    '--json',
    '--no-update',
    '--no-verification'
  ]);
  const findings = out.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((f) => f !== null);
  return { stderr: out.stderr.slice(0, 2000), findings };
}

function formatReport(input) {
  const lines = [];
  lines.push(`# OSS-readiness pre-flight audit — ${ISO_DATE}`);
  lines.push('');
  lines.push('Generated by `scripts/oss-audit.mjs`. Read-only scan of the working tree + git history.');
  lines.push('');
  lines.push('## Tooling status');
  lines.push('');
  for (const [tool, path] of Object.entries(input.tooling.status)) {
    lines.push(`- \`${tool}\`: ${path ?? '**NOT FOUND** — install via brew before relying on this section'}`);
  }
  lines.push('');
  if (input.tooling.missing.length > 0) {
    lines.push('> ⚠ Missing tools mean the corresponding sections below were skipped or partial.');
    lines.push('> Install hints: `brew install gitleaks`, `brew install trufflesecurity/trufflehog/trufflehog`.');
    lines.push('');
  }

  lines.push('## Section 1 — Personal-information leaks (working tree)');
  lines.push('');
  for (const r of input.workingTreePersonal) {
    lines.push(`### ${r.label} — \`${r.pattern}\``);
    lines.push(`Hits: **${r.hitCount}**${r.hitCount > r.hits.length ? ` (showing first ${r.hits.length})` : ''}`);
    if (r.hits.length > 0) {
      lines.push('```');
      for (const h of r.hits) lines.push(h);
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## Section 2 — Hardcoded infrastructure (working tree)');
  lines.push('');
  for (const r of input.workingTreeInfra) {
    lines.push(`### ${r.label} — \`${r.pattern}\``);
    lines.push(`Hits: **${r.hitCount}**${r.hitCount > r.hits.length ? ` (showing first ${r.hits.length})` : ''}`);
    if (r.hits.length > 0) {
      lines.push('```');
      for (const h of r.hits) lines.push(h);
      lines.push('```');
    }
    lines.push('');
  }

  if (input.history) {
    lines.push('## Section 3 — Historical leaks (git log -S pickaxe)');
    lines.push('');
    lines.push('Each block lists commits that added OR removed the pattern across `--all` refs.');
    lines.push('A commit that REMOVED a string still leaks it — content is preserved in the parent commit.');
    lines.push('');
    for (const r of input.history) {
      lines.push(`### ${r.label} — \`${r.pattern}\``);
      lines.push(`Commits touching this pattern: **${r.commitsAddingOrRemoving.length}**`);
      if (r.commitsAddingOrRemoving.length > 0) {
        lines.push('```');
        for (const c of r.commitsAddingOrRemoving.slice(0, 30)) lines.push(c);
        if (r.commitsAddingOrRemoving.length > 30) {
          lines.push(`... + ${r.commitsAddingOrRemoving.length - 30} more`);
        }
        lines.push('```');
      }
      lines.push('');
    }
  }

  if (input.gitleaks) {
    lines.push('## Section 4 — gitleaks scan');
    lines.push('');
    lines.push(`Findings: **${input.gitleaks.findings.length}**`);
    if (input.gitleaks.findings.length > 0) {
      lines.push('');
      lines.push('| Rule | File | Line | Description |');
      lines.push('|---|---|---|---|');
      for (const f of input.gitleaks.findings.slice(0, 100)) {
        const rule = (f.RuleID ?? f.ruleID ?? '?').toString();
        const file = (f.File ?? f.file ?? '?').toString();
        const line = (f.StartLine ?? f.line ?? '?').toString();
        const desc = (f.Description ?? f.description ?? '').toString().slice(0, 80).replaceAll('|', '\\|');
        lines.push(`| \`${rule}\` | \`${file}\` | ${line} | ${desc} |`);
      }
    }
    lines.push('');
    if (input.gitleaks.stderr.length > 0) {
      lines.push('<details><summary>gitleaks stderr</summary>');
      lines.push('');
      lines.push('```');
      lines.push(input.gitleaks.stderr);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  if (input.trufflehog) {
    lines.push('## Section 5 — trufflehog scan');
    lines.push('');
    lines.push(`Findings: **${input.trufflehog.findings.length}**`);
    if (input.trufflehog.findings.length > 0) {
      lines.push('');
      lines.push('| Detector | Verified | File:Line | Raw (truncated) |');
      lines.push('|---|---|---|---|');
      for (const f of input.trufflehog.findings.slice(0, 100)) {
        const det = (f.DetectorName ?? '?').toString();
        const ver = f.Verified ? 'YES' : 'no';
        const meta = f.SourceMetadata?.Data?.Git ?? {};
        const file = `${meta.file ?? '?'}:${meta.line ?? '?'}`;
        const raw = (f.Raw ?? '').toString().slice(0, 40).replaceAll('|', '\\|');
        lines.push(`| ${det} | ${ver} | \`${file}\` | \`${raw}\` |`);
      }
    }
    lines.push('');
  }

  lines.push('## Phase 4 strategy recommendation');
  lines.push('');
  const anyHistoryHit = (input.history ?? []).some((r) => r.commitsAddingOrRemoving.length > 0);
  const anyHighSeverity =
    (input.gitleaks?.findings.length ?? 0) > 0 ||
    (input.trufflehog?.findings?.some((f) => f.Verified) ?? false);
  if (anyHighSeverity || anyHistoryHit) {
    lines.push('**Aggressive squash recommended.** Verified credential findings or personal-info pickaxe hits exist in history.');
    lines.push('Squash to single `Initial OSS release` commit. Loses blame/bisect; zero residual leak risk.');
    lines.push('Mirror-clone backup to ObsidiANT first per the migration plan.');
  } else {
    lines.push('**Surgical `git filter-repo` viable.** No verified credentials or personal-info pickaxe hits in history.');
    lines.push('Filter out the specific files/strings flagged in Section 1+2, preserve commit graph + blame + bisect.');
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  console.error(`oss-audit: starting against ${REPO_ROOT}`);
  const tooling = checkTooling();
  console.error(`oss-audit: tools available: ${Object.keys(tooling.status).filter((t) => tooling.status[t]).join(', ')}`);
  if (tooling.missing.length > 0) {
    console.error(`oss-audit: tools MISSING: ${tooling.missing.join(', ')} — sections requiring them will be skipped`);
  }

  const workingTreePersonal = PERSONAL_PATTERNS.map((p) => workingTreeGrep(p.re.source, p.label));
  const workingTreeInfra = INFRA_PATTERNS.map((p) => workingTreeGrep(p.re.source, p.label));

  let history = null;
  if (scanHistory) {
    console.error('oss-audit: running git-log pickaxe across all refs (this can take a moment)…');
    const combined = [...PERSONAL_PATTERNS, ...INFRA_PATTERNS];
    history = combined.map((p) => {
      const literal = p.re.source.replace(/\\\./g, '.').replaceAll('\\', '');
      return historyGrep(literal, p.label);
    });
  } else {
    console.error('oss-audit: --no-history set, skipping git-log pickaxe pass');
  }

  let gitleaks = null;
  if (tooling.status.gitleaks) {
    console.error('oss-audit: running gitleaks detect (full history)…');
    gitleaks = runGitleaks();
    console.error(`oss-audit: gitleaks reported ${gitleaks.findings.length} findings`);
  }

  let trufflehog = null;
  if (tooling.status.trufflehog) {
    console.error('oss-audit: running trufflehog git scan…');
    trufflehog = runTrufflehog();
    console.error(`oss-audit: trufflehog reported ${trufflehog.findings.length} findings`);
  }

  const report = formatReport({
    tooling,
    workingTreePersonal,
    workingTreeInfra,
    history,
    gitleaks,
    trufflehog
  });

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, report, 'utf8');
  console.error(`oss-audit: report written to ${outputPath}`);
  console.error(`oss-audit: report length ${report.length} chars`);
}

main();
