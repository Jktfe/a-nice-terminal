/**
 * ansiResponseFilter — block xterm-emitted terminal-emulator query
 * responses from looping back as PTY input.
 *
 * Background (v2 lesson lifted from v3): xterm.js answers DA1/DA2/DSR
 * cursor-position queries and OSC 10/11/4 colour queries directly out
 * of the terminal data event. If those bytes are piped back to the PTY
 * write path, they appear in the shell prompt as garbage characters
 * (e.g. literal `\e[?62;c`). This filter detects the canonical response
 * shapes and drops them before they reach the network.
 *
 * The shapes are narrow + well-known: anything an actual user types or
 * pastes will never match. Bun-test coverage in the sibling .test.ts.
 */

const CSI_RESPONSE_PATTERNS: readonly RegExp[] = [
  /^\x1b\[\??[>]?[\d;]*c$/, // DA1 / DA2 / DA3 device-attributes report
  /^\x1b\[\d+;\d+[Rn]$/,     // DSR cursor position report
  /^\x1b\[\d*n$/              // DSR generic status report
];

const OSC_COLOUR_RESPONSE_RE = /^\x1b\][0-9]+;rgb:[0-9a-fA-F\/]+\x1b\\$/;

export function isTerminalResponseLoopback(data: string): boolean {
  if (data.length === 0) return false;
  for (const pattern of CSI_RESPONSE_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return OSC_COLOUR_RESPONSE_RE.test(data);
}
