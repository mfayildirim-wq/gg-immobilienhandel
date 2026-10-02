import type { PapierkorbEintrag } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  papierkorbAbgelaufen, papierkorbBezeichnung, papierkorbLoeschfolge, papierkorbVerwiesenHinweis, PAPIERKORB_ABHAENGIG, PAPIERKORB_BEREICHE,
  type PapierkorbBereich,
} from '@gg/domain';
import { BUCKETS, type Dateispeicher, dokumentSchluessel } from '@gg/integrations';
import { and, eq, inArray, is, isNotNull, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { FachFehler } from '../fehler.ts';
import type { Tx } from './tx.ts';

/** Je Bereich: Tabelle und die Felder, aus denen die Bezeichnung entsteht (wie bezeichnung() der alten Ansicht). */
const TABELLEN = {
  objekte: schema.objekte,
  makler: schema.makler,
  deals: schema.deals,
  projekte: schema.projekte,
  vertriebslisten: schema.vertriebslisten,
  praesentationen: schema.finanzpraesentationen,
  kundenkalkulationen: schema.kundenkalkulationen,
  begleitscheine: schema.begleitscheine,
} as const;

const BEREICHE = PAPIERKORB_BEREICHE.map((b) => b.bereich);
const bereichVon = (t: PgTable) => BEREICHE.find((b) => TABELLEN[b] === t);

/**
 * Fremdschlüssel auf Papierkorb-Tabellen, die nicht mitlöschen: solange eine solche Zeile da ist, lehnt Postgres das
 * Entfernen der Eltern-Zeile ab (23503). Aus dem Schema abgelesen, damit ein neuer Fremdschlüssel von selbst mitzählt.
 * Stand: deals und begleitscheine → objekte; kundenkalkulationen, finanzpraesentationen und vertriebslisten → deals.
 * Davon hält nur deals → objekte das Objekt fest; die übrigen vier sind Abhängiges und gehen mit.
 */
const VERWEISE = (Object.values(schema) as unknown[]).filter((t): t is PgTable => is(t, PgTable)).flatMap((tabelle) => {
  const { name, foreignKeys } = getTableConfig(tabelle);
  return foreignKeys.flatMap((fk) => {
    const { columns, foreignTable } = fk.reference();
    const eltern = bereichVon(foreignTable);
    const loeschtMit = fk.onDelete === 'cascade' || fk.onDelete === 'set null' || fk.onDelete === 'set default';
    if (!eltern || loeschtMit) return [];
    const kind = bereichVon(tabelle) ?? name;
    // Abhängiges (PAPIERKORB_ABHAENGIG) räumt der Dienst selbst mit ab; alles andere hält die Eltern-Zeile fest
    const gehtMit = PAPIERKORB_ABHAENGIG.some((a) => a.kind === kind && a.eltern === eltern);
    return [{ kind, eltern, tabelle, spalte: columns[0]!, gehtMit }];
  });
});
/** Kinder vor Eltern — sonst scheitert das Entfernen, sobald beide im Papierkorb liegen. */
const LOESCHFOLGE = papierkorbLoeschfolge(BEREICHE, VERWEISE);

const istBereich = (b: string): b is PapierkorbBereich => b in TABELLEN;
const bereichPruefen = (b: string): PapierkorbBereich => {
  if (!istBereich(b)) throw new FachFehler(400, `Unbekannter Bereich „${b}“`);
  return b;
};

/** Objekt- und Deal-Adresse kommen aus dem verknüpften Objekt, damit die Zeile lesbar bleibt. */
async function eintraege(db: Db | Tx, bereich: PapierkorbBereich): Promise<PapierkorbEintrag[]> {
  const t = TABELLEN[bereich];
  const zeilen = await db.select().from(t).where(isNotNull(t.deletedAt));
  const objekte = new Map<string, { strasse: string | null; hausnr: string | null; stadt: string | null }>();
  if (bereich === 'deals' || bereich === 'begleitscheine') {
    for (const o of await db.select({ id: schema.objekte.id, strasse: schema.objekte.strasse, hausnr: schema.objekte.hausnr, stadt: schema.objekte.stadt }).from(schema.objekte)) {
      objekte.set(o.id, o);
    }
  }
  return zeilen.map((z) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- je Tabelle andere Felder
    const r = z as any;
    const objekt = r.objektId ? objekte.get(r.objektId) : undefined;
    // Reihenfolge wie bezeichnung() der alten Ansicht: name, adresse, strasse, … — die Hausnummer stand dort nie dabei
    const felder = [r.name, r.adresse, r.strasse, r.projektTitel, r.bankName, objekt?.strasse ?? null];
    return { bereich, id: r.id as string, bezeichnung: papierkorbBezeichnung(felder, r.id), geloeschtAm: r.deletedAt as string };
  });
}

/** Dateien eines endgültig entfernten Deals aus dem Bucket räumen (purgeDealDocs); scheitert still. */
async function dealDateienRaeumen(db: Db | Tx, speicher: Dateispeicher | undefined, dealId: string) {
  if (!speicher) return;
  try {
    const dokumente = await db.select().from(schema.dokumente).where(eq(schema.dokumente.dealId, dealId));
    const schluessel = dokumente.map((d) => d.storageKey ?? dokumentSchluessel(dealId, d.id, d.dateiname ?? ''));
    if (schluessel.length) await speicher.loeschen(BUCKETS.dealDocs, schluessel);
  } catch (e) {
    console.warn('[papierkorb] Dateien des Deals nicht entfernt:', dealId, e);
  }
}

/** Auf welche der Einträge verweist noch etwas, das weder mitlöscht noch mitgeht — und aus welchem Bereich? */
async function nochVerwiesen(db: Db | Tx, bereich: PapierkorbBereich, ids: string[]) {
  const verwiesen = new Map<string, string>();
  if (!ids.length) return verwiesen;
  for (const v of VERWEISE.filter((x) => x.eltern === bereich && !x.gehtMit)) {
    const zeilen = await db.selectDistinct({ id: v.spalte }).from(v.tabelle).where(inArray(v.spalte, ids));
    for (const z of zeilen) if (!verwiesen.has(z.id as string)) verwiesen.set(z.id as string, v.kind);
  }
  return verwiesen;
}

/**
 * Entfernt, worauf nichts mehr verweist — samt Abhängigem, ob das im Papierkorb liegt oder nicht.
 * Zurück kommt, was liegen bleibt: ID → Bereich, aus dem noch etwas darauf verweist.
 */
async function endgueltigEntfernen(db: Db | Tx, speicher: Dateispeicher | undefined, bereich: PapierkorbBereich, ids: string[]) {
  const bleibt = await nochVerwiesen(db, bereich, ids);
  const frei = ids.filter((id) => !bleibt.has(id));
  if (bereich === 'deals') for (const id of frei) await dealDateienRaeumen(db, speicher, id);
  if (frei.length) for (const v of VERWEISE.filter((x) => x.eltern === bereich && x.gehtMit)) await db.delete(v.tabelle).where(inArray(v.spalte, frei));
  const t = TABELLEN[bereich];
  for (const id of frei) await db.delete(t).where(eq(t.id, id));
  return bleibt;
}

/**
 * Papierkorb lesen. Vorher wird aufgeräumt, was länger als 30 Tage liegt (alt: beim Start der App,
 * hier beim Öffnen — dasselbe Ergebnis, ohne Hintergrundlauf).
 */
export async function papierkorbListe(db: Db | Tx, speicher?: Dateispeicher): Promise<PapierkorbEintrag[]> {
  const jeBereich = new Map<PapierkorbBereich, PapierkorbEintrag[]>();
  for (const bereich of LOESCHFOLGE) {
    const gefunden = await eintraege(db, bereich);
    const abgelaufen = new Set(gefunden.filter((e) => papierkorbAbgelaufen(e.geloeschtAm)).map((e) => e.id));
    // Abgelaufenes, auf das noch etwas verweist, bleibt in der Liste, bis der Verweis weg ist
    const bleibt = await endgueltigEntfernen(db, speicher, bereich, [...abgelaufen]);
    jeBereich.set(bereich, gefunden.filter((e) => !abgelaufen.has(e.id) || bleibt.has(e.id)));
  }
  return BEREICHE.flatMap((bereich) => jeBereich.get(bereich) ?? []);
}

/** trashRestore: Markierung entfernen. Ein Deal bringt sein Objekt mit zurück — sonst hinge er an einem Objekt im Papierkorb. */
export async function papierkorbWiederherstellen(db: Db, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  return db.transaction(async (tx) => {
    const [zeile] = await tx.update(t).set({ deletedAt: null }).where(and(eq(t.id, id), isNotNull(t.deletedAt))).returning({ id: t.id });
    if (!zeile) throw new FachFehler(404, 'Eintrag liegt nicht im Papierkorb');
    if (b === 'deals') {
      const objektDesDeals = tx.select({ id: schema.deals.objektId }).from(schema.deals).where(eq(schema.deals.id, id));
      await tx.update(schema.objekte).set({ deletedAt: null }).where(and(inArray(schema.objekte.id, objektDesDeals), isNotNull(schema.objekte.deletedAt)));
    }
    return { bereich: b, id };
  });
}

/** trashPermanentDelete: endgültig entfernen (samt Dateien eines Deals). */
export async function papierkorbEndgueltig(db: Db, speicher: Dateispeicher | undefined, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  const [zeile] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), isNotNull(t.deletedAt)));
  if (!zeile) throw new FachFehler(404, 'Eintrag liegt nicht im Papierkorb');
  const verweistNoch = (await endgueltigEntfernen(db, speicher, b, [id])).get(id);
  if (verweistNoch) throw new FachFehler(409, papierkorbVerwiesenHinweis(verweistNoch));
  return { bereich: b, id };
}

/** trashEmpty: alles endgültig entfernen. Worauf noch etwas verweist, bleibt liegen und wird als `uebrig` gezählt. */
export async function papierkorbLeeren(db: Db | Tx, speicher?: Dateispeicher) {
  let entfernt = 0;
  let uebrig = 0;
  for (const bereich of LOESCHFOLGE) {
    const ids = (await eintraege(db, bereich)).map((e) => e.id);
    const bleibt = await endgueltigEntfernen(db, speicher, bereich, ids);
    entfernt += ids.length - bleibt.size;
    uebrig += bleibt.size;
  }
  return { entfernt, uebrig };
}

/** Marke setzen (softDelete) — für Bereiche ohne eigenen Löschweg. */
export async function papierkorbLegen(db: Db, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  const [zeile] = await db.update(t).set({ deletedAt: sql`now()` }).where(eq(t.id, id)).returning({ id: t.id });
  if (!zeile) throw new FachFehler(404, 'Eintrag nicht gefunden');
  return { bereich: b, id };
}
