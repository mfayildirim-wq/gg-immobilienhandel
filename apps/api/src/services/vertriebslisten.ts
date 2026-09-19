import type { Vertriebsliste, VertriebslistenEinstellungen, VertriebslisteSpeichern, VlSpalte } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { computeDealKalkSummary, createVertriebslisteFromDeal, PROVISION_STANDARD, vlStandardSpalten } from '@gg/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { dealUndObjektAlt } from './altformat.ts';

const SPALTEN = 'vertriebslisten-spalten';
const PROVISION = 'vertriebslisten-provision';
/** Tagesdatum in Berlin, wie todayISO der alten App angezeigt („zuletzt 2026-09-17“). */
const tagBerlin = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')));

async function wert(db: Db, schluessel: string) {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, schluessel));
  return z?.wert;
}

export async function vlEinstellungenLesen(db: Db): Promise<VertriebslistenEinstellungen> {
  const p = await wert(db, PROVISION);
  return { spalten: vlStandardSpalten(await wert(db, SPALTEN)) as VlSpalte[], provision: typeof p === 'number' ? p : PROVISION_STANDARD };
}

export async function vlEinstellungenSpeichern(db: Db, e: VertriebslistenEinstellungen) {
  await db.transaction(async (tx) => {
    for (const [schluessel, w] of [[SPALTEN, e.spalten], [PROVISION, e.provision]] as const) {
      await tx.insert(schema.einstellungen).values({ schluessel, wert: w as object, updatedAt: sql`now()` })
        .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: w as object, updatedAt: sql`now()` } });
    }
  });
  return vlEinstellungenLesen(db);
}

/** Übersicht wie vlRenderList: alle angekauften Deals, je mit (höchstens einer) Vertriebsliste. */
export async function vertriebslistenUebersicht(db: Db) {
  const deals = await db.select({ d: schema.deals, o: schema.objekte }).from(schema.deals).innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(eq(schema.deals.status, 'Angekauft'), isNull(schema.deals.deletedAt))).orderBy(asc(schema.deals.createdAt));
  const listen = await db.select().from(schema.vertriebslisten).where(isNull(schema.vertriebslisten.deletedAt)).orderBy(asc(schema.vertriebslisten.createdAt));
  const zeilen = await db.select({ listeId: schema.vertriebslisteZeilen.listeId }).from(schema.vertriebslisteZeilen);
  const einheiten = await db.select({ dealId: schema.dealEinheiten.dealId }).from(schema.dealEinheiten);
  return deals.map(({ d, o }) => {
    const vl = listen.find((l) => l.dealId === d.id);
    return {
      dealId: d.id, adresse: [o.strasse, o.hausnr].filter(Boolean).join(' ') || '–', stadt: o.stadt ?? '', einheiten: einheiten.filter((e) => e.dealId === d.id).length,
      liste: vl ? { id: vl.id, zeilen: zeilen.filter((z) => z.listeId === vl.id).length, zuletzt: tagBerlin(vl.updatedAt) } : null,
    };
  });
}

export async function vertriebslisteDetail(db: Db, id: string): Promise<Vertriebsliste> {
  const [vl] = await db.select().from(schema.vertriebslisten).where(and(eq(schema.vertriebslisten.id, id), isNull(schema.vertriebslisten.deletedAt)));
  if (!vl) throw new FachFehler(404, 'Vertriebsliste nicht gefunden');
  const zeilen = await db.select().from(schema.vertriebslisteZeilen).where(eq(schema.vertriebslisteZeilen.listeId, id)).orderBy(asc(schema.vertriebslisteZeilen.sort));
  const { deal, objekt } = await dealUndObjektAlt(db, vl.dealId);
  const einst = await vlEinstellungenLesen(db);
  return {
    id: vl.id, dealId: vl.dealId, titel: [objekt?.strasse, objekt?.hausnr, objekt?.stadt].filter(Boolean).join(' ') || vl.dealId,
    spalten: (vl.spalten as VlSpalte[] | null) ?? [], versteckteSpalten: vl.versteckteSpalten ?? [],
    zeilen: zeilen.map((z) => ({ id: z.id, einheitId: z.dealEinheitId, istStellplatz: z.istStellplatz === true, daten: (z.daten as Record<string, unknown> | null) ?? {} })),
    version: vl.version, updatedAt: vl.updatedAt,
    dealGik: (deal ? computeDealKalkSummary(deal, 'aufteiler')?.gik : 0) || 0,
    provision: einst.provision,
  };
}

/** vlCreate: nur für angekaufte Deals, höchstens eine je Deal; Zeilen einmalig aus den Deal-Einheiten. */
export async function vertriebslisteAnlegen(db: Db, dealId: string): Promise<Vertriebsliste> {
  const { deal } = await dealUndObjektAlt(db, dealId);
  if (!deal) throw new FachFehler(404, 'Deal nicht gefunden');
  if (deal.status !== 'Angekauft') throw new FachFehler(422, 'Vertriebslisten nur für angekaufte Deals');
  const [vorhanden] = await db.select({ id: schema.vertriebslisten.id }).from(schema.vertriebslisten).where(and(eq(schema.vertriebslisten.dealId, dealId), isNull(schema.vertriebslisten.deletedAt)));
  if (vorhanden) throw new FachFehler(409, 'Vertriebsliste existiert bereits — öffne die bestehende', { id: vorhanden.id });
  const { spalten } = await vlEinstellungenLesen(db);
  const vl = createVertriebslisteFromDeal(deal, spalten, () => crypto.randomUUID(), '');
  await db.transaction(async (tx) => {
    await tx.insert(schema.vertriebslisten).values({ id: vl.id, dealId, spalten: vl.columns, versteckteSpalten: [] });
    if (vl.rows.length) {
      await tx.insert(schema.vertriebslisteZeilen).values(vl.rows.map((r, sort) => ({ id: r.id, listeId: vl.id, dealEinheitId: r.einheitId ?? null, istStellplatz: !!r.isStellplatz, sort, daten: r.data })));
    }
  });
  return vertriebslisteDetail(db, vl.id);
}

export async function vertriebslisteSpeichern(db: Db, id: string, e: VertriebslisteSpeichern): Promise<Vertriebsliste> {
  await db.transaction(async (tx) => {
    const [neu] = await tx.update(schema.vertriebslisten)
      .set({ versteckteSpalten: e.versteckteSpalten, version: sql`${schema.vertriebslisten.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.vertriebslisten.id, id), eq(schema.vertriebslisten.version, e.version), isNull(schema.vertriebslisten.deletedAt)))
      .returning({ id: schema.vertriebslisten.id });
    if (!neu) {
      const [da] = await tx.select({ v: schema.vertriebslisten.version }).from(schema.vertriebslisten).where(and(eq(schema.vertriebslisten.id, id), isNull(schema.vertriebslisten.deletedAt)));
      if (!da) throw new FachFehler(404, 'Vertriebsliste nicht gefunden');
      throw new FachFehler(409, 'Vertriebsliste wurde zwischenzeitlich geändert', { aktuelleVersion: da.v });
    }
    const einheiten = new Set((await tx.select({ id: schema.dealEinheiten.id }).from(schema.dealEinheiten)).map((x) => x.id));
    await tx.delete(schema.vertriebslisteZeilen).where(eq(schema.vertriebslisteZeilen.listeId, id));
    if (e.zeilen.length) {
      await tx.insert(schema.vertriebslisteZeilen).values(e.zeilen.map((z, sort) => ({
        id: z.id, listeId: id, dealEinheitId: z.einheitId && einheiten.has(z.einheitId) ? z.einheitId : null, istStellplatz: z.istStellplatz, sort, daten: z.daten,
      })));
    }
  });
  return vertriebslisteDetail(db, id);
}

export async function vertriebslisteLoeschen(db: Db, id: string) {
  const [v] = await db.update(schema.vertriebslisten).set({ deletedAt: sql`now()` }).where(and(eq(schema.vertriebslisten.id, id), isNull(schema.vertriebslisten.deletedAt))).returning({ id: schema.vertriebslisten.id });
  if (!v) throw new FachFehler(404, 'Vertriebsliste nicht gefunden');
  return { id };
}
