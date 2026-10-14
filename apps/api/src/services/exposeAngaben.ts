/**
 * Reiter „Aus dem Exposé“ (Protokoll 28): gespeicherte Importe (Erfassung v2) eines Objekts/Maklers lesen und einzelne
 * Angaben in ein frei gewähltes gg-Ziel übernehmen — mit Versionsprüfung, Korrektur-Zeile (import_korrekturen) und Audit.
 * Altimporte (v0, v1) erscheinen in der Importliste, liefern aber keine Angaben.
 */
import type { ExposeAngabenAntwort, ExposeUebernahme } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  type Angabe, type AngabeWert, angabenAusImport, type DatensatzFuerAngaben, EXPOSE_V2_SCHEMA, type ExposeV2, type Gelernt, GG_ZIELE, type ImportFuerAngaben,
  telefonNormalisieren, telefonSchluessel, uebernahmeWert, vergleichsStatus, type WeitereKontakte, weitereKontakte, zieleMitStand,
} from '@gg/domain';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { gelerntLesen, lernen } from './exposeBezeichnungen.ts';
import type { Tx } from './tx.ts';
import { versionFortschreiben } from './version.ts';

type Art = 'objekt' | 'makler';
type ImportZeile = typeof schema.exposeImporte.$inferSelect;

const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Schlüssel mit Punkt verschachtelt setzen (`energieausweis.art`), vorhandene Nachbarn bleiben. */
export function detailsSetzen(details: Record<string, unknown>, schluessel: string, wert: unknown): Record<string, unknown> {
  const teile = schluessel.split('.');
  const kopie: Record<string, unknown> = { ...details };
  let akt = kopie;
  for (const t of teile.slice(0, -1)) {
    const naechst = akt[t];
    akt[t] = naechst && typeof naechst === 'object' && !Array.isArray(naechst) ? { ...(naechst as Record<string, unknown>) } : {};
    akt = akt[t] as Record<string, unknown>;
  }
  akt[teile.at(-1)!] = wert;
  return kopie;
}

/** Wert unter einem verschachtelten Schlüssel. */
export function detailsLesen(details: Record<string, unknown> | null | undefined, schluessel: string): unknown {
  return schluessel.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>)[k] : undefined), details ?? {});
}

/** Listen-Ziel: Eintrag anhängen (Array; ein bisheriger Einzeltext wird erster Eintrag), Doppeltes nicht nochmal. */
export function listeAnhaengen(vorher: unknown, eintrag: unknown): unknown[] {
  const liste = Array.isArray(vorher) ? [...vorher] : leer(vorher) ? [] : [vorher];
  if (!liste.some((x) => x === eintrag)) liste.push(eintrag);
  return liste;
}

/** Notiz/Text-Spalte: neue Zeile anhängen. */
export const zeileAnhaengen = (vorher: string | null | undefined, zeile: string) => (leer(vorher) ? zeile : `${vorher!.trimEnd()}\n${zeile}`);

/** Gespeicherte Import-Zeile (v2) → Eingabe für `angabenAusImport`; `belegt` aus der Analyse. */
export function fuerAngaben(z: Pick<ImportZeile, 'id' | 'createdAt' | 'rohdaten' | 'analyse'>): ImportFuerAngaben {
  const belegt = (z.analyse as { belegt?: unknown } | null)?.belegt;
  return { id: z.id, datum: z.createdAt, rohdaten: z.rohdaten as ExposeV2, belegt: Array.isArray(belegt) ? (belegt as (boolean | null)[]) : null };
}

/** Importe zu Objekt/Makler: direkt verknüpft oder über einen Deal; neueste zuerst. */
async function importeZu(db: Db | Tx, art: Art, id: string): Promise<ImportZeile[]> {
  const i = schema.exposeImporte;
  const dealSpalte = art === 'objekt' ? schema.deals.objektId : schema.deals.maklerId;
  const direkt = art === 'objekt' ? i.objektId : i.maklerId;
  const deals = db.select({ id: schema.deals.id }).from(schema.deals).where(eq(dealSpalte, id));
  return db.select().from(i).where(or(eq(direkt, id), inArray(i.dealId, deals))).orderBy(desc(i.createdAt));
}

function antwort(importe: ImportZeile[], art: Art, d: DatensatzFuerAngaben, gelernt: Gelernt): ExposeAngabenAntwort {
  return {
    importe: importe.map((z) => ({ id: z.id, datum: z.createdAt, dateiname: z.dateiname, dealId: z.dealId, schemaVersion: z.schemaVersion })),
    angaben: importe.filter((z) => z.schemaVersion === EXPOSE_V2_SCHEMA).flatMap((z) => angabenAusImport(fuerAngaben(z), art, d, gelernt)),
    ziele: zieleMitStand(art, d),
  };
}

async function objektLesen(db: Db | Tx, id: string) {
  const [o] = await db.select().from(schema.objekte).where(and(eq(schema.objekte.id, id), isNull(schema.objekte.deletedAt)));
  if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
  return o;
}

async function maklerLesen(db: Db | Tx, id: string) {
  const [m] = await db.select().from(schema.makler).where(and(eq(schema.makler.id, id), isNull(schema.makler.deletedAt)));
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  return m;
}

const alsObjektWerte = (o: typeof schema.objekte.$inferSelect): DatensatzFuerAngaben => ({ ...o, details: (o.details as Record<string, unknown> | null) ?? null });
const alsMaklerWerte = (m: typeof schema.makler.$inferSelect): DatensatzFuerAngaben => ({ ...m, weitereKontakte: (m.weitereKontakte as WeitereKontakte | null) ?? null });

export async function objektAngaben(db: Db, objektId: string): Promise<ExposeAngabenAntwort> {
  const o = alsObjektWerte(await objektLesen(db, objektId));
  return antwort(await importeZu(db, 'objekt', objektId), 'objekt', o, await gelerntLesen(db));
}

export async function maklerAngaben(db: Db, maklerId: string): Promise<ExposeAngabenAntwort> {
  const m = alsMaklerWerte(await maklerLesen(db, maklerId));
  return antwort(await importeZu(db, 'makler', maklerId), 'makler', m, await gelerntLesen(db));
}

/** Import muss zu Objekt/Makler gehören und Erfassung v2 tragen; die Angabe muss es darin geben. */
async function angabeSuchen(tx: Tx, art: Art, id: string, e: ExposeUebernahme, d: DatensatzFuerAngaben) {
  const imp = (await importeZu(tx, art, id)).find((z) => z.id === e.importId);
  if (!imp || imp.schemaVersion !== EXPOSE_V2_SCHEMA) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
  const angabe = angabenAusImport(fuerAngaben(imp), art, d, await gelerntLesen(tx)).find((a) => a.feld === e.feld);
  if (!angabe) throw new FachFehler(404, `Angabe „${e.feld}“ nicht im Exposé-Import`);
  return { imp, angabe };
}

type Aktion = 'uebernommen' | 'ersetzt';
interface Protokoll { merken: boolean; art: Art; bezugId: string; imp: ImportZeile; angabe: Angabe; ziel: string; vorher: unknown; aktion: Aktion }

async function korrekturSchreiben(tx: Tx, p: Protokoll) {
  await tx.insert(schema.importKorrekturen).values({
    id: crypto.randomUUID(), importId: p.imp.id, art: p.art, bezugId: p.bezugId, feld: p.angabe.feld, ziel: p.ziel,
    kiWert: p.angabe.wert, handWert: leer(p.vorher) ? null : (p.vorher as object), aktion: p.aktion,
    konfidenz: null, promptVersion: p.imp.promptVersion,
  });
  // Wörterbuch: nur Angaben, die noch kein Mapping hatten (Protokoll 30 §10)
  if (p.merken && p.angabe.feld.startsWith('angaben.') && p.angabe.zuordnung !== 'zugeordnet') await lernen(tx, p.angabe.bezeichnung, p.ziel);
}

async function auditBuchen(db: Db, p: Protokoll, neu: unknown) {
  await auditSchreiben(db, {
    type: 'expose-uebernahme', entity: p.art, entityId: p.bezugId, action: p.aktion, fieldName: p.ziel,
    oldValue: leer(p.vorher) ? null : p.vorher, newValue: neu, source: 'expose-angaben',
    metadata: { importId: p.imp.id, feld: p.angabe.feld },
  });
}

const alsWert = (v: unknown): AngabeWert =>
  v === null || v === undefined ? null : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v);

/** Einzelwert-Ziel: belegt und abweichend ohne `ersetzen` → 409 mit dem aktuellen Wert (die Oberfläche fragt dann nach). */
function freiOderErsetzen(label: string, neu: unknown, vorher: unknown, ersetzen: boolean, telefon = false): Aktion {
  if (leer(vorher)) return 'uebernommen';
  const gleich = telefon && typeof neu === 'string' && typeof vorher === 'string'
    ? telefonSchluessel(neu) === telefonSchluessel(vorher)
    : vergleichsStatus(alsWert(neu), alsWert(vorher)) === 'gleich';
  if (gleich) return 'uebernommen';
  if (!ersetzen) throw new FachFehler(409, `${label} enthält bereits einen anderen Wert`, { aktuell: alsWert(vorher) });
  return 'ersetzt';
}

const PASST_NICHT = 'Wert passt nicht zu diesem Feld';

export async function objektUebernahme(db: Db, objektId: string, e: ExposeUebernahme) {
  const { ergebnis, protokoll, neu } = await db.transaction(async (tx) => {
    const version = await versionFortschreiben(tx, schema.objekte, objektId, e.version, 'Objekt');
    const o = await objektLesen(tx, objektId);
    const { imp, angabe } = await angabeSuchen(tx, 'objekt', objektId, e, alsObjektWerte(o));
    const u = uebernahmeWert(angabe, e.ziel, 'objekt');
    if (!u) throw new FachFehler(422, PASST_NICHT);

    let vorher: unknown; let aktion: Aktion = 'uebernommen'; let wert: unknown = u.wert;
    if (u.notizText !== undefined) {
      vorher = o.notizen;
      wert = zeileAnhaengen(o.notizen, u.notizText);
      await tx.update(schema.objekte).set({ notizen: wert as string }).where(eq(schema.objekte.id, objektId));
    } else if (u.spalte) {
      vorher = (o as Record<string, unknown>)[u.spalte];
      if (u.liste) wert = zeileAnhaengen(vorher as string | null, String(u.wert));
      else aktion = freiOderErsetzen(zielLabel(e.ziel), u.wert, vorher, e.ersetzen ?? false);
      await tx.update(schema.objekte).set({ [u.spalte]: wert }).where(eq(schema.objekte.id, objektId));
    } else if (u.detailsSchluessel) {
      const details = (o.details as Record<string, unknown> | null) ?? {};
      vorher = detailsLesen(details, u.detailsSchluessel);
      if (u.liste) wert = listeAnhaengen(vorher, u.wert);
      else aktion = freiOderErsetzen(zielLabel(e.ziel), u.wert, vorher, e.ersetzen ?? false);
      await tx.update(schema.objekte).set({ details: detailsSetzen(details, u.detailsSchluessel, wert) }).where(eq(schema.objekte.id, objektId));
    } else throw new FachFehler(422, PASST_NICHT);

    const protokoll: Protokoll = { merken: e.merken !== false, art: 'objekt', bezugId: objektId, imp, angabe, ziel: e.ziel, vorher, aktion };
    await korrekturSchreiben(tx, protokoll);
    return { ergebnis: { id: objektId, version }, protokoll, neu: wert };
  });
  await auditBuchen(db, protokoll, neu);
  return ergebnis;
}

/** Bezeichnung des Ziels für die 409-Meldung. */
const zielLabel = (ziel: string) => GG_ZIELE[ziel]?.label ?? ziel;

const TELEFON = new Set(['tel', 'mobil', 'festnetz']);

export async function maklerUebernahme(db: Db, maklerId: string, e: ExposeUebernahme) {
  const { ergebnis, protokoll, neu } = await db.transaction(async (tx) => {
    const version = await versionFortschreiben(tx, schema.makler, maklerId, e.version, 'Makler');
    const m = await maklerLesen(tx, maklerId);
    const { imp, angabe } = await angabeSuchen(tx, 'makler', maklerId, e, alsMaklerWerte(m));
    const u = uebernahmeWert(angabe, e.ziel, 'makler');
    // Am Makler gibt es keine Notizspalte; Notizen laufen über die Kommunikation
    if (!u?.spalte) throw new FachFehler(422, PASST_NICHT);

    const vorher = (m as Record<string, unknown>)[u.spalte];
    let wert: unknown = u.wert;
    let aktion: Aktion = 'uebernommen';
    if (u.spalte === 'weitereKontakte') {
      // Zusammenführen statt überschreiben; der Hauptkontakt bleibt außen vor
      const alt = (m.weitereKontakte as WeitereKontakte | null) ?? { namen: [], telefonnummern: [], emails: [] };
      const dazu = u.wert as WeitereKontakte;
      wert = weitereKontakte(
        { name: m.name, tel: m.tel, mobil: m.mobil, festnetz: m.festnetz, email: m.email },
        { namen: [...alt.namen, ...dazu.namen], telefonnummern: [...alt.telefonnummern, ...dazu.telefonnummern], emails: [...alt.emails, ...dazu.emails] },
      );
    } else {
      const telefon = TELEFON.has(u.spalte);
      if (telefon && typeof wert === 'string') wert = telefonNormalisieren(wert);
      aktion = freiOderErsetzen(zielLabel(e.ziel), wert, vorher, e.ersetzen ?? false, telefon);
    }
    await tx.update(schema.makler).set({ [u.spalte]: wert }).where(eq(schema.makler.id, maklerId));
    const protokoll: Protokoll = { merken: e.merken !== false, art: 'makler', bezugId: maklerId, imp, angabe, ziel: e.ziel, vorher, aktion };
    await korrekturSchreiben(tx, protokoll);
    return { ergebnis: { id: maklerId, version }, protokoll, neu: wert };
  });
  await auditBuchen(db, protokoll, neu);
  return ergebnis;
}
