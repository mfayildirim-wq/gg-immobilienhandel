import type { Projekt, ProjektAnlegen, ProjektDealAuswahl, ProjektSpeichern } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { type PmEinheit, pmProjektAnlegen, pmVerfuegbareDeals } from '@gg/domain';
import { and, asc, eq, inArray, isNull, min, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { dealUndObjektAlt } from './altformat.ts';
import { kalkStandardLesen } from './einstellungen.ts';
import type { Tx } from './tx.ts';

const s = (v: string | null | undefined) => v ?? '';
const leerNull = (v: string) => (v === '' ? null : v);

async function projekteLesen(db: Db | Tx, ids: string[] | null): Promise<Projekt[]> {
  const bedingung = ids ? and(inArray(schema.projekte.id, ids), isNull(schema.projekte.deletedAt)) : isNull(schema.projekte.deletedAt);
  const projekte = await db.select().from(schema.projekte).where(bedingung).orderBy(asc(schema.projekte.sort), asc(schema.projekte.createdAt));
  if (!projekte.length) return [];
  const pids = projekte.map((p) => p.id);
  const einheiten = await db.select().from(schema.projektEinheiten).where(inArray(schema.projektEinheiten.projektId, pids)).orderBy(asc(schema.projektEinheiten.sort));
  const gespraeche = einheiten.length
    ? await db.select().from(schema.projektMieterhistorie).where(inArray(schema.projektMieterhistorie.projektEinheitId, einheiten.map((e) => e.id))).orderBy(asc(schema.projektMieterhistorie.sort))
    : [];
  const aufgaben = await db.select().from(schema.projektAufgaben).where(inArray(schema.projektAufgaben.projektId, pids)).orderBy(asc(schema.projektAufgaben.sort));
  const massnahmen = await db.select().from(schema.projektGebaeudeMassnahmen).where(inArray(schema.projektGebaeudeMassnahmen.projektId, pids)).orderBy(asc(schema.projektGebaeudeMassnahmen.sort));
  return projekte.map((p) => ({
    id: p.id, dealId: p.dealId, adresse: s(p.adresse), stadt: s(p.stadt), datum: s(p.datum), zielVKP: p.zielVkp ?? 0,
    globalVstatus: (p.globalVstatus ?? 'none') as Projekt['globalVstatus'], globalIstKP: p.globalIstKp ?? 0, globalKommentar: s(p.globalKommentar), globalKaeufer: s(p.globalKaeufer),
    globalNotarDatum: s(p.globalNotarDatum), globalReservDatum: s(p.globalReservDatum),
    einheiten: einheiten.filter((e) => e.projektId === p.id).map((e) => ({
      id: e.id, dealEinheitId: e.dealEinheitId, typ: s(e.typ), lage: s(e.lage), zimmer: e.zimmer, fl: e.flaeche, stk: e.stueck, teNr: s(e.teNr),
      kaltmiete: e.kaltmiete, kmMoeglich: e.kmMoeglich, grundpreis: e.grundpreis, provision: e.provision, sanIVT: e.sanierungIvt, ergebnisIVT: e.ergebnisIvt,
      zielKP: e.zielKp, istKP: e.istKp, vstatus: (e.vstatus ?? 'none') as PmEinheit['vstatus'], vertriebsstand: s(e.vertriebsstand), vermietet: s(e.vermietet),
      mieterName: s(e.mieterName), pip: (e.pip ?? '') as PmEinheit['pip'], pipStrategie: s(e.pipStrategie), pipTodosText: s(e.pipTodos), mieterTodosText: s(e.mieterTodos),
      mieterHistorie: gespraeche.filter((h) => h.projektEinheitId === e.id).map((h) => ({ id: h.id, datum: s(h.datum), inhalt: s(h.inhalt), ergebnis: s(h.ergebnis) })),
      reservDatum: s(e.reservDatum), notarDatum: s(e.notarDatum), kaeufer: s(e.kaeufer), vtKommentar: s(e.vtKommentar),
    })),
    todos: aufgaben.filter((t) => t.projektId === p.id).map((t) => ({
      id: t.id, cat: s(t.kategorie), text: s(t.text), status: (t.status ?? 'offen') as Projekt['todos'][number]['status'], kommentar: s(t.kommentar), verantwortlich: s(t.verantwortlich), faellig: s(t.faellig),
    })),
    gebPIP: massnahmen.filter((m) => m.projektId === p.id).map((m) => ({ id: m.id, text: s(m.text), status: s(m.status), verantw: s(m.verantwortlich) })),
    version: p.version, updatedAt: p.updatedAt,
  }));
}

/** Übersicht (pmRender): aktive Projekte, neuestes zuerst. */
export const projekteListe = (db: Db) => projekteLesen(db, null);

export async function projektDetail(db: Db | Tx, id: string): Promise<Projekt> {
  const [p] = await projekteLesen(db, [id]);
  if (!p) throw new FachFehler(404, 'Projekt nicht gefunden');
  return p;
}

/** pmNewProject: angekaufte Deals ohne aktives Projekt. Adresse = Straße (deal.adresse der alten App trug keine Hausnummer). */
export async function projektDealAuswahl(db: Db): Promise<ProjektDealAuswahl[]> {
  const deals = await db.select({ id: schema.deals.id, status: schema.deals.status, angebotsDatum: schema.deals.angebotsDatum, strasse: schema.objekte.strasse, stadt: schema.objekte.stadt })
    .from(schema.deals).innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(isNull(schema.deals.deletedAt)).orderBy(asc(schema.deals.createdAt));
  const aktiv = await db.select({ dealId: schema.projekte.dealId }).from(schema.projekte).where(isNull(schema.projekte.deletedAt));
  return pmVerfuegbareDeals(deals, aktiv).map((d) => ({ id: d.id, adresse: s(d.strasse), stadt: s(d.stadt), angebotsDatum: s(d.angebotsDatum) }));
}

async function kinderSchreiben(tx: Tx, projektId: string, p: Pick<Projekt, 'einheiten' | 'todos' | 'gebPIP'>) {
  await tx.delete(schema.projektEinheiten).where(eq(schema.projektEinheiten.projektId, projektId));
  await tx.delete(schema.projektAufgaben).where(eq(schema.projektAufgaben.projektId, projektId));
  await tx.delete(schema.projektGebaeudeMassnahmen).where(eq(schema.projektGebaeudeMassnahmen.projektId, projektId));
  const dealEinheiten = new Set((await tx.select({ id: schema.dealEinheiten.id }).from(schema.dealEinheiten)).map((e) => e.id));
  if (p.einheiten.length) {
    await tx.insert(schema.projektEinheiten).values(p.einheiten.map((e, sort) => ({
      id: e.id, projektId, sort, dealEinheitId: e.dealEinheitId && dealEinheiten.has(e.dealEinheitId) ? e.dealEinheitId : null,
      typ: e.typ, lage: e.lage, zimmer: e.zimmer, flaeche: e.fl, stueck: e.stk, teNr: leerNull(e.teNr), kaltmiete: e.kaltmiete, kmMoeglich: e.kmMoeglich,
      grundpreis: e.grundpreis, provision: e.provision, sanierungIvt: e.sanIVT, ergebnisIvt: e.ergebnisIVT, zielKp: e.zielKP, istKp: e.istKP,
      vstatus: e.vstatus, vertriebsstand: e.vertriebsstand, vermietet: leerNull(e.vermietet), mieterName: e.mieterName, pip: e.pip, pipStrategie: e.pipStrategie,
      pipTodos: e.pipTodosText, mieterTodos: e.mieterTodosText, reservDatum: leerNull(e.reservDatum), notarDatum: leerNull(e.notarDatum), kaeufer: e.kaeufer, vtKommentar: e.vtKommentar,
    })));
    const gespraeche = p.einheiten.flatMap((e) => e.mieterHistorie.map((h, sort) => ({ id: h.id, projektEinheitId: e.id, sort, datum: leerNull(h.datum), inhalt: h.inhalt, ergebnis: h.ergebnis })));
    if (gespraeche.length) await tx.insert(schema.projektMieterhistorie).values(gespraeche);
  }
  if (p.todos.length) {
    await tx.insert(schema.projektAufgaben).values(p.todos.map((t, sort) => ({
      id: t.id, projektId, sort, kategorie: t.cat, text: t.text, status: t.status, kommentar: t.kommentar, verantwortlich: t.verantwortlich, faellig: leerNull(t.faellig),
    })));
  }
  if (p.gebPIP.length) {
    await tx.insert(schema.projektGebaeudeMassnahmen).values(p.gebPIP.map((m, sort) => ({ id: m.id, projektId, sort, text: m.text, status: m.status, verantwortlich: m.verantw })));
  }
}

/** pmCreateProject: optional aus einem angekauften Deal (Einheiten, Ziel-VKP), Checkliste aus der Vorlage; neues Projekt vorn. */
export async function projektAnlegen(db: Db, e: ProjektAnlegen): Promise<Projekt> {
  let deal = null;
  if (e.dealId) {
    const auswahl = await projektDealAuswahl(db);
    if (!auswahl.some((d) => d.id === e.dealId)) throw new FachFehler(422, 'Deal nicht angekauft oder hat bereits ein Projekt');
    deal = (await dealUndObjektAlt(db, e.dealId)).deal;
  }
  const neu = pmProjektAnlegen(e, deal, await kalkStandardLesen(db), () => crypto.randomUUID());
  if ('fehler' in neu) throw new FachFehler(422, neu.fehler);
  await db.transaction(async (tx) => {
    const [{ kleinste } = { kleinste: null }] = await tx.select({ kleinste: min(schema.projekte.sort) }).from(schema.projekte);
    await tx.insert(schema.projekte).values({
      id: neu.id, sort: (kleinste ?? 0) - 1, dealId: neu.dealId, adresse: neu.adresse, stadt: neu.stadt, datum: leerNull(neu.datum), zielVkp: neu.zielVKP,
      globalVstatus: neu.globalVstatus, globalIstKp: neu.globalIstKP, globalKommentar: neu.globalKommentar, globalKaeufer: neu.globalKaeufer,
    });
    await kinderSchreiben(tx, neu.id, neu);
  });
  return projektDetail(db, neu.id);
}

export async function projektSpeichern(db: Db, id: string, p: ProjektSpeichern): Promise<Projekt> {
  return db.transaction(async (tx) => {
    const [neu] = await tx.update(schema.projekte)
      .set({
        adresse: p.adresse, stadt: p.stadt, datum: leerNull(p.datum), zielVkp: p.zielVKP, globalVstatus: p.globalVstatus, globalIstKp: p.globalIstKP,
        globalKommentar: p.globalKommentar, globalKaeufer: p.globalKaeufer, globalNotarDatum: leerNull(p.globalNotarDatum), globalReservDatum: leerNull(p.globalReservDatum),
        version: sql`${schema.projekte.version} + 1`, updatedAt: sql`now()`,
      })
      .where(and(eq(schema.projekte.id, id), eq(schema.projekte.version, p.version), isNull(schema.projekte.deletedAt)))
      .returning({ id: schema.projekte.id });
    if (!neu) {
      const [da] = await tx.select({ v: schema.projekte.version }).from(schema.projekte).where(and(eq(schema.projekte.id, id), isNull(schema.projekte.deletedAt)));
      if (!da) throw new FachFehler(404, 'Projekt nicht gefunden');
      throw new FachFehler(409, 'Projekt wurde zwischenzeitlich geändert', { aktuelleVersion: da.v });
    }
    await kinderSchreiben(tx, id, p);
    return projektDetail(tx, id);
  });
}

/** pmDeleteProject: in den Papierkorb. */
export async function projektLoeschen(db: Db, id: string) {
  const [p] = await db.update(schema.projekte).set({ deletedAt: sql`now()` }).where(and(eq(schema.projekte.id, id), isNull(schema.projekte.deletedAt))).returning({ id: schema.projekte.id });
  if (!p) throw new FachFehler(404, 'Projekt nicht gefunden');
  return { id };
}
