# Agent Permissions for Cross-User Rooms

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #92

## Purpose

JWPK example:

> If I ask for an invoice from the team, does Adele's agent have permission to
> find and share it with my agent? How do we set and manage that?

ANT needs a permissions model for cross-user, cross-agent work where one
person's agent can discover, preview, share, edit, export, or remember
documents on behalf of another person or room. The model must be clear enough
for web, native, and agent clients to render without guessing.

## Recommendation

Use a hybrid model:

1. Room-level defaults decide the normal capability envelope for room members
   and remote agents.
2. Per-document grants override the room default for specific artefacts,
   file refs, memories, or external documents.
3. Per-action capabilities are always returned by the server as portable
   booleans:

```json
{
  "canFind": true,
  "canPreview": true,
  "canShare": false,
  "canEdit": false,
  "canExport": false,
  "canRemember": true
}
```

Clients never infer access locally. They ask the server for a capability
decision, render the allowed actions, and show audit/revocation state.

This aligns with the existing v4 primitives:

- `room_memberships` and `chat_room_members` provide room identity.
- `consent_grants` provide scoped grants, duration, answer budgets,
  consume/revoke, and audit.
- `chat_remote_admissions` and `chat_remote_mappings` provide cross-instance
  remote agent identity and revocation.
- `linked_chat_permissions` proves terminal-scoped allow/deny can be modeled
  without deleting audit history.
- `file_refs` and `chat_room_artefacts` provide document/artefact references.
- `memory_audit` proves mutation surfaces should record who changed what.

## Core Concepts

### Principal

A principal is the actor asking for access.

| Principal type | Example | Proof |
|---|---|---|
| Human handle | `@jwpk` | browser session, room token, admin key, or native session |
| Local agent | `@evolveantcodex` | room membership + terminal identity/pid chain |
| Remote agent | `@adele-agent` | remote mapping bearer + synthetic membership |
| Chair | `@chair` | room role/capability flag |

The permission engine should normalize all of these into:

```ts
type Principal = {
  handle: string;
  kind: 'human' | 'local_agent' | 'remote_agent' | 'chair';
  roomId: string;
  terminalId?: string;
  remoteMappingId?: string;
};
```

### Resource

A resource is the thing being accessed.

| Resource type | Existing v4 surface |
|---|---|
| Artefact | `chat_room_artefacts` |
| File ref | `file_refs` |
| Memory | `memories` |
| Chat message | `chat_messages` |
| External document | future connector/import row |
| Terminal evidence | `terminal_run_events` |

V1 should start with artefacts and file refs because they map directly to the
invoice example.

### Action

Actions are explicit and client-portable:

| Action | Meaning |
|---|---|
| `find` | Search for a matching resource by metadata/content index. |
| `preview` | Show enough detail to confirm relevance. |
| `share` | Send the resource/ref to another agent, room, or human. |
| `edit` | Modify the resource or its metadata. |
| `export` | Download/package outside the room boundary. |
| `remember` | Add facts from the resource to memory/retrieval. |

The Swift/native lane requested the same shape as booleans:
`canFind`, `canPreview`, `canShare`, `canEdit`, `canExport`, `canRemember`.
That should be the response contract.

## Permission Layers

### 1. Room Defaults

Each room gets a default policy for resource classes:

```json
{
  "roomId": "team-finance",
  "defaults": {
    "artefact": {
      "find": "members",
      "preview": "members",
      "share": "owner_approval",
      "edit": "owner_only",
      "export": "owner_approval",
      "remember": "members"
    }
  }
}
```

Suggested policy values:

- `none`
- `members`
- `agents`
- `humans`
- `owner_only`
- `chair_only`
- `owner_approval`

Room defaults answer the common case: "Agents in this room may find and
preview room artefacts, but sharing outside the room needs approval."

### 2. Per-Resource Grants

Specific docs can tighten or loosen the default:

```json
{
  "resourceType": "file_ref",
  "resourceId": "invoice-2026-05",
  "subjectHandle": "@adele-agent",
  "actions": ["find", "preview", "share"],
  "scope": "room:team-finance",
  "expiresAtMs": 1779055400000,
  "maxUses": 3,
  "createdBy": "@adele"
}
```

This maps well to the existing `consent_grants` table:

- `granted_to` -> subject handle.
- `topic` -> action/resource tuple such as `file_ref:share`.
- `source_set` -> resource ids or resource scopes.
- `duration`, `max_answers`, `status` -> expiry/use budget.
- `consent_grant_audit` -> create/consume/revoke trail.

V1 can either extend `consent_grants` with resource fields or introduce a
thin `resource_permission_grants` table using the same lifecycle semantics.
Recommendation: add a dedicated resource grants table, but keep the existing
consent-grant audit vocabulary and helper style. It will be easier to query
by resource and action without overloading `topic`.

### 3. Request-Specific Grants

For async work, a request can carry a narrow temporary grant:

> "Adele's agent may find and share one invoice matching May 2026 with JWPK's
> agent, valid for 24h, max one share."

This is the safest shape for the invoice workflow because it grants enough to
complete the request without creating permanent broad access.

## Capability Decision API

Recommended route:

`POST /api/permissions/check`

Request:

```json
{
  "roomId": "zj4jlety9q",
  "principal": { "handle": "@adele-agent" },
  "resource": {
    "type": "file_ref",
    "id": "invoice-2026-05",
    "ownerHandle": "@adele"
  },
  "requestedActions": ["find", "preview", "share", "edit", "export", "remember"],
  "target": {
    "roomId": "zj4jlety9q",
    "handle": "@evolveantcodex"
  }
}
```

Response:

```json
{
  "roomId": "zj4jlety9q",
  "principalHandle": "@adele-agent",
  "resource": { "type": "file_ref", "id": "invoice-2026-05" },
  "capabilities": {
    "canFind": true,
    "canPreview": true,
    "canShare": true,
    "canEdit": false,
    "canExport": false,
    "canRemember": false
  },
  "decisions": [
    {
      "action": "share",
      "allowed": true,
      "source": "resource_grant",
      "grantId": "rpg_123",
      "expiresAtMs": 1779055400000,
      "usesRemaining": 1
    }
  ],
  "auditSummary": {
    "lastUsedAtMs": 1778969300000,
    "revokedAtMs": null
  }
}
```

Rules:

- Deny by default when no room default or grant applies.
- Per-resource deny overrides room allow.
- Expired/revoked grants never allow.
- Capability checks are read-only unless the caller explicitly asks to
  consume a use budget.

Recommended consume route:

`POST /api/permissions/consume`

Use this only when the action actually happens, for example when the agent
shares the invoice. It records audit and decrements the grant budget.

## Find vs List

JWPK's invoice example needs "find" without giving a remote agent a full
directory listing.

V1 distinction:

- `find`: query by intent or constrained metadata. Returns matches only when
  the caller has `canFind`; snippets/previews require `canPreview`.
- `list`: enumerate a folder, room, or artefact section. This should be a
  separate stronger capability and should not be implied by `find`.

Example:

```json
{
  "query": "May 2026 invoice for Kingfisher",
  "allowedScopes": ["room:team-finance", "owner:@adele"],
  "maxResults": 5
}
```

If `@adele-agent` can find but not preview, it can return:

> "I found 2 likely invoices. Adele approval is needed to preview/share."

If it can preview but not share, it can answer:

> "I found the May invoice and it appears correct. Share approval is needed."

## Sharing Flow

### Direct Grant Exists

1. JWPK asks: "Get the invoice from Adele's team."
2. JWPK's agent creates an async request to Adele's agent.
3. Adele's agent proves remote identity through remote mapping or room token.
4. Server checks `canFind` and `canShare`.
5. Adele's agent finds the invoice.
6. On share, server consumes the grant and writes audit.
7. JWPK's room receives a shared artefact/file-ref card.
8. Adele and JWPK see an audit entry.

### Approval Needed

1. Capability check returns `canFind=true`, `canShare=false`,
   `requiredApproval=owner_approval`.
2. System opens an ask for Adele or the room owner.
3. Approval creates a narrow request-specific grant.
4. Agent retries share; consume route records the grant use.

### Denied

1. Capability check denies `find`.
2. Agent must not confirm whether matching docs exist.
3. It can say: "I do not have permission to search that source."

## Cross-User Agent Identity

Remote identity should build on `remote-ant` mapping rather than ad hoc
shared passwords.

Current useful primitives:

- `chat_remote_admissions`: single-use invite codes with lifetime presets.
- `chat_remote_mappings`: long-lived bridge bearer, direction, expiry,
  revoked state, `last_seen_at_ms`.
- Synthetic terminal + room membership for remote mappings.
- Revoke marks mapping and membership inactive, preserving audit.

Design:

1. The receiving room owner creates a remote admission for Adele's agent.
2. Adele's server redeems it and receives a bridge token.
3. Every cross-user request includes the bridge token.
4. Server resolves the mapping to a principal:
   `remote_agent @adele-agent in room X via mapping Y`.
5. Permission checks use that principal.

This gives revocation and expiry without requiring the remote agent to know
the owner's master API key.

## Async Queue Model

Cross-user work is not always synchronous. Add a request queue:

```ts
type PermissionedWorkRequest = {
  id: string;
  roomId: string;
  requestedBy: string;
  targetHandle: string;
  targetRemoteMappingId?: string;
  status: 'queued' | 'accepted' | 'needs_approval' | 'completed' | 'denied' | 'expired';
  intent: string;
  requestedCapabilities: PermissionAction[];
  resourceHint?: string;
  createdAtMs: number;
  expiresAtMs: number | null;
};
```

Queue behavior:

- Queued request appears in the target room/agent queue.
- Target agent checks capabilities before work starts.
- If approval is needed, the queue item opens or links to an ask.
- Completion attaches shared artefact/file-ref references, not raw local paths.
- Expired/revoked mappings stop the queue item from running.

## Audit Trail

Every permission-sensitive action should append an audit row:

| Event | Required fields |
|---|---|
| capability_check | principal, resource, action, allowed/denied, reason |
| grant_created | grant id, creator, subject, actions, resource/scope |
| grant_consumed | grant id, actor, action, target, use count |
| share_completed | source resource, destination room/handle, actor |
| grant_revoked | grant id, revoked by, reason |
| memory_used | resource, memory key/fact, actor |

Audit rows should be visible in:

- resource detail panel.
- grant detail panel.
- Chair ask/work queue.
- native clients as a compact "why can/can't I do this?" sheet.

## Revocation

Revocation must be immediate and non-destructive.

- Mark grants `revoked_at_ms`, do not delete.
- Mark remote mappings revoked, matching current `remoteMappingStore`.
- Mark synthetic memberships inactive, matching current pattern.
- New capability checks deny revoked grants/mappings.
- In-flight work request moves to `denied` or `needs_approval`.
- Already-shared artefacts remain in audit; optional future policy can
  hide previously shared previews, but the audit remains.

## Memory Semantics

`canRemember` is distinct from `canPreview`.

An agent may be allowed to inspect an invoice to answer a request without
being allowed to write facts from it into long-term memory. When memory is
allowed:

- record the source resource id and grant id on memory audit.
- if a resource or grant is later revoked, new memory recalls should show
  provenance and can be filtered by policy.
- never ingest denied or tombstoned resources.

This matches JWPK's earlier split: memory editing/checking is OSS, but
permission-aware sharing and premium Chair workflows can sit above it.

## UX Surfaces

### OSS / Web

- Basic capability result rendering.
- Raw asks when approval is needed.
- Grant list/revoke surfaces.
- Resource audit trail.

### Premium Native / Chair

- Dedupe similar permission asks.
- Explain capability decisions in plain language.
- Queue cross-agent requests.
- Notify humans when approval is needed.
- Remember organization policy defaults.

## Implementation Slices

### S1 — Capability Engine and Tests

- Add pure `permissionDecisionStore` / `permissionEngine` helper.
- Inputs: principal, room, resource, requested actions.
- Outputs: portable capability booleans + decision reasons.
- Unit tests for room defaults, per-resource grants, revocation, expiry,
  and deny-by-default.

### S2 — Resource Grants

- Add `resource_permission_grants` and `resource_permission_audit` tables,
  or extend `consent_grants` if migration pressure is higher than query
  clarity.
- Routes: create/list/revoke grants.
- Preserve audit vocabulary from `consentGrantStore`.

### S3 — Check / Consume Routes

- `POST /api/permissions/check`
- `POST /api/permissions/consume`
- No client-side guessing; all clients use these routes.

### S4 — Find/Share Workflow

- Add permission-aware find over `file_refs` and `chat_room_artefacts`.
- Add share action that creates/links an artefact card in the destination
  room and consumes the grant.
- Approval-needed path creates an ask.

### S5 — Async Queue

- Queue cross-agent work requests.
- Link request state to asks, grants, and shared artefacts.
- Native/Chair can then add the premium workflow layer.

## Risks

1. **Overbroad room defaults.** Default to find/preview only; share/export
   should require explicit grant or owner approval.
2. **Existence leaks.** `find` can reveal that a document exists. Denied find
   should not confirm existence.
3. **Native drift.** Native clients must not implement their own permission
   inference. They render server capability results.
4. **Grant overload.** Reusing `consent_grants` for every resource action
   could make topic/source strings opaque. Prefer a resource-specific table
   if this becomes central.
5. **Audit volume.** Capability checks can be noisy. Store full audit for
   consume/share/edit/export/remember; sample or summarize read-only checks
   unless needed for enterprise compliance.

## Acceptance Criteria

- Server can answer `canFind`, `canPreview`, `canShare`, `canEdit`,
  `canExport`, and `canRemember` for a principal/resource/action set.
- Adele-agent invoice example can be represented without a permanent broad
  grant.
- Revoked grants and mappings deny new access without deleting audit history.
- Find does not imply list, preview, share, export, edit, or remember.
- Web and native clients can render the same capability response.
- Every share/export/edit/remember action has an audit trail.

## Open Questions

1. Should room defaults be stored on `chat_rooms` as JSON or in a normalized
   `room_permission_defaults` table?
2. Should capability checks themselves be fully audited in OSS, or should
   full read-check audit be enterprise/premium policy?
3. Should `canRemember` default to false for external documents even when
   preview is allowed?

Recommendation: implement deny-by-default, room defaults in a normalized
table, and `canRemember=false` unless a room default or grant explicitly
allows it.
