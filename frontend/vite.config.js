import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'fs';
import { join } from 'path';

/** Render/static hosts: unknown paths serve 404.html (copy of index.html) */
function spaFallback404() {
  return {
    name: 'spa-fallback-404',
    closeBundle() {
      const dist = join(__dirname, 'dist');
      copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), spaFallback404()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
});
