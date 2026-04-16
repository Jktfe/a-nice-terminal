import { describe, it, expect } from 'vitest';
import { parseArgs } from '../cli/lib/args.js';

describe('CLI arg parser', () => {
  it('parses a command with no flags', () => {
    const result = parseArgs(['sessions']);
    expect(result.command).toBe('sessions');
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it('parses positional args after command', () => {
    const result = parseArgs(['chat', 'send', 'abc123']);
    expect(result.command).toBe('chat');
    expect(result.args).toEqual(['send', 'abc123']);
  });

  it('parses long flags with values', () => {
    const result = parseArgs(['chat', 'send', 'abc', '--msg', 'hello world', '--server', 'https://localhost:6458']);
    expect(result.flags.msg).toBe('hello world');
    expect(result.flags.server).toBe('https://localhost:6458');
  });

  it('parses boolean flags (no value)', () => {
    const result = parseArgs(['sessions', '--help']);
    expect(result.flags.help).toBe(true);
  });

  it('parses short flags with value', () => {
    const result = parseArgs(['chat', 'send', 'abc', '-m', 'hello']);
    expect(result.flags.msg).toBe('hello');
  });

  it('maps short flag -s to server', () => {
    const result = parseArgs(['-s', 'https://example.com']);
    expect(result.flags.server).toBe('https://example.com');
  });

  it('maps short flag -h to help as boolean', () => {
    const result = parseArgs(['-h']);
    expect(result.flags.help).toBe(true);
  });

  it('handles mixed positional and flags', () => {
    const result = parseArgs(['terminal', 'send', 'sess1', '--cmd', 'ls -la', '--server', 'https://localhost:6458']);
    expect(result.command).toBe('terminal');
    expect(result.args).toEqual(['send', 'sess1']);
    expect(result.flags.cmd).toBe('ls -la');
    expect(result.flags.server).toBe('https://localhost:6458');
  });

  it('returns empty command when no args', () => {
    const result = parseArgs([]);
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });
});
