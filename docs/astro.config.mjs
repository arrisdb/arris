// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    esbuild: {
      // Strip console.* and debugger statements from production bundles.
      drop: ['console', 'debugger'],
    },
  },
});
