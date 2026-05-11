# M0 Inventory — UX Atlas 2026-05-11

Status: in progress
Plan: `ux-atlas-2026-05-11`

This file is the literal repo-driven manifest for ANT's UX atlas. It records
what exists before the redesign, then maps each surface into the product model
that should appear in Pencil.

Detailed route controls: `docs/ux-atlas/m0-route-control-matrix.md`.

## Locked Rules

- Linked chat is a private implementation detail. It may remain in schema and
  routing internals, but the user-facing model is a terminal workroom with a
  conversation facet.
- Features are not participants. Deck viewers, artefact viewers, safe-mode
  banners, diagnostics, and similar surfaces should never appear in participant
  lists.
- The terminal is the trust surface and remains one click away. It should not
  be the first thing the product asks a new operator to understand.
- Attention is served as judgement: who is asking, in which room, why it
  matters, what context is available, what options exist, and whether the user
  wants to choose or interview.
- Every screen family must have desktop, mobile, empty, loading, error, active,
  and stale/attention variants before implementation begins.

## Route Inventory

| Route | File | Current surface | Must map to |
|---|---|---|---|
| `/` | `src/routes/+page.svelte` | Dashboard shell around `SessionList`. | Home / Cockpit |
| `/session/:id` | `src/routes/session/[id]/+page.svelte` | Main session/workroom hub. | Workroom |
| `/r/:id` | `src/routes/r/[id]/+page.svelte` | Room invite web view. | External room view |
| `/remote/:id` | `src/routes/remote/[id]/+page.svelte` | Remote room access. | Multi-machine/team access |
| `/plan` | `src/routes/plan/+page.svelte` | Plan viewer/editor. | Plan state and cadence |
| `/asks` | `src/routes/asks/+page.svelte` | Ask queue with drafts/actions. | Decision cockpit |
| `/archive` | `src/routes/archive/+page.svelte` | Archived/deleted session manager. | Operator maintenance |
| `/diagnostics` | `src/routes/diagnostics/+page.svelte` | Health probes and system pressure. | Operator trust |
| `/help` | `src/routes/help/+page.svelte` | CLI reference. | Help / onboarding |
| `/agentsetup` | `src/routes/agentsetup/+page.svelte` | Driver setup guide. | Agent onboarding |
| `/design` | `src/routes/design/+page.svelte` | Internal design-system demo. | Internal reference |
| `/decks/:slug` | `src/routes/decks/[slug]/+page.svelte` | Open-Slide deck artefact surface. | Artefact viewer |
| `/docs/*` | static build output | Published single-file/static docs. | Published output |

## Dashboard / Home

Primary files:

- `src/lib/components/SessionList.svelte`
- `src/lib/components/DashboardHeader.svelte`
- `src/lib/components/FilterMenu.svelte`
- `src/lib/components/GridView.svelte`
- `src/lib/components/GridSlot.svelte`
- `src/lib/components/TerminalRow.svelte`
- `src/lib/components/SessionCard.svelte`
- `src/lib/components/ArchiveStrip.svelte`
- `src/lib/components/PersonalSettingsModal.svelte`
- `src/lib/components/RemoteInviteModal.svelte`

Current interactions:

- Toggle theme.
- Open help.
- Open plan index.
- Open ask queue with count badge.
- Toggle grid view.
- Adjust grid columns/rows.
- Open filter menu.
- Search sessions.
- Filter all/terminals/chats.
- Order by activity/manual.
- Reset manual order.
- Open personal settings.
- Create terminal.
- Create chat.
- Rename by modal input during create.
- Delete permanently confirmation modal.
- Archive/restore via archive strip.
- Drag reorder sessions.
- Drag reorder pinned/sidebar bookmarks.
- Pin/unpin to sidebar.
- Invite standalone chat.
- Open terminal row.
- Open standalone chat card.
- Grid tile: replace selected session.
- Grid tile: expand full session.
- Grid tile: toggle terminal output vs linked chat preview.
- Grid tile: send chat message / approve mini agent event.

States to draw:

- Loading first session list.
- Load error with retry.
- Empty terminal column.
- Empty chat column.
- All/terminal/chat filter states.
- Activity order and manual order.
- Grid enabled with 1x1 through 5x5 dimensions.
- Desktop two-column list.
- Mobile list with chats above terminals.
- Modal overlays for create/delete.
- Remote invite modal.

## Workroom

Primary files:

- `src/routes/session/[id]/+page.svelte`
- `src/lib/components/ActivityRail.svelte`
- `src/lib/components/ChatHeader.svelte`
- `src/lib/components/ChatMessages.svelte`
- `src/lib/components/ChatSidePanel.svelte`
- `src/lib/components/MessageInput.svelte`
- `src/lib/components/MessageBubble.svelte`
- `src/lib/components/Terminal.svelte`
- `src/lib/components/TerminalContextStrip.svelte`
- `src/lib/components/AgentEventCard.svelte`
- `src/lib/components/AgentMenuPrompt.svelte`
- `src/lib/components/InterviewModal.svelte`
- `src/lib/components/BreakConfirmModal.svelte`
- `src/lib/components/DigestPanel.svelte`
- `src/lib/components/FolderDrawer.svelte`
- `src/lib/components/ExportSheet.svelte`
- `src/lib/components/ShareButton.svelte`

Current interactions:

- Activity rail opens dashboard.
- Activity rail expands/collapses on compact phone rail.
- Activity rail opens first waiting terminal.
- Activity rail opens pinned/current/standalone/waiting sessions.
- Activity rail pin/unpin on hover.
- Header back to dashboard.
- Rename room/session inline.
- Select CLI driver from searchable dropdown.
- Switch terminal mode: Chat / ANT / Raw.
- Copy tmux local or SSH command.
- Open export sheet.
- Open folder drawer.
- Open personal settings.
- Toggle digest panel.
- Open room plan.
- Open share panel.
- Toggle side panel.
- Open session menu.
- Copy id.
- Rename.
- Change persistence.
- Create discussion.
- Delete.
- Search within messages and jump prev/next.
- Load older messages.
- Expand parent context.
- Reply to message.
- Start interview from message.
- Delete message.
- Edit message metadata through existing card controls.
- Toggle pin.
- Read receipt display.
- Post `/break` through modal.
- Mention autocomplete.
- Quick launch command insert.
- Linked-terminal special key buttons.
- Linked terminal composer sends to chat and may inject terminal.
- Agent event approve/deny/respond/discard.
- Side panel tabs/sections: folders, participants/chat rooms, discussions,
  artefacts, invites, tasks, files, memory, remote ANTs, settings.
- Mobile side panel full-width overlay with close bar.
- Folder drawer search/jump.
- Export sheet evidence actions.
- Share invite/grant actions.

States to draw:

- Terminal workroom with conversation facet.
- Terminal workroom with interpreted activity facet.
- Terminal workroom with raw terminal facet.
- Chat room workroom without terminal.
- Empty messages.
- Linked workroom with parent context collapsed/expanded.
- Agent menu prompt.
- Permission request unresolved/resolved.
- Needs input / working / thinking / idle / stale agent status.
- Break divider latest/not latest.
- Reply composer active.
- Edit/correction future state.
- Agent interrupt future state.
- Interview modal active and agent picker open.
- Digest panel open.
- Side panel desktop docked.
- Side panel mobile modal.
- Folder drawer.
- Export sheet.
- Share panel.

## Linked-Chat Collapse Audit

| Surface | Current leak | Target product rule |
|---|---|---|
| `SessionList.svelte` | Terminal rows carry `linkedChat`; auto-linked chat ids are hidden from standalone chats but still drive order. | User sees one workroom card per terminal; linked chat is private. |
| `ActivityRail.svelte` | `navigationTarget()` returns `linked_chat_id` for terminal sessions and tooltip says "open linked chat". | Rail opens the workroom id; mode/facet handles conversation. |
| `GridSlot.svelte` | `showChat` toggles "View linked chat"; empty state says "No linked chat for this terminal". | Toggle becomes "conversation/activity" or disappears into workroom preview. |
| `ChatHeader.svelte` | Terminal mode `Chat` is effectively linked chat. | Label becomes a workroom concept, not linked-chat copy. |
| `ChatSidePanel.svelte` | Terminal panel says "Chat Rooms", has selectable chat session and mini linked feed. | Replace with context/conversation settings; selector is hidden/admin-only if needed. |
| `ChatMessages.svelte` | Terminal empty state and composer say "linked chat"; quick launch scope is `linkedChats`. | Copy and model become workroom conversation. |
| `ChatParticipants.svelte` | Participant action opens linked chat for terminal. | Open workroom/focus actor, not linked chat. |
| `TerminalRow.svelte` | Inline message sends to linked chat. | Inline message sends to workroom conversation. |
| Server/API | `linked_chat_id`, linked adapter, hooks, status resolution, run-events resolution. | Keep private implementation mechanics; do not expose as destination. |

## Decision / Ask Cockpit

Primary files:

- `src/routes/asks/+page.svelte`
- `src/lib/components/PinnedAsksPanel.svelte`
- `src/lib/components/AgentEventCard.svelte`

Current interactions:

- Filter ask status/actionability.
- Select bridge target.
- Draft answer.
- Approve answer.
- Answer directly.
- Defer.
- Dismiss.
- Promote candidate ask.
- Inspect linked source message/room.

Target interactions to draw:

- "X is asking about this in Y room."
- Ask for context.
- Explain options.
- Pick option A/B/C.
- Start interview.
- Defer until later.
- Broadcast answer/correction to agents.

## Artefacts

Primary files:

- `src/routes/decks/[slug]/+page.svelte`
- `src/lib/components/ChatSidePanel.svelte`
- `src/lib/server/room-artefacts.ts`

Current interactions:

- Open deck artefact.
- Refresh file status.
- Adopt incoming file changes.
- Discard incoming changes.
- Toggle safe/trusted mode via deck trust mode API.
- View linked docs/sheets/sites from side panel artefacts section.

States to draw:

- Deck viewer normal.
- Safe mode blocked-JS banner.
- Trusted mode.
- File conflict.
- Missing file / 404.
- Live reload update available.
- Feature shown as artefact, not participant.

## Plan / Cadence

Primary files:

- `src/routes/plan/+page.svelte`
- `src/lib/components/PlanView/PlanView.svelte`

Current interactions:

- Select plan.
- Toggle archived plans.
- Add section.
- Add milestone.
- Add decision.
- Edit/toggle done.
- View current plan status from workroom header.

Target interactions to draw:

- Set cadence for updates.
- Agent heartbeat: ack if still working.
- Summary if not working or stale.
- Master-agent collation.
- Overnight milestone-only mode.
- "Working" visual state that triggers a liveness check.

## Admin / Operator Trust

Primary files:

- `src/routes/archive/+page.svelte`
- `src/routes/diagnostics/+page.svelte`
- `src/routes/help/+page.svelte`
- `src/routes/agentsetup/+page.svelte`
- `src/routes/remote/[id]/+page.svelte`
- `src/routes/r/[id]/+page.svelte`

Current interactions:

- Archive select/restore/delete/hard delete.
- Diagnostics refresh/copy endpoint results.
- System pressure refresh.
- Help command browsing.
- Agent setup copy snippets.
- Remote room invite/token flow.
- Room web send/receive.

## Mobile Overlay Inventory

Must draw as mobile-first, not just desktop squeezed down:

- Break confirmation modal.
- Interview modal.
- Side panel as full-width overlay.
- Share/invite modal.
- Personal settings modal.
- Remote invite modal.
- Create terminal/chat modal.
- Delete confirm modal.
- Filter menu.
- CLI driver dropdown.
- Tmux dropdown.
- Persistence submenu.
- Quick launch editor.
- Folder drawer.
- Export sheet.
- Ask options pane.
- Cadence settings.
- Message edit/correction/interrupt confirmation.

## Pencil Status

Active editor: `pencil-new.pen`

Created frames:

- `ux-atlas-2026-05-11 / M0 literal inventory`
- `00 atlas header`
- `M1 IA canvas — surface families`
- `M0 route inventory - literal screens`
- `M0 linked-chat collapse map`
- `M0 workroom interaction matrix - first pass`
- `M0 mobile overlays and sheets inventory`
- `M0 decision cockpit options-pane seed`

Validation:

- `M0 route inventory - literal screens`: no layout problems after width fix.
- `M0 linked-chat collapse map`: no layout problems.
- `M0 workroom interaction matrix - first pass`: no layout problems.
- `M0 mobile overlays and sheets inventory`: no layout problems.
- `M0 decision cockpit options-pane seed`: no layout problems.

Next frames:

- Dashboard/cockpit source-of-truth frame.
