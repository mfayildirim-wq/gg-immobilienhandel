import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testExpose } from '@gg/integrations/test-pdf';
import { expect, type Page, test } from '@playwright/test';

/** Exposé-Import mit der KI-Attrappe (KI_ATTRAPPE=1): liest die „Feld: Wert“-Zeilen des Test-PDFs. */
async function durchWizard(page: Page, datei: string) {
  await page.goto('/expose-import');
  await expect(page.getByText('Test-Modus')).toBeVisible();
  await page.getByLabel('Exposé-PDF wählen').setInputFiles(datei);
  await page.getByRole('button', { name: 'Analysieren →' }).click();
  await expect(page.getByRole('heading', { name: '🏢 Objekt prüfen' })).toBeVisible({ timeout: 20_000 });
}

test('Exposé importieren: Objekt, Makler, Deal anlegen; zweiter Import erkennt die Dublette', async ({ page }, info) => {
  const kennung = `E${Date.now()}${info.project.name.slice(0, 1)}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  writeFileSync(datei, testExpose(kennung));

  await durchWizard(page, datei);
  await expect(page.getByRole('textbox', { name: /Straße/ })).toHaveValue(`${kennung}strasse`);
  await expect(page.getByLabel('Einheitenaufstellung').getByRole('textbox', { name: 'Lage' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await expect(page.getByRole('textbox', { name: /^Name/ })).toHaveValue(`Anna ${kennung}`);
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('textbox', { name: 'Maklerprov. %' }).fill('0');
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();

  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: `${kennung}strasse 12` })).toBeVisible();
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await expect(page.getByLabel('Einheiten').getByRole('textbox', { name: 'Fläche' }).first()).toHaveValue('80'); // Korrektur: Fläche kommt in der Kalkulation an
  await expect(page.getByRole('textbox', { name: 'Maklerprovision' })).toHaveValue('0'); // eine 0 bleibt 0

  // Zweiter Import desselben Exposés
  await durchWizard(page, datei);
  await expect(page.getByText('Objekt existiert bereits')).toBeVisible();
  await page.getByRole('button', { name: 'Bestehendes Objekt verwenden' }).click();
  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await expect(page.getByText(/Makler ausgewählt: Anna/)).toBeVisible();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page.getByText('Deal bereits vorhanden')).toBeVisible();
  await page.getByRole('button', { name: 'Exposé überspringen' }).click();
  await expect(page.getByRole('heading', { name: `${kennung}strasse 12` })).toBeVisible();
});
