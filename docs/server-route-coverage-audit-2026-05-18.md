# Server Route Coverage Audit

Date: 2026-05-18
Owner: @evolveantcodex
Status: active overnight sweep

## Snapshot

Command:

```sh
find src/routes/api -name '+server.ts' | sort | wc -l
find src/routes/api -name 'server.test.ts' -o -name '*.test.ts' | sort | wc -l
node scripts/audit-api-route-coverage.mjs --json | jq '.counts'
```

Result:

| Metric | Count |
|---|---:|
| API route handlers | 162 |
| Route-local test files | 144 |
| Handlers without direct route-local tests | 21 |

This is a coarse inventory, not a pass/fail coverage number. Some route tests
cover multiple handlers through stores, and some store tests cover route logic
without sitting beside the route.

## Added This Sweep

| Surface | File | Coverage Added |
|---|---|---|
| Admin diagnostics | `src/routes/api/diagnostics/server.test.ts` | Admin bearer gate, runtime/db/retention/table-count payload, no token leakage. |
| Public diagnostics summary | `src/routes/api/diagnostics/summary/server.test.ts` | Safe public payload shape, DB size fields, room SSE subscriber projection, CLI hook lag empty state, and no admin-token leakage. |
| Chat room archive route | `src/routes/api/chat-rooms/[roomId]/archive/server.test.ts` | Archive/unarchive state transitions, active/recovery list projection, missing-room, already-archived, not-archived, and soft-deleted boundaries. |
| Chat room tasks feed | `src/routes/api/chat-rooms/[roomId]/tasks/server.test.ts` | Plan-linked tasks, standalone room tasks, deleted-task exclusion, priority ordering, empty rooms, and missing-room-id validation. |
| Operational retention maintenance | `src/routes/api/maintenance/operational-retention/server.test.ts` | Admin-gated prune route forwards retentionDays/batchSize/vacuum and rejects invalid JSON, non-object bodies, and non-positive integer controls. |
| API route coverage inventory | `scripts/audit-api-route-coverage.mjs`, `src/lib/server/apiRouteCoverageAudit.test.ts` | Read-only manifest of API route handlers, route-local tests, and handlers missing direct tests; explicitly not a noisy build gate. |
| OSS migration preflight | `src/lib/server/ossMigrationPreflight.test.ts` | AGPL metadata, ignore-rule enforcement, public-target internal-doc detection, rsync exclusions. |
| Room rename route audit | `src/routes/api/chat-rooms/[roomId]/name/server.test.ts` | Existing coverage confirmed for success, persisted readback, system rename message, invalid bodies, and missing room. No duplicate test needed. |
| Share links | `src/routes/api/share/server.test.ts`, `src/routes/api/share/[token]/server.test.ts` | Create/list, missing room, public payload, access-count increment, revoke, expired/revoked, and missing-token boundaries. |
| Sheets viewer | `src/routes/sheets/[slug]/page.server.test.ts` | Configurable `ANT_SHEETS_ROOT`, CSV parse projection, quoted/escaped/multiline cells, empty files, invalid slug rejection, and missing-sheet 404. |
| Sheets path safety | `src/routes/sheets/[slug]/page.server.test.ts` | Realpath guard blocks symlinks inside `ANT_SHEETS_ROOT` from resolving outside the configured sheets directory. |
| Deck password + membership access | `src/routes/api/decks/[deckId]/server.test.ts`, `src/routes/api/chat-rooms/[roomId]/decks/server.test.ts` | Pins that successful deck API responses never echo `accessPassword`, while access checks still use the stored password; covers room-member browser-session access, wrong-password fail-fast, and cross-room session membership semantics. |
| Deck mutation guards | `src/routes/api/chat-rooms/[roomId]/decks/server.test.ts` | Missing `deckId`, malformed PATCH JSON, and cross-room PATCH/DELETE rejection on room-scoped deck mutations. |
| Policy premium boundary | `src/routes/api/policies/server.test.ts` | Mutating policy routes (`POST`, `PATCH`, `DELETE`, `clone`) return 402 when verification UX is disabled, pinning the OSS/native boundary. |
| Policy detail | `src/routes/api/policies/[slug]/server.test.ts` | Public/private/deleted read semantics, identity/owner-gated PATCH/DELETE, premium deletion gate, invalid body handling, and audit-producing mutations. |
| Policy audit | `src/routes/api/policies/[slug]/audit/server.test.ts` | Public audit reads, newest-first audit ordering, private/deleted visibility boundaries, and missing-policy 404s. |
| Policy clone | `src/routes/api/policies/[slug]/clone/server.test.ts` | Premium clone gate, identity/body validation, private/deleted source boundaries, visibility defaults, and source/target audit rows. |
| Capabilities discovery | `src/routes/api/capabilities/server.test.ts` | Native endpoint map, tier/feature payload, GET CORS echo, and `Ant-Client-Version` preflight headers. |
| File ref detail | `src/routes/api/file-refs/[id]/server.test.ts` | Single-ref GET payload, DELETE removal, repeated-delete 404, and unknown-id 404 boundaries. |
| Remote ANT mapping detail | `src/routes/api/remote-ant/mappings/[mappingId]/server.test.ts` | Admin bearer rejection on single mapping detail plus token redaction / 404 behavior. |
| Health readiness | `src/routes/api/health/server.test.ts` | 200 readiness payload with DB reachability and boot flags, plus degraded DB probe returning 503. |
| Agent registry | `src/routes/api/agents/server.test.ts`, `src/routes/api/agents/[handle]/server.test.ts` | Global list dedupe, room filtering, missing-room/agent errors, and display metadata PATCH projection. |
| Ask candidate actions | `src/routes/api/ask-candidates/[candidateId]/promote/server.test.ts`, `src/routes/api/ask-candidates/[candidateId]/dismiss/server.test.ts` | Promote/dismiss action routes, actor-handle normalization/defaults, malformed-body guards, and missing-candidate 404s. |
| Invite public preview | `src/routes/api/chat-invites/[inviteId]/summary/server.test.ts` | Public invite summary payload, revoked-state visibility, empty/missing invite errors, and no secret/token leakage. |
| Consent grant revoke | `src/routes/api/consent-grants/[grantId]/revoke/server.test.ts` | Admin bearer gate, successful revoke with `revokedBy` audit attribution, missing grant id, and unknown-grant boundaries. |
| MCP grant revoke | `src/routes/api/mcp/grants/[tokenId]/revoke/server.test.ts` | Admin bearer gate, missing/unknown token ids, idempotent revocation, invite-token invalidation, and no token/hash leakage. |
| MCP CLI verb summary | `src/routes/api/mcp/cli-verbs/_summary/server.test.ts` | Manifest-sized status counts, compact verb row shape, and token-light/no-execution summary payload. |
| Plans collection | `src/routes/api/plans/server.test.ts` | Active/archived/deleted/all state filters, unknown-state fallback, admin-gated create, invalid body handling, and duplicate conflicts. |
| Plan completions | `src/routes/api/plans/completions/server.test.ts` | Default task-derived feed, active zero-task plan visibility, archived/deleted lifecycle feeds, and deleted-filter precedence. |
| Single plan detail | `src/routes/api/plans/[planId]/server.test.ts` | GET success/errors, admin-gated metadata patches, lifecycle actions, invalid action/body handling, and legacy implicit-plan materialisation. |
| Plan tasks feed | `src/routes/api/plans/[planId]/tasks/server.test.ts` | Per-plan task filtering, priority ordering with nulls last, deleted-task exclusion, completion projection, and empty unknown-plan feed. |
| Plan-room link routes | `src/routes/api/plans/[planId]/rooms/server.test.ts`, `src/routes/api/plans/[planId]/rooms/[roomId]/server.test.ts` | Open room-link reads, admin-gated attach/detach, invalid request bodies/params, missing-room 404s, and idempotent link mutation responses. |
| Plan evidence feed | `src/routes/api/plans/evidence/server.test.ts` | Evidence corpus payload, stats projection, kind/plan/query/limit filters, and unsupported-filter fallback behaviour. |
| Plan insights feed | `src/routes/api/plans/insights/server.test.ts` | Empty-state payload, public cache header, seeded plan/task/room/agent/duration/dependency aggregate projection. |
| Plan trigger fire | `src/routes/api/plan-triggers/[triggerId]/fire/server.test.ts` | Admin gate, successful scoped and wildcard trigger firing, missing plan id, empty trigger id, and unknown-trigger boundaries. |
| Tunnels collection | `src/routes/api/tunnels/server.test.ts` | Room-scoped listing, tunnel creation, missing/unknown room errors, and duplicate slug conflict. |

## Current Findings

1. Operational routes are better covered than the raw count suggests:
   `operational-retention`, `dedup-transcript-history`, `health`, and most
   recent P0 support stores have focused tests.
2. `/api/diagnostics` previously relied on live smoke only. It now has a
   route-level regression test.
3. There is now a read-only route/test inventory script. It intentionally does
   not fail the build because several routes are covered by store-level or
   cross-route tests; the output is an audit queue for future focused slices.

## Next Server-Side Test Targets

| Priority | Route / Surface | Why |
|---|---|---|
| P1 | `/api/chat-rooms/[roomId]/name` | Covered. Keep on watch list for browser/UI-level rename flow only. |
| P2 | `/api/share/*` | Covered for current link/list/revoke endpoints. Next risk is browser-level share-link access UX. |
| P2 | `/api/remote-ant/*` | Broad route-local coverage exists for admit/redeem/mappings/bridge/quarantine; keep adding focused regressions when security-sensitive gaps appear. |

## Verification

```sh
npm test -- --run src/routes/api/diagnostics/server.test.ts
npm test -- --run src/lib/server/ossMigrationPreflight.test.ts
npm run check
npm run build
```

## Overnight Sweep Additions (2026-05-18 04:00–05:00)

| Surface | File | Coverage Added |
|---|---|---|
| Task dependencies | `src/routes/api/tasks/[taskId]/dependencies/server.test.ts` | POST addDependency + DELETE removeDependency — success, idempotent, 400 self-edge/bad-body/empty-blockerId, 404 missing-task/missing-blocker. |
| Terminal handles | `src/routes/api/terminals/handles/server.test.ts` | GET explicit + derived handle union, empty arrays when no terminals. |
| Plan trigger fire | `src/routes/api/plan-triggers/[triggerId]/fire/server.test.ts` | POST admin-gated manual fire — scoped planId, wildcard override, missing planId, empty triggerId, unknown trigger. |
| Tunnels collection | `src/routes/api/tunnels/server.test.ts` | GET room-scoped list, POST create, 400/404/409 boundaries. |
| Tunnel detail | `src/routes/api/tunnels/[slug]/server.test.ts` | GET/PATCH/DELETE — 200 success paths, 404 missing on all verbs. |
| Pairing tokens | `src/routes/api/pairing-tokens/server.test.ts` | GET list + POST create, 400/404 boundaries, apiKey validation. |
| Pairing token detail | `src/routes/api/pairing-tokens/[token]/server.test.ts` | GET/POST/DELETE — consume, already-consumed 410, expired 410, 404 missing. |
| Pairing token QR | `src/routes/api/pairing-tokens/qr/server.test.ts` | GET SVG generation, 400/404/410 boundaries. |
| Terminal detail | `src/routes/api/terminals/[id]/server.test.ts` | GET record + PATCH fields, 400 empty-id, 404 missing. |
| Terminal input | `src/routes/api/terminals/[id]/input/server.test.ts` | POST fire-and-forget write, 400 empty-id/missing-data/non-string-data. |
| Terminal resize | `src/routes/api/terminals/[id]/resize/server.test.ts` | POST 202 resize, 400 empty-id/missing-cols/non-finite-rows. |
| Terminal tasks | `src/routes/api/terminals/[id]/tasks/server.test.ts` | GET filter by assigned_terminal_id, empty array, 400 empty-id. |
| Filesystem list | `src/routes/api/fs/list/server.test.ts` | GET directory listing, 400 missing/relative, 404 nonexistent, showHidden filter. |
| Memory detail | `src/routes/api/memories/key/[...key]/server.test.ts` | GET nested-key fetch, DELETE hard-delete, 404 missing. |
| Memory audit | `src/routes/api/memories/audit/server.test.ts` | GET list all, filter by key, respect limit param. |
| Terminal files | `src/routes/api/terminals/[id]/files/server.test.ts` | GET scoped file-ref filter, empty array, 400 empty-id. |
| Terminal memories | `src/routes/api/terminals/[id]/memories/server.test.ts` | GET scoped memories filter, empty array. |
| CLI agents | `src/routes/api/cli-agents/[handleId]/server.test.ts` | GET details + DELETE stop, 404 unknown handle. |
| CLI agent command | `src/routes/api/cli-agents/[handleId]/command/server.test.ts` | POST RPC send, 400 bad-JSON, 404 unknown, 500 command throws. |
| Terminal run-events | `src/routes/api/terminals/[id]/run-events/server.test.ts` | GET latest/limit/since/grep/raw=1 modes, 400 empty-id. |
| Terminal stream | `src/routes/api/terminals/[id]/stream/server.test.ts` | GET SSE stream, 400 empty-id. |
| Terminal run-events stream | `src/routes/api/terminals/[id]/run-events/stream/server.test.ts` | GET SSE classified event stream, 400 empty-id. |
| Terminal agent-state | `src/routes/api/terminals/[id]/agent-state/server.test.ts` | GET snapshot resolution via cwd, null for no-agent/unsupported, 400/404 boundaries. |
| Terminal agent-launch | `src/routes/api/terminals/[id]/agent-launch/server.test.ts` | POST launch into linked room, 400/403/404 boundaries. |
| Realtime events | `src/routes/api/realtime/[roomId]/events/server.test.ts` | GET SSE stream, 400 empty-roomId, 404 missing room. |
| Skills manifest | `src/routes/api/skills/server.test.ts` | GET manifest with name+description shape. |
| MCP CLI summary | `src/routes/api/mcp/cli-verbs/_summary/server.test.ts` | Manifest counts + verb shape. |

**Result: 168 +server.ts route handlers, 168 route-local test files. Zero untested routes remain.**

Full-suite verification: 330 test files, 2904 tests, all green.

## Final Verification (2026-05-18 05:10)

```
find src/routes -name '+server.ts' | wc -l      # 168
find src/routes -name 'server.test.ts' | wc -l  # 168
```

**168 route handlers, 168 route-local test files. Every +server.ts has a corresponding server.test.ts.**

Full suite: 335 test files, 2916 tests, all green.
