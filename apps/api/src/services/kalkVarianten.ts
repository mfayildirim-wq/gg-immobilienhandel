import type { KalkVariante, KalkVarianteAnlegen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { varianteLaden, varianteSchnappschuss } from '@gg/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';

async function dealPruefen(db: Db, dealId: string) {
  const [d] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
  if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
}

/**
 * IDs nur behalten, wenn die Einheit/Sanierung noch zu diesem Deal gehört (Altbestand: `${dealId}:${alteId}` wie im Umzug).
 * Sonst entsteht beim Speichern eine neue Zeile – nie wird eine fremde übernommen.
 */
async function vorhandeneIds(db: Db, dealId: string) {
  const e = await db.select({ id: schema.dealEinheiten.id }).from(schema.dealEinheiten).where(eq(schema.dealEinheiten.dealId, dealId));
  const s = await db.select({ id: schema.dealSanierungen.id }).from(schema.dealSanierungen).where(eq(schema.dealSanierungen.dealId, dealId));
  return new Set([...e, ...s].map((x) => x.id));
}
function idPruefen<T extends { id?: string }>(x: T, dealId: string, ids: Set<string>): T {
  const { id, ...rest } = x;
  const passend = id ? [id, `${dealId}:${id}`].find((k) => ids.has(k)) : undefined;
  return (passend ? { ...rest, id: passend } : rest) as T;
}

const alsVariante = (v: typeof schema.dealKalkVarianten.$inferSelect, ids: Set<string>): KalkVariante => {
  const { einheiten, sanierungen } = varianteLaden({ einheiten: v.einheiten, sanierungen: v.sanierungen });
  return {
    id: v.id, name: v.name ?? '', ts: new Date(v.createdAt).toISOString(),
    kalkulation: (v.kalkulation as KalkVariante['kalkulation'] | null) ?? {},
    einheiten: einheiten.map((e) => idPruefen(e, v.dealId, ids)), sanierungen: sanierungen.map((x) => idPruefen(x, v.dealId, ids)),
  };
};

/** d.kalkVarianten: neueste zuerst (unshift). */
export async function variantenListe(db: Db, dealId: string): Promise<KalkVariante[]> {
  await dealPruefen(db, dealId);
  const zeilen = await db.select().from(schema.dealKalkVarianten).where(eq(schema.dealKalkVarianten.dealId, dealId))
    .orderBy(desc(schema.dealKalkVarianten.createdAt), desc(schema.dealKalkVarianten.id));
  const ids = await vorhandeneIds(db, dealId);
  return zeilen.map((v) => alsVariante(v, ids));
}

/** dealVariantSave: Momentaufnahme der aktuellen (auch ungespeicherten) Formularwerte im Altformat. */
export async function varianteAnlegen(db: Db, dealId: string, e: KalkVarianteAnlegen): Promise<{ variante: KalkVariante; anzahl: number }> {
  await dealPruefen(db, dealId);
  const s = varianteSchnappschuss(
    e.einheiten.map((x) => ({ ...x })),
    e.sanierungen.map((x) => ({ ...x })),
  );
  const [v] = await db.insert(schema.dealKalkVarianten).values({
    id: crypto.randomUUID(), dealId, name: e.name.trim(), kalkulation: e.kalkulation, einheiten: s.einheiten, sanierungen: s.sanierung,
    createdAt: new Date().toISOString(),
  }).returning();
  const alle = await db.select({ id: schema.dealKalkVarianten.id }).from(schema.dealKalkVarianten).where(eq(schema.dealKalkVarianten.dealId, dealId));
  return { variante: alsVariante(v!, await vorhandeneIds(db, dealId)), anzahl: alle.length };
}

export async function varianteLoeschen(db: Db, dealId: string, varianteId: string) {
  const [v] = await db.delete(schema.dealKalkVarianten)
    .where(and(eq(schema.dealKalkVarianten.id, varianteId), eq(schema.dealKalkVarianten.dealId, dealId))).returning({ id: schema.dealKalkVarianten.id });
  if (!v) throw new FachFehler(404, 'Variante nicht gefunden');
  return { ok: true as const };
}
