/**
 * terminalsStore — the operator-named terminal entity per PTY-INJECT-0 v2 doc Q3.
 *
 * Schema (see ./db.ts):
 *   terminals(id, pid, pid_start, name, tmux_target_pane?, agent_kind?,
 *             pane_status, pane_stale_since?, source, expires_at?, meta,
 *             created_at, updated_at)
 *
 * In A-scope: only pid + pid_start + name + source + ttl are used. The
 * pane/agent_kind/status columns exist for B's tmux fanout but stay null
 * until then. No injection logic lives here.
 *
 * Identity lookup walks the caller's PID chain and picks the MOST RECENT
 * matching (pid, pid_start) row. pid_start is the opaque `ps -o lstart=`
 * string from v3; we preserve it verbatim, never parse it.
 */

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getIdentityDb } from './db';
import { projectAntRegistryFileBestEffort } from './antRegistryFile';
import { normalisePidStartToIso8601 } from './pidStartNormaliser';
import type { TerminalRecord } from './terminalRecordsStore';
import { baseName, isTagged, nextArchiveSeq, tagArchivedName } from './terminalNameTag';

export type TerminalRow = {
  id: string;
  pid: number;
  pid_start: string | null;
  name: string;
  tmux_target_pane: string | null;
  agent_kind: string | null;
  pane_status: 'unknown' | 'verified' | 'stale';
  pane_stale_since: number | null;
  source: string;
  expires_at: number | null;
  meta: string;
  created_at: number;
  updated_at: number;
  // M3.4a-v2 columns (added in T1). Older rows return null until first touch.
  agent_status?: 'idle' | 'thinking' | 'working' | 'response-required';
  agent_status_source?: 'fingerprint' | 'hook' | 'ant-activity' | 'pid-cpu' | 'default';
  agent_status_at_ms?: number;
  last_fingerprint_hash?: string | null;
  last_fingerprint_at_ms?: number | null;
  last_message_sent_at_ms?: number | null;
  last_pty_byte_at_ms?: number | null;
  // agent_context_fill columns (db.ts migrations) — populated by setAgentContextFill().
  agent_context_fill?: number | null;
  agent_context_fill_source?: string | null;
  agent_context_fill_at_ms?: number | null;
  // Per-terminal model flag (JWPK msg_fespxsi2lu antV4 2026-05-28).
  // Free-form string set by the user via the /terminals dropdown. NULL
  // means unspecified — readers should fold those into an "unspecified"
  // subgroup so existing rows keep rendering without a forced migration.
  model?: string | null;
  // Lifecycle status (JWPK A Team msg_w7sfmc4hpp + msg_8m9xsw8d62
  // 2026-05-29). Source of truth for "can this terminal be bound by
  // room_memberships right now". See db.ts comment for the contract.
  status?: 'live' | 'archived' | 'deleted';
  // Last working directory tracked by PROMPT_COMMAND hook on the
  // shell side. Lets a recovered shell `cd $last_path` after re-bind.
  last_path?: string | null;
};

export type RegisterTerminalInput = {
  pid: number;
  pid_start: string | null;
  name: string;
  source?: string;
  ttlSeconds?: number;
  meta?: Record<string, unknown>;
};

export type PidChainEntry = {
  pid: number;
  pid_start: string | null;
};

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

function clampTtlSeconds(rawTtl: number | undefined): number {
  const ttl = typeof rawTtl === 'number' && Number.isFinite(rawTtl)
    ? Math.floor(rawTtl)
    : DEFAULT_TTL_SECONDS;
  if (ttl < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return ttl;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * AUTO-REGISTER-AT-SPAWN (2026-05-16, JWPK T1 self-post fix):
 *
 * When ANT spawns a terminal via POST /api/terminals, the daemon
 * launches a shell inside a tmux pane but no `terminals` row is
 * created — that row is normally created by `ant register` from
 * INSIDE the shell. If the user never runs ant register (typical
 * for ANT-spawned terminals), the pidChain identity resolution
 * fails and the terminal cannot post to its OWN linked chat room
 * (the FINDING-3 LINKEDCHAT-SELF-HANDLE path needs a terminals row
 * whose id matches the linked terminal_records.session_id).
 *
 * This helper queries tmux for the pane's shell PID, reads
 * `ps -o lstart=` for pid_start stability, and INSERTs a terminals
 * row with id = sessionId so identityGate can resolve the caller
 * directly.
 *
 * Safe to call multiple times — uses INSERT OR REPLACE keyed by id.
 * Returns the registered row, or null if tmux didn't have the pane
 * (e.g. daemon spawn failed and the pane never existed).
 */
export function autoRegisterTerminalForSpawnedSession(input: {
  sessionId: string;
  tmuxTargetPane: string;
  agentKind?: string | null;
}): TerminalRow | null {
  let panePid: number;
  try {
    const out = execFileSync(
      'tmux',
      ['display-message', '-p', '-t', input.tmuxTargetPane, '#{pane_pid}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    panePid = Number(out);
    if (!Number.isFinite(panePid) || panePid <= 0) return null;
  } catch {
    // tmux not available, pane doesn't exist, or daemon spawn lost — bail.
    return null;
  }

  let pidStart: string | null = null;
  try {
    const rawLstart = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(panePid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim() || null;
    // Normalise to ISO 8601 so the row is comparable against any caller
    // regardless of locale (en_GB / en_US emit different lstart strings
    // for the same wall-clock moment — caused the 2026-05-29 4h silence
    // forensic). See src/lib/server/pidStartNormaliser.ts for contract.
    pidStart = normalisePidStartToIso8601(rawLstart);
  } catch {
    // ps failed (process died?). Leaving pid_start null is acceptable —
    // lookupTerminalByPidChain treats null as a wildcard match.
  }

  const db = getIdentityDb();
  const now = currentUnixSeconds();
  // Long TTL: this row IS the ANT-spawned terminal — it shouldn't expire
  // just because nobody ran `ant register` from inside the shell.
  const expiresAt = now + 30 * 24 * 60 * 60;
  const metaJson = JSON.stringify({ origin: 'spawn-auto' });

  db.prepare(`INSERT OR REPLACE INTO terminals
    (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
     source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'spawn-auto', ?, ?, ?, ?)`).run(
    input.sessionId,
    panePid,
    pidStart,
    `auto:${input.sessionId}`,
    input.tmuxTargetPane,
    input.agentKind ?? null,
    expiresAt,
    metaJson,
    now,
    now
  );

  projectAntRegistryFileBestEffort();
  return getTerminalById(input.sessionId);
}

export function adoptExternalProcessForTerminal(input: {
  record: TerminalRecord;
  pid: number;
  pidStart: string | null;
  ttlSeconds: number;
  reason?: string | null;
  adoptedBy?: string | null;
}): TerminalRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const expiresAt = now + clampTtlSeconds(input.ttlSeconds);
  // ISO 8601 normalisation — see pidStartNormaliser.ts. Caller may
  // hand us either a locale lstart string or already-ISO Windows
  // CreationDate; we store ISO either way so READ-side comparison
  // can stay format-agnostic.
  const pidStart = normalisePidStartToIso8601(input.pidStart);
  const metaJson = JSON.stringify({
    origin: 'adopt',
    reason: input.reason ?? null,
    adoptedBy: input.adoptedBy ?? null,
    adoptedAt: now
  });

  db.prepare(`INSERT INTO terminals
    (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
     source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'adopt', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      pid = excluded.pid,
      pid_start = excluded.pid_start,
      name = excluded.name,
      tmux_target_pane = excluded.tmux_target_pane,
      agent_kind = excluded.agent_kind,
      pane_status = 'unknown',
      pane_stale_since = NULL,
      source = excluded.source,
      expires_at = excluded.expires_at,
      meta = excluded.meta,
      updated_at = excluded.updated_at`).run(
    input.record.session_id,
    input.pid,
    pidStart,
    input.record.name,
    input.record.tmux_target_pane,
    input.record.agent_kind,
    expiresAt,
    metaJson,
    now,
    now
  );

  projectAntRegistryFileBestEffort();
  const row = getTerminalById(input.record.session_id);
  if (!row) throw new Error('adoptExternalProcessForTerminal: row not found after upsert.');
  return row;
}

export function upsertTerminal(input: RegisterTerminalInput): TerminalRow {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const ttl = clampTtlSeconds(input.ttlSeconds);
  const expiresAt = now + ttl;
  const sourceLabel = input.source ?? 'cli-register';
  const metaJson = JSON.stringify(input.meta ?? {});
  // ISO 8601 normalisation at the boundary — see pidStartNormaliser.ts.
  // We do this ONCE here so both the UPDATE-existing and INSERT-new
  // branches store the same canonical form regardless of caller locale.
  const pidStart = normalisePidStartToIso8601(input.pid_start);

  const existingByName = db
    .prepare(`SELECT id FROM terminals WHERE name = ?`)
    .get(input.name) as { id: string } | undefined;

  if (existingByName) {
    db.prepare(`UPDATE terminals SET
      pid = ?, pid_start = ?, source = ?, expires_at = ?, meta = ?, updated_at = ?
      WHERE id = ?`).run(
      input.pid, pidStart, sourceLabel, expiresAt, metaJson, now, existingByName.id
    );
    projectAntRegistryFileBestEffort();
    return getTerminalById(existingByName.id) as TerminalRow;
  }

  const newId = randomUUID();
  db.prepare(`INSERT INTO terminals
    (id, pid, pid_start, name, source, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId, input.pid, pidStart, input.name, sourceLabel, expiresAt, metaJson, now, now
  );
  projectAntRegistryFileBestEffort();
  return getTerminalById(newId) as TerminalRow;
}

export function getTerminalById(id: string): TerminalRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminals WHERE id = ?`).get(id) as TerminalRow | undefined;
  return row ?? null;
}

export function getTerminalByName(name: string): TerminalRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminals WHERE name = ?`).get(name) as TerminalRow | undefined;
  return row ?? null;
}

export function lookupTerminalByPidChain(pidChain: PidChainEntry[]): TerminalRow | null {
  if (pidChain.length === 0) return null;
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const findMostRecent = db.prepare(
    `SELECT * FROM terminals
     WHERE pid = ? AND (pid_start IS NULL OR pid_start = ?)
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY updated_at DESC LIMIT 1`
  );
  for (const entry of pidChain) {
    // ISO 8601 normalisation at the boundary — see pidStartNormaliser.ts.
    // Writers already stored ISO; comparing the caller's locale-string
    // would silently miss. Belt-and-braces — the CLI already normalises
    // before sending the chain over the wire, but a non-CLI caller (older
    // client, internal-test, future agent) might not.
    const normalisedPidStart = normalisePidStartToIso8601(entry.pid_start);
    const row = findMostRecent.get(entry.pid, normalisedPidStart, now) as TerminalRow | undefined;
    if (row) return row;
  }
  return null;
}

export function listAllTerminals(): TerminalRow[] {
  const db = getIdentityDb();
  return db.prepare(`SELECT * FROM terminals ORDER BY updated_at DESC`).all() as TerminalRow[];
}

export function deleteTerminalById(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM terminals WHERE id = ?`).run(id);
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes > 0;
}

export function sweepExpiredTerminals(): number {
  const db = getIdentityDb();
  const info = db
    .prepare(`DELETE FROM terminals WHERE expires_at IS NOT NULL AND expires_at <= ?`)
    .run(currentUnixSeconds());
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes;
}

export function updatePaneTarget(
  terminalId: string,
  pane: string,
  agentKind: string | null
): boolean {
  const db = getIdentityDb();
  const info = db.prepare(
    `UPDATE terminals
     SET tmux_target_pane = ?, agent_kind = ?, pane_status = 'unknown',
         pane_stale_since = NULL, updated_at = ?
     WHERE id = ?`
  ).run(pane, agentKind, currentUnixSeconds(), terminalId);
  if (info.changes > 0) projectAntRegistryFileBestEffort();
  return info.changes > 0;
}

/**
 * Look up the model flag for every supplied terminal id in one query.
 * Returns a Map keyed by id; missing ids simply don't appear in the
 * result (so callers default to null/"unspecified"). Used by the
 * /api/terminals GET handler to avoid N round-trips.
 */
export function listTerminalModelsByIds(ids: readonly string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (ids.length === 0) return result;
  const db = getIdentityDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, model FROM terminals WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: string; model: string | null }>;
  for (const row of rows) result.set(row.id, row.model ?? null);
  return result;
}

/**
 * Set (or clear) the per-terminal model flag. JWPK msg_fespxsi2lu antV4
 * 2026-05-28. Passing null clears the flag back to "unspecified". The
 * input is treated as opaque — settings owns the canonical list, and
 * grouping logic on /terminals folds NULL into its own subgroup.
 *
 * Returns true when a row was updated, false when the terminalId
 * didn't match any row (so the PATCH endpoint can 404 cleanly).
 */
export function setTerminalModel(terminalId: string, model: string | null): boolean {
  const db = getIdentityDb();
  const trimmed = typeof model === 'string' ? model.trim() : null;
  const value = trimmed && trimmed.length > 0 ? trimmed : null;
  const info = db.prepare(
    `UPDATE terminals
     SET model = ?, updated_at = ?
     WHERE id = ?`
  ).run(value, currentUnixSeconds(), terminalId);
  return info.changes > 0;
}

/**
 * Single authority for terminal lifecycle transitions. The status flip
 * and the name rewrite are fused into ONE transaction so "becoming
 * archived" and "vacating the base name" can never be partially applied.
 *
 *  - → 'archived': if the name is untagged, rewrite terminals.name (and the
 *    matching terminal_records row, keyed by session_id === terminals.id) to
 *    the next free `[A] <base>` / `[A-N] <base>`, freeing the base name in
 *    the global UNIQUE index. Idempotent: an already-tagged row is left as-is.
 *  - → 'live': if the name is tagged AND the base is free of any other live
 *    terminal, restore the base name (revive). If a live terminal already
 *    owns the base, keep the tag (UNIQUE backstop).
 *  - → 'deleted': status only, no rename.
 *
 * Returns true when the row existed, false for an unknown terminalId.
 */
export function setTerminalStatus(
  terminalId: string,
  status: 'live' | 'archived' | 'deleted'
): boolean {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const nowMs = Date.now();
  const txn = db.transaction((): boolean => {
    const row = db
      .prepare(`SELECT id, name FROM terminals WHERE id = ?`)
      .get(terminalId) as { id: string; name: string } | undefined;
    if (!row) return false;

    let nextName = row.name;
    if (status === 'archived' && !isTagged(row.name)) {
      const base = baseName(row.name);
      // Find the next free [A…] slot for this base. The loop + per-attempt
      // offset is a UNIQUE-collision backstop; inside this single SQLite
      // transaction no concurrent writer can grab a slot mid-loop, so attempt 0
      // normally wins. The offset only matters if that invariant ever breaks.
      for (let attempt = 0; attempt < 50; attempt++) {
        const siblings = db
          .prepare(`SELECT name FROM terminals WHERE name LIKE '[A%] ' || ?`)
          .all(base) as { name: string }[];
        const seq = nextArchiveSeq(base, siblings.map((s) => s.name)) + attempt;
        const candidate = tagArchivedName(base, seq);
        const clash = db
          .prepare(`SELECT 1 FROM terminals WHERE name = ?`)
          .get(candidate);
        if (!clash) { nextName = candidate; break; }
      }
      if (nextName === row.name) {
        // Exhausted all attempts: archive proceeds but the base name was NOT
        // freed in the UNIQUE index. Structurally impossible within one
        // transaction — surface it loudly if the assumption ever breaks.
        console.error(
          `[setTerminalStatus] archive name-vacate exhausted for id=${terminalId} name=${JSON.stringify(row.name)} — base name not freed`
        );
      }
    } else if (status === 'live' && isTagged(row.name)) {
      const base = baseName(row.name);
      const baseTaken = db
        .prepare(
          `SELECT 1 FROM terminals WHERE name = ? AND status = 'live' AND id != ?`
        )
        .get(base, row.id);
      if (!baseTaken) nextName = base;
    }

    db.prepare(`UPDATE terminals SET status = ?, name = ?, updated_at = ? WHERE id = ?`)
      .run(status, nextName, now, terminalId);

    if (nextName !== row.name) {
      const rec = db
        .prepare(`SELECT name FROM terminal_records WHERE session_id = ?`)
        .get(terminalId) as { name: string } | undefined;
      if (rec) {
        if (status === 'archived') {
          db.prepare(
            `UPDATE terminal_records SET name = ?, superseded_at_ms = ?, updated_at_ms = ? WHERE session_id = ?`
          ).run(nextName, nowMs, nowMs, terminalId);
        } else {
          db.prepare(
            `UPDATE terminal_records SET name = ?, updated_at_ms = ? WHERE session_id = ?`
          ).run(nextName, nowMs, terminalId);
        }
      }
    }
    return true;
  });
  const existed = txn();
  if (existed) projectAntRegistryFileBestEffort();
  return existed;
}

/**
 * Update terminals.last_path (Phase A1). Called by the upcoming
 * POST /api/terminals/:id/path endpoint (Phase C) when the shell-side
 * PROMPT_COMMAND hook fires. Lets a recovered shell `cd $last_path`
 * automatically when the same handle is re-bound.
 *
 * Empty / whitespace-only input normalises to NULL (clears the field),
 * mirroring setTerminalModel's normalisation. Explicit null also clears.
 * Returns true when a row was updated, false on unknown terminalId.
 */
export function setTerminalLastPath(terminalId: string, path: string | null): boolean {
  const db = getIdentityDb();
  const trimmed = typeof path === 'string' ? path.trim() : null;
  const value = trimmed && trimmed.length > 0 ? trimmed : null;
  const info = db.prepare(
    `UPDATE terminals
     SET last_path = ?, updated_at = ?
     WHERE id = ?`
  ).run(value, currentUnixSeconds(), terminalId);
  return info.changes > 0;
}

/**
 * Lifecycle conflict check (Phase A1, Phase A2 consumer). List all
 * terminals with status='live' that are bound to a given handle via
 * room_memberships (revoked_at_ms IS NULL). Used by Phase A2's
 * register rule (b): "no live terminal already owns this handle".
 *
 * Handle is normalised — `claudev4` and `@claudev4` resolve the same
 * set. Returns an empty array when no live binding exists for the
 * handle. Orphan terminals (no room_memberships row) are excluded.
 */
export function getLiveTerminalsByHandle(handle: string): TerminalRow[] {
  const trimmed = handle.trim();
  if (trimmed.length === 0) return [];
  const normalised = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const db = getIdentityDb();
  return db.prepare(
    `SELECT DISTINCT t.*
       FROM terminals t
       INNER JOIN room_memberships rm ON rm.terminal_id = t.id
      WHERE rm.handle = ?
        AND rm.revoked_at_ms IS NULL
        AND t.status = 'live'
      ORDER BY t.updated_at DESC`
  ).all(normalised) as TerminalRow[];
}

/**
 * Lifecycle conflict check (Phase A1, Phase A2 consumer). Returns the
 * live terminal with this exact name, or null when none. Used by
 * Phase A2's register rule (a): "no conflicting live session" with the
 * same name. Archived/deleted rows with the same name are excluded so
 * a name can be reused once its prior owner is archived.
 */
export function getLiveTerminalByName(name: string): TerminalRow | null {
  const db = getIdentityDb();
  const row = db.prepare(
    `SELECT * FROM terminals WHERE name = ? AND status = 'live'`
  ).get(name) as TerminalRow | undefined;
  return row ?? null;
}

/**
 * Lifecycle conflict check (Phase A2). Returns the live terminal that
 * currently owns the supplied (pid, pid_start) tuple, or null when no
 * live row matches. Used by Phase A2's register rule (b): a (pid,
 * pid_start) pair can only be bound to one live terminal at a time —
 * if the caller's leaf PID already belongs to a different live row,
 * the new register attempt is rejected with a 409 + recovery hint.
 *
 * Match semantics:
 *   - exact equality on pid (positive integer; values <= 0 short-circuit
 *     to null so callers never trigger a query on garbage input);
 *   - exact equality on pid_start when supplied;
 *   - pid_start IS NULL matches a stored NULL (parity with the
 *     wildcard behaviour in lookupTerminalByPidChain — caller couldn't
 *     read lstart on the leaf and the row is therefore promiscuous).
 *
 * Archived/deleted rows with the same (pid, pid_start) are excluded so
 * a recycled PID can be re-claimed once its prior owner is archived.
 */
export function getLiveTerminalByPid(pid: number, pidStart: string | null): TerminalRow | null {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const db = getIdentityDb();
  // ISO 8601 normalisation at the boundary — see pidStartNormaliser.ts.
  // The DB stores ISO via the writer-side normaliser; comparing a
  // locale string from a different caller would silently miss.
  const normalisedPidStart = normalisePidStartToIso8601(pidStart);
  const row = db.prepare(
    `SELECT * FROM terminals
       WHERE pid = ?
         AND ((pid_start IS NULL AND ? IS NULL) OR pid_start = ?)
         AND status = 'live'
       ORDER BY updated_at DESC LIMIT 1`
  ).get(pid, normalisedPidStart, normalisedPidStart) as TerminalRow | undefined;
  return row ?? null;
}

export function markPaneVerified(terminalId: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(
    `UPDATE terminals
     SET pane_status = 'verified', pane_stale_since = NULL, updated_at = ?
     WHERE id = ?`
  ).run(currentUnixSeconds(), terminalId);
  return info.changes > 0;
}

export function markPaneStale(terminalId: string): boolean {
  const db = getIdentityDb();
  const now = currentUnixSeconds();
  const info = db.prepare(
    `UPDATE terminals
     SET pane_status = 'stale', pane_stale_since = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, terminalId);
  return info.changes > 0;
}

/**
 * M3.4a-v2 T3d Q5 touchpoint: bump last_message_sent_at_ms when this terminal
 * authors a chat message. Best-effort — failures swallowed so the chat write
 * path is never blocked by an agent-status side effect.
 */
export function touchLastMessageSentAt(terminalId: string, nowMs: number = Date.now()): boolean {
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals SET last_message_sent_at_ms = ? WHERE id = ?`
    ).run(nowMs, terminalId);
    // #117 fix: stamp agent_status='working' too so the room footer
    // sees the agent as active for the next sampling window. Only
    // overrides lower-priority sources (pid-cpu / default) — fingerprint
    // and hook keep their authority per the M3.4a-v2 cascade.
    db.prepare(
      `UPDATE terminals
          SET agent_status = 'working',
              agent_status_source = 'ant-activity',
              agent_status_at_ms = ?
        WHERE id = ?
          AND agent_status_source IN ('pid-cpu', 'default', 'ant-activity')`
    ).run(nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}

/**
 * M3.4a-v2 T3d Q5 touchpoint: bump last_pty_byte_at_ms when the fanout
 * successfully enqueues bytes for this terminal's pane. Best-effort — failures
 * swallowed so the fanout path is never blocked.
 */
export function touchLastPtyByteAt(terminalId: string, nowMs: number = Date.now()): boolean {
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals SET last_pty_byte_at_ms = ? WHERE id = ?`
    ).run(nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}

/**
 * Per-CLI fingerprint probe writes context-fill (0..1) here. agent-statuses
 * reads it under a 5-minute freshness window — anything older surfaces as
 * "unknown" so the chip doesn't show stuck percentages when an agent dies
 * or stalls. JWPK msg_vz19pvkajk 2026-05-19.
 */
export function setAgentContextFill(
  terminalId: string,
  fill: number,
  source: string,
  nowMs: number = Date.now()
): boolean {
  if (!Number.isFinite(fill) || fill < 0 || fill > 1) return false;
  try {
    const db = getIdentityDb();
    const info = db.prepare(
      `UPDATE terminals
         SET agent_context_fill = ?,
             agent_context_fill_source = ?,
             agent_context_fill_at_ms = ?
       WHERE id = ?`
    ).run(fill, source, nowMs, terminalId);
    return info.changes > 0;
  } catch {
    return false;
  }
}
