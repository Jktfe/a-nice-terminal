# M0 Overlay and Mobile State Inventory — UX Atlas 2026-05-11

Status: in progress
Plan: `ux-atlas-2026-05-11`

This file names the overlay, dropdown, sheet, drawer, popover, and mobile
states that must be drawn in Pencil before implementation. It is literal
inventory, not the redesigned answer.

## Product Rules

- Linked chat is private infrastructure. Keep the data model, remove it as a
  visible destination. Conversation/activity appears inside the workroom.
- Features are not participants. Deck viewer, artefact viewer, diagnostics, and
  similar read-only surfaces must not appear in participant lists or @mention
  targets.
- Terminal control remains one click away. The redesign may lower its first
  impression priority, but it must not hide the trust surface.
- Native `prompt()` / `confirm()` is mobile debt. Every instance below needs a
  product modal or sheet.
- Any hover-only action needs a phone equivalent.
- Any desktop popover with nested content needs a phone sheet equivalent.

## Overlay Inventory

| Surface | Component / source | Trigger | Current shape | Phone shape to draw | Required states |
|---|---|---|---|---|---|
| Dashboard filters | `FilterMenu.svelte` | Filter icon | Anchored popover with search, show segmented control, order segmented control, reset manual order. | Bottom or full sheet with sticky Apply/Reset row. | Closed, open, filtered dot, manual-order reset visible, empty search. |
| Dashboard create/delete | `SessionList.svelte` | New Terminal, New Chat, delete permanently | Inline custom modal. | Full-width modal/sheet with keyboard-safe footer. | Create terminal, create chat, validation error, delete confirm, cancel, busy/error. |
| Dashboard invites | `RemoteInviteModal.svelte` | Invite action on room/card | Modal/sheet with label, password, token kinds, generated links, copy states. | Full-screen invite sheet. | Empty, password reveal, no kind selected, busy, error, result, copied. |
| Dashboard personal settings | `PersonalSettingsModal.svelte` | Settings button | Centered modal with JSON editor and maintenance action. | Full-screen settings sheet. | Loading, dirty JSON, invalid JSON, saving, tmux reap busy, reap success/error. |
| Dashboard grid cell picker | `GridCell.svelte` / `GridSlot.svelte` | Empty cell / switch session | Session picker dropdown inside tile. | Full-screen or tile-local sheet. | Empty cell, picker open, filtered empty, session chosen, deleted session, clear. |
| Dashboard grid composer | `GridSlot.svelte` | `@` in tile composer | Mention popover above textarea. | Keyboard-safe popover/sheet above composer. | Suggestions, active option, @everyone, no matches, Escape closed, Enter send vs select. |
| Workroom CLI picker | `ChatHeader.svelte` | CLI mode trigger | Searchable popover with keyboard navigation. | Header sheet or full-screen picker. | Open, search, no matches, focused item, current item, Escape/Enter. |
| Workroom tmux | `ChatHeader.svelte` | tmux button | Small dropdown with local and SSH copy actions. | Action sheet. | Local copy, SSH copy, copied feedback, close. |
| Workroom session menu | `ChatHeader.svelte` | Three-dot menu | Popover with copy id, rename, persistence submenu, discussion, delete. | Action sheet with inline persistence section. | Closed, open, persistence expanded, rename, discussion create, delete confirm. |
| Workroom share | `ShareButton.svelte` | Share button | Command panel popover with copy buttons. | Full-screen or bottom sheet. | Loading, no commands, commands present, copied, fetch error. |
| Workroom folders | `FolderDrawer.svelte` | Folder button / Cmd+P | Drawer with search and workspace/folder results. | Full-screen drawer. | Loading recents, search, empty, focused row, selected, error. |
| Workroom export | `ExportSheet.svelte` | Export evidence | Modal sheet with target checkboxes, select all/none, CLI command, result. | Full-screen export sheet. | Loading, configured targets, none selected, exporting, success, error, copied command. |
| Workroom interview | `InterviewModal.svelte` | Interview chip | Focused modal with parent message, participant list, composer, add-agent picker. | Full-screen interview flow. | Starting, active, add participant menu, TTS state, composer, ended, error. |
| Workroom `/break` | `BreakConfirmModal.svelte` | `/break` command | Svelte modal replacing native confirm. | Same modal, keyboard safe. | Prefilled reason, edit reason, cancel, post, Escape, overlay click. |
| Workroom message reply | `MessageInput.svelte` / `MessageBubble.svelte` | Reply action | Composer reply state; current rendered text/id is clunky. | Sticky reply chip above composer with sender + quote + clear. | Active reply, quote collapsed, sender displayed, auto-mention, clear. |
| Workroom message delete | `MessageBubble.svelte` | Delete action | Two-click inline confirm. | Inline confirm or sheet for destructive action. | Armed, timeout, confirm, failure. |
| Workroom message edit/correct | Future protocol | Edit sent message | Not implemented. | Correction modal with interrupt option. | Draft correction, send correction, interrupt running agent, escape failed, acked. |
| Workroom agent events | `AgentEventCard.svelte` | Agent asks / permission / confirmation | Inline card actions. | Inline card plus detail sheet for long payloads. | Free text, multi-choice, confirmation, responded, stale, failed. |
| Workroom agent menu | `AgentMenuPrompt.svelte` | Live agent menu state | Inline dialog card. | Inline card or sheet if long. | AskUserQuestion, ExitPlanMode, option selected, raw fallback. |
| Workroom side panel | `ChatSidePanel.svelte` | Panel toggle | Docked desktop panel, mobile overlay. | Full-screen section navigator. | Participants, terminal conversation, discussions, artefacts, invites, tasks, files, memory, settings, empty/error per section. |
| Workroom linked-chat selector | `ChatSidePanel.svelte` | Terminal chat room select | Native select and mini feed. | Should be removed from default UX; conversation is a workroom view. | Hidden default, advanced debug only, no route destination. |
| Discussions | `RoomLinksPanel.svelte` | Create/link/open discussion | Panel controls with native selects. | Full-screen discussion sheet. | Create, select room, relationship select, linked list, error. |
| Quick actions | `QuickLaunchBar.svelte`, `RoomShortcutsBar.svelte` | Gear/edit/add actions | Inline editor panels. | Horizontal scroll plus editor sheet. | Empty, add, edit, validation, save, remove. |
| Plan route | `routes/plan/+page.svelte` | Add/archive controls | Native prompts/confirms plus PlanView inline controls. | Product modals and plan controls sheet. | Add section, add milestone, add decision, archive/unarchive, WS offline, saving. |
| Plan view | `PlanView.svelte` | Archive section / milestones | Inline plan cards plus native confirm for some archive paths. | Scrollable plan with contextual action sheet. | Editing, done toggle, archived, confirm archive, undo. |
| Ask queue | `routes/asks/+page.svelte` | Ask card actions | Inline filters, textarea, target select, status actions. | Options-pane card with detail sheet. | Candidate, needs context, choose option, answer draft, approve, defer, dismiss, resolved. |
| Archive route | `routes/archive/+page.svelte` | Delete/restore selected | Sticky selected toolbar plus native hard-delete confirm. | Card list with bottom toolbar and delete modal. | Empty, selected, restoring, deleting, error, memory+delete. |
| Deck editor | `routes/decks/[slug]/+page.svelte` | Save conflict | Three-column editor, conflict modal. | File drawer + full-screen editor + full-screen conflict resolver. | No file, dirty, saving, saved, conflict, discard, reload/reapply, audit collapsed. |
| Read-only room | `routes/r/[id]/+page.svelte` | Invite gate | Password/handle gate, read-only SSE stream. | Single-purpose mobile form and read-only stream. | Locked, invalid password, revoked, live, stream lost, sign out. |
| Remote room | `routes/remote/[id]/+page.svelte` | Remote invite URL | Stream + sticky composer. | Same with PWA-safe composer. | Empty, live, send error, stream error, legacy URL warning. |
| Diagnostics | `routes/diagnostics/+page.svelte` | Run/copy/refresh pressure | Stacked operator panels. | Stacked panels. | Idle, running, endpoint error, pressure unavailable, copied. |
| Agent setup | `routes/agentsetup/+page.svelte` | Agent card | Accordion/card selected by id/hash. | Accordion with copy-safe code blocks. | Closed, selected, hash deep link, code copied. |
| Toasts | `ToastContainer.svelte` | Global feedback | Toast stack. | Bottom/safe-area stack. | Info, success, error, timeout, reduced motion. |
| PWA install | `PwaInstallPrompt.svelte` | Browser install event | Browser install prompt. | Browser-owned prompt; do not replace as app modal. | Eligible, dismissed, prompt accepted/rejected. |

## Native Dialog Debt

| Source | Current browser dialog | Replacement to draw |
|---|---|---|
| `routes/session/[id]/+page.svelte` | `confirm()` for delete session. | Delete workroom modal with session name, scope, cancel/delete. |
| `routes/session/[id]/+page.svelte` | `confirm()` for remove participant. | Remove participant modal with affected handle and room. |
| `routes/session/[id]/+page.svelte` | `prompt()` for focus reason. | Focus/working-state modal with suggested reasons and heartbeat cadence. |
| `routes/plan/+page.svelte` | `confirm()` for archive/unarchive plan. | Archive plan modal with plan title and undo path. |
| `routes/plan/+page.svelte` | `prompt()` for add section. | Add section modal. |
| `routes/plan/+page.svelte` | `prompt()` for add milestone. | Add milestone modal scoped to selected section. |
| `routes/plan/+page.svelte` | `prompt()` for add decision. | Add decision modal scoped to selected section. |
| `PlanView.svelte` | `confirm()` for archive action. | Inline or modal confirmation with affected section/milestone. |
| `routes/archive/+page.svelte` | `confirm()` for hard delete selected sessions. | Delete selected sessions modal with count and destructive affordance. |

## Mobile State Matrix

| Surface family | Phone base state | Overlay states to draw | Notes |
|---|---|---|---|
| Cockpit/home | One-column attention feed, room cards below. | Filter sheet, decision detail sheet, cadence settings, working heartbeat failure. | Should surface actual questions, not activity logs. |
| Dashboard/list | One-column room list. | Create terminal/chat, invite, filter/order, delete, archive strip, pin/reorder. | Hover actions become visible row actions or overflow menu. |
| Dashboard/grid | Stacked tiles. | Cell picker, tile composer mention popover, expand, replace, empty/deleted tile. | No flashing refresh state; content should stay stable. |
| Workroom | Header, compact rail, main stream, sticky composer. | Side panel full-screen, CLI picker, tmux sheet, session menu, share, folders, export, interview, break, reply, edit/correct, interrupt. | Terminal trust surface remains one tap away. |
| Side panel | Full-screen section list. | Section-specific detail panels. | Linked-chat selector removed from default path. |
| Questions/options | Prepared judgement card. | Context detail, ask-for-context, option compare, interview start, resolved receipt. | This is the "holy shit" surface. |
| Plan | Scrollable plan. | Add section/milestone/decision modals, archive modal, offline/live status. | No native prompts. |
| Artefact/deck | File drawer plus editor. | Conflict resolver, audit drawer, save footer. | Feature surface, not participant. |
| Archive | Card list. | Selected bottom toolbar, delete modal, restore busy. | Destructive actions must be clear. |
| Read-only/remote | Gate or stream. | Password/handle gate, composer keyboard-safe, stream lost. | Remote room is user-facing; linked chat is not. |
| Diagnostics/setup | Stacked panels/cards. | Copy feedback, run progress, accordion open. | Operator trust surfaces. |

## Open M0 Questions For Review

1. Should the focus/working-state replacement for the current `prompt()`
   become part of the cockpit heartbeat primitive, or remain a workroom-only
   action first?
2. Should dashboard pin/reorder on phone use a dedicated reorder mode, or
   ordinary overflow actions per room card?
3. Should all desktop popovers become sheets on phone, or do small anchored
   popovers survive for keyboard-attached iPad widths?
4. Should the removed linked-chat selector survive behind an "advanced debug"
   gate, or disappear completely from product UX?
