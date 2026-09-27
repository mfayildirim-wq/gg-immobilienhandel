import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentKern, type Nutzer } from '../src/kern.ts';
import { mcpVerbinden } from '../src/mcp.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import { agenten } from '../src/schema.ts';
import { testDb, url } from './db.ts';

/** Ein echter MCP-Server (Streamable HTTP, ohne Sitzung) mit Anmeldung: Mails suchen (nur lesend) und Mail senden. */
const gesendet: string[] = [];
function mcpServerBauen() {
  const s = new McpServer({ name: 'post', version: '1.0.0' });
  s.registerTool('suche_mails', { description: 'Sucht Mails im Postfach', inputSchema: { stichwort: z.string() }, annotations: { readOnlyHint: true } },
    async ({ stichwort }) => ({ content: [{ type: 'text', text: `2 Mails zu „${stichwort}“: Exposé Musterweg 1, Rückfrage Kaufpreis` }] }));
  s.registerTool('mail_senden', { description: 'Sendet eine Mail', inputSchema: { an: z.string(), text: z.string() } },
    async ({ an, text }) => { gesendet.push(`${an}: ${text}`); return { content: [{ type: 'text', text: `gesendet an ${an}` }] }; });
  return s;
}

let http: Server;
let adresse = '';
beforeAll(async () => {
  http = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer geheim') { res.writeHead(401).end(); return; }
    const server = mcpServerBauen();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  adresse = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => { await new Promise((r) => http.close(r)); });

describe('mcpVerbinden', () => {
  it('listet die Werkzeuge eines Servers mit Anmeldung — ohne Anmeldung eine Meldung', async () => {
    const w = await mcpVerbinden({ name: 'Post', url: adresse }, 'Authorization: Bearer geheim');
    expect(w.map((x) => x.name)).toEqual(['mcp_post_suche_mails', 'mcp_post_mail_senden']);
    expect(w[0]).toMatchObject({ server: 'Post', original: 'suche_mails', beschreibung: 'Sucht Mails im Postfach', liestNur: true });
    expect(await w[0]!.aufrufen({ stichwort: 'Musterweg' })).toContain('Exposé Musterweg 1');
    await expect(mcpVerbinden({ name: 'Post', url: adresse })).rejects.toThrow();
  });
});

describe.skipIf(!url)('Kern mit MCP-Server', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  afterAll(async () => { if (url) await db.delete(agenten).where(like(agenten.slug, 'test-mcp-%')); await client?.end(); });
  const nutzer: Nutzer = { id: 'test-mcp@example' };
  // Die Kopfzeile wird nur verschlüsselt gespeichert — hier eine erkennbare Umkehrung als Ersatz
  const geheimnis = { verpacken: (s: string) => `v:${[...s].reverse().join('')}`, auspacken: (s: string) => [...s.slice(2)].reverse().join('') };
  const basis = { openapi: { paths: {} }, ziele: [], aufruf: async () => ({ status: 200, text: '{}' }), geheimnis, mcpLokalErlaubt: true };

  it('fragt vor jedem MCP-Werkzeug — erst nach „Ja“ wird gesendet; freigegebene laufen ohne Rückfrage', async () => {
    const dna = { slug: `test-mcp-${Date.now()}` };
    const kern = agentKern({ db, modell: drehbuchModell([]), dna, ...basis });
    expect(await kern.mcpHinzufuegen({ name: 'Post', url: adresse, kopf: 'Authorization: Bearer geheim' })).toEqual({ werkzeuge: 2 });
    // Die Kopfzeile steht nie im Klartext in den Einstellungen
    expect(JSON.stringify(await kern.einstellungen())).not.toContain('geheim');

    const senden = [ki('', [['mcp_post_mail_senden', { an: 'makler@example.org', text: 'Rückruf Montag' }]]), ki('Die Mail ist raus.')];
    const a = await agentKern({ db, modell: drehbuchModell(senden), dna, ...basis }).nachricht(nutzer, { text: 'Schick dem Makler eine Mail', ort: '/', kontext: {} });
    expect(a.wartetAuf?.frage).toMatch(/Post.*mail_senden/);
    expect(gesendet).toEqual([]);
    const b = await agentKern({ db, modell: drehbuchModell(senden.slice(1)), dna, ...basis }).entscheidung(nutzer, { sitzungId: a.sitzungId, wert: 'ja' });
    expect(b.text).toBe('Die Mail ist raus.');
    expect(gesendet).toEqual(['makler@example.org: Rückruf Montag']);

    // Auch Lesendes fragt zunächst; nach der Freigabe nicht mehr
    const suchen = () => drehbuchModell([ki('', [['mcp_post_suche_mails', { stichwort: 'Musterweg' }]]), ki('Zwei Mails gefunden.')]);
    expect((await agentKern({ db, modell: suchen(), dna, ...basis }).nachricht(nutzer, { text: 'Mails?', ort: '/', kontext: {} })).wartetAuf).toBeTruthy();
    await kern.werkzeugFrei('mcp_post_suche_mails', true);
    const c = await agentKern({ db, modell: suchen(), dna, ...basis }).nachricht(nutzer, { text: 'Mails?', ort: '/', kontext: {} });
    expect(c.wartetAuf).toBeUndefined();
    expect(c.text).toBe('Zwei Mails gefunden.');

    const liste = await kern.werkzeugListe();
    expect(liste.find((w) => w.name === 'mcp_post_suche_mails')).toMatchObject({ quelle: 'mcp', server: 'Post', recht: 'frei' });
    expect(liste.find((w) => w.name === 'mcp_post_mail_senden')).toMatchObject({ recht: 'fragt' });
    expect(liste.find((w) => w.name === 'steuere')).toMatchObject({ quelle: 'agent' });

    await kern.mcpEntfernen('Post');
    expect((await kern.werkzeugListe()).some((w) => w.quelle === 'mcp')).toBe(false);
  });

  it('nimmt keinen Server auf, der nicht antwortet', async () => {
    const kern = agentKern({ db, modell: drehbuchModell([]), dna: { slug: `test-mcp-x-${Date.now()}` }, ...basis });
    await expect(kern.mcpHinzufuegen({ name: 'Weg', url: adresse, kopf: 'Authorization: Bearer falsch' })).rejects.toThrow();
  });
});
