// C3 of main-app-improvements-2026-05-10 — focused tests for the
// system-pressure snapshot helper. The helper is best-effort: any
// individual probe can return null and the rest must still come
// through. We exercise the typed shape (so /diagnostics renders
// against a stable contract) and confirm absolute + percentage
// fields are filled out on a real host call.

import { describe, expect, it } from 'vitest';
import { captureSystemPressure } from '../src/lib/server/system-pressure.js';

describe('captureSystemPressure', () => {
  it('returns the typed snapshot shape', async () => {
    const snap = await captureSystemPressure();
    expect(typeof snap.generated_at_ms).toBe('number');
    expect(snap.generated_at_ms).toBeGreaterThan(0);
    expect(typeof snap.platform).toBe('string');
    expect(typeof snap.uptime_s).toBe('number');
    expect(typeof snap.load_avg['1m']).toBe('number');
    expect(typeof snap.load_avg['5m']).toBe('number');
    expect(typeof snap.load_avg['15m']).toBe('number');
    expect(typeof snap.ram.total_bytes).toBe('number');
    expect(typeof snap.ram.free_bytes).toBe('number');
    expect(typeof snap.ram.used_bytes).toBe('number');
    expect(typeof snap.ram.used_pct).toBe('number');
    expect(typeof snap.node_rss_bytes).toBe('number');
    expect('total' in snap.processes).toBe(true);
    expect('agents' in snap.processes).toBe(true);
    expect('tmux_sessions' in snap).toBe(true);
    expect(typeof snap.ant_db.path).toBe('string');
  });

  it('reports plausible RAM values: used + free equals total', async () => {
    const snap = await captureSystemPressure();
    expect(snap.ram.total_bytes).toBeGreaterThan(0);
    expect(snap.ram.used_bytes + snap.ram.free_bytes).toBe(snap.ram.total_bytes);
    expect(snap.ram.used_pct).toBeGreaterThanOrEqual(0);
    expect(snap.ram.used_pct).toBeLessThanOrEqual(100);
  });

  it('node_rss_bytes is non-zero and bounded by total RAM', async () => {
    const snap = await captureSystemPressure();
    expect(snap.node_rss_bytes).toBeGreaterThan(0);
    expect(snap.node_rss_bytes).toBeLessThan(snap.ram.total_bytes);
  });

  it('ant_db.path resolves to a string ending in ant.db', async () => {
    const snap = await captureSystemPressure();
    expect(snap.ant_db.path.endsWith('ant.db')).toBe(true);
  });
});
