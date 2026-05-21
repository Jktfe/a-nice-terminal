# Capability Negotiation API — v1 Spec

**Date:** 2026-05-16
**Scope:** implemented discovery surface; route enforcement remains deferred
**Last updated:** 2026-05-18

---

## 1. Endpoint

```
GET /api/capabilities
```

- **Auth:** none — public discovery surface
- **Purpose:** clients discover server tier + feature set before authenticating

---

## 2. Response Shape (200)

```json
{
  "serverVersion": "4.2.1",
  "buildChannel": "stable",
  "tier": "oss" | "native" | "enterprise",
  "features": {
    "oss": ["chat", "rooms", "plans", "tasks", "terminals", "cli_manifest", "mcp_index", "diagnostics"],
    "native": ["chair", "remote_antchat", "voice", "push_notifications", "qr_pairing", "multi_machine_sync"],
    "enterprise": ["sso", "audit_retention", "tenant_isolation", "policy_controls", "hosted_llm_backend"]
  },
  "featureFlags": {
    "chair_api": true,
    "chair_ux": false,
    "remote_join": false,
    "voice": false,
    "push": false
  },
  "limits": {
    "maxRooms": null,
    "maxTerminals": null,
    "maxAgentsPerRoom": null,
    "messageRetentionDays": 30
  },
  "migrationCompatibility": {
    "minClientVersion": "4.0.0",
    "deprecatedFeatures": [],
    "breakingChanges": []
  },
  "branding": {
    "productName": "ANT",
    "upgradeCta": null
  },
  "native": {
    "recommendedBaseUrl": "http://<ANT_SERVER_HOST>:6174",
    "endpoints": {
      "capabilities": "/api/capabilities",
      "health": "/api/health",
      "rooms": "/api/chat-rooms",
      "room": "/api/chat-rooms/{roomId}",
      "roomMessages": "/api/chat-rooms/{roomId}/messages",
      "roomEvents": "/api/realtime/{roomId}/events",
      "terminals": "/api/terminals",
      "tasks": "/api/tasks",
      "plans": "/api/plans",
      "asks": "/api/asks",
      "diagnosticsSummary": "/api/diagnostics/summary"
    },
    "headers": {
      "clientVersion": "Ant-Client-Version",
      "contentType": "Content-Type"
    },
    "cors": {
      "methods": ["GET", "HEAD", "OPTIONS"],
      "allowedHeaders": ["Ant-Client-Version", "Content-Type"]
    }
  }
}
```

---

## 3. Tier Semantics

| Tier | `ANT_TIER` env | What it means |
|------|----------------|---------------|
| `oss` | unset or `"oss"` | free, self-host, all primitives |
| `native` | `"native"` | paid individual £10/mo, native-only features gated |
| `enterprise` | `"enterprise"` | hosted, multi-tenant, compliance-grade |

---

## 4. Feature Gating Rules

- **Route-level only.** `checkFeature(featureName)` in `+server.ts` before handler.
- **Never store-layer.** The DB schema stays identical across tiers.
- **OSS default:** every feature flag defaults `true` for `oss` tier except native-only UX surfaces.
- **402 Payment Required:** returned when a `native` or `enterprise` tier feature is hit on an `oss`-flagged route.

---

## 5. Server-Side Source of Truth

```
src/lib/server/featureGates.ts   ~30 lines
```

- Reads `ANT_TIER` env at import time.
- Exports `getTier(): Tier` and `checkFeature(feature: string): boolean`.
- Static map — no DB lookup, no runtime negotiation complexity.

---

## 6. MCP Dual Surface

Same source of truth exposed as:

- **REST:** `GET /api/capabilities` — iOS, Tauri, web UI
- **MCP resource:** `ant://capabilities` — MCP-aware agents discover server tier

Pattern borrowed from Lane C (`/api/mcp/cli-verbs` + REST list).

---

## 6.1 Native Client Bootstrap Contract

Native clients should call `GET /api/capabilities` before authentication or
room pairing. The `native` object is deliberately path-based rather than
token-bearing:

- `recommendedBaseUrl` is derived from the request origin the native client
  actually reached. Clients can store it as the default server URL.
- `endpoints` uses literal paths and `{roomId}` placeholders so Swift/Tauri
  clients can format URLs without scraping UI routes.
- `headers.clientVersion` tells native clients which custom header to send for
  version telemetry. `OPTIONS /api/capabilities` allows that header for Tauri
  dev origins such as `http://localhost:1420`.
- No secrets, invite tokens, room tokens, or admin tokens are returned here.

---

## 7. Versioning Strategy

- `serverVersion` follows semver.
- `migrationCompatibility.minClientVersion` — client older than this receives a hard upgrade prompt.
- `deprecatedFeatures` + `breakingChanges` arrays give advance warning; clients can degrade gracefully.

---

## 8. Open Questions (JWPK Gates)

| # | Question | Recommended Default |
|---|----------|---------------------|
| 1 | Branding source — env var, config file, or hardcoded? | env `ANT_BRAND_NAME` optional, fallback `"ANT"` |
| 2 | Enterprise seat limit — per-tenant or global? | per-tenant via `ENTERPRISE_MAX_SEATS` env |
| 3 | SSO provider list — Okta, Entra, Google? | deferred to enterprise-implementation gate |

---

## 9. Implementation Estimate

| File | Lines | Notes |
|------|-------|-------|
| `src/lib/server/featureGates.ts` | ~30 | static tier map + checkFeature |
| `src/routes/api/capabilities/+server.ts` | implemented | read-only GET/OPTIONS, no auth, native bootstrap hints |
| `src/routes/api/mcp/capabilities/+server.ts` | ~15 | MCP resource wrapper |
| tests | implemented | CORS preflight + native endpoint shape |
| **Total** | **~85** | **1hr when gate opens** |

---

## 10. Boundaries

- **Out of scope:** entitlement enforcement, license validation, receipt checking, dynamic plan upgrades.
- **In scope:** discovery, tier announcement, static feature map, 402 route gating pattern.
