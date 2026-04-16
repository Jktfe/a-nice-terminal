import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '$lib': '/src/lib',
      '$app/environment': '/tests/mocks/app-environment.ts',
    },
  },
});
