import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: './index.html',
    },
    // Ensure assets are properly referenced for Cloudflare Pages
    assetsDir: 'assets',
  },
  server: {
    port: 3000,
  },
  // Base path for production (Cloudflare Pages)
  base: '/',
});

