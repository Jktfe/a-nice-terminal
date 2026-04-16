export const SPECIAL_KEYS = [
  { label: 'Kill',  seq: '\x03',   cli: 'ctrl-c' },
  { label: '⇧Tab',  seq: '\x1b[Z', cli: 'shift-tab' },
  { label: 'Tab',   seq: '\t',     cli: 'tab' },
  { label: 'Enter',  seq: '\r',     cli: 'enter' },
  { label: '←',     seq: '\x1b[D', cli: 'left' },
  { label: '→',     seq: '\x1b[C', cli: 'right' },
  { label: '↑',     seq: '\x1b[A', cli: 'up' },
  { label: '↓',     seq: '\x1b[B', cli: 'down' },
  { label: 'Esc',   seq: '\x1b',   cli: 'escape' },
  { label: 'Paste', seq: '__paste__', cli: 'paste' },
  { label: '^C',    seq: '\x03',   cli: 'ctrl-c' },
] as const;

export function getKeySequence(name: string): string | null {
  const key = SPECIAL_KEYS.find(k => k.cli === name);
  return key?.seq ?? null;
}
