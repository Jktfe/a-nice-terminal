/**
 * v02ChatRoomBridge — auto-bootstrap + dual-write shim for the M9c
 * cut-over phase (chat-room + membership endpoints).
 *
 * The v0.2 schema requires v02_memberships rows to FK an existing
 * v02_agents row + an existing v02_rooms row before a membership can be
 * inserted. Legacy chat-room endpoints have no notion of "create the
 * agent + room first" — they upsert rows in chat_rooms / chat_room_members
 * / room_memberships directly.
 *
 * This shim bridges that gap. Given a roomId + handle (and optional terminal
 * record), it:
 *
 *   1. Ensures a v02_rooms row exists for `roomId` — INSERT OR IGNORE with
 *      the legacy room's display_name. Lookup is cheap (PK probe).
 *   2. Resolves a v02_agents row for `handle` — preferring the live agent
 *      already on file, otherwise auto-creating one (mirrors the
 *      v02RegisterBootstrap.bootstrapV02Identity pattern but skips the
 *      runtime insertion — chat-room endpoints don't have pid info).
 *   3. Mirrors the legacy roomMembershipsStore.addMembership /
 *      removeMembership writes into v02_memberships idempotently. Both
 *      surfaces stay populated until M9d ships + a follow-up PR drops the
 *      legacy half.
 *
 * Compatibility shim disclaimer: like v02RegisterBootstrap, this is a
 * cut-over-window tool. Once the M9d phase ships and the legacy stores
 * stop being read, the auto-create-agent path will remain as a convenience
 * for chat-room write flows that don't pre-register an agent. The
 * idiomatic v0.2 flow is `ant agents create` explicitly first.
 *
 * All mirror writes are best-effort: thrown errors are swallowed +
 * console.error'd so the legacy endpoint response shape is never broken
 * by a v0.2 sidecar failure.
 *
 * See docs/concepts/ant-v02-cutover-plan.md §1.4 (chat_room_members
 * extraction) + §2.3 (chat-rooms surface inventory).
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';
import * as v02Memberships from './v02MembershipsStore';
import type { V02MembershipRole } from './v02MembershipsStore';

/**
 * INSERT OR IGNORE a v02_rooms row keyed by roomId. Lookup display_name
 * + creator from the legacy chat_rooms row when the row needs creating.
 * Idempotent — second call is a no-op probe. Returns the resolved
 * v02_rooms.room_id (always === input roomId).
 *
 * The v02_rooms table is intentionally minimal during the cut-over: the
 * chat_rooms table remains the source of truth for description / summary
 * / contract / chair / etc. until M9d collapses them. This shim only
 * exists so v02_memberships FK references resolve.
 */
export function ensureV02RoomExists(roomId: string): string {
  const db = getIdentityDb();
  const existing = db
    .prepare(`SELECT room_id FROM v02_rooms WHERE room_id = ? LIMIT 1`)
    .get(roomId) as { room_id: string } | undefined;
  if (existing) return existing.room_id;

  // Look up the legacy chat_rooms row for the display name; fall back to
  // the roomId itself if the legacy row doesn't exist (shouldn't happen
  // in production but keeps test-only direct-v02 callers from blowing up).
  const legacy = db
    .prepare(`SELECT name FROM chat_rooms WHERE id = ? LIMIT 1`)
    .get(roomId) as { name: string } | undefined;
  const displayName = legacy?.name ?? roomId;
  const now_ms = Date.now();

  try {
    db.prepare(
      `INSERT INTO v02_rooms (room_id, display_name, visibility, created_at_ms)
       VALUES (?, ?, 'private', ?)`
    ).run(roomId, displayName, now_ms);
  } catch (err) {
    // UNIQUE / race — re-probe.
    const probe = db
      .prepare(`SELECT room_id FROM v02_rooms WHERE room_id = ? LIMIT 1`)
      .get(roomId) as { room_id: string } | undefined;
    if (probe) return probe.room_id;
    throw err;
  }
  return roomId;
}

/**
 * Resolve a v02_agents row for the given handle. Lookup order:
 *   1. Live agent already on file (most common — register/M9b shipped it).
 *   2. Auto-create a stub v02_agents row with display_name=handle.
 *
 * Returns the resolved agent_id. The handle is normalised to lead with
 * '@' inside v02AgentsStore.
 *
 * The displayName parameter is used only on the auto-create path — if
 * the handle already has an agent row, the existing display_name is
 * preserved (no drift).
 */
export function ensureV02AgentForHandle(handle: string, displayName?: string | null): string {
  const trimmed = handle.trim();
  if (trimmed.length === 0) {
    throw new Error('ensureV02AgentForHandle: handle must be non-empty.');
  }
  const normalised = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const existing = v02Agents.getLiveAgentByHandle(normalised);
  if (existing) return existing.agent_id;

  const created = v02Agents.createAgent({
    display_name: displayName?.trim() && displayName.trim().length > 0
      ? displayName.trim()
      : normalised,
    primary_handle: normalised,
    owner_org: null
  });
  appendAuditEvent({
    kind: 'agent.created',
    entity_kind: 'agent',
    entity_id: created.agent_id,
    actor_agent_id: created.agent_id,
    actor_runtime_id: null,
    after_json: {
      display_name: created.display_name,
      primary_handle: created.primary_handle,
      via: 'v02-chatroom-bridge'
    }
  });
  return created.agent_id;
}

/**
 * Mirror a legacy addMembership write into v02_memberships. Best-effort:
 * swallows all errors with a console.error so the calling endpoint never
 * 500s due to a v0.2 sidecar failure.
 *
 * Idempotent — addMembership in v02MembershipsStore reuses the existing
 * active row if (agent_id, room_id) already has one.
 *
 * Returns the v02 membership_id when the mirror succeeded, or null when
 * the mirror was skipped/failed (caller doesn't gate on it).
 */
export function mirrorAddMembership(input: {
  roomId: string;
  handle: string;
  displayName?: string | null;
  role?: V02MembershipRole;
}): string | null {
  try {
    ensureV02RoomExists(input.roomId);
    const agent_id = ensureV02AgentForHandle(input.handle, input.displayName);
    const membership = v02Memberships.addMembership({
      agent_id,
      room_id: input.roomId,
      role: input.role ?? 'member',
      room_alias: null
    });
    appendAuditEvent({
      kind: 'membership.joined',
      entity_kind: 'membership',
      entity_id: membership.membership_id,
      actor_agent_id: agent_id,
      actor_runtime_id: null,
      after_json: {
        room_id: input.roomId,
        handle: input.handle,
        via: 'v02-chatroom-bridge'
      }
    });
    return membership.membership_id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[v02-bridge] mirrorAddMembership failed (legacy unaffected):', err);
    return null;
  }
}

/**
 * Mirror a legacy removeMembership / DELETE into v02_memberships as a
 * soft-leave (left_at_ms timestamp). Best-effort.
 *
 * Returns true if the flip happened, false if no active row was found
 * (idempotent no-op) or the mirror errored.
 */
export function mirrorRemoveMembership(roomId: string, handle: string): boolean {
  try {
    const agent = v02Agents.getLiveAgentByHandle(handle);
    if (!agent) return false;
    const flipped = v02Memberships.removeMembership(agent.agent_id, roomId);
    if (flipped) {
      appendAuditEvent({
        kind: 'membership.left',
        entity_kind: 'membership',
        entity_id: `${agent.agent_id}:${roomId}`,
        actor_agent_id: agent.agent_id,
        actor_runtime_id: null,
        after_json: {
          room_id: roomId,
          handle,
          via: 'v02-chatroom-bridge'
        }
      });
    }
    return flipped;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[v02-bridge] mirrorRemoveMembership failed (legacy unaffected):', err);
    return false;
  }
}

/**
 * Convenience: resolve handle → v02 agent_id WITHOUT auto-creating. Used
 * by read-side endpoints that want to surface the v0.2 agent_id when
 * present but fall back to the legacy data when no agent exists yet.
 */
export function resolveV02AgentIdForHandle(handle: string): string | null {
  const agent = v02Agents.getLiveAgentByHandle(handle);
  return agent?.agent_id ?? null;
}

/**
 * Append a single audit event. Best-effort: never throws (audit writes
 * must not break the chat-room hot paths). Mirrors the helper in
 * v02RegisterBootstrap so the same kind taxonomy + entity model lands on
 * both surfaces.
 */
function appendAuditEvent(input: {
  kind: string;
  entity_kind: 'agent' | 'runtime' | 'membership' | 'system';
  entity_id: string;
  actor_agent_id: string | null;
  actor_runtime_id: string | null;
  after_json: Record<string, unknown> | null;
}): void {
  try {
    const db = getIdentityDb();
    db.prepare(
      `INSERT INTO v02_audit_events
         (audit_id, at_ms, kind, entity_kind, entity_id,
          actor_agent_id, actor_runtime_id, before_json, after_json,
          request_id, ip_hash, challenge_proof)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)`
    ).run(
      randomUUID(),
      Date.now(),
      input.kind,
      input.entity_kind,
      input.entity_id,
      input.actor_agent_id,
      input.actor_runtime_id,
      input.after_json ? JSON.stringify(input.after_json) : null
    );
  } catch {
    // Audit write failed — swallow. Investigate if this fires in production.
  }
}
