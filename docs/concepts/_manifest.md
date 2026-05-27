---
name: ant-concepts-manifest
description: Manifest for the ANT concept-doc pack. Lists every concept doc + the per-room-kind default-attach policy so the future room-creation hook can read this file and auto-attach the right memories. Also documents the standard structure every concept doc must follow + the frontmatter contract for vault-portable memories.
metadata:
  type: project
  importable: true
  category: manifest
---

# ANT concept-doc manifest

Per JWPK u5f11vr4rc msg_5jtdgkgo6w 2026-05-27: every new room should get a default-attached set of memories explaining the relevant primitives. This manifest is the lookup table the future room-creation hook reads.

## Pack contents

Each concept doc in this directory is:

- **Self-contained** — can be read without inherited context
- **Frontmatter-compatible** — copyable into any agent's memory bank
- **Repo-canonical** — committed, verifiable via `git log -- docs/concepts/`
- **Importable** — `metadata.importable: true` markers it as agent-portable

### Shipped (today, 2026-05-27)

| File | Concept | Status |
|---|---|---|
| `_manifest.md` | This file — pack manifest + default-attach rules | shipped this commit |
| `ant-stage.md` | ANT Stage = shell wrapping any deck + 5 agent-aware capabilities | shipped `5b6a602` + CLI added `7501fc1` |

### Planned (multi-session, task #31 tracks)

| File | Concept | Priority |
|---|---|---|
| `ant-rooms.md` | Rooms primitive — members, mentions, ask fanout, room kinds | HIGH (substrate every agent needs) |
| `ant-asks.md` | Asks system — open-ask queue, ask→answer-as-2-posts pattern | HIGH |
| `ant-artefacts.md` | Artefacts — kinds, render targets, native-browser-vs-in-app split | HIGH |
| `ant-mentions.md` | @-mention routing — explicit handles vs bare-everyone vs at-only | HIGH |
| `ant-break.md` | System breaks — context-break semantics, server-side enforcement | MEDIUM |
| `ant-plans.md` | Plans + tasks — split, gantt view, kickoff/done verbs | MEDIUM |
| `ant-chair.md` | Chair as agent-kind — ANT Chair (user proxy, 1/person) + Room Chair (operator, 1/room) | MEDIUM (the two-primitive split is currently invisible in repo) |
| `ant-verification.md` | Validation lens + scoring + V3 endpoint + premium gate + Trust chip | MEDIUM (substantial concept, touches V3+lens-bridge+lensSchemaId+ValidationBadge) |
| `ant-click-to-explain.md` | Inline-context-from-room-memory premium feature | LOW |
| `ant-bridge.md` | Local MCP+CLI bridge architecture (remoteant unified sidecar, direction C) | LOW (still in design — @speedycodex's P2 design doc not yet ratified) |
| `ant-memory-and-attach.md` | Memory primitive — user vault + search + attach-to-room | LOW (feature not yet built; @ec2 may take the search-on-noun sixth-discipline angle) |

## Default-attach policy

When a new room is created, the room-creation hook (TBD — see room-creation-hook design doc) reads this section + attaches the listed concept docs to the new room based on the room's declared kind.

### Universal (every room)

These are substrate primitives every agent in any room needs to operate cleanly.

- `ant-rooms.md`
- `ant-asks.md`
- `ant-mentions.md`
- `ant-break.md`

### Room kind → additional attaches

| Room kind | Additional attaches | Rationale |
|---|---|---|
| `plan-scoped` (created by `ant plan start`) | `ant-plans.md`, `ant-artefacts.md` | Agents need plan + artefact semantics |
| `stage-presentation` (rooms hosting a Stage deck) | `ant-stage.md`, `ant-click-to-explain.md`, `ant-artefacts.md` | Presenter agents need Stage capabilities |
| `premium-tier` (any room where `validation_ux: true`) | `ant-verification.md`, `ant-chair.md` | Premium agents need lens + Chair primitives |
| `dev-substrate` (Main Dev coordination rooms — orsz / similar) | `ant-bridge.md`, `ant-memory-and-attach.md` | Substrate-design context needed |
| `apps-team` (eiw05zdurz + similar cross-app coordination) | `ant-stage.md`, `ant-verification.md`, `ant-artefacts.md` | App contracts cross-reference these primitives heavily |

Room kind is determined by:

1. Explicit declaration at room creation (`ant rooms create --kind plan-scoped --name "..."`)
2. Inference from creation context (e.g. `ant plan start` creates a `plan-scoped` room)
3. Tier feature flags (`verification_ux: true` makes a room premium-tier)

When a room qualifies for multiple kinds, the union of attached concepts applies — deduplication by filename.

## Concept doc standard structure

Every doc in `docs/concepts/` (except this manifest) follows the same six-section template so agents searching memories get consistent shapes:

```
---
name: <kebab-case-slug>
description: <one-paragraph summary — used by search to determine relevance>
metadata:
  type: project
  importable: true
  category: concept
---

# <Concept name> — <one-line tagline>

## TL;DR
<one-paragraph concept summary>

## Capabilities
<what it does, why it matters, what makes it different from alternatives>

## Architecture
<where it lives in the codebase — file paths, table names, route shapes>

## CLI commands
<full `ant <verb>` surface so an agent can execute, with examples>

## Common patterns
<how to chain commands for typical workflows>

## Related concepts
<links to sibling docs in this pack>
```

The **CLI commands** section is load-bearing — without it, a concept doc is reference material, not actionable knowledge (banked lesson from JWPK msg_adt0wpnt7h: "when I say present an ANT Stage presentation, the agent can search the memories and see the relevant description AND CLIs").

## Frontmatter contract for vault-portable memories

All concept docs (and any other doc intended for cross-agent import) must use frontmatter compatible with the future user-vault memory format:

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Kebab-case slug; matches filename without extension |
| `description` | yes | One-paragraph summary; used by future search-on-noun |
| `metadata.type` | yes | `project` / `concept` / `feedback` etc. |
| `metadata.importable` | yes (for cross-agent docs) | Marker for the future search-attach feature to surface |
| `metadata.category` | recommended | `concept` / `manifest` / `case-study` |
| `metadata.scope` | optional | `public` / `org` / `user` — defaults to public for `docs/concepts/` |

## Maintenance

- **Adding a concept doc**: write the file, ensure it follows the standard structure, add a row to the "Shipped" table above, update the default-attach policy if relevant, commit + ledger entry.
- **Renaming a concept doc**: keep a redirect stub in the original filename for at least one major version so links don't rot.
- **Deprecating a concept doc**: leave the file in place, change `metadata.deprecated: true`, link to the replacement doc.
- **Verifying the pack**: `git log -- docs/concepts/` should show every doc's commit history. No artefact = the concept doesn't exist.

## Related substrate

- `~/.claude/projects/<project>/memory/concept_*.md` — agents can mirror docs/concepts/ entries into their private memory bank for fast local recall (Stage doc was mirrored in this session as `concept_ant_stage.md`)
- `project_room_memory_primitive_spec_jwpk_2026_05_22.md` (private memory) — JWPK spec for the eventual user-vault + room-attach feature
- `project_memory_search_and_attach_to_rooms_2026_05_27.md` (private memory) — search + attach as first-class room primitive
- `feedback_banking_writes_to_user_vault_not_agent_private_2026_05_27.md` (private memory) — discipline shift on where "banking" should write
