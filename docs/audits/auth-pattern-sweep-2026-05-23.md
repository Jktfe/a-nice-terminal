---
audit_id: auth-pattern-sweep-2026-05-23
title: "API surface auth-pattern audit — 2026-05-23"
status: complete
auditor: "@speedyclaude (Chair)"
audited_at: 2026-05-23
linked_rooms: ["orsz2321qb"]
trigger: exploration-backlog claim
---

# API surface auth-pattern audit — 2026-05-23

## Method

1. Enumerate every `+server.ts` under `src/routes/api/` (227 files).
2. For each file with an `export const GET` handler, grep for the presence of an auth import (`tryAdminBearer`, `requireAuth`, `requireChatRoom*`, `requireMintRoomAccess`, `requirePidChain`, `processIdentityChain`).
3. Live-probe high-suspicion endpoints with NO auth header to capture actual response status + body shape.
4. Classify each leak: **INTENTIONAL** (public-by-design, e.g. feature manifest), **CONFIRMED LEAK** (returns sensitive data unauth), **UNCLEAR** (needs human policy call).
5. Recommend containment-first fixes for confirmed leaks (matching the pattern used by ba8ef34 / 1580ea3).

Read-only investigation; no code changes in this audit.

## ⚠️ Correction (2026-05-23, post-initial-draft)

The initial draft of this audit flagged 6 endpoints as CONFIRMED LEAK based purely on unauth probe responses. Re-reading the source files showed FIVE of those six are **documented as intentionally public** in their handler doc comments. I extrapolated from the validation-schemas + fb43ade leaks (which WERE real "forgot the gate" misses) onto the Plans / cli-hook surface, which is public-by-design.

This is the extrapolation-to-universal-claim anti-pattern banked in [[feedback_extrapolation_to_universal_claim_2026_05_21]]. Lesson re-learned: **read the handler doc comment BEFORE flagging as leak**.

Corrected verdicts below.

## Headline findings (corrected)

| Endpoint                          | Unauth status | Body size  | Verdict                  | Recommendation |
|-----------------------------------|---------------|------------|--------------------------|----------------|
| `GET /api/cli-hook`               | 200           | 395 KB     | **INTENTIONAL (defer-hardened)** | Doc comment: "No positive auth requirement for v1 — loopback-reachable only; firewalling is a later concern." A real hardening conversation is warranted (393KB of session data + transcript paths exposed via loopback), but it's NOT a forgot-the-gate leak. Pursue as a separate slice if loopback no longer holds. |
| `GET /api/plans`                  | 200           | 5.6 KB     | **INTENTIONAL**          | Doc comment: "GET (public) → ?state=active\|archived\|deleted\|all". Plans-index dashboard. No fix. |
| `GET /api/plans/evidence`         | 200           | 35.9 KB    | **INTENTIONAL**          | Doc comment: "Public-read (no auth — same model as /api/plans/completions)". No fix. |
| `GET /api/plans/completions`      | 200           | 1.85 KB    | **INTENTIONAL**          | Plans-index donut feed. No fix. |
| `GET /api/plans/insights`         | 200           | 2.97 KB    | **INTENTIONAL**          | Doc comment: "Public read (no auth — same posture as /api/plans/completions)". No fix. |
| `GET /api/tasks/[taskId]`         | 200           | (varies)   | **NEEDS POLICY CALL**    | No "public" comment, no auth gate. Follows the same dashboard pattern as /api/plans (Lane-D PLANS S1) — likely intentional public-read sibling, but worth a JWPK call before declaring. |
| `GET /api/capabilities`           | 200           | 1.5 KB     | **INTENTIONAL**          | Public feature-flag manifest. Add explicit `visibility: public` comment to make intent grep-able. |
| `GET /api/memory-recall`          | 400           | 39 b       | **UNCLEAR**              | 400 is a validation error before any auth check. Needs code read to determine whether a well-formed unauth call returns 200. |
| `GET /api/consent-grants`         | 401           | —          | OK                       | Correctly gated. |

## Files with `export const GET` and NO auth import (30 found)

Sweep produced this list (full file names below). Each needs human inspection to decide INTENTIONAL vs LEAK vs UNCLEAR. The 6 confirmed leaks above are the highest-priority subset; the remainder are likely a mix of:

- streams scoped to caller's own resource (terminal SSE, agent-state SSE) — likely OK
- pure feature manifests like `/api/capabilities` — intentional
- routes that resolve the caller's identity from a cookie or pidChain inside the handler (not via the named imports above) — false positive of the grep heuristic
- additional leaks like the 6 above

```
src/routes/api/cli-hook/+server.ts                          172 lines — LEAK (confirmed)
src/routes/api/quick-shortcuts/+server.ts                    57 lines — needs probe
src/routes/api/consent-grants/+server.ts                     96 lines — OK (auth-after-validation pattern)
src/routes/api/memory-recall/+server.ts                     138 lines — UNCLEAR
src/routes/api/preferences/room-bookmarks/+server.ts         37 lines — needs probe
src/routes/api/tasks/[taskId]/+server.ts                    148 lines — LEAK (confirmed)
src/routes/api/capabilities/+server.ts                      102 lines — INTENTIONAL
src/routes/api/terminals/handles/+server.ts                  19 lines — needs probe
src/routes/api/terminals/+server.ts                         172 lines — needs probe
src/routes/api/terminals/[id]/settings/+server.ts           165 lines — likely caller-scoped
src/routes/api/terminals/[id]/tasks/+server.ts               24 lines — likely caller-scoped
src/routes/api/terminals/[id]/fingerprint/+server.ts         25 lines — likely caller-scoped
src/routes/api/terminals/[id]/access/+server.ts              45 lines — likely caller-scoped
src/routes/api/terminals/[id]/chatrooms/+server.ts           21 lines — likely caller-scoped
src/routes/api/terminals/[id]/agent-state/stream/+server.ts 237 lines — SSE; likely OK
src/routes/api/terminals/[id]/agent-state/+server.ts         83 lines — likely caller-scoped
src/routes/api/terminals/[id]/stream/+server.ts              64 lines — SSE; likely OK
src/routes/api/terminals/[id]/+server.ts                     69 lines — likely caller-scoped
src/routes/api/terminals/[id]/files/+server.ts               16 lines — needs probe
src/routes/api/terminals/[id]/run-events/stream/+server.ts   64 lines — SSE; likely OK
src/routes/api/terminals/[id]/run-events/+server.ts          83 lines — likely caller-scoped
src/routes/api/terminals/[id]/agent-status/+server.ts       127 lines — likely caller-scoped
src/routes/api/terminals/[id]/memories/+server.ts            21 lines — needs probe
src/routes/api/terminals/[terminalId]/delivery/+server.ts    60 lines — likely caller-scoped
src/routes/api/terminals/[terminalId]/linkedchat/+server.ts  91 lines — needs probe
src/routes/api/discussions/[discussionId]/+server.ts         55 lines — needs probe
src/routes/api/plans/insights/+server.ts                     23 lines — LEAK (confirmed)
src/routes/api/plans/evidence/+server.ts                     37 lines — LEAK (confirmed)
src/routes/api/plans/completions/+server.ts                  40 lines — LEAK (confirmed)
src/routes/api/plans/+server.ts                              56 lines — LEAK (confirmed)
```

## Recommended action sequence (corrected)

1. **No bulk-fix PR.** The 6-leak fix proposed in the initial draft would have BROKEN the Plans dashboard (intentional public-read surface). False alarm; no production code change from this audit.
2. **Single JWPK policy call needed:** `/api/tasks/[taskId]` has no public doc comment but follows the same pattern as `/api/plans`. Confirm intent → add the matching `Public-read` doc comment OR add `requireAuth` if it's meant to be gated.
3. **Hardening discussion (separate slice):** `/api/cli-hook` is documented as "loopback only, firewall later" — that "later" may be now if the server is bound to non-loopback interfaces. Worth a security review, not a quick patch.
4. **Annotation pass** (mechanical, low-risk): add explicit `// visibility: public — <reason>` comments to:
   - `/api/capabilities` (feature-flag manifest)
   - any endpoint whose intent is correct but whose lack of `visibility:` comment caused the initial false-positive in this audit
5. **Lint / process gate:** every `+server.ts` GET must EITHER have an auth helper call OR a `// visibility: public — <reason>` comment. Enforce via test or pre-commit. This prevents the next audit from re-running the same extrapolation.

## Anti-patterns to flag

- **`GET ({})` without `request` destructured** — the grep heuristic catches some but not all. The fb43ade pattern (`requireAuth` defined but not called in GET) recurred in this codebase three times: fb43ade leaks, ba8ef34 fix, and the `validation-schemas` leak. **Suggested process gate:** lint rule or test that every `+server.ts` with a GET either imports an auth helper OR has a top-of-handler visibility comment.
- **Auth-after-validation order** — `/api/consent-grants` returned 401 properly, but `/api/memory-recall` returned 400 first. If validation runs before auth, malformed requests give a different error shape than auth-failing requests, which is a tiny info-leak in itself (you can probe param shape unauthed). Order should be: auth → validate → run.

## Banked decisions to inform follow-up

- [[contracts-distribution-v1]] visibility=premium classification is unchanged by this audit; the leaks are all on OSS surfaces.
- [[project_dictated_directions_2026_05_23]] #3 (schema scope filtering) is the right end-state for `/api/validation-schemas`; the current containment fix is a stopgap. Similar shape applies to `/api/plans` etc. — scope=public could let public plans be readable unauth.

## Source command (reproducible)

```bash
for f in $(find src/routes/api -name "+server.ts"); do
  if grep -q "export const GET" "$f" 2>/dev/null; then
    has_auth=$(grep -cE "tryAdminBearer|requireAuth|requireChatRoom|requireMintRoomAccess|requirePidChain|processIdentityChain" "$f")
    if [ "$has_auth" -eq 0 ]; then
      echo "$f"
    fi
  fi
done
```

## Outputs

- This audit: `docs/audits/auth-pattern-sweep-2026-05-23.md` (this file)
- Inspectable + grep-able next audit cycle
- No code changes; ready to feed a single fix PR when push gate reopens
