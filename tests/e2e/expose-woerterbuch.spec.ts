import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfAusSeiten } from '@gg/integrations/test-pdf';
import { expect, test } from '@playwright/test';

/** Exposé-Wörterbuch (Protokoll 30 §10): „für künftige Importe merken“ ist voreingestellt, die Einstellungen zeigen das Gelernte. */
test('Zuordnung auf der Prüfseite wird gemerkt und steht in den Einstellungen; Löschen entfernt sie', async ({ page }, info) => {
  const stempel = `${Date.now()}${info.project.name.slice(0, 1)}`;
  const kennung = `W${stempel}`;
  // Bezeichnung nur aus Buchstaben, damit jeder Lauf eine neue (unbekannte) hat
  const bezeichnung = `Merkmal${[...stempel.replace(/\D/g, '')].map((z) => 'abcdefghij'[Number(z)]).join('')}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  writeFileSync(datei, pdfAusSeiten([[
    `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
    `Adresse: ${kennung}strasse 12, 89073 Ulm`,
    'Kaufpreis: 1.250.000 EUR',
    'Wohnflaeche: 240 m2',
    'Baujahr: 1965',
    `${bezeichnung}: gepflegt`,
    `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
  ]]));

  await page.goto('/expose-import');
  await expect(page.getByText('Test-Modus')).toBeVisible();
  await page.getByLabel('Exposé-PDF wählen').setInputFiles(datei);
  await page.getByRole('button', { name: 'Analysieren →' }).click();
  await expect(page.getByRole('heading', { name: '🏢 Objekt prüfen' })).toBeVisible({ timeout: 20_000 });

  const zeile = page.getByLabel('Weitere Angaben', { exact: true }).locator('tr[data-feld]').filter({ hasText: bezeichnung });
  await expect(zeile).toContainText('gepflegt');
  const haken = zeile.getByLabel('für künftige Importe merken');
  await expect(haken).toBeVisible();
  await expect(haken).toBeChecked(); // voreingestellt an

  await zeile.getByRole('combobox', { name: 'Übernehmen in …' }).click();
  await page.getByRole('option', { name: 'Zustand', exact: true }).click();
  await zeile.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(zeile).toHaveAttribute('data-zustand', 'gemerkt');

  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('textbox', { name: 'Maklerprov. %' }).fill('0');
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });

  await page.goto('/einstellungen/expose-woerterbuch');
  await expect(page.getByRole('heading', { name: 'Exposé-Wörterbuch (gelernt)' })).toBeVisible();
  const eintrag = page.locator('tr[data-bezeichnung]').filter({ hasText: bezeichnung });
  await expect(eintrag).toContainText('Zustand');
  await expect(eintrag.locator('td').nth(2)).toHaveText('1');

  await eintrag.getByRole('button', { name: 'Löschen' }).click();
  await expect(eintrag).toHaveCount(0);
});

test('Reiter „Aus dem Exposé“: das Häkchen „für künftige Importe merken“ ist sichtbar und voreingestellt', async ({ page }, info) => {
  const kennung = `X${Date.now()}${info.project.name.slice(0, 1)}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  writeFileSync(datei, pdfAusSeiten([[
    `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
    `Adresse: ${kennung}strasse 12, 89073 Ulm`, 'Kaufpreis: 1.250.000 EUR', 'Wohnflaeche: 240 m2', 'Baujahr: 1965',
    'Besichtigung: nach Vereinbarung',
    `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
  ]]));
  await page.goto('/expose-import');
  await page.getByLabel('Exposé-PDF wählen').setInputFiles(datei);
  await page.getByRole('button', { name: 'Analysieren →' }).click();
  await expect(page.getByRole('heading', { name: '🏢 Objekt prüfen' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('textbox', { name: 'Maklerprov. %' }).fill('0');
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });
  const dealId = new URL(page.url()).searchParams.get('deal')!;
  const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();

  await page.goto(`/objekte?objekt=${deal.objekt.id}`);
  const s = page.getByRole('region', { name: 'Objekt-Detail' });
  await s.getByRole('tab', { name: /Aus dem Exposé/ }).click();
  const zeile = s.getByRole('region', { name: 'Exposé-Angaben' }).locator('tr[data-feld]').filter({ hasText: 'Besichtigung' });
  const haken = zeile.getByLabel('für künftige Importe merken');
  await expect(haken).toBeVisible();
  await expect(haken).toBeChecked();
});
