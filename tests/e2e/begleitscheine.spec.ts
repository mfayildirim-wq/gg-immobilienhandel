import { expect, test } from '@playwright/test';

test('Begleitschein: anlegen, Status und Zähler, Unterpunkt, Aktionen (Daten, Vordruck), Archiv', async ({ page }) => {
  test.setTimeout(90_000);
  const kennung = `BS-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '57', plz: '71032', stadt: 'Böblingen' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: { kaufpreis: 900000, notar: 2 }, sanierungen: [], einheiten: [] } })).ok()).toBe(true);
  const vordruckeVorher = await (await page.request.get('/api/einstellungen/vordrucke')).json();
  const aktionenVorher = await (await page.request.get('/api/einstellungen/begleitscheine/ankauf/aktionen')).json();

  try {
    // Vordruck in den Einstellungen anlegen und der Aktion „Anschreiben Grundbuchamt“ zuordnen
    await page.goto('/einstellungen/begleitscheine');
    const bereich = page.getByRole('region', { name: 'Begleitscheine Einstellungen' });
    await bereich.getByRole('tab', { name: 'Vordrucke' }).click();
    await bereich.getByRole('button', { name: 'Vordruck', exact: true }).click();
    const vd = bereich.getByLabel(/^Vordruck .*Neuer Vordruck$/).last();
    await vd.getByRole('textbox', { name: 'Nummer' }).fill('F028');
    await vd.getByRole('textbox', { name: 'Text' }).fill('Grundbuchauszug für {adresse} erbeten.');
    await vd.getByRole('textbox', { name: 'Nummer' }).focus(); // Text verlassen → speichert
    await expect(bereich.getByLabel(/^Vordruck F028/).getByText('Verwendet an 0 Stelle(n).')).toBeVisible();
    await bereich.getByRole('tab', { name: 'Aktionen' }).click();
    await bereich.getByRole('textbox', { name: 'Punkte durchsuchen' }).fill('Bewilligungsurkunden');
    const aktion = bereich.getByLabel('Aktion Anschreiben Grundbuchamt', { exact: true });
    await aktion.getByRole('combobox', { name: '– noch kein Vordruck hinterlegt –' }).click();
    await page.getByRole('option', { name: /F028/ }).click();
    await expect.poll(async () => (await (await page.request.get('/api/einstellungen/vordrucke')).json()).find((v: { nummer: string }) => v.nummer === 'F028')?.verwendung).toBe(1);

    // Anlegen über den Dialog
    await page.getByRole('link', { name: 'Begleitscheine', exact: true }).first().click();
    await page.getByRole('button', { name: 'Begleitschein anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Begleitschein anlegen' });
    await dialog.getByRole('combobox', { name: 'Objekt' }).fill(kennung);
    await page.getByRole('option', { name: new RegExp(kennung) }).click();
    await dialog.getByRole('textbox', { name: 'Individueller Name' }).fill('IVT Wohnen');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page).toHaveURL(/\/begleitscheine\//);
    await expect(page.getByRole('heading', { name: `${kennung}_57_Böblingen_Ankauf_IVT Wohnen` })).toBeVisible();

    const tabelle = page.getByRole('table', { name: 'Punkte des Begleitscheins' });
    const summe = await page.getByLabel(/^Summe: \d+$/).textContent();
    const erste = tabelle.locator('tr[data-zeile]').first();
    await erste.getByRole('combobox', { name: 'Status' }).selectOption('erledigt');
    await expect(page.getByLabel('Erledigt: 1')).toBeVisible();

    const r53 = tabelle.locator('tr[data-zeile="r53"]');
    await r53.getByRole('button', { name: 'Unterpunkt' }).click();
    await r53.getByRole('textbox', { name: 'Unterpunkt' }).fill('Angebot Dachdecker');
    await r53.getByRole('combobox', { name: 'Status Unterpunkt' }).selectOption('In Progress');
    await expect(page.getByLabel(/^Summe: \d+$/)).toHaveText(summe!); // Unterpunkte zählen nicht (B17)

    await r53.getByRole('button', { name: 'Budget anzeigen' }).click();
    const anzeige = page.getByRole('dialog', { name: 'Budget anzeigen' });
    await expect(anzeige.getByRole('cell', { name: '900.000 €' }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await tabelle.locator('tr[data-zeile="r28"]').getByRole('button', { name: 'Anschreiben Grundbuchamt' }).click();
    await expect(page.getByRole('dialog', { name: /F028/ }).getByText(`Grundbuchauszug für ${kennung} 57, 71032 Böblingen erbeten.`)).toBeVisible();
    await page.keyboard.press('Escape');

    // Abschlusspunkt erledigt → archiviert; nach dem Neuladen ist alles gespeichert
    await tabelle.locator('tr[data-zeile="bs-final"]').getByRole('combobox', { name: 'Status Abschluss' }).selectOption('erledigt');
    await expect(page.getByText('archiviert', { exact: true })).toBeVisible();
    await page.reload();
    await expect(tabelle.locator('tr[data-zeile="r53"]').getByRole('textbox', { name: 'Unterpunkt' })).toHaveValue('Angebot Dachdecker');
    await expect(page.getByLabel('Erledigt: 2')).toBeVisible();

    await page.getByRole('button', { name: 'Zur Übersicht' }).click();
    await page.getByRole('button', { name: /Archiv \(\d+\)/ }).click();
    await expect(page.getByRole('button', { name: `${kennung}_57_Böblingen_Ankauf_IVT Wohnen` })).toBeVisible();
  } finally {
    await page.request.put('/api/einstellungen/begleitscheine/ankauf/aktionen', { data: aktionenVorher });
    await page.request.put('/api/einstellungen/vordrucke', { data: vordruckeVorher.map(({ verwendung: _v, ...v }: { verwendung: number }) => v) });
  }
});
