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
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs']
  }
});
