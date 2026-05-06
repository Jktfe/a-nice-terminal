import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    allowedHosts: true,
    fs: {
      allow: ['docs', 'scripts'],
    },
  },
  ssr: {
    external: ['better-sqlite3', 'node-pty'],
    noExternal: [],
  },
});
