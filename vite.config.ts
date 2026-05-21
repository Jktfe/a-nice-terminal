import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.kingfisher-interval.ts.net'
    ]
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // 30s default — the 5s vitest default was timing out on spawn-heavy
    // CLI/preflight tests under parallel worker load. The work is fast
    // in isolation; the timeout was overrun, not the test logic.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    // pool=forks (over default 'threads') with maxForks=4 — under heavy
    // parallel load the worker→main IPC channel was hitting its ~5s
    // timeout for onTaskUpdate, surfacing as "Timeout calling
    // onTaskUpdate" unhandled errors even though every test passed.
    // Forked processes have their own event loop AND capping concurrency
    // at 4 keeps the main thread from drowning in IPC traffic from too
    // many parallel reporters. Slightly slower walltime; no false flake.
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 4 }
    }
  }
});
