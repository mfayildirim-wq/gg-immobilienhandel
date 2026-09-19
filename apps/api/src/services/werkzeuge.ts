import type { KiKostenZeile, NachfassResetSicht } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';

/**
 * Nachfass-Datum-Reset (alt: Einstellungen → 🔧 Nachfass-Datum-Reset): alle Deals und Makler mit
 * diesem `nextContact` finden und bei Bedarf `nextContact` + `lastContact` löschen.
 */
export async function nachfassResetVorschau(db: Db, datum: string): Promise<NachfassResetSicht> {
  const deals = await db.select({ id: schema.deals.id, status: schema.deals.status, lastContact: schema.deals.lastContact, strasse: schema.objekte.strasse, hausnr: schema.objekte.hausnr })
    .from(schema.deals).innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(eq(schema.deals.nextContact, datum), isNull(schema.deals.deletedAt)));
  const makler = await db.select({ id: schema.makler.id, name: schema.makler.name, frequenz: schema.makler.kontaktFrequenz, lastContact: schema.makler.lastContact })
    .from(schema.makler).where(and(eq(schema.makler.nextContact, datum), isNull(schema.makler.deletedAt)));
  return {
    datum,
    deals: deals.map((d) => ({ id: d.id, label: [d.strasse, d.hausnr].filter(Boolean).join(' ') || d.id.slice(-6), zusatz: `${d.status}, last=${d.lastContact ?? '–'}` })),
    makler: makler.map((m) => ({ id: m.id, label: m.name || m.id.slice(-6), zusatz: `${m.frequenz ?? '–'}, last=${m.lastContact ?? '–'}` })),
  };
}

export async function nachfassResetAusfuehren(db: Db, datum: string) {
  const sicht = await nachfassResetVorschau(db, datum);
  if (sicht.deals.length) {
    await db.update(schema.deals).set({ nextContact: null, lastContact: null, version: sql`${schema.deals.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.deals.nextContact, datum), isNull(schema.deals.deletedAt)));
  }
  if (sicht.makler.length) {
    await db.update(schema.makler).set({ nextContact: null, lastContact: null, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.makler.nextContact, datum), isNull(schema.makler.deletedAt)));
  }
  await auditSchreiben(db, {
    type: 'mutation', entity: 'nachfass', action: 'reset', source: '/api/werkzeuge/nachfass-reset',
    metadata: { datum, deals: sicht.deals.length, makler: sicht.makler.length },
  });
  return { deals: sicht.deals.length, makler: sicht.makler.length };
}

/** KI-Kosten aus dem Audit-Log (Zeilen vom Typ `kicall`), gruppiert nach Modell und Funktion. */
export async function kiKosten(db: Db, tage: number): Promise<{ zeilen: KiKostenZeile[]; summeEur: number; tage: number }> {
  const grenze = Math.floor(Date.now() / 1000) - tage * 86_400;
  const zeilen = await db.select({
    model: schema.auditLog.aiModel,
    funktion: schema.auditLog.aiFunction,
    aufrufe: sql<number>`count(*)::int`,
    inputTokens: sql<number>`coalesce(sum(${schema.auditLog.inputTokens}), 0)::bigint`,
    outputTokens: sql<number>`coalesce(sum(${schema.auditLog.outputTokens}), 0)::bigint`,
    kostenEur: sql<number>`coalesce(sum(${schema.auditLog.costEur}), 0)::double precision`,
  })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.type, 'kicall'), gte(schema.auditLog.ts, grenze)))
    .groupBy(schema.auditLog.aiModel, schema.auditLog.aiFunction)
    .orderBy(desc(sql`coalesce(sum(${schema.auditLog.costEur}), 0)`));
  const alle = zeilen.map((z) => ({
    model: z.model ?? '–', funktion: z.funktion ?? '–', aufrufe: Number(z.aufrufe),
    inputTokens: Number(z.inputTokens), outputTokens: Number(z.outputTokens), kostenEur: Number(z.kostenEur),
  }));
  return { zeilen: alle, summeEur: alle.reduce((s, z) => s + z.kostenEur, 0), tage };
}
