# R1 ownership-binding — architecture decision (DRAFT for sign-off)

**Status:** decision-needed. `fix/r1-ownership-binding-v3` is GATED on this doc (per @minisearch: "2+ failed patches on the same root cause = the architecture is contested, not just buggy"). Do not merge v3 until this is signed off. Sibling: `docs/concepts/r3-agentid-spine-and-caller-identity-handoff.md`.

## The invariant

Authority gates (permission-approve, ownership) MUST key on the caller's **proven durable `agent_id`**, never on the **self-declared `handle` string**.

Why: after R4a the handle is a **non-unique label any terminal can write**. Pure `approver.handle === caller.handle` string-equality is forgeable — any terminal can self-declare a victim's handle. The durable spine resolves authority as `pidChain → terminal_id → agent_id`, which can only be satisfied by **owning the victim's terminal**. (`src/lib/server/permissionCallerIdentity.ts` — already on main: `resolveAgentIdByTerminalId(terminal.id)`, gate keys on `agentId` not `handle`.)

The invariant is correct and not in dispute. **What's contested is whether the agent_id *binding path* is itself forge-proof** — i.e. can an attacker ESTABLISH a victim's agent_id without owning the victim's terminal? Three attempts have each closed one forge path and been beaten by the next under adversarial-verify (each passed its own green tests — the bar is "the reviewer proves the forge fails end-to-end," not "tests green").

## The three attempts (each green-on-own-tests, each forged)

| Attempt | Commit | What it did | Why it failed |
|---|---|---|---|
| **v1** | `88b21ae` | Authority keys on durable agent_id, not handle | The gate keyed on agent_id, but the agent_id could be **established via the same-name / first-bind path** (`deriveHandle` falls back to `@slug(self-declared name)`) → the "proven" agent_id wasn't proven against a forge. Forge: bind a fresh terminal under the victim's name → obtain an agent_id → pass the gate. |
| **v2** | `fb4e653` | Re-anchor ownership on the R2 session-token binding (close same-name forge) | Closed the static same-name compare, but the **re-anchor itself was a 2-call forge**: bind, then the token re-anchor accepted the contended binding. |
| **v3** | `58177fe` | Refuse fresh-token first-bind to a **contended** terminal (close the 2-call same-name forge) | *Current candidate.* Blocks the 2-call forge's entry point — a fresh token cannot first-bind to a terminal that's already contended. **Not yet adversarially proven** to close the LAST path. |

**The pattern:** each fix closes one forge path; adversarial-verify finds the next. The recurring root is that the handle is forgeable AND the **agent_id-binding path** (how a terminal acquires its agent_id) accepts self-declared input under contention. This is the "spoof trap" — `deriveHandle`'s `@slug(self-declared name)` fallback is the poison; only an exact `terminal_id` match is the real spoof-block.

## The decision (two options)

**Option A — v3 closes the last path. LAND it, with proof.**
v3 refuses fresh-token first-bind to a contended terminal, which is the 2-call forge's only remaining entry. If a dedicated adversarial-verify proves the forge fails end-to-end (try: the 2-call contended-first-bind; a fresh terminal claiming a live handle; re-anchor under contention; the `@slug` derive path), then the invariant holds + v3 is complete → land it. **Bar: the reviewer demonstrates the forge fails through the real surface**, not that v3's own tests are green.

**Option B — the binding path is fundamentally forgeable from self-declared input. Escalate to cryptographic identity.**
If a forge survives v3, stop patching (this would be the 4th patch on the same root cause — the trap). The architecture then needs an identity an agent **cannot self-mint**: binding requires a **server-issued secret** (a token the terminal proves it holds, not a name it declares). agent_id authority becomes "prove possession of the server-issued binding secret," not "resolved from a pidChain that a fresh terminal can establish."

## Recommendation

**Run the dedicated R1 adversarial-verify against v3 first** (the forge attempts above). 
- **Survives → Option A:** land v3; the invariant + the contended-first-bind refusal close the path.
- **Forge survives → Option B:** escalate to server-issued binding secrets; do NOT ship a v4 patch on the same root cause.

This converts "contested architecture" into a falsifiable test: v3 is right iff the forge provably fails. @JWPK signs off the option; @researchant + @minisearch run the adversarial-verify. Owners of the R1 code confirm the forge model.

*Drafted by @researchant (R1 adversarial-verify context) for the sweep disposition; @minisearch co-gating. 2026-06-09.*
