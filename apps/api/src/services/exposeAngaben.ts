/**
 * Reiter „Aus dem Exposé“ (Protokoll 27, T4): gespeicherte Importe eines Objekts/Maklers lesen und einzelne Angaben
 * übernehmen — mit Versionsprüfung, Korrektur-Zeile (import_korrekturen) und Audit.
 */
import type { ExposeAngabenAntwort, ExposeUebernahme } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  type Angabe, angabenAusImport, angabenAusImportMakler, EXPOSE_V1_SCHEMA, type ExposeV1, type ImportFuerAngaben, type MaklerFuerAngaben,
  type ObjektFuerAngaben, telefonNormalisieren, uebernahmeWert, type WeitereKontakte, weitereKontakte,
} from '@gg/domain';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import type { Tx } from './tx.ts';
import { versionFortschreiben } from './version.ts';

type Art = 'objekt' | 'makler';
type ImportZeile = typeof schema.exposeImporte.$inferSelect;

const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

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

/** Alle `details`-Ziele eines v1-Imports (Allowlist ZIEL_OBJEKT) als verschachteltes Objekt — für ein neu angelegtes Objekt. */
export function objektDetailsAusV1(id: string, v1: ExposeV1): Record<string, unknown> {
  let details: Record<string, unknown> = {};
  for (const a of angabenAusImport({ id, datum: '', rohdaten: v1 }, {})) {
    const u = uebernahmeWert(a, 'details');
    if (u?.detailsSchluessel && !leer(u.wert)) details = detailsSetzen(details, u.detailsSchluessel, u.wert);
  }
  return details;
}

const fuerAngaben = (z: ImportZeile): ImportFuerAngaben => ({
  id: z.id, datum: z.createdAt, rohdaten: z.rohdaten as ExposeV1,
  belegt: ((z.analyse as { belegt?: Record<string, boolean> } | null)?.belegt) ?? null,
});

/** Importe zu Objekt/Makler: direkt verknüpft oder über einen Deal; neueste zuerst. */
async function importeZu(db: Db | Tx, art: Art, id: string): Promise<ImportZeile[]> {
  const i = schema.exposeImporte;
  const dealSpalte = art === 'objekt' ? schema.deals.objektId : schema.deals.maklerId;
  const direkt = art === 'objekt' ? i.objektId : i.maklerId;
  const deals = db.select({ id: schema.deals.id }).from(schema.deals).where(eq(dealSpalte, id));
  return db.select().from(i).where(or(eq(direkt, id), inArray(i.dealId, deals))).orderBy(desc(i.createdAt));
}

function antwort(importe: ImportZeile[], angaben: (imp: ImportFuerAngaben) => Angabe[]): ExposeAngabenAntwort {
  return {
    importe: importe.map((z) => ({ id: z.id, datum: z.createdAt, dateiname: z.dateiname, dealId: z.dealId, schemaVersion: z.schemaVersion })),
    angaben: importe.filter((z) => z.schemaVersion === EXPOSE_V1_SCHEMA).flatMap((z) => angaben(fuerAngaben(z))),
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

const alsObjektWerte = (o: typeof schema.objekte.$inferSelect): ObjektFuerAngaben => ({ ...o, details: (o.details as Record<string, unknown> | null) ?? null });
const alsMaklerWerte = (m: typeof schema.makler.$inferSelect): MaklerFuerAngaben => ({ ...m, weitereKontakte: (m.weitereKontakte as WeitereKontakte | null) ?? null });

export async function objektAngaben(db: Db, objektId: string): Promise<ExposeAngabenAntwort> {
  const o = alsObjektWerte(await objektLesen(db, objektId));
  return antwort(await importeZu(db, 'objekt', objektId), (imp) => angabenAusImport(imp, o));
}

export async function maklerAngaben(db: Db, maklerId: string): Promise<ExposeAngabenAntwort> {
  const m = alsMaklerWerte(await maklerLesen(db, maklerId));
  return antwort(await importeZu(db, 'makler', maklerId), (imp) => angabenAusImportMakler(imp, m));
}

/** Import muss zu Objekt/Makler gehören und Schema v1 tragen; die Angabe muss es darin geben. */
async function angabeSuchen(tx: Tx, art: Art, id: string, e: ExposeUebernahme, angaben: (imp: ImportFuerAngaben) => Angabe[]) {
  const imp = (await importeZu(tx, art, id)).find((z) => z.id === e.importId);
  if (!imp || imp.schemaVersion !== EXPOSE_V1_SCHEMA) throw new FachFehler(404, 'Exposé-Import nicht gefunden');
  const angabe = angaben(fuerAngaben(imp)).find((a) => a.feld === e.feld);
  if (!angabe) throw new FachFehler(404, `Angabe „${e.feld}“ nicht im Exposé-Import`);
  return { imp, angabe };
}

interface Protokoll { art: Art; bezugId: string; imp: ImportZeile; angabe: Angabe; ziel: string; vorher: unknown; aktion: 'uebernommen' | 'ersetzt' }

async function korrekturSchreiben(tx: Tx, p: Protokoll) {
  await tx.insert(schema.importKorrekturen).values({
    id: crypto.randomUUID(), importId: p.imp.id, art: p.art, bezugId: p.bezugId, feld: p.angabe.feld, ziel: p.ziel,
    kiWert: p.angabe.wert, handWert: leer(p.vorher) ? null : (p.vorher as object), aktion: p.aktion,
    konfidenz: p.angabe.konfidenz, promptVersion: p.imp.promptVersion,
  });
}

async function auditBuchen(db: Db, p: Protokoll, neu: unknown) {
  await auditSchreiben(db, {
    type: 'expose-uebernahme', entity: p.art, entityId: p.bezugId, action: p.aktion, fieldName: p.ziel,
    oldValue: leer(p.vorher) ? null : p.vorher, newValue: neu, source: 'expose-angaben',
    metadata: { importId: p.imp.id, feld: p.angabe.feld },
  });
}

/** Spalte: belegt und abweichend ohne `ersetzen` → 409 mit dem aktuellen Wert (die Oberfläche fragt dann nach). */
function spalteFreiOderErsetzen(angabe: Angabe, ersetzen: boolean): 'uebernommen' | 'ersetzt' {
  if (angabe.ziel.status !== 'abweichend') return 'uebernommen';
  if (!ersetzen) throw new FachFehler(409, `${angabe.ziel.label ?? 'Feld'} enthält bereits einen anderen Wert`, { aktuell: angabe.ziel.aktuell });
  return 'ersetzt';
}

export async function objektUebernahme(db: Db, objektId: string, e: ExposeUebernahme) {
  const { ergebnis, protokoll, neu } = await db.transaction(async (tx) => {
    const version = await versionFortschreiben(tx, schema.objekte, objektId, e.version, 'Objekt');
    const o = await objektLesen(tx, objektId);
    const { imp, angabe } = await angabeSuchen(tx, 'objekt', objektId, e, (i) => angabenAusImport(i, alsObjektWerte(o)));
    const u = uebernahmeWert(angabe, e.ziel);
    if (!u) throw new FachFehler(422, `„${angabe.bezeichnung}“ kann nicht als ${e.ziel} übernommen werden`);

    let ziel: string; let vorher: unknown; let aktion: Protokoll['aktion'] = 'uebernommen'; let wert: unknown = u.wert;
    if (u.spalte) {
      ziel = u.spalte;
      vorher = (o as Record<string, unknown>)[u.spalte];
      aktion = spalteFreiOderErsetzen(angabe, e.ersetzen ?? false);
      await tx.update(schema.objekte).set({ [u.spalte]: u.wert }).where(eq(schema.objekte.id, objektId));
    } else if (u.detailsSchluessel) {
      ziel = `details.${u.detailsSchluessel}`;
      const details = (o.details as Record<string, unknown> | null) ?? {};
      vorher = u.detailsSchluessel.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), details);
      if (!leer(vorher) && vorher !== u.wert) aktion = 'ersetzt';
      await tx.update(schema.objekte).set({ details: detailsSetzen(details, u.detailsSchluessel, u.wert) }).where(eq(schema.objekte.id, objektId));
    } else {
      ziel = 'notizen';
      vorher = o.notizen;
      wert = leer(o.notizen) ? u.notizText! : `${o.notizen!.trimEnd()}\n${u.notizText}`;
      await tx.update(schema.objekte).set({ notizen: wert as string }).where(eq(schema.objekte.id, objektId));
    }
    const protokoll: Protokoll = { art: 'objekt', bezugId: objektId, imp, angabe, ziel, vorher, aktion };
    await korrekturSchreiben(tx, protokoll);
    return { ergebnis: { id: objektId, version }, protokoll, neu: wert };
  });
  await auditBuchen(db, protokoll, neu);
  return ergebnis;
}

const TELEFON = new Set(['tel', 'mobil', 'festnetz']);

export async function maklerUebernahme(db: Db, maklerId: string, e: ExposeUebernahme) {
  if (e.ziel !== 'spalte') throw new FachFehler(422, 'Am Makler können Exposé-Angaben nur in ein Feld übernommen werden');
  const { ergebnis, protokoll, neu } = await db.transaction(async (tx) => {
    const version = await versionFortschreiben(tx, schema.makler, maklerId, e.version, 'Makler');
    const m = await maklerLesen(tx, maklerId);
    const { imp, angabe } = await angabeSuchen(tx, 'makler', maklerId, e, (i) => angabenAusImportMakler(i, alsMaklerWerte(m)));
    const u = uebernahmeWert(angabe, 'spalte');
    if (!u?.spalte) throw new FachFehler(422, `„${angabe.bezeichnung}“ hat kein Feld am Makler`);

    const vorher = (m as Record<string, unknown>)[u.spalte];
    let wert: unknown = u.wert;
    let aktion: Protokoll['aktion'] = 'uebernommen';
    if (u.spalte === 'weitereKontakte') {
      // Zusammenführen statt überschreiben; der Hauptkontakt bleibt außen vor
      const alt = (m.weitereKontakte as WeitereKontakte | null) ?? { namen: [], telefonnummern: [], emails: [] };
      const dazu = u.wert as WeitereKontakte;
      wert = weitereKontakte(
        { name: m.name, tel: m.tel, mobil: m.mobil, festnetz: m.festnetz, email: m.email },
        { namen: [...alt.namen, ...dazu.namen], telefonnummern: [...alt.telefonnummern, ...dazu.telefonnummern], emails: [...alt.emails, ...dazu.emails] },
      );
    } else {
      aktion = spalteFreiOderErsetzen(angabe, e.ersetzen ?? false);
      if (TELEFON.has(u.spalte) && typeof wert === 'string') wert = telefonNormalisieren(wert);
    }
    await tx.update(schema.makler).set({ [u.spalte]: wert }).where(eq(schema.makler.id, maklerId));
    const protokoll: Protokoll = { art: 'makler', bezugId: maklerId, imp, angabe, ziel: u.spalte, vorher, aktion };
    await korrekturSchreiben(tx, protokoll);
    return { ergebnis: { id: maklerId, version }, protokoll, neu: wert };
  });
  await auditBuchen(db, protokoll, neu);
  return ergebnis;
}
