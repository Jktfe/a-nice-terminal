/**
 * v02ChatRoomBridge — historical helper shell.
 *
 * Live mirror exports now write clean vNext membership/presentation only.
 * Direct ensureV02* helpers remain for old tests and migration archaeology
 * until the v0.2 schema is dropped.
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

import { getIdentityDb } from './db';
import * as v02Agents from './v02AgentsStore';
import * as v02Memberships from './v02MembershipsStore';
import type { V02MembershipRole, V02MemberKind } from './v02MembershipsStore';
import { getIdentityByHandle } from './identityKeysStore';
import { appendAuditEvent as appendAuditEventCanonical } from './auditEventsStore';
import {
  addMember as cleanAddMember,
  removeMember as cleanRemoveMember,
  isDurableMemberHandle
} from './membershipStore';
import { setMemberPresentation } from './membershipPresentationStore';

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
    .prepare(`SELECT room_id FROM rooms WHERE room_id = ? LIMIT 1`)
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
      `INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
       VALUES (?, ?, 'private', ?)`
    ).run(roomId, displayName, now_ms);
  } catch (err) {
    // UNIQUE / race — re-probe.
    const probe = db
      .prepare(`SELECT room_id FROM rooms WHERE room_id = ? LIMIT 1`)
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

  // sec-iter1 Fix #5 (2026-05-30 enterprise security pass). Today
  // chat-room mirror writes can auto-create a v02_agents row for any
  // handle, no attestation required. The row is functionally harmless
  // because `primary_trust_key_id` is unused in fanout/auth gates as
  // of this PR — but Stage B + any future "ant attest" flow will
  // promote `primary_trust_key_id` to a load-bearing field, at which
  // point this auto-create path becomes exploitable (attacker
  // pre-creates an agents row for a victim handle + then races to
  // attest a key before the victim does).
  //
  // Defence-in-depth: when no `identity_keys` row exists for the
  // handle (via `getIdentityByHandle`), the auto-created agents row
  // is tagged as a 'stub' via a `via: 'v02-chatroom-bridge-stub'`
  // audit-event marker AND `primary_trust_key_id` is left explicitly
  // NULL. The agents.kind / agents.status column is left as-is
  // because the schema doesn't have a stub-marker column — the
  // audit_event provenance string IS the marker. A Stage B sweep
  // (filter audit_events WHERE kind='agent.created.via_bridge_stub'
  // AND agents.primary_trust_key_id IS NULL) can then require
  // explicit attestation before promoting the stub.
  const identity = getIdentityByHandle(normalised);
  const isStub = identity === null;

  const created = v02Agents.createAgent({
    display_name: displayName?.trim() && displayName.trim().length > 0
      ? displayName.trim()
      : normalised,
    primary_handle: normalised,
    primary_trust_key_id: null,
    owner_org: null
  });
  appendAuditEvent({
    kind: isStub ? 'agent.created.via_bridge_stub' : 'agent.created',
    entity_kind: 'agent',
    entity_id: created.agent_id,
    actor_agent_id: created.agent_id,
    actor_runtime_id: null,
    after_json: {
      display_name: created.display_name,
      primary_handle: created.primary_handle,
      // Provenance string distinguishes stub auto-creates from real
      // creations so Stage B sweep tooling can find them. The
      // `is_stub` boolean is the canonical machine-readable flag.
      via: isStub ? 'v02-chatroom-bridge-stub' : 'v02-chatroom-bridge',
      is_stub: isStub,
      // When a known identity DOES exist, surface its identity_id so
      // operators reviewing the audit can confirm the auto-create
      // landed against the right canonical identity row.
      identity_id: identity?.identityId ?? null
    }
  });
  return created.agent_id;
}

/** Compatibility adapter: mirror a room-membership write into clean vNext stores only. */
export function mirrorAddMembership(input: {
  roomId: string;
  handle: string;
  displayName?: string | null;
  role?: V02MembershipRole;
  // M9d: per-room presentation columns mirrored from the legacy
  // chat_room_members write. Optional — when omitted the v0.2 row
  // stores NULL and the read path falls back to the
  // defaultParticipantColor / Icon / BackgroundStyle helpers (same
  // behaviour as chat_room_members rows that pre-date the
  // 2026-05-23 display_* ALTERs).
  displayColor?: string | null;
  displayIcon?: string | null;
  displayBackgroundStyle?: string | null;
  memberKind?: V02MemberKind | null;
  // M9d: per-room display name override mirrored from the legacy
  // chat_room_members.display_name column. NULL = inherit
  // agents.display_name (read path falls back via COALESCE).
  roomDisplayName?: string | null;
}): string | null {
  try {
    if (isDurableMemberHandle(input.handle)) {
      cleanAddMember(input.roomId, input.handle, null);
    }
    if (
      isDurableMemberHandle(input.handle) &&
      (input.memberKind != null ||
        input.roomDisplayName != null ||
        input.displayColor != null ||
        input.displayIcon != null ||
        input.displayBackgroundStyle != null)
    ) {
      setMemberPresentation(input.roomId, input.handle, {
        ...(input.roomDisplayName != null && { room_display_name: input.roomDisplayName }),
        ...(input.displayColor != null && { display_color: input.displayColor }),
        ...(input.displayIcon != null && { display_icon: input.displayIcon }),
        ...(input.displayBackgroundStyle != null && {
          display_background_style: input.displayBackgroundStyle
        }),
        ...(input.memberKind != null && { member_kind: input.memberKind })
      });
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[v02-bridge] mirrorAddMembership failed (legacy unaffected):', err);
    return null;
  }
}

/** Compatibility adapter: update clean member presentation only. */
export function mirrorUpdateMemberPresentation(input: {
  roomId: string;
  handle: string;
  roomDisplayName?: string | null;
  displayColor?: string | null;
  displayIcon?: string | null;
  displayBackgroundStyle?: string | null;
}): boolean {
  try {
    setMemberPresentation(input.roomId, input.handle, {
      room_display_name: input.roomDisplayName,
      display_color: input.displayColor,
      display_icon: input.displayIcon,
      display_background_style: input.displayBackgroundStyle
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[v02-bridge] mirrorUpdateMemberPresentation failed (legacy unaffected):', err);
    return false;
  }
}

/** Compatibility adapter: remove from the clean roster only. */
export function mirrorRemoveMembership(roomId: string, handle: string): boolean {
  try {
    return cleanRemoveMember(roomId, handle);
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
  void handle;
  return null;
}

/**
 * Append a single audit event. Best-effort: never throws (audit writes
 * must not break the chat-room hot paths). Delegates to the shared
 * auditEventsStore (M7.1 PATH 3) so the same kind taxonomy + entity
 * model is enforced across every writer of the canonical
 * `audit_events` table.
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
    appendAuditEventCanonical({
      kind: input.kind,
      entityKind: input.entity_kind,
      entityId: input.entity_id,
      actorAgentId: input.actor_agent_id,
      actorRuntimeId: input.actor_runtime_id,
      after: input.after_json
    });
  } catch {
    // Audit write failed — swallow. Investigate if this fires in production.
  }
}
