// auditEntityKind — single source of truth for the audit_events.entity_kind
// CHECK enum (db.ts §audit_events). Co-located with byWormSinkAdapter so the
// BYOWORM envelope can carry a strongly-typed entity kind without each call
// site re-declaring the union.
//
// MUST stay in lockstep with the SQL CHECK constraint. v02-schema.test.ts
// asserts every kind here is also accepted by the table; new entity kinds
// MUST be added in both places in the same commit.

export type AuditEntityKind =
  | 'agent'
  | 'runtime'
  | 'room'
  | 'membership'
  | 'tool_grant'
  | 'identity'
  | 'identity_key'
  | 'recovery_grant'
  | 'permission_request'
  | 'pending_action'
  | 'reclaim_request'
  | 'user_room_preference'
  | 'user_panel_pin'
  | 'system';

export const AUDIT_ENTITY_KINDS: ReadonlySet<AuditEntityKind> = new Set<AuditEntityKind>([
  'agent',
  'runtime',
  'room',
  'membership',
  'tool_grant',
  'identity',
  'identity_key',
  'recovery_grant',
  'permission_request',
  'pending_action',
  'reclaim_request',
  'user_room_preference',
  'user_panel_pin',
  'system',
]);

export function isAuditEntityKind(s: unknown): s is AuditEntityKind {
  return typeof s === 'string' && AUDIT_ENTITY_KINDS.has(s as AuditEntityKind);
}
