// ANT — Spec Diff
// File: src/fingerprint/spec-diff.ts
//
// Compares two spec.json objects field-by-field and produces a human-readable
// diff report. Used by `--diff` to surface changes between probe runs.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiffEntry {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  kind: 'added' | 'removed' | 'changed';
}

export interface SpecDiffReport {
  agent: string;
  oldVersion: string;
  newVersion: string;
  diffs: DiffEntry[];
  summary: string;
}

import { readFileSync } from 'fs';

// ─── Diff logic ───────────────────────────────────────────────────────────────

/**
 * Deep diff two plain objects, returning a flat list of path-annotated changes.
 * Ignores probe_date (always changes on re-run).
 */
export function diffSpecs(
  oldSpec: Record<string, unknown>,
  newSpec: Record<string, unknown>,
  pathPrefix = '',
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const IGNORED_KEYS = new Set(['probe_date']);

  const allKeys = new Set([...Object.keys(oldSpec), ...Object.keys(newSpec)]);

  for (const key of allKeys) {
    if (IGNORED_KEYS.has(key)) continue;

    const path  = pathPrefix ? `${pathPrefix}.${key}` : key;
    const oldV  = oldSpec[key];
    const newV  = newSpec[key];

    if (!(key in oldSpec)) {
      diffs.push({ path, oldValue: undefined, newValue: newV, kind: 'added' });
      continue;
    }
    if (!(key in newSpec)) {
      diffs.push({ path, oldValue: oldV, newValue: undefined, kind: 'removed' });
      continue;
    }

    if (isPlainObject(oldV) && isPlainObject(newV)) {
      diffs.push(...diffSpecs(
        oldV as Record<string, unknown>,
        newV as Record<string, unknown>,
        path,
      ));
    } else if (Array.isArray(oldV) && Array.isArray(newV)) {
      // For arrays (events list), diff by index
      const len = Math.max(oldV.length, newV.length);
      for (let i = 0; i < len; i++) {
        const oldEl = oldV[i];
        const newEl = newV[i];
        const elPath = `${path}[${i}]`;
        if (oldEl === undefined) {
          diffs.push({ path: elPath, oldValue: undefined, newValue: newEl, kind: 'added' });
        } else if (newEl === undefined) {
          diffs.push({ path: elPath, oldValue: oldEl, newValue: undefined, kind: 'removed' });
        } else if (isPlainObject(oldEl) && isPlainObject(newEl)) {
          diffs.push(...diffSpecs(
            oldEl as Record<string, unknown>,
            newEl as Record<string, unknown>,
            elPath,
          ));
        } else if (JSON.stringify(oldEl) !== JSON.stringify(newEl)) {
          diffs.push({ path: elPath, oldValue: oldEl, newValue: newEl, kind: 'changed' });
        }
      }
    } else if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
      diffs.push({ path, oldValue: oldV, newValue: newV, kind: 'changed' });
    }
  }

  return diffs;
}

/**
 * Load two spec.json files from disk and produce a SpecDiffReport.
 */
export function buildDiffReport(
  agent: string,
  oldSpecPath: string,
  newSpecPath: string,
): SpecDiffReport {
  const oldSpec = JSON.parse(readFileSync(oldSpecPath, 'utf8')) as Record<string, unknown>;
  const newSpec = JSON.parse(readFileSync(newSpecPath, 'utf8')) as Record<string, unknown>;

  const diffs = diffSpecs(oldSpec, newSpec);
  const oldVersion = String(oldSpec.version_tested ?? 'unknown');
  const newVersion = String(newSpec.version_tested ?? 'unknown');

  const summary = diffs.length === 0
    ? `No changes between ${oldVersion} and ${newVersion}`
    : `${diffs.length} change(s) between ${oldVersion} → ${newVersion}`;

  return { agent, oldVersion, newVersion, diffs, summary };
}

/**
 * Format a SpecDiffReport as a human-readable string.
 */
export function formatDiffReport(report: SpecDiffReport): string {
  const lines: string[] = [
    `── Spec diff: ${report.agent} ──────────────────────────────`,
    `   ${report.oldVersion} → ${report.newVersion}`,
    '',
  ];

  if (report.diffs.length === 0) {
    lines.push('   No changes detected.');
    return lines.join('\n');
  }

  for (const d of report.diffs) {
    const icon = d.kind === 'added' ? '+ ' : d.kind === 'removed' ? '- ' : '~ ';
    const old_ = d.kind !== 'added' ? `\n       was: ${JSON.stringify(d.oldValue)}` : '';
    const new_ = d.kind !== 'removed' ? `\n       now: ${JSON.stringify(d.newValue)}` : '';
    lines.push(`  ${icon}${d.path}${old_}${new_}`);
  }

  lines.push('');
  lines.push(`  ${report.diffs.length} change(s) total`);
  return lines.join('\n');
}

/**
 * Produce a version-staleness report comparing detected vs spec version.
 */
export function formatVersionReport(results: Array<{
  agent: string;
  detected: string | null;
  specVersion: string | null;
  stale: boolean;
}>): string {
  const lines = ['── Version check ────────────────────────────────────────', ''];
  const padName = Math.max(...results.map(r => r.agent.length), 12);

  for (const r of results) {
    const name = r.agent.padEnd(padName);
    const detected = r.detected ?? '(unknown)';
    const spec     = r.specVersion ?? '(no spec)';
    const flag     = r.stale ? ' ⚠  STALE — re-probe recommended' : '';
    lines.push(`  ${name}  detected: ${detected.padEnd(10)}  spec: ${spec}${flag}`);
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
