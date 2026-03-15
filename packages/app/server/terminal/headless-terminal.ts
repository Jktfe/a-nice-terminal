/**
 * HeadlessTerminalWrapper — wraps @xterm/headless to maintain
 * server-side terminal state as the single source of truth.
 *
 * Every byte from the PTY is fed into this headless terminal instance,
 * so it always mirrors exactly what the user sees in the browser.
 * Agents read structured state (screen lines, cursor position) directly
 * from this instance — no ANSI parsing, no tmux capture-pane hacks.
 */
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";

export class HeadlessTerminalWrapper {
  private term: InstanceType<typeof Terminal>;
  private serializeAddon: SerializeAddon;

  constructor(cols = 120, rows = 30) {
    this.term = new Terminal({
      cols,
      rows,
      scrollback: 10000,
      allowProposedApi: true,
      // No convertEol — tmux already sends CRLF
    });

    const unicode11 = new Unicode11Addon();
    this.term.loadAddon(unicode11);
    this.term.unicode.activeVersion = "11";

    this.serializeAddon = new SerializeAddon();
    this.term.loadAddon(this.serializeAddon);
  }

  /**
   * Feed raw PTY output into the headless terminal.
   * Call this for every chunk received from node-pty.
   */
  write(data: string | Buffer): void {
    if (Buffer.isBuffer(data)) {
      this.term.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else {
      this.term.write(data);
    }
  }

  /**
   * Get the visible screen as an array of clean text lines.
   * No ANSI sequences — just the text content.
   */
  getScreenLines(): string[] {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < this.term.rows; i++) {
      const line = buffer.getLine(buffer.baseY + i);
      lines.push(line ? line.translateToString(true) : "");
    }
    return lines;
  }

  /**
   * Get the full scrollback buffer as clean text lines.
   */
  getScrollback(): string[] {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.baseY; i++) {
      const line = buffer.getLine(i);
      lines.push(line ? line.translateToString(true) : "");
    }
    return lines;
  }

  /**
   * Get cursor position within the visible viewport.
   */
  getCursor(): { x: number; y: number } {
    return {
      x: this.term.buffer.active.cursorX,
      y: this.term.buffer.active.cursorY,
    };
  }

  /**
   * Serialize the full terminal state (scrollback + screen + cursor)
   * for client restore. The client can write this as a single chunk
   * to restore the terminal perfectly.
   */
  serializeState(): string {
    return this.serializeAddon.serialize();
  }

  /**
   * Get terminal dimensions.
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  /**
   * Resize the headless terminal to match PTY dimensions.
   */
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.term.dispose();
  }
}
