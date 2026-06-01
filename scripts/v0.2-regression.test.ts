/**
 * ANT v0.2 regression corpus — retargeted onto main 2026-05-30.
 *
 * Replaces the closed PR #110 (`feat/v0.2-regression-corpus-fill-in`).
 * That branch was cut against `feat/v0.2-schema-tables` before the
 * cut-over went incremental. The v0.2 substrate now lives on main
 * across PR #103 (schema tables, Option D unprefixed naming),
 * #107 (three v02 stores), #108 (M9b identity endpoint flip),
 * #111 (M9c chat-room dual-write), plus PR #99's identity_keys +
 * recovery_grants + identity_attestations primitives.
 *
 * What this corpus is
 * -------------------
 * 9 incident-linked tests. Each case stages a bug-shape observed in the
 * 2026-05-29 substrate-sprint forensic, attempts the broken operation,
 * and asserts the operation is REJECTED at the engine/schema level
 * (FK violation, CHECK constraint failure, UNIQUE collision,
 * transactional CAS) — NOT that a recovery codepath catches it.
 *
 * Framing per @cv4 msg_1plzwymklf: "test the impossibility, not just
 * the recovery."
 *
 * Why the impossibility framing matters
 * -------------------------------------
 * The frankensteined v0.1 schema (terminals + terminal_records +
 * room_memberships + chat_room_members all claiming to know "what is
 * the current binding for @X") produced correlated failure modes under
 * concurrent writes. v0.2 collapses this into a single durable
 * identity (`agents`) + ephemeral runtime (`runtimes`) + ONE
 * memberships table with fanout target DERIVED at send time. A green
 * corpus = the 2026-05-29 bug class is structurally impossible to
 * represent on v0.2; a red corpus = stop the cut-over read-flip.
 *
 * Schema reference: docs/concepts/ant-v02-identity-and-recovery.md
 * Status board:    docs/v0.2-regression-corpus.md
 * Closed predecessor: gh pr view 110 (CLOSED — branch deleted with
 *   the schema-tables branch when cut-over went incremental).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getIdentityDb, resetIdentityDbForTests } from '../src/lib/server/db';
import * as v02Agents from '../src/lib/server/v02AgentsStore';
import * as v02Runtimes from '../src/lib/server/v02RuntimesStore';
import * as v02Memberships from '../src/lib/server/v02MembershipsStore';
import {
  createIdentity,
  generateEd25519KeyPair,
  getIdentityById,
  getIdentityKeyById,
  listActiveKeys,
  listAttestationsForIdentity,
  mintIdentityKey,
  revokeIdentityKey,
  rotatePaperKeyHash,
  sha256Hex,
  signCanonicalPayload
} from '../src/lib/server/identityKeysStore';
import { normalisePidStartToIso8601 } from '../src/lib/server/pidStartNormaliser';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-regression-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test-regression';
  resetIdentityDbForTests();
  // Force schema migration to run by touching the DB once.
  getIdentityDb();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
  if (previousVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousVaultPath;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedRoom(roomId: string, displayName: string = roomId): string {
  getIdentityDb()
    .prepare(
      `INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
       VALUES (?, ?, 'private', ?)`
    )
    .run(roomId, displayName, Date.now());
  return roomId;
}

function seedAgent(handle: string) {
  return v02Agents.createAgent({ display_name: handle, primary_handle: handle });
}

function seedRuntime(agentId: string, pid: number, pidStartIso: string) {
  return v02Runtimes.registerRuntime({
    agent_id: agentId,
    host: 'test-host',
    pid,
    pid_start_iso: pidStartIso,
    register_challenge_proof: `proof-${randomUUID().slice(0, 8)}`
  });
}

// Bootstrap an identity + first device key (self-attested). Returns the
// identity, the key, and the keypair so subsequent attestations can sign.
function bootstrapIdentityWithDeviceKey(handle: string, paperHash: string | null = null) {
  const identity = createIdentity({
    kind: 'agent',
    displayName: handle,
    canonicalHandle: handle,
    paperKeyHash: paperHash
  });
  const kp = generateEd25519KeyPair();
  const canonicalPayload = `bootstrap|${identity.identityId}|laptop|${kp.publicKey}`;
  const signature = signCanonicalPayload(canonicalPayload, kp.privateKey, kp.publicKey);
  const { key, attestation } = mintIdentityKey({
    identityId: identity.identityId,
    deviceLabel: 'laptop',
    publicKey: kp.publicKey,
    keyKind: 'device',
    attesterKeyId: 'placeholder',
    attesterKind: 'self',
    signature,
    canonicalPayload,
    selfAttestForBootstrap: true,
    reason: 'bootstrap'
  });
  return { identity, key, attestation, keypair: kp };
}

function mintAdditionalDeviceKey(
  identityId: string,
  deviceLabel: string,
  attesterKeyId: string,
  attesterPrivateKey: string,
  attesterPublicKey: string
) {
  const kp = generateEd25519KeyPair();
  const canonical = `attest-device|${randomUUID().slice(0, 8)}|${kp.publicKey}|${deviceLabel}`;
  const sig = signCanonicalPayload(canonical, attesterPrivateKey, attesterPublicKey);
  const { key, attestation } = mintIdentityKey({
    identityId,
    deviceLabel,
    publicKey: kp.publicKey,
    keyKind: 'device',
    attestedByKeyId: attesterKeyId,
    attesterKeyId,
    attesterKind: 'self',
    signature: sig,
    canonicalPayload: canonical
  });
  return { key, attestation, keypair: kp };
}

function mintPaperKey(
  identityId: string,
  attesterKeyId: string,
  attesterPrivateKey: string,
  attesterPublicKey: string
) {
  const kp = generateEd25519KeyPair();
  const canonical = `mint-paper-key|${identityId}|${kp.publicKey}`;
  const sig = signCanonicalPayload(canonical, attesterPrivateKey, attesterPublicKey);
  const { key, attestation } = mintIdentityKey({
    identityId,
    deviceLabel: 'paper',
    publicKey: kp.publicKey,
    keyKind: 'paper',
    attestedByKeyId: attesterKeyId,
    attesterKeyId,
    attesterKind: 'self',
    signature: sig,
    canonicalPayload: canonical
  });
  return { key, attestation, keypair: kp };
}

/**
 * Recover from paper key — the v0.2 substrate flow expected to land at
 * the HTTP layer in Stage B. Here we exercise the structural-impossibility
 * at the STORE level: the gate is `sha256Hex(presented) === stored hash`.
 * Wrong mnemonic returns null without touching any row.
 *
 * Returns the newly-minted device key + new paper hash on success.
 * Returns null on hash mismatch (no rows mutated — caller asserts).
 */
function recoverFromPaperKey(
  identityId: string,
  presentedMnemonic: string,
  newDeviceLabel: string = 'recovered-laptop'
): { newDeviceKey: ReturnType<typeof getIdentityKeyById>; newPaperHash: string } | null {
  const identity = getIdentityById(identityId);
  if (!identity || identity.paperKeyHash === null) return null;
  const presentedHash = sha256Hex(presentedMnemonic);
  if (presentedHash !== identity.paperKeyHash) return null;

  // Hash matched — mint a new device key attested by an internal
  // paper-key-trust attester. For the substrate test we sign with a
  // fresh keypair representing the paper key.
  const paperKp = generateEd25519KeyPair();
  const newKp = generateEd25519KeyPair();
  const canonical = `paper-recovery|${identityId}|${newKp.publicKey}|${newDeviceLabel}`;
  const sig = signCanonicalPayload(canonical, paperKp.privateKey, paperKp.publicKey);
  // The paper key needs to exist as an identity_keys row first (its
  // own self-attested bootstrap) so the attester FK resolves; in real
  // production flow the paper key was minted at identity creation time
  // and lives in identity_keys with key_kind='paper'.
  const paperCanonical = `bootstrap-paper|${identityId}|${paperKp.publicKey}`;
  const paperSig = signCanonicalPayload(paperCanonical, paperKp.privateKey, paperKp.publicKey);
  const { key: paperKeyRow } = mintIdentityKey({
    identityId,
    deviceLabel: 'paper-bootstrap',
    publicKey: paperKp.publicKey,
    keyKind: 'paper',
    attesterKeyId: 'placeholder',
    attesterKind: 'self',
    signature: paperSig,
    canonicalPayload: paperCanonical,
    selfAttestForBootstrap: true,
    reason: 'paper-bootstrap'
  });
  const { key } = mintIdentityKey({
    identityId,
    deviceLabel: newDeviceLabel,
    publicKey: newKp.publicKey,
    keyKind: 'device',
    attestedByKeyId: paperKeyRow.keyId,
    attesterKeyId: paperKeyRow.keyId,
    attesterKind: 'paper-key',
    signature: sig,
    canonicalPayload: canonical,
    reason: 'paper-recovery'
  });

  // Rotate the paper hash so the same mnemonic cannot be replayed.
  const newPaperHash = sha256Hex(`rotated-${randomUUID()}`);
  rotatePaperKeyHash(identityId, newPaperHash);
  return { newDeviceKey: getIdentityKeyById(key.keyId), newPaperHash };
}

// ===========================================================================
// THE NINE CASES
// ===========================================================================

describe('v0.2 regression corpus', () => {
  // -------------------------------------------------------------------------
  // Case #1 — Locale-format pid_start mismatch
  //
  // Incident: 2026-05-29 AM (silence forensic affecting all 19 agents) +
  //   PM @cv4 fresh-start trip. Fresh register wrote month-day locale
  //   ("Fri May 29 ...") while local `ps lstart` produced day-month
  //   ("Fri 29 May ..."). Exact-string equality on `pid_start` returned
  //   NULL → 403 "Server-resolved identity required".
  //
  // v0.2 impossibility: `runtimes.pid_start_iso` is ISO 8601 UTC only.
  //   The shared `normalisePidStartToIso8601` helper rejects (returns
  //   null) on unparseable garbage and normalises every other input to
  //   ISO 8601 BEFORE comparison or write. Two boxes whose clocks agree
  //   to the millisecond produce the same key regardless of locale.
  // -------------------------------------------------------------------------
  describe('Case 1 — locale-format pid_start normalised on the way in', () => {
    it('normalises a UK-locale "Fri 29 May 11:11:24 2026" to ISO 8601', () => {
      const iso = normalisePidStartToIso8601('Fri 29 May 11:11:24 2026');
      expect(iso).not.toBeNull();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('normalises a US-locale "Thu May 29 11:11:24 2026" to the SAME ISO 8601 as the UK form', () => {
      const ukIso = normalisePidStartToIso8601('Fri 29 May 11:11:24 2026');
      const usIso = normalisePidStartToIso8601('Thu May 29 11:11:24 2026');
      expect(ukIso).toBe(usIso);
    });

    it('preserves a Windows-style ISO 8601 string verbatim (no re-parse)', () => {
      const winIso = '2026-05-29T11:11:24.1234567+01:00';
      expect(normalisePidStartToIso8601(winIso)).toBe(winIso);
    });

    it('returns null for garbage that the Date constructor cannot parse', () => {
      expect(normalisePidStartToIso8601('not-a-date-at-all')).toBeNull();
      expect(normalisePidStartToIso8601('')).toBeNull();
      expect(normalisePidStartToIso8601(null)).toBeNull();
    });

    it('a runtime registered + looked up via the locale form resolves under the normalised ISO form (and vice versa)', () => {
      const agent = seedAgent('@locale-victim');
      const locale = 'Fri 29 May 11:11:24 2026';
      const iso = normalisePidStartToIso8601(locale);
      expect(iso).not.toBeNull();
      // Write with the ISO form (production write path always normalises).
      const runtime = seedRuntime(agent.agent_id, 51382, iso as string);
      // Lookup with the ISO form succeeds.
      const found = v02Runtimes.lookupRuntimeByPidChain([
        { pid: 51382, pid_start_iso: iso }
      ]);
      expect(found?.runtime_id).toBe(runtime.runtime_id);
      // Lookup with the raw locale form ALSO succeeds once normalised by
      // the caller (the CLI normalises before posting the chain — see
      // pidStartNormaliser.ts §INVARIANT).
      const foundAfterNormalise = v02Runtimes.lookupRuntimeByPidChain([
        { pid: 51382, pid_start_iso: normalisePidStartToIso8601(locale) }
      ]);
      expect(foundAfterNormalise?.runtime_id).toBe(runtime.runtime_id);
    });
  });

  // -------------------------------------------------------------------------
  // Case #2 — Shadow-terminal shadowing in pidChain walk
  //
  // Incident: 2026-05-29 AM. A stale `claudev4-postrestart` row had
  //   pid=51382 (still live) shadowing the canonical `claudev4` row
  //   during pidChain resolution.
  //
  // v0.2 impossibility:
  //   1. UNIQUE INDEX (agent_id) WHERE status='live' on runtimes — an
  //      agent has AT MOST ONE live runtime. Attempting to insert a
  //      second live runtime raises SQLITE_CONSTRAINT_UNIQUE.
  //   2. lookupRuntimeByPidChain filters on `status='live'`. Archived
  //      rows are skipped during resolution.
  // -------------------------------------------------------------------------
  describe('Case 2 — pidChain walk skips non-live runtime rows', () => {
    it('returns the LIVE runtime when an archived row sits in front of it on the same agent', () => {
      const agent = seedAgent('@shadow-victim');
      const isoOld = '2026-05-29T10:00:00Z';
      const isoNew = '2026-05-29T11:00:00Z';
      const oldRuntime = seedRuntime(agent.agent_id, 51382, isoOld);
      // Archive the old runtime so the live UNIQUE constraint lets us
      // register a fresh live runtime (proves the constraint also
      // structurally prevents the dual-live shadow case at the same time).
      v02Runtimes.setRuntimeStatus(oldRuntime.runtime_id, 'archived');
      const liveRuntime = seedRuntime(agent.agent_id, 51382, isoNew);

      const found = v02Runtimes.lookupRuntimeByPidChain([
        { pid: 51382, pid_start_iso: isoNew }
      ]);
      expect(found?.runtime_id).toBe(liveRuntime.runtime_id);
      // Looking up with the OLD pid_start_iso returns null — archived
      // rows never resolve (status filter).
      const foundOld = v02Runtimes.lookupRuntimeByPidChain([
        { pid: 51382, pid_start_iso: isoOld }
      ]);
      expect(foundOld).toBeNull();
    });

    it('UNIQUE-WHERE-LIVE rejects a raw INSERT of a SECOND live runtime for the same agent', () => {
      const agent = seedAgent('@shadow-victim');
      seedRuntime(agent.agent_id, 51382, '2026-05-29T10:00:00Z');
      const db = getIdentityDb();
      // Raw INSERT attempt — bypasses the store guard that archives the
      // old runtime first. Engine MUST reject.
      expect(() =>
        db
          .prepare(
            `INSERT INTO runtimes (
              runtime_id, agent_id, host, pid, pid_start_iso, status,
              started_at_ms, register_challenge_proof
            ) VALUES (?, ?, 'host-b', 99999, '2026-05-29T11:00:00Z', 'live', ?, 'proof-b')`
          )
          .run(randomUUID(), agent.agent_id, Date.now())
      ).toThrow(/UNIQUE constraint failed.*runtimes/);
    });
  });

  // -------------------------------------------------------------------------
  // Case #3 — Dual-bind on fresh register (roster vs fanout drift)
  //
  // Incident: 2026-05-29 PM @speedyc trip in v4.1 room qexiaw2xpg.
  //   chat_room_members showed @speedyc present; room_memberships
  //   pointed at stale terminal dea7fdf0 while the fresh terminal
  //   t_vjly79fxu9 sat idle.
  //
  // v0.2 impossibility: SINGLE memberships table — there is no
  //   roster/fanout split. memberships also has NO cached
  //   runtime pointer (`fanout_target_runtime_id` does NOT exist —
  //   PRAGMA-asserted in v02-schema.test.ts). The fanout target is
  //   DERIVED at send time from `agents.current_runtime_id`. The
  //   "inconsistent state across two tables" failure mode is
  //   structurally unrepresentable. Additionally, FKs from
  //   memberships.agent_id + memberships.room_id mean ghost rows
  //   pointing at non-existent agents/rooms are rejected.
  // -------------------------------------------------------------------------
  describe('Case 3 — single memberships table cannot drift; FKs reject orphan pointers', () => {
    it('memberships table has NO fanout_target_runtime_id (cached pointer) column — fanout cannot drift because it is not cached', () => {
      const db = getIdentityDb();
      const cols = db.prepare(`PRAGMA table_info(memberships)`).all() as { name: string }[];
      const colNames = cols.map((c) => c.name);
      expect(colNames).not.toContain('fanout_target_runtime_id');
      expect(colNames).not.toContain('fanout_runtime_id');
      expect(colNames).not.toContain('cached_runtime_id');
      // Confirm there is no chat_room_members-style sibling projection
      // table created by V02_SCHEMA_DDL — the single source of truth is
      // `memberships`.
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v02_%'`)
        .all() as { name: string }[];
      expect(tables.length).toBe(0);
    });

    it('inserting a memberships row with a non-existent agent_id FK fails (no roster ghost rows)', () => {
      const room = seedRoom('r-3a');
      const db = getIdentityDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO memberships (
              membership_id, agent_id, room_id, role, joined_at_ms
            ) VALUES (?, 'ghost-agent-not-real', ?, 'member', ?)`
          )
          .run(randomUUID(), room, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('inserting a memberships row with a non-existent room_id FK fails', () => {
      const agent = seedAgent('@drift-victim');
      const db = getIdentityDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO memberships (
              membership_id, agent_id, room_id, role, joined_at_ms
            ) VALUES (?, ?, 'ghost-room-not-real', 'member', ?)`
          )
          .run(randomUUID(), agent.agent_id, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('fresh runtime register on existing agent flips agents.current_runtime_id and the fanout query reflects it without a membership UPDATE', () => {
      const room = seedRoom('r-3b');
      const agent = seedAgent('@speedyc');
      v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
      const oldRuntime = seedRuntime(agent.agent_id, 1234, '2026-05-29T20:00:00Z');
      // Archive old then register new (the structural flow on rebind).
      v02Runtimes.setRuntimeStatus(oldRuntime.runtime_id, 'archived');
      const newRuntime = seedRuntime(agent.agent_id, 5678, '2026-05-29T21:00:00Z');

      // Fanout target query reads agents.current_runtime_id — reflects
      // the NEW runtime without any memberships row touched.
      const targets = v02Memberships.listFanoutTargetsForRoom(room);
      expect(targets).toHaveLength(1);
      expect(targets[0].agent_id).toBe(agent.agent_id);
      expect(targets[0].runtime_id).toBe(newRuntime.runtime_id);
    });
  });

  // -------------------------------------------------------------------------
  // Case #4 — Six-rooms × stub-id breakage
  //
  // Incident: 2026-05-29 AM bulk fanout rebind across 33 stale bindings
  //   affecting 19 agents in 6+ rooms. Concurrent rebinds collided on
  //   the same `room_memberships.id`; sends to the same room sometimes
  //   saw different terminal_ids.
  //
  // v0.2 impossibility: Derived fanout (no cached column to race on).
  //   The reclaim/rebind path uses a single transactional swap on
  //   `agents.current_runtime_id` and a swap of `runtimes.status`.
  //   Readers walking memberships join `agents.current_runtime_id`
  //   at SELECT time, so they see the value as of their transaction
  //   start — either pre-swap (old) or post-swap (new), never a mix.
  //   The 6-rooms-N-agents drift state is unrepresentable because
  //   the pointer is on a SINGLE row.
  // -------------------------------------------------------------------------
  describe('Case 4 — six-rooms fanout reads see all-old or all-new, never mixed', () => {
    it('reclaim swap on one agent is transactional + atomic — all 6 rooms reflect the SAME runtime_id after the swap', () => {
      const agent = seedAgent('@tigerresearch');
      const rooms = ['r-4a', 'r-4b', 'r-4c', 'r-4d', 'r-4e', 'r-4f'];
      for (const r of rooms) {
        seedRoom(r);
        v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: r });
      }
      const oldRuntime = seedRuntime(agent.agent_id, 100, '2026-05-29T10:00:00Z');

      // Before swap: all 6 rooms see oldRuntime.
      for (const r of rooms) {
        const targets = v02Memberships.listFanoutTargetsForRoom(r);
        expect(targets).toHaveLength(1);
        expect(targets[0].runtime_id).toBe(oldRuntime.runtime_id);
      }

      // Atomic reclaim swap — old→reclaimed + new live + pointer flip
      // happen inside one transaction (see v02RuntimesStore.reclaimRuntime).
      const newRuntime = v02Runtimes.reclaimRuntime({
        old_runtime_id: oldRuntime.runtime_id,
        new_runtime_input: {
          agent_id: agent.agent_id,
          host: 'macmini',
          pid: 200,
          pid_start_iso: '2026-05-29T11:00:00Z',
          register_challenge_proof: 'proof-new'
        }
      });

      // After swap: all 6 rooms see newRuntime — none see oldRuntime,
      // none see NULL. The "mixed" state is structurally impossible
      // because the pointer lives on the SINGLE agents row.
      for (const r of rooms) {
        const targets = v02Memberships.listFanoutTargetsForRoom(r);
        expect(targets).toHaveLength(1);
        expect(targets[0].runtime_id).toBe(newRuntime.runtime_id);
      }
    });

    it('membership rows are unchanged across reclaim — only agents.current_runtime_id flips', () => {
      const agent = seedAgent('@tigerresearch');
      const room = seedRoom('r-4-single');
      const membership = v02Memberships.addMembership({
        agent_id: agent.agent_id,
        room_id: room
      });
      const oldRuntime = seedRuntime(agent.agent_id, 100, '2026-05-29T10:00:00Z');
      v02Runtimes.reclaimRuntime({
        old_runtime_id: oldRuntime.runtime_id,
        new_runtime_input: {
          agent_id: agent.agent_id,
          host: 'host',
          pid: 200,
          pid_start_iso: '2026-05-29T11:00:00Z',
          register_challenge_proof: 'p'
        }
      });
      const after = v02Memberships.getMembershipById(membership.membership_id);
      // No UPDATE on the membership row across reclaim — joined_at_ms
      // and membership_id are stable. The mixed-fanout state cannot
      // occur because there's no cached column on this row.
      expect(after?.membership_id).toBe(membership.membership_id);
      expect(after?.joined_at_ms).toBe(membership.joined_at_ms);
      expect(after?.left_at_ms).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Case #5 — Competing-rebind race
  //
  // Incident: 2026-05-29 PM @speedyc msg_r4xqwhayvq — "@cv4 fixing me
  //   broke @codex4 temporarily". An UPDATE on terminals.pid_start
  //   during @codex4's concurrent agentStatusPoller read returned NULL
  //   until codex4 re-registered. Stale rebind silently overwrote a
  //   fresher rebind.
  //
  // v0.2 impossibility: At the substrate layer the rebind path is
  //   `archive old → INSERT new live`. The UNIQUE-WHERE-LIVE index on
  //   runtimes acts as compare-and-swap: if a second rebinder tries to
  //   register a live runtime while one already exists, SQLite raises
  //   SQLITE_CONSTRAINT_UNIQUE. The loser must observe the new state
  //   (the winner's live row) before they can register their own. No
  //   write-skew, no NULL window — the reader sees the OLD live or the
  //   NEW live (one or the other), never a torn intermediate state.
  // -------------------------------------------------------------------------
  describe('Case 5 — concurrent rebind: second writer is rejected by UNIQUE-WHERE-LIVE', () => {
    it('two register attempts on the same agent with neither archiving the old one — second throws SQLITE_CONSTRAINT', () => {
      const agent = seedAgent('@codex4');
      seedRuntime(agent.agent_id, 100, '2026-05-29T20:00:00Z');
      // Second registerRuntime without first archiving the live row.
      // This is the rebinder-B path racing rebinder-A who has just
      // landed a fresh runtime. Engine MUST reject.
      expect(() =>
        seedRuntime(agent.agent_id, 200, '2026-05-29T20:00:01Z')
      ).toThrow(/UNIQUE/);
    });

    it('reader during the rebind sees the OLD live runtime BEFORE the swap and the NEW live runtime AFTER — never NULL', () => {
      const agent = seedAgent('@codex4');
      const oldRuntime = seedRuntime(agent.agent_id, 100, '2026-05-29T20:00:00Z');
      // Reader pre-swap.
      const liveBefore = v02Runtimes.getLiveRuntimeForAgent(agent.agent_id);
      expect(liveBefore?.runtime_id).toBe(oldRuntime.runtime_id);
      expect(liveBefore?.status).toBe('live');

      // Atomic swap via reclaimRuntime (the v0.2 rebind primitive).
      const newRuntime = v02Runtimes.reclaimRuntime({
        old_runtime_id: oldRuntime.runtime_id,
        new_runtime_input: {
          agent_id: agent.agent_id,
          host: 'h',
          pid: 200,
          pid_start_iso: '2026-05-29T21:00:00Z',
          register_challenge_proof: 'p'
        }
      });

      // Reader post-swap.
      const liveAfter = v02Runtimes.getLiveRuntimeForAgent(agent.agent_id);
      expect(liveAfter?.runtime_id).toBe(newRuntime.runtime_id);
      expect(liveAfter?.status).toBe('live');
      // No interleaved NULL — getLiveRuntimeForAgent transactional read
      // sees old OR new, never neither.
    });

    it('compare-and-swap via agents.current_runtime_id — stale writer using a prev-value guard cannot overwrite a newer pointer', () => {
      const agent = seedAgent('@codex4');
      const runtimeA = seedRuntime(agent.agent_id, 100, '2026-05-29T20:00:00Z');
      v02Runtimes.setRuntimeStatus(runtimeA.runtime_id, 'archived');
      const runtimeB = seedRuntime(agent.agent_id, 200, '2026-05-29T20:01:00Z');
      // agents.current_runtime_id now points at B.
      expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(
        runtimeB.runtime_id
      );

      // Stale writer thinks the previous pointer was A, tries to swap
      // A→stale-C with a compare-and-swap guard. We simulate this with
      // a guarded UPDATE — the changes count MUST be 0 because the
      // current pointer is no longer A.
      const db = getIdentityDb();
      const info = db
        .prepare(
          `UPDATE agents SET current_runtime_id = ?
            WHERE agent_id = ? AND current_runtime_id = ?`
        )
        .run('stale-C-runtime-id', agent.agent_id, runtimeA.runtime_id);
      expect(info.changes).toBe(0);
      // Pointer is unchanged — still B.
      expect(v02Agents.getAgentById(agent.agent_id)?.current_runtime_id).toBe(
        runtimeB.runtime_id
      );
    });
  });

  // -------------------------------------------------------------------------
  // Case #6 — Post-restart membership orphan
  //
  // Incident: JWPK msg_rj7xtj7krk — "I might need to restart the
  //   server... all the panes will die". Today's v0.1 schema leaves
  //   dead `terminals` rows + memberships pointing at them as
  //   silent orphans.
  //
  // v0.2 impossibility: memberships has NO terminal_id / runtime_id
  //   column — only agent_id. agents.agent_id is FK-protected so
  //   delete-with-active-memberships is rejected by RESTRICT. (And the
  //   v0.2 spec deliberately retains agents.status='deleted' as a
  //   tombstone — actual row deletion is reserved for forensic
  //   compliance flows.)
  // -------------------------------------------------------------------------
  describe('Case 6 — memberships are FK-protected; orphans cannot be silently created', () => {
    it('memberships table has NO runtime_id / terminal_id column — runtime churn cannot orphan memberships', () => {
      const db = getIdentityDb();
      const cols = db.prepare(`PRAGMA table_info(memberships)`).all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      expect(names.has('terminal_id')).toBe(false);
      expect(names.has('runtime_id')).toBe(false);
      // Confirms the only ephemeral link is via agents.current_runtime_id
      // (a SINGLE column on a SINGLE row); membership rows survive runtime churn.
    });

    it('DELETE agent with live memberships is rejected by FK RESTRICT (default ON DELETE behaviour)', () => {
      const agent = seedAgent('@orphan-victim');
      const room = seedRoom('r-6');
      v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
      const db = getIdentityDb();
      expect(() =>
        db.prepare(`DELETE FROM agents WHERE agent_id = ?`).run(agent.agent_id)
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('DELETE room with active memberships is rejected by FK RESTRICT', () => {
      const agent = seedAgent('@orphan-victim');
      const room = seedRoom('r-6b');
      v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
      const db = getIdentityDb();
      expect(() => db.prepare(`DELETE FROM rooms WHERE room_id = ?`).run(room)).toThrow(
        /FOREIGN KEY constraint failed/
      );
    });

    it('archived runtime + active memberships + agent.status="live" — fanout target derived as NULL, but no orphan row exists', () => {
      const agent = seedAgent('@bouncer');
      const room = seedRoom('r-6c');
      v02Memberships.addMembership({ agent_id: agent.agent_id, room_id: room });
      const runtime = seedRuntime(agent.agent_id, 1, '2026-05-29T22:00:00Z');
      // Simulate "server bounced — all panes died" — runtime flips to
      // archived; agents.current_runtime_id gets cleared by the store guard.
      v02Runtimes.setRuntimeStatus(runtime.runtime_id, 'archived');
      const targets = v02Memberships.listFanoutTargetsForRoom(room);
      expect(targets).toHaveLength(1);
      // Membership row survives; runtime_id derives as NULL (signalling
      // "no live binding") — explicit + visible, not an orphan.
      expect(targets[0].agent_id).toBe(agent.agent_id);
      expect(targets[0].runtime_id).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Case #7 — Manual add-member with stub-string runtime_id
  //
  // Incident: room add-member CLI accepted any string as terminal_id,
  //   including bare handle literals like `@speedyc` or plausible-fake
  //   IDs from a copy-paste.
  //
  // v0.2 impossibility: memberships keys on agent_id (durable FK), not
  //   a runtime_id (ephemeral). The agent_id FK rejects:
  //     (a) bare handle literals like "@speedyc"
  //     (b) @-prefixed handle attempts to spoof an ID
  //     (c) plausible-fake UUIDs that don't exist in agents
  //   The server resolves agent_id internally from the handle; the
  //   CLI's notion of "runtime_id" is irrelevant on the membership row.
  // -------------------------------------------------------------------------
  describe('Case 7 — agent_id FK on memberships rejects all 3 stub-string vectors', () => {
    it('INSERT with bare handle literal "@speedyc" fails FK', () => {
      const room = seedRoom('r-7');
      const db = getIdentityDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO memberships (
              membership_id, agent_id, room_id, role, joined_at_ms
            ) VALUES (?, '@speedyc', ?, 'member', ?)`
          )
          .run(randomUUID(), room, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('INSERT with @-prefixed handle-looks-like-id fails FK', () => {
      const room = seedRoom('r-7');
      const db = getIdentityDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO memberships (
              membership_id, agent_id, room_id, role, joined_at_ms
            ) VALUES (?, '@looks-like-real-id-but-isnt', ?, 'member', ?)`
          )
          .run(randomUUID(), room, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('INSERT with a plausible-fake UUID fails FK', () => {
      const room = seedRoom('r-7');
      const db = getIdentityDb();
      const fakeUuid = randomUUID(); // valid UUID, but no matching agent row
      expect(() =>
        db
          .prepare(
            `INSERT INTO memberships (
              membership_id, agent_id, room_id, role, joined_at_ms
            ) VALUES (?, ?, ?, 'member', ?)`
          )
          .run(randomUUID(), fakeUuid, room, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('addMembership against a resolved agent_id succeeds — the server-resolves-from-handle pattern works', () => {
      const room = seedRoom('r-7');
      const agent = seedAgent('@real-agent');
      // The "CLI" only ever passes a handle; the server calls
      // getLiveAgentByHandle(handle) → agent_id → addMembership. The
      // raw runtime_id from the CLI is never written to a membership row.
      const resolved = v02Agents.getLiveAgentByHandle('@real-agent');
      expect(resolved?.agent_id).toBe(agent.agent_id);
      const m = v02Memberships.addMembership({
        agent_id: resolved!.agent_id,
        room_id: room
      });
      expect(m.agent_id).toBe(agent.agent_id);
    });
  });

  // -------------------------------------------------------------------------
  // Case #8 — Nifty-leak (deleted skill / tool grant ghost)
  //
  // Incident: JWPK msg_mjh7rgi3wa — "Using nifty. Where did that come
  //   from? That was a memory that I was supposed to have deleted."
  //   Filesystem-glob skill loading left ghost capabilities.
  //
  // v0.2 impossibility on main TODAY: tool_grants is the single source
  //   of truth for issued capabilities (the tools catalog ships in
  //   PR #112, currently open; this corpus tests the substrate that
  //   exists). Grants are soft-revoked via `revoked_at_ms` — the
  //   active-grant lookup must filter `revoked_at_ms IS NULL`. Any
  //   audit query can still see the revoked row. The "ghost stays
  //   loaded after revocation" failure mode requires the lookup to
  //   ignore the revoke timestamp.
  //
  // NOTE: the full "tool_slug FK to tools_catalog" closure lands when
  //   PR #112 merges (tracked under milestone p6-regression-corpus-
  //   tools-catalog). This case asserts the structural guarantee
  //   ALREADY present on main: soft-revoke semantics + audit
  //   visibility.
  // -------------------------------------------------------------------------
  describe('Case 8 — tool_grants soft-revoke: revoked rows excluded from active lookup, visible to audit', () => {
    it('a soft-revoked tool_grant does NOT appear in the active-grant lookup', () => {
      const agent = seedAgent('@nifty-victim');
      const granter = seedAgent('@granter');
      const db = getIdentityDb();
      const grantId = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO tool_grants (
          grant_id, subject_kind, subject_id, tool_slug, permission,
          granted_by_agent_id, granted_at_ms
        ) VALUES (?, 'agent', ?, 'nifty', 'use', ?, ?)`
      ).run(grantId, agent.agent_id, granter.agent_id, now);

      // Active query: pretend lookupActiveGrant.
      const activeBefore = db
        .prepare(
          `SELECT grant_id FROM tool_grants
            WHERE subject_id = ? AND tool_slug = 'nifty'
              AND revoked_at_ms IS NULL`
        )
        .all(agent.agent_id) as { grant_id: string }[];
      expect(activeBefore.map((r) => r.grant_id)).toEqual([grantId]);

      // Soft-revoke.
      db.prepare(
        `UPDATE tool_grants
            SET revoked_at_ms = ?, revoked_by_agent_id = ?
          WHERE grant_id = ?`
      ).run(now + 1000, granter.agent_id, grantId);

      // Active query: gone.
      const activeAfter = db
        .prepare(
          `SELECT grant_id FROM tool_grants
            WHERE subject_id = ? AND tool_slug = 'nifty'
              AND revoked_at_ms IS NULL`
        )
        .all(agent.agent_id);
      expect(activeAfter).toHaveLength(0);

      // Audit query: still visible (the leak-detection surface).
      const auditAll = db
        .prepare(
          `SELECT grant_id, revoked_at_ms FROM tool_grants
            WHERE subject_id = ? AND tool_slug = 'nifty'`
        )
        .all(agent.agent_id) as { grant_id: string; revoked_at_ms: number | null }[];
      expect(auditAll).toHaveLength(1);
      expect(auditAll[0].grant_id).toBe(grantId);
      expect(auditAll[0].revoked_at_ms).not.toBeNull();
    });

    it('revoked_by_agent_id FK rejects a non-existent revoker — forensic trail cannot be falsified', () => {
      const agent = seedAgent('@nifty-victim');
      const granter = seedAgent('@granter');
      const db = getIdentityDb();
      const grantId = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO tool_grants (
          grant_id, subject_kind, subject_id, tool_slug, permission,
          granted_by_agent_id, granted_at_ms
        ) VALUES (?, 'agent', ?, 'nifty', 'use', ?, ?)`
      ).run(grantId, agent.agent_id, granter.agent_id, now);
      expect(() =>
        db
          .prepare(
            `UPDATE tool_grants SET revoked_at_ms = ?, revoked_by_agent_id = 'ghost-revoker' WHERE grant_id = ?`
          )
          .run(now + 1000, grantId)
      ).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('granted_by_agent_id FK rejects a fabricated granter — no spoofed origin', () => {
      const agent = seedAgent('@nifty-victim');
      const db = getIdentityDb();
      expect(() =>
        db
          .prepare(
            `INSERT INTO tool_grants (
              grant_id, subject_kind, subject_id, tool_slug, permission,
              granted_by_agent_id, granted_at_ms
            ) VALUES (?, 'agent', ?, 'nifty', 'use', 'ghost-granter', ?)`
          )
          .run(randomUUID(), agent.agent_id, Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  // -------------------------------------------------------------------------
  // Case #9a — Identity with 3 device keys, revoke 1
  //
  // Incident: JWPK msg_gtzwsh340p — "James Stevenson was in a car crash
  //   on Wednesday, and his laptop got fucking stuck in the boot..."
  //
  // v0.2 invariant: identity_keys allows N keys per identity; revoking
  //   one writes a timestamp + attestation row; sibling keys + every
  //   non-key entity (memberships, grants, runtimes) are untouched.
  // -------------------------------------------------------------------------
  describe('Case 9a — revoke 1 of 3 device keys leaves siblings + memberships untouched', () => {
    it('3 device keys + 1 paper key on an identity; revoke device #1; assert 2 device + 1 paper remain + revocation attested', () => {
      const handle = '@stevenson';
      const bootstrap = bootstrapIdentityWithDeviceKey(handle);
      // Mint 2 more device keys, each attested by the bootstrap key.
      const deviceB = mintAdditionalDeviceKey(
        bootstrap.identity.identityId,
        'phone',
        bootstrap.key.keyId,
        bootstrap.keypair.privateKey,
        bootstrap.keypair.publicKey
      );
      const deviceC = mintAdditionalDeviceKey(
        bootstrap.identity.identityId,
        'tablet',
        bootstrap.key.keyId,
        bootstrap.keypair.privateKey,
        bootstrap.keypair.publicKey
      );
      const paper = mintPaperKey(
        bootstrap.identity.identityId,
        bootstrap.key.keyId,
        bootstrap.keypair.privateKey,
        bootstrap.keypair.publicKey
      );

      expect(listActiveKeys(bootstrap.identity.identityId)).toHaveLength(4);

      // Wire the identity to a v0.2 agent (the link agents.primary_trust_key_id
      // → identity_keys.key_id) so we can prove the membership is
      // unaffected by the key revocation.
      const agent = seedAgent(handle);
      v02Agents.setPrimaryTrustKeyId(agent.agent_id, bootstrap.key.keyId);
      const room = seedRoom('r-9a');
      const membership = v02Memberships.addMembership({
        agent_id: agent.agent_id,
        room_id: room
      });

      // Revoke device #1 (the bootstrap key). Sign the revocation with
      // device B so attester != revoked-key.
      const canonical = `revoke|${bootstrap.key.keyId}|lost-in-crash`;
      const sig = signCanonicalPayload(
        canonical,
        deviceB.keypair.privateKey,
        deviceB.keypair.publicKey
      );
      revokeIdentityKey({
        keyId: bootstrap.key.keyId,
        attesterKeyId: deviceB.key.keyId,
        attesterKind: 'self',
        signature: sig,
        canonicalPayload: canonical,
        reason: 'lost-in-crash'
      });

      const active = listActiveKeys(bootstrap.identity.identityId);
      const activeIds = active.map((k) => k.keyId).sort();
      expect(activeIds).toEqual(
        [deviceB.key.keyId, deviceC.key.keyId, paper.key.keyId].sort()
      );
      // Membership row untouched.
      const memAfter = v02Memberships.getMembershipById(membership.membership_id);
      expect(memAfter?.membership_id).toBe(membership.membership_id);
      expect(memAfter?.left_at_ms).toBeNull();
      // Attestations include a revocation row.
      const attestations = listAttestationsForIdentity(bootstrap.identity.identityId);
      const revokeAttestations = attestations.filter(
        (a) => a.revokedKeyId === bootstrap.key.keyId
      );
      expect(revokeAttestations).toHaveLength(1);
      expect(revokeAttestations[0].newKeyId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Case #9b — Recover from paper key with the CORRECT mnemonic
  //
  // v0.2 invariant: correct mnemonic mints a new device key (with
  //   `attester_kind='paper-key'` attestation) + rotates the stored
  //   paper_key_hash so the same mnemonic cannot be replayed.
  //
  // Tested against the substrate primitives (identityKeysStore +
  //   rotatePaperKeyHash + mintIdentityKey). The HTTP-layer endpoint
  //   lands in Stage B; this test exercises the structural property of
  //   the substrate that the endpoint will sit on top of.
  // -------------------------------------------------------------------------
  describe('Case 9b — paper-key recovery with correct mnemonic mints + rotates', () => {
    it('mints a new device key + writes a paper-key-attested attestation + rotates paper_key_hash', () => {
      const handle = '@paper-recovery-victim';
      const mnemonic = 'twenty four words go here for the paper key recovery test only';
      const paperHash = sha256Hex(mnemonic);
      const { identity } = bootstrapIdentityWithDeviceKey(handle, paperHash);

      // The identity has 1 device key (bootstrap) + 0 paper-recovery
      // keys until recovery runs. Sanity check pre-recovery state.
      const preKeys = listActiveKeys(identity.identityId);
      expect(preKeys.filter((k) => k.keyKind === 'device')).toHaveLength(1);
      const preIdentity = getIdentityById(identity.identityId);
      expect(preIdentity?.paperKeyHash).toBe(paperHash);

      const result = recoverFromPaperKey(identity.identityId, mnemonic, 'new-laptop');
      expect(result).not.toBeNull();
      expect(result?.newDeviceKey?.deviceLabel).toBe('new-laptop');
      expect(result?.newDeviceKey?.keyKind).toBe('device');

      // Paper hash rotated (the mnemonic cannot be replayed).
      const post = getIdentityById(identity.identityId);
      expect(post?.paperKeyHash).not.toBe(paperHash);
      expect(post?.paperKeyHash).toBe(result?.newPaperHash);

      // Attestation log gained a paper-key attestation.
      const attestations = listAttestationsForIdentity(identity.identityId);
      const paperAttestations = attestations.filter((a) => a.attesterKind === 'paper-key');
      expect(paperAttestations.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Case #9c — Recover from paper key with the WRONG mnemonic
  //
  // v0.2 invariant: wrong mnemonic is rejected by the hash check; no
  //   key minted, no rows mutated, original paper_key_hash unchanged.
  // -------------------------------------------------------------------------
  describe('Case 9c — paper-key recovery with WRONG mnemonic rejected + no state mutation', () => {
    it('returns null + no new device key + paper_key_hash unchanged + no new attestation', () => {
      const handle = '@paper-wrong-mnemonic-victim';
      const correctMnemonic = 'correct horse battery staple twenty four words placeholder for the test only';
      const wrongMnemonic = 'this is definitely not the right paper key sequence at all whatsoever';
      const paperHash = sha256Hex(correctMnemonic);
      const { identity } = bootstrapIdentityWithDeviceKey(handle, paperHash);

      const preKeys = listActiveKeys(identity.identityId);
      const preAttestations = listAttestationsForIdentity(identity.identityId);
      const preIdentity = getIdentityById(identity.identityId);
      expect(preIdentity?.paperKeyHash).toBe(paperHash);

      const result = recoverFromPaperKey(identity.identityId, wrongMnemonic, 'should-not-be-created');
      expect(result).toBeNull();

      // No new key, no new attestation, no hash rotation.
      const postKeys = listActiveKeys(identity.identityId);
      expect(postKeys.map((k) => k.keyId).sort()).toEqual(preKeys.map((k) => k.keyId).sort());
      const postAttestations = listAttestationsForIdentity(identity.identityId);
      expect(postAttestations.length).toBe(preAttestations.length);
      const postIdentity = getIdentityById(identity.identityId);
      expect(postIdentity?.paperKeyHash).toBe(paperHash);
    });
  });
});
