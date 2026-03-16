const KEY_MAP: Record<string, string> = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  tab: "\t",
  enter: "\r",
  space: " ",
  escape: "\x1b",
  esc: "\x1b",
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  backspace: "\x7f",
  delete: "\x1b[3~",
  home: "\x1b[H",
  end: "\x1b[F",
};

export function parseKey(name: string): string {
  const key = KEY_MAP[name.toLowerCase()];
  if (!key) throw new Error(`Unknown key: "${name}". Valid keys: ${Object.keys(KEY_MAP).join(", ")}`);
  return key;
}

export type SeqStep = { type: "key"; data: string } | { type: "wait"; ms: number };

export function parseSequence(seq: string): SeqStep[] {
  const steps: SeqStep[] = [];
  for (const token of seq.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const [name, countStr] = trimmed.split(":");
    if (name.toLowerCase() === "wait") {
      steps.push({ type: "wait", ms: parseInt(countStr || "100", 10) });
      continue;
    }
    const count = countStr ? parseInt(countStr, 10) : 1;
    const data = parseKey(name);
    for (let i = 0; i < count; i++) {
      steps.push({ type: "key", data });
    }
  }
  return steps;
}
