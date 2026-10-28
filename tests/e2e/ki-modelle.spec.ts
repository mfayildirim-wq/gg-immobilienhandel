import { expect, test } from '@playwright/test';

const STANDARD = { praesentation: 'standard', expose: 'standard', makler: 'standard', autoimport: 'standard' };

test('KI-Modelle: je Bereich ein Modell wählen, speichern, Werkseinstellung zurück', async ({ page }) => {
  await page.request.put('/api/einstellungen/ki-modelle', { data: STANDARD });
  try {
    await page.goto('/einstellungen/ki-modelle');
    const bereich = page.getByRole('region', { name: 'KI-Modelle' });
    const praes = bereich.getByRole('combobox', { name: 'Bank-Präsentation' });
    await expect(praes).toHaveValue('Wie bisher (je Funktion fest)');

    await praes.click();
    await page.getByRole('option', { name: /^Sonnet 5\.5/ }).click();
    await bereich.getByRole('button', { name: 'Speichern' }).click();
    await expect.poll(async () => (await (await page.request.get('/api/einstellungen/ki-modelle')).json()).praesentation).toBe('claude-sonnet-5-5');

    await page.reload();
    await expect(bereich.getByRole('combobox', { name: 'Bank-Präsentation' })).toHaveValue(/^Sonnet 5\.5/);
    await expect(bereich.getByRole('combobox', { name: 'Makler und Persona' })).toHaveValue('Wie bisher (je Funktion fest)');

    await bereich.getByRole('button', { name: 'Werkseinstellung' }).click();
    await bereich.getByRole('button', { name: 'Speichern' }).click();
    await expect.poll(async () => (await page.request.get('/api/einstellungen/ki-modelle')).json()).toEqual(STANDARD);
  } finally {
    await page.request.put('/api/einstellungen/ki-modelle', { data: STANDARD });
  }
});
