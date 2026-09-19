import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // keine .env: DB-Tests werden übersprungen
}

export default defineConfig({ test: { fileParallelism: false } });
