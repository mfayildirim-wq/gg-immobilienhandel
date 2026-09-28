import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { appToken, graphDrive, kiAttrappe, sharepointAblage, speicherImSpeicher, testExpose } from '@gg/integrations';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GraphNachbau, graphNachbauStarten } from '../../../packages/integrations/test/sharepoint/graph-nachbau.ts';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

describe.skipIf(!url)('Dokumente an Deal und Objekt — Ablage in SharePoint (Graph-Nachbau), Bestand in Supabase', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  let nachbau: GraphNachbau;
  let app: ReturnType<typeof createApp>;
  const kennung = `Dok${Date.now()}`;
  const angelegt = { deals: [] as string[], objekte: [] as string[], makler: [] as string[] };
  mitAusgeliefertenStandards(url!);

  beforeAll(async () => {
    nachbau = await graphNachbauStarten();
    const drive = graphDrive(appToken({ tenantId: 't', clientId: 'c', clientSecret: 'geheim' }, nachbau.loginBasis), nachbau.siteId, nachbau.basis);
    const sharepoint = sharepointAblage(drive, { wurzel: 'GG Immohandel', ordner: { dokumente: '' } });
    app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, speicher, sharepoint, expose: { speicher, ki: kiAttrappe(), attrappe: true } });
  });
  afterAll(async () => {
    if (angelegt.deals.length) await db.delete(schema.deals).where(inArray(schema.deals.id, angelegt.deals));
    if (angelegt.objekte.length) await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await db.delete(schema.auditLog).where(like(schema.auditLog.source, '%dokumente%'));
    await nachbau.stop();
    await client.end();
  });

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const json = (pfad: string, body: unknown, method = 'POST') => app.request(pfad, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const formular = (pfad: string, dateien: { name: string; typ: string; bytes: Uint8Array }[]) => {
    const form = new FormData();
    for (const d of dateien) form.append('dateien', new File([d.bytes], d.name, { type: d.typ }));
    return app.request(pfad, { method: 'POST', body: form });
  };
  const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);

  let objektId = '';
  let dealId = '';

  it('Objekt: Dokument hochladen landet in SharePoint unter Objekte/<Adresse> [<id>]/ — mit Kennung, Pfad und Link', async () => {
    const o = await lies(json('/api/objekte', { strasse: `${kennung}weg`, hausnr: '7', stadt: 'Ulm' }));
    objektId = o.id; angelegt.objekte.push(objektId);
    const r = await formular(`/api/objekte/${objektId}/dokumente`, [{ name: 'Grundbuch: Auszug.pdf', typ: 'application/pdf', bytes: pdf('grundbuch') }]);
    expect(r.status).toBe(201);
    const [dok] = await lies(r);
    expect(dok).toMatchObject({ dateiname: 'Grundbuch: Auszug.pdf', ablage: 'sharepoint', bezug: { art: 'objekt', id: objektId }, istExpose: false });
    expect(dok.pfad).toBe(`GG Immohandel/Objekte/${kennung}weg 7, Ulm [${objektId}]/Grundbuch_ Auszug.pdf`);
    expect(dok.webUrl).toContain('sharepoint.com');
    const [zeile] = await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, dok.id));
    expect(zeile).toMatchObject({ objektId, dealId: null, ablage: 'sharepoint', bucket: 'dokumente' });
    expect(zeile!.spItemId).toMatch(/^item-/);
    expect(zeile!.spEtag).toBeTruthy();
    expect(speicher.inhalt.size).toBe(0); // nichts in Supabase
  });

  it('Datei-Route leitet bei SharePoint auf die kurzlebige Download-Adresse weiter (302), Bezeichnung und Löschen wirken', async () => {
    const [dok] = await lies(app.request(`/api/objekte/${objektId}/dokumente`));
    const r = await app.request(`/api/objekte/${objektId}/dokumente/${dok.id}/datei`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('/_download/');
    expect(new TextDecoder().decode(new Uint8Array(await (await fetch(r.headers.get('location')!)).arrayBuffer()))).toContain('grundbuch');
    expect((await json(`/api/objekte/${objektId}/dokumente/${dok.id}`, { label: 'Grundbuch' }, 'PATCH')).status).toBe(200);
    expect((await lies(app.request(`/api/objekte/${objektId}/dokumente`)))[0].label).toBe('Grundbuch');
    expect((await app.request(`/api/objekte/${objektId}/dokumente/${dok.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await lies(app.request(`/api/objekte/${objektId}/dokumente`))).toEqual([]);
    expect([...nachbau.eintraege.keys()].some((k) => k.endsWith('Grundbuch_ Auszug.pdf'))).toBe(false);
  });

  it('Direkt-Upload am Objekt: Ticket ist eine Upload-Session, Übernahme verschiebt in den Objektordner', async () => {
    const t = await lies(json('/api/upload/ticket', { zweck: 'dokument', groesse: 40 }));
    expect(t.art).toBe('upload-session');
    const bytes = pdf('teilungserklaerung');
    const put = await fetch(t.url, { method: 'PUT', body: bytes, headers: { 'content-range': `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` } });
    expect(put.status).toBe(201);
    const r = await json(`/api/objekte/${objektId}/dokumente/uebernehmen`, { dateien: [{ key: t.key, name: 'Teilungserklärung.pdf', typ: 'application/pdf' }] });
    expect(r.status).toBe(201);
    const [dok] = await lies(r);
    expect(dok.pfad).toBe(`GG Immohandel/Objekte/${kennung}weg 7, Ulm [${objektId}]/Teilungserklärung.pdf`);
    expect([...nachbau.eintraege.values()].some((e) => !e.ordner && e.pfad.includes('_eingang'))).toBe(false);
  });

  it('Deal-Dokument liegt unter …/Deals/<deal-id>/; die Objektliste zeigt es mit mitDeals=1', async () => {
    const d = await lies(json('/api/deals', { objektId }));
    dealId = d.id; angelegt.deals.push(dealId);
    const r = await formular(`/api/deals/${dealId}/dokumente`, [{ name: 'Mietvertrag.pdf', typ: 'application/pdf', bytes: pdf('mietvertrag') }]);
    expect(r.status).toBe(201);
    const [dok] = await lies(r);
    expect(dok.pfad).toBe(`GG Immohandel/Objekte/${kennung}weg 7, Ulm [${objektId}]/Deals/${dealId}/Mietvertrag.pdf`);
    expect(dok.bezug).toEqual({ art: 'deal', id: dealId });
    expect((await lies(app.request(`/api/objekte/${objektId}/dokumente`))).map((x: any) => x.dateiname)).toEqual(['Teilungserklärung.pdf']);
    expect((await lies(app.request(`/api/objekte/${objektId}/dokumente?mitDeals=1`))).map((x: any) => x.dateiname).sort()).toEqual(['Mietvertrag.pdf', 'Teilungserklärung.pdf']);
    // Deal-Dokument über das Objekt lesbar (Weiterleitung), Objektdokument über den Deal — aber nichts über einen fremden Deal
    expect((await app.request(`/api/objekte/${objektId}/dokumente/${dok.id}/datei`)).status).toBe(302);
    const [objektDok] = await lies(app.request(`/api/objekte/${objektId}/dokumente`));
    expect((await app.request(`/api/deals/${dealId}/dokumente/${objektDok.id}/datei`)).status).toBe(302);
    expect((await app.request(`/api/deals/gibt-es-nicht/dokumente/${dok.id}/datei`)).status).toBe(404);
    const fremdObjekt = await lies(json('/api/objekte', { strasse: `${kennung}fremd`, hausnr: '1' }));
    angelegt.objekte.push(fremdObjekt.id);
    const fremd = await lies(json('/api/deals', { objektId: fremdObjekt.id }));
    angelegt.deals.push(fremd.id);
    expect((await app.request(`/api/deals/${fremd.id}/dokumente/${dok.id}/datei`)).status).toBe(404);
  });

  it('Exposé-Import: das Exposé-Dokument des neuen Deals liegt in SharePoint, pdfs/<dealId>.pdf bleibt in Supabase', async () => {
    const { key } = await lies(app.request('/api/expose/eingang', { method: 'POST', body: testExpose(kennung) }));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${kennung}.pdf` }));
    const r = await json('/api/expose/uebernehmen', { key, dateiname: `${kennung}.pdf`, extrahiert: a.extrahiert, objekt: { daten: a.objekt }, makler: { daten: a.makler }, deal: a.deal });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId); angelegt.makler.push(erg.maklerId);
    expect(erg.pdfGespeichert).toBe(true);
    const [dok] = await lies(app.request(`/api/deals/${erg.dealId}/dokumente`));
    expect(dok).toMatchObject({ istExpose: true, label: 'Exposé (Import)', ablage: 'sharepoint' });
    expect(dok.pfad).toBe(`GG Immohandel/Objekte/${kennung}strasse 12, Ulm [${erg.objektId}]/Deals/${erg.dealId}/Exposé_${kennung}strasse 12.pdf`);
    expect(speicher.inhalt.has(`pdfs/${erg.dealId}.pdf`)).toBe(true);
    // exposeIds für die Deal-Liste kennt das Dokument weiterhin
    expect((await lies(app.request('/api/listen'))).exposeIds[erg.dealId]).toBe(dok.id);
  });

  it('Bestand in Supabase bleibt lesbar: eine alte Zeile mit ablage=supabase wird als Strom ausgeliefert', async () => {
    await speicher.ablegen('deal-docs', `${dealId}/alt_Altdok.pdf`, pdf('alt'), 'application/pdf');
    const id = crypto.randomUUID();
    await db.insert(schema.dokumente).values({ id, dealId, objektId, dateiname: 'Altdok.pdf', mimeType: 'application/pdf', groesseBytes: 20, label: '', istExpose: false, ablage: 'supabase', bucket: 'deal-docs', storageKey: `${dealId}/alt_Altdok.pdf` });
    const r = await app.request(`/api/deals/${dealId}/dokumente/${id}/datei`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('inline');
    expect(new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()))).toContain('alt');
    const liste = await lies(app.request(`/api/deals/${dealId}/dokumente`));
    expect(liste.find((x: any) => x.id === id)).toMatchObject({ ablage: 'supabase', pfad: `deal-docs/${dealId}/alt_Altdok.pdf`, webUrl: null });
    expect((await app.request(`/api/deals/${dealId}/dokumente/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(speicher.inhalt.has(`deal-docs/${dealId}/alt_Altdok.pdf`)).toBe(false);
  });

  it('Migration: Bestand aus Supabase wandert in Bündeln nach SharePoint — geprüft, wiederaufnehmbar, die Supabase-Datei bleibt', async () => {
    await speicher.ablegen('deal-docs', `${dealId}/b1_Bestand eins.pdf`, pdf('bestand-1'), 'application/pdf');
    await speicher.ablegen('deal-docs', `${dealId}/b2_Bestand zwei.pdf`, pdf('bestand-2'), 'application/pdf');
    const zeile = (n: number, key: string, groesse: number) => ({ id: crypto.randomUUID(), dealId, objektId, dateiname: `Bestand ${n === 1 ? 'eins' : n === 2 ? 'zwei' : 'kaputt'}.pdf`, mimeType: 'application/pdf', groesseBytes: groesse, label: '', istExpose: false, ablage: 'supabase', bucket: 'deal-docs', storageKey: key });
    const b1 = zeile(1, `${dealId}/b1_Bestand eins.pdf`, pdf('bestand-1').byteLength);
    const b2 = zeile(2, `${dealId}/b2_Bestand zwei.pdf`, pdf('bestand-2').byteLength);
    const kaputt = zeile(3, `${dealId}/fehlt.pdf`, 10); // Datei fehlt in Supabase → bleibt offen
    await db.insert(schema.dokumente).values([b1, b2, kaputt]);
    const vorher = await lies(app.request('/api/sharepoint/migration'));
    expect(vorher.inSupabase).toBeGreaterThanOrEqual(3);

    const lauf1 = await lies(json('/api/sharepoint/migration', { limit: 2 }));
    expect(lauf1.migriert + lauf1.fehler.length).toBe(2);
    const lauf2 = await lies(json('/api/sharepoint/migration', { limit: 50 }));
    expect(lauf1.migriert + lauf2.migriert).toBeGreaterThanOrEqual(2);
    expect([...lauf1.fehler, ...lauf2.fehler].some((f: string) => f.startsWith('Bestand kaputt.pdf'))).toBe(true);
    const [z1] = await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, b1.id));
    expect(z1).toMatchObject({ ablage: 'sharepoint', bucket: 'dokumente', spPfad: `GG Immohandel/Objekte/${kennung}weg 7, Ulm [${objektId}]/Deals/${dealId}/Bestand eins.pdf` });
    expect(z1!.spItemId).toBeTruthy();
    expect(speicher.inhalt.has(`deal-docs/${dealId}/b1_Bestand eins.pdf`)).toBe(true); // Rückweg bleibt
    const [zk] = await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, kaputt.id));
    expect(zk!.ablage).toBe('supabase');
    // migrierte Datei ist über die App lesbar (Weiterleitung)
    expect((await app.request(`/api/deals/${dealId}/dokumente/${b1.id}/datei`)).status).toBe(302);
    await db.delete(schema.dokumente).where(eq(schema.dokumente.id, kaputt.id));
  });

  it('Abgleich: in SharePoint verschobene Dateien werden eingeholt, verschwundene datiert, zurückgekehrte bereinigt', async () => {
    const [dok] = await db.select().from(schema.dokumente).where(and(eq(schema.dokumente.dealId, dealId), eq(schema.dokumente.dateiname, 'Bestand eins.pdf')));
    // im Nachbau „von Hand“ verschieben: neuer Pfad, gleiche Kennung
    const eintrag = [...nachbau.eintraege.entries()].find(([, e]) => e.id === dok!.spItemId)!;
    nachbau.eintraege.delete(eintrag[0]);
    const neuerPfad = eintrag[0].replace('Bestand eins.pdf', 'Verschoben/Bestand eins (alt).pdf');
    nachbau.eintraege.set(neuerPfad, { ...eintrag[1], pfad: neuerPfad, name: 'Bestand eins (alt).pdf', eTag: '"neu"' });
    const a1 = await lies(json('/api/sharepoint/abgleich', {}));
    expect(a1.verschoben).toBeGreaterThanOrEqual(1);
    const [nachher] = await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, dok!.id));
    expect(nachher).toMatchObject({ spPfad: neuerPfad, dateiname: 'Bestand eins (alt).pdf', storageKey: neuerPfad.replace('GG Immohandel/', '') });
    expect((await app.request(`/api/deals/${dealId}/dokumente/${dok!.id}/datei`)).status).toBe(302); // über die Kennung weiter erreichbar
    // verschwinden lassen
    nachbau.eintraege.delete(neuerPfad);
    // andere SharePoint-Zeilen der lokalen Datenbank (aus echten Läufen) kennt der Nachbau nicht — deshalb nur „mindestens“
    const a2 = await lies(json('/api/sharepoint/abgleich', {}));
    expect(a2.verschwunden).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, dok!.id)))[0]!.spFehltSeit).toBeTruthy();
    expect((await lies(app.request('/api/sharepoint/migration'))).fehlend).toBeGreaterThanOrEqual(1);
    // zurück
    nachbau.eintraege.set(neuerPfad, { ...eintrag[1], pfad: neuerPfad, name: 'Bestand eins (alt).pdf', eTag: '"neu"' });
    const a3 = await lies(json('/api/sharepoint/abgleich', {}));
    expect(a3.zurueck).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(schema.dokumente).where(eq(schema.dokumente.id, dok!.id)))[0]!.spFehltSeit).toBeNull();
  });
});
