import { expect, test } from '@playwright/test';

test('Eingehender Anruf: bekannter Makler öffnet das Briefing, unbekannte Nummer wird gemeldet', async ({ page }) => {
  const kennung = `Anruf${Date.now()}`;
  // Nummer je Lauf eindeutig: sonst findet die Suche einen gleichnamigen Makler aus einem früheren Lauf.
  const nummer = `+49 711 47${String(Date.now()).slice(-7)}`;
  const m = await (await page.request.post('/api/makler', { data: { name: `${kennung} Anrufer`, tel: nummer, prio: 'A' } })).json();
  const dd = await (await page.request.get(`/api/makler/${m.id}`)).json();
  await page.request.patch(`/api/makler/${m.id}`, { data: { version: dd.version, nextContact: new Date().toISOString().slice(0, 10) } });

  await page.goto('/?incoming=' + encodeURIComponent(nummer.replace('+49', '0049')));
  await expect(page.getByRole('dialog').getByText(`${kennung} Anrufer`).first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/?incoming=' + encodeURIComponent('+49 30 000000'));
  await expect(page.locator('[data-anruf-hinweis]')).toContainText('📞 Eingehend: +49 30 000000 (kein Makler hinterlegt)');
});

test('Anleitungen: App-Adresse und iOS-Kurzbefehl stehen in den Einstellungen', async ({ page }) => {
  await page.goto('/einstellungen/anleitungen');
  await page.getByText('🌐 Unter welcher Adresse läuft die App?').click();
  await expect(page.locator('[data-app-adresse]')).toContainText('http');
  await page.getByText('📞 Eingehende Anrufe über den iOS-Kurzbefehl').click();
  await expect(page.getByText('/?incoming=')).toBeVisible();
});
