# Picker-same-set design — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK EvoluteAnt picker-UX gap — "the ANT terminals should be the
ones that you could attach — i.e., picker source = ANT terminals set."

## Problem

Current `/terminal/+page.svelte` allowlist picker shows 4 items:
3 hardcoded `SYSTEM_HANDLES` (`@coordinator`, `@claude2`, `@researchant`)
plus `terminals.filter(t.handle).map(t.handle)` (1 real handle currently).
Meanwhile the bottom-tier ANT-terminals list shows 40+ records.

Picker source ≠ ANT-terminals tier source → confusing + outdated.

## JWPK lock

Picker source = bottom-tier ANT terminals set (one source-of-truth).
Every ANT terminal is an allowlist candidate.

## Locked assumptions (no JWPK gate)

| # | Assumption | Why |
|---|---|---|
| A1 | Drop `SYSTEM_HANDLES` constant entirely | Hardcoded fakes confuse the model |
| A2 | Picker iterates the same `terminals` array used for bottom tier | Single source-of-truth |
| A3 | Display label = `record.handle` when set, else derived `@slug` of record.name | Lazy fallback until S7 handle backfill or new-terminal handle defaulting |
| A4 | Slug rule: lowercase + non-alphanumeric → `-`, collapse consecutive `-`, trim leading/trailing `-`, prefix `@` | URL-safe, predictable |
| A5 | Skip dead terminals (`alive=false`) | Killed sessions aren't useful allowlist members |
| A6 | Submitted allowlist value = the displayed `@handle-or-slug` string | What you see is what's persisted |

## Frontend deltas

### `/terminal/+page.svelte` (~+15L delta, ~−12L removed)

- Remove `SYSTEM_HANDLES` constant
- Add `function deriveHandle(record): string` — uses `record.handle` if
  non-empty, else `@` + slugify(record.name)
- `availableHandles = $derived` from `terminals.filter(alive).map(deriveHandle)` deduped + sorted
- Picker iteration unchanged (still toggle checkboxes); only the source array changes

```ts
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function deriveHandle(r: TerminalRecord): string {
  if (typeof r.handle === 'string' && r.handle.length > 0) return r.handle;
  return '@' + (slugify(r.name) || r.sessionId.slice(0, 8));
}
```

## Backend (optional, deferred)

Coordinator suggested lazy server-side projection of derived handle in
GET `/api/terminals` response. Frontend implementation above does NOT
require this — works against current S2/S7 shape. If researchant wants
to project it server-side for CLI/external consumers too, that's an
additive slice; frontend will prefer server value if present (via
`record.handle` already).

## Trust + safety boundary

- Derived `@slug` is a display + ACL-key string only; not stored to
  `terminal_records.handle` automatically (S7's column stays explicit)
- Allowlist sent to backend is the displayed string (whether real
  handle or derived slug); S5 `canCallerActOnTerminal` matches against
  this string — must keep slug-derivation rule stable across server +
  client OR researchant adds backend slug helper

## Out of scope (deferred)

- Backfilling existing terminal_records.handle from name (one-shot
  migration; researchant choice)
- Avatar/icon next to each picker pill
- Search/filter input when picker exceeds ~30 items (defer until count
  hurts UX)
- Cross-page picker via `/api/terminals/handles` global endpoint

## Acceptance

- Doc ≤180L
- /terminal page picker iterates same `terminals` array as bottom tier
- Picker count == bottom-tier-ANT-count minus dead
- Submitting allowlist persists the displayed handle strings verbatim
- No regression on FRONT-1/2/3 v1/v2 + KILL-UI + T-AGENT-LIST + THREAD-2
- Browser-runtime verify: create terminal `picker-source-verify` →
  picker shows it as `@picker-source-verify` (derived) → pick + submit
  creating a 2nd terminal → backend allowlist contains the derived value

## Ship order

1. **PICKER-SAME-SET-1**: drop SYSTEM_HANDLES + add deriveHandle + slugify (~15min)
2. **PICKER-SAME-SET-2**: browser-runtime acceptance (~15min)

Total ~30min frontend-only. No backend dependency.
