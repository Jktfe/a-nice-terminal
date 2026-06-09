import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type VoteState = 'open' | 'complete' | 'closed';
export type VoteStatus = 'open' | 'closed';

export type VoteOption = {
  id: string;
  label: string;
  sortOrder: number;
};

export type VoteBallot = {
  voterHandle: string;
  optionId: string;
  optionLabel: string;
  roomId: string;
  reason: string | null;
  castAtMs: number;
};

export type VoteTallyRow = {
  optionId: string;
  label: string;
  count: number;
};

export type VoteView = {
  id: string;
  title: string;
  body: string | null;
  status: VoteStatus;
  state: VoteState;
  open: boolean;
  complete: boolean;
  createdByHandle: string;
  createdAtMs: number;
  closedByHandle: string | null;
  closedAtMs: number | null;
  roomIds: string[];
  eligibleVoters: string[];
  missingVoters: string[];
  options: VoteOption[];
  ballots: VoteBallot[];
  tally: VoteTallyRow[];
};

/** One append-only audit event: a single cast (incl. what it replaced). */
export type VoteBallotEvent = {
  seq: number;
  voterHandle: string;
  optionId: string;
  optionLabel: string;
  previousOptionId: string | null;
  previousOptionLabel: string | null;
  roomId: string;
  reason: string | null;
  castAtMs: number;
};

export type CreateVoteInput = {
  title: string;
  body?: string | null;
  options: string[];
  eligibleVoters: string[];
  roomIds: string[];
  createdByHandle: string;
};

export type CastVoteInput = {
  voteId: string;
  voterHandle: string;
  optionId: string;
  roomId: string;
  reason?: string | null;
};

export type CloseVoteInput = {
  voteId: string;
  closedByHandle: string;
};

type VoteRow = {
  id: string;
  title: string;
  body: string | null;
  status: VoteStatus;
  created_by_handle: string;
  created_at_ms: number;
  closed_by_handle: string | null;
  closed_at_ms: number | null;
};

type VoteOptionRow = {
  id: string;
  vote_id: string;
  label: string;
  sort_order: number;
};

type VoteBallotRow = {
  vote_id: string;
  voter_handle: string;
  option_id: string;
  room_id: string;
  reason: string | null;
  cast_at_ms: number;
};

let schemaReady = false;

function ensureTables(): void {
  if (schemaReady) return;
  const db = getIdentityDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_votes (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      body              TEXT,
      status            TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      created_by_handle TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      closed_by_handle  TEXT,
      closed_at_ms      INTEGER
    );

    CREATE TABLE IF NOT EXISTS room_vote_rooms (
      vote_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      PRIMARY KEY (vote_id, room_id),
      FOREIGN KEY (vote_id) REFERENCES room_votes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_vote_voters (
      vote_id      TEXT NOT NULL,
      voter_handle TEXT NOT NULL,
      PRIMARY KEY (vote_id, voter_handle),
      FOREIGN KEY (vote_id) REFERENCES room_votes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_vote_options (
      id         TEXT PRIMARY KEY,
      vote_id    TEXT NOT NULL,
      label      TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (vote_id) REFERENCES room_votes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_vote_ballots (
      vote_id      TEXT NOT NULL,
      voter_handle TEXT NOT NULL,
      option_id    TEXT NOT NULL,
      room_id      TEXT NOT NULL,
      reason       TEXT,
      cast_at_ms   INTEGER NOT NULL,
      PRIMARY KEY (vote_id, voter_handle),
      FOREIGN KEY (vote_id) REFERENCES room_votes(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES room_vote_options(id) ON DELETE CASCADE
    );

    -- Append-only audit log: one row per cast (never overwritten), so a voter's
    -- full change history is recoverable even though room_vote_ballots keeps
    -- only the latest ballot. previous_option_id is the option this cast replaced
    -- (NULL on the voter's first cast).
    CREATE TABLE IF NOT EXISTS room_vote_ballot_events (
      seq                INTEGER PRIMARY KEY AUTOINCREMENT,
      vote_id            TEXT NOT NULL,
      voter_handle       TEXT NOT NULL,
      option_id          TEXT NOT NULL,
      previous_option_id TEXT,
      room_id            TEXT NOT NULL,
      reason             TEXT,
      cast_at_ms         INTEGER NOT NULL,
      FOREIGN KEY (vote_id) REFERENCES room_votes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_room_vote_rooms_room ON room_vote_rooms(room_id);
    CREATE INDEX IF NOT EXISTS idx_room_vote_ballots_vote ON room_vote_ballots(vote_id);
    CREATE INDEX IF NOT EXISTS idx_room_vote_ballot_events_vote ON room_vote_ballot_events(vote_id, seq);
  `);
  schemaReady = true;
}

export function resetVoteStoreSchemaForTests(): void {
  schemaReady = false;
}

export function createVote(input: CreateVoteInput): VoteView {
  ensureTables();
  const title = input.title.trim();
  const options = uniqueNonBlank(input.options);
  const eligibleVoters = uniqueNonBlank(input.eligibleVoters);
  const roomIds = uniqueNonBlank(input.roomIds);
  if (title.length === 0) throw new Error('Vote title is required.');
  if (options.length < 2) throw new Error('Vote needs at least two options.');
  if (eligibleVoters.length === 0) throw new Error('Vote needs at least one eligible voter.');
  if (roomIds.length === 0) throw new Error('Vote needs at least one room.');

  const db = getIdentityDb();
  const id = `vote_${randomUUID()}`;
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO room_votes
      (id, title, body, status, created_by_handle, created_at_ms)
      VALUES (?, ?, ?, 'open', ?, ?)`).run(
      id,
      title,
      normalizeNullableText(input.body),
      input.createdByHandle,
      now
    );
    const insertRoom = db.prepare(`INSERT INTO room_vote_rooms (vote_id, room_id) VALUES (?, ?)`);
    for (const roomId of roomIds) insertRoom.run(id, roomId);
    const insertVoter = db.prepare(`INSERT INTO room_vote_voters (vote_id, voter_handle) VALUES (?, ?)`);
    for (const voter of eligibleVoters) insertVoter.run(id, voter);
    const insertOption = db.prepare(`INSERT INTO room_vote_options
      (id, vote_id, label, sort_order) VALUES (?, ?, ?, ?)`);
    for (let index = 0; index < options.length; index += 1) {
      insertOption.run(`opt_${randomUUID()}`, id, options[index], index);
    }
  })();

  const vote = getVote(id);
  if (!vote) throw new Error(`createVote: vote ${id} disappeared after insert`);
  return vote;
}

export function getVote(voteId: string): VoteView | null {
  ensureTables();
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM room_votes WHERE id = ?`).get(voteId) as VoteRow | undefined;
  if (!row) return null;
  return viewFromRow(row);
}

export function listVotesForRoom(roomId: string): VoteView[] {
  ensureTables();
  const db = getIdentityDb();
  const rows = db.prepare(`
      SELECT v.*
      FROM room_votes v
      JOIN room_vote_rooms r ON r.vote_id = v.id
      WHERE r.room_id = ?
      ORDER BY v.created_at_ms DESC
    `).all(roomId) as VoteRow[];
  return rows.map(viewFromRow);
}

/**
 * Full append-only ballot history for a vote, oldest first — the audit trail.
 * Every cast (incl. re-votes) is one event, with what it replaced. Unlike the
 * tally (latest ballot only), this is never overwritten.
 */
export function getVoteBallotHistory(voteId: string): VoteBallotEvent[] {
  ensureTables();
  const db = getIdentityDb();
  const labels = new Map<string, string>();
  for (const o of db.prepare(`SELECT id, label FROM room_vote_options WHERE vote_id = ?`).all(voteId) as Array<{ id: string; label: string }>) {
    labels.set(o.id, o.label);
  }
  const rows = db
    .prepare(`SELECT seq, voter_handle, option_id, previous_option_id, room_id, reason, cast_at_ms
              FROM room_vote_ballot_events WHERE vote_id = ? ORDER BY seq ASC`)
    .all(voteId) as Array<{
    seq: number; voter_handle: string; option_id: string; previous_option_id: string | null;
    room_id: string; reason: string | null; cast_at_ms: number;
  }>;
  return rows.map((r) => ({
    seq: r.seq,
    voterHandle: r.voter_handle,
    optionId: r.option_id,
    optionLabel: labels.get(r.option_id) ?? r.option_id,
    previousOptionId: r.previous_option_id,
    previousOptionLabel: r.previous_option_id ? labels.get(r.previous_option_id) ?? r.previous_option_id : null,
    roomId: r.room_id,
    reason: r.reason,
    castAtMs: r.cast_at_ms
  }));
}

export function castVoteBallot(input: CastVoteInput): VoteView {
  ensureTables();
  const existing = getVote(input.voteId);
  if (!existing) throw new Error(`Vote ${input.voteId} not found.`);
  if (existing.status === 'closed') throw new Error(`Vote ${input.voteId} is closed.`);
  if (!existing.roomIds.includes(input.roomId)) {
    throw new Error(`Room ${input.roomId} is not bound to vote ${input.voteId}.`);
  }
  if (!existing.eligibleVoters.includes(input.voterHandle)) {
    throw new Error(`${input.voterHandle} is not eligible to vote on ${input.voteId}.`);
  }
  if (!existing.options.some((option) => option.id === input.optionId)) {
    throw new Error(`Vote option ${input.optionId} was not found on ${input.voteId}.`);
  }

  const db = getIdentityDb();
  const now = Date.now();
  const reason = normalizeNullableText(input.reason);
  // The option this cast replaces (NULL on first cast) — for the audit log.
  const prior = db
    .prepare(`SELECT option_id FROM room_vote_ballots WHERE vote_id = ? AND voter_handle = ?`)
    .get(input.voteId, input.voterHandle) as { option_id: string } | undefined;
  const previousOptionId = prior?.option_id ?? null;

  db.transaction(() => {
    // Latest ballot (one per voter) — drives the tally.
    db.prepare(`
      INSERT INTO room_vote_ballots
        (vote_id, voter_handle, option_id, room_id, reason, cast_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(vote_id, voter_handle) DO UPDATE SET
        option_id = excluded.option_id,
        room_id = excluded.room_id,
        reason = excluded.reason,
        cast_at_ms = excluded.cast_at_ms
    `).run(input.voteId, input.voterHandle, input.optionId, input.roomId, reason, now);

    // Append-only audit event — never overwritten, so the full change history
    // (incl. what each cast replaced) is recoverable.
    db.prepare(`
      INSERT INTO room_vote_ballot_events
        (vote_id, voter_handle, option_id, previous_option_id, room_id, reason, cast_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.voteId, input.voterHandle, input.optionId, previousOptionId, input.roomId, reason, now);
  })();

  const updated = getVote(input.voteId);
  if (!updated) throw new Error(`castVoteBallot: vote ${input.voteId} disappeared after ballot`);
  return updated;
}

export function closeVote(input: CloseVoteInput): VoteView {
  ensureTables();
  const existing = getVote(input.voteId);
  if (!existing) throw new Error(`Vote ${input.voteId} not found.`);
  const db = getIdentityDb();
  db.prepare(`UPDATE room_votes
    SET status = 'closed', closed_by_handle = ?, closed_at_ms = ?
    WHERE id = ?`).run(input.closedByHandle, Date.now(), input.voteId);
  const updated = getVote(input.voteId);
  if (!updated) throw new Error(`closeVote: vote ${input.voteId} disappeared after close`);
  return updated;
}

function viewFromRow(row: VoteRow): VoteView {
  const db = getIdentityDb();
  const roomIds = stringColumn(
    db.prepare(`SELECT room_id AS value FROM room_vote_rooms WHERE vote_id = ? ORDER BY room_id ASC`).all(row.id)
  );
  const eligibleVoters = stringColumn(
    db.prepare(`SELECT voter_handle AS value FROM room_vote_voters WHERE vote_id = ? ORDER BY voter_handle ASC`).all(row.id)
  );
  const options = db.prepare(`
      SELECT id, vote_id, label, sort_order
      FROM room_vote_options
      WHERE vote_id = ?
      ORDER BY sort_order ASC
    `).all(row.id) as VoteOptionRow[];
  const ballotRows = db.prepare(`
      SELECT vote_id, voter_handle, option_id, room_id, reason, cast_at_ms
      FROM room_vote_ballots
      WHERE vote_id = ?
      ORDER BY cast_at_ms ASC, voter_handle ASC
    `).all(row.id) as VoteBallotRow[];
  const optionById = new Map(options.map((option) => [option.id, option]));
  const ballots = ballotRows.map((ballot) => ({
    voterHandle: ballot.voter_handle,
    optionId: ballot.option_id,
    optionLabel: optionById.get(ballot.option_id)?.label ?? '(unknown option)',
    roomId: ballot.room_id,
    reason: ballot.reason,
    castAtMs: ballot.cast_at_ms
  }));
  const votedHandles = new Set(ballots.map((ballot) => ballot.voterHandle));
  const missingVoters = eligibleVoters.filter((handle) => !votedHandles.has(handle));
  const tally = options.map((option) => ({
    optionId: option.id,
    label: option.label,
    count: ballots.filter((ballot) => ballot.optionId === option.id).length
  }));
  const complete = row.status === 'closed' || missingVoters.length === 0;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    state: row.status === 'closed' ? 'closed' : (complete ? 'complete' : 'open'),
    open: row.status === 'open',
    complete,
    createdByHandle: row.created_by_handle,
    createdAtMs: row.created_at_ms,
    closedByHandle: row.closed_by_handle,
    closedAtMs: row.closed_at_ms,
    roomIds,
    eligibleVoters,
    missingVoters,
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      sortOrder: option.sort_order
    })),
    ballots,
    tally
  };
}

function uniqueNonBlank(values: string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
  }
  return clean;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function stringColumn(rows: unknown[]): string[] {
  return rows.map((row) => String((row as { value: unknown }).value));
}
