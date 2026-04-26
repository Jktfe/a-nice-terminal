import { queries } from './db.js';

const OVERSIZE_BYTES = 20_000;
const TMUX_NOISE_PATTERNS = [
  /\x1b\[/,
  /%output\s+%/,
  /%window-\w+/,
  /%session-\w+/,
  /\{"type":"(?:agent_event|terminal_line|tool_)/,
];

type AuditRow = {
  id: string;
  key: string;
  tags: string | null;
  session_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  value_size: number;
  preview: string | null;
  has_full_transcript: number;
};

type AuditIssue = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  key: string;
  id: string;
  message: string;
  size?: number;
};

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
}

function isArchive(row: AuditRow): boolean {
  const tags = parseTags(row.tags);
  return row.key.startsWith('session:')
    || row.key.startsWith('archive/')
    || tags.includes('archive')
    || tags.includes('archive-only')
    || tags.includes('session-summary');
}

function previewHasNoise(preview: string | null): boolean {
  if (!preview) return false;
  return TMUX_NOISE_PATTERNS.some(pattern => pattern.test(preview));
}

function hasLearnableSignal(preview: string | null): boolean {
  if (!preview) return false;
  return /\b(## Tasks|## File refs|decision|decided|root cause|lesson|learned|remember|protocol|constraint|rule|fix(?:ed)?|bug|regression|architecture|design|endpoint|api|commit|deployed|shipped|working|broken|must|should|need|needs|avoid|prefer|never|always)\b/i.test(preview)
    || /\b[A-Za-z0-9_-]+\.(?:ts|svelte|swift|js|json|md|sql|css)\b/.test(preview)
    || /\b(?:src|docs|cli|scripts|app|lib)\//.test(preview);
}

function classifyRow(row: AuditRow): string {
  if (row.key.startsWith('docs/')) return 'docs';
  if (row.key.startsWith('agents/')) return 'agents';
  if (row.key.startsWith('tasks/')) return 'tasks';
  if (row.key.startsWith('goals/')) return 'goals';
  if (row.key.startsWith('done/')) return 'done';
  if (row.key.startsWith('heartbeat/')) return 'heartbeat';
  if (row.key.startsWith('digest/')) return 'digest';
  if (row.key.startsWith('thinking/')) return 'thinking';
  if (isArchive(row)) return 'archive';
  return 'operational';
}

export function buildMemoryAudit() {
  const rows = queries.listMemoryAuditRows() as AuditRow[];
  const byKey = new Map<string, AuditRow[]>();
  const byClass = new Map<string, number>();
  const issues: AuditIssue[] = [];

  for (const row of rows) {
    const rowsForKey = byKey.get(row.key) ?? [];
    rowsForKey.push(row);
    byKey.set(row.key, rowsForKey);

    const rowClass = classifyRow(row);
    byClass.set(rowClass, (byClass.get(rowClass) ?? 0) + 1);

    if (row.has_full_transcript) {
      issues.push({
        severity: 'error',
        code: 'full_transcript',
        key: row.key,
        id: row.id,
        message: 'Memory contains a full transcript marker; archives must be concise summaries.',
        size: row.value_size,
      });
    }

    if (row.value_size > OVERSIZE_BYTES) {
      issues.push({
        severity: 'warning',
        code: 'oversize',
        key: row.key,
        id: row.id,
        message: `Memory is ${row.value_size} bytes; operational rows should stay below ${OVERSIZE_BYTES} bytes.`,
        size: row.value_size,
      });
    }

    if (previewHasNoise(row.preview)) {
      issues.push({
        severity: isArchive(row) ? 'warning' : 'error',
        code: 'terminal_noise',
        key: row.key,
        id: row.id,
        message: 'Memory preview contains terminal/control/event noise.',
        size: row.value_size,
      });
    }

    if (row.key.startsWith('session:') && !hasLearnableSignal(row.preview)) {
      issues.push({
        severity: 'warning',
        code: 'low_value_archive',
        key: row.key,
        id: row.id,
        message: 'Session archive has no clear learnable signal; it should probably be removed from memory and left as an Obsidian/session log only.',
        size: row.value_size,
      });
    }
  }

  for (const [key, keyRows] of byKey) {
    if (keyRows.length <= 1) continue;
    for (const row of keyRows.slice(1)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_key',
        key,
        id: row.id,
        message: `Duplicate memory key has ${keyRows.length} rows; keys should upsert to one row.`,
        size: row.value_size,
      });
    }
  }

  const totalBytes = rows.reduce((sum, row) => sum + row.value_size, 0);
  const archiveRows = rows.filter(isArchive);
  const operationalRows = rows.filter(row => !isArchive(row));
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;

  return {
    ok: errors === 0,
    generated_at: new Date().toISOString(),
    thresholds: {
      oversize_bytes: OVERSIZE_BYTES,
    },
    counts: {
      total: rows.length,
      operational: operationalRows.length,
      archive: archiveRows.length,
      errors,
      warnings,
      info: issues.filter(issue => issue.severity === 'info').length,
    },
    bytes: {
      total: totalBytes,
      operational: operationalRows.reduce((sum, row) => sum + row.value_size, 0),
      archive: archiveRows.reduce((sum, row) => sum + row.value_size, 0),
    },
    classes: Object.fromEntries([...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))),
    largest: rows
      .slice()
      .sort((a, b) => b.value_size - a.value_size)
      .slice(0, 10)
      .map(row => ({
        key: row.key,
        id: row.id,
        size: row.value_size,
        class: classifyRow(row),
        updated_at: row.updated_at,
      })),
    issues,
    guidance: [
      'Default memory reads should use operational scope only.',
      'Session archives belong in concise session:* summaries, with full transcripts kept in Obsidian/session history.',
      'Use stable key upserts for every write; duplicate keys are audit failures.',
      'Run ant memory audit from cron/launchd or idle-tick before large multi-agent sessions.',
    ],
  };
}
