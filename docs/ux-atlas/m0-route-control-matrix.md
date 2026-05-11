# M0 Route Control Matrix — UX Atlas 2026-05-11

Status: in progress
Plan: `ux-atlas-2026-05-11`

This is the route-by-route control inventory. It complements
`m0-inventory.md` by naming the controls, their result surfaces, mobile
behavior, and known category leaks.

Overlay-specific states are expanded in
`docs/ux-atlas/m0-overlay-mobile-states.md`.

## Notation

| Label | Meaning |
|---|---|
| Inline | State changes in the current view without an overlay. |
| Modal | Blocking centered overlay, desktop and mobile. |
| Sheet | Mobile-oriented bottom/full sheet. |
| Drawer | Side or folder drawer. |
| Popover | Dropdown/menu anchored to a button. |
| Route | Navigation to a different URL. |
| Native dialog debt | Current code uses `prompt()` or `confirm()`, which must become a product modal before mobile sign-off. |

## Dashboard `/`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Theme button | Inline theme toggle. | Header icon. | No modal. |
| Help | Route `/help`. | Header icon or overflow. | Reference surface. |
| Plans | Route `/plan`. | Header icon or cockpit card. | Should eventually surface active plan state. |
| Ask queue | Route `/asks`. | Header icon plus badge. | Should become decision cockpit entry. |
| Grid toggle | Inline list/grid switch. | Header icon; grid forced single column under 640px. | Current grid has its own session picker per cell. |
| Grid dimensions | Inline column/row +/- controls. | Likely hidden/condensed on phone. | Need explicit phone rule. |
| Filter trigger | Popover with search, type segmented control, order segmented control, reset. | Sheet or anchored popover with safe width. | Current popover is desktop-style. |
| Personal settings | Modal. | Full-screen or centered modal. | Also appears from workroom header. |
| New Terminal | Modal input. | Modal/sheet with focus and keyboard-safe footer. | Creates terminal plus auto-linked private chat. |
| New Chat | Modal input. | Modal/sheet. | Creates standalone room. |
| Delete permanently | Modal confirm. | Modal/sheet. | Current dashboard delete is custom, OK to draw. |
| Drag reorder | Inline drag. | Needs mobile alternative: reorder sheet or long-press. | Not solved by current UX. |
| Pin/unpin | Inline icon/hover. | Needs non-hover mobile affordance. | Existing hover-only actions need phone equivalent. |
| Remote invite | Modal. | Full-screen modal. | Room feature, not participant. |
| Archive strip restore/delete | Inline strip + delete modal. | Sticky bottom strip or archive route. | Needs touch-safe variant. |
| Terminal row open | Route `/session/:id`. | Same. | Must open workroom, not linked chat. |
| Standalone chat open | Route `/session/:id`. | Same. | Chat workroom. |
| Grid cell replace | Popover/picker. | Sheet picker. | Needs state for empty cell. |
| Grid cell expand | Route `/session/:id`. | Same. | Should open full workroom. |
| Grid terminal/chat toggle | Inline tile facet switch. | Icon toggle or segmented control. | Rename from linked chat to conversation/activity. |

## Workroom `/session/:id`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back | Route `/`. | Header icon. | PWA-safe. |
| Rename title | Inline input on title. | Inline or modal if cramped. | Needs save/cancel visibility. |
| CLI picker | Popover with search/list. | Full-width sheet or popover. | Terminal only. |
| Mode switch Chat/ANT/Raw | Inline segmented control. | Segmented control, maybe icon-only. | Rename Chat away from linked-chat semantics. |
| tmux | Popover with local/SSH copy. | Sheet/popover. | Copy confirmation state required. |
| Export | Sheet/modal via `ExportSheet`. | Full-screen/sheet. | Evidence export. |
| Folders | Drawer via `FolderDrawer`. | Full-screen folder sheet. | Path search and saved folders. |
| Personal settings | Modal. | Full-screen modal. | Shared with dashboard. |
| Digest | Panel toggle. | Sheet or inline overlay. | Currently hidden on small screens in header. |
| Room plan | Route `/plan?session_id=...`. | Same; should preserve back path. | Header icon visible when plan exists. |
| Share | Popover/panel via `ShareButton`. | Full-screen modal. | Invite/grant controls. |
| Side panel | Docked panel on desktop. | Full-screen overlay with close bar. | Already mobile overlay; atlas must draw every section. |
| Session menu | Popover. | Sheet. | Contains copy id, rename, persistence submenu, discussion, delete. |
| Persistence submenu | Nested popover. | Same sheet section. | Need avoid clipped nested menu on phone. |
| Create discussion | Current menu action. | Modal/sheet or route transition. | Discussion rooms are user-visible, unlike linked chat. |
| Delete session | Menu action. | Confirmation modal. | Verify current confirmation path in parent route. |
| Search messages | Inline search bar + prev/next. | Sticky search row or sheet. | Must support linked terminal conversation pages too. |
| Load older | Inline button. | Inline. | Terminal conversation and chat room. |
| Parent context | Collapsible context block. | Inline accordion. | From discussions. |
| Reply | Composer reply state. | Sticky reply chip above composer. | Current sender label/id is clunky; atlas keeps reply but polishes. |
| Edit/correct | Future modal/protocol. | Modal with interrupt option. | Needs agent stop/escape semantics downstream. |
| Interrupt agent | Future confirmation/action. | High-friction modal. | Must clearly state terminal/agent effect. |
| Interview | `InterviewModal`. | Full-screen modal. | Agent picker nested inside. |
| Delete message | Two-step confirm in `MessageBubble`. | Inline confirm or modal. | Needs touch-safe state. |
| Pin message | Inline toggle. | Inline. | Pinned section appears at top. |
| Read receipts | Inline detail. | Expandable detail. | Future runtime receipts split delivered/read. |
| `/break` | `BreakConfirmModal`. | PWA-safe modal. | Already fixed after native-confirm failure. |
| Mention autocomplete | Popover above composer. | Keyboard-safe popover. | Needs long handle wrapping. |
| Quick launch | Inline bar + edit panels. | Horizontal scroll plus editor sheet. | Scope differs by room/conversation. |
| Special keys | Inline horizontal key row. | Horizontal scroll. | Terminal only. |
| Terminal composer | Textarea posts to conversation and may inject PTY. | Sticky keyboard-safe composer. | Must label terminal injection clearly. |
| Agent event approve/deny/respond/discard | Inline card actions. | Inline card or sheet for long payload. | Needs unresolved/resolved states. |

## Workroom Side Panel Sections

| Section | Current controls | Mobile permutation |
|---|---|---|
| Folders | Search folders, jump workspace. | Full-screen panel section with search focus. |
| Participants | Wake, nickname, cross-post, focus, remove, stop, open linked chat, add terminal. | Full-screen participant list; remove linked-chat action. |
| Terminal Chat Rooms | Select linked chat, mini feed, quick reply. | Collapse into conversation settings; no visible linked-chat room selector by default. |
| Discussions | `RoomLinksPanel` create/link/open flows. | Full-screen section; clear parent/child relationship. |
| Artefacts | Open docs/decks/sheets/sites/plans. | List/detail; feature not participant. |
| Invites / Remote ANTs | Create invite, token list, revoke/refresh. | Full-screen invite management. |
| Tasks | New task input, task cards, status changes. | Full-screen task list/editor. |
| Files | Upload/file refs/memory. | File picker and list. |
| Memory | Search, add key/value, delete. | Search-first sheet. |
| Settings | Long-memory toggle and errors. | Toggle row with error state. |

## Ask Queue `/asks`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back Sessions | Route `/`. | Header link. | Good. |
| Refresh | Reload list. | Header icon/button. | Busy disabled state. |
| Search asks | Inline filter. | Sticky search. | Good. |
| Status filter | Horizontal segmented button row. | Scrollable segment or sheet. | Needs badge counts eventually. |
| Room link | Route `/session/:id`. | Same. | Should preserve return to ask item. |
| Promote candidate | PATCH status. | Full-width row action. | Candidate item state. |
| Bridge target select | Native select. | Sheet/select. | Terminal injection needs explicit warning. |
| Answer draft | Inline textarea. | Inline or detail drawer. | Options-pane future replaces much of this. |
| Approve / Answer / Defer / Dismiss | PATCH ask. | Button group; maybe detail sheet. | Should become prepared judgement options. |

## Plan `/plan`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back | `history.back()` or route `/`. | Fixed button. | PWA-safe. |
| Light/dark | Inline toggle. | Fixed toggle or hidden. | Visual mode only. |
| Plan select | Native select with live/archived groups. | Sheet/select. | Needs long plan names. |
| Show archived | Checkbox. | Toggle row. | Good. |
| Archive/unarchive plan | Native `confirm()` then event write. | Product modal. | Native dialog debt. |
| Add section | Native `prompt()` then event write. | Product modal. | Native dialog debt. |
| Add milestone | Native `prompt()` then event write. | Product modal. | Native dialog debt. |
| Add decision | Native `prompt()` then event write. | Product modal. | Native dialog debt. |
| Rename plan event | Inline edit through `PlanView`. | Inline/detail modal. | Needs `PlanView` sub-inventory. |
| Toggle done | Inline event PATCH. | Inline. | Good. |
| Archive section | Inline event write. | Confirm or undo snackbar. | Need exact state. |
| Live WS error | Inline warning text. | Sticky/status row. | Needs stale/offline state. |

## Archive `/archive`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back Sessions | Route `/`. | Header link. | Good. |
| Refresh | Reload archive. | Header button. | Busy disabled. |
| Search archived sessions | Inline filter. | Sticky search. | Good. |
| Select visible | Checkbox set. | Bulk action toolbar. | Good. |
| Row checkbox | Inline selection. | Touch target. | Good. |
| Restore | POST restore. | Bottom selected toolbar. | Current sticky toolbar exists. |
| Memory + delete | PATCH archive then hard delete. | Confirm recommended. | Current no explicit confirm; needs review. |
| Delete | Native `confirm()` then hard delete. | Product modal. | Native dialog debt. |
| Clear selection | Inline. | Bottom toolbar. | Good. |

## Deck Artefact `/decks/:slug`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back Sessions | Route `/`. | Header link. | Good. |
| Refresh | Invalidate all. | Header button. | Good. |
| File list item | Form action open. | Drawer/list top. | Desktop has 3-column layout. |
| Editor textarea | Inline draft. | Full-screen editor. | Long text needs keyboard-safe save bar. |
| Save | Form action save with write guard. | Sticky save footer. | Dirty/saving/saved states. |
| Conflict: discard my edit | Modal action. | Full-screen conflict resolver. | Good but needs phone layout. |
| Conflict: reload and re-apply edits | Modal action. | Full-screen conflict resolver. | Good. |
| Audit rail | Read-only list. | Collapsible drawer. | Feature not participant. |

## Read-only Room `/r/:id`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Password | Unlock gate. | Single-purpose form. | Already mobile-simple. |
| Handle | Unlock form. | Form field. | Audit identity only. |
| Unlock | Exchanges invite for web token. | Button with busy/error. | Read-only token kind. |
| Sign out | Clears token and returns gate. | Header action. | Good. |
| Message stream | SSE read-only. | Scroll area. | No composer by design. |
| Revoked/expired | Error gate. | Inline error. | Needs empty/error states. |

## Remote Room `/remote/:id`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Message stream | Remote SSE. | Scroll area. | Distinguish remote room from local workroom. |
| Composer | POST remote message. | Sticky composer. | Enter sends, Shift+Enter newline. |
| Error banner | Inline. | Sticky/inline. | Stream failures. |
| Legacy URL warning | Inline banner. | Inline banner. | Good. |

## Diagnostics `/diagnostics`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Session id input | Local state. | Full-width input. | Needs paste affordance. |
| Run diagnostics | Parallel endpoint probes. | Primary button. | Loading and per-endpoint results. |
| Copy results | Clipboard. | Button with copied state. | Needs failure state. |
| Refresh pressure | System pressure API. | Button/visibility refresh. | Operator trust surface. |

## Agent Setup `/agentsetup`

| Control | Current result | Mobile behavior to draw | Notes |
|---|---|---|---|
| Back Sessions | Route `/`. | Header link. | Good. |
| Agent card | Expand/collapse selected agent. | Accordion/card. | Many code blocks. |
| Copy snippets | Code block affordance in content. | Tap-to-copy per block. | Needs explicit state if absent. |
| Hash deep link | Opens selected agent. | Same. | Good. |

## Native Dialog Debt

These are not implementation changes in this lane, but the atlas should not
pretend they are acceptable mobile UX.

| Surface | Native dialog | Replacement to draw |
|---|---|---|
| `/plan` | `confirm()` for archive/unarchive plan. | Archive plan confirmation modal with affected plan name and undo/confirm. |
| `/plan` | `prompt()` for new section. | Add section modal with validation and plan context. |
| `/plan` | `prompt()` for new milestone. | Add milestone modal scoped to section. |
| `/plan` | `prompt()` for new decision. | Add decision modal scoped to section. |
| `/archive` | `confirm()` for hard delete. | Delete sessions modal with selected count and destructive confirmation. |

## Mobile Permutation Matrix

| Surface family | Desktop source | Phone state to draw | Required variants |
|---|---|---|---|
| Dashboard | Two-column list + header popovers. | Single-column home/cockpit, sticky top controls, sheet filters. | Empty, loading, error, filtered, grid enabled, selection/pin actions. |
| Grid | Multi-column dashboard grid. | Single-column stacked tiles with expand and replace. | Empty cell, terminal output, conversation preview, agent event, needs input, idle. |
| Workroom | Header + activity rail + main stream + docked side panel. | Header compressed, rail compact/expandable, side panel full-screen, composer keyboard-safe. | Chat room, terminal conversation, activity, raw, side panel, interview, break, reply, edit, interrupt. |
| Decision cockpit | Ask queue table. | Options-pane cards with detail sheet. | Needs context, choose A/B/C, ask for context, interview, defer, resolved. |
| Plan | Full PlanView canvas with floating controls. | Plan controls sheet + scrollable plan; no native prompts. | Live, sample, archived, saving, WS offline, add/edit/archive. |
| Artefact deck | Three-column file/editor/audit. | File drawer + full-screen editor + conflict modal. | No file, dirty, saving, saved, conflict, binary file, audit collapsed. |
| Archive | Table + sticky selected toolbar. | Card list + bottom selected toolbar. | Empty, selected, busy restore, busy delete, error. |
| Diagnostics | Panels and tables. | Stacked panels, copy/run buttons. | Idle, running, endpoint error, pressure error. |
| Remote/read-only | Narrow room viewer. | Same but with PWA-safe gate/composer. | Locked, live, revoked, stream lost, empty. |
