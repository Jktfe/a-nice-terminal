# Two-tier chip UX design — /terminal route — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK annotated screenshot — "Clicking on this should attach a
handle - then it can be called on in ANT - essentially these are tmux
sessions NOT in Ant - anything with a handle should be below."
Anchor: coordinator flowspec audit
(ant-fresh-flowspec-2026-05-13 — POST /api/identity/register, terminalsStore
handle column, two-tier list as canonical contract)

## JWPK verbatim spec (locked)

Two tiers on /terminal route:
- **Top tier**: bare tmux panes WITHOUT a handle. "Tmux sessions, not in
  Ant yet."
- **Bottom tier**: ANT terminals WITH a handle (invitable, @mention-able,
  fanout-routable).

Click top-tier chip → attach handle → chip moves to bottom tier.
Click bottom-tier chip → mounts `TerminalCard` (existing flow).

## Backend contracts — CURRENT vs FUTURE

### CURRENT (T2d delta-2 PASS) — frontend reads today

GET `/api/terminals` returns:
```
{ sessions: string[],
  tmuxSessions: Array<{ sessionId: string }>,
  terminals: TerminalRecord[] }
```
- `sessions: string[]` — back-compat alias for all alive sessionIds
- `tmuxSessions` — array of `{ sessionId: string }` objects for
  daemon-alive panes WITHOUT a terminal_records row
- `terminals: TerminalRecord[]` — has-row entries. Current shape:
  ```
  { sessionId, name, agentKind, autoForwardRoomId, autoForwardChat,
    tmuxTargetPane, linkedChatRoomId,
    createdAtMs, updatedAtMs, alive }
  ```
  (camelCase JSON; `handle` field still future. NOTE: schema NOW also
  has `created_by` + `allowlist` columns per T2-IDENTITY-REGISTER S1
  landed 2026-05-14 — but GET /api/terminals route does not yet PROJECT
  these into the JSON response. S2 will surface them via POST flow.)
- Aliveness filtered server-side via the recordedSet diff

### FUTURE (researchant T2-IDENTITY-REGISTER S2+) — required for two-tier impl

JWPK 2026-05-14 lock — symmetric CLI/HTTP shape for newterminal + attach:

```
ant newterminal   --user H --name N --allow @a --allow @b   → spawn-new
ant attachterminal --session <sessionId> --user H --name N  → wrap-existing
                                       (--allow @h repeatable)
```
(CLI flag spelling per JWPK 2026-05-14 refinement — `--session` named,
`--allow` repeatable. HTTP body field names below unchanged.)

Required schema + endpoint additions:
- `TerminalRecord.handle: string` column — S2/S3 lift; NOT in S1
- `created_by` + `allowlist` in schema (S1 PASS) — not yet projected
  to GET /api/terminals JSON shape; S2 will surface them
- **Route strategy: extend POST /api/terminals** (Option C — does NOT
  touch `/api/identity/register` which remains the PID-chain CLI-
  session route per flowspec). Body shape:
  ```
  { name: string,            // required, human-readable
    user: string,            // creator handle → created_by
    sessionId?: string,      // present = attach existing pane;
                             // absent = spawn new pane
    allowlist?: string[],    // additional handles beyond creator+operator
    agentKind?: string }     // optional fingerprint hint
  ```
  `ant newterminal` / `ant attachterminal` thin-wrap this same route.
- Server-side allowlist guards on existing routes (room invite,
  @-mention fanout, /agent-launch) — caller-in-allowlist check;
  caller==created_by OR caller==operator always allowed

## Frontend deltas (this slice when backend lands)

### /terminal/+page.svelte (~+60L rewrite of attach section)

Two `<section>` blocks under the New-terminal control row:

```
<section aria-label="Tmux sessions, no handle">
  <h3>Attach existing tmux <span class="muted">— not in ANT yet</span></h3>
  {#each tmuxSessions as pane (pane.sessionId)}
    <button class="chip tmux-chip" onclick={() => promote(pane)}>
      {pane.sessionId.slice(0, 12)}…
      <span class="promote-hint">+ attach handle</span>
    </button>
  {/each}
</section>

<section aria-label="ANT terminals">
  <h3>ANT terminals <span class="muted">— handle-bearing, invitable</span></h3>
  {#each terminals as record}
    <button class="chip ant-chip" onclick={() => attach(record)}>
      @{record.handle ?? record.name}
    </button>
  {/each}
</section>
```

### Promotion / claim modal (~+80L)

Used by BOTH paths — top-tier chip click = attach existing pane;
"+ New ANT terminal" button (replaces existing "+ New terminal" label) = spawn-new:

- `user` input (default = current operator handle, e.g. `@you`) — required
- `name` input (default `Terminal HH:MM`) — required
- `agentKind` optional select (claude-code / codex / gemini / aider /
  copilot / other)
- `allowlist` optional tag-input (comma-sep handles) — adds to default
  ACL (creator + operator)
- "Attach" / "Create" submit → POST `/api/terminals` (Option C — does NOT touch `/api/identity/register`); body includes `sessionId` for attach, omitted for newterminal
- On 201 → refresh `loadTerminals()` → chip moves to bottom tier
- On 403 (allowlist deny) → surface error + keep modal open

### TerminalHeader (~+5L delta — handle pill)

Below the name button (rename pencil already lands), show the handle as
a small pill: `@front-3-verify` — copyable on click. Optional for v1,
ship if time allows.

### Empty states

- Top tier empty: "No unattached tmux panes." (one-liner)
- Bottom tier empty: "No ANT terminals yet — click a tmux pane above
  to attach one, or '+ New ANT terminal' to create."

## Locked assumptions (no JWPK gate)

| # | Assumption | Why |
|---|---|---|
| A1 | Two sections vertical-stacked, top first | Matches JWPK screenshot layout |
| A2 | Promote modal opens on chip click (not a separate Promote button) | JWPK said "clicking on this should attach a handle" — direct click |
| A3 | Default `name` = `Terminal HH:MM` (same as create modal) | UX consistency |
| A4 | `agentKind` is OPTIONAL on promote — null means no fingerprint hint | Some tmux panes have no agent yet |
| A5 | Refresh both lists after promote (no animation v1) | Simpler than chip-move-down animation; can polish later |
| A6 | Handle prefix `@` rendered visually but not stored — store handle WITHOUT `@` | Matches v3 mention-resolution convention |

## Trust + safety boundary

- Promote modal does NOT echo back the pane id in the user-visible
  fields — pane is opaque internal
- Handle uniqueness enforced server-side (researchant) — frontend just
  shows error if 409

## Out of scope (deferred)

- Chip-move-down animation — polish slice
- Inline rename of handle (separate from terminal name) — flowspec
  PATCH /api/terminals/[id] { handle } already supports it
- @-mention picker in chat that includes terminal handles — separate
  composer/picker work (researchant T2-LINKED-CHAT companion)
- Bulk-promote all tmux panes — niche
- Hover-preview of pane contents — niche

## Acceptance

- Doc ≤180L; impl awaits researchant T2-IDENTITY-REGISTER S2+ (POST endpoint + handle column projection)
- Page rewrite + claim modal + 2 sections + handle-pill optional
- Browser verify: top section shows unattached panes; click → modal; submit → chip moves down; bottom click → TerminalCard mount; no FRONT-1/2/3 regression

## Companion: FRONT-3v2-5 (agent-launch + linked-chat scope)

Two-tier handles tmux→handle PROMOTION. FRONT-3v2-5 handles in-card
agent-launch + Chat-view linked-chat-room scope. Order: T2-IDENTITY-
REGISTER first (creates handle), then T2-LINKED-CHAT (uses handle).

## Ship order (post-backend)

1. **TWO-TIER-1**: page split into 2 sections + chip styling (~45min)
2. **TWO-TIER-2**: claim modal + POST /api/terminals (Option C) (~1h)
3. **TWO-TIER-3**: handle pill on TerminalHeader + chip label (~30min)
4. **TWO-TIER-4**: browser-runtime acceptance + JWPK feedback (~30min)
