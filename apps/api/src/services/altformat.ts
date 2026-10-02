import { type Db, schema } from '@gg/db';
import { asc, eq } from 'drizzle-orm';

/** Deal und Objekt im Format der alten App, wie die Vorbelegungsregeln sie lesen. */
export async function dealUndObjektAlt(db: Db, dealId: string) {
  const [d] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!d) return { deal: null, objekt: null };
  const [o] = await db.select().from(schema.objekte).where(eq(schema.objekte.id, d.objektId));
  const einheiten = await db.select().from(schema.dealEinheiten).where(eq(schema.dealEinheiten.dealId, dealId)).orderBy(asc(schema.dealEinheiten.sort));
  const sanierung = await db.select().from(schema.dealSanierungen).where(eq(schema.dealSanierungen.dealId, dealId)).orderBy(asc(schema.dealSanierungen.sort));
  const details = (o?.details as Record<string, unknown> | null) ?? {};
  return {
    deal: {
      id: d.id, objId: d.objektId, status: d.status, kalk: d.kalkulation ?? {},
      einheiten: einheiten.map((e) => ({
        id: e.id, typ: e.typ, lage: e.lage, zimmer: e.zimmer, fl: e.flaeche, fl_ist: e.flaecheIst, mi_ist: e.mieteIst, mi_neu: e.mieteNeu, mi_neu_manual: e.mieteNeuManuell,
        rend_k: e.renditeK, vkp: e.verkaufspreis, stk: e.stueck,
      })),
      sanierung: sanierung.map((s) => ({ id: s.id, desc: s.beschreibung, amt: s.betrag, scope: s.bereich })),
    },
    objekt: o ? {
      id: o.id, strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt, baujahr: o.baujahr, einheitenAnz: o.einheitenAnzahl,
      wohnflaeche: o.wohnflaeche, grundstueck: o.grundstueck, objektTyp: details.objektTyp, energie: o.energieklasse, heizung: o.heizung,
    } : null,
  };
}

