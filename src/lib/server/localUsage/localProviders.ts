/**
 * localProviders — collects ANT's own UsageProviders for tools the
 * open-usage daemon cannot see (JWPK 2026-06-10).
 *
 * Today: 'qwen' (no upstream quota API exists) and 'ollama' (local,
 * no usage API at all). openUsageProxy merges these into the daemon
 * payload so the strip, per-card badges, and 12 h trend snapshots all
 * treat them like any other provider — zero UI changes needed.
 *
 * Rules:
 *   - Every probe is wrapped: one broken probe never hides the rest.
 *   - If the daemon ever ships its own 'qwen' or 'ollama' plugin, the
 *     daemon wins — the proxy drops our local duplicate (upstream has
 *     the richer data source by then).
 *   - Set ANT_LOCAL_USAGE_PROVIDERS=off to disable the whole layer.
 */
import type { UsageProvider } from '$lib/usage/types';
import { buildOllamaProvider } from './ollamaProvider';
import { buildQwenProvider } from './qwenProvider';

export async function collectLocalUsageProviders(nowMs = Date.now()): Promise<UsageProvider[]> {
  if (process.env.ANT_LOCAL_USAGE_PROVIDERS === 'off') return [];
  const providers: UsageProvider[] = [];
  try {
    const qwen = buildQwenProvider(nowMs);
    if (qwen) providers.push(qwen);
  } catch {
    // qwen probe is best-effort; never block the payload.
  }
  try {
    const ollama = await buildOllamaProvider(nowMs);
    if (ollama) providers.push(ollama);
  } catch {
    // ollama probe is best-effort; never block the payload.
  }
  return providers;
}

/** Daemon providers win on id clash; local fill in the gaps. */
export function mergeProviders(
  daemonProviders: readonly UsageProvider[],
  localProviders: readonly UsageProvider[]
): UsageProvider[] {
  const daemonIds = new Set(daemonProviders.map((p) => p.providerId.toLowerCase()));
  const merged = [...daemonProviders];
  for (const local of localProviders) {
    if (!daemonIds.has(local.providerId.toLowerCase())) merged.push(local);
  }
  return merged;
}
