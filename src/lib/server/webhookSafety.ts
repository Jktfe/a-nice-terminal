/**
 * Shared SSRF guard for every server-side webhook fire path.
 *
 * Originally landed in cronJobTicker.ts (commit 6c55d6d) for the cron
 * webhook.post action. Pre-launch code review (msg_53bpcfqe9j) found
 * the identical vulnerable shape in planTriggerDispatcher.ts which the
 * cron-only fix missed — exactly the inconsistency JWPK's
 * 'OpenClaw-instant-teardown' worry described. Extracted here so every
 * future webhook-fire call site shares the same guard with no drift.
 *
 * Rules (deny-first):
 *   - Only http:// and https:// schemes (no file://, ftp://, gopher://,
 *     ws://, data:, javascript: etc).
 *   - Hostname must NOT match a literal localhost / loopback / IPv4-
 *     private (RFC1918) / link-local / metadata-service address /
 *     IPv6 ULA (fc00::/7) or link-local (fe80::/10) / mDNS .local /
 *     conventional .internal TLD.
 *   - Hostname-pattern check only — full DNS resolution + post-resolve
 *     IP recheck is a v2 hardening lane (defends DNS-rebind attacks).
 *     Today's check catches the obvious + common SSRF vectors.
 *
 * Allowlist override: ANT_WEBHOOK_ALLOW_PRIVATE=true env var disables
 * the guard so self-host operators with legitimate localhost-sidecar
 * webhooks can opt in. Default fails closed.
 *
 * Companion helper `webhookFetchOptions(jobName)` returns the safe
 * fetch init (AbortController 10s timeout, redirect:'manual' to defend
 * post-allowlist redirect-bounce SSRF, identifiable user-agent).
 */

const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127(\.\d+){3}$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10(\.\d+){3}$/,                            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])(\.\d+){2}$/,       // 172.16.0.0/12
  /^192\.168(\.\d+){2}$/,                      // 192.168.0.0/16
  /^169\.254(\.\d+){2}$/,                      // link-local incl. AWS/GCP metadata
  /^f[cd][0-9a-f]{2}:/i,                       // IPv6 ULA (fc00::/7 covers fc00..fdff)
  /^fe80:/i,                                   // IPv6 link-local
  /\.local$/i,                                 // mDNS .local
  /\.internal$/i                               // common-convention internal TLDs
];

export type WebhookSafetyVerdict = { ok: true } | { ok: false; reason: string };

export function isWebhookUrlSafe(rawUrl: string): WebhookSafetyVerdict {
  if (process.env.ANT_WEBHOOK_ALLOW_PRIVATE === 'true') return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `protocol ${parsed.protocol} not allowed (http/https only)` };
  }
  // URL.hostname for IPv6 literals comes back wrapped in [brackets] on
  // Node (per WHATWG URL spec). Strip them before pattern-matching so
  // the IPv6 patterns can be written naturally.
  const rawHost = parsed.hostname;
  if (rawHost.length === 0) return { ok: false, reason: 'empty hostname' };
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(host)) {
      return {
        ok: false,
        reason: `host ${host} is in a private/loopback/metadata range (set ANT_WEBHOOK_ALLOW_PRIVATE=true on the server to override)`
      };
    }
  }
  return { ok: true };
}

/**
 * Default fetch options every webhook fire should use. Bundles three
 * defensive hardening edges so individual call sites can't forget one:
 *   - AbortController with a 10s ceiling (no back-pressure on the
 *     dispatcher loop when a webhook hangs)
 *   - redirect: 'manual' (defends the post-allowlist 301-bounce SSRF
 *     variant where an attacker controls a public URL and 301s through
 *     to a private-range target)
 *   - identifiable user-agent so the receiving webhook can log the
 *     source
 *
 * Returns both the init AND the controller so the caller can clear the
 * timeout in a finally block.
 */
export function webhookFetchOptions(label: string): {
  init: RequestInit;
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': `ANT-${label}/1` },
    signal: controller.signal,
    redirect: 'manual'
  };
  return { init, controller, timeout };
}
