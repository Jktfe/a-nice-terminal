import { defineConfig } from 'vitest/config';

// Separate config for integration tests that need a live ANT server.
// Run via `bun run test:integration` (which sets ANT_TEST_URL). The default
// `bun run test` uses vitest.config.ts and excludes this dir, so a clean
// dev/CI invocation reports 0 skipped tests.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '$lib': '/src/lib',
      '$app/environment': '/tests/mocks/app-environment.ts',
    },
  },
});
