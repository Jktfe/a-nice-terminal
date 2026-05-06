import { captureScreenshot } from '../../src/lib/server/capture/screenshot.js';
import { queries } from '../../src/lib/server/db.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

function defaultDeps() {
  return {
    execFile: async (cmd: string, args: string[]) => {
      const { stdout, stderr } = await execFileAsync(cmd, args);
      return { stdout, stderr };
    },
    readFile: (path: string) => readFile(path),
    createHash: (algo: string) => createHash(algo),
    nowMs: () => Date.now(),
    mkdir: (dir: string) => mkdirSync(dir, { recursive: true }),
    insertRunEvent: async (args: {
      sessionId: string;
      tsMs: number;
      source: string;
      trust: string;
      kind: string;
      text: string;
      payload: string;
    }) => {
      return queries.insertRunEvent(
        args.sessionId,
        args.tsMs,
        args.source,
        args.trust,
        args.kind,
        args.text,
        args.payload,
      );
    },
  };
}

export async function evidence(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (sub === 'screenshot') {
    const sessionId = args[1];
    if (!sessionId) {
      console.error('Usage: ant evidence screenshot <session-id>');
      return;
    }
    const outputDir = flags.dir || join(process.env.HOME || '/tmp', '.ant-v3', 'evidence', 'screenshots');
    const deps = defaultDeps();
    try {
      const result = await captureScreenshot(sessionId, outputDir, deps);
      if (ctx.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Screenshot saved: ${result.path}`);
      console.log(`SHA256: ${result.sha256}`);
      console.log(`Size: ${result.bytes} bytes`);
    } catch (err: any) {
      console.error(`Screenshot failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.log(`Usage: ant evidence screenshot <session-id> [--dir /path]`);
}
