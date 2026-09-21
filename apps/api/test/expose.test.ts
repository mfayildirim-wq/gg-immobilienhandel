import { createDb, schema } from '@gg/db';
import { KALK_STANDARD } from '@gg/domain';
import { kiAttrappe, speicherImSpeicher, testExpose } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Exposé-Import gegen die lokale Datenbank (KI-Attrappe, Ablage im Speicher)', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher, ki: kiAttrappe(), attrappe: true } });
  const kennung = `Imp${Date.now()}`;
  const angelegt = { deals: [] as string[], objekte: [] as string[], makler: [] as string[] };

  afterAll(async () => {
    if (angelegt.deals.length) await db.delete(schema.deals).where(inArray(schema.deals.id, angelegt.deals));
    if (angelegt.objekte.length) await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await db.delete(schema.auditLog).where(like(schema.auditLog.source, 'expose-analyse/%'));
    await client.end();
  });

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const json = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const eingang = (bytes: Uint8Array) => app.request('/api/expose/eingang', { method: 'POST', body: bytes });

  it('nimmt nur echte PDFs an und analysiert nur eigene Eingänge', async () => {
    expect((await eingang(new TextEncoder().encode('kein pdf'))).status).toBe(422);
    expect((await json('/api/expose/analyse', { key: 'deal-docs/fremd.pdf', dateiname: 'x.pdf' })).status).toBe(422);
    expect((await json('/api/expose/analyse', { key: '_eingang/00000000-0000-4000-8000-000000000000', dateiname: 'x.pdf' })).status).toBe(404);
  });

  it('Direkt-Upload: Ticket, Datei liegt im Eingang, Übernahme prüft sie dort — und räumt ab, was kein PDF ist', async () => {
    const hochladen = async (bytes: Uint8Array) => {
      const t = await lies(json('/api/upload/ticket', { zweck: 'expose', groesse: bytes.byteLength }));
      await speicher.ablegen('pdfs', t.key, bytes, 'application/pdf');
      return t.key as string;
    };
    const gross = new Uint8Array(6 * 1024 * 1024).fill(0x20); // über den 4,5 MB einer Function
    gross.set(new TextEncoder().encode('%PDF-1.7\n'));
    const key = await hochladen(gross);
    const r = await json('/api/expose/eingang/uebernehmen', { key });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ key, groesse: gross.byteLength });
    expect(speicher.inhalt.has(`pdfs/${key}`)).toBe(true); // bleibt im Eingang, bis die Analyse es holt

    const keinPdf = await hochladen(new TextEncoder().encode('kein pdf'));
    expect((await json('/api/expose/eingang/uebernehmen', { key: keinPdf })).status).toBe(422);
    expect(speicher.inhalt.has(`pdfs/${keinPdf}`)).toBe(false);
    expect((await json('/api/expose/eingang/uebernehmen', { key: 'fremd/expose.pdf' })).status).toBe(400);
    expect((await json('/api/expose/eingang/uebernehmen', { key: '_eingang/00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('Upload → Analyse → Übernahme legt Objekt, Makler, Deal mit Einheiten und PDF an', async () => {
    const { key } = await lies(eingang(testExpose(kennung)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${kennung}.pdf` }));
    expect(a).toMatchObject({
      modus: 'text', attrappe: true,
      objekt: { strasse: `${kennung}strasse`, hausnr: '12', plz: '89073', stadt: 'Ulm', angebotspreis: 1_250_000, wohnflaeche: 240, einheiten: [{ lage: 'EG links', flaeche: 80 }, {}, {}] },
      makler: { name: `Anna ${kennung}`, prio: 'B', kontaktFreq: 'Monatlich' },
      deal: { status: 'In Prüfung', nachfassFreq: 'Wöchentlich', kalk: { kaufpreis: 1_250_000, rp_pct: KALK_STANDARD.rp_pct, notar: KALK_STANDARD.notar } },
      dubletten: { objekt: null, makler: null },
    });

    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${kennung}.pdf`, extrahiert: a.extrahiert,
      objekt: { daten: a.objekt }, makler: { daten: { ...a.makler, tel: `0049 ${a.makler.tel.slice(1)}` } },
      deal: { ...a.deal, kalk: { ...a.deal.kalk, makler: 0 } },
    });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId); angelegt.makler.push(erg.maklerId);
    expect(erg.pdfGespeichert).toBe(true);

    const deal = await lies(app.request(`/api/deals/${erg.dealId}`));
    expect(deal.einheiten.map((e: any) => [e.lage, e.flaeche, e.mieteIst, e.renditeK])).toEqual([['EG links', 80, 800, 4.5], ['OG rechts', 80, 820, 4.5], ['DG', 80, 700, 4.5]]);
    expect(deal.kalkulation).toMatchObject({ kaufpreis: 1_250_000, makler: 0, rp_pct: 10 });
    expect(deal.kalkulation.gik).toBeGreaterThan(1_250_000);
    const [makler] = await db.select().from(schema.makler).where(eq(schema.makler.id, erg.maklerId));
    expect(makler).toMatchObject({ tel: `+49 ${a.makler.tel.slice(1)}`, kontaktFrequenz: 'Monatlich', prio: 'B' });
    const verlauf = await lies(app.request(`/api/deals/${erg.dealId}/status-historie`));
    expect(verlauf[0]).toMatchObject({ nachStatus: 'In Prüfung', quelle: 'wizard' });
    const [dok] = await db.select().from(schema.dealDokumente).where(eq(schema.dealDokumente.dealId, erg.dealId));
    expect(dok).toMatchObject({ label: 'Exposé (Import)', istExpose: true, dateiname: `Exposé_${kennung}strasse 12.pdf` });
    expect(speicher.inhalt.has(`pdfs/${erg.dealId}.pdf`)).toBe(true);
    expect(speicher.inhalt.has(`pdfs/${key}`)).toBe(false);
    expect(await lies(app.request('/api/expose/bekannte-dateien'))).toContain(`${kennung}.pdf`.toLowerCase());
  });

  it('nimmt null für nicht gefundene Felder an (so liefert es die KI) und speichert sie als leer', async () => {
    // Echte Exposés belegen selten alle Felder. Claude gibt für jedes nicht gefundene Feld `null` zurück —
    // ein Vertrag, der nur `undefined` zuließe, wies solche Exposés mit „Eingabe ungültig" ab (Befund 18.09.2026).
    // Deutlich andere Adresse als die übrigen Tests: sonst hält die Dublettenprüfung sie für verwandt.
    const eigene = `Leerfeld${Date.now()}`;
    const { key } = await lies(eingang(testExpose(eigene)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${eigene}.pdf` }));

    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${eigene}.pdf`, extrahiert: a.extrahiert,
      objekt: { daten: { ...a.objekt, bundesland: null, heizungsart: null, lagebeschreibung: null,
        energieausweis: { klasse: null, kennwert: null, art: null },
        einheiten: [{ typ: null, lage: null, zimmer: null, flaeche: 80, kaltmiete: 700, vermiet: null }] } },
      makler: { daten: { ...a.makler, name: null, firma: null, webseite: null, notizen: null, prio: null, kontaktFreq: null } },
      deal: a.deal,
    });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId);
    if (erg.maklerId) angelegt.makler.push(erg.maklerId);

    // null wird zu „nicht gesetzt", nicht zum Text „null"
    const [objekt] = await db.select().from(schema.objekte).where(eq(schema.objekte.id, erg.objektId));
    expect(objekt).toMatchObject({ energieklasse: null, heizung: null });
    const deal = await lies(app.request(`/api/deals/${erg.dealId}`));
    expect(deal.einheiten).toHaveLength(1);
    expect(deal.einheiten[0]).toMatchObject({ flaeche: 80, mieteIst: 700 });
  });

  it('zweiter Import: erkennt Objekt und Makler als Dubletten, Deal-Dublette → 409 ohne neue Datensätze', async () => {
    const { key } = await lies(eingang(testExpose(kennung)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: 'nochmal.pdf' }));
    expect(a.dubletten.objekt).toMatchObject({ sicherheit: 'exact' });
    expect(a.dubletten.makler).toMatchObject({ sicherheit: 'exact' });
    const vorher = (await db.select().from(schema.deals)).length;
    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: 'nochmal.pdf', extrahiert: a.extrahiert,
      objekt: { bestehendeId: a.dubletten.objekt.id, daten: a.objekt }, makler: { bestehendeId: a.dubletten.makler.id, daten: a.makler }, deal: a.deal,
    });
    expect(r.status).toBe(409);
    expect((await lies(r)).details.dealId).toBe(angelegt.deals[0]);
    expect((await db.select().from(schema.deals)).length).toBe(vorher);
  });
});
