import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, type Tabelle } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { hubspotBerichtText, hubspotUebernehmen } from '../src/services/hubspotUebernahme.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/**
 * HubSpot-Übernahme (Baustein C, 17.10.2026): Probelauf rollt zurück, scharfer Lauf legt an und ergänzt; Unternehmen über Domain
 * (vorhanden → Impressum → Platzhalter); zweiter Lauf erkennt alles über die HubSpot-ID.
 */
describe.skipIf(!url)('HubSpot-Übernahme', () => {
  const { db, client } = createDb(url!);
  const kennung = `Hs${Date.now()}`;
  const dom = kennung.toLowerCase();
  const kopf = ['Datensatz-ID', 'Vorname', 'Nachname', 'Anrede', 'Du / Sie', 'E-Mail', 'Zusätzliche E-Mail-Adressen', 'E-Mail-Domain', 'Telefonnummer', 'Handynummer', 'Unternehmensname', 'Unternehmensanschrift', 'Webseite', 'Adresszeile', 'Postleitzahl', 'Stadt', 'Klassifizierung', 'Makler Status Mailings', 'Jobbezeichnung', 'Für Kontakt zuständiger Mitarbeiter ', 'Erstellungsdatum', 'Letzte Kontaktaufnahme'];
  const zeile = (w: Record<string, unknown>) => kopf.map((k) => w[k.trim()] ?? '');
  const tabelle: Tabelle = {
    ueberschriften: kopf,
    zeilen: [
      // 1: bekannt über E-Mail (Makler vorher angelegt), Telefon leer → wird ergänzt, Anrede nach persönlich
      zeile({ 'Datensatz-ID': `${kennung}-1`, Vorname: 'Anna', Nachname: `${kennung}`, Anrede: 'Frau', 'E-Mail': `anna@${dom}-bekannt.test`, Telefonnummer: "'+497110000001", Klassifizierung: 'VIP', Stadt: 'Stuttgart' }),
      // 2: neu, Domain mit Impressum → Unternehmen aus dem Impressum, Prio A, Du
      zeile({ 'Datensatz-ID': `${kennung}-2`, Vorname: 'Bernd', Nachname: `${kennung}`, 'Du / Sie': 'per Du', 'E-Mail': `bernd@${dom}-impressum.test`, Telefonnummer: '497110000002', Handynummer: '0171 0000002', Klassifizierung: 'High Potential', Jobbezeichnung: 'Vertriebsleiter', 'Für Kontakt zuständiger Mitarbeiter': 'Gerry Weyrich', Erstellungsdatum: 45471.45 }),
      // 3: neu, gleiche Domain wie 2 → dasselbe Unternehmen; Klassifizierung Exit → Frequenz Nie
      zeile({ 'Datensatz-ID': `${kennung}-3`, Vorname: 'Carla', Nachname: `${kennung}`, 'E-Mail': `carla@${dom}-impressum.test`, Telefonnummer: "'+", Klassifizierung: 'Exit', 'Makler Status Mailings': 'Keine Mails mehr schicken' }),
      // 4: neu, Domain ohne Impressum, aber „Unternehmensname“ → Platzhalter mit Quelle hubspot; Test → Prio C
      zeile({ 'Datensatz-ID': `${kennung}-4`, Vorname: 'Dora', Nachname: `${kennung}`, 'E-Mail': `dora@${dom}-leer.test`, Telefonnummer: '4971310000000', Unternehmensname: `${kennung} Platzhalter Immobilien`, Unternehmensanschrift: 'Königstraße 1', Klassifizierung: 'Test', 'Letzte Kontaktaufnahme': 45678.43 }),
      // 5: neu, Freemail → kein Unternehmen; Prio B
      zeile({ 'Datensatz-ID': `${kennung}-5`, Vorname: 'Emil', Nachname: `${kennung}`, 'E-Mail': `emil.${dom}@gmail.com`, Telefonnummer: '0711 0000005', Klassifizierung: 'B' }),
      // 6: ohne alles → übersprungen
      zeile({ 'Datensatz-ID': `${kennung}-6`, Klassifizierung: 'C' }),
    ],
  };
  const impressum = `<html><body><h1>Impressum</h1><p>Angaben gemäß § 5 TMG</p><p>Firma: ${kennung} Impressum GmbH<br>Straße: Weg 2<br>PLZ: 70173<br>Ort: Stuttgart<br>Telefon: 0711 2</p></body></html>`;
  const abrufe: string[] = [];
  const abruf = (async (eingabe: string | URL | Request) => {
    const u = String(eingabe); abrufe.push(u);
    return u === `https://${dom}-impressum.test/impressum` ? new Response(impressum, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
  }) as typeof fetch;
  const ki = kiAttrappe();
  let bekanntId = '';

  afterAll(async () => {
    await db.delete(schema.makler).where(like(schema.makler.name, `%${kennung}%`));
    const unternehmen = await db.select({ id: schema.unternehmen.id }).from(schema.unternehmen).where(like(schema.unternehmen.name, `%${kennung}%`));
    if (unternehmen.length) await db.delete(schema.unternehmen).where(inArray(schema.unternehmen.id, unternehmen.map((u) => u.id)));
    await db.delete(schema.firmenAuskuenfte).where(inArray(schema.firmenAuskuenfte.domain, [`${dom}-impressum.test`, `${dom}-leer.test`, `${dom}-bekannt.test`]));
    await client.end();
  });

  it('Probelauf: Bericht wie der echte Lauf, aber nichts bleibt — außer dem Impressum-Zwischenspeicher', async () => {
    const [bekannt] = await db.insert(schema.makler).values({ id: crypto.randomUUID(), name: `Anna ${kennung}`, email: `anna@${dom}-bekannt.test` }).returning({ id: schema.makler.id });
    bekanntId = bekannt!.id;
    const b = await hubspotUebernehmen(db, ki, tabelle, 'test.xlsx', { trocken: true, abruf, heute: '2026-10-17' });
    expect(b).toMatchObject({ trocken: true, gelesen: 6, uebersprungen: 1, mitKi: true });
    expect(b.bekannt).toMatchObject({ gesamt: 1, ueber: { email: 1, telefon: 0, name: 0, 'hubspot-id': 0 }, ergaenzt: 1 });
    expect(b.neu).toEqual({ gesamt: 4, prio: { A: 1, B: 1, C: 2 }, frequenzNie: 1 });
    // je Domain: Impressum-Domain einmal (Bernd + Carla), Platzhalter für Annas Domain (kein Impressum, kein Name) und Doras „Unternehmensname“
    expect(b.unternehmen).toEqual({ vorhanden: 0, impressum: 1, platzhalter: 2, ohne: 1 });
    // zurückgerollt: nur der vorher angelegte Makler ist da, kein Unternehmen mit der Kennung
    expect((await db.select({ id: schema.makler.id }).from(schema.makler).where(like(schema.makler.name, `%${kennung}%`))).map((m) => m.id)).toEqual([bekanntId]);
    expect(await db.select({ id: schema.unternehmen.id }).from(schema.unternehmen).where(like(schema.unternehmen.name, `%${kennung}%`))).toEqual([]);
    // der Abruf ist gespeichert und wird beim echten Lauf nicht wiederholt
    expect(await db.select({ domain: schema.firmenAuskuenfte.domain }).from(schema.firmenAuskuenfte).where(eq(schema.firmenAuskuenfte.domain, `${dom}-impressum.test`))).toHaveLength(1);
    expect(hubspotBerichtText(b)).toContain('Probelauf (zurückgerollt)');
    expect(hubspotBerichtText(b)).toContain('Neu: 4 (Prio A 1, B 1, C 2; Frequenz „Nie“ 1)');
  });

  it('Schreiben: bekannte Makler ergänzt, neue angelegt mit Unternehmen, Prio, Frequenz und Herkunft', async () => {
    const vorher = abrufe.length;
    const b = await hubspotUebernehmen(db, ki, tabelle, 'test.xlsx', { abruf, heute: '2026-10-17' });
    expect(b.trocken).toBe(false);
    expect(abrufe.length).toBe(vorher); // Impressum aus dem Zwischenspeicher
    const alle = await db.select().from(schema.makler).where(like(schema.makler.name, `%${kennung}%`));
    expect(alle).toHaveLength(5);
    const nach = (v: string) => alle.find((m) => m.name?.startsWith(v))!;
    // bekannt: Telefon und Ort ergänzt, Anrede + Herkunft in persönlich, Unternehmen aus der Domain (Platzhalter aus Domain, da kein Impressum)
    const anna = nach('Anna');
    expect(anna.id).toBe(bekanntId);
    expect(anna).toMatchObject({ tel: '+497110000001', ort: 'Stuttgart', email: `anna@${dom}-bekannt.test` });
    expect(anna.persoenlich).toMatchObject({ anrede: 'Frau', herkunft: { quelle: 'hubspot', id: `${kennung}-1`, importiertAm: '2026-10-17', klassifizierung: 'VIP' } });
    expect(b.zeilen.find((z) => z.id === `${kennung}-1`)).toMatchObject({ ergebnis: 'ergaenzt', ueber: 'email', ergaenzt: ['tel', 'ort', 'unternehmenId', 'persoenlich'] });
    // neu aus Impressum
    const bernd = nach('Bernd');
    expect(bernd).toMatchObject({ prio: 'A', kontaktFrequenz: 'Monatlich', tel: '+497110000002', mobil: '0171 0000002', tags: ['HubSpot'] });
    expect(bernd.persoenlich).toMatchObject({ duSie: 'Du', jobbezeichnung: 'Vertriebsleiter', herkunft: { zustaendig: 'Gerry Weyrich', erstelltAm: '2024-06-28' } });
    const [u] = await db.select().from(schema.unternehmen).where(eq(schema.unternehmen.id, bernd.unternehmenId!));
    expect(u).toMatchObject({ name: `${kennung} Impressum GmbH`, rechtsform: 'GmbH', domain: `${dom}-impressum.test`, strasse: 'Weg 2', ort: 'Stuttgart', quelle: 'impressum' });
    // gleiche Domain → dasselbe Unternehmen; Exit → Nie; Mailing-Status
    const carla = nach('Carla');
    expect(carla.unternehmenId).toBe(bernd.unternehmenId);
    expect(carla).toMatchObject({ prio: 'C', kontaktFrequenz: 'Nie', tel: null });
    expect(carla.persoenlich).toMatchObject({ mailingStatus: 'Keine Mails mehr schicken' });
    // Platzhalter mit Quelle hubspot und Anschrift-Notiz; Platzhalter-Telefon verworfen; lastContact aus Excel-Datum
    const dora = nach('Dora');
    expect(dora).toMatchObject({ prio: 'C', tel: null, lastContact: '2025-01-21' });
    const [p] = await db.select().from(schema.unternehmen).where(eq(schema.unternehmen.id, dora.unternehmenId!));
    expect(p).toMatchObject({ name: `${kennung} Platzhalter Immobilien`, quelle: 'hubspot', domain: `${dom}-leer.test` });
    expect(p!.notizen).toContain('Königstraße 1');
    // Freemail: kein Unternehmen
    const emil = nach('Emil');
    expect(emil).toMatchObject({ prio: 'B', unternehmenId: null, email: `emil.${dom}@gmail.com` });
    expect(b.zeilen.find((z) => z.id === `${kennung}-5`)?.grund).toContain('Freemail');
    expect(b.zeilen.find((z) => z.id === `${kennung}-6`)).toMatchObject({ ergebnis: 'uebersprungen' });
    // Audit
    const [audit] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'hubspot-uebernahme')).orderBy(schema.auditLog.id).limit(1);
    expect(audit).toBeTruthy();
  });

  it('zweiter Lauf: alle über die HubSpot-ID bekannt, nichts Neues, nichts verändert', async () => {
    const b = await hubspotUebernehmen(db, ki, tabelle, 'test.xlsx', { trocken: true, abruf, heute: '2026-10-18' });
    expect(b.neu.gesamt).toBe(0);
    expect(b.bekannt).toMatchObject({ gesamt: 5, ueber: { 'hubspot-id': 5 }, ergaenzt: 0, unveraendert: 5 });
  });

  it('kein HubSpot-Export → 422 mit den fehlenden Spalten', async () => {
    await expect(hubspotUebernehmen(db, ki, { ueberschriften: ['Name', 'Firma'], zeilen: [['a', 'b']] }, 'x.xlsx', { trocken: true })).rejects.toThrow(/Datensatz-ID/);
  });
});
