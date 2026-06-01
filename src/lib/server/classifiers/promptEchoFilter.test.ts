import { describe, it, expect } from 'vitest';
import { isShellPromptLine } from './promptEchoFilter';
import { classifyCodex } from './codex';
import { classifyClaudeCode } from './claudeCode';

describe('isShellPromptLine — bare/compound/continuation prompt patterns', () => {
  it('matches bare zsh % prompt', () => {
    expect(isShellPromptLine('%')).toBe(true);
    expect(isShellPromptLine('  %')).toBe(true);
    expect(isShellPromptLine('% ')).toBe(true);
  });

  it('matches bare $ / # / > prompts', () => {
    expect(isShellPromptLine('$')).toBe(true);
    expect(isShellPromptLine('#')).toBe(true);
    expect(isShellPromptLine('>')).toBe(true);
  });

  it('matches compound user@host:cwd$ prompts', () => {
    expect(isShellPromptLine('user@host:~/path$')).toBe(true);
    expect(isShellPromptLine('alice@server: /tmp #')).toBe(true);
  });

  it('matches continuation prompts (heredoc)', () => {
    expect(isShellPromptLine('?')).toBe(true);
  });

  it('does NOT match prompts with content after them', () => {
    expect(isShellPromptLine('$ ls -la')).toBe(false);
    expect(isShellPromptLine('> reasoning text')).toBe(false);
    expect(isShellPromptLine('% echo hi')).toBe(false);
  });

  it('does NOT match plain message text', () => {
    expect(isShellPromptLine('working on the file')).toBe(false);
    expect(isShellPromptLine('Loading...')).toBe(false);
  });

  // delta-5 (2026-05-14, JWPK dogfood): compound prompt with INLINED command echo.
  it('matches compound prompt with inlined command (zsh)', () => {
    expect(isShellPromptLine('user@host ~ % echo hello')).toBe(true);
    expect(isShellPromptLine('alice@server:/tmp $ ls -la')).toBe(true);
    expect(isShellPromptLine('root@host:/var/log # tail -f messages')).toBe(true);
  });

  it('matches compound prompt with single-arg inlined command', () => {
    expect(isShellPromptLine('user@host ~ % pwd')).toBe(true);
  });

  // delta-5: tmux pane status bar lines.
  it('matches tmux pane status-bar lines', () => {
    expect(isShellPromptLine('t_abc123:zsh*    padding here')).toBe(true);
    expect(isShellPromptLine('t_nosg7o50:zsh*       ')).toBe(true);
  });

  it('matches tmux pane status with leading bracket (partial-CSI residue)', () => {
    expect(isShellPromptLine('[t_hi61kxz0:zsh*                       ')).toBe(true);
  });

  it('does NOT match plain text starting with t_', () => {
    expect(isShellPromptLine('t_id_used in code is fine')).toBe(false);
  });

  // delta-5b: cursor-jumped compound prompt (no `% ` separator left).
  it('matches user@host prefix with anything following (cursor-jumped variant)', () => {
    expect(isShellPromptLine('user@host ~echo D5-CLEAN')).toBe(true);
    expect(isShellPromptLine('alice@server cmd')).toBe(true);
  });

  it('does NOT match plain text without user@host prefix', () => {
    expect(isShellPromptLine('echo D5-CLEAN')).toBe(false);
    expect(isShellPromptLine('D5-CLEAN-PROBE')).toBe(false);
  });

  // delta-6 (2026-05-14, JWPK guff): JWPK's default zsh prompt is
  // `user@host` space-separated; cursor-redraw doubles/triples it.
  it('matches bare user@host with no trailing chars (delta-6)', () => {
    expect(isShellPromptLine('user@host')).toBe(true);
  });

  it('matches user@host followed by % alone (delta-6)', () => {
    expect(isShellPromptLine('user@host %')).toBe(true);
  });

  it('matches doubled/tripled user@host (cursor-redraw variant, delta-6)', () => {
    expect(isShellPromptLine('user@host user@host')).toBe(true);
    expect(isShellPromptLine('user@host user@host %')).toBe(true);
  });
});

describe('classifyCodex demotes shell prompts to kind=raw', () => {
  it('bare % line → raw not message', () => {
    const result = classifyCodex('%\n');
    expect(result.events[0].kind).toBe('raw');
    expect(result.events[0].trust).toBe('raw');
  });

  it('compound prompt → raw', () => {
    const result = classifyCodex('user@host:~$\n');
    expect(result.events[0].kind).toBe('raw');
  });

  it('prompt-with-cmd `$ ls` still classifies as command (not prompt)', () => {
    const result = classifyCodex('$ ls\n');
    expect(result.events[0].kind).toBe('command');
  });
});

describe('classifyClaudeCode demotes shell prompts to kind=raw', () => {
  it('bare % → raw', () => {
    const result = classifyClaudeCode('%\n');
    expect(result.events[0].kind).toBe('raw');
    expect(result.events[0].trust).toBe('raw');
  });

  it('plain text still classifies as message', () => {
    const result = classifyClaudeCode('hello world\n');
    expect(result.events[0].kind).toBe('message');
    expect(result.events[0].trust).toBe('medium');
  });
});
