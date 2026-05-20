# HTTPS + Certificate Cutover Plan for ANT v4

Date: 2026-05-17
Author: @evolveantkimi
Task: #100
Status: Decision doc. No implementation claim.

## Executive Summary

ANT v4 currently serves HTTP on `localhost:6174`. Tailscale is already running with Funnel exposing v3 on `https://<ANT_SERVER_HOST>`. This plan describes how to migrate v4 to HTTPS with automatic certificate management via Tailscale, including config migration, hook updates, native client contracts, and rollback steps.

## Current State

| Surface | URL/Port | Protocol | Status |
|---|---|---|---|
| v4 server | `localhost:6174` | HTTP | Active (PID 22550) |
| v3 server | `localhost:6458` | HTTPS (self-signed) | Active, Funnel-proxied |
| Tailscale Funnel | `https://<ANT_SERVER_HOST>` | HTTPS (Tailscale managed) | Active → v3 |
| Tailscale Funnel | `https://<ANT_SERVER_HOST>:8443` | HTTPS (Tailscale managed) | Active → localhost:5181 |
| Tailscale tailnet | `http://mac:6174` | HTTP | Reachable |
| Self-signed certs | `~/.ant/certs/127.0.0.1+3.pem` | — | Exist but unused by v4 |

Tailscale Funnel currently proxies the main domain to v3 (`https+insecure://localhost:6458`). v4 is NOT yet exposed via Funnel.

## Option Analysis

### Option A: Tailscale Funnel (Recommended)

Add a new Funnel route (or migrate the existing one) pointing to v4 on `http://localhost:6174`.

**Pros:**
- Certificates are automatic and managed by Tailscale (LetsEncrypt under the hood)
- No cert renewal cron jobs or manual intervention
- Domain is already set up (`<ANT_SERVER_HOST>`)
- Works from anywhere without firewall changes
- Native Tailscale IP (`mac:6174`) stays available for LAN/tailnet access

**Cons:**
- Dependency on Tailscale control plane (mitigated by tailnet-only fallback)
- Adds ~1-5ms latency for Funnel path vs direct localhost
- Requires Tailscale client running on server machine

### Option B: Node.js HTTPS with Self-Signed Certs

Configure `build/index.js` (SvelteKit adapter-node) to use `https.createServer` with `~/.ant/certs/`.

**Pros:**
- No external dependency
- Works without Tailscale

**Cons:**
- Self-signed certs cause browser warnings and require `--insecure` flags in clients
- Manual cert renewal
- Does not solve remote access (still need reverse proxy or Tailscale)

### Option C: LetsEncrypt Direct + Reverse Proxy

Use certbot + nginx/caddy as reverse proxy.

**Pros:**
- Standard web deployment pattern
- Works without Tailscale

**Cons:**
- Adds operational complexity (nginx/caddy config, certbot renewal)
- Need public IP + port 80/443 open
- Overkill for current single-machine deployment

**Recommendation: Option A (Tailscale Funnel)** for the public HTTPS endpoint, with Option B (self-signed) as a documented fallback for local-only development.

## Cutover Plan

### Phase 0: Pre-Cutover Prep (No Service Touch)

1. **Document current state**
   - [ ] Confirm Tailscale Funnel config: `tailscale serve status`
   - [ ] Confirm v4 is healthy on `http://mac:6174/api/health`
   - [ ] Note all hardcoded `http://` references in codebase

2. **Identify all hardcoded URLs**
   ```sh
   rg -l "localhost:6174|127.0.0.1:6174|http://" src/ scripts/ cli/ --type-add 'web:*.{ts,mjs,js,svelte}' -t web | sort -u
   ```

3. **Backup current Funnel config**
   ```sh
   tailscale serve status > ~/.ant/backups/tailscale-serve-pre-cutover-$(date +%Y%m%d-%H%M%S).txt
   ```

### Phase 1: Add v4 Funnel Route (Parallel, No Downtime)

Add a NEW Funnel endpoint for v4 while keeping v3 active. This gives a staging HTTPS URL.

```sh
# Option 1a: New subdomain/path
# tailscale serve --https=443 --set-path /v4 http://localhost:6174
# (Not supported in current Tailscale serve CLI — use port-based instead)

# Option 1b: New port on same domain
tailscale serve --https=8444 http://localhost:6174
# Result: https://<ANT_SERVER_HOST>:8444 → v4
```

**Verify:**
```sh
curl -s https://<ANT_SERVER_HOST>:8444/api/health
```

### Phase 2: Config Migration (Client-Side)

Update all client configurations to use the HTTPS canonical URL.

Files to patch:
- `~/.ant/config.json`: `"serverUrl": "https://<ANT_SERVER_HOST>:8444"` (or final port)
- `cli/lib/config.ts`: Default server URL constant
- `scripts/ant-cli.mjs`: `DEFAULT_SERVER_URL`
- `.env` / `.env.example` in repo: `ANT_SERVER_URL`
- Hook configs: `~/.claude/settings.json` PostToolUse command
- CI/GitHub Actions secrets: `ANT_SERVER_URL`
- iOS/Mac app config: Server base URL plist/JSON
- Tauri app config: Window/server URL

**Important:** Keep `ANT_SERVER_URL` env override working so dev/local HTTP still functions.

### Phase 3: Hook Migration

The hook command in `~/.claude/settings.json` currently calls:
```json
{
  "PostToolUse": {
    "server": "http://127.0.0.1:6174",
    ...
  }
}
```

Update to:
```json
{
  "PostToolUse": {
    "server": "https://<ANT_SERVER_HOST>:8444",
    ...
  }
}
```

**Critical:** JWPK must do this manually in `~/.claude/settings.json` per safety rules.

### Phase 4: Native Client Contract Updates

| Client | Change |
|---|---|
| Web (SvelteKit) | No change — served from same origin |
| `ant` CLI | Update `DEFAULT_SERVER_URL`, handle TLS in `cli/lib/api.ts` |
| `antchat` | Same TLS handling as CLI |
| iOS/Mac | Update server base URL, ensure ATS allows Tailscale domain |
| Tauri | Update window/server URL in config |
| QR / deep-link | Payload URLs must use HTTPS canonical domain |

**TLS handling in Bun/Node clients:**
Tailscale Funnel uses valid LetsEncrypt certs. Bun and Node will trust them automatically (ISRG Root X1 is in system trust stores). No `rejectUnauthorized: false` needed.

### Phase 5: Cutover Day — Migrate Main Domain to v4

1. **Announce maintenance window**
2. **Stop v3 service** (or keep running on alternate port)
3. **Update Funnel main route**:
   ```sh
   # Remove old v3 route
   tailscale serve --https=443 off
   
   # Add v4 route on main domain
   tailscale serve --https=443 http://localhost:6174
   ```
4. **Update configs** from `:8444` staging to main domain
5. **Verify**:
   ```sh
   curl -s https://<ANT_SERVER_HOST>/api/health
   ```
6. **Test CLI from clean shell**:
   ```sh
   ant rooms list
   ```

### Phase 6: Cleanup

- Remove staging `:8444` Funnel route
- Archive v3 to `~/ant-v3-reference/`
- Update documentation
- Mark #55 Phase 2 complete

## Rollback Plan

If cutover fails:

```sh
# Immediate: restore v3 Funnel route
tailscale serve --https=443 off
tailscale serve --https=443 https+insecure://localhost:6458

# Revert client configs to http://localhost:6174 or previous HTTPS URL
```

Rollback time: ~30 seconds.

## Validation Checklist

- [ ] `curl -s https://<ANT_SERVER_HOST>/api/health` returns 200
- [ ] `curl -s https://<ANT_SERVER_HOST>/api/health | grep '"status":"ok"'`
- [ ] Browser loads dashboard without cert warnings
- [ ] `ant rooms list` works from fresh shell (no env override)
- [ ] `ant chat send <room> --msg "test"` returns 201
- [ ] Hook events post successfully (check `/tmp/ant-fresh.log`)
- [ ] iOS/Mac app connects without ATS errors
- [ ] QR/deep-link generation produces HTTPS URLs
- [ ] Native Tailscale IP (`mac:6174`) still works as fallback

## Security Considerations

1. **Tailscale Funnel vs tailnet-only**: Funnel exposes to the internet. If JWPK wants stricter access, use tailnet-only (`tailscale serve` without `-- funnel`) and require Tailscale auth.
2. **Token exposure**: HTTPS prevents token sniffing on the wire. Ensure all clients use HTTPS before removing HTTP fallback.
3. **v3 deprecation**: Once v3 is fully migrated, remove its Funnel route to reduce attack surface.

## Open Questions for JWPK

1. **Staging preference**: Use `:8444` staging domain, or cut directly to main domain with quick rollback?
2. **v3 coexistence**: Keep v3 running on alternate port for emergency rollback, or shut down entirely?
3. **Tailscale tailnet-only option**: Should native iOS/Mac apps require Tailscale VPN, or is public Funnel acceptable?
4. **Domain naming**: Keep `<ANT_SERVER_HOST>`, or request a custom domain (e.g., `ant.jamesking.dev`)?
5. **Timeline**: Target Monday-gated Phase 2, or defer to post-TestFlight?

## Related Documents

- #90 Tailscale vs Cloudflare suitability: `docs/phase-1-lane-c/tailscale-vs-cloudflare-suitability-2026-05-16.md`
- #55 Phase 2 v4 CLI binary cutover: `/Users/jamesking/.claude/plans/abstract-kindling-fiddle.md`
- Tailscale Funnel docs: https://tailscale.com/kb/1223/funnel
