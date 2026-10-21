import { expect, test } from '@playwright/test';

// Makler-Recherche (21.10.2026). Im Test-Modus (KI_ATTRAPPE=1) antwortet ein Ersatz-Internet: beispiel-immobilien.example.test
// mit Impressum und Team-Seite (Anna Beispiel, Geschäftsführerin, Mobil 0171 5550001) — kein Abruf verlässt den Rechner.
test('Makler-Recherche: auswählen, starten, Glocke, Ergebnis mit Quelle, übernehmen; im Profil gelb am Feld, Aktualisieren und Speichern', async ({ page }) => {
  // Zwei Läufe mit Warten auf Etappen und Glocke: mehr als die üblichen 30 s
  test.setTimeout(120_000);
  const k = Date.now();
  const neu = async (daten: Record<string, unknown>) => {
    const m = await (await page.request.post('/api/makler', { data: { name: 'Platzhalter' } })).json();
    await page.request.patch(`/api/makler/${m.id}`, { data: { version: m.version, ...daten } });
    return m.id as string;
  };
  const a = await neu({ vorname: 'Anna', nachname: 'Beispiel', email: `anna.${k}@beispiel-immobilien.example.test` });
  const b = await neu({ vorname: 'Anna', nachname: 'Beispiel', email: `anna2.${k}@beispiel-immobilien.example.test` });
  // Reste früherer Läufe: es läuft immer nur einer
  const alt = await (await page.request.get('/api/makler-recherche/laeufe/aktuell')).json();
  if (alt?.status === 'laeuft') await page.request.post(`/api/makler-recherche/laeufe/${alt.id}/abbrechen`);

  await page.goto('/einstellungen/makler-recherche');
  const zeileA = page.locator(`[data-recherche-zeile="${a}"]`);
  await expect(zeileA.locator('[data-recherche-link="webseite"]')).toHaveText('beispiel-immobilien.example.test ↗');
  await expect(zeileA).toContainText('aus E-Mail');
  await zeileA.getByRole('checkbox').check();
  await page.locator(`[data-recherche-zeile="${b}"]`).getByRole('checkbox').check();

  // Start-Dialog: Zahl der Makler, KI-Haken, Kostenschätzung
  await page.locator('[data-recherche-start]').click();
  const dialog = page.getByRole('dialog', { name: 'Recherche starten' });
  await expect(dialog).toContainText('2 Makler ausgewählt — 2 mit Webseite');
  await expect(dialog.locator('[data-recherche-kosten="ok"]')).toContainText('ca. 0,01 €');
  await dialog.getByRole('checkbox', { name: /Mit KI-Websuche/ }).check();
  await expect(dialog.locator('[data-recherche-kosten="ok"]')).not.toContainText('…');
  await expect(dialog.locator('[data-recherche-los]')).toBeEnabled();
  await dialog.locator('[data-recherche-los]').click();
  await expect(dialog).toBeHidden();

  // Die geöffnete Seite treibt den Lauf; fertig → Ergebnis in der Tabelle
  await expect(page.locator('[data-recherche-lauf="fertig"]')).toContainText('2 von 2 · 2 gefunden', { timeout: 30_000 });
  await expect(zeileA).toContainText('gefunden');
  await expect(zeileA).toContainText('✓ /team');
  await expect(zeileA.locator('[data-recherche-vorschlaege]')).toBeVisible();

  // Aufklappen (Klick auf den Namen): was gemacht wurde, Vorschlag mit Quelle übernehmen
  await zeileA.getByText('Anna Beispiel').click();
  const detail = page.locator(`[data-recherche-detail="${a}"]`);
  await expect(detail).toContainText('Webseite beispiel-immobilien.example.test (aus E-Mail) gelesen: /, /impressum, /team');
  const position = detail.locator('[data-recherche-vorschlag="position"]');
  await expect(position).toContainText('Geschäftsführerin');
  await expect(position).toContainText('beispiel-immobilien.example.test/team');
  await position.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(position).toContainText('übernommen');
  await expect.poll(async () => (await (await page.request.get(`/api/makler/${a}`)).json()).position).toBe('Geschäftsführerin');

  // Lauf, während eine andere Seite offen ist: die App treibt ihn weiter, fertig → Glocke; die Recherche-Seite schaltet sie aus
  await page.goto('/makler');
  await page.request.post('/api/makler-recherche/laeufe', { data: { maklerIds: [a], mitKi: false } });
  // Über die API gestartet: neu laden, damit die App den Lauf gleich sieht (sonst erst bei der nächsten Minuten-Abfrage)
  await page.reload();
  await expect.poll(async () => (await (await page.request.get('/api/makler-recherche/laeufe/aktuell')).json()), { timeout: 70_000 }).toMatchObject({ status: 'fertig', ungesehen: true });
  if (test.info().project.name === 'desktop') await expect(page.locator('[data-recherche-glocke]')).toBeVisible({ timeout: 70_000 });
  await page.goto('/einstellungen/makler-recherche');
  await expect.poll(async () => (await (await page.request.get('/api/makler-recherche/laeufe/aktuell')).json()).ungesehen).toBe(false);
  await expect(page.locator('[data-recherche-glocke]')).toHaveCount(0);

  // Makler B im Profil: gelb am Feld, „Aktualisieren“ setzt alles ins Formular, „Speichern“ hält es fest
  await page.goto(`/makler?makler=${b}`);
  const s = page.getByRole('region', { name: 'Makler-Detail' });
  await expect(s.locator('[data-recherche-hinweis]')).toBeVisible();
  await expect(s.locator('[data-recherche-vorschlag-feld="mobil"]')).toContainText('0171 5550001');
  await s.locator('[data-recherche-aktualisieren]').click();
  await expect(s.getByLabel('Mobil')).toHaveValue('0171 5550001');
  await expect(s.getByLabel('Position')).toHaveValue('Geschäftsführerin');
  await s.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/makler/${b}`)).json())).toMatchObject({ mobil: '0171 5550001', position: 'Geschäftsführerin', firma: 'Musterhaus Immobilien GmbH' });
  await expect.poll(async () => (await (await page.request.get(`/api/makler-recherche/makler/${b}`)).json()).ergebnisse[0].vorschlaege
    .filter((v: { entscheidung: string | null; feld: string }) => ['mobil', 'position'].includes(v.feld)).every((v: { entscheidung: string | null }) => v.entscheidung === 'uebernommen')).toBe(true);
});
