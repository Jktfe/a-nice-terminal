/**
 * permissionDeniedPayload — Stage A 403 PermissionDenied payload builder
 * (ratified PR shape 2026-05-29, plan milestone p3-stage-a-403-payload of
 * ant-substrate-v0.2-2026-05-29).
 *
 * North-star property: a 403 from any ANT API endpoint must tell the agent
 * (and the agent's human owner) exactly which permission is missing, who
 * can grant it, and the single CLI command line that grants it.
 *
 * Today's 403 body shape (cryptic):
 *   { "message": "Server-resolved identity required. POST /api/..." }
 *
 * Stage A body shape (structured):
 *   {
 *     "message": "no membership in this room",
 *     "permission_denied": {
 *       "action": "chat.post",
 *       "target_kind": "room",
 *       "target_id": "orsz2321qb",
 *       "target_display_name": "speed matters",
 *       "reason": "no_membership",
 *       "approvers": [...],
 *       "approve_command": "ant grant @speedyc post --room orsz2321qb",
 *       "approve_url": "ant://approve/req_2026-05-29-abc123",
 *       "request_id": "...",
 *       "expires_at_ms": 1780090000000
 *     }
 *   }
 *
 * The CLI render layer (scripts/ant-cli-chat.mjs + sibling verbs) reads the
 * `permission_denied` block and prints the 6-line structured response to
 * stderr so the agent can act on the failure without a Slack ping.
 *
 * Stage B will populate request_id from a real `permission_requests` row,
 * thread modal routing through approvers, and add scope (once / always-for-
 * room / always-for-agent). Stage A treats request_id as forward-compatible
 * scaffolding (always omitted today) and writes grants to the `grants_shim`
 * table (see grantsShimStore.ts), which has the same row shape as the v0.2
 * `grants` table so a migration script can copy rows forward.
 */

export type PermissionDeniedReason =
  | 'no_membership'
  | 'room_closed'
  | 'not_room_owner'
  | 'not_org_admin'
  | 'no_grant'
  | 'identity_unresolved'
  | 'tier_required'
  | 'human_consent_required';

export type PermissionTargetKind = 'room' | 'plan' | 'task' | 'org' | 'system';

export type PermissionApprover = {
  handle: string;
  role: string;
  preferred: boolean;
};

export type PermissionDeniedDetail = {
  action: string;
  target_kind: PermissionTargetKind;
  target_id: string;
  target_display_name?: string;
  reason: PermissionDeniedReason;
  approvers: PermissionApprover[];
  approve_command: string;
  approve_url?: string;
  request_id?: string;
  expires_at_ms?: number;
};

export type PermissionDeniedPayload = {
  /** Human-readable headline. Replaces today's bare 403 body string. */
  message: string;
  permission_denied: PermissionDeniedDetail;
};

export type BuildPermissionDeniedInput = {
  action: string;
  target_kind: PermissionTargetKind;
  target_id: string;
  target_display_name?: string;
  reason: PermissionDeniedReason;
  /** Handle the grant would be issued TO. Used to render the approve_command. */
  grantee_handle: string;
  approvers: PermissionApprover[];
  /**
   * Optional override for the approve_command. Defaults to
   * `ant grant <grantee> <action> --<target_kind> <target_id>`.
   */
  approve_command?: string;
  approve_url?: string;
  request_id?: string;
  expires_at_ms?: number;
  /** Optional override for the headline. Defaults to humanizeReason(reason). */
  message?: string;
};

/**
 * Map a stable reason enum value to a short human-readable phrase. Both
 * server (default payload.message) and CLI (renderer) consume this so
 * agents and humans see consistent wording.
 */
export function humanizeReason(reason: PermissionDeniedReason): string {
  switch (reason) {
    case 'no_membership':
      return 'no membership in this room';
    case 'room_closed':
      return 'room is closed (read-only)';
    case 'not_room_owner':
      return 'action requires room owner role';
    case 'not_org_admin':
      return 'action requires org admin role';
    case 'no_grant':
      return 'action requires an explicit grant';
    case 'identity_unresolved':
      return 'caller identity could not be resolved';
    case 'tier_required':
      return 'action requires a premium tier';
    case 'human_consent_required':
      return 'action requires active human consent';
    default: {
      // Exhaustiveness guard — TypeScript will flag a missing branch.
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Compose the default approve_command. Stage A keeps this simple — one
 * positional grantee, one action verb, one --<target_kind> <id> flag.
 * Stage B may add --once / scope / --request-id arguments.
 */
function defaultApproveCommand(input: BuildPermissionDeniedInput): string {
  // system grants don't carry a flag — the approve command is implicit.
  if (input.target_kind === 'system') {
    return `ant grant ${input.grantee_handle} ${input.action}`;
  }
  return `ant grant ${input.grantee_handle} ${input.action} --${input.target_kind} ${input.target_id}`;
}

/**
 * Build a SvelteKit-ready 403 body. Pass the result straight to
 * `throw error(403, buildPermissionDeniedPayload({...}))` — SvelteKit's
 * HttpError wraps an object body verbatim, so the wire shape is exactly
 * the object returned here.
 */
export function buildPermissionDeniedPayload(
  input: BuildPermissionDeniedInput
): PermissionDeniedPayload {
  const detail: PermissionDeniedDetail = {
    action: input.action,
    target_kind: input.target_kind,
    target_id: input.target_id,
    reason: input.reason,
    approvers: input.approvers,
    approve_command: input.approve_command ?? defaultApproveCommand(input)
  };
  if (input.target_display_name !== undefined) {
    detail.target_display_name = input.target_display_name;
  }
  if (input.approve_url !== undefined) {
    detail.approve_url = input.approve_url;
  }
  if (input.request_id !== undefined) {
    detail.request_id = input.request_id;
  }
  if (input.expires_at_ms !== undefined) {
    detail.expires_at_ms = input.expires_at_ms;
  }
  return {
    message: input.message ?? humanizeReason(input.reason),
    permission_denied: detail
  };
}

/**
 * Type guard for runtime predicates (CLI renderer, error mappers). Returns
 * true iff `value` is shaped like a PermissionDeniedPayload. Cheap — no
 * deep validation, just the fields the renderer reads.
 */
export function isPermissionDeniedPayload(
  value: unknown
): value is PermissionDeniedPayload {
  if (!value || typeof value !== 'object') return false;
  const detail = (value as { permission_denied?: unknown }).permission_denied;
  if (!detail || typeof detail !== 'object') return false;
  const cast = detail as Record<string, unknown>;
  return (
    typeof cast.action === 'string' &&
    typeof cast.target_kind === 'string' &&
    typeof cast.target_id === 'string' &&
    typeof cast.reason === 'string' &&
    Array.isArray(cast.approvers) &&
    typeof cast.approve_command === 'string'
  );
}
