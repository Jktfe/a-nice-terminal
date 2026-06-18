import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { bindHandle } from './handleBindingsStore';
import {
  extractLiveAutofillSuggestions,
  readLiveAutofillSuggestionsForHandle
} from './liveAutofillSuggestions';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('extractLiveAutofillSuggestions', () => {
  it('extracts dim ghost text as copy-only suggestions', () => {
    const capture = [
      'normal output',
      `> run check \x1b[2mand then open the failing test\x1b[22m`
    ].join('\n');

    const suggestions = extractLiveAutofillSuggestions(capture, '@claude', 1_000);

    expect(suggestions).toEqual([
      {
        id: expect.stringMatching(/^autofill_/),
        sourceHandle: '@claude',
        text: 'and then open the failing test',
        copyOnly: true,
        detectedAtMs: 1_000,
        expiresAtMs: 6_000,
        source: 'tmux-dim-text'
      }
    ]);
  });

  it('keeps current-pane CRLF captures as single rows', () => {
    const capture = [
      'older line',
      '',
      'status line',
      `❯ \x1b[2mCrack on with the command-palette route fix\x1b[0m`,
      'footer line'
    ].join('\r\n');

    const suggestions = extractLiveAutofillSuggestions(capture, '@claude', 1_000);

    expect(suggestions.map((chip) => chip.text)).toEqual(['Crack on with the command-palette route fix']);
  });

  it('ignores ordinary prompt text and status chrome', () => {
    const capture = [
      '> npm run check',
      '\x1b[2mesc to interrupt\x1b[22m',
      '\x1b[2mcontext 42% tokens\x1b[22m'
    ].join('\n');

    expect(extractLiveAutofillSuggestions(capture, '@claude')).toEqual([]);
  });
});

describe('readLiveAutofillSuggestionsForHandle', () => {
  it('reads the current pane for a live ANThandle binding', () => {
    bindHandle({ handle: '@claude', pane: '%7', pid: 7, pidStart: null, terminalId: 't_claude' });

    const result = readLiveAutofillSuggestionsForHandle('@claude', {
      nowMs: 2_000,
      capturePaneScreen: (pane) => {
        expect(pane).toBe('%7');
        return `> \x1b[2mwrite the room summary\x1b[0m`;
      }
    });

    expect(result.reason).toBeUndefined();
    expect(result.sourceHandle).toBe('@claude');
    expect(result.suggestions.map((chip) => chip.text)).toEqual(['write the room summary']);
  });

  it('returns an empty live-only response for unknown handles', () => {
    expect(readLiveAutofillSuggestionsForHandle('@missing')).toEqual({
      sourceHandle: '@missing',
      suggestions: [],
      reason: 'unknown-handle'
    });
  });
});
