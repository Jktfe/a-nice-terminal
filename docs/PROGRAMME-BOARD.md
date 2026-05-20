# PROGRAMME BOARD — Visual Snapshot

> Scope: ANT vNext captures, routes, and renders multi-agent room work. Model
> routing belongs to mymatedave, not ANT. Display-only agent model/cost
> metadata stays as evidence, not policy.

This board is a one-glance visual companion to `docs/PROGRAMME.md`. PROGRAMME.md
remains canonical; this file mirrors current state so the programme can be
watched from another screen without scrolling room chatter. Hand-updated per
slice baseline.

**Last updated:** 2026-05-12 (snapshot from `docs/PROGRAMME.md` + active room state)

---

## Legend

| Symbol | Status            | Meaning                                                                  |
| ------ | ----------------- | ------------------------------------------------------------------------ |
| ✅      | Accepted Baseline | QA promotion confirmed; behaviour is part of the live platform           |
| 🟢     | Review-Ready      | Shipped, gates green, awaiting QA verdict                                |
| 🟡     | Review-Held       | Has at least one open BLOCKER from the reviewer; patch pending           |
| 🟦     | Claim-Ready       | Claim-first proposal posted, awaiting QA approval before edits          |
| ⬜     | Not started       | Future slice on the roadmap                                              |
| ⏸     | Deferred          | Explicitly parked for a named later phase                                |
| ❌     | Out-of-Scope      | Removed from ANT by directive (e.g. model routing → mymatedave)         |

---

## Accepted Baselines

| Lane                                  | Slice / Scope                                       | Owner           |
| ------------------------------------- | --------------------------------------------------- | --------------- |
| M01 chatrooms                          | start a chatroom                                    | @evolveantclaude |
| M02 invites                            | invite an agent                                     | @evolveantclaude |
| M03 participants panel                 | slices 1–5 + 4.1 (full WTHef board)                 | @claude2        |
| M11 attachments                        | backend + UI 1 (list/download) + UI 2 (upload)      | @evolveantclaude |
| M12 break-context                      | /break primitive + endpoint + UI                    | @evolveantclaude |
| M13 rename-chatroom                    | endpoint + header form                              | @evolveantclaude |
| M14 search messages                    | backend + /search UI                                | @evolveantclaude |
| M16 agent-timeline                     | slice 1 (store/api/rows) + slice 2 (room slot)      | @evolveantclaude |
| M17 reactions                          | backend + UI 2 (chips on MessageRow)                | @claude2        |
| M19 typing-indicator                   | backend + UI 2 (TypingIndicator strip)              | @claude2        |
| M22 in-room asks                       | slice 1 (read-only panel) + slice 2 (answer/dismiss)| @evolveantclaude |
| M24 read-receipts                      | backend + UI 2 (MessageReadIndicator)               | @evolveantclaude |
| M29 chair (Chairman → Chair)           | slice 1 (digest) + slice 2 (notes) + slice 3 (UI) + slice 4a/4b (LLM seam + push endpoint) + asks-summary | @evolveantclaude |
| M30 chat-messages-foundation           | slice 1 (store) + 2 (endpoint) + 3a/3b/3c/3d/3e (threading UI)| split |
| M31 CLI rooms surface                  | `ant` CLI verbs                                     | @evolveantclaude |
| Memory recall                          | slices 1–10 (store + endpoint + /memory UI + opt-ins + ask + roomId + RoomMemoryLauncher) | @evolveantclaude |
| Asks foundation                        | slice 1 (open/list) + 2 (answer/dismiss) + 3 (/asks UI) | @evolveantclaude |
| Draft persistence backend              | slice 1 (store + endpoint)                          | @claude2        |
| Chair-rename mechanical                | slice 2a (Chairman → Chair across surfaces)         | @evolveantclaude |
| R4 room-detail error boundary          | `+error.svelte` with SimplePageShell + a11y         | @evolveantclaude |
| PROGRAMME.md artefact                  | canonical programme doc                             | @evolveantclaude |
| Router-revert                          | slice 1 (M28 removed per JWPK directive)            | @evolveantclaude |

---

## In-Flight (Review-Held / Review-Ready / Claim-Ready)

| Lane                              | Slice                                  | Status       | Owner           |
| --------------------------------- | -------------------------------------- | ------------ | --------------- |
| Focus mode                        | backend slice 1 (store + endpoint)     | 🟡 review-held (shipped pre-QA gate, treated as in-flight post-hoc) | @claude2 |
| R5 rooms list empty-state         | /rooms +page.svelte additive block     | 🟦 claim-ready (revised contract posted) | @claude2 |
| Visual Programme Board            | this file                              | 🟢 review-ready | @claude2 |
| Chair settings toggle             | slice 2b — Chair-stays-on toggle + guardrail test | ⬜ next claim | @evolveantclaude |

---

## Deferred

| Lane                              | Reason                                                                            | Future tag |
| --------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| M20 B1 — asHandle session identity | platform-completeness primitive (auth/identity wiring needed first)               | session-identity slice |
| R7 InviteAgentForm state split    | InviteAgentForm at 255/260 — needs split-first plan before refactor              | invite-form-split-1 |
| ModelRoutingPolicy field rename   | cosmetic; retained display-only metadata can keep current name until next surface bump | display-metadata-rename |
| Composer draft UI wiring          | ChatComposer frozen at 229/230; UI slice needs split-before-touch                 | draft-ui-slice-1 |
| Focus mode UI wiring              | depends on Focus mode backend baseline + ChatComposer split plan                  | focus-ui-slice-1 |

---

## Out-of-Scope (by directive)

| Lane                | Directive                                                          | Date         |
| ------------------- | ------------------------------------------------------------------ | ------------ |
| Model routing (M28) | JWPK: model routing is mymatedave land, not ANT                    | 2026-05-12   |

---

## Lane Matrix

Rows are lanes; columns are slices in order. Cells show status at a glance.

| Lane               | s1 | s2 | s3 | s4 | s5 | 4.1 | Notes                                       |
| ------------------ | -- | -- | -- | -- | -- | --- | ------------------------------------------- |
| M03 participants   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅  | WTHef board closed end-to-end               |
| M11 attachments    | ✅ | ✅ | ✅ | ⬜ | ⬜ | —   | upload + list + download shipped            |
| M16 agent-timeline | ✅ | ✅ | ⬜ | ⬜ | ⬜ | —   | room-page slot accepted                     |
| M17 reactions      | ✅ | ✅ | ⬜ | ⬜ | ⬜ | —   | chips on MessageRow                         |
| M19 typing         | ✅ | ✅ | ⬜ | ⬜ | ⬜ | —   | backend + UI strip                          |
| M22 asks panel     | ✅ | ✅ | ⬜ | ⬜ | ⬜ | —   | in-room answer/dismiss baseline             |
| M24 read receipts  | ✅ | ✅ | ⬜ | ⬜ | ⬜ | —   | row indicator baseline                      |
| M28 routing        | ❌ | ❌ | ❌ | —  | —  | —   | removed by JWPK directive                   |
| M29 chair          | ✅ | ✅ | ✅ | ✅ | ⬜ | —   | digest + notes + UI + LLM seam + endpoint   |
| M30 threading      | ✅ | ✅ | ✅ | ✅ | ✅ | —   | store + endpoint + indicator + reply + indent + group + count |
| M31 CLI            | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | —   | rooms surface live                          |
| Memory recall      | ✅ | ✅ | ✅ | ✅ | ✅ | —   | slices 1–10 (continuing); full opt-in surface |
| Asks               | ✅ | ✅ | ✅ | ⬜ | ⬜ | —   | open/list + answer/dismiss + UI             |
| Draft persistence  | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | —   | backend only; UI awaits composer split      |
| Focus mode         | 🟡 | ⬜ | ⬜ | ⬜ | ⬜ | —   | review-held (shipped pre-QA gate)           |
| Chair-rename       | —  | ✅ | ⬜ | ⬜ | ⬜ | —   | slice 2a mechanical; 2b toggle queued       |

---

## Owner / Agent Quick Reference

| Agent              | Role                                            |
| ------------------ | ----------------------------------------------- |
| @claude2           | implementer (chat/room lane, drafts, focus, R5) |
| @evolveantclaude   | delivery boss + implementer (room route, chair, threading, M11, M14, M16, M29) |
| @evolveantcodex    | QA gate / baseline promotion                    |
| @codex2            | code reviewer (PASS / BLOCKER)                  |
| @kimi              | audit lane (security / contract / regression)   |
| @glm               | audit lane (route / data-flow / a11y)           |

---

## Snapshot Provenance

Source: `docs/PROGRAMME.md` (canonical) + room `antDevTeam`
(`bvya907eub7tr0lyup0aro`) transcript through 2026-05-12. Hand-updated per slice
baseline. Where this file and PROGRAMME.md disagree, treat PROGRAMME.md as the
source of truth and patch this board to match.
