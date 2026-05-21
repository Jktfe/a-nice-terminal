# ANT vNext M0 Contract

Date: 2026-05-11
Project path: `/Users/jamesking/CascadeProjects/ant`
Source of truth for UX: `antv5-wireframes.pen`

## Decision

Build ANT vNext as a completely fresh implementation in this repo while
keeping `a-nice-terminal` running as the live working tool.

Current ANT is the reference specimen and safety net, not the permanent
substrate. Code, concepts, schema shapes, and runtime ideas may be copied only
after audit. Anything copied must be renamed, simplified, typed, tested, and
refactored until it fits the vNext architecture.

The bar is 9-year-old-readable code: a capable young reader should be able to
open a file, read the names aloud, and understand the story of the program
without decoding clever framework gymnastics.

## Fresh-Start Rule

- Do not assume the old implementation is right because it works.
- Do not depend on the old implementation because it is convenient.
- Use the old implementation to find proven behavior, edge cases, and hard
  operational lessons.
- Redesign anything that deserves redesigning: UX, data model, routes,
  runtime boundaries, naming, storage, event flow, and operator controls.
- Re-specify every copied primitive in plain English before implementing it.
- Prefer one obvious new implementation over a compatibility shim that hides
  old complexity.
- Keep existing ANT live until vNext has earned replacement through working
  behavior.

## Discussion Break Rule

The v5 wireframe atlas work is complete and should not bleed into vNext as
unquestioned baggage.

Before agents start vNext implementation or architecture work, they must post
a clear break in the discussion room:

`/break v5 atlas complete. Starting fresh ANT vNext build. Existing ANT is evidence, not law. Redesign anything after audit.`

After that break, discussion should use vNext language and should challenge
old assumptions by default.

## Non-Negotiables

- Do not break or depend on changing the running `a-nice-terminal` service.
- Use different ports from the current ANT server. Current ANT stays on `6458`.
- Build fixture-first so visual polish and interaction coverage can move fast.
- Treat `antv5-wireframes.pen` as the binding implementation checklist.
- If a state or interaction is not on the atlas, do not silently invent it.
- Do not blindly copy PTY, auth, persistence, delivery, plans, grants, or
  message catch-up from current ANT.
- Do not bury hard runtime behavior inside UI components. Every hard system
  gets a named interface, fixture implementation, and real implementation.
- Keep the terminal reachable. The new UI can lower terminal prominence, but
  it must not hide or remove operator control.
- Keep code easy to read before making it clever.

## 9-Year-Old-Readable Code Standard

- Names tell stories: `findRoomByName`, not `getRoom`; `messagesAfterBreak`,
  not `msgsPostBreak`.
- Functions default to short. If a function needs scrolling, split it into
  named steps that explain the user-visible story.
- Components compose small pieces. No god components that own routing, data,
  state machines, rendering, and side effects in one file.
- Prefer linear flow over abstraction. A top-to-bottom story beats a clever
  chain that needs three reads.
- Avoid single-letter variables except tiny local loops.
- Comments explain why a decision exists, not what an obvious line does.
- Domain types are explicit. Room ids, chat ids, terminal ids, plan ids, and
  invite tokens must not collapse into loose strings.
- State machines are named and visible. Waiting, thinking, asking, failed,
  stale, and complete should be inspectable states, not scattered booleans.
- User-facing strings, logs, and errors use plain English.
- Tests read like behavior examples, not implementation trivia.

## Initial Product Shape

ANT vNext is a SvelteKit app with:

- a fixture-backed product shell for fast UI implementation;
- a local design system based on the v5 light/dark grammar;
- a typed domain model for rooms, participants, messages, plans, tasks,
  artefacts, terminals, asks, grants, and status;
- an audited service boundary that can run from fixtures, current ANT
  comparison data, or fresh vNext services;
- route-level screens matching the v5 atlas rather than the old v3 navigation.

## Proposed Ports

- Web app dev server: `6460`
- Optional local fixture/API server: `6461`
- Existing ANT server remains: `6458`

These can change if occupied, but the vNext app must never bind over `6458`.

## Implementation Strategy

### Phase 0: Contract And Audit Map

Create the fresh-start contract and an audit map of current ANT behavior worth
copying, changing, or rejecting.

Deliverables:

- M0 contract;
- source-behavior audit list;
- copy/change/reject table for core primitives;
- 9-year-old-readable style guide;
- first vertical slice definition.

### Phase 1: Scaffold And Design System

Create a clean SvelteKit app with TypeScript, Svelte 5, Bun, lint/check/build
scripts, and the ANT v5 visual tokens.

Deliverables:

- app shell;
- light and dark theme tokens;
- core layout primitives;
- fixture data;
- route map placeholders;
- visual smoke page.

### Phase 2: First Real Vertical Slice

Implement the most important user path from the v5 atlas:

1. Cockpit home
2. Workroom
3. Prepared question/options pane
4. Participants and status
5. Message composer
6. Artefact preview
7. Terminal escape hatch

This proves the product feel before filling every edge case.

### Phase 3: Full Atlas Coverage

Work through `antv5-wireframes.pen` lane by lane:

- Claude chat/room lane at `x=-6200`
- Codex terminal/system/API lane at `x=4200`
- Mobile 390 boards at `x=7840+`
- reference parking lot at `x=12000+`

Every implemented screen must map back to an atlas board.

### Phase 4: Fresh Core Services

Rebuild the core primitives cleanly behind the vNext service interfaces:

- rooms/sessions;
- participants/presence;
- messages/read receipts;
- plans/events/tasks;
- artefacts/docs/sheets/files;
- terminals/status/PTY modes;
- grants/invites.

Current ANT can be used as comparison evidence and import source, but not as
the hidden engine of the new product.

### Phase 5: Merge Or Replace Decision

After the vNext product is feature-complete against the atlas and has real
runtime services:

- either bring the UI back into `a-nice-terminal`;
- or make `a-nice-terminal` the headless/core package behind the new product;
- or keep both as separate power-user and product surfaces.

Do not decide this before the new shell is real.

## Architecture Boundary

vNext owns from the start:

- UX and IA;
- routes and layouts;
- theme and components;
- fixture data;
- typed client-side domain model;
- service interfaces;
- behavior contracts;
- naming and code standards.

Hard runtime systems are implemented in deliberate stages, not avoided:

- PTY injection semantics;
- room token security;
- persistence schema;
- WebSocket delivery guarantees;
- plan event semantics;
- consent grant semantics;
- terminal runtime lifecycle.

Until each system is rebuilt, it is represented by fixtures and audited
contracts. Current ANT remains live for comparison and work continuity.

## Acceptance Criteria For M0

M0 is accepted when:

- this contract is visible in repo and chat;
- port boundaries are agreed;
- the v5 atlas is named as the binding checklist;
- the fresh-start rule is agreed;
- the 9-year-old-readable code standard is agreed;
- the first vertical slice is identified;
- the fresh repo is ready for scaffold work without touching `a-nice-terminal`.

## Final Platform Completion Gate

The project is not done when the UI looks good.

Fresh ANT is done only when:

- the new platform can run independently;
- the CLI can interact with other terminals through the new platform;
- every current ANT capability is replicated, replaced, deduped, deferred, or
  rejected with a written reason;
- every row in `docs/current-ant-capability-audit.md` and
  `docs/capability-ledger.md` has shipped evidence or accepted replacement
  evidence;
- terminal control works through the new platform, including linked chat, ANT
  terminal, and raw terminal surfaces;
- tests cover the core contracts;
- browser checks cover desktop and mobile;
- implementation code passes the 9-year-old-readable bar.

Until those gates pass, status must say which phase is done, not that ANT is
done.

## Open Decisions

1. Repo identity: should this be named `ant`, `ant-vnext`, or the eventual
   product name once that lands?
2. Backend mode for Phase 1: fixture-only first, or fixture plus read-only ANT
   adapter from day one?
3. First slice depth: build Cockpit-to-Workroom fully polished first, or build
   thin route coverage for all primary screens before polishing?

## Recommendation

Use `ant` as the working repo name, fixture-only for the first slice, and make
Start Room to Workroom the first deep vertical slice.

That gives the fastest answer to the important question: does the new ANT feel
as good in-browser as the v5 canvas promises, while keeping the codebase simple
enough that a child can read the story of it?
