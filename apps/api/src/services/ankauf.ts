import type { AnkaufCockpit, AnrufErgebnisSpeichern, CockpitDeal, CockpitMakler, TageslogEintrag } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  anrufErgebnisAnwenden,
  cockpitDeals,
  cockpitMakler,
  type DealStatus,
  dealStagnation,
  geburtstagHinweis,
  terminloseMaklerEinplanen,
  waehlmaschinenQueue,
} from '@gg/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { objektTitel } from './objekte.ts';
import { versionFortschreiben } from './version.ts';

const aktiveMakler = (db: Db) =>
  db.select().from(schema.makler).where(isNull(schema.makler.deletedAt)).orderBy(desc(schema.makler.createdAt));

type Merker = { ts: string; thema: string; detail: string };
const merkerAus = (persoenlich: unknown): Merker[] => {
  const liste = (persoenlich as { letzteErwaehnung?: unknown } | null)?.letzteErwaehnung;
  return Array.isArray(liste) ? liste.filter((e): e is Merker => !!e && typeof e.thema === 'string').slice(0, 4) : [];
};

/**
 * Makler ohne jeden Termin einplanen (alte App: Selbstheilung bei jedem Öffnen von „Ankauf“).
 * Im Neubau ein ausdrücklicher, wiederholbarer Schritt, den die Seite beim Öffnen auslöst.
 */
export async function terminloseEinplanen(db: Db, heute: string) {
  const plan = terminloseMaklerEinplanen(await aktiveMakler(db), heute);
  for (const p of plan) {
    await db.update(schema.makler).set({ nextContact: p.nextContact, updatedAt: sql`now()`, version: sql`${schema.makler.version} + 1` })
      .where(and(eq(schema.makler.id, p.id), isNull(schema.makler.nextContact), isNull(schema.makler.lastContact)));
  }
  return { eingeplant: plan.length };
}

export async function ankaufCockpit(db: Db, heute: string): Promise<AnkaufCockpit> {
  const zeilen = await db
    .select({ deal: schema.deals, objekt: schema.objekte, makler: schema.makler })
    .from(schema.deals)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .leftJoin(schema.makler, eq(schema.makler.id, schema.deals.maklerId))
    .where(isNull(schema.deals.deletedAt));
  const alleMakler = await aktiveMakler(db);

  // ── Deals ──
  const dealIds = zeilen.map((z) => z.deal.id);
  const objektIds = [...new Set(zeilen.map((z) => z.objekt.id))];
  const objMiete = new Map<string, number>();
  if (objektIds.length) {
    for (const e of await db.select({ o: schema.objektEinheiten.objektId, m: schema.objektEinheiten.kaltmiete }).from(schema.objektEinheiten).where(inArray(schema.objektEinheiten.objektId, objektIds))) {
      objMiete.set(e.o, (objMiete.get(e.o) ?? 0) + (e.m ?? 0));
    }
  }
  const dealMiete = new Map<string, number>();
  if (dealIds.length) {
    for (const e of await db.select({ d: schema.dealEinheiten.dealId, m: schema.dealEinheiten.mieteIst }).from(schema.dealEinheiten).where(inArray(schema.dealEinheiten.dealId, dealIds))) {
      dealMiete.set(e.d, (dealMiete.get(e.d) ?? 0) + (e.m ?? 0));
    }
  }
  const hatObjektEinheiten = new Set((objektIds.length ? await db.select({ o: schema.objektEinheiten.objektId }).from(schema.objektEinheiten).where(inArray(schema.objektEinheiten.objektId, objektIds)) : []).map((x) => x.o));

  const deals: CockpitDeal[] = cockpitDeals(
    zeilen.map((z) => ({ ...z, id: z.deal.id, status: z.deal.status as DealStatus, nachfassFrequenz: z.deal.nachfassFrequenz, nextContact: z.deal.nextContact, lastContact: z.deal.lastContact })),
    heute,
  ).map(({ deal, objekt, makler, termin, faellig }) => {
    const kalk = (deal.kalkulation ?? {}) as { kaufpreis?: unknown };
    // wie vtDealCard: Jahresmiete aus Objekt-Einheiten, sonst aus Deal-Einheiten
    const monat = hatObjektEinheiten.has(objekt.id) ? objMiete.get(objekt.id) ?? 0 : dealMiete.get(deal.id) ?? 0;
    return {
      id: deal.id, version: deal.version, status: deal.status as DealStatus, nachfassFrequenz: deal.nachfassFrequenz,
      nextContact: deal.nextContact, lastContact: deal.lastContact, termin, faellig,
      objekt: { id: objekt.id, titel: objektTitel(objekt), stadt: objekt.stadt },
      kaufpreis: typeof kalk.kaufpreis === 'number' && kalk.kaufpreis ? kalk.kaufpreis : null,
      wohnflaeche: objekt.wohnflaeche,
      jahresmiete: monat ? monat * 12 : null,
      makler: makler ? { id: makler.id, name: makler.name, firma: makler.firma, tel: makler.tel, email: makler.email } : null,
    };
  });

  // ── Makler ──
  const letzterKommentar = new Map<string, string>();
  if (dealIds.length) {
    const k = await db.select({ d: schema.dealKommentare.dealId, t: sql<string>`max(${schema.dealKommentare.zeitpunkt})` }).from(schema.dealKommentare).where(inArray(schema.dealKommentare.dealId, dealIds)).groupBy(schema.dealKommentare.dealId);
    for (const x of k) if (x.t) letzterKommentar.set(x.d, x.t);
  }
  const makler: CockpitMakler[] = cockpitMakler(alleMakler, heute).map((m) => {
    const eigene = zeilen.filter((z) => z.deal.maklerId === m.id);
    const hinweise: CockpitMakler['hinweise'] = [];
    const persoenlich = (m.persoenlich ?? {}) as { geburtsdatum?: string };
    const gb = geburtstagHinweis(persoenlich.geburtsdatum, heute);
    if (gb) hinweise.push({ art: 'geburtstag', text: gb.label + (gb.inTagen <= 1 ? ' → Glückwunsch einbauen!' : ''), dringend: gb.inTagen <= 1 });
    if (m.faellig.klasse !== 'woche') {
      const stag = dealStagnation(
        eigene.map((z) => ({ status: z.deal.status as DealStatus, titel: objektTitel(z.objekt), letzteAktivitaet: letzterKommentar.get(z.deal.id) ?? z.deal.angebotsDatum })),
        heute,
      );
      if (stag) hinweise.push({ art: 'stagnation', text: stag, dringend: true });
    }
    return {
      id: m.id, version: m.version, name: m.name, firma: m.firma, tel: m.tel, email: m.email, prio: m.prio,
      kontaktFrequenz: m.kontaktFrequenz, nextContact: m.nextContact, lastContact: m.lastContact, termin: m.termin, faellig: m.faellig,
      aktiveDeals: eigene.filter((z) => z.deal.status !== 'Archiv').length,
      hinweise,
      merker: merkerAus(m.persoenlich),
    };
  });

  return { heute, deals, makler, tageslog: await tageslog(db) };
}

/** „Heute erledigt“: Kommunikation und Deal-Kommentare des heutigen Tages (deutsche Zeit), neueste zuerst, max. 15. */
async function tageslog(db: Db): Promise<TageslogEintrag[]> {
  const heuteBerlin = sql`(now() at time zone 'Europe/Berlin')::date`;
  const komm = await db
    .select({ zeitpunkt: schema.maklerKommunikation.zeitpunkt, text: schema.maklerKommunikation.text, kanal: schema.maklerKommunikation.kanal, name: schema.makler.name, firma: schema.makler.firma })
    .from(schema.maklerKommunikation)
    .innerJoin(schema.makler, eq(schema.makler.id, schema.maklerKommunikation.maklerId))
    .where(sql`(${schema.maklerKommunikation.zeitpunkt} at time zone 'Europe/Berlin')::date = ${heuteBerlin}`);
  const kommentare = await db
    .select({ zeitpunkt: schema.dealKommentare.zeitpunkt, text: schema.dealKommentare.text, objekt: schema.objekte })
    .from(schema.dealKommentare)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.dealKommentare.dealId))
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(sql`(${schema.dealKommentare.zeitpunkt} at time zone 'Europe/Berlin')::date = ${heuteBerlin}`);
  return [
    ...komm.map((k) => ({ zeitpunkt: k.zeitpunkt!, art: 'makler' as const, titel: [k.name ?? '–', k.firma].filter(Boolean).join(' · '), text: k.text ?? '', kanal: k.kanal })),
    ...kommentare.map((k) => ({ zeitpunkt: k.zeitpunkt!, art: 'deal' as const, titel: [objektTitel(k.objekt), k.objekt.stadt].filter(Boolean).join(', '), text: k.text ?? '', kanal: null })),
  ]
    .sort((a, b) => (a.zeitpunkt < b.zeitpunkt ? 1 : -1))
    .slice(0, 15);
}

export async function waehlmaschine(db: Db, heute: string): Promise<CockpitMakler[]> {
  const cockpit = new Map((await ankaufCockpit(db, heute)).makler.map((m) => [m.id, m]));
  return waehlmaschinenQueue(await aktiveMakler(db), heute).map((m) => ({
    ...(cockpit.get(m.id) ?? { hinweise: [], merker: merkerAus(m.persoenlich), aktiveDeals: 0 }),
    id: m.id, version: m.version, name: m.name, firma: m.firma, tel: m.tel, email: m.email, prio: m.prio,
    kontaktFrequenz: m.kontaktFrequenz, nextContact: m.nextContact, lastContact: m.lastContact, termin: m.termin, faellig: m.faellig,
  }));
}

/** Wählmaschine „Erledigt → Nächster Makler“. */
export async function anrufErgebnis(db: Db, maklerId: string, e: AnrufErgebnisSpeichern, heute: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ next: schema.makler.nextContact }).from(schema.makler).where(eq(schema.makler.id, maklerId));
    if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
    const version = await versionFortschreiben(tx, schema.makler, maklerId, e.version, 'Makler');
    const r = anrufErgebnisAnwenden({ ergebnis: e.ergebnis, notiz: e.notiz, frequenz: e.frequenz, rueckrufDatum: e.rueckrufDatum, bestehenderTermin: m.next, heute });
    await tx.update(schema.makler).set({ kontaktFrequenz: r.kontaktFrequenz, lastContact: r.lastContact, nextContact: r.nextContact }).where(eq(schema.makler.id, maklerId));
    if (r.notizEintrag) {
      await tx.insert(schema.maklerKommunikation).values({ id: `${maklerId}:${crypto.randomUUID()}`, maklerId, zeitpunkt: sql`now()`, kanal: 'anruf', richtung: 'ausgehend', text: r.notizEintrag });
    }
    return { id: maklerId, version, nextContact: r.nextContact };
  });
}

/**
 * „Liste durchwählen“ (22.09.2026): dieselbe Regel wie beim Makler, gebucht am Deal — Nachfassfrequenz, letzter und
 * nächster Kontakt; die Notiz wird ein Deal-Kommentar im Format „[T.M.JJJJ – Ergebnis] …“. Der Makler bleibt unberührt.
 */
export async function dealAnrufErgebnis(db: Db, dealId: string, e: AnrufErgebnisSpeichern, heute: string) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select({ next: schema.deals.nextContact }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
    if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
    const version = await versionFortschreiben(tx, schema.deals, dealId, e.version, 'Deal');
    const r = anrufErgebnisAnwenden({ ergebnis: e.ergebnis, notiz: e.notiz, frequenz: e.frequenz, rueckrufDatum: e.rueckrufDatum, bestehenderTermin: d.next, heute });
    await tx.update(schema.deals).set({ nachfassFrequenz: r.kontaktFrequenz, lastContact: r.lastContact, nextContact: r.nextContact }).where(eq(schema.deals.id, dealId));
    if (r.notizEintrag) {
      await tx.insert(schema.dealKommentare).values({ id: `${dealId}:${crypto.randomUUID()}`, dealId, text: r.notizEintrag, zeitpunkt: sql`now()` });
    }
    return { id: dealId, version, nextContact: r.nextContact };
  });
}

/** Anruf-Briefing schließen: mit Datum → nächster Kontakt = Datum, letzter Kontakt = heute. */
export async function briefingAbschliessen(db: Db, maklerId: string, version: number, nextContact: string | null, heute: string) {
  if (!nextContact) return { id: maklerId, version };
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.makler, maklerId, version, 'Makler');
    await tx.update(schema.makler).set({ nextContact, lastContact: heute }).where(eq(schema.makler.id, maklerId));
    return { id: maklerId, version: neu };
  });
}

/** WhatsApp-Link geöffnet: protokollieren wie logWhatsApp, letzter Kontakt = heute (ohne Version: nur Anhängen). */
export async function whatsappProtokollieren(db: Db, maklerId: string, heute: string) {
  const [m] = await db.select({ id: schema.makler.id }).from(schema.makler).where(and(eq(schema.makler.id, maklerId), isNull(schema.makler.deletedAt)));
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  await db.insert(schema.maklerKommunikation).values({ id: `${maklerId}:${crypto.randomUUID()}`, maklerId, zeitpunkt: sql`now()`, kanal: 'whatsapp', richtung: 'ausgehend', text: 'WhatsApp-Nachricht gesendet' });
  await db.update(schema.makler).set({ lastContact: heute, updatedAt: sql`now()`, version: sql`${schema.makler.version} + 1` }).where(eq(schema.makler.id, maklerId));
  return { id: maklerId };
}

/** Datum-Schnellwahl auf den Karten (1W/1M/3M/6M oder Datumsfeld). */
export async function terminSetzen(db: Db, tabelle: 'deals' | 'makler', id: string, version: number, nextContact: string | null) {
  const t = tabelle === 'deals' ? schema.deals : schema.makler;
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, t, id, version, tabelle === 'deals' ? 'Deal' : 'Makler');
    await tx.update(t).set({ nextContact }).where(eq(t.id, id));
    return { id, version: neu };
  });
}
