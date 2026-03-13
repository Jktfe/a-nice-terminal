const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][AB012]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}
