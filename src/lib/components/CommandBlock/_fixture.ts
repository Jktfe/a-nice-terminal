// M3 CommandBlock visual harness fixture.
// Mirrors R4 §3a {kind, payload, trust, raw_ref} shape.
// Replaces with live projector data once @ocloudant-dev lands the canonical
// projection. Filename starts with `_` to mark dev-only.

import type { RunEvent } from './types';

export const sampleRunEvents: RunEvent[] = [
  {
    id: 'evt_001',
    session_id: 'ses_demo',
    ts: 1746189000000,
    source: 'hook',
    trust: 'high',
    kind: 'command_block',
    raw_ref: 'transcript_001:0-128',
    payload: {
      command: 'ls',
      cwd: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      exit_code: 0,
      started_at: '2026-05-02T18:30:00.000Z',
      finished_at: '2026-05-02T18:30:00.014Z',
      duration_ms: 14,
      output: 'README.md\nbun.lock\ndocs\npackage.json\nsrc\ntests\n',
      output_truncated: false,
    },
  },
  {
    id: 'evt_002',
    session_id: 'ses_demo',
    ts: 1746189001000,
    source: 'hook',
    trust: 'high',
    kind: 'command_block',
    raw_ref: 'transcript_001:128-176',
    payload: {
      command: 'false',
      cwd: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      exit_code: 1,
      started_at: '2026-05-02T18:30:01.000Z',
      finished_at: '2026-05-02T18:30:01.003Z',
      duration_ms: 3,
      output: '',
      output_truncated: false,
    },
  },
  {
    id: 'evt_003',
    session_id: 'ses_demo',
    ts: 1746189002000,
    source: 'hook',
    trust: 'high',
    kind: 'command_block',
    raw_ref: 'transcript_001:176-220',
    payload: {
      command: 'echo ok',
      cwd: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      exit_code: 0,
      started_at: '2026-05-02T18:30:02.000Z',
      finished_at: '2026-05-02T18:30:02.002Z',
      duration_ms: 2,
      output: 'ok\n',
      output_truncated: false,
    },
  },
  {
    id: 'evt_004',
    session_id: 'ses_demo',
    ts: 1746189010000,
    source: 'hook',
    trust: 'high',
    kind: 'command_block',
    raw_ref: 'transcript_001:220-15400',
    payload: {
      command: 'bun install',
      cwd: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      exit_code: 0,
      started_at: '2026-05-02T18:30:10.000Z',
      finished_at: '2026-05-02T18:30:14.820Z',
      duration_ms: 4820,
      output:
        'bun install v1.1.42\n+ @sveltejs/adapter-node@5.5.4\n+ @sveltejs/kit@2.56.1\n' +
        '+ @sveltejs/vite-plugin-svelte@7.0.0\n+ @tailwindcss/vite@4.2.2\n+ @types/node@25.5.2\n' +
        '+ @xterm/addon-fit@0.11.0\n+ @xterm/addon-serialize@0.14.0\n+ @xterm/addon-webgl@0.19.0\n' +
        '+ @xterm/xterm@6.0.0\n+ better-sqlite3@12.8.0\n+ dotenv@17.4.1\n+ gray-matter@4.0.3\n' +
        '+ isomorphic-dompurify@3.11.0\n+ marked@17.0.6\n+ nanoid@5.1.7\n+ node-pty@1.1.0\n' +
        '+ strip-ansi@7.2.0\n+ svelte@5.55.1\n+ tailwindcss@4.2.2\n+ typescript@6.0.2\n' +
        '+ vite@8.0.3\n+ ws@8.20.0\n\n263 packages installed [820.00ms]\n',
      output_truncated: false,
    },
  },
  {
    id: 'evt_005',
    session_id: 'ses_demo',
    ts: 1746189020000,
    source: 'terminal',
    trust: 'raw',
    kind: 'command_block',
    raw_ref: 'transcript_001:15400-15800',
    payload: {
      command: 'vim README.md',
      cwd: '/Users/jamesking/CascadeProjects/a-nice-terminal',
      exit_code: null,
      started_at: '2026-05-02T18:30:20.000Z',
      duration_ms: null,
      output:
        '[?1049h[22;0;0t[?1h=[H[2J' +
        '# ANT — A Nice Terminal\n\nMultiplayer terminal for humans + agents.',
      output_truncated: true,
    },
  },
  {
    id: 'evt_006',
    session_id: 'ses_demo',
    ts: 1746189030000,
    source: 'rpc',
    trust: 'high',
    kind: 'agent_prompt',
    raw_ref: 'transcript_001:15800-15900',
    payload: {
      agent: '@claude',
      prompt: 'Run the failing test in tests/db.test.ts and report the diff between expected and actual?',
      options: ['Yes', 'Skip', 'Defer'],
      prompt_id: 'prompt_a1b2',
    },
  },
  {
    id: 'evt_007',
    session_id: 'ses_demo',
    ts: 1746189035000,
    source: 'rpc',
    trust: 'high',
    kind: 'artifact',
    raw_ref: 'transcript_001:15900-16040',
    payload: {
      hash: 'sha256:9d4e1c3b2a7f8e0c5b6d4a8e1f2c3d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0d',
      mime: 'image/png',
      bytes: 18432,
      label: 'diff_screenshot.png',
      caption: 'Screenshot from headless Playwright run, captured by claude-code',
    },
  },
];
