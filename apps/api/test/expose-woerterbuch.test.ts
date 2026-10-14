import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { angabenAusImport, bezeichnungSchluessel, EXPOSE_V2_SCHEMA, type ExposeV2, exposeVorbereiten, zuordnen } from '@gg/domain';
import { kiAttrappe, speicherImSpeicher, testExpose } from '@gg/integrations';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { exposeV2Beispiel } from '../../../packages/domain/test/fixtures/expose-v2-beispiel.ts';
import { createApp } from '../src/app.ts';
import { lernen } from '../src/services/exposeBezeichnungen.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

const erfassung = (kennung: string): ExposeV2 => {
  const v2 = exposeV2Beispiel();
  return { ...v2, angaben: v2.angaben.map((a) => ({ ...a, wert: a.wert.replace('Musterweg', `${kennung}weg`) })) };
};
/** Indizes der Beispiel-Erfassung: 2 Kaufpreis (Mapping) · 18 Instandhaltungsrücklage · 19 Besichtigung (beide ohne Mapping) */
const BEZ_18 = 'Instandhaltungsrücklage';
const BEZ_19 = 'Besichtigung';
const SCHLUESSEL = [bezeichnungSchluessel(BEZ_18), bezeichnungSchluessel(BEZ_19)];

describe.skipIf(!url)('Exposé-Wörterbuch: lernt beim Zuordnen (Prüfseite und Reiter)', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true, texterkennung: null } });
  mitAusgeliefertenStandards(url!);
  const kennung = `Wb${Date.now()}`;
  const importIds: string[] = [];
  const angelegt: { deals: string[]; objekte: string[]; makler: string[] } = { deals: [], objekte: [], makler: [] };

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const post = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const liste = async () => ((await lies(app.request('/api/expose/bezeichnungen'))) as any[]).filter((x) => SCHLUESSEL.includes(x.schluessel));
  const aufraeumen = () => db.delete(schema.exposeBezeichnungen).where(inArray(schema.exposeBezeichnungen.schluessel, SCHLUESSEL));

  /** Import anlegen und per Deal-Anlage übernehmen; `zuordnungen` wie von der Prüfseite. */
  async function importUebernehmen(name: string, zuordnungen?: { feld: string; ziel: string; merken?: boolean }[]) {
    const importId = crypto.randomUUID();
    importIds.push(importId);
    const v2 = erfassung(name);
    const belegt = v2.angaben.map(() => null);
    await db.insert(schema.exposeImporte).values({
      id: importId, dateiname: `${name}.pdf`, schemaVersion: EXPOSE_V2_SCHEMA, promptVersion: 'test-v2', status: 'analysiert', rohdaten: v2, analyse: { belegt, belegQuote: null, warnungen: [] },
    });
    const { key } = await lies(app.request('/api/expose/eingang', { method: 'POST', body: testExpose(name) }));
    const v = exposeVorbereiten(zuordnen(v2, belegt).pruefdaten);
    const res = await post('/api/expose/uebernehmen', {
      key, dateiname: `${name}.pdf`, extrahiert: {}, importId, ...(zuordnungen ? { zuordnungen } : {}),
      objekt: { daten: v.objekt }, makler: { daten: v.makler }, deal: v.deal,
    });
    expect(res.status).toBe(201);
    const r = (await res.json()) as { dealId: string; objektId: string; maklerId: string | null };
    angelegt.deals.push(r.dealId); angelegt.objekte.push(r.objektId); if (r.maklerId) angelegt.makler.push(r.maklerId);
    return { importId, ...r };
  }

  beforeEach(aufraeumen);
  afterAll(async () => {
    await aufraeumen();
    await db.delete(schema.importKorrekturen).where(inArray(schema.importKorrekturen.importId, importIds));
    await db.delete(schema.exposeImporte).where(inArray(schema.exposeImporte.id, importIds));
    if (angelegt.deals.length) await db.delete(schema.deals).where(inArray(schema.deals.id, angelegt.deals));
    if (angelegt.objekte.length) await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.entityId, [...angelegt.objekte, ...angelegt.makler]));
    await client.end();
  });

  it('Prüfseite: Angaben ohne Mapping werden gelernt (auch bei Formularzielen), „nicht merken“ und Notizen nicht, Mapping-Angaben nie', async () => {
    await importUebernehmen(`${kennung}a`, [
      { feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage', merken: false },
      { feld: 'angaben.19', ziel: 'objekt.lagebeschreibung' },
      { feld: 'angaben.2', ziel: 'objekt.angebotspreis' },
    ]);
    const l = await liste();
    expect(l).toEqual([expect.objectContaining({ schluessel: bezeichnungSchluessel(BEZ_19), bezeichnung: BEZ_19, ziel: 'objekt.lagebeschreibung', anzahl: 1 })]);
    // Kaufpreis hat ein Mapping und wird nicht ins Wörterbuch geschrieben
    expect((await lies(app.request('/api/expose/bezeichnungen'))).some((x: any) => x.schluessel === bezeichnungSchluessel('Kaufpreis'))).toBe(false);
  });

  it('Prüfseite: Standard ist „merken“; Notizen werden nicht gelernt', async () => {
    await importUebernehmen(`${kennung}b`, [{ feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage' }, { feld: 'angaben.19', ziel: 'notizen' }]);
    expect((await liste()).map((x) => [x.schluessel, x.ziel])).toEqual([[bezeichnungSchluessel(BEZ_18), 'details.instandhaltungsruecklage']]);
  });

  it('Reiter „Aus dem Exposé“: lernt beim Übernehmen, zählt hoch, merken:false lernt nichts', async () => {
    const { importId, objektId } = await importUebernehmen(`${kennung}c`);
    const version = async () => (await lies(app.request(`/api/objekte/${objektId}`))).version as number;
    const senden = async (b: Record<string, unknown>) => post(`/api/objekte/${objektId}/expose-uebernahme`, { importId, version: await version(), ...b });

    expect((await senden({ feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage', merken: false })).status).toBe(200);
    expect(await liste()).toEqual([]);

    expect((await senden({ feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage', ersetzen: true })).status).toBe(200);
    expect(await liste()).toEqual([expect.objectContaining({ ziel: 'details.instandhaltungsruecklage', anzahl: 1, bezeichnung: BEZ_18 })]);
    // Ab jetzt ordnet das Wörterbuch die Angabe selbst zu; erneutes Lernen zählt nur, wenn sie noch ohne Mapping war (hier: direkt über den Dienst)
    await lernen(db, BEZ_18, 'details.instandhaltungsruecklage');
    expect((await liste())[0]).toMatchObject({ anzahl: 2, bezeichnung: BEZ_18 });
    await lernen(db, BEZ_18.toUpperCase(), 'details.nutzflaeche');
    expect((await liste())[0]).toMatchObject({ anzahl: 3, ziel: 'details.nutzflaeche', bezeichnung: BEZ_18.toUpperCase() });

    // Angabe mit Mapping (Kaufpreis): kein Eintrag
    await senden({ feld: 'angaben.2', ziel: 'objekt.angebotspreis', ersetzen: true });
    expect((await lies(app.request('/api/expose/bezeichnungen'))).some((x: any) => x.schluessel === bezeichnungSchluessel('Kaufpreis'))).toBe(false);
  });

  it('Liste und Löschen', async () => {
    const { importId, objektId } = await importUebernehmen(`${kennung}d`);
    const v = (await lies(app.request(`/api/objekte/${objektId}`))).version as number;
    await post(`/api/objekte/${objektId}/expose-uebernahme`, { importId, version: v, feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage' });
    const s = bezeichnungSchluessel(BEZ_18);
    expect((await liste()).map((x) => x.schluessel)).toEqual([s]);
    const weg = await app.request(`/api/expose/bezeichnungen/${encodeURIComponent(s)}`, { method: 'DELETE' });
    expect(weg.status).toBe(200);
    expect(await liste()).toEqual([]);
    expect((await app.request(`/api/expose/bezeichnungen/${encodeURIComponent(s)}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('Wirkung: Gelerntes erreicht die Zuordnung eines zweiten Imports (Weitergabe an die Domain)', async () => {
    const { importId, objektId } = await importUebernehmen(`${kennung}e`);
    const v = (await lies(app.request(`/api/objekte/${objektId}`))).version as number;
    const r = await post(`/api/objekte/${objektId}/expose-uebernahme`, { importId, version: v, feld: 'angaben.19', ziel: 'details.nutzungsart' });
    expect(r.status).toBe(200);
    expect((await liste())[0]).toMatchObject({ ziel: 'details.nutzungsart' });

    // Ob die Domain das Gelernte schon auswertet, entscheidet dieselbe Funktion wie in der API
    const gelernt = { [bezeichnungSchluessel(BEZ_19)]: 'details.nutzungsart' };
    const [imp] = await db.select().from(schema.exposeImporte).where(eq(schema.exposeImporte.id, importId));
    const fuer = { id: importId, datum: imp!.createdAt, rohdaten: imp!.rohdaten as ExposeV2, belegt: null };
    const direkt = angabenAusImport(fuer, 'objekt', {}, gelernt).find((a) => a.feld === 'angaben.19')!;
    const ohne = angabenAusImport(fuer, 'objekt', {}).find((a) => a.feld === 'angaben.19')!;
    const ueberApi = ((await lies(app.request(`/api/objekte/${objektId}/expose-angaben`))).angaben as any[]).find((a) => a.importId === importId && a.feld === 'angaben.19');
    // Die API muss genau das liefern, was die Domain mit dem Gelernten ergibt (heute: unverändert, sobald die Wirkung da ist: zugeordnet)
    expect(ueberApi.zuordnung).toBe(direkt.zuordnung);
    expect(ueberApi.ziel.feld).toBe(direkt.ziel.feld);
    if (direkt.zuordnung !== ohne.zuordnung) {
      expect(ueberApi.zuordnung).toBe('zugeordnet');
      expect(ueberApi.ziel.feld).toBe('details.nutzungsart');
    }
  });
});
