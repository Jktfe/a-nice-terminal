import { describe, expect, it } from 'vitest';
import { parseLastMessagePreview } from './parseLastMessagePreview';

describe('parseLastMessagePreview', () => {
  it('splits the canonical "@handle: body" shape', () => {
    expect(parseLastMessagePreview('@evolveantsvelte: shipped fix')).toEqual({
      author: '@evolveantsvelte',
      body: 'shipped fix'
    });
  });

  it('handles handles with dots, dashes, and underscores', () => {
    expect(parseLastMessagePreview('@cl_aude-1.2: ok')).toEqual({ author: '@cl_aude-1.2', body: 'ok' });
  });

  it('splits only on the first colon — body keeps remaining colons', () => {
    expect(parseLastMessagePreview('@x: ratio: 1:2')).toEqual({ author: '@x', body: 'ratio: 1:2' });
  });

  it('leaves system messages alone (no leading @)', () => {
    expect(parseLastMessagePreview('@system: @x joined this room.')).toEqual({
      author: '@system',
      body: '@x joined this room.'
    });
  });

  it('returns the whole string as body when no handle prefix matches', () => {
    expect(parseLastMessagePreview('Fresh room. Invite an agent or post a first message…')).toEqual({
      author: null,
      body: 'Fresh room. Invite an agent or post a first message…'
    });
  });

  it('returns empty for null/undefined/empty', () => {
    expect(parseLastMessagePreview(null)).toEqual({ author: null, body: '' });
    expect(parseLastMessagePreview(undefined)).toEqual({ author: null, body: '' });
    expect(parseLastMessagePreview('')).toEqual({ author: null, body: '' });
  });
});
