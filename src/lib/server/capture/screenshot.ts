// M1 #1 — Screenshot capture helper
// DI-friendly: accepts all side-effects as arguments so tests can pass fakes.

import { join } from 'path';
import { mkdirSync } from 'fs';

export interface ScreenshotDeps {
  execFile: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  readFile: (path: string) => Promise<Buffer>;
  createHash: (algo: string) => { update: (data: Buffer) => { digest: (enc: 'hex') => string } };
  nowMs: () => number;
  mkdir: (dir: string) => void;
  insertRunEvent: (args: {
    sessionId: string;
    tsMs: number;
    source: string;
    trust: string;
    kind: string;
    text: string;
    payload: string;
  }) => Promise<unknown>;
}

export interface ScreenshotResult {
  path: string;
  sha256: string;
  bytes: number;
  tsMs: number;
}

const DEFAULT_DEPS: Partial<ScreenshotDeps> = {};

export async function captureScreenshot(
  sessionId: string,
  outputDir: string,
  deps: ScreenshotDeps,
): Promise<ScreenshotResult> {
  deps.mkdir(outputDir);
  const tsMs = deps.nowMs();
  const fileName = `screenshot-${sessionId}-${tsMs}.png`;
  const filePath = join(outputDir, fileName);

  await deps.execFile('screencapture', ['-x', filePath]);

  const buffer = await deps.readFile(filePath);
  const bytes = buffer.length;
  const sha256 = deps.createHash('sha256').update(buffer).digest('hex');

  const payload = JSON.stringify({ path: filePath, sha256, bytes });
  await deps.insertRunEvent({
    sessionId,
    tsMs,
    source: 'hook',
    trust: 'high',
    kind: 'screenshot',
    text: `Screenshot captured: ${fileName}`,
    payload,
  });

  return { path: filePath, sha256, bytes, tsMs };
}
