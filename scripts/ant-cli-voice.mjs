/**
 * ant voice — optional voice plug-in smoke tests.
 *
 *   ant voice elevenlabs test --text "hello world" [--voice <id>] [--out <path>] [--json]
 *
 * Reads ELEVENLABS_API_KEY from the environment. If absent, the verb
 * prints a friendly skip message and exits 0 — it is a smoke test, not a
 * gate. If present, the verb POSTs the text to the ElevenLabs TTS API
 * and writes the returned mp3 audio to --out (default
 * /tmp/ant-voice-test.mp3). HTTP errors are reported but still exit 0.
 *
 * No server route — this is a pure CLI verb. We reuse runtime.fetchImpl
 * so tests can mock the call, but the URL is absolute (api.elevenlabs.io)
 * rather than against runtime.serverUrl.
 */

import { writeFile } from 'node:fs/promises';

const BOOLEAN_FLAGS = new Set(['json']);
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — ElevenLabs documented default voice.
const DEFAULT_OUT_PATH = '/tmp/ant-voice-test.mp3';
const ELEVENLABS_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

export async function handleVoiceVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === 'elevenlabs') {
    const [subAction, ...rest] = args;
    if (subAction === 'test') return runElevenlabsTest(rest, runtime, CliInputError);
    if (!subAction || subAction === 'help' || subAction === '--help') {
      writeUsage(runtime);
      return subAction ? 0 : 1;
    }
    throw new CliInputError(`unknown voice elevenlabs verb: ${subAction}`);
  }
  if (!action || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown voice verb: ${action}`);
}

function writeUsage(runtime) {
  runtime.writeOut('ant voice elevenlabs test --text "..." [--voice <id>] [--out <path>] [--json]');
  runtime.writeOut('  Smoke-test the optional ElevenLabs TTS plug-in.');
  runtime.writeOut('  Reads ELEVENLABS_API_KEY from env. Skips gracefully if unset.');
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

async function runElevenlabsTest(args, runtime, CliInputError) {
  const flags = parseFlags(args, CliInputError);
  if (!flags.text) throw new CliInputError('--text is required');

  const wantJson = flags.json !== undefined;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    const message = 'Set ELEVENLABS_API_KEY to use this verb (smoke-test skipped).';
    if (wantJson) {
      runtime.writeOut(JSON.stringify({ ok: false, skipped: true, reason: 'missing-api-key', message }));
    } else {
      runtime.writeOut(message);
    }
    return 0;
  }

  const voiceId = flags.voice ?? DEFAULT_VOICE_ID;
  const outPath = flags.out ?? DEFAULT_OUT_PATH;
  const url = `${ELEVENLABS_TTS_BASE}/${voiceId}`;
  const body = JSON.stringify({
    text: flags.text,
    model_id: 'eleven_multilingual_v2'
  });

  let response;
  try {
    response = await runtime.fetchImpl(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'accept': 'audio/mpeg',
        'content-type': 'application/json'
      },
      body
    });
  } catch (networkError) {
    const message = `ElevenLabs fetch failed: ${networkError.message ?? networkError}`;
    if (wantJson) {
      runtime.writeOut(JSON.stringify({ ok: false, skipped: true, reason: 'network-error', message }));
    } else {
      runtime.writeErr(message);
    }
    return 0;
  }

  if (!response.ok) {
    let snippet = '';
    try {
      const text = typeof response.text === 'function' ? await response.text() : '';
      snippet = (text ?? '').slice(0, 200);
    } catch {
      snippet = '';
    }
    const message = `ElevenLabs HTTP ${response.status}: ${snippet}`;
    if (wantJson) {
      runtime.writeOut(JSON.stringify({ ok: false, skipped: true, reason: 'http-error', status: response.status, snippet, message }));
    } else {
      runtime.writeErr(message);
    }
    return 0;
  }

  const audioBuffer = await response.arrayBuffer();
  await writeFile(outPath, Buffer.from(audioBuffer));

  if (wantJson) {
    runtime.writeOut(JSON.stringify({ ok: true, path: outPath, voiceId, bytes: audioBuffer.byteLength }));
  } else {
    runtime.writeOut(outPath);
  }
  return 0;
}
