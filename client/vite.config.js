import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev-only: forward API calls to the Express server (no hardcoded prod URL).
      // API_PROXY_TARGET lets a developer point the dev proxy at a different
      // local backend (e.g. an isolated test instance on another port) without
      // editing this file. Defaults to the standard local backend port.
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.jsx'],
  },
});
