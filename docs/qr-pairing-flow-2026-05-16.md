# QR Pairing Flow — Design Contract

Date: 2026-05-16
Status: design-first, no implementation until canonical RQO PASS
Scope: one-click room join via QR code scan
Audience: future Swift agent handoff

**WORK-SPLIT BOUNDARY:** This spec is iOS-client-only scope. The Swift agent owns:
- QR scanner UI, camera integration, `ant://` deep-link parser
- Post-scan confirmation screen, Keychain token storage
- Native app navigation after join

The following are OUT OF SCOPE for the Swift agent and belong to a server-side lane:
- `qr_tokens` table schema and migrations
- `/api/qr-tokens`, `/api/qr-tokens/:id`, `/api/qr-tokens/:id/revoke`, `/api/qr-tokens/redeem` endpoints
- `ant room qr` CLI verb
- ASCII QR code generation

---

## 1. User Story

> As a remote team member, I open the native Ant Chat app, scan a QR code
displayed on the host's screen, and immediately join their room without
manually typing server URLs, invite codes, or passwords.

---

## 2. Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Host Server │         │  QR Code     │         │  Native App  │
│  (OSS/paid)  │ ──▶     │  (visual)    │  ──▶    │  (camera)    │
└──────────────┘         └──────────────┘         └──────────────┘
         │                                              │
         │  3. POST /api/qr/redeem                    │
         │◄─────────────────────────────────────────────┤
         │                                              │
         │  4. 200 { token, roomId, serverUrl }       │
         │─────────────────────────────────────────────▶
         │                                              │
         │  5. Store in Keychain                        │
         │                                              │
         │  6. GET /api/chat-rooms/:id                  │
         │◄─────────────────────────────────────────────┤
         │                                              │
         │  7. Start SSE                                  │
         │◄─────────────────────────────────────────────▶
```

---

## 3. Flow Detail

### Step 1 — Host generates QR token

**Who:** The room host (operator) on the server-side web UI or CLI.
**How:** Click "Share via QR" in the room info panel, or run `ant room qr --room ROOM_ID`.
**What happens server-side:**

```
POST /api/qr-tokens
Body: { roomId: string, lifetimeMinutes?: number (default: 10) }
Auth: admin-bearer or room-member identity

Response: 201
{
  qrToken: "qrt_abc123",          // one-time opaque token
  roomId: "room_xyz",
  serverUrl: "https://<ANT_SERVER_HOST>:6174",
  expiresAt: "2026-05-16T12:00:00Z",
  qrData: "ant://<ANT_SERVER_HOST>:6174/room_xyz?token=qrt_abc123"
}
```

**QR payload format** (`qrData`):
```
ant://<host>:<port>/<roomId>?token=<qrToken>
```

Example:
```
ant://<ANT_SERVER_HOST>:6174/NuK58yk82YXV9Ng6DK0ob?token=qrt_7x9k2m
```

This is a custom URL scheme that the native app registers as a deep-link
handler (`ant://` protocol). It is ALSO valid as a raw string for QR scanning
if deep-link registration is not yet implemented.

### Step 2 — Native app scans QR

**Who:** The joining team member on their phone/native app.
**How:** Open Ant Chat → tap "Join room" → camera opens → scan QR.
**What happens client-side:**

1. Camera captures QR code
2. Parse the `ant://` URL or raw string
3. Extract `host`, `port`, `roomId`, `token`

### Step 3 — Native app redeems token

**Client → Server:**
```
POST https://<host>:<port>/api/qr-tokens/redeem
Body: { qrToken: "qrt_abc123" }
No auth header — the qrToken IS the auth for this step
```

**Server-side validation:**
1. Lookup `qrToken` in `qr_tokens` table
2. Check `expires_at > now()`
3. Check `redeemed_at IS NULL` (one-time)
4. Check `revoked_at IS NULL`
5. Mark `redeemed_at = now()`
6. Mint a room-scoped bearer token (same shape as chat-invites)
7. Return token + room metadata

**Response:**
```
200
{
  token: "ant_t_xyz789",           // room-scoped bearer
  kind: "native",                   // distinguishes from cli/mcp/web
  roomId: "NuK58yk82YXV9Ng6DK0ob",
  roomName: "v3 to v4 review",
  serverUrl: "https://<ANT_SERVER_HOST>:6174",
  handle: "@you",                   // default handle, user can rename
  expiresAt: "2026-05-17T12:00:00Z"
}
```

### Step 4 — Native app stores credentials

1. Store `token` in iOS Keychain / Tauri secure store
2. Store `serverUrl` in user preferences
3. Store `roomId` in the app's room list
4. Navigate to Room View for the joined room

### Step 5 — Connection established

1. `GET /api/chat-rooms/:roomId/messages` → fetch history
2. `GET /api/realtime/:roomId/events` → SSE for live messages
3. Room is now active in the native app

---

## 4. Schema

```sql
CREATE TABLE IF NOT EXISTS qr_tokens (
  id            TEXT PRIMARY KEY,       -- qrt_<random>
  room_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL,          -- SHA-256 of the visible token
  created_by    TEXT NOT NULL,           -- handle of the host
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  redeemed_at_ms INTEGER,               -- NULL until first use
  redeemed_by   TEXT,                   -- handle of the joiner (optional)
  revoked_at_ms INTEGER,
  revoked_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_room ON qr_tokens (room_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_hash ON qr_tokens (token_hash);
```

**Why hash the token?** Same reason as chat-invites: the token is a bearer
credential. We store the hash so a DB leak doesn't expose active tokens.
The raw token is only visible once: in the QR code payload at generation time.

---

## 5. Security Boundary

| Threat | Mitigation |
|---|---|
| QR token leak (screenshot) | Short lifetime (default 10 min), one-time use |
| Replay attack | `redeemed_at_ms` prevents double-spend |
| Token brute-force | Token is 128-bit random (qrst_ + 22 base64url chars) |
| Man-in-the-middle | HTTPS only; token exchanged over TLS |
| Host spoofing | QR payload includes serverUrl — user sees hostname before joining |
| QR code forgery | Token must exist in DB + not expired + not redeemed |
| Camera app intercepts QR | `ant://` scheme is registered to Ant Chat only; other apps can't handle it |

---

## 6. API Surface (NEW endpoints)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/qr-tokens` | POST | room-member identity | Generate QR token |
| `/api/qr-tokens/:id` | GET | admin or creator | Check token status |
| `/api/qr-tokens/:id/revoke` | POST | admin or creator | Revoke before use |
| `/api/qr-tokens/redeem` | POST | none (token is auth) | Redeem for room token |

**No changes to existing endpoints.** This is a pure addition.

---

## 7. CLI Surface

```
ant room qr --room ROOM_ID [--lifetime 10m] [--output terminal|clipboard|json]
```

Output options:
- `terminal` — prints ASCII QR code to terminal (uses `qrcode` npm package)
- `clipboard` — copies `ant://...` URL to clipboard
- `json` — raw JSON for scripting

---

## 8. Native App Wireframes

### QR Scanner View
```
┌─────────────────────────────┐
│  ⟨ Cancel                   │
├─────────────────────────────┤
│                             │
│    ┌─────────────────┐      │
│    │                 │      │
│    │   📷 Camera     │      │
│    │   viewport      │      │
│    │                 │      │
│    └─────────────────┘      │
│                             │
│  Align QR code within frame │
│                             │
│  [Enter code manually]      │
└─────────────────────────────┘
```

### Post-Scan Confirmation
```
┌─────────────────────────────┐
│  Join room?                 │
├─────────────────────────────┤
│  Server: mac.kingfisher...  │
│  Room: v3 to v4 review      │
│  Host: @evolveantclaude     │
├─────────────────────────────┤
│  [Cancel]      [Join]       │
└─────────────────────────────┘
```

---

## 9. Edge Cases

| Case | Behaviour |
|---|---|
| Token expired | Show "QR code expired. Ask host to generate a new one." |
| Token already redeemed | Show "QR code already used. Each code works once." |
| Token revoked | Show "QR code was cancelled by the host." |
| Invalid QR format | Show "Not a valid Ant Chat QR code." |
| Server unreachable | Show "Cannot reach server. Check your connection." |
| Room deleted | 404 on redeem → "Room no longer exists." |
| User already in room | Skip join, just navigate to existing room |

---

## 10. Acceptance Criteria (for implementer)

- [ ] `ant room qr --room ROOM_ID` generates a QR token and prints ASCII QR
- [ ] QR payload is valid `ant://` URL with host, roomId, token
- [ ] POST `/api/qr-tokens` returns 201 with token + qrData
- [ ] POST `/api/qr-tokens/redeem` with valid token returns 200 + bearer
- [ ] Second redeem of same token returns 410 Gone
- [ ] Expired token returns 410 Gone
- [ ] Revoked token returns 410 Gone
- [ ] Token hash stored in DB, not raw token
- [ ] Native app deep-link handler opens Room View after join
- [ ] Token stored in Keychain / secure store
- [ ] Schema migration is append-only to db.ts

---

## 11. Open Questions

1. **Should QR tokens support bulk generation?** (e.g., "generate 5 QR codes for this room")
2. **Should the host see a list of pending/unredeemed QR tokens?**
3. **Should native apps auto-join on `ant://` deep-link without showing confirmation?**
4. **Lifetime default: 10 min? 5 min? configurable per room?**

Recommend: 10 min default, confirmation screen shown, pending list deferred to v1.1.
