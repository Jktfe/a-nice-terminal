import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleVoiceVerb } from './ant-cli-voice.mjs';

class CliInputError extends Error {}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(captured.requests.length, { url, init });
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

function audioOk() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.alloc(100, 7),
    text: async () => ''
  };
}

function httpError(status, snippetBody) {
  return {
    ok: false,
    status,
    text: async () => snippetBody,
    arrayBuffer: async () => Buffer.alloc(0)
  };
}

const ORIGINAL_KEY = process.env.ELEVENLABS_API_KEY;
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
let tmpDir;

beforeEach(async () => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ANT_ADMIN_TOKEN;
  tmpDir = await mkdtemp(join(tmpdir(), 'ant-voice-test-'));
});

afterEach(async () => {
  if (ORIGINAL_KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('ant voice elevenlabs test', () => {
  it('missing ELEVENLABS_API_KEY: prints friendly skip message and exits 0', async () => {
    const { runtime, captured } = makeRuntime(() => audioOk());
    const exitCode = await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hello world'],
      runtime,
      { CliInputError }
    );
    expect(exitCode).toBe(0);
    expect(captured.requests).toHaveLength(0);
    expect(captured.stdout.join(' ')).toMatch(/Set ELEVENLABS_API_KEY/);
  });

  it('missing --text: throws CliInputError', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test';
    const { runtime } = makeRuntime(() => audioOk());
    await expect(
      handleVoiceVerb('elevenlabs', ['test'], runtime, { CliInputError })
    ).rejects.toThrow(/--text is required/);
  });

  it('happy path: POSTs to ElevenLabs, writes file, prints path', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key';
    const outPath = join(tmpDir, 'voice.mp3');
    const { runtime, captured } = makeRuntime(() => audioOk());
    const exitCode = await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hello world', '--out', outPath],
      runtime,
      { CliInputError }
    );
    expect(exitCode).toBe(0);
    expect(captured.requests).toHaveLength(1);
    const [req] = captured.requests;
    expect(req.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers['xi-api-key']).toBe('sk_test_key');
    expect(JSON.parse(req.init.body).text).toBe('hello world');
    expect(captured.stdout).toContain(outPath);
    const written = await readFile(outPath);
    expect(written.length).toBe(100);
  });

  it('--voice flag overrides the default voice id', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key';
    const outPath = join(tmpDir, 'voice.mp3');
    const { runtime, captured } = makeRuntime(() => audioOk());
    await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hi', '--voice', 'custom_voice_xyz', '--out', outPath],
      runtime,
      { CliInputError }
    );
    expect(captured.requests[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/custom_voice_xyz');
  });

  it('HTTP error from ElevenLabs: logs error, exits 0 (still smoke test)', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key';
    const longBody = 'unauthorized'.repeat(50);
    const { runtime, captured } = makeRuntime(() => httpError(401, longBody));
    const exitCode = await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hi'],
      runtime,
      { CliInputError }
    );
    expect(exitCode).toBe(0);
    const errOut = captured.stderr.join(' ');
    expect(errOut).toMatch(/ElevenLabs HTTP 401/);
    expect(errOut).toContain(longBody.slice(0, 200));
    expect(errOut).not.toContain(longBody.slice(0, 201));
  });

  it('--json mode (happy path) returns structured JSON result', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key';
    const outPath = join(tmpDir, 'voice.mp3');
    const { runtime, captured } = makeRuntime(() => audioOk());
    await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hi', '--out', outPath, '--json'],
      runtime,
      { CliInputError }
    );
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload).toEqual({ ok: true, path: outPath, voiceId: '21m00Tcm4TlvDq8ikWAM', bytes: 100 });
  });

  it('--json mode (missing key) returns structured skip result', async () => {
    const { runtime, captured } = makeRuntime(() => audioOk());
    await handleVoiceVerb(
      'elevenlabs',
      ['test', '--text', 'hi', '--json'],
      runtime,
      { CliInputError }
    );
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.ok).toBe(false);
    expect(payload.skipped).toBe(true);
    expect(payload.reason).toBe('missing-api-key');
  });

  it('unknown sub-verb under elevenlabs throws CliInputError', async () => {
    const { runtime } = makeRuntime(() => audioOk());
    await expect(
      handleVoiceVerb('elevenlabs', ['frobnicate'], runtime, { CliInputError })
    ).rejects.toThrow(/unknown voice elevenlabs verb/);
  });
});

describe('ant voice preset', () => {
  it('save posts a reusable voice preset to the ANT server with admin bearer', async () => {
    process.env.ANT_ADMIN_TOKEN = 'admin-token';
    const { runtime, captured } = makeRuntime(() => ({
      ok: true,
      status: 201,
      json: async () => ({
        preset: {
          id: 'xeno-demo',
          name: 'Xeno demo voice',
          provider: 'elevenlabs',
          voiceId: 'wADoNOIls814sWSl7P4V',
          modelId: 'eleven_turbo_v2_5'
        }
      }),
      text: async () => ''
    }));

    const exitCode = await handleVoiceVerb(
      'preset',
      ['save', '--id', 'xeno-demo', '--name', 'Xeno demo voice', '--voice', 'wADoNOIls814sWSl7P4V', '--model', 'eleven_turbo_v2_5', '--json'],
      runtime,
      { CliInputError }
    );

    expect(exitCode).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/voice/presets');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer admin-token');
    expect(JSON.parse(captured.requests[0].init.body)).toMatchObject({
      id: 'xeno-demo',
      name: 'Xeno demo voice',
      provider: 'elevenlabs',
      voiceId: 'wADoNOIls814sWSl7P4V',
      modelId: 'eleven_turbo_v2_5'
    });
    expect(JSON.parse(captured.stdout[0]).id).toBe('xeno-demo');
  });

  it('save requires ANT_ADMIN_TOKEN so voice library writes are explicit', async () => {
    const { runtime } = makeRuntime(() => audioOk());

    await expect(handleVoiceVerb(
      'preset',
      ['save', '--name', 'Voice', '--voice', 'voice-id'],
      runtime,
      { CliInputError }
    )).rejects.toThrow(/ANT_ADMIN_TOKEN/);
  });

  it('list reads voice presets from the ANT server with admin bearer', async () => {
    process.env.ANT_ADMIN_TOKEN = 'admin-token';
    const { runtime, captured } = makeRuntime(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        presets: [{ id: 'xeno-demo', name: 'Xeno demo voice', voiceId: 'wADoNOIls814sWSl7P4V' }]
      }),
      text: async () => ''
    }));

    const exitCode = await handleVoiceVerb('preset', ['list', '--json'], runtime, { CliInputError });

    expect(exitCode).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/voice/presets');
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer admin-token');
    expect(JSON.parse(captured.stdout[0])[0].id).toBe('xeno-demo');
  });
});
