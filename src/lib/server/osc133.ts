import stripAnsi from 'strip-ansi';

export type Osc133CommandBlock = {
  command: string;
  exitCode: number | null;
  cwd: string | null;
  startedAtMs: number;
  endedAtMs: number;
  rawStartByte: number;
  rawEndByte: number;
  markers: {
    promptStartByte: number | null;
    commandStartByte: number | null;
    outputStartByte: number | null;
    commandEndByte: number;
  };
};

type PendingCommand = {
  command: string;
  rawStartByte: number;
  commandStartByte: number | null;
  outputStartByte: number | null;
  startedAtMs: number;
};

type OscMarker =
  | { kind: 'prompt_start'; rawStartByte: number; rawEndByte: number }
  | { kind: 'command_start'; rawStartByte: number; rawEndByte: number }
  | { kind: 'output_start'; rawStartByte: number; rawEndByte: number }
  | { kind: 'command_end'; rawStartByte: number; rawEndByte: number; exitCode: number | null }
  | { kind: 'cwd'; rawStartByte: number; rawEndByte: number; cwd: string };

const OSC = '\x1b]';
const BEL = '\x07';
const ST = '\x1b\\';

export class Osc133BlockParser {
  private buffer = '';
  private bufferStartByte = 0;
  private textSincePrompt = '';
  private promptStartByte: number | null = null;
  private currentCwd: string | null = null;
  private pending: PendingCommand | null = null;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  push(data: string, chunkStartByte: number): Osc133CommandBlock[] {
    if (!data) return [];
    if (!this.buffer) this.bufferStartByte = chunkStartByte;
    this.buffer += data;

    const blocks: Osc133CommandBlock[] = [];

    while (this.buffer) {
      const oscIndex = this.buffer.indexOf(OSC);

      if (oscIndex < 0) {
        const keepChars = this.buffer.endsWith('\x1b') ? 1 : 0;
        const text = this.buffer.slice(0, this.buffer.length - keepChars);
        if (text) {
          this.consumeText(text);
          this.advance(text.length);
        }
        break;
      }

      if (oscIndex > 0) {
        const text = this.buffer.slice(0, oscIndex);
        this.consumeText(text);
        this.advance(oscIndex);
        continue;
      }

      const terminator = findOscTerminator(this.buffer);
      if (!terminator) {
        // Do not hold unbounded data if a malformed OSC sequence is printed.
        if (Buffer.byteLength(this.buffer) > 16_384) {
          this.consumeText(this.buffer[0]);
          this.advance(1);
        }
        break;
      }

      const rawStartByte = this.bufferStartByte;
      const rawSequence = this.buffer.slice(0, terminator.endIndex + terminator.length);
      const rawEndByte = rawStartByte + Buffer.byteLength(rawSequence);
      const body = this.buffer.slice(OSC.length, terminator.endIndex);
      const marker = parseOscBody(body, rawStartByte, rawEndByte);
      if (marker) {
        const block = this.applyMarker(marker);
        if (block) blocks.push(block);
      }
      this.advance(terminator.endIndex + terminator.length);
    }

    return blocks;
  }

  private consumeText(text: string): void {
    if (!text) return;
    this.textSincePrompt += text;
    if (this.textSincePrompt.length > 8_000) {
      this.textSincePrompt = this.textSincePrompt.slice(-8_000);
    }
  }

  private advance(chars: number): void {
    const consumed = this.buffer.slice(0, chars);
    this.bufferStartByte += Buffer.byteLength(consumed);
    this.buffer = this.buffer.slice(chars);
  }

  private applyMarker(marker: OscMarker): Osc133CommandBlock | null {
    switch (marker.kind) {
      case 'prompt_start':
        this.promptStartByte = marker.rawStartByte;
        this.textSincePrompt = '';
        return null;

      case 'cwd':
        this.currentCwd = marker.cwd;
        return null;

      case 'command_start': {
        const command = extractCommandCandidate(this.textSincePrompt);
        this.pending = {
          command,
          rawStartByte: marker.rawStartByte,
          commandStartByte: marker.rawStartByte,
          outputStartByte: null,
          startedAtMs: this.nowMs(),
        };
        return null;
      }

      case 'output_start': {
        const command = extractCommandCandidate(this.textSincePrompt);
        if (!this.pending) {
          this.pending = {
            command,
            rawStartByte: marker.rawStartByte,
            commandStartByte: null,
            outputStartByte: marker.rawStartByte,
            startedAtMs: this.nowMs(),
          };
        } else {
          this.pending.command = this.pending.command || command;
          this.pending.outputStartByte = marker.rawStartByte;
        }
        return null;
      }

      case 'command_end': {
        const pending = this.pending;
        this.pending = null;
        if (!pending) return null;
        return {
          command: pending.command || extractCommandCandidate(this.textSincePrompt) || '(unknown)',
          exitCode: marker.exitCode,
          cwd: this.currentCwd,
          startedAtMs: pending.startedAtMs,
          endedAtMs: this.nowMs(),
          rawStartByte: pending.rawStartByte,
          rawEndByte: marker.rawEndByte,
          markers: {
            promptStartByte: this.promptStartByte,
            commandStartByte: pending.commandStartByte,
            outputStartByte: pending.outputStartByte,
            commandEndByte: marker.rawStartByte,
          },
        };
      }
    }
  }
}

function findOscTerminator(s: string): { endIndex: number; length: number } | null {
  const bel = s.indexOf(BEL, OSC.length);
  const st = s.indexOf(ST, OSC.length);
  if (bel < 0 && st < 0) return null;
  if (bel >= 0 && (st < 0 || bel < st)) return { endIndex: bel, length: BEL.length };
  return { endIndex: st, length: ST.length };
}

function parseOscBody(body: string, rawStartByte: number, rawEndByte: number): OscMarker | null {
  const parts = body.split(';');
  if (parts[0] === '133') {
    const code = parts[1] ?? '';
    if (code === 'A') return { kind: 'prompt_start', rawStartByte, rawEndByte };
    if (code === 'B') return { kind: 'command_start', rawStartByte, rawEndByte };
    if (code === 'C') return { kind: 'output_start', rawStartByte, rawEndByte };
    if (code === 'D') {
      const exit = parts[2] == null || parts[2] === '' ? null : Number.parseInt(parts[2], 10);
      return {
        kind: 'command_end',
        rawStartByte,
        rawEndByte,
        exitCode: Number.isFinite(exit) ? exit : null,
      };
    }
  }

  if (parts[0] === '7' && body.startsWith('7;file://')) {
    return { kind: 'cwd', rawStartByte, rawEndByte, cwd: parseFileCwd(body.slice(2)) };
  }

  if (parts[0] === '1337') {
    const currentDir = parts.find((part) => part.startsWith('CurrentDir='));
    if (currentDir) {
      return {
        kind: 'cwd',
        rawStartByte,
        rawEndByte,
        cwd: parseFileCwd(currentDir.slice('CurrentDir='.length)),
      };
    }
  }

  return null;
}

function parseFileCwd(raw: string): string {
  let value = raw;
  if (value.startsWith('file://')) {
    const withoutScheme = value.slice('file://'.length);
    const slash = withoutScheme.indexOf('/');
    value = slash >= 0 ? withoutScheme.slice(slash) : '/';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractCommandCandidate(raw: string): string {
  const cleaned = applyBackspaces(stripAnsi(raw))
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const line = cleaned
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) ?? '';

  if (!line) return '';

  const promptMatch = line.match(/(?:^|.*\s)(?:[$#%]|[❯>])\s*(\S.*)$/u);
  return (promptMatch?.[1] ?? line).trim();
}

function applyBackspaces(value: string): string {
  const out: string[] = [];
  for (const ch of value) {
    if (ch === '\b') {
      out.pop();
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}
