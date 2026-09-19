import { defineConfig, devices } from '@playwright/test';

/**
 * Klicktests gegen die laufende App (Web 5273 → API 3101 → lokale Supabase 55422).
 * Voraussetzung: `pnpm db:start`. Die Server startet Playwright selbst, falls sie nicht laufen.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5273', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome' } },
  ],
  webServer: [
    { command: 'pnpm --filter @gg/api start', url: 'http://localhost:3101/api/health', reuseExistingServer: true },
    { command: 'pnpm --filter @gg/web dev', url: 'http://localhost:5273', reuseExistingServer: true },
  ],
});
