import { describe, it, expect } from 'vitest';
import { classifyClaudeCode } from './claudeCode';

function classify(buf: string) {
  return classifyClaudeCode(buf);
}

describe('classifyClaudeCode — TUI chrome demotion (2026-05-14 polish)', () => {
  it('demotes box-drawing-only lines to raw', () => {
    expect(classify('│ ─ │ ─ │\n').events[0].kind).toBe('raw');
    expect(classify('┌──────┐\n').events[0].kind).toBe('raw');
    expect(classify('└──────┘\n').events[0].kind).toBe('raw');
  });

  it('demotes hotkey-footer lines (esc/ctrl/shift to ...) to raw', () => {
    expect(classify('esc to interrupt\n').events[0].kind).toBe('raw');
    expect(classify('ctrl+c to exit\n').events[0].kind).toBe('raw');
    expect(classify('shift+tab to cycle modes\n').events[0].kind).toBe('raw');
  });

  it('demotes spinner / Working... lines to raw', () => {
    expect(classify('Working...\n').events[0].kind).toBe('raw');
    expect(classify('  Thinking\n').events[0].kind).toBe('raw');
    expect(classify('| Loading\n').events[0].kind).toBe('raw');
  });

  it('preserves real reply text as kind=message', () => {
    expect(classify('Yes the terminal is working — claude here\n').events[0].kind).toBe('message');
    expect(classify('Here is what I found in the file: foo bar baz\n').events[0].kind).toBe('message');
  });

  it('preserves prefix rules (thinking / tool_call) over chrome demotion', () => {
    expect(classify('[thinking] reasoning step\n').events[0].kind).toBe('thinking');
    expect(classify('[tool_use] grep src/\n').events[0].kind).toBe('tool_call');
  });

  // Phase 2 upgrade — Terminal 23:22 specific patterns.
  it('demotes 4+ q-run horizontal separator (post-strip)', () => {
    expect(classify('qqqqqqqqqqqqqqqqqq\n').events[0].kind).toBe('raw');
  });

  it('demotes "bypass permissions" footer phrase', () => {
    expect(classify('  bypass permissions  \n').events[0].kind).toBe('raw');
    expect(classify('Claude is in bypass permissions mode\n').events[0].kind).toBe('raw');
  });

  it('demotes "on ? for shortcuts" hint', () => {
    expect(classify('Press on ? for shortcuts\n').events[0].kind).toBe('raw');
  });

  it('demotes hook timing footer (sent:N resp:N edit:N)', () => {
    expect(classify('sent:12 resp:5 edit:0\n').events[0].kind).toBe('raw');
    expect(classify('  sent: 100  resp: 42  edit: 3  ms=180  \n').events[0].kind).toBe('raw');
  });

  it('demotes 2+ underscores alone (cursor indicator)', () => {
    expect(classify('___\n').events[0].kind).toBe('raw');
    expect(classify('  __  \n').events[0].kind).toBe('raw');
  });

  it('demotes standalone status badges', () => {
    expect(classify('Remote Control\n').events[0].kind).toBe('raw');
    expect(classify('Done\n').events[0].kind).toBe('raw');
    expect(classify('Working\n').events[0].kind).toBe('raw');
  });

  it('preserves real reply text that mentions trigger words', () => {
    expect(classify('Working on the file you mentioned earlier\n').events[0].kind).toBe('message');
    expect(classify('Done with the refactor and ready for review\n').events[0].kind).toBe('message');
  });

  // delta-3 fragment-tolerant patterns (2026-05-15, JWPK Terminal 23:52).
  it('demotes 10+ q-run anywhere in line (post-strip horizontal residue)', () => {
    expect(classify('text qqqqqqqqqq more\n').events[0].kind).toBe('raw');
  });

  it('demotes 10+ underscore run anywhere in line', () => {
    expect(classify('foo __________ bar\n').events[0].kind).toBe('raw');
  });

  it('demotes truncated TUI fragments (ift+tab, bypasspermissions, __bypass)', () => {
    expect(classify('ift+tab to cycle\n').events[0].kind).toBe('raw');
    expect(classify('bypasspermissions mode\n').events[0].kind).toBe('raw');
    expect(classify('__bypass __bypasspermissions\n').events[0].kind).toBe('raw');
  });

  it('demotes "Use /permissions" startup tip', () => {
    expect(classify('Use /permissions to pre-approve\n').events[0].kind).toBe('raw');
  });

  it('demotes expanded spinner vocab (Twisting/Compounting/Streaming/Generating/Running/Noodling)', () => {
    expect(classify('Twisting...\n').events[0].kind).toBe('raw');
    expect(classify('Compounting...\n').events[0].kind).toBe('raw');
    expect(classify('Streaming\n').events[0].kind).toBe('raw');
    expect(classify('Noodling...\n').events[0].kind).toBe('raw');
  });

  it('demotes claude full status-line shape (3+ signals: model+percent+Working)', () => {
    expect(classify('sent:23:56:06 resp:5 a-nice-terminal Opus 4.7 2m:7% Working RemoteControl active\n').events[0].kind).toBe('raw');
    expect(classify('Sonnet 4.6 50% Working\n').events[0].kind).toBe('raw');
  });

  it('preserves real reply text that mentions only ONE status signal', () => {
    expect(classify('I am working on it\n').events[0].kind).toBe('message');
    expect(classify('The model Opus 4 has 200k context\n').events[0].kind).toBe('message');
  });
});
