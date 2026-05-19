import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveAppPort, resolveApiPortForDev } from './server/config/ports.js';

// APP_PORT = the port users visit (default 3100)
// Backend API runs on APP_PORT + 1 in dev (Vite proxies to it)
const appPort = resolveAppPort();
const apiPort = resolveApiPortForDev();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark-gfm')) {
            return 'markdown-vendor';
          }

          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) {
            return 'react-vendor';
          }

          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: appPort,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      '/mcp': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
