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
      return queries.appendRunEvent(
        args.sessionId,
        args.tsMs,
        args.source,
        args.trust,
        args.kind,
        args.text,
        args.payload,
        null,
      );
    },
  };
}

export async function evidence(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (sub === 'screenshot') {
    const sessionId = args[1];
    if (!sessionId) {
      console.error('Usage: ant evidence screenshot \u003csession-id\u003e');
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

  if (sub === 'visual-baseline') {
    const sessionId = args[1];
    if (!sessionId) {
      console.error('Usage: ant evidence visual-baseline \u003csession-id\u003e [--base-url http://localhost:5173]');
      return;
    }
    const baseUrl = flags.baseUrl || flags['base-url'] || 'http://localhost:5173';
    const outDir = flags.dir || join(process.env.HOME || '/tmp', '.ant-v3', 'evidence', 'visual-qa');
    const scriptPath = join(process.cwd(), 'scripts', 'visual-qa-capture.mjs');

    try {
      // Run the visual QA capture script
      const { stdout, stderr } = await execFileAsync('node', [
        scriptPath,
        '--base-url', baseUrl,
        '--out-dir', outDir,
      ]);
      if (stderr) console.error(stderr);
      console.log(stdout);

      // Read the baseline JSON
      const baselinePath = join(outDir, 'baseline.json');
      const baselineRaw = await readFile(baselinePath, 'utf-8');
      const baseline = JSON.parse(baselineRaw);

      // Emit run_event
      const payload = JSON.stringify({
        out_dir: outDir,
        states: baseline.states.map((s: any) => ({
          name: s.name,
          screenshot: s.screenshot,
          bytes: s.bytes,
          timestamp: s.timestamp,
        })),
      });
      const ev = queries.appendRunEvent(
        sessionId,
        Date.now(),
        'hook',
        'high',
        'visual_baseline',
        `Visual baseline captured: ${baseline.states.length} states`,
        payload,
        null,
      );

      if (ctx.json) {
        console.log(JSON.stringify({ ok: true, baseline, run_event: ev }, null, 2));
        return;
      }
      console.log(`Visual baseline captured for ${sessionId}`);
      console.log(`States: ${baseline.states.map((s: any) => s.name).join(', ')}`);
      console.log(`Run event: ${(ev as any)?.id ?? 'saved'}`);
    } catch (err: any) {
      console.error(`Visual baseline failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.log(`Usage: ant evidence screenshot \u003csession-id\u003e [--dir /path]`);
  console.log(`       ant evidence visual-baseline \u003csession-id\u003e [--base-url http://localhost:5173] [--dir /path]`);
}
