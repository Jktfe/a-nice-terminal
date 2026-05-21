import { describe, expect, it } from 'vitest';
import { GET, OPTIONS } from './+server';

function req(path = 'http://test-host.invalid:6174/api/capabilities', headers?: HeadersInit): Parameters<typeof GET>[0] {
  return {
    request: new Request(path, { headers })
  } as Parameters<typeof GET>[0];
}

describe('/api/capabilities native discovery', () => {
  it('returns tier discovery plus native client endpoint hints', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      serverVersion: expect.any(String),
      buildChannel: expect.any(String),
      tier: 'oss',
      features: expect.objectContaining({ oss: expect.any(Array) }),
      featureFlags: expect.objectContaining({ chair_api: true }),
      native: {
        recommendedBaseUrl: 'http://test-host.invalid:6174',
        endpoints: expect.objectContaining({
          capabilities: '/api/capabilities',
          health: '/api/health',
          rooms: '/api/chat-rooms',
          roomEvents: '/api/realtime/{roomId}/events'
        })
      }
    });
  });

  it('sets native webview CORS headers on GET and documents required client headers', async () => {
    const res = await GET(req('http://test-host.invalid:6174/api/capabilities', {
      origin: 'tauri://localhost'
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(res.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toContain('Ant-Client-Version');
    const body = await res.json();
    expect(body.native.headers).toEqual({
      clientVersion: 'Ant-Client-Version',
      contentType: 'Content-Type'
    });
    expect(body.native.cors.allowedHeaders).toContain('Ant-Client-Version');
  });

  it('echoes native/Tauri origins and allows Ant-Client-Version preflight headers', async () => {
    const res = await OPTIONS(req('http://x/api/capabilities', {
      origin: 'http://localhost:1420',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'Ant-Client-Version,Content-Type'
    }) as Parameters<typeof OPTIONS>[0]);

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:1420');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-headers')).toContain('Ant-Client-Version');
  });
});
