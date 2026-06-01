import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetVoicePresetStoreForTests, saveVoicePreset } from '$lib/server/voicePresetStore';

const ADMIN_TOKEN = 'voice-preset-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(method: 'GET' | 'POST', body?: unknown, token = ADMIN_TOKEN): AnyEvent {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request('http://localhost/api/voice/presets', init),
    url: new URL('http://localhost/api/voice/presets')
  } as unknown as AnyEvent;
}

async function runHandler(handler: (event: AnyEvent) => unknown, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('/api/voice/presets', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetVoicePresetStoreForTests();
  });

  it('GET lists saved voice presets behind admin bearer auth', async () => {
    saveVoicePreset({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      provider: 'elevenlabs',
      voiceId: 'wADoNOIls814sWSl7P4V'
    });

    const response = await runHandler(GET, eventFor('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0]).toMatchObject({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      voiceId: 'wADoNOIls814sWSl7P4V'
    });
  });

  it('POST saves a reusable human-named preset', async () => {
    const response = await runHandler(POST, eventFor('POST', {
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      provider: 'elevenlabs',
      voiceId: 'wADoNOIls814sWSl7P4V',
      modelId: 'eleven_turbo_v2_5'
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.preset).toMatchObject({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      voiceId: 'wADoNOIls814sWSl7P4V',
      modelId: 'eleven_turbo_v2_5'
    });
  });

  it('POST rejects wrong admin bearer', async () => {
    const response = await runHandler(POST, eventFor('POST', {
      name: 'Nope',
      provider: 'elevenlabs',
      voiceId: 'voice'
    }, 'wrong-token'));

    expect(response.status).toBe(401);
  });
});
