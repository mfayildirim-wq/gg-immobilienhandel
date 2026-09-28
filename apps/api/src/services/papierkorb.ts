import type { PapierkorbEintrag } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { papierkorbAbgelaufen, papierkorbBezeichnung, PAPIERKORB_BEREICHE, type PapierkorbBereich } from '@gg/domain';
import { BUCKETS, type Dateispeicher, dokumentSchluessel } from '@gg/integrations';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';

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

const istBereich = (b: string): b is PapierkorbBereich => b in TABELLEN;
const bereichPruefen = (b: string): PapierkorbBereich => {
  if (!istBereich(b)) throw new FachFehler(400, `Unbekannter Bereich „${b}“`);
  return b;
};

/** Objekt- und Deal-Adresse kommen aus dem verknüpften Objekt, damit die Zeile lesbar bleibt. */
async function eintraege(db: Db, bereich: PapierkorbBereich): Promise<PapierkorbEintrag[]> {
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
async function dealDateienRaeumen(db: Db, speicher: Dateispeicher | undefined, dealId: string) {
  if (!speicher) return;
  try {
    const dokumente = await db.select().from(schema.dokumente).where(eq(schema.dokumente.dealId, dealId));
    const schluessel = dokumente.map((d) => d.storageKey ?? dokumentSchluessel(dealId, d.id, d.dateiname ?? ''));
    if (schluessel.length) await speicher.loeschen(BUCKETS.dealDocs, schluessel);
  } catch (e) {
    console.warn('[papierkorb] Dateien des Deals nicht entfernt:', dealId, e);
  }
}

async function endgueltigEntfernen(db: Db, speicher: Dateispeicher | undefined, bereich: PapierkorbBereich, ids: string[]) {
  if (!ids.length) return;
  if (bereich === 'deals') for (const id of ids) await dealDateienRaeumen(db, speicher, id);
  const t = TABELLEN[bereich];
  for (const id of ids) await db.delete(t).where(eq(t.id, id));
}

/**
 * Papierkorb lesen. Vorher wird aufgeräumt, was länger als 30 Tage liegt (alt: beim Start der App,
 * hier beim Öffnen — dasselbe Ergebnis, ohne Hintergrundlauf).
 */
export async function papierkorbListe(db: Db, speicher?: Dateispeicher): Promise<PapierkorbEintrag[]> {
  const alle: PapierkorbEintrag[] = [];
  for (const { bereich } of PAPIERKORB_BEREICHE) {
    const gefunden = await eintraege(db, bereich);
    const abgelaufen = gefunden.filter((e) => papierkorbAbgelaufen(e.geloeschtAm));
    await endgueltigEntfernen(db, speicher, bereich, abgelaufen.map((e) => e.id));
    alle.push(...gefunden.filter((e) => !abgelaufen.includes(e)));
  }
  return alle;
}

/** trashRestore: Markierung entfernen. */
export async function papierkorbWiederherstellen(db: Db, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  const [zeile] = await db.update(t).set({ deletedAt: null }).where(and(eq(t.id, id), isNotNull(t.deletedAt))).returning({ id: t.id });
  if (!zeile) throw new FachFehler(404, 'Eintrag liegt nicht im Papierkorb');
  return { bereich: b, id };
}

/** trashPermanentDelete: endgültig entfernen (samt Dateien eines Deals). */
export async function papierkorbEndgueltig(db: Db, speicher: Dateispeicher | undefined, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  const [zeile] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), isNotNull(t.deletedAt)));
  if (!zeile) throw new FachFehler(404, 'Eintrag liegt nicht im Papierkorb');
  await endgueltigEntfernen(db, speicher, b, [id]);
  return { bereich: b, id };
}

/** trashEmpty: alles endgültig entfernen. */
export async function papierkorbLeeren(db: Db, speicher?: Dateispeicher) {
  let entfernt = 0;
  for (const { bereich } of PAPIERKORB_BEREICHE) {
    const gefunden = await eintraege(db, bereich);
    await endgueltigEntfernen(db, speicher, bereich, gefunden.map((e) => e.id));
    entfernt += gefunden.length;
  }
  return { entfernt };
}

/** Marke setzen (softDelete) — für Bereiche ohne eigenen Löschweg. */
export async function papierkorbLegen(db: Db, bereich: string, id: string) {
  const b = bereichPruefen(bereich);
  const t = TABELLEN[b];
  const [zeile] = await db.update(t).set({ deletedAt: sql`now()` }).where(eq(t.id, id)).returning({ id: t.id });
  if (!zeile) throw new FachFehler(404, 'Eintrag nicht gefunden');
  return { bereich: b, id };
}
