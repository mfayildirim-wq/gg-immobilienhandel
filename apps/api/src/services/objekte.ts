import type { ObjektAendern, ObjektAnlegen, ObjektDetail } from '@gg/api-contract';
import { type DealStatus, START_STATUS } from '@gg/domain';
import { type Db, schema } from '@gg/db';
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { versionFortschreiben } from './version.ts';

const spalten = {
  id: schema.objekte.id,
  strasse: schema.objekte.strasse,
  hausnr: schema.objekte.hausnr,
  plz: schema.objekte.plz,
  stadt: schema.objekte.stadt,
  einheitenAnzahl: schema.objekte.einheitenAnzahl,
  wohnflaeche: schema.objekte.wohnflaeche,
  angebotspreis: schema.objekte.angebotspreis,
  status: schema.objekte.status,
  version: schema.objekte.version,
};

export function objektTitel(o: { strasse: string | null; hausnr: string | null; stadt: string | null }): string {
  const adresse = [o.strasse, o.hausnr].filter(Boolean).join(' ');
  return adresse || o.stadt || 'Objekt ohne Adresse';
}

export function objekteListe(db: Db) {
  return db
    .select(spalten)
    .from(schema.objekte)
    .where(isNull(schema.objekte.deletedAt))
    .orderBy(asc(schema.objekte.stadt), asc(schema.objekte.strasse));
}

export async function objektAnlegen(db: Db, eingabe: ObjektAnlegen) {
  const [neu] = await db
    .insert(schema.objekte)
    .values({ id: crypto.randomUUID(), status: START_STATUS, erfasstAm: new Date().toISOString().slice(0, 10), ...eingabe })
    .returning(spalten);
  return neu!;
}

export async function objektDetail(db: Db, id: string): Promise<ObjektDetail> {
  const [o] = await db.select().from(schema.objekte).where(and(eq(schema.objekte.id, id), isNull(schema.objekte.deletedAt)));
  if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
  const einheiten = await db
    .select({
      id: schema.objektEinheiten.id, typ: schema.objektEinheiten.typ, lage: schema.objektEinheiten.lage, zimmer: schema.objektEinheiten.zimmer,
      stueck: schema.objektEinheiten.stueck, flaeche: schema.objektEinheiten.flaeche, kaltmiete: schema.objektEinheiten.kaltmiete,
      vermietung: schema.objektEinheiten.vermietung,
    })
    .from(schema.objektEinheiten)
    .where(eq(schema.objektEinheiten.objektId, id))
    .orderBy(asc(schema.objektEinheiten.sort));
  const deals = await db
    .select({ id: schema.deals.id, status: schema.deals.status, maklerName: schema.makler.name })
    .from(schema.deals)
    .leftJoin(schema.makler, eq(schema.makler.id, schema.deals.maklerId))
    .where(and(eq(schema.deals.objektId, id), isNull(schema.deals.deletedAt)));
  return {
    id: o.id, strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt, einheitenAnzahl: o.einheitenAnzahl, wohnflaeche: o.wohnflaeche,
    angebotspreis: o.angebotspreis, status: o.status, version: o.version, bundesland: o.bundesland, baujahr: o.baujahr, grundstueck: o.grundstueck,
    energieklasse: o.energieklasse, heizung: o.heizung, zielpreis: o.zielpreis, istMiete: o.istMiete, sollMiete: o.sollMiete, notizen: o.notizen,
    einheiten, deals: deals.map((d) => ({ ...d, status: d.status as DealStatus })),
  };
}

/** Felder und Einheitenaufstellung gemeinsam (objSave). Einheiten behalten ihre IDs, damit Verweise gültig bleiben. */
export async function objektAendern(db: Db, id: string, eingabe: ObjektAendern) {
  const { version, einheiten, ...felder } = eingabe as ObjektAendern & { einheiten?: NonNullable<ObjektAendern['einheiten']> };
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.objekte, id, version, 'Objekt');
    if (Object.keys(felder).length) await tx.update(schema.objekte).set(felder).where(eq(schema.objekte.id, id));
    if (einheiten) {
      const zeilen = einheiten.map((e, sort) => ({ ...e, id: e.id ?? `${id}:${crypto.randomUUID()}`, objektId: id, sort }));
      const behalte = zeilen.map((e) => e.id);
      await tx.delete(schema.objektEinheiten).where(and(eq(schema.objektEinheiten.objektId, id), behalte.length ? notInArray(schema.objektEinheiten.id, behalte) : undefined));
      for (const e of zeilen) {
        await tx.insert(schema.objektEinheiten).values(e).onConflictDoUpdate({ target: schema.objektEinheiten.id, set: { ...e, updatedAt: sql`now()` } });
      }
    }
    return { id, version: neu };
  });
}

/** objDelete: in den Papierkorb (softDelete 'immo-objects'); zugehörige Deals bleiben. */
export async function objektLoeschen(db: Db, id: string) {
  const [o] = await db.update(schema.objekte).set({ deletedAt: sql`now()` })
    .where(and(eq(schema.objekte.id, id), isNull(schema.objekte.deletedAt))).returning({ id: schema.objekte.id });
  if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
  return { id };
}
