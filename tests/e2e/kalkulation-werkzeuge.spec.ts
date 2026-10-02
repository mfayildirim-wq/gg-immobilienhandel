import { expect, test } from '@playwright/test';
import { pdfAusZeilen } from '@gg/integrations/test-pdf';

test('Kalkulation: Datei-Leiste, Alle setzen, Einheiten aus Mieterliste-PDF (KI-Attrappe), Varianten speichern/laden/löschen', async ({ page }) => {
  let antwort = '';
  const dialoge: string[] = [];
  page.on('dialog', (d) => { dialoge.push(d.message()); void (d.type() === 'prompt' ? d.accept(antwort) : d.accept()); });
  const kennung = `Kalkwerkzeug ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '5', stadt: 'Ulm', angebotspreis: 900_000 } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  const einheit = { typ: 'Wohnung', lage: 'EG', zimmer: 2, flaeche: 50, mieteIst: 500, mieteNeu: null, mieteNeuManuell: false, renditeK: 5, verkaufspreis: null, stueck: null };
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: dd.version, kalkulation: { kaufpreis: 900_000 }, einheiten: [einheit, { ...einheit, lage: '1. OG', mieteIst: 600 }], sanierungen: [] } });

  const ids = (await (await page.request.get(`/api/deals/${d.id}`)).json()).einheiten.map((e: { id: string }) => e.id);
  expect(ids).toHaveLength(2);
  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await expect(detail.getByLabel('Datei-Leiste').getByText('Keine Dateien')).toBeVisible();
  const liste = detail.getByLabel('Einheiten', { exact: true });

  // Alle setzen
  await liste.getByRole('button', { name: '+10%' }).click();
  await expect(detail.getByText('KM SOLL = KM IST × 1.10 gesetzt (2 Einheiten)')).toBeVisible();
  await expect(liste.getByLabel('Miete neu', { exact: true }).nth(1)).toHaveValue('660');
  await liste.getByRole('button', { name: '→ Rendite' }).click();
  await expect(detail.getByText('Bitte Rendite eingeben')).toBeVisible();
  await liste.getByLabel('KP/m² für alle').fill('3.000');
  await liste.getByRole('button', { name: '→ KP/m²' }).click();
  await expect(detail.getByText('KP/m² 3.000 € auf alle Einheiten gesetzt')).toBeVisible();
  await expect(liste.getByLabel('Verkaufspreis').first()).toHaveValue('150.000');
  await expect(liste.getByLabel('Rendite', { exact: true }).first()).toHaveValue('4,4');

  // Variante speichern (ungespeicherter Stand), dann Einheiten per PDF ersetzen, Variante wieder laden
  antwort = 'Erstangebot';
  await detail.getByRole('button', { name: '💾 Speichern als…' }).click();
  await expect(detail.getByText('📸 Variante "Erstangebot" gespeichert (1 insgesamt)')).toBeVisible();
  await expect(detail.getByText('1 gespeichert')).toBeVisible();

  await liste.getByTestId('einheiten-pdf').setInputFiles({ name: 'Mieterliste.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfAusZeilen([
    'Mieterliste', 'Einheit: Wohnung | EG li. | 3 | 78,5 | 780', 'Einheit: Gewerbe | Laden | | 120 | 1500', 'Einheit: Stellplatz | TG | | | 50',
  ])) });
  await expect(detail.getByText('✅ 3 Einheit(en) aus PDF übernommen')).toBeVisible();
  expect(dialoge.at(-1)).toContain('⚠️ Die aktuelle Liste mit 2 Einheit(en) wird KOMPLETT ERSETZT. Fortfahren?');
  await expect(liste.getByLabel('Lage')).toHaveCount(3);
  await expect(liste.getByLabel('Lage').first()).toHaveValue('EG li.');
  await expect(detail.getByLabel('Datei-Leiste').getByRole('link', { name: '📄 Mieterliste (für Einhe…' })).toBeVisible();

  await detail.getByLabel('Variante laden').selectOption({ label: `Erstangebot (${new Date().toLocaleDateString('de-DE')})` });
  await expect(detail.getByText('✅ Variante "Erstangebot" geladen')).toBeVisible();
  expect(dialoge.at(-1)).toBe('Aktuelle Kalkulation wird durch Variante "Erstangebot" überschrieben.\n\nTipp: Speichere die aktuelle vorher als Variante!\n\nWirklich überschreiben?');
  await expect(liste.getByLabel('Lage')).toHaveCount(2);
  await expect(liste.getByLabel('Verkaufspreis').first()).toHaveValue('150.000');
  await detail.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(detail.getByText('ungespeichert')).toHaveCount(0);
  const gespeichert = await (await page.request.get(`/api/deals/${d.id}`)).json();
  // Einheiten behalten über die Variante ihre IDs (Verweise aus Kundenkalkulation/Vertriebsliste)
  expect(gespeichert.einheiten.map((e: { id: string }) => e.id)).toEqual(ids);
  expect(gespeichert.einheiten[1]).toMatchObject({ mieteNeu: 660, mieteNeuManuell: true, verkaufspreis: 150_000, renditeK: 5.3 });

  await detail.getByRole('button', { name: 'Variante Erstangebot löschen' }).click();
  await expect(detail.getByText('🗑 Variante "Erstangebot" gelöscht')).toBeVisible();
  await expect(detail.getByText('Noch keine Variante gespeichert')).toBeVisible();
});
