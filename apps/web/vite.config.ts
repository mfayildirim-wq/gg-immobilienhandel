import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3101}` },
  },
  test: { environment: 'jsdom' },
});
