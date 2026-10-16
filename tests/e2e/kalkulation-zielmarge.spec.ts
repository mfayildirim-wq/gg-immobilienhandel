import { einheitAlsEingabe, KALK_STANDARD, kalkMitStandard, zielKaufpreis } from '@gg/domain';
import { expect, test } from '@playwright/test';

// 6 Wohnungen à 1.000 € IST-Miete (72.000 €/Jahr), Rendite der Einheiten 4,5 %, Angebot 1,5 Mio. €
const einheiten = ['EG links', 'EG rechts', '1.OG links', '1.OG rechts', '2.OG links', '2.OG rechts'].map((lage) => ({
  typ: 'Wohnung', lage, zimmer: 3, flaeche: 70, mieteIst: 1000, mieteNeu: null, mieteNeuManuell: false, renditeK: 4.5, verkaufspreis: null, stueck: null,
}));
const tausender = (n: number) => n.toLocaleString('de-DE');

test('Knöpfe „Kaufpreis für Zielmarge“ setzen den Kaufpreis auf 15 % Aufteiler bzw. 20 % Global', async ({ page }) => {
  const kennung = `Zielmarge ${Date.now()}`;
  const api = page.request;
  const objekt = await (await api.post('/api/objekte', { data: { strasse: kennung, hausnr: '1', stadt: 'Ulm' } })).json();
  const { id } = await (await api.post('/api/deals', { data: { objektId: objekt.id } })).json();
  const { version } = await (await api.get(`/api/deals/${id}`)).json();
  await api.put(`/api/deals/${id}/kalkulation`, { data: { version, kalkulation: { kaufpreis: 1_500_000 }, einheiten, sanierungen: [] } });

  const k = kalkMitStandard({ kaufpreis: 1_500_000 }, KALK_STANDARD);
  const e = einheiten.map(einheitAlsEingabe);
  const global = zielKaufpreis('global', k, e, [], KALK_STANDARD);
  const aufteiler = zielKaufpreis('aufteiler', k, e, [], KALK_STANDARD);
  if (!global.ok || !aufteiler.ok) throw new Error('kein Vorschlag');

  await page.goto('/deals');
  await page.getByRole('button', { name: new RegExp(kennung) }).click();
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  const kaufpreis = page.getByRole('textbox', { name: 'Kaufpreis', exact: true });
  await expect(kaufpreis).toHaveValue('1.500.000');

  // Global: Verkauf zur Soll-Rendite 5 % (Faktor 20) → 20 % Marge
  await page.getByRole('button', { name: 'Kaufpreis für Global 20 %' }).click();
  await expect(kaufpreis).toHaveValue(tausender(global.kaufpreis));
  const beiRendite = page.getByLabel('Global bei Soll-Rendite');
  await expect(beiRendite.getByText('FAKTOR 20,0')).toBeVisible();
  await expect(beiRendite.getByText('20,00 %')).toBeVisible();
  await expect(page.getByText('ungespeichert')).toBeVisible();

  // Aufteiler: 15 % auf die Verkaufserlöse der Einheiten
  await page.getByRole('button', { name: 'Kaufpreis für Aufteiler 15 %' }).click();
  await expect(kaufpreis).toHaveValue(tausender(aufteiler.kaufpreis));
  await expect(page.getByLabel('Aufteiler').getByText('15,00 %')).toBeVisible();

  // Eigene Soll-Rendite im Deal: 4 % = Faktor 25 → anderer Vorschlag
  await page.getByRole('textbox', { name: 'Soll-Rendite Global' }).fill('4');
  const faktor25 = zielKaufpreis('global', { ...k, rend_glo: 4 }, e, [], KALK_STANDARD);
  if (!faktor25.ok) throw new Error('kein Vorschlag');
  await page.getByRole('button', { name: 'Kaufpreis für Global 20 %' }).click();
  await expect(kaufpreis).toHaveValue(tausender(faktor25.kaufpreis));
  await expect(beiRendite.getByText('FAKTOR 25,0')).toBeVisible();
});
