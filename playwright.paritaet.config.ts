import { defineConfig, devices } from '@playwright/test';

/**
 * Parallelprüfung alt ↔ neu (tests/paritaet). Beide Apps müssen laufen; der Aufbau schreibt einen Prüfbestand in die
 * alte App, zieht ihn per Umzug in den Neubau und stellt danach den alten Stand wieder her.
 */
export default defineConfig({
  testDir: 'tests/paritaet',
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['./tests/paritaet/bericht.ts']],
  globalSetup: './tests/paritaet/umgebung.ts',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});
