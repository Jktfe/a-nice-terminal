import { describe, expect, it } from 'vitest';
import { GET } from '../src/routes/api/diagnostics/system-pressure/+server.js';

describe('/api/diagnostics/system-pressure', () => {
  it('returns a no-store system-pressure snapshot for diagnostics UI', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = await response.json();
    expect(typeof body.generated_at_ms).toBe('number');
    expect(typeof body.platform).toBe('string');
    expect(typeof body.uptime_s).toBe('number');
    expect(body.load_avg).toEqual(expect.objectContaining({
      '1m': expect.any(Number),
      '5m': expect.any(Number),
      '15m': expect.any(Number),
    }));
    expect(body.ram).toEqual(expect.objectContaining({
      total_bytes: expect.any(Number),
      free_bytes: expect.any(Number),
      used_bytes: expect.any(Number),
      used_pct: expect.any(Number),
    }));
    expect(body.processes).toEqual(expect.objectContaining({
      total: expect.any(Number),
      agents: expect.any(Number),
    }));
    expect(body.ant_db).toEqual(expect.objectContaining({
      path: expect.any(String),
      size_bytes: expect.any(Number),
    }));
  });
});
