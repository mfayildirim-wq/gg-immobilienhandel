import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfAusSeiten, testExpose } from '@gg/integrations/test-pdf';
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

/**
 * Test-Exposé für die Erfassung v2 (Attrappe-Zweig erfasse_expose): Kernwerte mit Standard-Pfad (automatisch zugeordnet),
 * „Erhaltungsreserve“ ohne Wörterbucheintrag mit KI-Vorschlag, „Verbrauchswert Gebäude“, „Dachzustand“ und „Besichtigung“ ohne Zuordnung und ohne
 * Vorschlag, zweiter Kontakt auf Seite 2.
 */
function testExposeV2(kennung: string): Uint8Array {
  return pdfAusSeiten([
    [
      `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
      `Adresse: ${kennung}strasse 12, 89073 Ulm`,
      'Kaufpreis: 1.250.000 EUR',
      'Wohnflaeche: 240 m2',
      'Grundstück: 480 m2',
      'Baujahr: 1965',
      'Hausgeld: 350 EUR',
      'Erhaltungsreserve: 12.000 EUR',
      `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
    ],
    [
      'Mietaufstellung',
      'Einheit: Wohnung | EG links | 3 | 80 | 800',
      'Einheit: Wohnung | OG rechts | 3 | 80 | 820',
      'Einheit: Wohnung | DG | 2 | 80 | 700',
      'Verbrauchswert Gebäude: 128,5 kWh/m2a',
      'Dachzustand: gepflegt',
      'Besichtigung: nach Vereinbarung',
      'Kontakt: Max Zweit | Geschäftsführer | 0711 123456 | max@beispiel.test',
    ],
  ]);
}

test('Exposé v2: weitere Angaben per Dropdown auf der Prüfseite und im Reiter „Aus dem Exposé“', async ({ page }, info) => {
  // Was frühere Läufe ins Wörterbuch gelernt haben, würde die Zeilen hier automatisch zuordnen
  const gelernt = (await (await page.request.get('/api/expose/bezeichnungen')).json()) as { schluessel: string }[];
  for (const g of gelernt) await page.request.delete(`/api/expose/bezeichnungen/${encodeURIComponent(g.schluessel)}`);
  const kennung = `V${Date.now()}${info.project.name.slice(0, 1)}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  writeFileSync(datei, testExposeV2(kennung));

  await durchWizard(page, datei);
  await expect(page.locator('[data-erfassung]')).toHaveText(/\d+ Angaben erfasst · \d+ automatisch zugeordnet · \d+ weitere/);
  const weitere = page.getByLabel('Weitere Angaben', { exact: true });
  await expect(weitere.getByRole('heading', { name: /^Weitere Angaben aus dem Exposé \(\d+\)$/ })).toBeVisible();
  const zeile = (text: string) => weitere.locator('tr[data-feld]').filter({ hasText: text });
  await expect(zeile('Besichtigung')).toContainText('nach Vereinbarung');
  await expect(zeile('Besichtigung').getByRole('combobox', { name: 'Übernehmen in …' })).toHaveValue('');

  // Vorschlag der KI ist vorausgewählt; ein Feld ohne Formularfeld wird beim Anlegen gespeichert (rückgängig möglich)
  const ruecklage = zeile('Erhaltungsreserve');
  await expect(ruecklage.getByRole('combobox', { name: 'Übernehmen in …' })).toHaveValue(/^Instandhaltungsrücklage/);
  await ruecklage.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(ruecklage).toHaveAttribute('data-zustand', 'gemerkt');
  await expect(ruecklage).toContainText('wird beim Anlegen gespeichert');
  await ruecklage.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(ruecklage).toHaveAttribute('data-zustand', 'offen');
  await ruecklage.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(ruecklage).toHaveAttribute('data-zustand', 'gemerkt');

  // Übernahme in ein leeres Formularfeld: der Wert steht sofort im Formular (deutsche Zahl gelesen)
  const verbrauch = zeile('Verbrauchswert Gebäude');
  await verbrauch.getByRole('combobox', { name: 'Übernehmen in …' }).click();
  await page.getByRole('option', { name: /^Energiekennwert/ }).click();
  await verbrauch.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(verbrauch).toHaveAttribute('data-zustand', 'uebernommen');
  await expect(page.getByRole('textbox', { name: /Energiekennwert/ })).toHaveValue('128,5');

  // Alle erfassten Angaben: eingeklappt, nur lesend
  await page.getByRole('button', { name: /^Alle erfassten Angaben \(\d+\)$/ }).click();
  const alle = page.getByLabel('Alle erfassten Angaben', { exact: true });
  await expect(alle.locator('tr[data-feld]').filter({ hasText: 'Kaufpreis' })).toContainText('→ Angebotspreis');
  await expect(alle.locator('tr[data-feld]').filter({ hasText: 'Besichtigung' })).toContainText('—');

  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });
  const dealId = new URL(page.url()).searchParams.get('deal')!;
  const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();

  // Objekt: zugeordnete und per Dropdown gewählte Werte stehen unter „Weitere Angaben“
  await page.goto(`/objekte?objekt=${deal.objekt.id}`);
  const s = page.getByRole('region', { name: 'Objekt-Detail' });
  const details = s.getByLabel('Weitere Angaben', { exact: true });
  await expect(details).toContainText('Hausgeld/Monat');
  await expect(details).toContainText('350 €');
  await expect(details).toContainText('Instandhaltungsrücklage');
  await expect(details).toContainText('12.000 €');
  await expect(details).toContainText('128,5 kWh/m²a');
  await expect(s.getByLabel('Gebäude')).toContainText('480 m²');

  // Reiter „Aus dem Exposé“: Status je Angabe
  await s.getByRole('tab', { name: /Aus dem Exposé/ }).click();
  const angaben = s.getByRole('region', { name: 'Exposé-Angaben' });
  const reiterZeile = (text: string) => angaben.locator('tr[data-feld]').filter({ hasText: text });
  await expect(reiterZeile('Hausgeld')).toHaveAttribute('data-status', 'gleich');
  await expect(reiterZeile('Grundstück')).toHaveAttribute('data-status', 'gleich');
  await expect(reiterZeile('Erhaltungsreserve')).toHaveAttribute('data-status', 'gleich');

  // Übernahme per Dropdown: „Zustand“ in das gleichnamige Feld
  const zustand = reiterZeile('Dachzustand');
  await zustand.getByRole('combobox', { name: 'Übernehmen in …' }).click();
  await page.getByRole('option', { name: 'Zustand', exact: true }).click();
  const gespeichert = page.waitForResponse((r) => r.url().includes('/expose-uebernahme') && r.request().method() === 'POST');
  await zustand.getByRole('button', { name: 'Übernehmen' }).click();
  expect((await gespeichert).status()).toBe(200);
  await s.getByRole('tab', { name: '📋 Details' }).click();
  await expect(s.getByLabel('Weitere Angaben', { exact: true })).toContainText('gepflegt');

  // … und „Besichtigung“ in die Notizen
  await s.getByRole('tab', { name: /Aus dem Exposé/ }).click();
  const besichtigung = reiterZeile('Besichtigung');
  await besichtigung.getByRole('combobox', { name: 'Übernehmen in …' }).click();
  await page.getByRole('option', { name: 'In Notizen' }).click();
  await besichtigung.getByRole('button', { name: 'Übernehmen' }).click();
  await s.getByRole('tab', { name: '📋 Details' }).click();
  await expect(s.getByLabel('Notizen', { exact: true })).toContainText('Besichtigung');

  // Makler: der zweite Kontakt aus dem Exposé steht im Reiter
  await page.goto(`/makler?makler=${deal.makler.id}`);
  const m = page.getByRole('region', { name: 'Makler-Detail' });
  await m.getByRole('tab', { name: '📄 Aus dem Exposé' }).click();
  await expect(m.getByRole('region', { name: 'Exposé-Angaben' })).toContainText('max@beispiel.test');
});

// >>> Fotos aus dem Exposé (Protokoll 30 §4.4, §10): alle gefilterten Bilder gehen automatisch ans Objekt, keine Auswahl
test('Exposé mit 2 Bildern: Prüfseite zeigt „Fotos aus dem Exposé (2)“, nach dem Anlegen hat das Objekt 2 Fotos', async ({ page }, info) => {
  // Das Test-PDF mit Bildern baut `pdfMitBildern` (packages/integrations/src/test/pdf-basteln.ts); fehlt es noch, entfällt der Test.
  const basteln = (await import('@gg/integrations/test-pdf')) as Record<string, unknown>;
  test.skip(typeof basteln.pdfMitBildern !== 'function', 'pdfMitBildern ist noch nicht vorhanden');
  const kennung = `F${Date.now()}${info.project.name.slice(0, 1)}`;
  const datei = join(tmpdir(), `${kennung}.pdf`);
  const zeilen = [
    `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
    `Adresse: ${kennung}strasse 12, 89073 Ulm`, 'Kaufpreis: 1.250.000 EUR', 'Wohnflaeche: 240 m2', 'Baujahr: 1965',
    `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
  ];
  // zwei verschieden große Fotos auf Seite 1
  writeFileSync(datei, (basteln.pdfMitBildern as (seiten: { zeilen: string[]; bilder?: { breite: number; hoehe: number }[] }[]) => Uint8Array)(
    [{ zeilen, bilder: [{ breite: 800, hoehe: 600 }, { breite: 900, hoehe: 640 }] }]));

  await durchWizard(page, datei);
  const fotos = page.getByLabel('Fotos aus dem Exposé');
  await expect(fotos).toContainText('Fotos aus dem Exposé (2)');
  await expect(fotos.getByRole('img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Weiter: Makler →' }).click();
  await page.getByRole('button', { name: 'Weiter: Deal →' }).click();
  await page.getByRole('textbox', { name: 'Maklerprov. %' }).fill('0');
  await page.getByRole('button', { name: '✅ Deal anlegen' }).click();
  await expect(page).toHaveURL(/\/deals\?deal=/, { timeout: 15_000 });

  const dealId = new URL(page.url()).searchParams.get('deal')!;
  const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();
  const liste = await (await page.request.get(`/api/objekte/${deal.objekt.id}/fotos`)).json();
  expect(liste).toHaveLength(2);
  expect(liste.map((f: { dateiname: string }) => f.dateiname).every((n: string) => /^Exposé S\.\d+-\d+\.jpg$/.test(n))).toBe(true);
});
// <<< Fotos aus dem Exposé
