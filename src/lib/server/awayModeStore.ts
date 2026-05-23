/**
 * awayModeStore — user presence tiers + agent-intensity dial.
 *
 * Tiers:
 *   active      — user is present, normal coordination
 *   away-desk   — short absence (30min-2h), light agent work
 *   away-office — medium absence (2h-6h), moderate agent work
 *   away-phone  — long absence (6h+), minimal agent work
 *
 * Intensity (0-100): controls how aggressively agents burn tokens
 * while user is away. 0 = silent, 100 = full autonomy.
 */
import { getIdentityDb } from './db';

export type AwayTier = 'active' | 'away-desk' | 'away-office' | 'away-phone';

export type AwayMode = {
  handle: string;
  tier: AwayTier;
  intensity: number; // 0..100
  note: string | null;
  expectedBackMs: number | null;
  setBy: string | null;
  setAtMs: number;
};

type AwayModeRow = {
  handle: string;
  tier: string;
  intensity: number;
  note: string | null;
  expected_back_ms: number | null;
  set_by: string | null;
  set_at_ms: number;
};

function rowToMode(row: AwayModeRow): AwayMode {
  return {
    handle: row.handle,
    tier: row.tier as AwayTier,
    intensity: row.intensity,
    note: row.note,
    expectedBackMs: row.expected_back_ms,
    setBy: row.set_by,
    setAtMs: row.set_at_ms
  };
}

const ALLOWED_TIERS: readonly AwayTier[] = ['active', 'away-desk', 'away-office', 'away-phone'];

export function isAllowedAwayTier(value: unknown): value is AwayTier {
  return typeof value === 'string' && (ALLOWED_TIERS as readonly string[]).includes(value);
}

export function getAwayMode(handle: string): AwayMode | undefined {
  const db = getIdentityDb();
  const row = db.prepare('SELECT * FROM away_modes WHERE handle = ?').get(handle) as AwayModeRow | undefined;
  return row ? rowToMode(row) : undefined;
}

export function listAwayModes(args?: {
  tier?: AwayTier;
  limit?: number;
}): AwayMode[] {
  const db = getIdentityDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (args?.tier) {
    conditions.push('tier = ?');
    params.push(args.tier);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = args?.limit && args.limit > 0 ? 'LIMIT ?' : '';
  if (limit && args?.limit) params.push(args.limit);

  const rows = db
    .prepare(`SELECT * FROM away_modes ${where} ORDER BY set_at_ms DESC ${limit}`)
    .all(...params) as AwayModeRow[];

  return rows.map(rowToMode);
}

export function setAwayMode(input: {
  handle: string;
  tier: AwayTier;
  intensity?: number;
  note?: string | null;
  expectedBackMs?: number | null;
  setBy?: string | null;
  nowMs?: number;
}): AwayMode {
  const now = input.nowMs ?? Date.now();
  const intensity = Math.max(0, Math.min(100, input.intensity ?? 50));
  const db = getIdentityDb();

  db.prepare(`INSERT INTO away_modes
    (handle, tier, intensity, note, expected_back_ms, set_by, set_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET
      tier = excluded.tier,
      intensity = excluded.intensity,
      note = excluded.note,
      expected_back_ms = excluded.expected_back_ms,
      set_by = excluded.set_by,
      set_at_ms = excluded.set_at_ms
  `).run(
    input.handle,
    input.tier,
    intensity,
    input.note ?? null,
    input.expectedBackMs ?? null,
    input.setBy ?? null,
    now
  );

  return getAwayMode(input.handle)!;
}

export function clearAwayMode(handle: string): boolean {
  const db = getIdentityDb();
  const result = db.prepare('DELETE FROM away_modes WHERE handle = ?').run(handle);
  return result.changes > 0;
}

/**
 * Returns a human-readable summary of what the away mode means.
 */
export function describeAwayTier(tier: AwayTier): { label: string; typicalDuration: string; agentBehaviour: string } {
  switch (tier) {
    case 'active':
      return { label: 'Active', typicalDuration: 'Present', agentBehaviour: 'Normal coordination, real-time responses' };
    case 'away-desk':
      return { label: 'Away from desk', typicalDuration: '30 min – 2 h', agentBehaviour: 'Light work: verify claims, tidy asks, no new claims' };
    case 'away-office':
      return { label: 'Away from office', typicalDuration: '2 h – 6 h', agentBehaviour: 'Moderate work: ship small slices, plan next steps' };
    case 'away-phone':
      return { label: 'Away from phone', typicalDuration: '6 h+', agentBehaviour: 'Minimal work: queue tasks, bank decisions, no token burn' };
  }
}
