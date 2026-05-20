import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created: string[] = [];

async function loadModule() {
  return await import('../../../scripts/start-snapshot.mjs');
}

function makeTmpRepo() {
  const root = join(
    tmpdir(),
    `ant-start-snapshot-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  created.push(root);
  return root;
}

function writeBuild(root: string, marker = 'one') {
  const build = join(root, 'build');
  mkdirSync(join(build, 'client', '_app', 'immutable', 'assets'), { recursive: true });
  mkdirSync(join(build, 'server'), { recursive: true });
  writeFileSync(join(build, 'index.js'), `export const marker = ${JSON.stringify(marker)};\n`);
  writeFileSync(join(build, 'handler.js'), [
    'function send(req, res, file, stats, headers) {',
    '\tres.writeHead(code, headers);',
    '\tfs.createReadStream(file, opts).pipe(res);',
    '}',
    ''
  ].join('\n'));
  writeFileSync(join(build, 'server', 'manifest.js'), `export const manifest = ${JSON.stringify(marker)};\n`);
  writeFileSync(join(build, 'client', '_app', 'immutable', 'assets', '22.old.css.gz'), marker);
  return build;
}

function writeRunnableBuild(root: string) {
  const build = writeBuild(root, 'served-from-snapshot');
  writeFileSync(join(build, 'index.js'), `
    import http from 'node:http';
    import { createReadStream } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { fileURLToPath } from 'node:url';

    const dir = dirname(fileURLToPath(import.meta.url));
    const server = http.createServer((_req, res) => {
      const stream = createReadStream(join(dir, 'client', '_app', 'immutable', 'assets', '22.old.css.gz'));
      stream.on('error', (err) => {
        res.statusCode = err?.code === 'ENOENT' ? 404 : 500;
        res.end(String(err?.code ?? err));
      });
      stream.pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      console.log('READY ' + address.port);
    });
  `);
  return build;
}

function waitForReady(proc: ChildProcessWithoutNullStreams) {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('snapshot server did not become ready'));
    }, 5_000);
    proc.stdout.on('data', (chunk) => {
      const text = String(chunk);
      const match = text.match(/READY (\d+)/);
      if (!match) return;
      settled = true;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.trim()) process.stderr.write(text);
    });
    proc.on('exit', (code) => {
      if (!settled) {
        clearTimeout(timer);
        reject(new Error(`snapshot server exited early with code ${code}`));
      }
    });
  });
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('start-snapshot deployment hardening', () => {
  it('copies build into an immutable runtime snapshot and atomically updates build-current', async () => {
    const { prepareImmutableBuildSnapshot } = await loadModule();
    const root = makeTmpRepo();
    const build = writeBuild(root, 'before');

    const result = prepareImmutableBuildSnapshot({
      repoRoot: root,
      buildDir: build,
      runtimeDir: join(root, '.ant-runtime'),
      snapshotId: 'snap-test'
    });

    expect(result.snapshotDir).toBe(join(root, '.ant-runtime', 'build-snapshots', 'snap-test'));
    expect(lstatSync(result.currentLink).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(result.snapshotDir, 'index.js'), 'utf8')).toContain('before');

    writeFileSync(join(build, 'index.js'), 'export const marker = "after";\n');

    expect(readFileSync(join(result.snapshotDir, 'index.js'), 'utf8')).toContain('before');
    expect(readFileSync(join(result.snapshotDir, 'index.js'), 'utf8')).not.toContain('after');
  });

  it('patches adapter-node static stream ENOENT handling before serving a snapshot', async () => {
    const { prepareImmutableBuildSnapshot } = await loadModule();
    const root = makeTmpRepo();
    const build = writeBuild(root, 'guard');

    const result = prepareImmutableBuildSnapshot({
      repoRoot: root,
      buildDir: build,
      runtimeDir: join(root, '.ant-runtime'),
      snapshotId: 'snap-guard'
    });

    const handler = readFileSync(join(result.snapshotDir, 'handler.js'), 'utf8');
    expect(handler).toContain("err?.code === 'ENOENT'");
    expect(handler).toContain('res.statusCode = 404');
    expect(handler).not.toContain('fs.createReadStream(file, opts).pipe(res);');
  });

  it('keeps package start pointed at the snapshot launcher', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBe('node scripts/start-snapshot.mjs');
    expect(existsSync(join(process.cwd(), 'scripts', 'start-snapshot.mjs'))).toBe(true);
  });

  it('launchd template supervises node directly instead of bun run start', () => {
    const plist = readFileSync(join(process.cwd(), 'deploy', 'com.ant.fresh.plist'), 'utf8');
    expect(plist).toContain('/Users/jamesking/.nvm/versions/node/v22.22.1/bin');
    expect(plist).toContain('<string>/Users/jamesking/.nvm/versions/node/v22.22.1/bin/node</string>');
    expect(plist).toContain('<string>--env-file=/Users/jamesking/.ant/secrets.env</string>');
    expect(plist).toContain('<string>scripts/start-snapshot.mjs</string>');
    expect(plist).not.toContain('<string>/Users/jamesking/.bun/bin/bun</string>');
    expect(plist).not.toContain('<string>/usr/bin/env</string>');
    expect(plist).not.toContain('<string>run</string>');
    expect(plist).not.toContain('<string>start</string>');
  });

  it('serves from the snapshot when source build files are replaced mid-run', async () => {
    const root = makeTmpRepo();
    const build = writeRunnableBuild(root);
    const script = join(process.cwd(), 'scripts', 'start-snapshot.mjs');
    const proc = spawn(process.execPath, [script], { cwd: root });

    try {
      const port = await waitForReady(proc);
      rmSync(join(build, 'client'), { recursive: true, force: true });
      mkdirSync(join(build, 'client', '_app', 'immutable', 'assets'), { recursive: true });
      writeFileSync(join(build, 'client', '_app', 'immutable', 'assets', '22.new.css.gz'), 'new-build');

      const res = await fetch(`http://127.0.0.1:${port}/_app/immutable/assets/22.old.css.gz`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('served-from-snapshot');
      expect(proc.exitCode).toBeNull();
    } finally {
      proc.kill('SIGTERM');
    }
  }, 10_000);
});
