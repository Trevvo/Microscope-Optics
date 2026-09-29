import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/. The deploy workflow sets
// BASE_PATH from the repository name; locally the app is served from /.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
