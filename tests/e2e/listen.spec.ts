import { expect, test } from '@playwright/test';

test('Makler-Liste: Prio-Chip, Suche, aktuelle Auswahl als Filter speichern, anwenden, umbenennen, löschen', async ({ page }) => {
  let antwort = '';
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(antwort) : d.accept()));
  const kennung = `Listen${Date.now()}`;
  await page.request.post('/api/makler', { data: { name: `${kennung} Anton`, prio: 'A', tel: '+49 711 1' } });
  await page.request.post('/api/makler', { data: { name: `${kennung} Berta`, prio: 'B' } });

  // Die Maklerliste steht standardmäßig schmal links neben dem Detail; hier wird die Tabelle geprüft.
  await page.addInitScript(() => { try { localStorage.setItem('gg.makler.layout', 'untereinander'); } catch { /* ohne Speicher Standardansicht */ } });
  await page.goto('/makler');
  const tabelle = page.getByRole('table', { name: 'Maklerliste' });
  // Die Filter liegen jetzt in einem Menü neben den Ansichtsschaltern, nicht mehr in einer eigenen Leiste.
  const filterMenue = async () => { await page.getByRole('banner').getByRole('button', { name: 'Ansicht und Filter' }).click(); };
  const filterWaehlen = async (name: string) => { await filterMenue(); await page.locator(`[data-filter-option="${name}"]`).click(); };

  // Vorlagen der alten App werden beim ersten Anzeigen angelegt
  await filterMenue();
  await expect(page.locator('[data-filter-option="⭐ A-Makler mit Telefon"]')).toHaveCount(1);
  await page.getByRole('menuitem', { name: /Aktuelle als Filter speichern/ }).click();
  await expect(page.getByText('Keine Filter aktiv — wähle erst Status/Suche/Chip')).toBeVisible();

  await page.getByLabel('Suchen').fill(kennung);
  await expect(tabelle.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'A-Makler', exact: true }).click();
  await expect(tabelle.locator('tbody tr')).toHaveCount(1);
  await expect(tabelle.locator('tbody tr').first()).toContainText('A-Makler');

  antwort = `${kennung} nur A`;
  await filterMenue();
  await page.getByRole('menuitem', { name: /Aktuelle als Filter speichern/ }).click();
  await expect(page.getByText(`✅ Filter „${kennung} nur A" gespeichert`)).toBeVisible();
  await expect(page.locator('[data-aktiver-filter]')).toHaveText(`Filter: ${kennung} nur A`);
  await expect(page.locator('[data-aktiver-filter]')).toHaveAttribute('title', `prio = A · name enthält "${kennung}"`);

  // Chip und Suche zurück: der gespeicherte Filter wirkt allein weiter
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByLabel('Suchen').fill('');
  await expect(tabelle.locator('tbody tr')).toHaveCount(1);
  await filterWaehlen('— Kein Filter —');
  await expect(page.locator('[data-aktiver-filter]')).toHaveCount(0);

  // Filter bleibt beim Seitenwechsel aktiv (wie alt: pro Sitzung)
  await filterWaehlen(`${kennung} nur A`);
  await page.getByRole('link', { name: 'Objekte' }).click();
  await page.getByRole('link', { name: 'Makler' }).click();
  await expect(page.locator('[data-aktiver-filter]')).toHaveText(`Filter: ${kennung} nur A`);

  await filterMenue();
  await page.getByRole('menuitem', { name: '⚙️ Verwalten' }).click();
  const dialog = page.getByRole('dialog', { name: '🔖 Filter verwalten — Maklerdatenbank' });
  antwort = `${kennung} umbenannt`;
  await dialog.getByRole('button', { name: `${kennung} nur A umbenennen` }).click();
  await expect(dialog.locator(`[data-filter="${kennung} umbenannt"]`)).toBeVisible();
  await dialog.getByRole('button', { name: `${kennung} umbenannt löschen` }).click();
  await expect(dialog.locator(`[data-filter="${kennung} umbenannt"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Der gelöschte Filter war aktiv — ohne aktiven Filter steht links vom Knopf nichts mehr.
  await expect(page.locator('[data-aktiver-filter]')).toHaveCount(0);
});

test('Deal- und Objektliste: Zähler, Status-Chip, Suche, Tabellenansicht untereinander', async ({ page }) => {
  const strasse = `Listenstraße ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '4', stadt: 'Ulm', angebotspreis: 1_234_000 } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  await page.request.patch(`/api/deals/${d.id}/status`, { data: { status: 'Closing Path', version: dd.version } });

  // Die Objektliste steht standardmäßig schmal links neben dem Detail; hier wird die Tabelle geprüft.
  await page.addInitScript(() => { try { localStorage.setItem('gg.objekte.layout', 'untereinander'); } catch { /* ohne Speicher Standardansicht */ } });
  await page.goto('/objekte');
  await page.getByLabel('Suchen').fill(strasse);
  const objekte = page.getByRole('table', { name: 'Objektliste' });
  await expect(objekte.locator('tbody tr')).toHaveCount(1);
  await expect(objekte.locator('tbody tr')).toContainText('1.234.000 €');
  await page.getByRole('button', { name: 'Archiv', exact: true }).click();
  await expect(page.getByText('🏢 Keine Objekte')).toBeVisible();

  await page.goto('/deals');
  await page.getByRole('banner').getByRole('button', { name: 'Ansicht und Filter' }).click();
  await page.getByLabel('untereinander').click();
  await page.keyboard.press('Escape');
  const zaehler = page.locator('[data-zaehler="Closing Path"] [data-anzahl]');
  await expect(zaehler).not.toHaveText('0'); // erst wenn die Liste geladen ist — vorher steht überall 0
  const vorher = Number(await zaehler.textContent());
  expect(vorher).toBeGreaterThan(0);
  await page.locator('[data-zaehler="Closing Path"]').click();
  await expect(page.getByRole('button', { name: 'Closing Path', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Suchen').fill(strasse.toLowerCase());
  const deals = page.getByRole('table', { name: 'Dealliste' });
  await expect(deals.locator('tbody tr')).toHaveCount(1);
  await expect(deals.locator(`tr[data-deal="${d.id}"]`)).toContainText(`${strasse} 4`);
  await deals.locator(`tr[data-deal="${d.id}"]`).click();
  await expect(page.getByRole('region', { name: 'Deal-Detail' })).toContainText(strasse);
});
