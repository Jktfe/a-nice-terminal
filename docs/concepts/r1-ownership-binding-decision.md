# R1 ownership-binding — architecture decision (DRAFT for sign-off)

**Status:** decision-needed. `fix/r1-ownership-binding-v3` is GATED on this doc (per @minisearch: "2+ failed patches on the same root cause = the architecture is contested, not just buggy"). Do not merge v3 until this is signed off. Sibling: `docs/concepts/r3-agentid-spine-and-caller-identity-handoff.md`.

**Decision (post-amendment): Option B.** The adversarial trace below shows v3 closes the *session-token* forge but NOT the *agent_id bootstrap* forge that runs upstream of it at register time. Option A is therefore not expected to survive adversarial-verify. See "The bootstrap-forge finding" and the amended Option B.

## The invariant

Authority gates (permission-approve, ownership) MUST key on the caller's **proven durable `agent_id`**, never on the **self-declared `handle` string**.

Why: after R4a the handle is a **non-unique label any terminal can write**. Pure `approver.handle === caller.handle` string-equality is forgeable — any terminal can self-declare a victim's handle. The durable spine resolves authority as `pidChain → terminal_id → agent_id`, which can only be satisfied by **owning the victim's terminal**. (`src/lib/server/permissionCallerIdentity.ts` — already on main: `resolveAgentIdByTerminalId(terminal.id)`, gate keys on `agentId` not `handle`.)

The invariant is correct and not in dispute. **What's contested is whether the agent_id *binding path* is itself forge-proof** — i.e. can an attacker ESTABLISH a victim's agent_id without owning the victim's terminal? Three attempts have each closed one forge path and been beaten by the next under adversarial-verify (each passed its own green tests — the bar is "the reviewer proves the forge fails end-to-end," not "tests green").

## The three attempts (each green-on-own-tests, each forged)

| Attempt | Commit | What it did | Why it failed |
|---|---|---|---|
| **v1** | `88b21ae` | Authority keys on durable agent_id, not handle | The gate keyed on agent_id, but the agent_id could be **established via the same-name / first-bind path** (`deriveHandle` falls back to `@slug(self-declared name)`) → the "proven" agent_id wasn't proven against a forge. Forge: bind a fresh terminal under the victim's name → obtain an agent_id → pass the gate. |
| **v2** | `fb4e653` | Re-anchor ownership on the R2 session-token binding (close same-name forge) | Closed the static same-name compare, but the **re-anchor itself was a 2-call forge**: bind, then the token re-anchor accepted the contended binding. |
| **v3** | `58177fe` | Refuse fresh-token first-bind to a **contended** terminal (close the 2-call same-name forge) | *Current candidate.* Blocks the 2-call forge's entry point — a fresh token cannot first-bind to a terminal that's already contended. **Closes the session-token forge, but NOT the agent_id bootstrap forge that runs UPSTREAM of it** (see next section). v3's `SessionFirstBindContended` probe lives inside session-ensure, *downstream* of `bootstrapV02Identity`. |

**The pattern:** each fix closes one forge path; adversarial-verify finds the next. The recurring root is that the handle is forgeable AND the **agent_id-binding path** (how a terminal acquires its agent_id) accepts self-declared input. This is the "spoof trap" — `deriveHandle`'s `@slug(self-declared name)` fallback is the poison; only an exact `terminal_id` match is the real spoof-block.

## The bootstrap-forge finding (why v3 is not enough)

The R3 sibling doc (`docs/concepts/r3-agentid-spine-and-caller-identity-handoff.md`, `e67f53f` on main, @v4claude) surfaces the last open path, and it sits **upstream of every v3 probe**:

- `bootstrapV02Identity` (`src/lib/server/v02RegisterBootstrap.ts:159`) resolves the agent by handle: `let agent = v02Agents.getLiveAgentByHandle(handle)` (`:171`); `if (!agent) agent = v02Agents.createAgent(...)` (`:174`). A **repeated handle REUSES the existing agent** — `getLiveAgentByHandle` returns the live row keyed on the self-declared handle.
- So `ant register --handle @victim` from a fresh terminal binds the new runtime to the **victim's `agent_id` at register time**, *before* any `ensureSession` / `SessionFirstBindContended` probe runs. v3's contended-first-bind refusal never sees this: the forge does not *contend* on a session token — it forges the agent itself at bootstrap.
- Today the attestation is a **placeholder, not a proof**: `bootstrapV02Identity` writes `challengeProof = "pre-v02-attestation:" + input.legacy_terminal_id` (`src/lib/server/v02RegisterBootstrap.ts:199`; format documented at `:63`). That is a name-derived string, not a server-issued secret — nothing an attacker cannot also produce.

**Predicted forge against v3 (forge-A):** fresh token → `ant register --handle @victim` → `bootstrapV02Identity.getLiveAgentByHandle('@victim')` returns the victim's `agent_id` → new runtime bound to that agent_id → caller→agentID resolver returns the victim's agentId → the `caller.agentId === approver.agentId` gate **passes for the attacker.** v3's refusal is downstream and never fires. This is the path the doc's own bar — *the reviewer demonstrates the forge fails through the real surface* — is expected to fire on.

## The decision (two options)

**Option A — v3 closes the last path. LAND it, with proof.** *(Not expected to survive.)*
v3 refuses fresh-token first-bind to a contended terminal. But the bootstrap-forge finding above shows the agent_id is established at `bootstrapV02Identity` *before* v3's probe runs, so v3 cannot close forge-A. Option A only holds if an adversarial-verify proves forge-A *also* fails end-to-end — which the trace above predicts it will not. **Bar: the reviewer demonstrates the forge fails through the real surface**, not that v3's own tests are green.

**Option B — bind to a server-issued secret the agent cannot self-mint. (Recommended; partially built on main.)**
The agent_id binding must require an identity the terminal **proves it holds**, not a name it declares. This is **already substantially on main** and the doc references it rather than inventing a new path:
- `ant_sessions` (Simplify & Harden A1, `a9a8b2d7`) carries a **durable session id not derived from pid/pid_start** plus `terminal_id` set on create.
- `createSession({ kind, terminalId, sessionToken })` (`src/lib/server/antSessionStore.ts:135`) is the mint; `ensureSession` (`:187`) is immutable-on-resolve — re-resolving a token against a *different* terminal throws `SessionAdoptionRefused` (`:197`). That immutability is exactly the anti-adoption anchor (`3e99ea0` + ALTER-migration `3aead0c`) — the "identity an agent cannot self-mint" Option B requires.

**The fix:** `bootstrapV02Identity` currently writes the `pre-v02-attestation:<legacy_terminal_id>` placeholder (`v02RegisterBootstrap.ts:199`); the v0.2 cutover replaces that placeholder with the **real session-token attestation at register time**, so the binding becomes:

```
pidChain → terminal_id → session.id → session.token_proof
```

token-bound, not name-bound. The R3 doc's `resolveAuthoritativeCallerIdentity` (keyed off `session.agent_id` once it exists) is the natural consumer. agent_id authority then means "prove possession of the server-issued session token," not "resolved from a pidChain a fresh terminal can establish by declaring a handle."

## Adversarial-verify gate (the bar for sign-off)

The forge must cover the `bootstrapV02Identity` path, **not just `ensureSession`**:
- **forge-A** = fresh token + `ant register --handle @victim` + trace through `bootstrapV02Identity.getLiveAgentByHandle` (`v02RegisterBootstrap.ts:171`) → **expected to PASS for the attacker** → kills Option A.
- **forge-B** = fresh token + `register → session.create` with **no possession of the victim's existing session token** → **expected to FAIL** at `session.token_proof` (`SessionAdoptionRefused`, `antSessionStore.ts:197`) → validates Option B.

A patch is only complete when forge-A fails end-to-end through the real surface. v3's own green tests do not clear this bar.

## Recommendation

**Adopt Option B.** The bootstrap-forge trace shows v3 cannot close forge-A (the agent_id is bound at `bootstrapV02Identity` upstream of every v3 probe), so a v4 patch on the session path would be the 4th attempt on the same root cause — the trap @minisearch named. Instead, replace the `pre-v02-attestation` placeholder (`v02RegisterBootstrap.ts:199`) with the durable session-token attestation (`antSessionStore.ts:135`/`:197`) at register time, making the binding token-bound (`pidChain → terminal_id → session.id → session.token_proof`).

Run forge-A and forge-B as the falsifiable gate before merge. @JWPK signs off the option; @researchant + @minisearch run the adversarial-verify. Owners of the R1 code confirm the forge model.

*Drafted by @researchant (R1 adversarial-verify context) for the sweep disposition. Amended 2026-06-09 to fold in @minisearch's bootstrap-forge finding (msg_wxntb2ltcf) — Option A retired, Option B selected and pathed against main with file:line citations; co-signed @minisearch + @researchant.*
