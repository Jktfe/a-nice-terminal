# Unified Schedule Control Plane — Plan

**Status:** DRAFT for @JWPK approval · 2026-06-19
**Owners:** backend = @newantcodexfixer (automation lane) · UI + safety = @newantclaudefixer (surface lane)
**Origin:** JWPK — "manage ALL the agents on the machine's cron jobs … set triggers for rooms, agents, plans, as well as chairs … I wouldn't feel out of control if a shed-load of cron jobs appeared — I could cancel them, audit them, edit them as I see fit."

---

## 1. Goal

One ANT surface to **see, audit, and control every scheduled thing on the machine** — and to **create triggers across rooms, agents, plans, and chairs** — with the operator always in charge (list / next-run / last-outcome / cancel / pause / edit / audit), and **infrastructure that must never be toggled from the UI hard-separated** from user-managed schedules.

A **"chair"** in this model = a scheduled job that prompts a room/agent on a cadence using a variable template (the first concrete use of the plane).

## 2. What already exists (don't rebuild)

Verified by code-explorer over current `origin/main`:

| Subsystem | Exists | Key files |
|---|---|---|
| **In-app cron** | `cron_jobs` table + store (create/list/start/pause/stop/delete/rename), 5s ticker, actions room.message/console.log/webhook.post/task.create, SSRF-guarded webhooks, outcome fields | `cronJobStore.ts`, `cronJobTicker.ts`, `api/cron-jobs/*`, `/cron` page |
| **Triggers** | `plan_triggers` table + dispatcher (synchronous, inline on lifecycle), full template interpolation, SSRF-guarded webhooks | `planTriggerStore.ts`, `planTriggerDispatcher.ts`, `api/plan-triggers/*`, `/plans/triggers` page |
| **Operator auth gate** | `resolveCallerHandleAnyRoom(req) OR requireAdminAuth(req)` — the pattern hardened tonight for desks/cli-agents | `authGate.ts`, `chatInviteAuth.ts` |
| **Webhook safety** | shared `isWebhookUrlSafe` + `webhookFetchOptions` | `webhookSafety.ts` |
| **launchd reality** | the machine's real scheduler IS launchd (`com.ant.fresh` = the server, `com.ant.server-watchdog`); **crontab is empty** | `deploy/com.ant.fresh.plist.template`, `deploy/com.ant.server-watchdog.plist.template` |

So ANT is ~70% of the way to "local chairs" already. The plane is mostly *unifying + filling gaps + a control UI*, not greenfield.

## 3. The three schedule sources to unify

1. **ANT in-app cron** (`cron_jobs`) — interval jobs that post to rooms / fire webhooks / create tasks. **First-class managed.**
2. **Triggers** (`plan_triggers`) — event-driven (plan/task today). **First-class managed**, extended to room/agent events.
3. **OS schedules** (launchd here; crontab/systemd on Linux agents later) — **read-mostly inventory.** Infra labels (`com.ant.fresh`, watchdog) are **protected: visible but never toggleable from the UI.**

## 4. Gaps to close (from the code map)

**Cron (backend — codex):**
- **A. Edit-after-create.** PATCH only does lifecycle + rename. Add an edit path for `interval/cron_expr/action/action_config/target_*` (on paused/stopped jobs only, for safety).
- **B. cron_expr is declared-but-dead.** `listDueCronJobs` hard-filters `schedule_kind='interval'`; cron rows never fire. Wire a cron-expression evaluator into the ticker (prefer a tiny dep like `croner`/`cron-parser` over hand-rolling; evaluate `next_fire_at_ms` from the expr).
- **C. No template variables on cron.** Bring cron's `room.message` to parity with the trigger dispatcher's interpolation (`{timestamp}`, `{fireCount}`, `{name}`, + chair vars).
- **D. No per-fire audit log.** Add a `cron_job_fires` table `(job_id, fired_at_ms, action, outcome, error)` so the UI can show history (the "audit them" requirement).

**Triggers (backend — codex):**
- **E. No enable/disable.** Add an `enabled` column + PATCH toggle (today: add or hard-delete only).
- **F. Event scope is plan/task only.** Add **room events** (message_posted, member_joined/left) and **agent events** (registered, status_changed, idle) — infra is ready (extend the event set, add call-sites in the message/identity routes, extend `DispatchContext` + `renderTemplate`).
- **G. Auth mismatch.** Cron mutation allows operator-browser-session; plan-triggers require admin-bearer. **Unify on `resolveCallerHandleAnyRoom OR requireAdminAuth`** so operators manage both from the UI.

**OS / launchd (backend — codex):**
- **H. Zero read surface.** Add read-only `GET /api/system/schedules` that enumerates a **hardcoded whitelist of known ANT launchd labels**, queries each via `launchctl print gui/<uid>/<label>`, parses PID/state, returns a summary. **No start/stop/unload exposed to the browser** for any infra label.

**Cross-cutting (backend — codex):**
- **I. No unified "all schedules" read.** Add `GET /api/schedules` that aggregates cron + triggers + OS inventory into one normalized shape `{ id, source, kind, name, schedule, next_run, last_outcome, owner, protected, actions[] }`.
- **J. No infra-vs-managed flag.** Add `protected`/`kind` to the data model so a job/agent that is infrastructure can never be cancelled/edited via the plane. Default ANT-created cron/triggers = managed; launchd infra labels = protected.

**UI (surface — claude):**
- **K. No unified control plane.** `/cron` shows cron; `/plans/triggers` shows triggers (read-only + CLI builder); nothing shows OS schedules or all-in-one. Build the single surface.

## 5. The unified surface (UI — claude)

A new **`/schedules`** page (and a room-scoped slice for chairs):
- **One list of everything** — cron jobs, triggers, OS inventory — with `source` badge, schedule (human-readable via `cron-descriptor`), **next run** (countdown), **last outcome**, **owner**, fire count.
- **Per-item controls (managed only):** pause / resume / cancel / **edit** / **audit-history drawer** (the per-fire log).
- **Protected items** (infra launchd) render **read-only with a lock** — no toggle, a tooltip explaining why (`com.ant.fresh` is the server).
- **"New schedule"** wizard → choose `trigger | cron/chair` → target `{room | agent | plan}` → variable template with a live preview + the human-readable cadence.
- **Audit-first framing** so a "shed-load of jobs appearing" is immediately visible + cancellable — directly answering JWPK's control requirement.

## 6. "Local chairs" on this plane

A chair = a managed cron job (or recurring trigger) with: a cron/interval cadence, `target_room_id` (or target agents), and a **variable** `target_message_template` (gap C). Chairs are created/edited/audited/cancelled through the same `/schedules` surface — no separate system. A "room chair" template can take vars (e.g. `{room}`, `{date}`, `{lastDigest}`) and prompt specific agents.

## 7. Security (non-negotiable)

- **All management endpoints** behind `resolveCallerHandleAnyRoom OR requireAdminAuth` (the gate hardened tonight; consistent across cron + triggers).
- **OS inventory is read-only** from the browser; **infra labels are protected** and never toggleable. Start/stop of infra stays CLI/operator-shell only.
- **Webhook actions** keep the existing SSRF guard.
- **Full audit trail** (per-fire log + who-created + last-outcome) — the operator-control requirement is itself the security feature.
- **Editing a schedule = scheduling code to run**, so edit is gated + paused-jobs-only + audited.

## 8. Phased rollout (each phase shippable + reversible)

1. **Unified read** — `GET /api/schedules` aggregator + the `/schedules` list UI (read-only). Immediate value: "see everything." *(codex: aggregator; claude: UI)*
2. **Cron control parity** — edit-after-create (A), per-fire audit log (D), audit-history drawer. *(codex: API+store; claude: UI)*
3. **Trigger control** — enable/disable (E), unify auth (G), in-UI create/edit (closes the CLI-only gap). *(codex: API; claude: UI)*
4. **OS inventory** — read-only launchd whitelist read (H) + protected rendering (J). *(codex: API; claude: UI)*
5. **Extended events + chairs** — room/agent trigger events (F), cron template variables (C), cron-expr engine (B), the chair wizard. *(codex: backend; claude: wizard UI)*

## 9. Lane split & coordination

- **codex (automation/backend):** the aggregator API, cron edit + cron-expr engine + audit log, trigger enable/disable + extended events, the launchd whitelist read, the `protected` data model, auth unification.
- **claude (surface/UI + safety):** the `/schedules` control plane, the audit-history drawer, the new-schedule/chair wizard, and **the infra-vs-managed safety rendering** (the lock on protected items).
- Build to **this spec**; review each slice cross-lane; deploy via the SHA-pinned lane; security gate verified after each deploy.
- Extra agents (per JWPK): a code-explorer already mapped current state; further parallel agents can take Phase-1 aggregator vs UI concurrently once scope is approved.

## 10. Risks / caveats (honest)

- **launchd toggling = killing prod.** Mitigation: OS inventory is read-only + infra protected; no browser-exposed start/stop. This is the single highest-risk surface — gate hard.
- **cron-expr engine = a new dep.** Keep it tiny + vetted (`croner`/`cron-parser`), not hand-rolled.
- **`protected` flag = a schema migration** on `cron_jobs` (+ the new fire-log table). Additive, low-risk, but a migration.
- **Cross-platform:** mac = launchd; Linux agents = crontab/systemd. Phase 4 ships the launchd adapter; a crontab/systemd adapter (where `python-crontab`/cronboard's *domain* applies) is a later adapter behind the same `/api/schedules` shape.
- **Don't let it become the source of truth for delivery** — it schedules + audits; the actual fan-out/delivery still flows through existing room/trigger paths.

---

**Decision for @JWPK:** approve this scope (or adjust), and we start Phase 1 (unified read view) immediately under the lane split above.
