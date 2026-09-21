import type {
  DealAnlegen,
  DealDetail,
  DealInfoAendern,
  DealListenEintrag,
  KalkulationSpeichern,
  StatusWechsel,
} from '@gg/api-contract';
import { DealAnlegen as DealAnlegenSchema } from '@gg/api-contract';
import { type Db, einheitAlsEingabe, sanierungAlsEingabe, schema } from '@gg/db';
import { berechneAnkauf, dealVorbelegungAusObjekt, erledigtTermin, pruefeStatuswechsel, START_STATUS, STATUS_SORT, type DealStatus, kalkMitStandard } from '@gg/domain';
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { kalkStandardLesen } from './einstellungen.ts';
import { versionFortschreiben } from './version.ts';
import { FachFehler } from '../fehler.ts';
import { objektTitel } from './objekte.ts';

export type Quelle = 'ui' | 'wizard' | 'mcp' | 'umzug';

export async function dealListe(db: Db): Promise<DealListenEintrag[]> {
  const zeilen = await db
    .select({
      deal: schema.deals,
      objekt: { id: schema.objekte.id, strasse: schema.objekte.strasse, hausnr: schema.objekte.hausnr, stadt: schema.objekte.stadt },
      makler: { id: schema.makler.id, name: schema.makler.name, firma: schema.makler.firma },
    })
    .from(schema.deals)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .leftJoin(schema.makler, eq(schema.makler.id, schema.deals.maklerId))
    .where(isNull(schema.deals.deletedAt));

  return zeilen
    .map(({ deal, objekt, makler }) => ({
      id: deal.id,
      status: deal.status as DealStatus,
      prio: deal.prio,
      nachfassFrequenz: deal.nachfassFrequenz,
      nextContact: deal.nextContact,
      notizen: deal.notizen,
      version: deal.version,
      updatedAt: deal.updatedAt,
      objekt: { id: objekt.id, titel: objektTitel(objekt), stadt: objekt.stadt },
      makler: makler ? { id: makler.id, name: makler.name ?? makler.firma ?? 'Makler ohne Namen' } : null,
    }))
    .sort(
      (a, b) =>
        STATUS_SORT[a.status] - STATUS_SORT[b.status] ||
        (a.nextContact ?? '9999').localeCompare(b.nextContact ?? '9999'),
    );
}

/** Objekt im Altformat mit Einheiten (für dealPrefillObj). */
async function objektAlt(tx: Pick<Db, 'select'>, objektId: string) {
  const [o] = await tx.select().from(schema.objekte).where(and(eq(schema.objekte.id, objektId), isNull(schema.objekte.deletedAt)));
  if (!o) return null;
  const einheiten = await tx.select().from(schema.objektEinheiten).where(eq(schema.objektEinheiten.objektId, objektId)).orderBy(asc(schema.objektEinheiten.sort));
  return { angebotspreis: o.angebotspreis, wohnflaeche: o.wohnflaeche, einheiten: einheiten.map((e) => ({ typ: e.typ, flaeche: e.flaeche, kaltmiete: e.kaltmiete })) };
}

/** Kalkulation und Einheiten aus dem Objekt vorbelegen (dealPrefillObj): vorhandene Kalkulationswerte bleiben, Einheiten werden ersetzt. */
async function ausObjektVorbelegen(tx: Parameters<Parameters<Db['transaction']>[0]>[0], dealId: string, objektId: string, kalkulation: Record<string, unknown>) {
  const o = await objektAlt(tx, objektId);
  if (!o) throw new FachFehler(422, 'Objekt nicht gefunden');
  const v = dealVorbelegungAusObjekt(o);
  await tx.update(schema.deals).set({ kalkulation: { ...kalkulation, ...v.kalk } }).where(eq(schema.deals.id, dealId));
  await tx.delete(schema.dealEinheiten).where(eq(schema.dealEinheiten.dealId, dealId));
  if (v.einheiten.length) {
    await tx.insert(schema.dealEinheiten).values(v.einheiten.map((e: { typ: string; fl: number; mi_ist: number | ''; mi_neu: number | ''; rend_k: number }, sort: number) => ({
      id: `${dealId}:${crypto.randomUUID()}`, dealId, sort, typ: e.typ, flaeche: e.fl, mieteIst: e.mi_ist === '' ? null : e.mi_ist, mieteNeu: e.mi_neu === '' ? null : e.mi_neu, mieteNeuManuell: false, renditeK: e.rend_k,
    })));
  }
}

/** Manuell angelegt (dealOpenNew → dealSave): Status „In Prüfung“, Angebotsdatum heute, Vorbelegung aus dem Objekt. */
export async function dealAnlegen(db: Db, eingabe: DealAnlegen, quelle: Quelle = 'ui', heute?: string) {
  const daten = DealAnlegenSchema.parse(eingabe);
  return db.transaction(async (tx) => {
    const [objekt] = await tx
      .select({ id: schema.objekte.id })
      .from(schema.objekte)
      .where(and(eq(schema.objekte.id, daten.objektId), isNull(schema.objekte.deletedAt)));
    if (!objekt) throw new FachFehler(422, 'Objekt nicht gefunden');

    const id = crypto.randomUUID();
    await tx.insert(schema.deals).values({
      id,
      objektId: daten.objektId,
      maklerId: daten.maklerId ?? null,
      status: START_STATUS,
      nachfassFrequenz: daten.nachfassFrequenz,
      angebotsDatum: heute ?? null,
      notizen: daten.notizen ?? null,
    });
    await ausObjektVorbelegen(tx, id, daten.objektId, {});
    await tx.insert(schema.dealStatusHistorie).values({
      id: crypto.randomUUID(),
      dealId: id,
      vonStatus: null,
      nachStatus: START_STATUS,
      quelle,
    });
    return { id };
  });
}

export async function statusAendern(db: Db, id: string, wechsel: StatusWechsel, quelle: Quelle = 'ui') {
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select({ status: schema.deals.status, version: schema.deals.version })
      .from(schema.deals)
      .where(and(eq(schema.deals.id, id), isNull(schema.deals.deletedAt)))
      .for('update');
    if (!deal) throw new FachFehler(404, 'Deal nicht gefunden');
    if (deal.version !== wechsel.version) {
      throw new FachFehler(409, 'Der Deal wurde zwischenzeitlich geändert', { aktuelleVersion: deal.version });
    }

    const von = deal.status as DealStatus;
    const pruefung = pruefeStatuswechsel(von, wechsel.status);
    if (!pruefung.erlaubt) throw new FachFehler(422, pruefung.grund);
    if (!pruefung.aenderung) return { id, status: von, version: deal.version };

    const [neu] = await tx
      .update(schema.deals)
      .set({ status: wechsel.status, version: sql`${schema.deals.version} + 1`, updatedAt: sql`now()` })
      .where(eq(schema.deals.id, id))
      .returning({ status: schema.deals.status, version: schema.deals.version });
    await tx.insert(schema.dealStatusHistorie).values({
      id: crypto.randomUUID(),
      dealId: id,
      vonStatus: von,
      nachStatus: wechsel.status,
      quelle,
      grund: wechsel.grund ?? null,
    });
    return { id, status: neu!.status as DealStatus, version: neu!.version };
  });
}

export async function statusHistorie(db: Db, dealId: string) {
  const zeilen = await db
    .select({
      id: schema.dealStatusHistorie.id,
      vonStatus: schema.dealStatusHistorie.vonStatus,
      nachStatus: schema.dealStatusHistorie.nachStatus,
      am: schema.dealStatusHistorie.am,
      quelle: schema.dealStatusHistorie.quelle,
      grund: schema.dealStatusHistorie.grund,
    })
    .from(schema.dealStatusHistorie)
    .where(eq(schema.dealStatusHistorie.dealId, dealId))
    .orderBy(desc(schema.dealStatusHistorie.am));
  return zeilen.map((z) => ({ ...z, nachStatus: z.nachStatus as DealStatus }));
}

export async function dealDetail(db: Db, id: string): Promise<DealDetail> {
  const liste = await dealListe(db);
  const eintrag = liste.find((d) => d.id === id);
  if (!eintrag) throw new FachFehler(404, 'Deal nicht gefunden');
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, id));
  const einheiten = await db
    .select({
      id: schema.dealEinheiten.id, typ: schema.dealEinheiten.typ, lage: schema.dealEinheiten.lage, zimmer: schema.dealEinheiten.zimmer,
      flaeche: schema.dealEinheiten.flaeche, mieteIst: schema.dealEinheiten.mieteIst, mieteNeu: schema.dealEinheiten.mieteNeu,
      mieteNeuManuell: schema.dealEinheiten.mieteNeuManuell, renditeK: schema.dealEinheiten.renditeK,
      verkaufspreis: schema.dealEinheiten.verkaufspreis, stueck: schema.dealEinheiten.stueck,
    })
    .from(schema.dealEinheiten)
    .where(eq(schema.dealEinheiten.dealId, id))
    .orderBy(asc(schema.dealEinheiten.sort));
  const sanierungen = await db
    .select({ id: schema.dealSanierungen.id, beschreibung: schema.dealSanierungen.beschreibung, betrag: schema.dealSanierungen.betrag, bereich: schema.dealSanierungen.bereich })
    .from(schema.dealSanierungen)
    .where(eq(schema.dealSanierungen.dealId, id))
    .orderBy(asc(schema.dealSanierungen.sort));
  const kommentare = await db
    .select({ id: schema.dealKommentare.id, zeitpunkt: schema.dealKommentare.zeitpunkt, text: schema.dealKommentare.text })
    .from(schema.dealKommentare)
    .where(eq(schema.dealKommentare.dealId, id))
    .orderBy(sql`${schema.dealKommentare.zeitpunkt} desc nulls last`, desc(schema.dealKommentare.id));
  return {
    ...eintrag,
    angebotsDatum: deal!.angebotsDatum,
    lastContact: deal!.lastContact,
    kalkulation: (deal!.kalkulation as DealDetail['kalkulation'] | null) ?? {},
    einheiten,
    sanierungen: sanierungen.map((x) => ({ ...x, bereich: x.bereich as 'both' | 'auf' | 'glo' | null })),
    kommentare,
  };
}

export async function dealInfoAendern(db: Db, id: string, eingabe: DealInfoAendern) {
  const { version, ...felder } = eingabe;
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.deals, id, version, 'Deal');
    if (Object.keys(felder).length) await tx.update(schema.deals).set(felder).where(eq(schema.deals.id, id));
    return { id, version: neu };
  });
}

/**
 * Speichert Kalkulation, Einheiten und Sanierungen gemeinsam und rechnet die Kennzahlen serverseitig neu
 * (wie die alte App, die gik/gewinn/marge in deal.kalk zurückschrieb). Einheiten behalten ihre IDs,
 * damit Verweise aus Kundenkalkulation und Vertriebsliste gültig bleiben.
 */
export async function kalkulationSpeichern(db: Db, id: string, eingabe: KalkulationSpeichern) {
  return db.transaction(async (tx) => {
    const version = await versionFortschreiben(tx, schema.deals, id, eingabe.version, 'Deal');
    const einheiten = eingabe.einheiten.map((e, sort) => ({ ...e, id: e.id ?? `${id}:${crypto.randomUUID()}`, dealId: id, sort }));
    const sanierungen = eingabe.sanierungen.map((s, sort) => ({ ...s, id: s.id ?? `${id}:${crypto.randomUUID()}`, dealId: id, sort }));
    const standard = await kalkStandardLesen(tx);
    const { kennzahlen } = berechneAnkauf(kalkMitStandard(eingabe.kalkulation, standard), einheiten.map(einheitAlsEingabe), sanierungen.map(sanierungAlsEingabe), standard);
    const kalkulation = { ...eingabe.kalkulation, ...kennzahlen };

    await tx.update(schema.deals).set({ kalkulation }).where(eq(schema.deals.id, id));

    const behalteE = einheiten.map((e) => e.id);
    await tx.delete(schema.dealEinheiten).where(and(eq(schema.dealEinheiten.dealId, id), behalteE.length ? notInArray(schema.dealEinheiten.id, behalteE) : undefined));
    for (const e of einheiten) {
      await tx.insert(schema.dealEinheiten).values(e).onConflictDoUpdate({ target: schema.dealEinheiten.id, set: { ...e, updatedAt: sql`now()` } });
    }
    const behalteS = sanierungen.map((x) => x.id);
    await tx.delete(schema.dealSanierungen).where(and(eq(schema.dealSanierungen.dealId, id), behalteS.length ? notInArray(schema.dealSanierungen.id, behalteS) : undefined));
    for (const x of sanierungen) {
      await tx.insert(schema.dealSanierungen).values(x).onConflictDoUpdate({ target: schema.dealSanierungen.id, set: { ...x, updatedAt: sql`now()` } });
    }
    return { id, version, kennzahlen };
  });
}

export async function kommentarAnlegen(db: Db, dealId: string, text: string) {
  const [deal] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
  if (!deal) throw new FachFehler(404, 'Deal nicht gefunden');
  const [neu] = await db
    .insert(schema.dealKommentare)
    .values({ id: `${dealId}:${crypto.randomUUID()}`, dealId, text, zeitpunkt: sql`now()` })
    .returning({ id: schema.dealKommentare.id, zeitpunkt: schema.dealKommentare.zeitpunkt, text: schema.dealKommentare.text });
  return neu!;
}

/** „Erledigt“ (Cockpit, Briefing): letzter Kontakt heute, nächster nach Frequenz (09, Nachfass-Regeln). */
export async function dealErledigt(db: Db, id: string, version: number, heute: string) {
  return db.transaction(async (tx) => {
    const [deal] = await tx.select({ next: schema.deals.nextContact, freq: schema.deals.nachfassFrequenz }).from(schema.deals).where(eq(schema.deals.id, id));
    const neu = await versionFortschreiben(tx, schema.deals, id, version, 'Deal');
    const termin = erledigtTermin(deal!.next, heute, deal!.freq);
    await tx.update(schema.deals).set(termin).where(eq(schema.deals.id, id));
    return { id, version: neu, ...termin };
  });
}

/** Objekt im Info-Reiter wechseln (d-obj → dealPrefillObj → dealSave): Kaufpreis/Wohnfläche und Einheiten aus dem neuen Objekt. */
export async function dealObjektWechseln(db: Db, id: string, objektId: string, version: number) {
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.deals, id, version, 'Deal');
    const [d] = await tx.select({ objektId: schema.deals.objektId, kalkulation: schema.deals.kalkulation }).from(schema.deals).where(eq(schema.deals.id, id));
    if (d!.objektId === objektId) return { id, version: neu };
    await tx.update(schema.deals).set({ objektId }).where(eq(schema.deals.id, id));
    await ausObjektVorbelegen(tx, id, objektId, (d!.kalkulation as Record<string, unknown> | null) ?? {});
    return { id, version: neu };
  });
}

/** dealDelete → softDelete: in den Papierkorb. */
export async function dealLoeschen(db: Db, id: string) {
  const [d] = await db.update(schema.deals).set({ deletedAt: sql`now()` }).where(and(eq(schema.deals.id, id), isNull(schema.deals.deletedAt))).returning({ id: schema.deals.id });
  if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
  return { id };
}
