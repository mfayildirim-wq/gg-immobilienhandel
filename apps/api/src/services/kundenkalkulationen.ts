import type { Kundenkalkulation, KundenkalkulationAnlegen, KundenkalkulationEintrag, KundenkalkulationSpeichern } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { computeKKalk, type DealStatus, type KKalkInputs, type KkEinheit, kundenkalkulationenSortieren, kundenkalkulationVorbelegen } from '@gg/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { kundenkalkEinstellungenLesen } from './einstellungen.ts';
import { objektTitel } from './objekte.ts';
import type { Tx } from './tx.ts';

type Zeile = typeof schema.kundenkalkulationen.$inferSelect;

const alsDetail = (k: Zeile): Kundenkalkulation => ({
  id: k.id,
  dealId: k.dealId,
  version: k.version,
  scope: k.scope === 'aufteiler' ? 'aufteiler' : 'global',
  einheitId: k.dealEinheitId,
  name: k.name ?? 'Kalkulation',
  projektTitel: k.projektTitel ?? '',
  wertsteigerungBullets: k.wertsteigBullets ?? [],
  wertsteigerungSichtbar: k.wertsteigSichtbar ?? false,
  internNotiz: k.internNotiz ?? '',
  kaufpreisWohnung: k.kaufpreisWohnung ?? (k.inputs as KKalkInputs).kaufpreis ?? 0,
  kaufpreisStellplatz: k.kaufpreisStellplatz ?? 0,
  stellplaetzeAnzahl: k.stellplaetzeAnzahl ?? 0,
  stellplaetzeIds: k.stellplatzEinhIds ?? [],
  bildRefs: k.bildRefs ?? [],
  objSnapshot: (k.objSnapshot as Kundenkalkulation['objSnapshot'] | null) ?? { adresse: '', kaufdatum: '', wohnflaecheGesamt: 0, stellplaetzeAnzahl: 0, einheitenAnzahl: 1 },
  inputs: k.inputs as Kundenkalkulation['inputs'],
  createdAt: k.createdAt,
  updatedAt: k.updatedAt,
});

async function dealEinheiten(db: Db | Tx, dealId: string): Promise<(KkEinheit & { id: string })[]> {
  const e = await db.select().from(schema.dealEinheiten).where(eq(schema.dealEinheiten.dealId, dealId)).orderBy(asc(schema.dealEinheiten.sort));
  return e.map((x) => ({ id: x.id, typ: x.typ, lage: x.lage, fl: x.flaeche, mi_ist: x.mieteIst, mi_neu: x.mieteNeu, rend_k: x.renditeK, vkp: x.verkaufspreis }));
}

function eintrag(k: Zeile, deal: { titel: string; status: DealStatus }, lage: string | null): KundenkalkulationEintrag {
  const out = computeKKalk(k.inputs as KKalkInputs);
  return {
    id: k.id, dealId: k.dealId, name: k.name ?? 'Kalkulation', scope: k.scope === 'aufteiler' ? 'aufteiler' : 'global', einheitLage: lage,
    updatedAt: k.updatedAt, kaufpreis: (k.inputs as KKalkInputs).kaufpreis ?? 0,
    cashflowJahr1: out.bankgespraech.cashflow_jahr_1.cashflowProJahrNachSteuer,
    vermoegenszuwachs: out.bankgespraech.hochrechnungVerkauf.steuerfreierVermoegenszuwachs,
    irr: out.bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR,
    deal,
  };
}

/** Kundenkalkulationen (alle oder eines Deals), sortiert wie in der alten App. */
export async function kundenkalkulationenListe(db: Db, dealId?: string): Promise<KundenkalkulationEintrag[]> {
  const zeilen = await db
    .select({ k: schema.kundenkalkulationen, deal: schema.deals, objekt: schema.objekte })
    .from(schema.kundenkalkulationen)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.kundenkalkulationen.dealId))
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(isNull(schema.kundenkalkulationen.deletedAt), dealId ? eq(schema.kundenkalkulationen.dealId, dealId) : undefined));
  const einheiten = await db.select({ id: schema.dealEinheiten.id, dealId: schema.dealEinheiten.dealId, lage: schema.dealEinheiten.lage, sort: schema.dealEinheiten.sort }).from(schema.dealEinheiten).orderBy(asc(schema.dealEinheiten.sort));
  const lageVon = new Map(einheiten.map((e) => [e.id, e.lage]));

  const nachDeal = new Map<string, typeof zeilen>();
  for (const z of zeilen) nachDeal.set(z.k.dealId, [...(nachDeal.get(z.k.dealId) ?? []), z]);
  const ergebnis: KundenkalkulationEintrag[] = [];
  for (const [id, gruppe] of nachDeal) {
    const sortiert = kundenkalkulationenSortieren(
      gruppe.map((z) => ({ ...z, scope: z.k.scope ?? 'global', einheitId: z.k.dealEinheitId, name: z.k.name ?? '', projektTitel: z.k.projektTitel, updatedAt: z.k.updatedAt })),
      einheiten.filter((e) => e.dealId === id),
    );
    for (const z of sortiert) {
      const lage = z.k.dealEinheitId ? lageVon.get(z.k.dealEinheitId) ?? null : (z.k.name ?? '').match(/^Kalkulation\s+(.+)$/)?.[1] ?? null;
      ergebnis.push(eintrag(z.k, { titel: [objektTitel(z.objekt), z.objekt.stadt].filter(Boolean).join(', '), status: z.deal.status as DealStatus }, z.k.scope === 'aufteiler' ? lage : null));
    }
  }
  return ergebnis;
}

export async function kundenkalkulationDetail(db: Db, id: string): Promise<Kundenkalkulation> {
  const [k] = await db.select().from(schema.kundenkalkulationen).where(and(eq(schema.kundenkalkulationen.id, id), isNull(schema.kundenkalkulationen.deletedAt)));
  if (!k) throw new FachFehler(404, 'Kundenkalkulation nicht gefunden');
  return alsDetail(k);
}

/** Neue Kundenkalkulation mit Vorbelegung aus Deal, Objekt und Einstellungen (defaultsFromDeal). */
export async function kundenkalkulationAnlegen(db: Db, dealId: string, e: KundenkalkulationAnlegen, heute: string): Promise<Kundenkalkulation> {
  return db.transaction(async (tx) => {
    const [z] = await tx
      .select({ deal: schema.deals, objekt: schema.objekte })
      .from(schema.deals)
      .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
      .where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
    if (!z) throw new FachFehler(404, 'Deal nicht gefunden');
    const einheiten = await dealEinheiten(tx, dealId);
    if (e.scope === 'aufteiler' && !einheiten.some((x) => x.id === e.einheitId)) throw new FachFehler(422, 'Einheit gehört nicht zum Deal');
    const { standard, hinweise } = await kundenkalkEinstellungenLesen(tx);
    const v = kundenkalkulationVorbelegen({
      scope: e.scope, einheitId: e.einheitId, stellplatzIds: e.stellplatzIds, einheiten,
      dealKaufpreis: (z.deal.kalkulation as { kaufpreis?: unknown } | null)?.kaufpreis,
      objekt: { ...z.objekt, stellplaetze: (z.objekt.details as { stellplaetze?: unknown } | null)?.stellplaetze },
      standard, hinweise, heute,
    });
    const [neu] = await tx
      .insert(schema.kundenkalkulationen)
      .values({
        id: crypto.randomUUID(), dealId, dealEinheitId: v.einheitId, name: e.name || v.name, scope: v.scope, inputs: v.inputs,
        objSnapshot: v.objSnapshot, projektTitel: v.projektTitel, wertsteigBullets: v.wertsteigerungBullets, wertsteigSichtbar: v.wertsteigerungSichtbar,
        kaufpreisWohnung: v.kaufpreisWohnung, kaufpreisStellplatz: v.kaufpreisStellplatz, stellplaetzeAnzahl: v.stellplaetzeAnzahl,
        stellplatzEinhIds: v.stellplaetzeIds, bildRefs: [], internNotiz: v.internNotiz,
      })
      .returning();
    return alsDetail(neu!);
  });
}

export async function kundenkalkulationSpeichern(db: Db, id: string, e: KundenkalkulationSpeichern): Promise<Kundenkalkulation> {
  const { version, ...f } = e;
  const [neu] = await db
    .update(schema.kundenkalkulationen)
    .set({
      name: f.name, projektTitel: f.projektTitel, wertsteigBullets: f.wertsteigerungBullets, wertsteigSichtbar: f.wertsteigerungSichtbar,
      internNotiz: f.internNotiz, kaufpreisWohnung: f.kaufpreisWohnung, kaufpreisStellplatz: f.kaufpreisStellplatz,
      stellplaetzeAnzahl: f.stellplaetzeAnzahl, stellplatzEinhIds: f.stellplaetzeIds, bildRefs: f.bildRefs, objSnapshot: f.objSnapshot, inputs: f.inputs,
      version: sql`${schema.kundenkalkulationen.version} + 1`, updatedAt: sql`now()`,
    })
    .where(and(eq(schema.kundenkalkulationen.id, id), eq(schema.kundenkalkulationen.version, version), isNull(schema.kundenkalkulationen.deletedAt)))
    .returning();
  if (!neu) {
    const [da] = await db.select({ v: schema.kundenkalkulationen.version }).from(schema.kundenkalkulationen).where(and(eq(schema.kundenkalkulationen.id, id), isNull(schema.kundenkalkulationen.deletedAt)));
    if (!da) throw new FachFehler(404, 'Kundenkalkulation nicht gefunden');
    throw new FachFehler(409, 'Kundenkalkulation wurde zwischenzeitlich geändert', { aktuelleVersion: da.v });
  }
  return alsDetail(neu);
}

export async function kundenkalkulationDuplizieren(db: Db, id: string): Promise<Kundenkalkulation> {
  const [k] = await db.select().from(schema.kundenkalkulationen).where(and(eq(schema.kundenkalkulationen.id, id), isNull(schema.kundenkalkulationen.deletedAt)));
  if (!k) throw new FachFehler(404, 'Kundenkalkulation nicht gefunden');
  const { createdAt, updatedAt, version, ...rest } = k;
  void createdAt; void updatedAt; void version;
  const [neu] = await db.insert(schema.kundenkalkulationen).values({ ...rest, id: crypto.randomUUID(), name: `${k.name} (Kopie)` }).returning();
  return alsDetail(neu!);
}

/** In den Papierkorb (deleted_at), wiederherstellbar. */
export async function kundenkalkulationLoeschen(db: Db, id: string) {
  const [k] = await db.update(schema.kundenkalkulationen).set({ deletedAt: sql`now()` }).where(and(eq(schema.kundenkalkulationen.id, id), isNull(schema.kundenkalkulationen.deletedAt))).returning({ id: schema.kundenkalkulationen.id });
  if (!k) throw new FachFehler(404, 'Kundenkalkulation nicht gefunden');
  return { id };
}
