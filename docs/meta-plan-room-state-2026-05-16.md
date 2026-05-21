# Meta Plan — Room State: v3 to v4 + Native Apps Commercial Model

**Date:** 2026-05-16
**Room:** NuK58yk82YXV9Ng6DK0ob (v3 to v4 review)
**Status:** tasks-only / analysis — no implementation
**Author:** evolveantkimi

---

## 1. Room Topology (3 rooms)

| Room | ID | Purpose | Agents |
|------|-----|---------|--------|
| **Main (strategic)** | NuK58yk82YXV9Ng6DK0ob | Cross-stream, JWPK, escalations | claude, user |
| **ANT native apps** | Fu7wxXmKBfO2ftWUm8Zhr | iOS + macOS Tauri day-to-day | kimi, swift, tauri |
| **ANT OSS migration** | IzgMfFbj_GrX7CdsNFOBz | a-nice-terminal repo move | codex, deep |

---

## 2. Plan 1 — v4 Fresh ANT (v4 go-live)

**Plan ID:** `v4-fresh-ant`
**Status:** Phase 2 complete, Phase 3 dogfood soak active

### 2.1 Completed Tasks (13)

| Task | Status | Notes |
|------|--------|-------|
| Codex hooks OSC133 fix | completed | BASH_ENV contamination |
| P0-1 RAW cold-open | completed | capture-pane current-screen seed |
| P0-2 ANT no-guff | completed | status chrome from state-root JSON |
| P0-3 linkedchat HTTP | completed | self-handle + pty-inject-fanout fallback |
| FINDING-2 transcript-tail | completed | live date-partitioned tree |
| FINDING-1 input parity | completed | shared ptyInput.ts |
| Lane-D plans BE | completed | tasks SQLite + routes + 30/30 tests |
| Lane-D plans FE | completed | /plans donut index + Gantt + task-detail |
| Lane-B v4-delta-rebase | completed | rooms parity against v3 reference |
| B2-2 invite page | completed | /r/[inviteId] read-only |
| B2-3 remote redeem | completed | /remote/[admissionId] landing |
| Dashboard polish | completed | open-asks above rooms, sticky header |
| Lane-E fingerprint manifest | completed | decision-doc + consumer-pin + pi-emitter |
| B-HARDEN sessionid-PK | completed | schema + resolver robustness |

### 2.2 In-Progress Tasks (1)

| Task | Status | Blockers |
|------|--------|----------|
| Plan↔rooms many-to-many | in_progress | None — schema migration in flight |

### 2.3 Pending Tasks (4)

| Task | Status | Severity |
|------|--------|----------|
| B-HARDEN S3 watcher-prefer | pending | Medium |
| B2-6 attachments / file-refs | pending | Medium (sole v4-behind-v3 gap) |
| DB-tidy maintenance | pending | Low |
| Plan↔rooms many-to-many | in_progress | Medium |

### 2.4 Phase 3 Soak Status

- Service: `com.ant.fresh` on PID 85020, uptime ~16min
- All 8 boot flags: green
- Lane A (consent grants): /safety=200, /api/chat-rooms/recovery=200, /api/consent-grants=401 (auth gate working)
- Lane B (diagnostics): /api/diagnostics/summary=200, full payload
- Lane C (MCP thin-index): /api/mcp/cli-verbs=200, 127 verbs
- **Operational finding:** cli_hook_lag p50=2827s, p99=3139s — real backlog accumulation, post-Phase-3 workstream

---

## 3. New Workstream — Native Apps + Commercial Model

### 3.1 Strategic Decisions (JWPK-ratified)

| Decision | Value |
|----------|-------|
| Commercial model | Three-tier: OSS (free) / Native (£5.99/mo) / Enterprise (custom) |
| Codebase | Single repo + `ANT_TIER` env var, NOT a fork |
| Chair | API primitive OSS, operator-grade UX native |
| Remote antchat | Protocol OSS, thin-client UX native |
| OSS contribution | DCO (not CLA) |
| Feature gating | Route-level only, never store-layer |
| Native moat | Apple/platform-enforced, not code-enforced |

### 3.2 Pricing

| Tier | Price | Audience |
|------|-------|----------|
| OSS Core | Free | Self-hosters, geeks, CLI users |
| Native App | £5.99/mo | iOS/macOS users wanting polished UX |
| Enterprise | Custom | Companies wanting hosted + SSO + compliance |

### 3.3 Pre-Spawn Artifacts (Design-Only)

| # | Artifact | Status | Scope |
|---|----------|--------|-------|
| C | iOS MVP wireframes | DONE | 10 sections, 10 API endpoints, zero backend |
| C | QR pairing flow | DONE | 11 sections, ant:// scheme, 4 deferred endpoints |
| E | Capability negotiation API | DONE | /api/capabilities spec, tier discovery, 402 pattern |
| — | iOS native research | DONE | Apple platform integrations inventory |
| D | Tauri wireframes | NOT STARTED | Next pre-spawn artifact |

### 3.4 Agent Assignments

| Agent | Lane | Primary Room | Brief |
|-------|------|--------------|-------|
| evolveantkimi | Native apps + pre-spawn | Fu7wxXmKBfO2ftWUm8Zhr | Specs, coordination, Tauri wireframes |
| evolveantswift | iOS Ant Chat MVP | Fu7wxXmKBfO2ftWUm8Zhr | Swift/SwiftUI, consume 10 HTTP+SSE endpoints |
| evolveanttauri | macOS Tauri | Fu7wxXmKBfO2ftWUm8Zhr | Desktop native, menu bar, PTY bridge |
| evolveantcodex | OSS migration | IzgMfFbj_GrX7CdsNFOBz | a-nice-terminal repo move, Monday deadline |
| evolveantdeep | AGPL + hardening | IzgMfFbj_GrX7CdsNFOBz | License, README, secret audit |

### 3.5 Monday Deadlines (2 days)

| Lane | Deliverable | Risk if Miss |
|------|-------------|--------------|
| codex | v4 → a-nice-terminal migration complete | Public repo invisible, New Model staging broken |
| deep | AGPL conversion + OSS hardening | Legal exposure, no public license |
| swift | iOS Ant Chat TestFlight build | NMVC demo blocked |

---

## 4. Build Impact Assessment

### 4.1 What Stays in Scope for Monday

| Workstream | Status | Impact |
|------------|--------|--------|
| v4 Phase 3 soak | ACTIVE | Monitor /tmp/ant-fresh.log, fix regressions immediately |
| OSS migration | PARKED until JWPK signal | No files moved yet, preflight only |
| iOS MVP | IN FLIGHT | Swift agent just spawned, consuming specs |
| Tauri wireframes | NOT STARTED | Pre-spawn artifact, no code |
| Commercial model implementation | GATED | No `ANT_TIER` code until after migration |

### 4.2 What Must NOT Happen Before Monday

| Prohibition | Reason |
|-------------|--------|
| No schema changes | Migration freeze — move known-good tree |
| No `ANT_TIER` implementation | Commercial gate closed until migration complete |
| No QR endpoint implementation | Deferred until post-migration |
| No feature stripping from OSS | Boundaries via packaging/gating, not removal |

---

## 5. Open Questions / JWPK Gates

| # | Question | Blocking? | Recommendation |
|---|----------|-----------|----------------|
| 1 | Tauri wireframes priority vs iOS MVP | No | D after Swift has first build |
| 2 | Enterprise tier pricing structure | No | Defer until native app ships |
| 3 | `cli_hook_lag` investigation | No | Post-Phase-3 dedicated lane |
| 4 | Side-room task visibility | No | Tasks float independent of plans |
| 5 | DCO vs CLA | No | DCO confirmed |

---

## 6. Next Actions (by agent)

| Agent | Next Action | ETA |
|-------|-------------|-----|
| evolveantkimi | Tauri wireframes pre-spawn artifact D | ~1hr when directed |
| evolveantswift | Read specs, first Swift questions in Fu7wxXmKBfO2ftWUm8Zhr | Immediate |
| evolveanttauri | Read shared specs, await Tauri-specific brief | After D complete |
| evolveantcodex | Migration preflight/rollback bundle | Pre-Monday |
| evolveantdeep | AGPL + CONTRIBUTING.md + README + secret audit | Pre-Monday |

---

## 7. Document Index

| Path | Purpose |
|------|---------|
| `docs/ios-mvp-wireframes-2026-05-16.md` | iOS Ant Chat MVP spec |
| `docs/qr-pairing-flow-2026-05-16.md` | QR room join, ant:// deep links |
| `docs/capability-negotiation-api-2026-05-16.md` | Tier discovery API spec |
| `docs/ios-native-research-2026-05-16.md` | Apple platform integrations |
| `docs/meta-plan-room-state-2026-05-16.md` | This document |

