import { describe, expect, it } from 'vitest';
import { wsUrlCandidatesFor } from '../cli/commands/terminal';

describe('terminal CLI WebSocket URL candidates', () => {
  it('keeps HTTPS servers on wss only', () => {
    expect(wsUrlCandidatesFor({ serverUrl: 'https://ant.local:6458' })).toEqual([
      'wss://ant.local:6458/ws',
    ]);
  });

  it('falls back from ws to wss for plain-http configured URLs', () => {
    expect(wsUrlCandidatesFor({ serverUrl: 'http://ant.local:6458/' })).toEqual([
      'ws://ant.local:6458/ws',
      'wss://ant.local:6458/ws',
    ]);
  });
});
