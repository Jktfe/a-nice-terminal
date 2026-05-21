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
    hookTimeout: 30_000
  }
});
