import { describe, expect, it } from 'vitest';
import { buildNudgeSnippet } from '../cli/lib/ask-nudge.js';

const baseAsk = {
  id: 'ASKABCDEFGH',
  title: 'Approve M3 #2 schema?',
  status: 'open',
  assigned_to: '@jwpk',
  body: 'Schema landed at 94fea52, 24 tests green.',
  recommendation: 'Approve.',
  session_id: 'room-1',
  session_name: 'cloudANT',
};

describe('buildNudgeSnippet', () => {
  it('addresses the assignee and includes the ask id + title on the first line', () => {
    const out = buildNudgeSnippet(baseAsk);
    const first = out.split('\n')[0];
    expect(first).toBe('@jwpk — open ask [ASKABCDEFGH]: Approve M3 #2 schema?');
  });

  it('includes paste-ready CLI snippets for all four answer actions', () => {
    const out = buildNudgeSnippet(baseAsk);
    expect(out).toContain('ant ask answer ASKABCDEFGH approve --msg');
    expect(out).toContain('ant ask answer ASKABCDEFGH reject  --msg');
    expect(out).toContain('ant ask answer ASKABCDEFGH defer   --msg');
    expect(out).toContain('ant ask answer ASKABCDEFGH dismiss --msg');
  });

  it('includes context and recommendation when present', () => {
    const out = buildNudgeSnippet(baseAsk);
    expect(out).toContain('Context: Schema landed at 94fea52, 24 tests green.');
    expect(out).toContain('Recommend: Approve.');
  });

  it('omits context line when body is empty/whitespace', () => {
    const out = buildNudgeSnippet({ ...baseAsk, body: '   ' });
    expect(out).not.toContain('Context:');
  });

  it('omits recommend line when recommendation is empty/whitespace', () => {
    const out = buildNudgeSnippet({ ...baseAsk, recommendation: '' });
    expect(out).not.toContain('Recommend:');
  });

  it('falls back to @everyone when assigned_to is null', () => {
    const out = buildNudgeSnippet({ ...baseAsk, assigned_to: null });
    expect(out.split('\n')[0]).toContain('@everyone — open ask');
  });

  it('honours addressedTo override (used by `ant ask outstanding --to @x`)', () => {
    const out = buildNudgeSnippet(baseAsk, { addressedTo: '@kimiant' });
    expect(out.split('\n')[0]).toContain('@kimiant — open ask');
  });

  it('uses the asks status verbatim (candidate, deferred, etc.)', () => {
    const candidate = buildNudgeSnippet({ ...baseAsk, status: 'candidate' });
    expect(candidate.split('\n')[0]).toContain('candidate ask [');
    const deferred = buildNudgeSnippet({ ...baseAsk, status: 'deferred' });
    expect(deferred.split('\n')[0]).toContain('deferred ask [');
  });

  it('still produces the CLI snippets when only id + title are supplied', () => {
    const out = buildNudgeSnippet({ id: 'AKMINIMAL', title: 'Quick one?' });
    expect(out).toContain('@everyone — open ask [AKMINIMAL]: Quick one?');
    expect(out).toContain('ant ask answer AKMINIMAL approve --msg');
  });
});
