// C3 of main-app-improvements-2026-05-10 — read-only snapshot of
// system pressure (RAM, processes, tmux sessions, ant.db size) so
// /diagnostics can surface whether ANT itself is heavy or whether
// some other workload (video processing, build farm, etc.) owns the
// saturation. No control surface, no auth gate beyond what the
// route already inherits — calling this only reveals coarse-grained
// information about the host that the operator already sees in
// Activity Monitor.

import { json } from '@sveltejs/kit';
import { captureSystemPressure } from '$lib/server/system-pressure.js';

export async function GET() {
  const snapshot = await captureSystemPressure();
  return json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
