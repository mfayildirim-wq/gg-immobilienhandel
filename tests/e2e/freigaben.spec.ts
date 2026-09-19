import { expect, test } from '@playwright/test';

test('Aktionen nach außen: Schalter, Proben und Freigabe-Anträge', async ({ page }) => {
  await page.request.put('/api/outward-gate', { data: { allowAgbSubmit: false, allowPropstackWrite: false, extraAgbHosts: [] } });
  const antrag = await (await page.request.post('/api/outward-gate/freigaben', {
    data: { action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', grund: 'Einheit 3 im Objekt Musterweg anlegen', beantragtVon: 'mcp' },
  })).json();

  await page.goto('/einstellungen/freigaben');
  await expect(page.locator('[data-umgebung]')).toContainText('gesperrte Umgebung');
  const probe = page.locator('[data-probe="propstack-unit-create"]');
  await expect(probe).toContainText('blockiert');
  await expect(probe).toContainText('environment');
  await expect(probe).toContainText('toggle');

  // Schalter an: die Umgebung bleibt trotzdem die Sperre (Default-Deny)
  await page.getByRole('switch', { name: 'Einheit in Propstack anlegen' }).click();
  await expect(page.getByRole('switch', { name: 'Einheit in Propstack anlegen' })).toBeChecked();
  await expect(probe).not.toContainText('toggle');
  await expect(probe).toContainText('blockiert');

  const zeile = page.locator(`[data-freigabe="${antrag.id}"]`);
  await expect(zeile).toContainText('api.propstack.de');
  await expect(zeile).toContainText('Einheit 3 im Objekt Musterweg anlegen');
  await zeile.getByRole('button', { name: 'Ablehnen' }).click();
  await expect(page.locator(`[data-freigabe="${antrag.id}"]`)).toHaveCount(0);

  const audit = await (await page.request.get('/api/audit?entity=outward-gate&limit=5')).json();
  expect(audit.zeilen[0]).toMatchObject({ action: 'approval-denied' });

  // MCP-Übersicht: Werkzeuge mit Bereich, Schlüssel nur als Label
  const mcp = page.getByLabel('MCP', { exact: true });
  await expect(mcp.locator('[data-mcp-werkzeug="request_outward_approval"]')).toContainText('outward');
  await expect(mcp.locator('[data-mcp-werkzeug="add_note"]')).toContainText('write');
  await expect(mcp.locator('[data-mcp-modus]')).toBeVisible();
});
