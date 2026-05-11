# Multi-agent delivery protocol

How two AI coding agents (an implementer + an alignment-reviewer)
deliver a multi-phase refactor without breaking contracts. This is
the protocol that closed `server-split-2026-05-11` across PRs
#31–#36 with seven BLOCKERs raised and zero broken-contract merges.

Read this if you:
- are about to drive a multi-phase code change with another agent
  reviewing
- are about to review another agent's multi-phase work
- want to understand why the room shows "Phase X PASS" + "BLOCKER
  on Phase Y" message patterns

## The role split

Two roles. James names them once at the start of a lane:

- **Implementer.** Owns code momentum, milestone claims, atomic
  commits, force-pushes for in-scope fixes. Posts the "claiming X /
  shipping X / ready for review" updates.
- **Reviewer (alignment partner).** Owns summaries, milestone
  hygiene, plan-state integrity, BLOCKER calls. Holds acceptance at
  `planned` until the contract genuinely holds. Posts the
  "BLOCKER / PASS" updates.

The implementer never flips their own acceptance. The reviewer
never pushes code to the implementer's branch.

The cap-2 protocol works because the two roles share a *plan*
(below) and a *room* (the team chat), not because they share files.

## The canonical plan is an event log

Plans live as run-time events in ANT's plan log, not as a Notion
doc or a markdown file. The reviewer can `ant plan show <plan_id>
--json` and see the live state of every milestone.

Stand up the plan as the FIRST step of a new lane:

```sh
URL="https://127.0.0.1:6458/api/plan/events"; SID="<room-id>"
curl -sk -X POST "$URL" -H 'Content-Type: application/json' -d '{
  "session_id":"'$SID'",
  "kind":"plan_section",
  "text":"<title>",
  "payload":{
    "plan_id":"<slug>-YYYY-MM-DD",
    "title":"...",
    "order":1,
    "status":"active",
    "body":"<paragraph framing the lane>"
  }
}'

# Then one plan_milestone + plan_acceptance per phase
# Then optionally one plan_test per acceptance for the test gate
```

Rules:
- **Milestone IDs are set at creation, never derived at closure.**
  Read them back via `ant plan show` before flipping state.
- **Sections, milestones, acceptances, and tests are separate
  event kinds.** Don't collapse them. Each acceptance lists the
  exact contract the reviewer will gate on.
- **One canonical plan per lane.** Don't fork variants. Archive a
  superseded plan rather than running two in parallel.

## Six-phase shape, sequential

Phases land in order. Each phase produces a working, reviewable,
revertable PR — *not* parallel deliverability. Concurrent work on
adjacent phases risks contract drift.

| Phase | Scope | Output |
|---|---|---|
| **M0** doc gate | Address review clarifications on the spec doc BEFORE any code lands | Doc PR merge-ready |
| **A** persist / scaffolding | Pure refactor or schema addition; no behaviour change | Code PR + new test file pinning the contract |
| **B** owner | Move logic into the new layer; preserve all existing behaviour | Code PR + integration tests unchanged |
| **C** wiring | Connect the layer to runtime (server boot, intervals, endpoints) | Code PR + load-bearing-invariant tests |
| **D** outer surface | CLI / API / UI consumes the new contract | Code PR + end-to-end auth tests |
| **E** docs + cleanup | Reference doc + AGENTS.md convention + call-site audit | Doc PR + audit table |

Phase B's PR is **based on Phase A's branch**, not on `main`.
Phase C is based on B's branch. And so on. The PR diff shows only
the phase delta; GitHub auto-rebases the chain when earlier PRs
merge.

```
main
  └─ M0 (PR #31)
       └─ A (PR #32)
            └─ B (PR #33)
                 └─ C (PR #34)
                      └─ D (PR #35)
                           └─ E (PR #36)
```

## The implementer's commit-and-PR loop per phase

1. **Claim:** post in room "Claiming `<milestone-id>` now. Scope:
   ..." and emit a `plan_milestone` event with `status: active`,
   `owner: @<your-handle>`.
2. **Branch:** `git switch -c <handle>/<plan-slug>-phase-<x>
   <previous-phase-branch>`.
3. **Code:** atomic edits. Helpers and their callers land in the
   same Edit batch or the same commit. Stash any unrelated WIP via
   `git stash push -- <files>` before staging.
4. **Gates:** `bunx svelte-check`, focused test file, full lane
   test set, `bun run build`. All must pass.
5. **Commit:** structured message naming the milestone, listing what
   landed and what stayed inline for a later phase. Add
   `Co-Authored-By:` for AI attribution.
6. **Push:** `git push -u origin <branch>`.
7. **PR:** `gh pr create --base <previous-phase-branch>` so diff is
   delta-only.
8. **Plan flip:** emit `plan_milestone` event with `status: done`.
   **Do NOT touch `plan_acceptance`** — that's the reviewer's call.
9. **Room post:** structured update:
   ```
   Phase X shipped: <hash> <title>. PR <n> opened against <base>.

   What landed:
   - bullet
   - bullet

   BLOCKER awareness from your list: <each item, addressed or N/A>

   Gates: svelte-check 0/0, focused N/N, build clean. Canonical
   milestone now done; acceptance stays planned pending your review.
   ```

## The reviewer's BLOCKER protocol

`bun run check` green is **not** sufficient. Every BLOCKER raised
on this lane passed CI. The reviewer is reading for invariants the
test suite doesn't express. Standard BLOCKER classes for any
multi-phase refactor:

| BLOCKER class | What it means |
|---|---|
| Auth bypass | A path skips the auth gate or its equivalent |
| Replay creates new asks | Tier ownership violation — replay does Tier 1 work |
| Non-idempotent fanout | A side effect can double-fire under retry |
| Stale PTY injection | Old content reaches a running stdin |
| Parallel edits same slice | Two agents editing the same region |
| Singleton not on globalThis | Module-local state instead of `globalThis[key] ??= ...` |
| Scope leak | PR includes commits from a different lane |
| Contract claim vs implementation mismatch | Doc says X, code does Y |

For each BLOCKER the reviewer raises:
1. **Implementer acks within one minute** with reasoning. Not "ok",
   not "fixing it" — explicit recognition that the contract claim
   is real.
2. **Implementer proposes the fix shape** before writing it. The
   reviewer often has a specific recipe; aligning before implementing
   saves a round-trip.
3. **Implementer fixes on the SAME branch.** Force-push if amending
   an in-scope commit; new commit if it's a distinct issue.
4. **Implementer re-runs gates** and posts: "Pushed `<new-hash>`.
   What changed: ... Gates re-green: ... Ready for re-review."

The reviewer flips `plan_acceptance` to `passing` only after the
fix satisfies the contract claim — not just after CI is green.

## Atomic-helper-caller invariant

Never push half a relationship into a shared tree. Helper + caller
land in the same Edit batch or the same commit. If two agents work
in the same repo, the cap-2 reviewer's `git status` sees your
uncommitted dirty files and breaks their gate.

Pattern violation that causes this: writing a new function call
that depends on a helper that doesn't exist yet, then saving the
caller, then forgetting to commit before the reviewer checks out
the branch. Solution: either save both in one Edit, OR commit the
helper first.

## Force-push for fix-ups, additive commits for new scope

When a fix is in-scope for the existing commit (a typo, a missing
test, a comment cleanup, a regression fix that completes the
original change):

```sh
git add <files>
git commit --amend --no-edit
git push -f origin <branch>
```

When a fix is a distinct issue uncovered during review (new
behaviour, separate concern):

```sh
git commit -m "fix(...): address codex BLOCKER on ..."
git push origin <branch>
```

Force-push is acceptable because the branch is unmerged and only
the reviewer sees it. Once merged to main, never force-push.

## When the implementer absorbs the reviewer's lane

If the reviewer doesn't claim a milestone within a reasonable
window (the room is quiet, no claim posted), the implementer can
absorb the lane:

1. **Post a heads-up:** "Noted X is unclaimed. Picking it up
   myself if no objection in 10 minutes. The reviewer slot stays
   open — they can BLOCKER me afterward as normal."
2. **Claim the milestone** following the standard flow.
3. **Honour the BLOCKER list** as if the reviewer were watching.
   The reviewer's invariants don't disappear when they're idle.

If both agents are active and want the same milestone, the room
arbitrates by post order — first claimant wins, second one picks
a different lane.

## Failure modes to watch for

- **Tests-pass-as-shipping-criterion fallacy.** Every BLOCKER in
  a well-run lane passes CI. The reviewer is checking invariants
  the test suite doesn't express.
- **Module-local state for new singletons.** AGENTS.md rule #1 says
  `globalThis` is mandatory. Hot reload + mixed import paths
  duplicate module records; module-local `let` carries that drift
  silently.
- **Citation drift in plan docs.** Line numbers shift across phases.
  Anchor citations to a commit SHA in the doc ("post `<sha>`"). The
  implementer re-pins line numbers in commit messages, not in the
  doc, so the doc stays stable.
- **Doc claims unbacked by code.** Match doc to code at the same
  instant the code lands. The reviewer will check both halves.

## Reference: the lanes this protocol has closed

- `main-app-improvements-2026-05-10` — 9 milestones, solo claude
  (codex never claimed parallel lanes). Showed the implementer can
  cycle the BLOCKER protocol on themselves but it's stronger with
  two agents.
- `server-split-2026-05-11` — 6 milestones (M0 + A through E),
  cap-2 with codex. 7 BLOCKERs raised, all addressed, 74 tests /
  179 expect()s, zero broken-contract merges. The canonical
  example.

## See also

- `AGENTS.md` rule #10 — short summary of the three-tier pattern
  from server-split-2026-05-11.
- `docs/persist-tier-lifecycle.md` — the reference doc that came
  out of Phase E. Read it as an example of a phase-E artefact.
- Memory notes (private):
  - `feedback_multi_agent_factory_protocol.md` — v1, older patterns
    around 6-field claims and staged-stat guards.
  - `feedback_multi_agent_factory_protocol_v2.md` — v2 (this
    protocol).
  - `feedback_atomic_helper_caller.md` — never push half a
    relationship into a shared tree.
  - `feedback_globalthis_pattern.md` — singletons must be on
    `globalThis`.
  - `feedback_canonical_plan_discipline.md` — one canonical plan
    per lane; archive duplicates fast.
  - `feedback_milestone_id_drift.md` — read canonical IDs via
    `ant plan show --json` before flipping state.
