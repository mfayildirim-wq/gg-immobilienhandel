import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testExpose, testExposeV1 } from '@gg/integrations/test-pdf';
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

test('Exposé v1: weitere Angaben auf der Prüfseite, Reiter „Aus dem Exposé“ am Objekt (Übernehmen) und am Makler', async ({ page }, info) => {
  const kennung = `V${Date.now()}${info.project.name.slice(0, 1)}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  writeFileSync(datei, testExposeV1(kennung));

  await durchWizard(page, datei);
  // Angaben ohne Feld im Wizard: eingeklappt, nur zur Ansicht
  const weitere = page.getByRole('button', { name: 'Weitere Angaben aus dem Exposé (2)' });
  await expect(weitere).toBeVisible();
  await weitere.click();
  await expect(page.getByLabel('Weitere Angaben', { exact: true })).toContainText('Dach');
  await expect(page.getByLabel('Weitere Angaben', { exact: true })).toContainText('Besichtigung');
  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });
  const dealId = new URL(page.url()).searchParams.get('deal')!;
  const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();

  // Objekt: Zusatzangaben und Grundstück stehen schon beim Anlegen im Objekt (Status „gleich“)
  await page.goto(`/objekte?objekt=${deal.objekt.id}`);
  const s = page.getByRole('region', { name: 'Objekt-Detail' });
  await expect(s.getByLabel('Weitere Angaben', { exact: true })).toContainText('Hausgeld/Monat');
  await expect(s.getByLabel('Weitere Angaben', { exact: true })).toContainText('350 €');
  await expect(s.getByLabel('Gebäude')).toContainText('480 m²');
  await s.getByRole('tab', { name: /Aus dem Exposé/ }).click();
  const angaben = s.getByRole('region', { name: 'Exposé-Angaben' });
  const hausgeld = angaben.locator('[data-feld="preise.hausgeld_monat"]');
  await expect(hausgeld).toContainText('350');
  await expect(hausgeld).toHaveAttribute('data-status', 'gleich');
  await expect(angaben.locator('[data-feld="flaechen.grundstuecksflaeche"]')).toHaveAttribute('data-status', 'gleich');
  await expect(angaben.locator('[data-feld="zustand.denkmalschutz"]')).toContainText('Ja');

  // Angabe ohne Feld: per Klick in die Notizen übernehmen
  const dach = angaben.locator('[data-feld="weitere_angaben.0"]');
  await expect(dach).toHaveAttribute('data-status', 'keinFeld');
  await dach.getByRole('button', { name: 'In Notizen' }).click();
  await s.getByRole('tab', { name: '📋 Details' }).click();
  await expect(s.getByLabel('Notizen', { exact: true })).toContainText('Dach');

  // Makler: der zweite Kontakt aus dem Exposé steht im Reiter
  await page.goto(`/makler?makler=${deal.makler.id}`);
  const m = page.getByRole('region', { name: 'Makler-Detail' });
  await m.getByRole('tab', { name: '📄 Aus dem Exposé' }).click();
  await expect(m.getByRole('region', { name: 'Exposé-Angaben' })).toContainText('Max Zweit');
});
