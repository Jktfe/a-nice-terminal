/**
 * parsers/index.ts — Registers all TranscriptTailParser plugins.
 * Import this once at boot to wire every CLI kind into the generic watcher.
 */

import { registerTranscriptTailParser } from '../transcriptTailParser';
import { claudeCodeParser } from './claudeCodeParser';
import { codexParser } from './codexParser';
import { copilotParser } from './copilotParser';
import { geminiParser } from './geminiParser';
import { piParser } from './piParser';
import { qwenParser } from './qwenParser';

export function registerAllTranscriptTailParsers(): void {
  registerTranscriptTailParser(claudeCodeParser);
  registerTranscriptTailParser(codexParser);
  registerTranscriptTailParser(copilotParser);
  registerTranscriptTailParser(geminiParser);
  registerTranscriptTailParser(piParser);
  registerTranscriptTailParser(qwenParser);
}

export { claudeCodeParser, codexParser, copilotParser, geminiParser, piParser, qwenParser };
