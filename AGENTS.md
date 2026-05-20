# AGENTS.md - ANT vNext

## Project Rule

This repo is a fresh ANT vNext implementation. The existing
`a-nice-terminal` repo is evidence, not law.

Code may be copied from `a-nice-terminal` only after audit. Every copied block
or ported file needs a note that states:

- source path and line range;
- KEEP / CHANGE / DEDUPE / DEFER / REJECT verdict;
- simplification made in vNext.

## 9-Year-Old-Readable Bar

- Use names that explain the user story.
- Keep functions short and linear.
- Split large components before they become clever.
- Make state machines explicit.
- Use accessible English in UI strings, logs, and errors.
- Do not bury runtime behavior inside Svelte components.

## Working Rules

- Keep the live upstream service untouched unless the maintainer explicitly
  asks to bridge or migrate something.
- Use port `6174` for the web app by default.
- Treat `antv5-wireframes.pen` as the capability checklist, not as a frozen
  implementation.
- Update `docs/capability-ledger.md` whenever a capability is implemented,
  redesigned, deduped, deferred, or rejected.

