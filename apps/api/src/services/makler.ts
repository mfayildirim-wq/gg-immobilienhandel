import type { KommunikationAnlegen, MaklerAendern, MaklerAnlegen, MaklerDetail } from '@gg/api-contract';
import { MaklerAnlegen as MaklerAnlegenSchema } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { type DealStatus, erledigtTermin, kommZeitstempel, letzterKontaktNachEintrag, telefonNormalisieren } from '@gg/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { objektTitel } from './objekte.ts';
import { versionFortschreiben } from './version.ts';

const spalten = {
  id: schema.makler.id,
  name: schema.makler.name,
  firma: schema.makler.firma,
  tel: schema.makler.tel,
  email: schema.makler.email,
  prio: schema.makler.prio,
  kontaktFrequenz: schema.makler.kontaktFrequenz,
  nextContact: schema.makler.nextContact,
  version: schema.makler.version,
};

export async function maklerListe(db: Db) {
  const zeilen = await db
    .select(spalten)
    .from(schema.makler)
    .where(isNull(schema.makler.deletedAt))
    .orderBy(asc(schema.makler.name));
  return zeilen.map((z) => ({ ...z, prio: z.prio as 'A' | 'B' | 'C' | null }));
}

export async function maklerAnlegen(db: Db, eingabe: MaklerAnlegen) {
  const daten = MaklerAnlegenSchema.parse(eingabe);
  const [neu] = await db
    .insert(schema.makler)
    .values({ id: crypto.randomUUID(), ...daten, ...(daten.tel ? { tel: telefonNormalisieren(daten.tel) } : {}) })
    .returning(spalten);
  return { ...neu!, prio: neu!.prio as 'A' | 'B' | 'C' | null };
}

export async function maklerDetail(db: Db, id: string): Promise<MaklerDetail> {
  const [m] = await db.select().from(schema.makler).where(and(eq(schema.makler.id, id), isNull(schema.makler.deletedAt)));
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  const kommunikation = await db
    .select({
      id: schema.maklerKommunikation.id, zeitpunkt: schema.maklerKommunikation.zeitpunkt, kanal: schema.maklerKommunikation.kanal,
      richtung: schema.maklerKommunikation.richtung, betreff: schema.maklerKommunikation.betreff, text: schema.maklerKommunikation.text,
    })
    .from(schema.maklerKommunikation)
    .where(eq(schema.maklerKommunikation.maklerId, id))
    .orderBy(sql`${schema.maklerKommunikation.zeitpunkt} desc nulls last`);
  const deals = await db
    .select({ id: schema.deals.id, status: schema.deals.status, strasse: schema.objekte.strasse, hausnr: schema.objekte.hausnr, stadt: schema.objekte.stadt })
    .from(schema.deals)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .where(and(eq(schema.deals.maklerId, id), isNull(schema.deals.deletedAt)));
  return {
    id: m.id, name: m.name, firma: m.firma, tel: m.tel, email: m.email, prio: m.prio as 'A' | 'B' | 'C' | null,
    kontaktFrequenz: m.kontaktFrequenz, nextContact: m.nextContact, version: m.version, webseite: m.webseite,
    mobil: m.mobil, festnetz: m.festnetz, strasse: m.strasse, plz: m.plz, ort: m.ort,
    weitereKontakte: (m.weitereKontakte as MaklerDetail['weitereKontakte']) ?? null,
    persoenlich: (m.persoenlich as Record<string, unknown> | null) ?? null,
    lastContact: m.lastContact, beziehungsNotiz: m.beziehungsNotiz, kommunikation,
    kiSummary: m.kiSummary, kiSummaryAt: m.kiSummaryAt ? kommZeitstempel(m.kiSummaryAt) : null, erstellt: m.createdAt.slice(0, 10),
    deals: deals.map((d) => ({ id: d.id, status: d.status as DealStatus, objektTitel: objektTitel(d) })),
  };
}

export async function maklerAendern(db: Db, id: string, eingabe: MaklerAendern) {
  const { version, ...felder } = eingabe;
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.makler, id, version, 'Makler');
    // mkSave: Telefon normalisiert (0049→+49, ohne Klammern)
    if (felder.tel) felder.tel = telefonNormalisieren(felder.tel);
    for (const k of ['mobil', 'festnetz'] as const) if (felder[k]) felder[k] = telefonNormalisieren(felder[k]);
    for (const k of ['mobil', 'festnetz', 'strasse', 'plz', 'ort'] as const) if (felder[k] === '') felder[k] = null;
    if (Object.keys(felder).length) await tx.update(schema.makler).set(felder).where(eq(schema.makler.id, id));
    return { id, version: neu };
  });
}

/** mkAddKomm: Eintrag anlegen; der letzte Kontakt rückt auf den Tag des Eintrags (Import: Maildatum), nie zurück. */
export async function kommunikationAnlegen(db: Db, maklerId: string, eingabe: KommunikationAnlegen, heute?: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ id: schema.makler.id, lastContact: schema.makler.lastContact }).from(schema.makler).where(and(eq(schema.makler.id, maklerId), isNull(schema.makler.deletedAt)));
    if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
    const { datum, ...werte } = eingabe;
    const [neu] = await tx
      .insert(schema.maklerKommunikation)
      .values({ id: `${maklerId}:${crypto.randomUUID()}`, maklerId, zeitpunkt: sql`now()`, ...werte })
      .returning();
    if (heute) {
      const kontakt = letzterKontaktNachEintrag(m.lastContact, datum ?? null, heute);
      if (kontakt) await tx.update(schema.makler).set({ lastContact: kontakt, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.makler.id, maklerId));
    }
    return neu!;
  });
}

/** Persönlich-Reiter (mkSavePersonal): Geburtstag (Quelle manuell) und Ansprache; übrige persönliche Daten bleiben. */
export async function maklerPersoenlichSpeichern(db: Db, id: string, e: { geburtsdatum: string; anredeForm: '' | 'du' | 'sie' }) {
  const [m] = await db.select({ p: schema.makler.persoenlich }).from(schema.makler).where(and(eq(schema.makler.id, id), isNull(schema.makler.deletedAt)));
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  const { anredeForm: _a, ...rest } = (m.p as Record<string, unknown> | null) ?? {};
  const persoenlich = { ...rest, geburtsdatum: e.geburtsdatum.trim(), geburtstagQuelle: 'manuell', ...(e.anredeForm ? { anredeForm: e.anredeForm } : {}) };
  await db.update(schema.makler).set({ persoenlich, version: sql`${schema.makler.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.makler.id, id));
  return { persoenlich };
}

/** mkDelete → softDelete: in den Papierkorb. */
export async function maklerLoeschen(db: Db, id: string) {
  const [m] = await db.update(schema.makler).set({ deletedAt: sql`now()` }).where(and(eq(schema.makler.id, id), isNull(schema.makler.deletedAt))).returning({ id: schema.makler.id });
  if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
  return { id };
}

/** „Erledigt“ in Wählmaschine/Briefing: letzter Kontakt heute, nächster nach Kontaktfrequenz. */
export async function maklerErledigt(db: Db, id: string, version: number, heute: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ next: schema.makler.nextContact, freq: schema.makler.kontaktFrequenz }).from(schema.makler).where(eq(schema.makler.id, id));
    const neu = await versionFortschreiben(tx, schema.makler, id, version, 'Makler');
    const termin = erledigtTermin(m?.next ?? null, heute, m?.freq);
    await tx.update(schema.makler).set(termin).where(eq(schema.makler.id, id));
    return { id, version: neu, ...termin };
  });
}
