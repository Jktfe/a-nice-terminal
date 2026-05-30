/**
 * v0.2 Option D collapse — test fixtures for sibling-PR FK targets.
 *
 * The v0.2 substrate (agents / runtimes / memberships / tool_grants) has
 * FK references to tables owned by sibling Option D PRs:
 *   - PR #99 identity_keys (FK target of agents.primary_trust_key_id)
 *   - PR #105 permission_requests (FK target of tool_grants.source_request_id)
 *   - PR #106 reclaim_requests (FK target of audit-trail rows)
 *
 * Those PRs target main; their DDL is added to SCHEMA_DDL_STATEMENTS so
 * the tables exist before V02_SCHEMA_DDL_STATEMENTS runs in production.
 *
 * On the rebase branches the sibling DDL isn't present yet, so vitest
 * runs against a db that lacks the FK targets. This helper seeds the
 * minimum-shape stubs so FK enforcement at INSERT time finds a row to
 * point at. Once PR #99/#105/#106 land on dev and these branches rebase
 * on dev, the CREATE TABLE IF NOT EXISTS statements here become no-ops.
 *
 * Plan: docs/concepts/ant-v02-option-d-collapse-plan.md §4 verification
 * gate.
 */
import type Database from 'better-sqlite3';

export function seedSiblingFkTargets(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      identity_id        TEXT PRIMARY KEY,
      kind               TEXT NOT NULL,
      display_name       TEXT NOT NULL,
      canonical_handle   TEXT NOT NULL,
      created_at_ms      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_keys (
      key_id        TEXT PRIMARY KEY,
      identity_id   TEXT NOT NULL REFERENCES identities(identity_id),
      device_label  TEXT NOT NULL,
      public_key    TEXT NOT NULL,
      key_kind      TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permission_requests (
      request_id    TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reclaim_requests (
      request_id    TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL
    );
  `);
}
