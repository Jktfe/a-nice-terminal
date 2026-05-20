import { describe, expect, it } from 'vitest';
import {
  detectMentionTrigger,
  rankMentionOptions,
  decideMentionKeyAction,
  spliceMentionPick
} from './composerMentions';
import type { RoomMember } from '$lib/server/chatRoomStore';
import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';

const sampleMembers: RoomMember[] = [
  {
    handle: '@evolveantclaude',
    displayName: '@evolveantclaude',
    displayColor: '#2563EB',
    displayIcon: 'C',
    displayBackgroundStyle: 'transparent',
    joinedAt: '',
    kind: 'agent'
  },
  {
    handle: '@evolveantcodex',
    displayName: '@evolveantcodex',
    displayColor: '#059669',
    displayIcon: 'X',
    displayBackgroundStyle: 'transparent',
    joinedAt: '',
    kind: 'agent'
  },
  {
    handle: '@james',
    displayName: '@james',
    displayColor: '#DC2626',
    displayIcon: 'J',
    displayBackgroundStyle: 'card',
    joinedAt: '',
    kind: 'human'
  }
];

const sampleAliases: RoomAliasEntry[] = [
  { roomId: 'r', globalHandle: '@evolveantcodex', alias: '@cdx', setAt: '' }
];

describe('detectMentionTrigger', () => {
  it('returns null when no @ has been typed', () => {
    expect(detectMentionTrigger('hello world', 11)).toBeNull();
  });

  it('triggers with empty partial when bare @ is typed (shows all members)', () => {
    const trigger = detectMentionTrigger('hello @', 7);
    expect(trigger).not.toBeNull();
    expect(trigger?.partialTyped).toBe('');
    expect(trigger?.startIndexInBody).toBe(6);
    expect(trigger?.endIndexInBody).toBe(7);
  });

  it('triggers with empty partial when @ is the entire body', () => {
    const trigger = detectMentionTrigger('@', 1);
    expect(trigger?.partialTyped).toBe('');
    expect(trigger?.startIndexInBody).toBe(0);
  });

  it('returns null when the @ is part of an email-like token', () => {
    expect(detectMentionTrigger('mail to user@host', 17)).toBeNull();
  });

  it('returns null when there is whitespace between @ and cursor', () => {
    expect(detectMentionTrigger('@ hello', 7)).toBeNull();
  });

  it('detects a mention at the start of the body', () => {
    const trigger = detectMentionTrigger('@cd', 3);
    expect(trigger).not.toBeNull();
    expect(trigger?.partialTyped).toBe('cd');
    expect(trigger?.startIndexInBody).toBe(0);
    expect(trigger?.endIndexInBody).toBe(3);
  });

  it('detects a mention after a space', () => {
    const trigger = detectMentionTrigger('hello @cl', 9);
    expect(trigger?.partialTyped).toBe('cl');
    expect(trigger?.startIndexInBody).toBe(6);
  });
});

describe('rankMentionOptions', () => {
  it('returns matching aliases first, then matching globals', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'cd');
    expect(options[0].handleToInsert).toBe('@cdx');
    expect(options[0].optionKind).toBe('alias');
  });

  it('omits a global handle if an alias already covers that member', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'evolveantcodex');
    expect(options.every((option) => option.handleToInsert !== '@evolveantcodex')).toBe(true);
  });

  it('matches partial substrings, case-insensitive', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'JAM');
    expect(options.some((option) => option.handleToInsert === '@james')).toBe(true);
  });

  it('returns an empty list when nothing matches', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'zzz');
    expect(options).toHaveLength(0);
  });

  it('ranks prior collaborators after aliases and current members', () => {
    const options = rankMentionOptions(
      sampleMembers,
      sampleAliases,
      'e',
      ['@elsie', '@evolveantglm']
    );
    const kinds = options.map((option) => option.optionKind);
    expect(kinds.indexOf('alias')).toBeLessThan(kinds.indexOf('global'));
    expect(kinds.indexOf('global')).toBeLessThan(kinds.indexOf('prior'));
  });

  it('omits a prior collaborator who is already a current member', () => {
    const options = rankMentionOptions(
      sampleMembers,
      [],
      'james',
      ['@james']
    );
    const priorOptions = options.filter((option) => option.optionKind === 'prior');
    expect(priorOptions).toHaveLength(0);
  });

  it('omits a prior collaborator who is already an alias target', () => {
    const options = rankMentionOptions(
      sampleMembers,
      sampleAliases,
      'evolveantcodex',
      ['@evolveantcodex']
    );
    const priorOptions = options.filter((option) => option.optionKind === 'prior');
    expect(priorOptions).toHaveLength(0);
  });

  it('matches prior collaborators case-insensitively', () => {
    const options = rankMentionOptions(
      sampleMembers,
      [],
      'ELS',
      ['@elsie']
    );
    expect(options.some((option) => option.handleToInsert === '@elsie')).toBe(true);
  });

  it('surfaces @everyone as a top broadcast option when the partial is empty', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, '');
    expect(options[0].handleToInsert).toBe('@everyone');
    expect(options[0].optionKind).toBe('broadcast');
  });

  it('surfaces @everyone while typing the substring "every"', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'every');
    expect(options.some((option) => option.handleToInsert === '@everyone')).toBe(true);
  });

  it('hides @everyone when the partial cannot prefix-match it', () => {
    const options = rankMentionOptions(sampleMembers, sampleAliases, 'james');
    expect(options.some((option) => option.handleToInsert === '@everyone')).toBe(false);
  });
});

describe('decideMentionKeyAction', () => {
  const fakeOptions = [
    { handleToInsert: '@a', displayLabel: '@a', contextHint: '', optionKind: 'global' as const },
    { handleToInsert: '@b', displayLabel: '@b', contextHint: '', optionKind: 'global' as const }
  ];

  it('returns navigate-down on ArrowDown', () => {
    expect(decideMentionKeyAction('ArrowDown', fakeOptions, 0)).toEqual({ action: 'navigate-down' });
  });

  it('returns insert with the active option on Enter', () => {
    expect(decideMentionKeyAction('Enter', fakeOptions, 1)).toEqual({
      action: 'insert',
      handleToInsert: '@b'
    });
  });

  it('returns insert on Tab too', () => {
    expect(decideMentionKeyAction('Tab', fakeOptions, 0)).toEqual({
      action: 'insert',
      handleToInsert: '@a'
    });
  });

  it('returns dismiss on Escape', () => {
    expect(decideMentionKeyAction('Escape', fakeOptions, 0)).toEqual({ action: 'dismiss' });
  });

  it('returns pass-through for unrelated keys', () => {
    expect(decideMentionKeyAction('a', fakeOptions, 0)).toEqual({ action: 'pass-through' });
  });

  it('returns pass-through when options are empty for arrows', () => {
    expect(decideMentionKeyAction('ArrowDown', [], 0)).toEqual({ action: 'pass-through' });
  });
});

describe('spliceMentionPick', () => {
  it('replaces the active mention partial with the picked handle plus a space', () => {
    const result = spliceMentionPick('hello @cd', { partialTyped: 'cd', startIndexInBody: 6, endIndexInBody: 9 }, '@cdx');
    expect(result.newBody).toBe('hello @cdx ');
    expect(result.newCursorIndex).toBe(11);
  });

  it('preserves text after the cursor', () => {
    const result = spliceMentionPick(
      'see @cd later',
      { partialTyped: 'cd', startIndexInBody: 4, endIndexInBody: 7 },
      '@cdx'
    );
    expect(result.newBody).toBe('see @cdx  later');
  });
});
