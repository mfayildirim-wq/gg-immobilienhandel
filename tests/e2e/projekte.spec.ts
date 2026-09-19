import { expect, test } from '@playwright/test';

test('Projekt: aus angekauftem Deal anlegen, Checkliste filtern und abhaken, Einheit verkaufen, Mietergespräch, Papierkorb', async ({ page }) => {
  let promptAntwort = '🧪 E2E-Kategorie';
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(promptAntwort) : d.accept()));
  const strasse = `PM-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '3', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null, renditeK: null };
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: { kaufpreis: 1000000 }, sanierungen: [], einheiten: [
    { ...leer, typ: 'Wohnung', lage: 'EG links', flaeche: 60, zimmer: 2, mieteIst: 600, renditeK: 4.5 },
    { ...leer, typ: 'Stellplatz', lage: 'TG-01', flaeche: null, mieteIst: 45, stueck: 2 },
  ] } })).ok()).toBe(true);
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  expect((await page.request.patch(`/api/deals/${d.id}/status`, { data: { status: 'Angekauft', version: dd.version } })).ok()).toBe(true);

  await page.goto('/projekte');
  await page.getByRole('button', { name: /^(Projekt|Neues Projekt anlegen)$/ }).click();
  const dialog = page.getByRole('dialog', { name: '🏗️ Neues Projekt anlegen' });
  await dialog.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(dialog).toContainText('Bitte Adresse eingeben');
  await dialog.getByRole('combobox', { name: 'Aus Deal übernehmen (optional)' }).click();
  await page.getByRole('option', { name: new RegExp(strasse) }).click();
  await expect(dialog.getByRole('textbox', { name: 'Adresse' })).toHaveValue(strasse); // wie alt: Straße ohne Hausnummer
  await expect(dialog).toContainText('Einheiten und Kalkulation werden aus dem Deal übernommen');
  await dialog.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(dialog).toBeHidden();

  const karte = page.getByRole('button', { name: `Projekt ${strasse}` });
  await expect(karte.locator('[data-feld="unterzeile"]')).toHaveText('Ulm · 1 Einheiten');
  await expect(karte.locator('[data-kpi="checkliste"] [data-unter]')).toHaveText('0/136');
  await expect(karte).toContainText('PIP noch nicht bewertet');
  await karte.click();
  await expect(page.getByRole('heading', { name: `${strasse}, Ulm` })).toBeVisible();

  // ① Checkliste: Filter „Offen“ ist aktiv, Status setzen, Filter „Erledigt“
  const liste = page.getByRole('table', { name: 'Checkliste' });
  await expect(page.getByRole('button', { name: 'Offen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-zaehler="offen"]')).toHaveText('● 136 Offen');
  await liste.locator('tr[data-todo]').first().getByLabel('Status').selectOption('erledigt');
  await expect(page.locator('[data-zaehler="erledigt"]')).toHaveText('● 1 Erledigt');
  await expect(page.locator('[data-zaehler="pct"]')).toHaveText('1%');
  await expect(liste.locator('tr[data-todo]')).toHaveCount(135); // abgehakter Punkt fällt aus „Offen“
  await page.getByRole('button', { name: 'Erledigt', exact: true }).click();
  await expect(liste.locator('tr[data-todo]')).toHaveCount(1);
  await expect(liste.locator('tr[data-kategorie]')).toHaveCount(1);
  await expect(liste.locator('tr[data-kategorie] [data-kategorie-zaehler]')).toHaveText('1/9');

  // Neue Kategorie, deren einzige Zeile löschen: Kategorie geht mit und wird genannt
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByRole('button', { name: '+ Kategorie' }).click();
  const neueKat = liste.locator('tr[data-kategorie="🧪 E2E-Kategorie"]');
  await expect(neueKat).toBeVisible();
  const neueZeile = neueKat.locator('xpath=following-sibling::tr[1]');
  await neueZeile.getByRole('button', { name: 'Löschen' }).click();
  await expect(neueKat).toHaveCount(0);
  await expect(page.getByText('Kategorie „🧪 E2E-Kategorie" mit entfernt — sie hatte keine weitere Zeile')).toBeVisible();
  promptAntwort = '';

  // ② Einheitenliste: Verkauf mit Ist-KP zählt als beurkundet
  await page.getByRole('tab', { name: '📊 Einheitenliste' }).click();
  const einheiten = page.getByRole('table', { name: 'Einheitenliste' });
  const e1 = einheiten.locator('tr[data-einheit="0"]');
  await expect(e1.locator('[data-spalte="kaltmiete"]')).toHaveText('600 €');
  await expect(e1.getByLabel('Verkaufspreis')).toHaveValue('160.000'); // 600 × 12 / 4,5 %
  await expect(einheiten.locator('tr[data-einheit="1"] [data-spalte="zimmer"]')).toHaveText('1×'); // Stellplatz ohne stk im Projekt
  await e1.getByLabel('Ist-KP').fill('250.000');
  await e1.getByLabel('Käufer').focus();
  await expect(e1.getByLabel('Ist-KP')).toHaveValue('250.000');
  await expect(page.locator('[data-fin="beurkundet"]')).toHaveText('0 €'); // nur mit Notarvertrag/Verkauft
  await e1.getByLabel('Vertriebsstand', { exact: true }).selectOption('sold');
  await expect(page.locator('[data-fin="beurkundet"]')).toHaveText('250.000 €');
  await expect(einheiten.locator('[data-summe="istKP"]')).toHaveText('250.000 €');
  await e1.getByRole('button', { name: 'PIP grün' }).click();

  await e1.getByRole('button', { name: 'Mietergespräche EG links' }).click();
  const gespraech = page.getByRole('dialog', { name: 'Mietergespräche – EG links' });
  await gespraech.getByRole('button', { name: '+ Eintrag' }).click();
  await expect(gespraech).toContainText('Bitte Gesprächsinhalt eingeben');
  await gespraech.getByLabel('Gesprächsinhalt').fill('Mieterhöhung besprochen');
  await gespraech.getByLabel('Ergebnis').fill('zugestimmt');
  await gespraech.getByRole('button', { name: '+ Eintrag' }).click();
  await expect(gespraech).toContainText('→ zugestimmt');
  await page.keyboard.press('Escape');
  await expect(e1.locator('[data-spalte="gespraeche"]')).toContainText('1 Eintrag');
  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');

  await page.reload();
  await page.getByRole('tab', { name: '📊 Einheitenliste' }).click();
  await expect(e1.getByLabel('Ist-KP')).toHaveValue('250.000');
  await expect(e1.getByRole('button', { name: 'PIP grün' })).toHaveAttribute('aria-pressed', 'true');
  await expect(e1.locator('[data-spalte="gespraeche"]')).toContainText('Mieterhöhung besprochen');

  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(karte.locator('[data-kpi="verkauft"] [data-wert]')).toHaveText('1');
  await expect(karte.locator('[data-kpi="checkliste"] [data-unter]')).toHaveText('1/136');
  await expect(karte).toContainText('1 grün');

  // Papierkorb: Deal wird wieder wählbar
  await karte.click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).first().click();
  await expect(page).toHaveURL(/\/projekte$/);
  await expect(karte).toHaveCount(0);
  const auswahl = await (await page.request.get('/api/projekte/deal-auswahl')).json();
  expect(auswahl.some((x: { id: string }) => x.id === d.id)).toBe(true);
});
