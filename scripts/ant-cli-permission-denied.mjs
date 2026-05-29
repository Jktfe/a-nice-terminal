/**
 * ant-cli-permission-denied — Stage A CLI renderer for the structured
 * 403 PermissionDenied payload (plan milestone p3-stage-a-403-payload
 * of ant-substrate-v0.2-2026-05-29).
 *
 * Consumers that hit a 4xx response from the server call
 * `renderPermissionDeniedIfPresent(response, runtime)`; when the body
 * looks like a permission_denied block, it writes the six-line
 * structured response to runtime.writeErr (the human-readable headline
 * + reason + approver(s) + approve_command + optional ant:// URL +
 * optional request_id) and returns `true`. Returns `false` if the body
 * is plain text or otherwise not a permission_denied — caller falls
 * back to the old generic surfacing in that case.
 */

const REASON_HUMAN = {
  no_membership: 'no membership in this room',
  room_closed: 'room is closed (read-only)',
  not_room_owner: 'action requires room owner role',
  not_org_admin: 'action requires org admin role',
  no_grant: 'action requires an explicit grant',
  identity_unresolved: 'caller identity could not be resolved',
  tier_required: 'action requires a premium tier',
  human_consent_required: 'action requires active human consent'
};

function humanizeReason(reason) {
  return REASON_HUMAN[reason] ?? reason;
}

/**
 * Lightweight type guard mirroring isPermissionDeniedPayload from
 * src/lib/server/permissionDeniedPayload.ts. Kept structurally
 * identical so the wire schema can evolve without diverging.
 */
export function isPermissionDeniedBody(value) {
  if (!value || typeof value !== 'object') return false;
  const detail = value.permission_denied;
  if (!detail || typeof detail !== 'object') return false;
  return (
    typeof detail.action === 'string' &&
    typeof detail.target_kind === 'string' &&
    typeof detail.target_id === 'string' &&
    typeof detail.reason === 'string' &&
    Array.isArray(detail.approvers) &&
    typeof detail.approve_command === 'string'
  );
}

/**
 * Render a permission_denied payload to runtime.writeErr. Six lines
 * (head + reason + approver + approve_command + optional approve_url +
 * optional request_id) matching the PR shape in the spec.
 */
export function renderPermissionDenied(payload, runtime) {
  const pd = payload.permission_denied;
  const targetLabel = pd.target_display_name ?? pd.target_id;
  runtime.writeErr(
    `PermissionDenied: cannot ${pd.action} on ${pd.target_kind} ${targetLabel}`
  );
  runtime.writeErr(`  Reason:      ${humanizeReason(pd.reason)}`);
  const preferred = pd.approvers.filter((a) => a.preferred);
  const approverList = (preferred.length > 0 ? preferred : pd.approvers)
    .map((a) => `${a.handle} (${a.role})`)
    .join(', ');
  if (approverList.length > 0) {
    runtime.writeErr(`  Approver:    ${approverList}`);
  } else {
    runtime.writeErr(`  Approver:    (none resolved — contact your org admin)`);
  }
  runtime.writeErr(`  Approve via: ${pd.approve_command}`);
  if (pd.approve_url) {
    runtime.writeErr(`  Or open:     ${pd.approve_url}`);
  }
  if (pd.request_id) {
    runtime.writeErr(`  Request id:  ${pd.request_id}`);
  }
}

/**
 * Attempt to render a permission_denied payload from a Response. Best-
 * effort: reads the body as JSON (cloned so the caller can still drain
 * the original text), checks the shape, and renders if it matches.
 * Returns the rendered payload object on hit, null on miss.
 */
export async function renderPermissionDeniedIfPresent(response, runtime) {
  try {
    const cloned = response.clone ? response.clone() : response;
    const body = await cloned.json();
    if (!isPermissionDeniedBody(body)) return null;
    renderPermissionDenied(body, runtime);
    return body;
  } catch {
    return null;
  }
}
