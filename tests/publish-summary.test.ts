import { describe, it, expect } from 'vitest';
import {
  PUBLISH_SUMMARY_VERSION,
  buildPublishSummary,
  serializePublishSummary,
  parsePublishSummary,
  renderSummaryMarkdown,
} from '../src/lib/server/interview/publish-summary';

const baseInput = {
  title: 'Auth model walkthrough',
  findings: ['Local mode uses scrypt', 'Shared mode uses bearer tokens'],
  decisions: ['Drop session-token storage by Q3'],
  asks: ['Confirm whether web kind should ever write'],
  actions: ['File ticket to spec source-set scope'],
  sources: [
    { message_id: 'msg-1', excerpt: 'we got burned last quarter' },
    { message_id: 'msg-2', excerpt: '   trim me   ' },
  ],
  linkedChatId: 'lc-abc',
  originRoomId: 'room-xyz',
  authoredBy: '@jwpk',
  generatedAtMs: 1_700_000_000_000,
};

describe('buildPublishSummary', () => {
  it('builds a complete summary with all fields populated', () => {
    const s = buildPublishSummary(baseInput);
    expect(s.schema_version).toBe(PUBLISH_SUMMARY_VERSION);
    expect(s.title).toBe(baseInput.title);
    expect(s.findings).toEqual(baseInput.findings);
    expect(s.decisions).toEqual(baseInput.decisions);
    expect(s.asks).toEqual(baseInput.asks);
    expect(s.actions).toEqual(baseInput.actions);
    expect(s.linked_chat_id).toBe(baseInput.linkedChatId);
    expect(s.origin_room_id).toBe(baseInput.originRoomId);
    expect(s.authored_by).toBe('@jwpk');
    expect(s.generated_at_ms).toBe(baseInput.generatedAtMs);
  });

  it('trims anchor excerpts and keeps message_id intact', () => {
    const s = buildPublishSummary(baseInput);
    expect(s.sources[1]).toEqual({ message_id: 'msg-2', excerpt: 'trim me' });
  });

  it('defaults bucket arrays to [] when omitted', () => {
    const s = buildPublishSummary({
      title: 'x',
      linkedChatId: 'lc',
      originRoomId: 'r',
    });
    expect(s.findings).toEqual([]);
    expect(s.decisions).toEqual([]);
    expect(s.asks).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.sources).toEqual([]);
  });

  it('drops empty/whitespace strings from buckets', () => {
    const s = buildPublishSummary({
      ...baseInput,
      findings: ['real', '', '   ', 'also real'],
    });
    expect(s.findings).toEqual(['real', 'also real']);
  });

  it('drops anchors with empty message_id', () => {
    const s = buildPublishSummary({
      ...baseInput,
      sources: [
        { message_id: '', excerpt: 'orphan' },
        { message_id: 'msg-keep', excerpt: 'kept' },
      ],
    });
    expect(s.sources).toEqual([{ message_id: 'msg-keep', excerpt: 'kept' }]);
  });

  it('defaults authored_by to null when omitted', () => {
    const { authoredBy: _omit, ...rest } = baseInput;
    const s = buildPublishSummary(rest);
    expect(s.authored_by).toBeNull();
  });

  it('defaults generated_at_ms to Date.now()-ish when omitted', () => {
    const before = Date.now();
    const { generatedAtMs: _omit, ...rest } = baseInput;
    const s = buildPublishSummary(rest);
    const after = Date.now();
    expect(s.generated_at_ms).toBeGreaterThanOrEqual(before);
    expect(s.generated_at_ms).toBeLessThanOrEqual(after);
  });

  it('rejects an empty title', () => {
    expect(() => buildPublishSummary({ ...baseInput, title: '' })).toThrow();
    expect(() => buildPublishSummary({ ...baseInput, title: '   ' })).toThrow();
  });

  it('rejects a missing linkedChatId', () => {
    expect(() => buildPublishSummary({ ...baseInput, linkedChatId: '' })).toThrow();
  });

  it('rejects a missing originRoomId', () => {
    expect(() => buildPublishSummary({ ...baseInput, originRoomId: '' })).toThrow();
  });
});

describe('serializePublishSummary + parsePublishSummary', () => {
  it('round-trips through JSON', () => {
    const s = buildPublishSummary(baseInput);
    const wire = serializePublishSummary(s);
    const parsed = parsePublishSummary(wire);
    expect(parsed).toEqual(s);
  });

  it('parsePublishSummary accepts an object directly (already-parsed)', () => {
    const s = buildPublishSummary(baseInput);
    expect(parsePublishSummary(s)).toEqual(s);
  });

  it('returns null for malformed JSON string instead of throwing', () => {
    expect(parsePublishSummary('not json')).toBeNull();
  });

  it('returns null for null/undefined/non-object inputs', () => {
    expect(parsePublishSummary(null)).toBeNull();
    expect(parsePublishSummary(undefined)).toBeNull();
    expect(parsePublishSummary(42 as any)).toBeNull();
  });

  it('returns null for wrong schema_version (forward compatibility)', () => {
    const s = buildPublishSummary(baseInput);
    const future = { ...s, schema_version: 99 };
    expect(parsePublishSummary(future)).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const s = buildPublishSummary(baseInput);
    const broken = { ...s } as any;
    delete broken.title;
    expect(parsePublishSummary(broken)).toBeNull();
  });

  it('returns null when a bucket is not a string array', () => {
    const s = buildPublishSummary(baseInput);
    const broken = { ...s, findings: ['ok', 42] as any };
    expect(parsePublishSummary(broken)).toBeNull();
  });

  it('returns null when sources entry is malformed', () => {
    const s = buildPublishSummary(baseInput);
    const broken = { ...s, sources: [{ message_id: 'm', excerpt: 42 } as any] };
    expect(parsePublishSummary(broken)).toBeNull();
  });

  it('returns null when generated_at_ms is the wrong type', () => {
    const s = buildPublishSummary(baseInput);
    const broken = { ...s, generated_at_ms: '2024' as any };
    expect(parsePublishSummary(broken)).toBeNull();
  });

  it('accepts authored_by as null without coercion', () => {
    const s = buildPublishSummary({ ...baseInput, authoredBy: null });
    const parsed = parsePublishSummary(serializePublishSummary(s));
    expect(parsed?.authored_by).toBeNull();
  });
});

describe('renderSummaryMarkdown', () => {
  const opts = { transcriptUrl: 'https://ant.local/r/lc-abc' };

  it('renders title, all populated sections, and back-link', () => {
    const s = buildPublishSummary(baseInput);
    const md = renderSummaryMarkdown(s, opts);
    expect(md).toContain('## Auth model walkthrough');
    expect(md).toContain('### Findings');
    expect(md).toContain('### Decisions');
    expect(md).toContain('### Asks');
    expect(md).toContain('### Actions');
    expect(md).toContain('### Sources');
    expect(md).toContain('Full transcript: https://ant.local/r/lc-abc');
  });

  it('omits empty bucket section headers', () => {
    const s = buildPublishSummary({
      title: 'sparse',
      linkedChatId: 'lc',
      originRoomId: 'r',
      findings: ['only finding'],
    });
    const md = renderSummaryMarkdown(s, opts);
    expect(md).toContain('### Findings');
    expect(md).not.toContain('### Decisions');
    expect(md).not.toContain('### Asks');
    expect(md).not.toContain('### Actions');
    expect(md).not.toContain('### Sources');
  });

  it('truncates long anchor excerpts with ellipsis', () => {
    const long = 'x'.repeat(200);
    const s = buildPublishSummary({
      ...baseInput,
      sources: [{ message_id: 'msg-long', excerpt: long }],
    });
    const md = renderSummaryMarkdown(s, opts);
    expect(md).toContain('msg-long: ');
    expect(md).toContain('...');
    expect(md).not.toContain(long);
  });

  it('always includes the transcript back-link even with empty buckets', () => {
    const s = buildPublishSummary({
      title: 'empty',
      linkedChatId: 'lc',
      originRoomId: 'r',
    });
    const md = renderSummaryMarkdown(s, opts);
    expect(md).toContain('Full transcript: https://ant.local/r/lc-abc');
  });
});
