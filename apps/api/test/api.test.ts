import { createHash } from 'node:crypto';
import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { erzeugeSchleuse, SCHLEUSE_STANDARD } from '@gg/documents/pdf';
import { graphAttrappe, kiAttrappe, propstackAttrappe, speicherImSpeicher } from '@gg/integrations';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

/**
 * Integrationstests gegen die lokale Supabase-Datenbank (`pnpm db:start && pnpm db:reset`).
 * Ohne DATABASE_URL werden sie übersprungen.
 */
// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const offen = { lokalOffen: true, produktion: false, erlaubteEmails: [] };

describe('Eingabeprüfung ohne Datenbank', () => {
  const app = createApp({ db: null as never, auth: offen });

  it('lehnt einen Deal ohne Objekt mit 400 ab', async () => {
    const res = await app.request('/api/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('lehnt einen unbekannten Status mit 400 ab', async () => {
    const res = await app.request('/api/deals/x/status', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'Verkauft', version: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('verlangt in Produktion einen Login', async () => {
    const prod = createApp({ db: null as never, auth: { ...offen, produktion: true } });
    expect((await prod.request('/api/deals')).status).toBe(401);
  });

  it('nimmt das Token auch aus dem Cookie (Bilder und Downloads tragen keinen Header)', async () => {
    const prod = createApp({ db: null as never, auth: { ...offen, produktion: true, supabaseUrl: 'https://beispiel.supabase.co' } });
    // Ohne gültiges Token bleibt es bei 401 — geprüft wird, dass der Cookie überhaupt gelesen wird
    const ohne = await prod.request('/api/deals');
    const mit = await prod.request('/api/deals', { headers: { cookie: 'gg-auth=kaputtes-token' } });
    expect([ohne.status, mit.status]).toEqual([401, 401]);
    expect(await ohne.json()).toEqual({ fehler: 'Nicht angemeldet' });
    expect(await mit.json()).toEqual({ fehler: 'Anmeldung ungültig' });
  });
});

describe.skipIf(!url)('Deal-Ablauf gegen die lokale Datenbank', () => {
  const { db, client } = createDb(url!);
  const gedruckt: { kalkName: string; ersteller: string; disclaimer: string; impressionen?: string[] }[] = [];
  const speicher = speicherImSpeicher();
  const praesGedruckt: { bankName: string; slides: { typ: string; data: Record<string, unknown> }[] }[] = [];
  const app = createApp({
    db, auth: offen, speicher, ki: kiAttrappe(), suche: { web: async () => [], news: async () => [] },
    pdf: {
      drucken: async (p) => { gedruckt.push(p); return new TextEncoder().encode('%PDF-1.7 attrappe'); },
      praesentation: async (p) => { praesGedruckt.push(p); return new TextEncoder().encode('%PDF-1.7 praesentation'); },
      schleuse: erzeugeSchleuse(SCHLEUSE_STANDARD),
    },
  });
  const angelegt: { objekte: string[]; makler: string[] } = { objekte: [], makler: [] };
  mitAusgeliefertenStandards(url!);

  afterAll(async () => {
    if (angelegt.objekte.length) await db.delete(schema.deals).where(inArray(schema.deals.objektId, angelegt.objekte));
    if (angelegt.objekte.length) await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await client.end();
  });

  // Testantworten bewusst untypisiert lesen; die Struktur prüfen die Erwartungen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

  const post = (pfad: string, body: unknown, method = 'POST') =>
    app.request(pfad, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('legt Deal an, wechselt Status, schreibt Verlauf und erkennt Versionskonflikte', async () => {
    const objekt = await lies(post('/api/objekte', { strasse: 'Teststraße', hausnr: '1', stadt: 'Testhausen' }));
    angelegt.objekte.push(objekt.id);
    const makler = await lies(post('/api/makler', { name: 'Test Makler' }));
    angelegt.makler.push(makler.id);
    expect(makler).toMatchObject({ prio: 'B', kontaktFrequenz: 'Monatlich' });

    const res = await post('/api/deals', { objektId: objekt.id, maklerId: makler.id });
    expect(res.status).toBe(201);
    const { id } = await lies(res);

    const liste = await lies(app.request('/api/deals'));
    const deal = liste.find((d: { id: string }) => d.id === id);
    expect(deal).toMatchObject({ status: 'In Prüfung', version: 1, objekt: { titel: 'Teststraße 1' } });

    const wechsel = await post(`/api/deals/${id}/status`, { status: 'Closing Path', version: 1 }, 'PATCH');
    expect(wechsel.status).toBe(200);
    expect(await lies(wechsel)).toMatchObject({ status: 'Closing Path', version: 2 });

    const konflikt = await post(`/api/deals/${id}/status`, { status: 'Archiv', version: 1 }, 'PATCH');
    expect(konflikt.status).toBe(409);

    const verlauf = await lies(app.request(`/api/deals/${id}/status-historie`));
    expect(verlauf.map((v: { nachStatus: string }) => v.nachStatus)).toEqual(['Closing Path', 'In Prüfung']);
  });

  it('erlaubt einen Deal ohne Makler (Ist-Verhalten)', async () => {
    const objekt = await lies(post('/api/objekte', { stadt: 'Ohne-Makler-Stadt' }));
    angelegt.objekte.push(objekt.id);
    expect((await post('/api/deals', { objektId: objekt.id })).status).toBe(201);
  });

  it('speichert Kalkulation mit Einheiten und Sanierungen, rechnet Kennzahlen und behält Einheiten-IDs', async () => {
    const objekt = await lies(post('/api/objekte', { strasse: 'Kalkweg', hausnr: '2', stadt: 'Rechenstadt' }));
    angelegt.objekte.push(objekt.id);
    const { id } = await lies(post('/api/deals', { objektId: objekt.id }));
    const kalk = { kaufpreis: 1_000_000, fk_p: 80, ek_p: 20 };
    const einheit = { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, mieteIst: 800, mieteNeu: null, mieteNeuManuell: false, renditeK: 4.5, verkaufspreis: null, stueck: null };

    const r1 = await post(`/api/deals/${id}/kalkulation`, {
      version: 1, kalkulation: kalk, einheiten: [einheit], sanierungen: [{ beschreibung: 'Dach', betrag: 50_000, bereich: 'auf' }],
    }, 'PUT');
    expect(r1.status).toBe(200);
    const g1 = await lies(r1);
    const { berechneAnkauf, KALK_STANDARD } = await import('@gg/domain');
    const erwartet = berechneAnkauf(kalk, [{ typ: 'Wohnung', fl: 80, mi_ist: 800, rend_k: 4.5 }], [{ amt: 50_000, scope: 'auf' }], KALK_STANDARD).kennzahlen;
    expect(g1).toMatchObject({ version: 2, kennzahlen: erwartet });

    const d1 = await lies(app.request(`/api/deals/${id}`));
    expect(d1.kalkulation).toMatchObject({ ...kalk, gik: erwartet.gik });
    expect(d1.sanierungen).toMatchObject([{ beschreibung: 'Dach', betrag: 50000, bereich: 'auf' }]);
    const einheitId = d1.einheiten[0].id;

    // zweite Einheit dazu, erste bleibt mit derselben ID
    const r2 = await post(`/api/deals/${id}/kalkulation`, {
      version: 2, kalkulation: kalk, einheiten: [{ ...d1.einheiten[0] }, { ...einheit, lage: 'OG' }], sanierungen: [],
    }, 'PUT');
    expect(r2.status).toBe(200);
    const d2 = await lies(app.request(`/api/deals/${id}`));
    expect(d2.einheiten.map((e: { id: string; lage: string }) => e.lage)).toEqual(['EG', 'OG']);
    expect(d2.einheiten[0].id).toBe(einheitId);
    expect(d2.sanierungen).toEqual([]);

    expect((await post(`/api/deals/${id}/kalkulation`, { version: 2, kalkulation: kalk, einheiten: [], sanierungen: [] }, 'PUT')).status).toBe(409);
  });

  it('ändert Info-Felder, legt Kommentare an und setzt „Erledigt“ nach Frequenz', async () => {
    const objekt = await lies(post('/api/objekte', { stadt: 'Infostadt' }));
    angelegt.objekte.push(objekt.id);
    const { id } = await lies(post('/api/deals', { objektId: objekt.id }));
    expect((await post(`/api/deals/${id}`, { version: 1, nachfassFrequenz: 'Monatlich', nextContact: '2020-01-01', prio: 'A' }, 'PATCH')).status).toBe(200);
    expect((await post(`/api/deals/${id}/kommentare`, { text: 'Besichtigung gut' })).status).toBe(201);
    const erledigt = await lies(post(`/api/deals/${id}/erledigt`, { version: 2 }));
    expect(erledigt.version).toBe(3);
    const d = await lies(app.request(`/api/deals/${id}`));
    expect(d).toMatchObject({ prio: 'A', nachfassFrequenz: 'Monatlich', lastContact: erledigt.lastContact, nextContact: erledigt.nextContact });
    expect(d.kommentare.map((k: { text: string }) => k.text)).toEqual(['Besichtigung gut']);
  });

  it('zeigt Makler mit Kommunikation und Deals, ändert Objekt mit Version', async () => {
    const makler = await lies(post('/api/makler', { name: 'Detail Makler' }));
    angelegt.makler.push(makler.id);
    expect((await post(`/api/makler/${makler.id}/kommunikation`, { kanal: 'anruf', richtung: 'ausgehend', text: 'Rückruf' })).status).toBe(201);
    const md = await lies(app.request(`/api/makler/${makler.id}`));
    expect(md.kommunikation).toMatchObject([{ kanal: 'anruf', text: 'Rückruf' }]);

    const objekt = await lies(post('/api/objekte', { stadt: 'Altstadt' }));
    angelegt.objekte.push(objekt.id);
    expect((await post(`/api/objekte/${objekt.id}`, { version: 1, baujahr: 1910, notizen: 'Denkmal' }, 'PATCH')).status).toBe(200);
    expect(await lies(app.request(`/api/objekte/${objekt.id}`))).toMatchObject({ baujahr: 1910, notizen: 'Denkmal', version: 2 });
    expect((await post(`/api/objekte/${objekt.id}`, { version: 1, baujahr: 1911 }, 'PATCH')).status).toBe(409);
    // geleerte Zahlenfelder (null) sind erlaubt
    expect((await post(`/api/objekte/${objekt.id}`, { version: 2, wohnflaeche: null, angebotspreis: null, einheitenAnzahl: null }, 'PATCH')).status).toBe(200);
  });

  it('Ankauf-Cockpit: fällige Deals und Makler, Erledigt, Anruf-Ergebnis, WhatsApp, Tageslog', async () => {
    const heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
    const plus = (t: number) => new Date(Date.parse(`${heute}T00:00:00Z`) + t * 86_400_000).toISOString().slice(0, 10);
    const kennung = `Cockpit ${Date.now()}`;

    const makler = await lies(post('/api/makler', { name: kennung, kontaktFrequenz: 'Monatlich' }));
    angelegt.makler.push(makler.id);
    expect((await post(`/api/makler/${makler.id}/termin`, { version: 1, nextContact: heute }, 'PUT')).status).toBe(200);
    const objekt = await lies(post('/api/objekte', { strasse: kennung, hausnr: '3' }));
    angelegt.objekte.push(objekt.id);
    const { id: dealId } = await lies(post('/api/deals', { objektId: objekt.id, maklerId: makler.id }));
    expect((await post(`/api/deals/${dealId}/termin`, { version: 1, nextContact: plus(-2) }, 'PUT')).status).toBe(200);

    const c1 = await lies(app.request('/api/ankauf'));
    expect(c1.deals.find((d: { id: string }) => d.id === dealId)).toMatchObject({ faellig: { klasse: 'ueberfaellig', label: '2T überfällig' }, makler: { name: kennung } });
    expect(c1.makler.find((m: { id: string }) => m.id === makler.id)).toMatchObject({ faellig: { klasse: 'heute' }, aktiveDeals: 1 });

    // Erledigt → Deal verschwindet aus dem Cockpit
    expect((await post(`/api/deals/${dealId}/erledigt`, { version: 2 })).status).toBe(200);
    const c2 = await lies(app.request('/api/ankauf'));
    expect(c2.deals.some((d: { id: string }) => d.id === dealId)).toBe(false);

    // Wählmaschine: Makler mit letztem Kontakt vor einem Monat steht in der Warteschlange
    const m2 = await lies(post('/api/makler', { name: `${kennung} WM`, kontaktFrequenz: 'Wöchentlich' }));
    angelegt.makler.push(m2.id);
    expect((await post(`/api/makler/${m2.id}`, { version: 1, lastContact: plus(-8) }, 'PATCH')).status).toBe(200);
    // Teiländerung darf Frequenz und Prio nicht auf Anlage-Standardwerte zurücksetzen
    expect(await lies(app.request(`/api/makler/${m2.id}`))).toMatchObject({ kontaktFrequenz: 'Wöchentlich', prio: 'B' });
    const queue = await lies(app.request('/api/ankauf/waehlmaschine'));
    const eintrag = queue.find((m: { id: string }) => m.id === m2.id);
    expect(eintrag).toMatchObject({ faellig: { klasse: 'ueberfaellig' } });

    const r = await lies(post(`/api/makler/${m2.id}/anruf-ergebnis`, { version: eintrag.version, ergebnis: 'rueckruf', notiz: 'ab 14 Uhr', frequenz: 'Monatlich', rueckrufDatum: plus(3) }));
    expect(r.nextContact).toBe(plus(3));
    const d2 = await lies(app.request(`/api/makler/${m2.id}`));
    expect(d2).toMatchObject({ kontaktFrequenz: 'Monatlich', lastContact: heute });
    const [y, mo, t] = heute.split('-').map(Number);
    expect(d2.kommunikation[0]).toMatchObject({ kanal: 'anruf', richtung: 'ausgehend', text: `[${t}.${mo}.${y} – Rückruf vereinbart] ab 14 Uhr` });

    expect((await post(`/api/makler/${m2.id}/whatsapp`, {})).status).toBe(200);
    const c3 = await lies(app.request('/api/ankauf'));
    expect(c3.tageslog.filter((e: { titel: string }) => e.titel.startsWith(`${kennung} WM`)).map((e: { kanal: string }) => e.kanal)).toEqual(['whatsapp', 'anruf']);

    // „Liste durchwählen“: das Anruf-Ergebnis wird am Deal gebucht — Frequenz, Kontakte, Notiz als Kommentar; der Makler bleibt unberührt
    const objekt2 = await lies(post('/api/objekte', { strasse: `${kennung} Wahl`, hausnr: '1' }));
    angelegt.objekte.push(objekt2.id);
    const { id: deal2 } = await lies(post('/api/deals', { objektId: objekt2.id, maklerId: m2.id }));
    expect((await post(`/api/deals/${deal2}/termin`, { version: 1, nextContact: heute }, 'PUT')).status).toBe(200);
    const maklerVorher = await lies(app.request(`/api/makler/${m2.id}`));
    const rd = await lies(post(`/api/deals/${deal2}/anruf-ergebnis`, { version: 2, ergebnis: 'erreicht', notiz: 'Preis verhandelbar', frequenz: 'Monatlich', rueckrufDatum: null }));
    expect(rd).toMatchObject({ id: deal2, version: 3, nextContact: plus(30) });
    const dd = await lies(app.request(`/api/deals/${deal2}`));
    expect(dd).toMatchObject({ nachfassFrequenz: 'Monatlich', lastContact: heute, nextContact: plus(30) });
    expect(dd.kommentare.map((k: { text: string }) => k.text)).toContain(`[${t}.${mo}.${y} – Erreicht] Preis verhandelbar`);
    expect(await lies(app.request(`/api/makler/${m2.id}`))).toMatchObject({ version: maklerVorher.version, lastContact: maklerVorher.lastContact, nextContact: maklerVorher.nextContact });
    expect((await post(`/api/deals/${deal2}/anruf-ergebnis`, { version: 2, ergebnis: 'nicht', notiz: '', frequenz: 'Monatlich', rueckrufDatum: null })).status).toBe(409);
    expect((await lies(app.request('/api/ankauf'))).deals.some((d: { id: string }) => d.id === deal2)).toBe(false);
  });

  it('Kundenkalkulation: Vorbelegung Aufteiler mit Stellplatz, Liste, Speichern mit Version, Kopie, Papierkorb', async () => {
    const objekt = await lies(post('/api/objekte', { strasse: 'KK-Weg', hausnr: '7', stadt: 'Kundenstadt' }));
    angelegt.objekte.push(objekt.id);
    const { id: dealId } = await lies(post('/api/deals', { objektId: objekt.id }));
    const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
    await post(`/api/deals/${dealId}/kalkulation`, {
      version: 1, kalkulation: { kaufpreis: 900_000 }, sanierungen: [],
      einheiten: [
        { ...leer, typ: 'Wohnung', lage: 'EG links', flaeche: 80, mieteIst: 800, renditeK: 4 },
        { ...leer, typ: 'Stellplatz', lage: 'TG-1', flaeche: null, mieteIst: 60, renditeK: 5, verkaufspreis: 25_000 },
      ],
    }, 'PUT');
    const deal = await lies(app.request(`/api/deals/${dealId}`));
    const [wohnung, stellplatz] = deal.einheiten;

    const einst = await lies(app.request('/api/einstellungen/kundenkalkulation'));
    await post('/api/einstellungen/kundenkalkulation', { ...einst, hinweise: ['Testhinweis'] }, 'PUT');

    const global = await lies(post(`/api/deals/${dealId}/kundenkalkulationen`, { scope: 'global' }));
    const auf = await lies(post(`/api/deals/${dealId}/kundenkalkulationen`, { scope: 'aufteiler', einheitId: wohnung.id, stellplatzIds: [stellplatz.id] }));
    // Wohnung: 800 × 12 / 4 % = 240.000; Stellplatz: manueller VKP 25.000
    expect(auf).toMatchObject({ name: 'Kalkulation EG links', kaufpreisWohnung: 240_000, kaufpreisStellplatz: 25_000, stellplaetzeAnzahl: 1, inputs: { kaufpreis: 265_000, nettokaltmieteMonat: 800 }, wertsteigerungBullets: ['Testhinweis'] });
    expect(global).toMatchObject({ scope: 'global', inputs: { kaufpreis: 265_000, nettokaltmieteMonat: 860 } });
    await post('/api/einstellungen/kundenkalkulation', einst, 'PUT');

    const liste = await lies(app.request(`/api/deals/${dealId}/kundenkalkulationen`));
    expect(liste.map((k: { scope: string; einheitLage: string | null }) => [k.scope, k.einheitLage])).toEqual([['global', null], ['aufteiler', 'EG links']]);

    const gespeichert = await lies(post(`/api/kundenkalkulationen/${auf.id}`, { ...auf, name: 'Wohnung EG', inputs: { ...auf.inputs, grenzsteuersatz: 0.3 } }, 'PUT'));
    expect(gespeichert).toMatchObject({ version: 2, name: 'Wohnung EG', inputs: { grenzsteuersatz: 0.3 } });
    expect((await post(`/api/kundenkalkulationen/${auf.id}`, { ...auf, name: 'veraltet' }, 'PUT')).status).toBe(409);

    // Bankgespräch-PDF: Ersteller + Disclaimer aus den Einstellungen, nur eingebettete Bilder, Audit-Eintrag
    const bild = 'data:image/png;base64,AAAA';
    await post(`/api/kundenkalkulationen/${auf.id}`, { ...gespeichert, bildRefs: [bild, 'photo:obj-x/foto-y', 'https://fremd.example/bild.jpg'] }, 'PUT');
    await post('/api/einstellungen/kundenkalkulation', { ...einst, ersteller: 'Gerry Test', disclaimer: 'Test-Hinweis' }, 'PUT');
    expect((await lies(app.request('/api/einstellungen/kundenkalkulation'))).ersteller).toBe('Gerry Test');
    const pdfAntwort = await app.request(`/api/kundenkalkulationen/${auf.id}/pdf`);
    expect(pdfAntwort.status).toBe(200);
    expect(pdfAntwort.headers.get('content-type')).toBe('application/pdf');
    expect(pdfAntwort.headers.get('content-disposition')).toBe('inline; filename="Wohnung_EG.pdf"');
    expect((await pdfAntwort.text()).startsWith('%PDF')).toBe(true);
    expect(gedruckt.at(-1)).toMatchObject({ kalkName: 'Wohnung EG', ersteller: 'Gerry Test', disclaimer: 'Test-Hinweis', impressionen: [bild, 'photo:obj-x/foto-y'] });
    await post('/api/einstellungen/kundenkalkulation', einst, 'PUT');
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, auf.id));
    expect(audit.map((a) => a.action)).toEqual(['pdf-export']);
    await db.delete(schema.auditLog).where(eq(schema.auditLog.entityId, auf.id));
    expect((await app.request('/api/kundenkalkulationen/gibt-es-nicht/pdf')).status).toBe(404);

    const kopie = await lies(post(`/api/kundenkalkulationen/${auf.id}/duplizieren`, {}));
    expect(kopie.name).toBe('Wohnung EG (Kopie)');
    expect((await app.request(`/api/kundenkalkulationen/${kopie.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/kundenkalkulationen/${kopie.id}`)).status).toBe(404);
    expect((await lies(app.request(`/api/deals/${dealId}/kundenkalkulationen`))).length).toBe(2);
    await db.delete(schema.kundenkalkulationen).where(eq(schema.kundenkalkulationen.dealId, dealId));
  });

  it('Objektfotos: hochladen (Signatur geprüft), ausliefern, sortieren, löschen', async () => {
    const objekt = await lies(post('/api/objekte', { strasse: 'Fotoweg', hausnr: '1', stadt: 'Bildstadt' }));
    angelegt.objekte.push(objekt.id);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const hoch = (bytes: Uint8Array, name: string, id = objekt.id) =>
      app.request(`/api/objekte/${id}/fotos`, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream', 'x-dateiname': encodeURIComponent(name) } });

    const a = await lies(hoch(png, 'Fassade Süd.png'));
    const b = await lies(hoch(jpg, 'Hof.jpg'));
    expect(a).toMatchObject({ dateiname: 'Fassade Süd.png', mimeType: 'image/png', sort: 0, ref: `photo:${objekt.id}/${a.id}` });
    expect(b.sort).toBe(1);
    expect(speicher.inhalt.has(`obj-photos/${objekt.id}/${a.id}.jpg`)).toBe(true); // Schlüssel wie alte App
    expect((await hoch(new TextEncoder().encode('%PDF-1.7'), 'x.pdf')).status).toBe(422);
    expect((await hoch(png, 'x.png', 'gibt-es-nicht')).status).toBe(404);

    const bild = await app.request(a.url);
    expect(bild.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await bild.arrayBuffer())).toEqual(png);
    expect((await app.request(`/api/photos/anderes-objekt/${a.id}`)).status).toBe(404);

    const sortiert = await lies(post(`/api/objekte/${objekt.id}/fotos/reihenfolge`, { ids: [b.id, a.id] }, 'PUT'));
    expect(sortiert.map((f: { id: string }) => f.id)).toEqual([b.id, a.id]);

    expect((await app.request(`/api/objekte/${objekt.id}/fotos/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(speicher.inhalt.has(`obj-photos/${objekt.id}/${a.id}.jpg`)).toBe(false);
    expect((await lies(app.request(`/api/objekte/${objekt.id}/fotos`))).map((f: { id: string }) => f.id)).toEqual([b.id]);
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.entityId, [a.id, b.id]));
  });

  it('Bank-Präsentation: Standard-Pitch anlegen, aus Deal vorbelegen, speichern mit Version, PDF/PowerPoint, Standards', async () => {
    const { computeDealKalkSummary } = await import('@gg/domain');
    const objekt = await lies(post('/api/objekte', { strasse: 'Praesweg', hausnr: '5', stadt: 'Bankstadt', baujahr: 1965 }));
    angelegt.objekte.push(objekt.id);
    const { id: dealId } = await lies(post('/api/deals', { objektId: objekt.id }));
    const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
    await post(`/api/deals/${dealId}/kalkulation`, {
      version: 1, kalkulation: { kaufpreis: 900_000, notar: 2, gest: 5, fk_p: 85, euribor: 3, margeB: 2, halt: 18 },
      sanierungen: [{ beschreibung: 'Dach', betrag: 40_000, bereich: 'both' }],
      einheiten: [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 80, mieteIst: 800, renditeK: 4 }, { ...leer, typ: 'Wohnung', lage: 'OG', flaeche: 60, mieteIst: 600, renditeK: 4 }],
    }, 'PUT');

    expect(await lies(app.request(`/api/deals/${dealId}/praesentation`))).toEqual({ praesentation: null });
    const p = await lies(post(`/api/deals/${dealId}/praesentation`, { vorlage: 'standard' }));
    expect(p.slides.map((x: { typ: string }) => x.typ)).toEqual(['deckblatt', 'objektbeschreibung', 'lagebeschreibung', 'projektbeschreibung', 'geschaeftsmodell', 'projektkalkulation', 'verkaufspreise', 'mietenaufstellung', 'finanzierungsstruktur', 'grundrisse', 'impressionen', 'organigramm', 'abschluss']);
    expect(p.slides[4].data.zielgruppe).toContain('Private Banking');
    expect((await post(`/api/deals/${dealId}/praesentation`, { vorlage: 'leer' })).status).toBe(409);

    const kalk = await lies(post(`/api/praesentationen/${p.id}/vorbelegen`, { art: 'projektkalkulation', data: {}, scope: 'aufteiler' }));
    const erwartet = computeDealKalkSummary({
      kalk: { kaufpreis: 900_000, notar: 2, gest: 5, fk_p: 85, euribor: 3, margeB: 2, halt: 18 },
      einheiten: [{ typ: 'Wohnung', lage: 'EG', fl: 80, mi_ist: 800, rend_k: 4, mi_neu_manual: false }, { typ: 'Wohnung', lage: 'OG', fl: 60, mi_ist: 600, rend_k: 4, mi_neu_manual: false }],
      sanierung: [{ desc: 'Dach', amt: 40_000, scope: 'both' }],
    }, 'aufteiler')!;
    expect(kalk.data.tableRows).toEqual(erwartet.rows);
    const deckblatt = await lies(post(`/api/praesentationen/${p.id}/vorbelegen`, { art: 'deckblatt', data: {} }));
    expect(deckblatt.data).toEqual({ titel: 'ANKAUF Wohnobjekt', untertitel: 'in Bankstadt, Praesweg 5' });
    const miete = await lies(post(`/api/praesentationen/${p.id}/vorbelegen`, { art: 'mietenaufstellung', data: {}, spalten: [] }));
    expect(miete).toEqual({ data: null, hinweis: 'Keine Einheiten im Deal oder keine Spalte gewählt' });

    const slides = p.slides.map((x: { typ: string; data: object }) => (x.typ === 'projektkalkulation' ? { ...x, data: kalk.data } : x.typ === 'deckblatt' ? { ...x, data: { ...deckblatt.data, bilder: ['photo:o/f'] } } : x));
    const gespeichert = await lies(post(`/api/praesentationen/${p.id}`, { bankName: 'Sparkasse Test', internNotiz: '', slides, version: p.version }, 'PUT'));
    expect(gespeichert).toMatchObject({ version: p.version + 1, bankName: 'Sparkasse Test' });
    expect(gespeichert.slides[5].data._snapshot.gik).toBe(erwartet.gik);
    expect((await post(`/api/praesentationen/${p.id}`, { bankName: 'alt', internNotiz: '', slides, version: p.version }, 'PUT')).status).toBe(409);

    // Standards: eigener Organigramm-Text greift beim Export für die leere Organigramm-Folie
    const std = await lies(app.request('/api/einstellungen/praesentation'));
    expect(std.abschluss.bild).toBe('standardbild:abschluss');
    await post('/api/einstellungen/praesentation', { ...std, organigramm: { ...std.organigramm, beschreibung: 'Konzern 2026' } }, 'PUT');
    const pdfAntwort = await app.request(`/api/praesentationen/${p.id}/pdf`);
    expect(pdfAntwort.status).toBe(200);
    expect(pdfAntwort.headers.get('content-disposition')).toBe('inline; filename="Sparkasse_Test.pdf"');
    const gedruckt = praesGedruckt.at(-1)!;
    expect(gedruckt.slides.find((x) => x.typ === 'organigramm')!.data).toMatchObject({ bild: 'standardbild:organigramm', beschreibung: 'Konzern 2026' });
    await post('/api/einstellungen/praesentation', std, 'PUT');

    const pptx = await app.request(`/api/praesentationen/${p.id}/pptx`);
    expect(pptx.headers.get('content-disposition')).toBe('attachment; filename="Sparkasse_Test.pptx"');
    expect(Buffer.from(await pptx.arrayBuffer()).subarray(0, 2).toString('latin1')).toBe('PK');
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, p.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['pdf-export', 'pptx-export']);
    await db.delete(schema.auditLog).where(eq(schema.auditLog.entityId, p.id));

    expect((await post(`/api/praesentationen/${p.id}`, { bankName: '', internNotiz: '', slides: slides.map((x: object) => ({ ...x, visible: false })), version: gespeichert.version }, 'PUT')).status).toBe(200);
    expect((await app.request(`/api/praesentationen/${p.id}/pdf`)).status).toBe(422);
    expect((await app.request(`/api/praesentationen/${p.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await lies(app.request(`/api/deals/${dealId}/praesentation`))).toEqual({ praesentation: null });
    await db.delete(schema.finanzpraesentationen).where(eq(schema.finanzpraesentationen.dealId, dealId));
  });

  it('Begleitschein: aus der Vorlage anlegen, Status mit Archiv, Aktionen (Daten, Vordruck), Vorlage mit Aufräumen', async () => {
    const vorherVorlage = await lies(app.request('/api/einstellungen/begleitscheine/ankauf/vorlage'));
    const vorherAktionen = await lies(app.request('/api/einstellungen/begleitscheine/ankauf/aktionen'));
    const vorherVordrucke = await lies(app.request('/api/einstellungen/vordrucke'));
    try {
      const objekt = await lies(post('/api/objekte', { strasse: 'Poststraße', hausnr: '57', plz: '71032', stadt: 'Böblingen' }));
      angelegt.objekte.push(objekt.id);
      const { id: dealId } = await lies(post('/api/deals', { objektId: objekt.id }));
      await post(`/api/deals/${dealId}/kalkulation`, { version: 1, kalkulation: { kaufpreis: 900_000, notar: 2 }, sanierungen: [], einheiten: [] }, 'PUT');

      expect((await post('/api/begleitscheine', { typ: 'ankauf', objektId: objekt.id, name: '  ' })).status).toBe(400);
      const bs = await lies(post('/api/begleitscheine', { typ: 'ankauf', objektId: objekt.id, name: 'IVT Wohnen', whgNr: '02' }));
      expect(bs).toMatchObject({ name: 'Poststraße_57_Böblingen_Ankauf_IVT Wohnen', whgNr: null, dealId, adresse: 'Poststraße 57, 71032 Böblingen', kopf: vorherVorlage.kopf });
      expect(bs.rows).toHaveLength(vorherVorlage.rows.length);
      expect(bs.rows.every((r: { status: string }) => r.status === 'offen')).toBe(true);

      // Abschlusspunkt erledigt → archiviert, zurück → nicht mehr
      const mit = (status: string) => bs.rows.map((r: { id: string }) => (r.id === 'bs-final' ? { ...r, status } : r));
      const archiviert = await lies(post(`/api/begleitscheine/${bs.id}`, { kopf: bs.kopf, rows: mit('erledigt'), version: bs.version }, 'PUT'));
      expect(archiviert.archiviertAm).not.toBeNull();
      expect((await lies(app.request('/api/begleitscheine'))).find((b: { id: string }) => b.id === bs.id)).toMatchObject({ archiviertAm: archiviert.archiviertAm, zaehler: { erledigt: 1 } });
      const offen = await lies(post(`/api/begleitscheine/${bs.id}`, { kopf: bs.kopf, rows: mit('offen'), version: archiviert.version }, 'PUT'));
      expect(offen.archiviertAm).toBeNull();
      expect((await post(`/api/begleitscheine/${bs.id}`, { kopf: '', rows: bs.rows, version: bs.version }, 'PUT')).status).toBe(409);

      // Aktion „Daten anzeigen“ liest die Projektkalkulation des Deals
      const budget = bs.aktionen.find((a: { typ: string; datenQuelle?: string }) => a.typ === 'daten' && a.datenQuelle === 'kalkulation');
      const daten = await lies(post(`/api/begleitscheine/${bs.id}/aktionen/${budget.id}`, {}));
      expect(daten.art).toBe('anzeige');
      expect(daten.tabelle).toContainEqual(['Kaufpreis', '900.000 €']);

      // Vordruck anlegen, einer Aktion zuordnen, ausführen → Entwurf mit Platzhaltern
      const vd = await lies(post('/api/einstellungen/vordrucke', [...vorherVordrucke, { id: 'test-vd', nummer: 'F999', titel: 'Test', art: 'brief', inhalt: 'Objekt {adresse}, {datum}', aktiv: true }], 'PUT'));
      expect(vd.find((v: { id: string }) => v.id === 'test-vd').verwendung).toBe(0);
      const brief = bs.aktionen.find((a: { typ: string }) => a.typ === 'vordruck-brief');
      await post('/api/einstellungen/begleitscheine/ankauf/aktionen', vorherAktionen.map((a: { id: string }) => (a.id === brief.id ? { ...a, vordruckId: 'test-vd' } : a)), 'PUT');
      const entwurf = await lies(post(`/api/begleitscheine/${bs.id}/aktionen/${brief.id}`, {}));
      expect(entwurf).toMatchObject({ art: 'anzeige', titel: 'F999 — Test' });
      expect(entwurf.text).toMatch(/^Objekt Poststraße 57, 71032 Böblingen, \d{1,2}\.\d{1,2}\.\d{4}$/);
      expect((await lies(app.request('/api/einstellungen/vordrucke'))).find((v: { id: string }) => v.id === 'test-vd').verwendung).toBe(1);

      // Punkt aus der Vorlage löschen → seine Aktionen fallen weg; Zurücksetzen stellt die Punkte wieder her
      const ohne = vorherVorlage.rows.filter((r: { id: string }) => r.id !== brief.rowId);
      const gespeichert = await lies(post('/api/einstellungen/begleitscheine/ankauf/vorlage', { kopf: 'Neu', rows: ohne }, 'PUT'));
      expect(gespeichert.entfernteAktionen).toBeGreaterThan(0);
      expect((await lies(app.request('/api/einstellungen/begleitscheine/ankauf/aktionen'))).some((a: { rowId: string }) => a.rowId === brief.rowId)).toBe(false);
      expect((await lies(app.request(`/api/begleitscheine/${bs.id}`))).rows).toHaveLength(vorherVorlage.rows.length); // bestehende bleiben
      const zurueck = await lies(post('/api/einstellungen/begleitscheine/ankauf/vorlage/zuruecksetzen', {}));
      expect(zurueck.vorlage.rows.some((r: { id: string }) => r.id === brief.rowId)).toBe(true);

      expect((await app.request(`/api/begleitscheine/${bs.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await app.request(`/api/begleitscheine/${bs.id}`)).status).toBe(404);
      await db.delete(schema.begleitscheine).where(eq(schema.begleitscheine.objektId, objekt.id));
    } finally {
      await post('/api/einstellungen/begleitscheine/ankauf/vorlage', { kopf: vorherVorlage.kopf, rows: vorherVorlage.rows }, 'PUT');
      await post('/api/einstellungen/vordrucke', vorherVordrucke, 'PUT');
      await post('/api/einstellungen/begleitscheine/ankauf/aktionen', vorherAktionen, 'PUT');
    }
  });

  it('Vertriebsliste: nur angekauft, einmal je Deal, Zeilen aus Einheiten, GIK Aufteiler, Speichern mit Version', async () => {
    const { computeDealKalkSummary } = await import('@gg/domain');
    const objekt = await lies(post('/api/objekte', { strasse: 'Vertriebsstraße', hausnr: '7', stadt: 'Leipzig' }));
    angelegt.objekte.push(objekt.id);
    const deal = await lies(post('/api/deals', { objektId: objekt.id }));
    const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
    const kalkAntwort = await post(`/api/deals/${deal.id}/kalkulation`, {
      version: 1, kalkulation: { kaufpreis: 500_000, notar: 2, gest: 5, makler: 0 }, sanierungen: [],
      einheiten: [
        { ...leer, typ: 'Wohnung', lage: 'EG links', flaeche: 60, zimmer: 2, mieteIst: 600, mieteNeu: 750, renditeK: null, verkaufspreis: 400_000 },
        { ...leer, typ: 'Stellplatz', lage: 'TG-01', flaeche: null, mieteIst: 45, renditeK: null, verkaufspreis: 18_000 },
      ],
    }, 'PUT');
    expect(kalkAntwort.status, await kalkAntwort.clone().text()).toBe(200);
    expect((await post(`/api/deals/${deal.id}/vertriebsliste`, {})).status).toBe(422);
    const d = await lies(app.request(`/api/deals/${deal.id}`));
    await post(`/api/deals/${deal.id}/status`, { status: 'Angekauft', version: d.version }, 'PATCH');

    const vl = await lies(post(`/api/deals/${deal.id}/vertriebsliste`, {}));
    expect(vl.dealGik).toBe(computeDealKalkSummary({ kalk: { kaufpreis: 500_000, notar: 2, gest: 5, makler: 0 }, einheiten: [], sanierung: [] }, 'aufteiler')!.gik);
    expect(vl.dealGik).toBe(535_000);
    expect(vl.zeilen.map((z: { istStellplatz: boolean; daten: object }) => [z.istStellplatz, z.daten])).toEqual([
      [false, { lage: 'EG links', wohnflaeche: 60, zi: 2, kaltmiete_ist: 600, kaltmiete_soll: 750, grundpreis_whg: 400_000, verkaufspreis: 400_000, vermietet_status: 'Vermietet' }],
      [true, { te_nr_garage: 'TG-01', kaltmiete_stp: 45, grundpreis_stp: 18_000 }],
    ]);
    expect(vl.spalten).toHaveLength(39);
    expect(vl.provision).toBe(7.14);
    expect((await post(`/api/deals/${deal.id}/vertriebsliste`, {})).status).toBe(409);
    const uebersicht = await lies(app.request('/api/vertriebslisten'));
    expect(uebersicht.find((e: { dealId: string }) => e.dealId === deal.id)).toMatchObject({ adresse: 'Vertriebsstraße 7', stadt: 'Leipzig', einheiten: 2, liste: { id: vl.id, zeilen: 2 } });

    const zeilen = [...vl.zeilen, { id: 'neu-1', einheitId: null, istStellplatz: false, daten: { lage: 'DG' } }];
    const gespeichert = await lies(post(`/api/vertriebslisten/${vl.id}`, { versteckteSpalten: ['garten'], zeilen, version: vl.version }, 'PUT'));
    expect(gespeichert).toMatchObject({ version: vl.version + 1, versteckteSpalten: ['garten'] });
    expect(gespeichert.zeilen).toHaveLength(3);
    expect((await post(`/api/vertriebslisten/${vl.id}`, { versteckteSpalten: [], zeilen, version: vl.version }, 'PUT')).status).toBe(409);
    expect((await app.request(`/api/vertriebslisten/${vl.id}`, { method: 'DELETE' })).status).toBe(200);
    await db.delete(schema.vertriebslisten).where(eq(schema.vertriebslisten.dealId, deal.id));
  });

  it('Projekt: Auswahl nur angekaufter Deals, Anlegen mit Einheiten/Checkliste/Ziel-VKP, Speichern mit Version, Papierkorb', async () => {
    const { KALK_STANDARD, PM_TODO_TEMPLATE, pmZielVKPAusDeal } = await import('@gg/domain');
    const objekt = await lies(post('/api/objekte', { strasse: 'Projektweg', hausnr: '3', stadt: 'Ulm' }));
    angelegt.objekte.push(objekt.id);
    const deal = await lies(post('/api/deals', { objektId: objekt.id }));
    const kalk = { kaufpreis: 1_000_000, notar: 2, gest: 5, makler: 4.76, glo_m: 15 };
    const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
    await post(`/api/deals/${deal.id}/kalkulation`, {
      version: 1, kalkulation: kalk, sanierungen: [{ beschreibung: 'Dach', betrag: 100_000, bereich: 'both' }],
      einheiten: [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 70, zimmer: 3, mieteIst: 1000, mieteNeu: 1200, mieteNeuManuell: true, renditeK: 4.5 }],
    }, 'PUT');
    const vorher = await lies(app.request('/api/projekte/deal-auswahl'));
    expect(vorher.some((d: { id: string }) => d.id === deal.id)).toBe(false);
    expect((await post('/api/projekte', { dealId: deal.id, adresse: 'X', stadt: '', datum: '2026-09-17' })).status).toBe(422);
    const d = await lies(app.request(`/api/deals/${deal.id}`));
    await post(`/api/deals/${deal.id}/status`, { status: 'Angekauft', version: d.version }, 'PATCH');
    expect((await lies(app.request('/api/projekte/deal-auswahl'))).find((x: { id: string }) => x.id === deal.id)).toMatchObject({ adresse: 'Projektweg', stadt: 'Ulm' });
    expect((await post('/api/projekte', { dealId: null, adresse: '   ', stadt: '', datum: '' })).status).toBe(422);

    const p = await lies(post('/api/projekte', { dealId: deal.id, adresse: ' Projektweg 3 ', stadt: 'Ulm', datum: '2026-09-17' }));
    expect(p).toMatchObject({ adresse: 'Projektweg 3', dealId: deal.id, globalVstatus: 'none', version: 1 });
    expect(p.todos).toHaveLength(PM_TODO_TEMPLATE.reduce((a, k) => a + k.items.length, 0));
    expect(p.einheiten).toMatchObject([{ typ: 'Wohnung', lage: 'EG', zimmer: 3, fl: 70, kaltmiete: 1000, kmMoeglich: 1200, zielKP: 320_000, vstatus: 'none', istKP: 0 }]);
    const dealAlt = { kalk, einheiten: [{ mi_ist: 1000 }], sanierung: [{ amt: 100_000, scope: 'both' }] };
    expect(p.zielVKP).toBe(pmZielVKPAusDeal(dealAlt, KALK_STANDARD));
    expect((await lies(app.request('/api/projekte/deal-auswahl'))).some((x: { id: string }) => x.id === deal.id)).toBe(false);

    const { id: _i, dealId: _d, version, updatedAt: _u, ...inhalt } = p;
    const einheit = { ...p.einheiten[0], vstatus: 'sold', istKP: 350_000, mieterHistorie: [{ id: 'h1', datum: '2026-09-10', inhalt: 'Gespräch', ergebnis: '' }] };
    const gespeichert = await lies(post(`/api/projekte/${p.id}`, { ...inhalt, version, globalIstKP: 0, einheiten: [einheit], todos: p.todos.slice(1), gebPIP: [{ id: 'm1', text: 'Fassade', status: 'offen', verantw: '' }] }, 'PUT'));
    expect(gespeichert).toMatchObject({ version: 2, gebPIP: [{ text: 'Fassade' }] });
    expect(gespeichert.einheiten[0]).toMatchObject({ vstatus: 'sold', istKP: 350_000, mieterHistorie: [{ id: 'h1', datum: '2026-09-10' }] });
    expect(gespeichert.todos).toHaveLength(p.todos.length - 1);
    expect((await post(`/api/projekte/${p.id}`, { ...inhalt, version }, 'PUT')).status).toBe(409);
    expect((await lies(app.request('/api/projekte'))).some((x: { id: string }) => x.id === p.id)).toBe(true);
    expect((await app.request(`/api/projekte/${p.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await lies(app.request('/api/projekte'))).some((x: { id: string }) => x.id === p.id)).toBe(false);
    expect((await lies(app.request('/api/projekte/deal-auswahl'))).some((x: { id: string }) => x.id === deal.id)).toBe(true);
    await db.delete(schema.projekte).where(eq(schema.projekte.dealId, deal.id));
  });

  it('Listen im Altformat und gespeicherte Filter: Vorlagen einmal, anlegen, umbenennen, löschen', async () => {
    const { applyFilter } = await import('@gg/domain');
    const objekt = await lies(post('/api/objekte', { strasse: 'Filterweg', hausnr: '2', stadt: 'Ulm', angebotspreis: 2_500_000 }));
    angelegt.objekte.push(objekt.id);
    const makler = await lies(post('/api/makler', { name: 'Filter Frieda', tel: '+49 1', prio: 'A' }));
    const deal = await lies(post('/api/deals', { objektId: objekt.id, maklerId: makler.id }));
    const listen = await lies(app.request('/api/listen'));
    const d = listen.deals.find((x: { id: string }) => x.id === deal.id);
    expect(d).toMatchObject({ adresse: 'Filterweg', hausnr: '2', stadt: 'Ulm', maklerName: 'Filter Frieda', maklerTel: '+49 1', status: 'In Prüfung', objId: objekt.id });
    expect(listen.makler.find((x: { id: string }) => x.id === makler.id)).toMatchObject({ prio: 'A', tel: '+49 1', kontaktFreq: 'Monatlich' });
    expect('email' in listen.makler.find((x: { id: string }) => x.id === makler.id)).toBe(false);
    expect(listen.deals[0].id).toBe(deal.id); // neu angelegt = vorn, wie alt (unshift)

    const vorher = (await lies(app.request('/api/filter'))).length;
    const nachVorlagen = await lies(post('/api/filter/vorlagen/makler', {}));
    const zweimal = await lies(post('/api/filter/vorlagen/makler', {}));
    expect(zweimal.length).toBe(nachVorlagen.length);
    expect(nachVorlagen.filter((f: { module: string }) => f.module === 'makler').map((f: { name: string }) => f.name)).toEqual(expect.arrayContaining(['⭐ A-Makler mit Telefon', '📭 Ohne E-Mail-Adresse']));
    const aMitTel = nachVorlagen.find((f: { name: string }) => f.name === '⭐ A-Makler mit Telefon');
    expect(applyFilter(listen.makler as { id: string }[], aMitTel).some((m) => m.id === makler.id)).toBe(true);

    expect((await post('/api/filter', { module: 'deals', name: ' ', criteria: [] })).status).toBe(400);
    const f = await lies(post('/api/filter', { module: 'deals', name: ' Filterweg ', criteria: [{ field: 'adresse', op: 'contains', value: 'filterweg' }] }));
    expect(f).toMatchObject({ name: 'Filterweg', module: 'deals' });
    expect(applyFilter(listen.deals as { id: string }[], f).map((x) => x.id)).toEqual([deal.id]);
    expect(await lies(post(`/api/filter/${f.id}`, { name: 'Umbenannt' }, 'PUT'))).toMatchObject({ name: 'Umbenannt', criteria: f.criteria });
    expect((await app.request(`/api/filter/${f.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/filter/${f.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await lies(app.request('/api/filter'))).length).toBe(Math.max(vorher, nachVorlagen.length));
    await db.delete(schema.deals).where(eq(schema.deals.id, deal.id));
    await db.delete(schema.makler).where(eq(schema.makler.id, makler.id));
  });

  it('Deal: Anlage mit Angebotsdatum und Vorbelegung aus dem Objekt, Objektwechsel, Dokumente (Signaturprüfung, Bezeichnung, Löschen), Papierkorb', async () => {
    const o1 = await lies(post('/api/objekte', { strasse: 'Vorbelegweg', hausnr: '1', angebotspreis: 900_000, wohnflaeche: 300 }));
    const o2 = await lies(post('/api/objekte', { strasse: 'Wechselweg', hausnr: '2', angebotspreis: 1_500_000 }));
    angelegt.objekte.push(o1.id, o2.id);
    const d = await lies(post('/api/deals', { objektId: o1.id }));
    let deal = await lies(app.request(`/api/deals/${d.id}`));
    expect(deal.angebotsDatum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(deal.kalkulation).toMatchObject({ kaufpreis: 900_000, wohnflaeche: 300 });

    expect(await lies(post(`/api/deals/${d.id}/objekt`, { objektId: o2.id, version: deal.version }, 'PATCH'))).toMatchObject({ version: deal.version + 1 });
    deal = await lies(app.request(`/api/deals/${d.id}`));
    expect(deal.objekt.id).toBe(o2.id);
    expect(deal.kalkulation).toMatchObject({ kaufpreis: 1_500_000, wohnflaeche: 0 });

    const form = (dateien: [string, string, Uint8Array][]) => {
      const f = new FormData();
      for (const [name, typ, bytes] of dateien) f.append('dateien', new File([bytes], name, { type: typ }));
      return app.request(`/api/deals/${d.id}/dokumente`, { method: 'POST', body: f });
    };
    const pdf = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(100));
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0x41)]);
    const abgelehnt = await form([['ok.pdf', 'application/pdf', pdf], ['archiv.pdf', 'application/pdf', zip]]);
    expect(abgelehnt.status).toBe(415);
    expect((await lies(app.request(`/api/deals/${d.id}/dokumente`))).length).toBe(0); // ganzer Stapel abgelehnt

    const hoch = await form([['Exposé Wechselweg.pdf', 'application/octet-stream', pdf]]);
    expect(hoch.status).toBe(201);
    const dok = ((await hoch.json()) as { id: string }[])[0]!;
    expect(dok).toMatchObject({ dateiname: 'Exposé Wechselweg.pdf', mimeType: 'application/pdf', groesseBytes: pdf.byteLength });
    const datei = await app.request(`/api/deals/${d.id}/dokumente/${dok.id}/datei`);
    expect(datei.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(new Uint8Array(await datei.arrayBuffer())).toEqual(pdf);
    expect((await lies(app.request('/api/listen'))).exposeIds[d.id]).toBe(dok.id);
    await post(`/api/deals/${d.id}/dokumente/${dok.id}`, { label: 'Exposé' }, 'PATCH');
    expect((await lies(app.request(`/api/deals/${d.id}/dokumente`)))[0].label).toBe('Exposé');
    expect((await app.request(`/api/deals/${d.id}/dokumente/${dok.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/deals/${d.id}/dokumente/${dok.id}/datei`)).status).toBe(404);

    // Direkt-Upload: Ticket → der „Browser" legt die Datei in den Eingang → Übernahme prüft die liegende Datei
    const hochladen = async (bytes: Uint8Array) => {
      const t = await lies(post('/api/upload/ticket', { zweck: 'dokument', groesse: bytes.byteLength }));
      expect(t.key).toMatch(/^_eingang\/[0-9a-f-]{36}$/);
      await speicher.ablegen('deal-docs', t.key, bytes, 'application/octet-stream');
      return t.key as string;
    };
    const uebernehmen = (dateien: { key: string; name: string; typ: string }[]) => post(`/api/deals/${d.id}/dokumente/uebernehmen`, { dateien });
    const gross = new Uint8Array(6 * 1024 * 1024).fill(0x20); // größer als die 4,5 MB, die eine Function annimmt
    gross.set(pdf);
    const schluesselGross = await hochladen(gross);
    const direkt = await uebernehmen([{ key: schluesselGross, name: 'Scan groß.pdf', typ: 'application/octet-stream' }]);
    expect(direkt.status).toBe(201);
    const dokDirekt = ((await direkt.json()) as { id: string }[])[0]!;
    expect(dokDirekt).toMatchObject({ dateiname: 'Scan groß.pdf', mimeType: 'application/pdf', groesseBytes: gross.byteLength });
    expect(speicher.inhalt.has(`deal-docs/${schluesselGross}`)).toBe(false); // verschoben, nicht kopiert
    expect((await app.request(`/api/deals/${d.id}/dokumente/${dokDirekt.id}/datei`)).status).toBe(200);

    // Ein Archiv, das sich als PDF ausgibt: ganzer Stapel abgelehnt, Eingang geleert, nichts eingetragen
    const [kOk, kZip] = [await hochladen(pdf), await hochladen(zip)];
    expect((await uebernehmen([{ key: kOk, name: 'ok.pdf', typ: 'application/pdf' }, { key: kZip, name: 'archiv.pdf', typ: 'application/pdf' }])).status).toBe(415);
    expect(speicher.inhalt.has(`deal-docs/${kOk}`) || speicher.inhalt.has(`deal-docs/${kZip}`)).toBe(false);
    expect((await lies(app.request(`/api/deals/${d.id}/dokumente`))).length).toBe(1);

    // Der Schlüssel kommt vom Server: ein fremdes Dokument des Buckets lässt sich nicht „übernehmen"
    const fremd = (await lies(app.request(`/api/deals/${d.id}/dokumente`)))[0];
    expect((await uebernehmen([{ key: `${d.id}/${fremd.id}_Scan gro_.pdf`, name: 'x.pdf', typ: 'application/pdf' }])).status).toBe(400);
    expect((await uebernehmen([{ key: '_eingang/00000000-0000-4000-8000-000000000000', name: 'fehlt.pdf', typ: 'application/pdf' }])).status).toBe(404);
    expect((await post('/api/upload/ticket', { zweck: 'dokument', groesse: 201 * 1024 * 1024 })).status).toBe(413);
    expect((await post('/api/upload/ticket', { zweck: 'irgendwas' })).status).toBe(400);

    expect((await app.request(`/api/deals/${d.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/deals/${d.id}`)).status).toBe(404);
    expect((await lies(app.request('/api/listen'))).deals.some((x: { id: string }) => x.id === d.id)).toBe(false);
  });

  it('Kalkulation: Varianten speichern/laden/löschen, Einheiten aus Mieterliste-PDF (KI-Attrappe)', async () => {
    const o = await lies(post('/api/objekte', { strasse: 'Variantenweg', hausnr: '3' }));
    angelegt.objekte.push(o.id);
    const d = await lies(post('/api/deals', { objektId: o.id }));
    const einheit = { typ: 'Wohnung', lage: 'EG', zimmer: 2, flaeche: 60, mieteIst: 500, mieteNeu: 550, mieteNeuManuell: true, renditeK: 4.5, verkaufspreis: null, stueck: null };
    const a = await lies(post(`/api/deals/${d.id}/varianten`, { name: ' Erstangebot ', kalkulation: { kaufpreis: 800_000 }, einheiten: [einheit], sanierungen: [{ beschreibung: 'Dach', betrag: 30_000, bereich: 'auf' }] }));
    expect(a.anzahl).toBe(1);
    expect(a.variante).toMatchObject({ name: 'Erstangebot', kalkulation: { kaufpreis: 800_000 }, einheiten: [{ ...einheit, stueck: 1 }], sanierungen: [{ beschreibung: 'Dach', betrag: 30_000, bereich: 'auf' }] });
    const [roh] = await db.select().from(schema.dealKalkVarianten).where(eq(schema.dealKalkVarianten.id, a.variante.id));
    expect(roh!.einheiten).toEqual([{ typ: 'Wohnung', lage: 'EG', zimmer: 2, fl: 60, mi_ist: 500, mi_neu: 550, mi_neu_manual: true, rend_k: 4.5, stk: 1 }]);
    const b = await lies(post(`/api/deals/${d.id}/varianten`, { name: 'Zweitangebot', kalkulation: {}, einheiten: [], sanierungen: [] }));
    expect(b.anzahl).toBe(2);
    expect((await lies(app.request(`/api/deals/${d.id}/varianten`))).map((v: { name: string }) => v.name)).toEqual(['Zweitangebot', 'Erstangebot']);
    expect((await app.request(`/api/deals/${d.id}/varianten/${a.variante.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/deals/${d.id}/varianten/${a.variante.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await lies(app.request(`/api/deals/${d.id}/varianten`))).length).toBe(1);
    // IDs nur für Einheiten dieses Deals (sonst würde Speichern eine fremde Zeile übernehmen)
    const dd = await lies(app.request(`/api/deals/${d.id}`));
    await post(`/api/deals/${d.id}/kalkulation`, { version: dd.version, kalkulation: {}, einheiten: [einheit], sanierungen: [] }, 'PUT');
    const eigeneId = (await lies(app.request(`/api/deals/${d.id}`))).einheiten[0].id;
    const c = await lies(post(`/api/deals/${d.id}/varianten`, { name: 'Mit IDs', kalkulation: {}, einheiten: [{ ...einheit, id: eigeneId }, { ...einheit, id: 'fremd:1' }], sanierungen: [] }));
    expect(c.variante.einheiten.map((e: { id?: string }) => e.id)).toEqual([eigeneId, undefined]);

    const hoch = (name: string, bytes: Uint8Array) => { const f = new FormData(); f.append('file', new File([bytes], name, { type: 'application/pdf' })); return app.request(`/api/deals/${d.id}/einheiten-aus-pdf`, { method: 'POST', body: f }); };
    expect((await hoch('bild.pdf', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]))).status).toBe(415);
    const { pdfAusZeilen } = await import('@gg/integrations');
    const r = await hoch('Mieterliste.pdf', pdfAusZeilen(['Mieterliste', 'Einheit: Wohnung | EG li. | 3 | 78,5 | 780', 'Einheit: Stellplatz | TG | | | 50']));
    expect(r.status).toBe(200);
    const e = await r.json() as { docId: string; einheiten: unknown[]; pages: number };
    expect(e.pages).toBe(1);
    expect(e.einheiten).toEqual([{ typ: 'Wohnung', lage: 'EG li.', zimmer: 3, flaeche: 78.5, kaltmiete: 780 }, { typ: 'Stellplatz', lage: 'TG', zimmer: null, flaeche: null, kaltmiete: 50 }]);
    const docs = await lies(app.request(`/api/deals/${d.id}/dokumente`));
    expect(docs).toMatchObject([{ id: e.docId, label: 'Mieterliste (für Einheiten-Extraktion)', dateiname: 'Mieterliste.pdf' }]);
  });

  it('Objekt: alle Felder ändern, Einheiten speichern (IDs bleiben), Status, Papierkorb', async () => {
    const o = await lies(post('/api/objekte', { strasse: 'Objektweg', hausnr: '9' }));
    angelegt.objekte.push(o.id);
    const einheit = { typ: 'Wohnung', lage: 'EG', zimmer: 3, stueck: null, flaeche: 80, kaltmiete: 800, vermietung: 'Vermietet' };
    const g1 = await lies(post(`/api/objekte/${o.id}`, {
      version: o.version, plz: '70173', stadt: 'Stuttgart', bundesland: 'BW', baujahr: 1965, einheitenAnzahl: 2, wohnflaeche: 160, grundstueck: 400,
      energieklasse: 'C', heizung: 'Gas-Zentralheizung', angebotspreis: 900_000, zielpreis: 850_000, istMiete: 1600, sollMiete: 1900, status: 'Closing Path',
      notizen: 'Dach neu', einheiten: [einheit, { ...einheit, lage: 'OG', kaltmiete: 850 }],
    }, 'PATCH'));
    expect(g1.version).toBe(o.version + 1);
    let detail = await lies(app.request(`/api/objekte/${o.id}`));
    expect(detail).toMatchObject({ plz: '70173', bundesland: 'BW', baujahr: 1965, energieklasse: 'C', zielpreis: 850_000, sollMiete: 1900, status: 'Closing Path', notizen: 'Dach neu' });
    expect(detail.einheiten.map((e: { lage: string }) => e.lage)).toEqual(['EG', 'OG']);
    const ids = detail.einheiten.map((e: { id: string }) => e.id);

    // Zweite Einheit ersetzen: die erste behält ihre ID, die entfernte verschwindet
    await post(`/api/objekte/${o.id}`, { version: detail.version, einheiten: [{ ...einheit, id: ids[0], kaltmiete: 900 }, { typ: 'Stellplatz', lage: 'TG', zimmer: null, stueck: 4, flaeche: null, kaltmiete: 160, vermietung: 'Leerstand' }] }, 'PATCH');
    detail = await lies(app.request(`/api/objekte/${o.id}`));
    expect(detail.einheiten.map((e: { id: string }) => e.id)[0]).toBe(ids[0]);
    expect(detail.einheiten.map((e: { lage: string; kaltmiete: number }) => [e.lage, e.kaltmiete])).toEqual([['EG', 900], ['TG', 160]]);

    expect((await app.request(`/api/objekte/${o.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/objekte/${o.id}`)).status).toBe(404);
    expect((await app.request(`/api/objekte/${o.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await lies(app.request('/api/objekte'))).some((x: { id: string }) => x.id === o.id)).toBe(false);
  });

  it('Papierkorb: Gelöschtes je Bereich, wiederherstellen, endgültig entfernen, 30-Tage-Frist', async () => {
    const o = await lies(post('/api/objekte', { strasse: 'Papierkorbweg', hausnr: '1' }));
    const m = await lies(post('/api/makler', { name: 'Papierkorb Makler' }));
    angelegt.objekte.push(o.id); angelegt.makler.push(m.id);
    const d = await lies(post('/api/deals', { objektId: o.id, maklerId: m.id }));
    await app.request(`/api/deals/${d.id}`, { method: 'DELETE' });
    await app.request(`/api/objekte/${o.id}`, { method: 'DELETE' });

    const liste = await lies(app.request('/api/papierkorb'));
    // Bezeichnung wie in der alten Ansicht: Straße ohne Hausnummer
    expect(liste.find((e: { id: string }) => e.id === d.id)).toMatchObject({ bereich: 'deals', bezeichnung: 'Papierkorbweg' });
    expect(liste.find((e: { id: string }) => e.id === o.id)).toMatchObject({ bereich: 'objekte', bezeichnung: 'Papierkorbweg' });

    expect((await app.request(`/api/papierkorb/objekte/${o.id}/wiederherstellen`, { method: 'POST' })).status).toBe(200);
    expect((await lies(app.request(`/api/objekte/${o.id}`))).id).toBe(o.id);
    expect((await app.request(`/api/papierkorb/objekte/${o.id}/wiederherstellen`, { method: 'POST' })).status).toBe(404);
    expect((await app.request(`/api/papierkorb/unbekannt/${o.id}/wiederherstellen`, { method: 'POST' })).status).toBe(400);

    expect((await app.request(`/api/papierkorb/deals/${d.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await lies(app.request('/api/papierkorb'))).some((e: { id: string }) => e.id === d.id)).toBe(false);
    expect((await db.select().from(schema.deals).where(eq(schema.deals.id, d.id))).length).toBe(0);

    // Abgelaufenes (älter als 30 Tage) wird beim Öffnen endgültig entfernt
    await app.request(`/api/makler/${m.id}`, { method: 'DELETE' });
    await db.update(schema.makler).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }).where(eq(schema.makler.id, m.id));
    expect((await lies(app.request('/api/papierkorb'))).some((e: { id: string }) => e.id === m.id)).toBe(false);
    expect((await db.select().from(schema.makler).where(eq(schema.makler.id, m.id))).length).toBe(0);
  });

  it('Dubletten: Scan findet Paare, Ignorieren blendet aus, Zusammenführen hängt Deals und Kommunikation um, Rückgängig stellt her', async () => {
    const kennung = `Dub${Date.now()}`;
    const m1 = await lies(post('/api/makler', { name: `${kennung} Anna Beispiel`, email: `${kennung}@example.test`, prio: 'B' }));
    const m2 = await lies(post('/api/makler', { name: `${kennung} Anna Beispiel`, email: `${kennung}@example.test`, firma: 'Beispiel GmbH', tel: '+49 711 4' }));
    const o = await lies(post('/api/objekte', { strasse: `${kennung}weg`, hausnr: '1' }));
    angelegt.makler.push(m1.id, m2.id); angelegt.objekte.push(o.id);
    const d = await lies(post('/api/deals', { objektId: o.id, maklerId: m2.id }));
    await post(`/api/makler/${m2.id}/kommunikation`, { kanal: 'notiz', text: 'Notiz am Duplikat' });

    const paare = await lies(app.request('/api/dubletten'));
    const paar = paare.find((p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].includes(m1.id) && [p.a.id, p.b.id].includes(m2.id));
    expect(paar).toMatchObject({ typ: 'makler', sicherheit: 'exact', grund: 'Gleiche E-Mail-Adresse' });

    const vorschau = await lies(app.request(`/api/dubletten/vorschau?typ=makler&primaerId=${m1.id}&sekundaerId=${m2.id}`));
    expect(vorschau.felder.find((f: { feld: string }) => f.feld === 'firma')).toMatchObject({ wertA: '', wertB: 'Beispiel GmbH', konflikt: false });
    expect(vorschau.vereinteListen.find((l: { name: string }) => l.name === 'kommunikation')).toMatchObject({ anzahlA: 0, anzahlB: 1 });

    const merge = await lies(post('/api/dubletten/zusammenfuehren', { typ: 'makler', primaerId: m1.id, sekundaerId: m2.id, felder: { prio: 'B' }, listen: {} }));
    expect(merge.betroffeneDealIds).toEqual([d.id]);
    const zusammen = await lies(app.request(`/api/makler/${m1.id}`));
    expect(zusammen).toMatchObject({ firma: 'Beispiel GmbH', tel: '+49 711 4' });
    expect(zusammen.kommunikation.map((k: { text: string }) => k.text)).toContain('Notiz am Duplikat');
    expect((await lies(app.request(`/api/deals/${d.id}`))).makler.id).toBe(m1.id);
    expect((await app.request(`/api/makler/${m2.id}`)).status).toBe(404);
    expect((await lies(app.request('/api/papierkorb'))).some((e: { id: string }) => e.id === m2.id)).toBe(true);

    const protokoll = await lies(app.request('/api/dubletten/protokoll'));
    expect(protokoll[0]).toMatchObject({ id: merge.protokollId, typ: 'makler', abgelaufen: false, betroffeneDeals: 1 });

    const rueck = await post(`/api/dubletten/protokoll/${merge.protokollId}/rueckgaengig`, { erzwingen: false });
    expect(rueck.status, JSON.stringify(await rueck.clone().json())).toBe(200);
    const zurueck = await lies(app.request(`/api/makler/${m1.id}`));
    expect(zurueck.firma).toBeNull();
    expect(zurueck.kommunikation.length).toBe(0);
    expect((await lies(app.request(`/api/makler/${m2.id}`))).kommunikation.map((k: { text: string }) => k.text)).toEqual(['Notiz am Duplikat']);
    expect((await lies(app.request(`/api/deals/${d.id}`))).makler.id).toBe(m2.id);
    expect((await post(`/api/dubletten/protokoll/${merge.protokollId}/rueckgaengig`, { erzwingen: false })).status).toBe(409);

    // Ignorieren blendet das Paar aus
    await post('/api/dubletten/ignorieren', { id1: m1.id, id2: m2.id });
    expect((await lies(app.request('/api/dubletten'))).some((p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].includes(m1.id) && [p.a.id, p.b.id].includes(m2.id))).toBe(false);
    await app.request('/api/dubletten/ignorieren', { method: 'DELETE' });
    expect((await lies(app.request('/api/dubletten'))).some((p: { a: { id: string }; b: { id: string } }) => [p.a.id, p.b.id].includes(m1.id) && [p.a.id, p.b.id].includes(m2.id))).toBe(true);
  });

  it('Audit-Log: Einträge mit Hash-Kette, Filter, Export, Prüfung und Aufräumen mit Anker', async () => {
    // Der Testbestand wächst über viele Läufe; geprüft wird die Kette der Zeilen dieses Laufs
    await db.delete(schema.auditLog);
    const o = await lies(post('/api/objekte', { strasse: 'Auditweg', hausnr: '1' }));
    angelegt.objekte.push(o.id);
    const d = await lies(post('/api/deals', { objektId: o.id }));
    const form = new FormData();
    form.append('dateien', new File([Buffer.from('%PDF-1.7\n' + 'x'.repeat(100))], 'Audit.pdf', { type: 'application/pdf' }));
    const dok = (await (await app.request(`/api/deals/${d.id}/dokumente`, { method: 'POST', body: form })).json() as { id: string }[])[0]!;
    await post(`/api/deals/${d.id}/dokumente/${dok.id}`, { label: 'Audit-Beleg' }, 'PATCH');
    await post(`/api/deals/${d.id}/dokumente/${dok.id}`, { label: 'Audit-Beleg 2' }, 'PATCH');

    const seite = await lies(app.request('/api/audit?entity=doc&limit=10'));
    expect(seite.zeilen[0]).toMatchObject({ type: 'mutation', entity: 'doc', entityId: dok.id, action: 'update', fieldName: 'label', newValue: 'Audit-Beleg 2' });
    // Zeitstempel in Sekunden wie in der alten App
    expect(seite.zeilen[0].ts).toBeLessThan(Date.now() / 100);
    expect((await lies(app.request(`/api/audit?suche=${dok.id}`))).zeilen.length).toBeGreaterThan(1);
    expect((await lies(app.request('/api/audit?type=kicall&limit=5'))).zeilen.every((z: { type: string }) => z.type === 'kicall')).toBe(true);

    expect(await lies(app.request('/api/audit/pruefen'))).toMatchObject({ ok: true });
    const csv = await (await app.request('/api/audit/export.csv')).text();
    expect(csv.split('\n')[0]).toContain('id;ts;type');
    expect(csv).toContain('Audit-Beleg');

    // Aufräumen: alles bis zur ältesten überalterten Zeile (wie alt: Grenze über die id), Anker bleibt, Kette rechnet weiter
    const [aelteste] = await db.select({ id: schema.auditLog.id }).from(schema.auditLog).orderBy(schema.auditLog.id).limit(1);
    await db.update(schema.auditLog).set({ ts: Math.floor(Date.now() / 1000) - 200 * 86_400 }).where(eq(schema.auditLog.id, aelteste!.id));
    const vorher = (await lies(app.request('/api/audit?limit=1'))).gesamt;
    const weg = await lies(app.request('/api/audit/aelter-als/180', { method: 'DELETE' }));
    expect(weg.entfernt).toBeGreaterThan(0);
    const danach = await lies(app.request('/api/audit?limit=50'));
    expect(danach.gesamt).toBe(vorher - weg.entfernt + 1); // + Anker
    const befund = await lies(app.request('/api/audit/pruefen'));
    expect(befund, JSON.stringify(befund)).toMatchObject({ ok: true });
    // Der Anker beschreibt genau das entfernte Anfangsstück und verweist auf die älteste verbliebene Zeile
    expect(befund.anker).toMatchObject({ deleted: weg.entfernt, firstKeptId: danach.zeilen.at(-1).id });
  });

  it('Propstack-Zielstatus: Liste holen, „Kaufangebote" vorschlagen, Wahl speichern und zurücknehmen', async () => {
    // Eigene App mit Attrappe: der Zielstatus soll ohne echten CRM-Zugang prüfbar sein.
    const mitPropstack = createApp({ db, auth: offen, propstack: propstackAttrappe() });
    const hole = () => lies(mitPropstack.request('/api/propstack/status'));
    const setze = (id: number | null) => mitPropstack.request('/api/propstack/status', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
    });

    const erst = await hole();
    expect(erst.liste).toEqual([{ id: 1, name: 'Kaufangebote (Test-Modus)' }]);
    expect(erst.vorschlag).toBe(1);  // aus dem Namen erkannt, nicht geraten

    expect((await setze(1)).status).toBe(200);
    expect((await hole()).gewaehlt).toBe(1);

    // Zurücknehmen: ohne Festlegung legt die Anbindung wieder ohne Status an
    expect((await setze(null)).status).toBe(200);
    expect((await hole()).gewaehlt).toBeNull();
  });

  it('Zugänge: Schlüssel verschlüsselt speichern, maskiert anzeigen, entfernen', async () => {
    const vorher = await lies(app.request('/api/zugaenge'));
    expect(vorher.map((z: { schluessel: string }) => z.schluessel)).toContain('anthropic-api-key');

    expect((await post('/api/zugaenge/erfunden', { wert: 'x' }, 'PUT')).status).toBe(400);
    await post('/api/zugaenge/propstack-api-key', { wert: 'ps-test-abcd1234' }, 'PUT');
    const nachher = await lies(app.request('/api/zugaenge'));
    const ps = nachher.find((z: { schluessel: string }) => z.schluessel === 'propstack-api-key');
    expect(ps).toMatchObject({ quelle: 'einstellungen', maske: '••••1234' });
    // In der Datenbank steht nur das Chiffrat
    const [zeile] = await db.select().from(schema.geheimnisse).where(eq(schema.geheimnisse.schluessel, 'propstack-api-key'));
    expect(zeile!.wertVerschluesselt!.startsWith('enc:v1:')).toBe(true);
    expect(zeile!.wertVerschluesselt).not.toContain('ps-test');

    await post('/api/zugaenge/propstack-api-key', { wert: '' }, 'PUT');
    const leer = (await lies(app.request('/api/zugaenge'))).find((z: { schluessel: string }) => z.schluessel === 'propstack-api-key');
    expect(leer).toMatchObject({ quelle: 'fehlt', maske: '' });
  });

  it('Sicherung: Export enthält den Bestand, Plan zählt neue Zeilen, Einspielen stellt Gelöschtes wieder her', async () => {
    const strasse = `Sicherungsweg ${Date.now()}`;
    const o = await lies(post('/api/objekte', { strasse, hausnr: '8', angebotspreis: 500_000 }));
    angelegt.objekte.push(o.id);

    const antwort = await app.request('/api/sicherung/export');
    expect(antwort.headers.get('content-disposition')).toMatch(/gg-sicherung-.*\.json/);
    const datei = await antwort.json() as { version: number; tabellen: Record<string, { id: string }[]> };
    expect(datei.version).toBe(1);
    expect(datei.tabellen.objekte?.some((z) => z.id === o.id)).toBe(true);
    expect(datei.tabellen.geheimnisse).toBeUndefined();

    // Objekt endgültig entfernen, dann aus der Sicherung zurückholen
    await app.request(`/api/objekte/${o.id}`, { method: 'DELETE' });
    await app.request(`/api/papierkorb/objekte/${o.id}`, { method: 'DELETE' });
    expect((await app.request(`/api/objekte/${o.id}`)).status).toBe(404);

    const plan = await lies(post('/api/sicherung/plan', datei));
    expect(plan.zeilen.find((z: { tabelle: string }) => z.tabelle === 'objekte').neu).toBeGreaterThan(0);
    const wieder = await lies(post('/api/sicherung/einspielen', datei));
    expect(wieder.geschrieben).toBeGreaterThan(0);
    expect((await lies(app.request(`/api/objekte/${o.id}`)))).toMatchObject({ strasse, angebotspreis: 500_000 });

    expect((await post('/api/sicherung/plan', { version: 9 })).status).toBe(400);
  });

  it('Propstack: Vorbelegung je Einheit, Gate blockiert den Schreibzugriff, mit Freigabe wird angelegt', async () => {
    const o = await lies(post('/api/objekte', { strasse: 'Bewertungsweg', hausnr: '7', plz: '70173', stadt: 'Stuttgart' }));
    angelegt.objekte.push(o.id);
    await post(`/api/objekte/${o.id}`, { version: o.version, baujahr: 1965 }, 'PATCH');
    const d = await lies(post('/api/deals', { objektId: o.id }));
    const dd = await lies(app.request(`/api/deals/${d.id}`));
    await post(`/api/deals/${d.id}/kalkulation`, {
      version: dd.version, kalkulation: {}, sanierungen: [],
      einheiten: [
        { typ: 'Wohnung', lage: 'EG', zimmer: 3, stueck: null, flaeche: 78.5, mieteIst: 700, mieteNeu: null, mieteNeuManuell: false, renditeK: 4.5, verkaufspreis: null },
        { typ: 'Stellplatz', lage: 'TG', zimmer: null, stueck: 1, flaeche: null, mieteIst: 50, mieteNeu: null, mieteNeuManuell: false, renditeK: null, verkaufspreis: null },
      ],
    }, 'PUT');
    const [wohnung, stellplatz] = (await lies(app.request(`/api/deals/${d.id}`))).einheiten;

    const vor = await lies(app.request(`/api/deals/${d.id}/einheiten/${wohnung.id}/propstack`));
    expect(vor).toMatchObject({ unitId: null, daten: { strasse: 'Bewertungsweg', hausnr: '7', plz: '70173', ort: 'Stuttgart', baujahr: '1965', wohnflaeche: '78.5', zimmer: '3', qualitaet: 'normal' } });
    expect((await app.request(`/api/deals/${d.id}/einheiten/${stellplatz.id}/propstack`)).status).toBe(422);

    // Default-Deny: lokal blockiert das Gate, bevor irgendetwas hinausgeht
    const blockiert = await post(`/api/deals/${d.id}/einheiten/${wohnung.id}/propstack`, vor.daten);
    expect(blockiert.status).toBe(403);
    expect((await blockiert.json() as { fehler: string }).fehler).toContain('blockiert');

    // Mit erfüllten Bedingungen (Umgebung, Schalter) geht die Anfrage an den Propstack-Client
    await post('/api/outward-gate', { allowPropstackWrite: true }, 'PUT');
    const scharf = createApp({ db, auth: offen, propstack: propstackAttrappe() });
    const alteUmgebung = { vercel: process.env.VERCEL, env: process.env.VERCEL_ENV };
    process.env.VERCEL = '1'; process.env.VERCEL_ENV = 'production';
    try {
      const antwort = await scharf.request(`/api/deals/${d.id}/einheiten/${wohnung.id}/propstack`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...vor.daten, etage: '2', qualitaet: 'gehoben' }),
      });
      expect(antwort.status).toBe(200);
      const erg = await antwort.json() as { unitId: string; url: string };
      expect(erg.url).toBe(`https://crm.propstack.de/app/properties/${erg.unitId}`);
      // Vorbelegung merkt sich Kennung und Angaben
      const nachher = await lies(app.request(`/api/deals/${d.id}/einheiten/${wohnung.id}/propstack`));
      expect(nachher).toMatchObject({ unitId: erg.unitId, daten: { etage: '2', qualitaet: 'gehoben' } });
    } finally {
      // Zuweisen von undefined ergäbe den Text "undefined" — dann gilt die Umgebung als Plattform
      if (alteUmgebung.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = alteUmgebung.vercel;
      if (alteUmgebung.env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = alteUmgebung.env;
      await post('/api/outward-gate', { allowPropstackWrite: false }, 'PUT');
    }
  });

  it('Microsoft 365: Zugang einrichten, Posteingang lesen, Mail sperren, Anhang übernehmen', async () => {
    // Sperren aus früheren Läufen (auch aus den Klicktests) zurücknehmen
    await db.delete(schema.mailImportGesehen);
    expect(await lies(app.request('/api/m365'))).toMatchObject({ verbunden: false, ordner: 'inbox', testModus: false });
    await post('/api/m365/konfiguration', { clientId: 'app-1234', tenantId: 'contoso.onmicrosoft.com', clientSecret: 'geheim-5678' }, 'PUT');
    const stand = await lies(app.request('/api/m365'));
    expect(stand).toMatchObject({ eingerichtet: true, clientId: 'app-1234', tenantId: 'contoso.onmicrosoft.com' });
    expect(JSON.stringify(stand)).not.toContain('geheim-5678');

    // Anmeldeadresse mit State; ein fremder State wird abgelehnt
    // Die Rücksprung-Adresse kommt vom Client: fremde Hosts werden abgewiesen, online zählt nur die Liste
    const fremd = await post('/api/m365/anmeldung', { redirectUri: 'https://app.example.test/m365/rueckweg' });
    expect(fremd.status).toBe(400);
    expect(((await fremd.json()) as { fehler: string }).fehler).toContain('nicht freigegeben');
    const online = createApp({ db, auth: offen, oauthRueckweg: { online: true, erlaubteHosts: ['app.example.test'] } });
    const anmelden = (app2: typeof app, redirectUri: string) => app2.request('/api/m365/anmeldung', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirectUri }) });
    expect((await anmelden(online, 'http://localhost:5273/m365/rueckweg')).status).toBe(400);
    expect((await anmelden(online, 'https://app.example.test/m365/rueckweg')).status).toBe(200);

    const { url } = await lies(post('/api/m365/anmeldung', { redirectUri: 'http://localhost:5273/m365/rueckweg' }));
    expect(url).toContain(encodeURIComponent('http://localhost:5273/m365/rueckweg'));
    expect(url).toContain('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize');
    expect(url).toContain('client_id=app-1234');
    expect(url).toContain('prompt=select_account');
    expect((await post('/api/m365/rueckweg', { code: 'x', state: 'fremd' })).status).toBe(400);

    // Posteingang über die Attrappe (kein echter Zugang nötig)
    const mitGraph = createApp({ db, auth: offen, speicher, graph: graphAttrappe(), expose: undefined });
    const posteingang = await (await mitGraph.request('/api/m365/posteingang')).json() as { mails: { uid: string; betreff: string; anhaenge: { id: string; auswertbar: boolean }[] }[] };
    expect(posteingang.mails.map((m) => m.betreff)).toEqual(['Angebot: Musterweg 1', 'Neue Objekte in Ihrer Region']);
    expect(posteingang.mails[0]!.anhaenge[0]).toMatchObject({ name: 'Expose.pdf', auswertbar: true });

    await post('/api/m365/mails/mail-2/sperren', {});
    const danach = await (await mitGraph.request('/api/m365/posteingang')).json() as { mails: { uid: string }[] };
    expect(danach.mails.map((m) => m.uid)).toEqual(['mail-1']);
    const alle = await (await mitGraph.request('/api/m365/posteingang?alle=true')).json() as { mails: { uid: string; gesperrt: boolean }[] };
    expect(alle.mails.find((m) => m.uid === 'mail-2')).toMatchObject({ gesperrt: true });

    // Anhang übernehmen: landet im Exposé-Eingang und die Mail ist danach gesperrt
    const mitAblage = createApp({ db, auth: offen, graph: graphAttrappe(), expose: { ki: kiAttrappe(), speicher, pdfText: async () => ({ text: 'Test', pageCount: 1, charsTotal: 4, seitenGesamt: 1 }) } as never });
    const uebernommen = await mitAblage.request('/api/m365/mails/mail-1/anhaenge/att-1/uebernehmen', { method: 'POST' });
    expect(uebernommen.status).toBe(200);
    expect(await uebernommen.json()).toMatchObject({ groesse: expect.any(Number) });
    expect((await (await mitGraph.request('/api/m365/posteingang')).json() as { mails: unknown[] }).mails).toEqual([]);

    await post('/api/m365/trennen', {});
    expect(await lies(app.request('/api/m365'))).toMatchObject({ verbunden: false });
  });

  it('MCP: lokal voller Zugriff, Werkzeuge nach Bereich, Notiz und Freigabe-Antrag', async () => {
    const o = await lies(post('/api/objekte', { strasse: 'MCPweg', hausnr: '1' }));
    angelegt.objekte.push(o.id);
    const d = await lies(post('/api/deals', { objektId: o.id }));
    const rpc = async (nachricht: unknown, kopf: Record<string, string> = {}) =>
      app.request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(nachricht) });

    // Lokal (AUTH_LOCAL_OPEN=1, kein Plattform-Marker) gilt der volle Bereichssatz
    const alt = { lokal: process.env.AUTH_LOCAL_OPEN, vercel: process.env.VERCEL, keys: process.env.MCP_API_KEYS };
    process.env.AUTH_LOCAL_OPEN = '1';
    delete process.env.VERCEL;
    try {
      const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })).json() as { result: { serverInfo: { name: string } } };
      expect(init.result.serverInfo.name).toBe('gg-immobilienhandel');

      const liste = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json() as { result: { tools: { name: string }[] } };
      expect(liste.result.tools.map((t) => t.name)).toEqual(['list_collections', 'read_collection', 'read_entity', 'list_files', 'read_audit_log', 'add_note', 'request_outward_approval']);

      const gelesen = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_entity', arguments: { collection: 'deals', id: d.id } } })).json() as { result: { content: { text: string }[]; isError: boolean } };
      expect(gelesen.result.isError).toBe(false);
      expect(JSON.parse(gelesen.result.content[0]!.text)).toMatchObject({ id: d.id, objekt: { titel: 'MCPweg 1' } });

      const notiz = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_note', arguments: { dealId: d.id, text: 'Von der Assistenz' } } })).json() as { result: { isError: boolean } };
      expect(notiz.result.isError).toBe(false);
      expect((await lies(app.request(`/api/deals/${d.id}`))).kommentare[0].text).toContain('Von der Assistenz');

      const antrag = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'request_outward_approval', arguments: { action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', grund: 'Einheit anlegen' } } })).json() as { result: { content: { text: string }[] } };
      expect(JSON.parse(antrag.result.content[0]!.text).antrag).toMatchObject({ action: 'propstack-unit-create', beantragtVon: 'mcp:local' });
      expect((await lies(app.request('/api/outward-gate'))).freigaben[0]).toMatchObject({ action: 'propstack-unit-create' });

      const unbekannt = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'gibt_es_nicht' } })).json() as { error: { code: number } };
      expect(unbekannt.error.code).toBe(-32601);
      const fehlend = await (await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'read_entity', arguments: { collection: 'deals' } } })).json() as { result: { isError: boolean; content: { text: string }[] } };
      expect(fehlend.result).toMatchObject({ isError: true });
      expect(fehlend.result.content[0]!.text).toContain('"id"');

      // Mit Schlüssel: nur der eingetragene Bereich zählt
      process.env.AUTH_LOCAL_OPEN = '0';
      const schluessel = 'test-schluessel-1234';
      process.env.MCP_API_KEYS = `cowork:read:${createHash('sha256').update(schluessel).digest('hex')}`;
      expect((await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' })).status).toBe(401);
      const nurLesen = await (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { authorization: `Bearer ${schluessel}` })).json() as { result: { tools: { name: string }[] } };
      expect(nurLesen.result.tools.map((t) => t.name)).not.toContain('add_note');
      const verweigert = await (await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'add_note', arguments: { dealId: d.id, text: 'x' } } }, { authorization: `Bearer ${schluessel}` })).json() as { error: { code: number; message: string } };
      expect(verweigert.error).toMatchObject({ code: -32003 });
      expect(verweigert.error.message).toContain('verlangt den Bereich "write"');
      // Ein Cookie ist kein Schlüssel
      expect((await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list' }, { cookie: `gg-auth=${schluessel}` })).status).toBe(401);
    } finally {
      if (alt.lokal === undefined) delete process.env.AUTH_LOCAL_OPEN; else process.env.AUTH_LOCAL_OPEN = alt.lokal;
      if (alt.keys === undefined) delete process.env.MCP_API_KEYS; else process.env.MCP_API_KEYS = alt.keys;
      if (alt.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = alt.vercel;
    }
  });

  it('Makler: Telefon normalisiert, Kommunikation rückt letzten Kontakt vor, KI (Attrappe), Persönliches, Stil, Entwurf, Löschen', async () => {
    const m = await lies(post('/api/makler', { name: 'KI Klara', tel: '0049 (711) 123456' }));
    angelegt.makler.push(m.id);
    expect(m.tel).toBe('+49 711 123456');
    await post(`/api/makler/${m.id}/kommunikation`, { kanal: 'email', richtung: 'eingehend', text: 'Alte Mail', datum: '2025-01-02' });
    let d = await lies(app.request(`/api/makler/${m.id}`));
    expect(d.lastContact).toBe('2025-01-02');
    await post(`/api/makler/${m.id}/kommunikation`, { kanal: 'email', richtung: 'eingehend', text: 'Noch ältere Mail', datum: '2024-06-01' });
    expect((await lies(app.request(`/api/makler/${m.id}`))).lastContact).toBe('2025-01-02'); // nie zurück
    for (const text of ['Können Sie mir Ihre Unterlagen senden?', 'Haben Sie Zeit für einen Termin?', 'Nach dem Urlaub melde ich mich wieder bei Ihnen, versprochen.']) {
      await post(`/api/makler/${m.id}/kommunikation`, { kanal: 'whatsapp', richtung: 'ausgehend', text });
    }
    d = await lies(app.request(`/api/makler/${m.id}`));
    expect(d.lastContact).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.lastContact > '2025-01-02').toBe(true);

    expect(await lies(post(`/api/makler/${m.id}/ki/zusammenfassung`, {}))).toMatchObject({ kiSummary: expect.stringContaining('Test-Modus') });
    expect(await lies(post(`/api/makler/${m.id}/ki/erwaehnungen`, { text: 'kurz', kanal: 'notiz' }))).toEqual({ neu: 0 });
    expect(await lies(post(`/api/makler/${m.id}/ki/erwaehnungen`, { text: 'Nach dem Urlaub melde ich mich wieder bei Ihnen, versprochen.', kanal: 'whatsapp' }))).toEqual({ neu: 1 });
    expect(await lies(post(`/api/makler/${m.id}/ki/beziehungsprofil`, {}))).toMatchObject({ beziehungsNotiz: expect.stringContaining('Test-Modus') });
    await lies(post(`/api/makler/${m.id}/persoenlich`, { geburtsdatum: ' 03-15 ', anredeForm: 'sie' }, 'PUT'));
    const pers = await lies(post(`/api/makler/${m.id}/ki/persoenliches`, {}));
    expect(pers.persoenlich).toMatchObject({ geburtsdatum: '03-15', geburtstagQuelle: 'manuell', anredeForm: 'sie', hobbies: ['Test-Modus'], letzteErwaehnung: [{ thema: 'Urlaub' }] });
    d = await lies(app.request(`/api/makler/${m.id}`));
    expect(d.kiSummaryAt).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/);
    expect(d.beziehungsNotiz).toContain('Test-Modus');

    const stand = await lies(app.request('/api/persona'));
    expect(stand.ausgehend).toBeGreaterThanOrEqual(3);
    expect((await post(`/api/makler/${m.id}/ki/entwurf`, {})).status).toBe(stand.profil ? 200 : 422);
    const analysiert = await lies(post('/api/persona/analyse', {}));
    expect(analysiert.profil).toMatchObject({ anrede: 'Hallo', commAnalyzed: analysiert.ausgehend });
    expect(await lies(post(`/api/makler/${m.id}/ki/entwurf`, {}))).toMatchObject({ wa: expect.stringContaining('Test-Modus'), email: { subject: expect.any(String) } });
    await db.delete(schema.einstellungen).where(eq(schema.einstellungen.schluessel, 'persona-profil'));

    const form = new FormData();
    form.append('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }));
    expect((await app.request('/api/transkription', { method: 'POST', body: form })).status).toBe(422); // ohne OpenAI-Schlüssel

    // Anlässe (Suche im Test leer → keine), Gesprächsöffner, OSINT
    expect(await lies(post(`/api/makler/${m.id}/ki/anlaesse`, {}))).toEqual({ anlaesse: [] });
    // … 24 h in der Datenbank zwischengespeichert: ein zweiter Aufruf liest die Zeile, ein abgelaufener ermittelt neu
    const anlass = { emoji: '🏢', text: 'Neues Objekt inseriert', priority: 'hoch' };
    await db.update(schema.maklerAnlaesse).set({ anlaesse: [anlass] }).where(eq(schema.maklerAnlaesse.maklerId, m.id));
    expect(await lies(post(`/api/makler/${m.id}/ki/anlaesse`, {}))).toEqual({ anlaesse: [anlass] });
    await db.update(schema.maklerAnlaesse).set({ ermitteltAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }).where(eq(schema.maklerAnlaesse.maklerId, m.id));
    expect(await lies(post(`/api/makler/${m.id}/ki/anlaesse`, {}))).toEqual({ anlaesse: [] });
    expect((await lies(post(`/api/makler/${m.id}/ki/gespraechsoeffner`, {}))).text).toContain('Test-Modus');
    const osint = await lies(post(`/api/makler/${m.id}/osint`, {}));
    expect(osint.persoenlich).toMatchObject({ geburtsdatum: '03-15', personenInfo: { allgemein: [] } });

    expect((await app.request(`/api/makler/${m.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/makler/${m.id}`)).status).toBe(404);
  });

  it('lehnt einen Deal zu unbekanntem Objekt mit 422 ab', async () => {
    expect((await post('/api/deals', { objektId: 'gibt-es-nicht' })).status).toBe(422);
  });
});
