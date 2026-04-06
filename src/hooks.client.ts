// ANT v3 — Client Hooks
// Handles stale bundle detection and dev-mode hot reload

import { invalidateAll } from '$app/navigation';

export function handleError({ error }: { error: unknown }) {
  const msg = (error as any)?.message ?? '';

  // Stale bundle: vite rebuilt while the tab was open, chunk hashes changed.
  // Do a full reload to pick up the new build rather than showing a broken UI.
  if (msg.includes('Failed to fetch dynamically imported module')) {
    console.warn('[ant] Stale bundle detected — reloading for fresh assets');
    // Small delay so any in-flight navigation settles first
    setTimeout(() => window.location.reload(), 100);
  }
}
