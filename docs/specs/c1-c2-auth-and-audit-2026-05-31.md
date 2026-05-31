# C1 + C2 — Auth Nonces + Audit Log

**Status**: PRE-STAGED (not on critical path for JWPK's personal install; required for V1 distribution outside his machine)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestones**: `c1-auth-nonces` + `c2-audit-log` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Source files**: `packages/remoteant/src/auth/*` (new dir for C1), `packages/remoteant/src/audit/*` (new dir for C2), plus server-side `a-nice-terminal/src/lib/server/auditLog.ts` + `src/routes/api/bridge/audit/*` endpoints

Two milestones, one spec — auth-nonce signing and audit-log writes share the per-request envelope and the server-side validation pipeline, so they're easier to read together than apart.

---

## 1. Why Together

Every remoteant outbound HTTP request to the ANT daemon flows through a single signer (C1: stamps nonce + Bearer) AND a single auditor (C2: writes one row per dispatch + one per completion). Both wrap the same `antApiFetch` from B2 §4. Splitting them into separate spec docs would duplicate the envelope description; combining them keeps the contract coherent.

The plan's acceptance criteria:
- **C1**: *"Server validates bearer + nonce; replay test rejected; missing-bearer test 401"*.
- **C2**: *"Every method invocation produces one audit row; paramsHash deterministic per identical params"*.

---

## 2. C1 — Per-Process Monotonic Nonce

### 2.1 Wire shape

Every remoteant outbound HTTP request adds one new header:

```
X-Ant-Nonce: <pid>.<seq>.<unix-ms>
```

Where:
- `<pid>` = remoteant process ID (stable for the process lifetime)
- `<seq>` = monotonically-increasing 64-bit unsigned integer, starts at 0, increments by 1 per request
- `<unix-ms>` = `Date.now()` at request time

Example: `X-Ant-Nonce: 12345.42.1717142400000`.

### 2.2 Server-side validation rules

The daemon maintains an in-memory LRU cache keyed by `<pid>.<seq>` (no TTL eviction — capacity-bounded at 10k entries per pid). On receiving a request:

1. Parse `X-Ant-Nonce`. If missing → 401 `nonce_missing`.
2. Parse `<pid>` and `<seq>`. If malformed → 400 `nonce_malformed`.
3. Check `<unix-ms>` is within ±5 min of server clock. If skew > 5 min → 401 `nonce_clock_skew`.
4. Check LRU cache for `(pid, seq)` tuple. If present → 401 `nonce_replay`.
5. Insert `(pid, seq)` into LRU. Process the request.

The `<seq>` strictly-monotonic check is INTENTIONALLY OMITTED — out-of-order delivery is allowed (e.g. concurrent requests racing on the network). The replay rejection is the safety; ordering isn't a property the auth layer guarantees.

### 2.3 File paths (C1)

```
packages/remoteant/src/auth/
├── nonce.ts             # Stateful generator: NonceGenerator class with .next() method
├── nonce.test.ts        # Asserts monotonic seq, includes pid+unix-ms, generator is independent per-instance
└── signer.ts            # Wraps antApiFetch to inject X-Ant-Nonce header per request

a-nice-terminal/src/lib/server/
├── nonceCache.ts        # In-memory LRU (use existing lib if present; lru-cache npm package otherwise)
├── nonceCache.test.ts   # LRU eviction at cap, replay detection
└── nonceMiddleware.ts   # Plugged into server's request pipeline; validates per §2.2

a-nice-terminal/src/routes/api/bridge/* — middleware applied at handler entry
```

### 2.4 C1 acceptance gates

| Gate    | Verification                                                                                              | Evidence                              |
|---------|-----------------------------------------------------------------------------------------------------------|---------------------------------------|
| C1-G1   | `NonceGenerator.next()` returns `<pid>.<seq>.<unix-ms>` matching the regex; seq monotonic +1 per call     | vitest assertions                     |
| C1-G2   | Capture a real request; resend it via curl with same X-Ant-Nonce → server returns 401 `nonce_replay`      | curl + server response capture        |
| C1-G3   | Request with missing X-Ant-Nonce → 401 `nonce_missing`                                                    | curl + server response capture        |
| C1-G4   | Request with clock skew > 5 min → 401 `nonce_clock_skew`                                                   | mock-clock test                       |
| C1-G5   | Two concurrent requests with different `seq` values both succeed (no spurious ordering check)             | parallel curl + both 200              |
| C1-G6   | Existing methods (A1 + B2) continue to work end-to-end with C1 signer wired                               | smoke test all B2 methods             |

---

## 3. C2 — Audit Log

### 3.1 Audit fields (E1 §"Audit log fields")

Every dispatch + completion event writes ONE row to the audit log. Both server-side (a SQLite table) and locally (rotating JSON-lines log in `~/Library/Logs/antchat/remoteant-audit.log`).

| Field            | Type                | Meaning                                                                                       |
|------------------|---------------------|-----------------------------------------------------------------------------------------------|
| `handlerHandle`  | string              | Caller's `@handle` resolved server-side from Bearer token (NOT from the request body).         |
| `method`         | string              | e.g. `ant.chat.send`. Mirrors the JSON-RPC method.                                              |
| `targetRoomId`   | string \| null      | Room scope when the method has one; null otherwise.                                            |
| `paramsHash`     | string (sha256 hex) | Digest of params object — NEVER the raw params (avoids logging message content).               |
| `resultCode`     | string              | `ok` or one of the error code names (e.g. `auth_invalid`, `daemon_unreachable`).               |
| `durationMs`     | number              | Wall-clock from request receive to response send (server-side measurement).                   |
| `createdAtMs`    | number              | Epoch ms when the event was recorded.                                                          |
| `mappingId`      | string \| null      | `chat_remote_mappings.id` if this was a cross-bridge event (M4 substrate); null otherwise.    |
| `nonce`          | string              | The `<pid>.<seq>.<unix-ms>` from C1 — useful for replay-investigation.                          |

Append-only. No deletes. Retention matches the server's existing audit-log policy (90 days per existing M9 hand-off).

### 3.2 paramsHash determinism

`paramsHash = sha256(canonical-json(params))` where `canonical-json` is:
- Keys sorted lexically at every depth.
- No whitespace.
- Strings UTF-8 NFC-normalized.
- Numbers serialized as JSON numbers (no `1.0` vs `1` ambiguity — use ES2020 `Number.prototype.toString()` and accept the platform default).

Two calls with identical params must produce identical paramsHash. The C2-G3 test enforces this.

### 3.3 File paths (C2)

```
packages/remoteant/src/audit/
├── client.ts                # Wraps antApiFetch — emits dispatch + completion audit rows
├── canonical-json.ts        # Deterministic JSON serializer for paramsHash
├── local-log.ts             # Rotating JSON-lines writer at ~/Library/Logs/antchat/remoteant-audit.log
└── *.test.ts                # paramsHash determinism, dispatch/completion pairing, log rotation at 5MB

a-nice-terminal/src/lib/server/
├── auditLog.ts              # SQLite write path; bounded async queue to avoid blocking request handlers
├── auditLog.test.ts
└── migrations/<n>-audit-log.sql   # CREATE TABLE audit_log_entries (...);

a-nice-terminal/src/routes/api/bridge/audit/
└── search/+server.ts         # GET endpoint for inspecting the log (admin-bearer-gated)
```

### 3.4 C2 acceptance gates

| Gate    | Verification                                                                                              | Evidence                              |
|---------|-----------------------------------------------------------------------------------------------------------|---------------------------------------|
| C2-G1   | Every method invocation (A1 ping + B2 six methods) produces exactly ONE dispatch row and ONE completion row | row count tally via SQL query    |
| C2-G2   | Audit row contains all 9 fields with correct types per §3.1                                                | schema assertion                       |
| C2-G3   | `ant.chat.send { roomId, body: "hello" }` called twice produces TWO different audit rows with IDENTICAL paramsHash | SQL query result                |
| C2-G4   | Failing method (e.g. `ant.rooms.get { roomId: "doesnotexist" }`) produces audit row with `resultCode: "resource_not_found"`, not silent | row inspection             |
| C2-G5   | Local audit log at `~/Library/Logs/antchat/remoteant-audit.log` mirrors server rows (line count matches within ±2 for in-flight requests) | wc -l comparison      |
| C2-G6   | Audit log rotates at 5 MB; old log moved to `.log.1`, `.log.2`, `.log.3`; oldest discarded                | size + rotation test                  |
| C2-G7   | NEVER any raw message body in audit log — grep the log for known-distinctive test strings, find ZERO hits | grep audit log for test fixtures      |

---

## 4. Cross-Spec Hooks

- **C1 depends on B1** because the nonce is included in EVERY outbound request including B1's heartbeat POSTs and SSE upgrade headers. Wire C1 signer through B1's transport facade.
- **C2 depends on B2** because the methods that produce audit rows are defined in B2. Wire C2 client through B2's `antApiFetch` wrapper.
- **C2 also depends on C1** because the audit row includes the nonce — C2 can't ship before C1 (or the field is null and the spec breaks).

So the implementation order is: C1 first, then C2.

---

## 5. Out of Scope

- **Audit log retention pruning** — existing server policy (90 days) applies; no new pruning code in C2.
- **Cryptographic signing of nonces** — the nonce is integrity-checked via the Bearer token (TLS in transit + bearer-scoped account); no separate signature.
- **Multi-host audit aggregation** — single-host V1; V2 might add per-mapping aggregation.
- **PII redaction in audit log search endpoint** — admin-bearer-gated already; explicit redaction layer is V2.

---

## 6. Risk Notes

**R1 — Clock skew in CI**. The ±5 min skew check fails on slow CI runners where wall clock drifts. Production-ready check; CI may need to mock the clock. Use `Date.now()` injection from a single helper rather than direct calls.

**R2 — paramsHash collision attack surface**. SHA-256 is collision-resistant; concerns are theoretical. But: do NOT use paramsHash as a primary key or unique-index — use auto-incrementing id. The hash is for deterministic identity checks, not unique constraints.

**R3 — Local audit log on disk-full**. Rotation runs every 30s. If disk is full, audit writes throw; we MUST NOT crash remoteant on this. Catch + log to stderr (which goes to remoteant's own stderr capture) + drop the audit row. Document the at-most-once delivery property explicitly.

**R4 — Server audit-write queue backpressure**. If the SQLite write queue grows > 1000 entries, oldest entries get dropped silently. This is an existing pattern for the M9 trust-chip audit; reuse the same queue. Surface a /api/health field for the queue depth so operators can spot a sustained backlog.

---

## 7. Handoff Sequence

1. B2 closes.
2. @homebrewmaincodex flips `c1-auth-nonces` → active; preloads C1-G1..G6.
3. @kimihomebrewwork implements C1 per §2.3 + tests per §2.4. Wires nonce.ts into B1's transport and B2's antApiFetch.
4. @homebrewmaincodex accept + flip C1 done.
5. @homebrewmaincodex flips `c2-audit-log` → active; preloads C2-G1..G7.
6. @kimihomebrewwork implements C2 per §3.3 + tests per §3.4.
7. @homebrewmaincodex accept + flip C2 done.

---

**Spec status when this lands**: pre-staged. Required for V1 distribution outside JWPK's machine; not gating his personal install + smoke test.
