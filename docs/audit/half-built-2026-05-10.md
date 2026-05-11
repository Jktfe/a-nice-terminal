# Half-built sweep — 2026-05-10

A3 of `main-app-improvements-2026-05-10`. Read-only audit; nothing is
finished or cut by this document — it ranks open lanes by *current
shape vs current commitment* and recommends finish-or-cut for each.

The exercise mirrors the antios-improvements deck's "two half-built
things — finish or cut" rule applied to the main app.

## Methodology

1. Walk every `ant task list` entry with status `proposed` or
   `assigned` in room `O393IH1zFgd_nujpQgnof`.
2. Cross-reference each task against the canonical plan via
   `ant plan show --json` to detect tasks that are stale shadows of
   work that already landed under a different milestone.
3. Walk MEMORY.md feedback/project entries that document known
   open-but-not-tracked gaps.
4. `grep -RnE 'TODO|FIXME|HACK' src/ cli/` for code-level markers.

The audit produced 1 TODO comment in the whole codebase
(`src/drivers/codex-cli/driver.ts:53` — a spec-validation note, not
half-built code). The discipline level is genuinely high; the
half-built surface is mostly *tracking-state drift* and *deferred
plans*, not partly-shipped features.

## Finish-or-cut decisions

### Stale shadow tasks (cut: close as duplicates of landed work)

These tasks are still `proposed`/`assigned` even though the
underlying work shipped under a different milestone or plan.

| Task | Title | Why stale |
|---|---|---|
| `GWeI5xYi` | Fix trailing @ in composer kills message delivery | Already fixed by task `xwnla41k` (complete) under the composer-mention-bugs lane. |
| `NXogaWOk` | Include remote-ant handles in @ autocomplete | Already shipped by `YYdFdRzV` (complete). |
| `L3wYInR3` | M4: Default Agent setting wire or remove | `antios-v2-readiness-2026-05-10#m4-default-agent` is **done**; the setting was removed (−166 line cleanup). |
| `d52rphhY` | M8: Room artefacts panel | `antios-v2-readiness-2026-05-10#m8-room-artefacts` is **done** (`RoomArtefactsView` shipped). |
| `7wXKV00F` | M11: Invite/manage agents from phone | `antios-v2-readiness-2026-05-10#m11-invite-manage-agents` is **done** (`InviteManagementView` + `ParticipantManagementView` shipped). |
| `FpamrcoL` / `BTY5rAC9` / `gai-WONz` / `spH_j1PB` | Task provenance audit / capture actor / verify / link to plans | Effectively done under `cli-task-lifecycle-2026-05-08` (all three milestones complete). `task-provenance-plan-linking-2026-05-08` is a parallel never-progressed plan and should be archived. |

**Recommendation:** close these eight tasks with a one-line "landed
under <plan>#<milestone>" comment so the task list reflects reality.
Total time: <15 minutes. No code change.

### Defer-with-known-gap (acknowledge but do not start)

| Lane | Why defer |
|---|---|
| `DcO3fG1A` Record multi-agent contract-sync demo GIF | James-led capture; agents cannot produce it from this seat. Keep proposed, no agent activity until James drives the recording. |
| `OT4S1cmp` M7 mobile terminal + shortcuts strategy | Strategy decision required first ("does mobile own terminal at all?"). Not a code lane until that's settled. |

### Finish (real open work to schedule)

| Lane | Cost shape | Recommendation |
|---|---|---|
| `JQFxjoBs` M5 dashboard filtering + pinning | Likely a web-mobile equivalent of the antios M2 fix that just shipped. Worth 2-3 hours; same pattern in a different surface. | Schedule after `main-app-improvements-2026-05-10` lands. |
| `5qFHqmfV` M8 upload parity (mobile web + antios) | Genuinely missing for mobile. Picker + multipart + render + failure states. ~1 day. | Schedule with mobile-recovery batch. |
| `Dx5DQ4Go` M6 mobile notifications | Adds a new surface (PWA push + native). Multi-day. | Needs a brief first — what triggers fire, what doesn't, quiet-hours? |
| `yVmf46MS` M9 mobile-specific wins | Triage + compact switcher + quick reply. Half-day each. | Schedule individually, do not bundle into one PR. |

### Memory-noted open gaps (verify state, then act)

| Note | Current state at audit |
|---|---|
| `feedback_mempalace_listing_silent_fail.md` — chroma "too many SQL variables" on >32k drawers, auto-ingest stopped 2026-04-08 | Patched in pipx install, but the underlying auto-ingest service is reportedly still stopped per the memory note. **Recommendation:** verify whether ingest has restarted; if not, that is a real lane. Not in scope for `main-app-improvements` — would belong to its own observability sweep. |
| `feedback_milestone_id_drift.md` — `ant-skills-on-demand-2026-05-09` has both `m2-first-post-hint` and `m2-first-post-pid-hint` milestone IDs in events | Both milestone IDs are flipped `done`. The drift is harmless now but the plan-event projector will show two M2 rows. **Recommendation:** archive the dup id by emitting a final `plan_milestone` with status `cancelled` against `m2-first-post-pid-hint`. <5 minute cleanup. |

### No-action

`uWQVndos` M17 Installed TestFlight smoke is correctly held in
`assigned` waiting on James installing build 55 — that is the
defined blocker, not half-built work.

## Summary

- **Cut 8 stale shadows** — 15-minute task-list hygiene, no code.
- **Defer 2** with known-gap notes — keep proposed, no churn.
- **Finish 4** — schedule individually after the current improvements
  plan lands.
- **2 memory notes** — verify mempalace ingest state; emit one
  cancellation event for the milestone-id drift.

Net: the main app does *not* have a half-built-feature problem. It
has a *task-tracker-drift* problem. The fix is administrative, not
architectural.
