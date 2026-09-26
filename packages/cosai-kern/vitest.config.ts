import { defineConfig } from 'vitest/config';

// Lokale Werte (DATABASE_URL) aus der .env im Repo-Wurzelverzeichnis, falls vorhanden.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // keine .env: DB-Tests werden übersprungen
}

export default defineConfig({ test: { fileParallelism: false } });
