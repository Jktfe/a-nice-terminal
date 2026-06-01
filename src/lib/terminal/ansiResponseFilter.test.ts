import { describe, expect, it } from 'vitest';
import { isTerminalResponseLoopback } from './ansiResponseFilter';

describe('isTerminalResponseLoopback', () => {
  it('blocks DA1 device-attributes response', () => {
    expect(isTerminalResponseLoopback('\x1b[?62;c')).toBe(true);
    expect(isTerminalResponseLoopback('\x1b[?1;2c')).toBe(true);
  });
  it('blocks DA2/DA3 device-attributes response', () => {
    expect(isTerminalResponseLoopback('\x1b[>0;276;0c')).toBe(true);
  });
  it('blocks DSR cursor-position report', () => {
    expect(isTerminalResponseLoopback('\x1b[24;80R')).toBe(true);
  });
  it('blocks DSR generic status report', () => {
    expect(isTerminalResponseLoopback('\x1b[5n')).toBe(true);
  });
  it('blocks OSC 10/11 colour query response', () => {
    expect(isTerminalResponseLoopback('\x1b]10;rgb:f8f8/f7f7/f4f4\x1b\\')).toBe(true);
  });
  it('passes ordinary user input through', () => {
    expect(isTerminalResponseLoopback('ls -la\n')).toBe(false);
    expect(isTerminalResponseLoopback('\x1b[A')).toBe(false); // up-arrow
    expect(isTerminalResponseLoopback('\x03')).toBe(false); // Ctrl-C
  });
  it('passes empty string through (no-op)', () => {
    expect(isTerminalResponseLoopback('')).toBe(false);
  });
});
