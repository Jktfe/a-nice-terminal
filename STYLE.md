# ANT vNext Style Guide

## The Bar

**Code: 9-year-old readable.** A new agent (or a curious nine-year-old) can
open a file cold, read the names aloud, and follow the user story without
decoding a framework trick.

**Prose: accessible English.** Public-surface writing (README, CHANGELOG,
docs, error messages, UI copy) avoids jargon, prefers short sentences, and
explains a term the first time it's used. If a sentence needs a footnote to
make sense, rewrite the sentence.

## Naming

- Prefer `createChatRoom` over `createSession`.
- Prefer `messagesAfterBreak` over `msgsPostBreak`.
- Prefer `personAskingForAttention` over `actor`.
- Prefer `terminalModeIsRaw` over `raw`.

Names can be longer when the longer name removes doubt.

## Functions

- Default to short functions.
- Split long functions into named story steps.
- Keep side effects visible.
- Avoid helper names like `handleThing`, `processData`, or `doStuff`.

## Components

- A screen composes sections.
- A section composes cards and controls.
- A control owns one job.
- Components should not own routing, persistence, network calls, and rendering
  at the same time.
- Svelte components and route files must stay under 260 lines. Split the file
  before it needs an exception.

## State

Use explicit states instead of scattered booleans.

Good:

```ts
type AgentAttentionState = 'ready' | 'working' | 'asking' | 'stale' | 'failed';
```

Avoid:

```ts
let isReady = true;
let isWorking = false;
let hasQuestion = false;
let isStale = false;
```

## Copy Audit Rule

No copied code enters vNext without an audit note.

Use this format near the copied block or in the ported file header:

```ts
// Copied-from: ../a-nice-terminal/src/path/to/file.ts:10-55
// Verdict: CHANGE
// Simplification: replaced implicit string states with named domain states.
```

Missing audit note means automatic review reject.

## Capability Rule

No capability disappears silently.

Every old capability must be one of:

- KEEP: rebuild it as-is because the behavior is right.
- CHANGE: rebuild it differently because the product shape is better.
- DEDUPE: merge it into another capability.
- DEFER: keep it on the ledger for a named later phase.
- REJECT: remove it with a written reason.
