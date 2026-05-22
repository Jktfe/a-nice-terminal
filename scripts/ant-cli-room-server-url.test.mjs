import { describe, expect, it } from 'vitest';
import { resolveRoomServerUrl } from './ant-cli-shared-resolve.mjs';

// 0.1.8 slice H (Xeno goal-2 footnote 2026-05-20): ant chat send was
// requiring an explicit ANT_SERVER_URL env override even when
// ~/.ant/config.json already had a per-room server_url stamped in by
// `ant invite redeem`. This locks the precedence:
//   env > per-room token > top-level config > runtime fallback.
describe('resolveRoomServerUrl precedence', () => {
  const PER_ROOM = 'http://per-room.local:6174';
  const TOP_LEVEL = 'http://top-level.local:6174';
  const RUNTIME_FALLBACK = 'http://runtime-fallback.local:6174';
  const ENV_URL = 'http://env-override.local:6174';

  function makeRuntime(opts) {
    return {
      serverUrl: opts.runtimeServerUrl ?? RUNTIME_FALLBACK,
      serverUrlSource: opts.serverUrlSource ?? 'default',
      config: opts.config ?? {}
    };
  }

  it('returns runtime.serverUrl when source is "env" (explicit override wins)', () => {
    const runtime = makeRuntime({
      runtimeServerUrl: ENV_URL,
      serverUrlSource: 'env',
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { room1: { server_url: PER_ROOM } }
      }
    });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(ENV_URL);
  });

  it('prefers per-room token.server_url over top-level config.serverUrl', () => {
    const runtime = makeRuntime({
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { room1: { server_url: PER_ROOM } }
      }
    });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(PER_ROOM);
  });

  it('falls back to top-level config.serverUrl when no per-room token', () => {
    const runtime = makeRuntime({
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { other_room: { server_url: PER_ROOM } }
      }
    });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(TOP_LEVEL);
  });

  it('falls back to runtime.serverUrl when config has no serverUrl', () => {
    const runtime = makeRuntime({
      config: { tokens: {} }
    });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(RUNTIME_FALLBACK);
  });

  it('handles missing config entirely', () => {
    const runtime = makeRuntime({ config: undefined });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(RUNTIME_FALLBACK);
  });

  it('handles empty roomId by skipping per-room lookup', () => {
    const runtime = makeRuntime({
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { '': { server_url: PER_ROOM } }
      }
    });
    expect(resolveRoomServerUrl(runtime, '')).toBe(TOP_LEVEL);
  });

  it('handles non-string roomId by skipping per-room lookup', () => {
    const runtime = makeRuntime({
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { room1: { server_url: PER_ROOM } }
      }
    });
    expect(resolveRoomServerUrl(runtime, undefined)).toBe(TOP_LEVEL);
  });

  it('skips per-room entry when server_url is empty/missing', () => {
    const runtime = makeRuntime({
      config: {
        serverUrl: TOP_LEVEL,
        tokens: { room1: { server_url: '' } }
      }
    });
    expect(resolveRoomServerUrl(runtime, 'room1')).toBe(TOP_LEVEL);
  });
});
