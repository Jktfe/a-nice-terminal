import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  installStdinExitGuards,
  parsePsOutput,
  reapOlderSiblingMcpServers,
  staleSiblingMcpPids
} from '../src/lifecycle.js';

describe('mcp-server-ant lifecycle guards', () => {
  it('parses ps output into pid/ppid/command rows', () => {
    expect(
      parsePsOutput(`
        101  20 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js
        nope
        102  20 codex --yolo
      `)
    ).toEqual([
      {
        pid: 101,
        ppid: 20,
        command: 'node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js'
      },
      { pid: 102, ppid: 20, command: 'codex --yolo' }
    ]);
  });

  it('selects only same-parent older mcp-server-ant siblings', () => {
    const rows = parsePsOutput(`
      100  20 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js
      101  20 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js
      102  21 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js
      103  20 node other-tool/dist/index.js
    `);
    expect(staleSiblingMcpPids(rows, 101, 20)).toEqual([100]);
  });

  it('does not select siblings when current parent is launchd/init', () => {
    const rows = parsePsOutput(`
      100  1 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js
    `);
    expect(staleSiblingMcpPids(rows, 101, 1)).toEqual([]);
  });

  it('reaps selected siblings with SIGTERM and logs the count', async () => {
    const execFile = vi.fn((_cmd, _args, _opts, cb) => {
      cb(
        null,
        [
          '100 20 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js',
          '101 20 node /Applications/Antchat.app/Contents/Resources/mcp-server-ant/dist/index.js'
        ].join('\n'),
        ''
      );
    });
    const kill = vi.fn(() => true);
    const stderr = { write: vi.fn() };

    await expect(
      reapOlderSiblingMcpServers({
        currentPid: 101,
        currentPpid: 20,
        platform: 'darwin',
        execFile: execFile as never,
        kill,
        stderr
      })
    ).resolves.toEqual([100]);

    expect(kill).toHaveBeenCalledWith(100, 'SIGTERM');
    expect(stderr.write).toHaveBeenCalledWith(
      '@jktfe/mcp-server-ant reaped 1 stale sibling process(es): 100\n'
    );
  });

  it('exits once when stdin ends or closes', () => {
    const stdin = new EventEmitter();
    const stderr = { write: vi.fn() };
    const exit = vi.fn();
    const remove = installStdinExitGuards({ stdin, stderr, exit });

    stdin.emit('end');
    stdin.emit('close');
    remove();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(stderr.write).toHaveBeenCalledWith('@jktfe/mcp-server-ant stdio ended; exiting\n');
  });
});
