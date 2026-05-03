import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests require a live server (ANT_TEST_URL); excluded from
    // default run so a clean dev/CI invocation reports 0 skipped. Run with
    // `bun run test:integration` (which sets ANT_TEST_URL) when needed.
    exclude: ['tests/integration/**', 'node_modules/**', '.svelte-kit/**'],
    globals: true,
  },
  resolve: {
    alias: {
      '$lib': '/src/lib',
      '$app/environment': '/tests/mocks/app-environment.ts',
    },
  },
});
