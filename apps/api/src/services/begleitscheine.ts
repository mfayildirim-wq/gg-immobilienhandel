import type { Begleitschein, BegleitscheinEintrag, BegleitscheinSpeichern, BsAktion, BsVordruck, BsVorlage } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  bsAdresseAusObjekt, bsAktionenAufraeumen, bsAktionErgebnis, bsArchivDatum, bsAusVorlage, bsName, bsSeedAktionen, bsSeedVorlage, type BsRow,
  type BsTyp, bsZaehler, type Begleitschein as BsDomain,
} from '@gg/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { dealUndObjektAlt } from './altformat.ts';

type Zeile = typeof schema.begleitscheine.$inferSelect;
type AktionZeile = typeof schema.begleitscheinAktionen.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const heuteIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const opt = (v: string | null) => v ?? undefined;
const adresse = (o: { strasse: string | null; hausnr: string | null; plz: string | null; stadt: string | null } | undefined) =>
  bsAdresseAusObjekt(o ? { strasse: opt(o.strasse), hausnr: opt(o.hausnr), plz: opt(o.plz), stadt: opt(o.stadt) } : undefined);

const alsAktion = (a: AktionZeile): BsAktion => ({
  id: a.id, label: a.label ?? '', typ: (a.typ ?? 'link') as BsAktion['typ'], aktiv: a.aktiv !== false, rowId: a.rowId ?? '',
  subId: opt(a.subId), vordruckId: opt(a.vordruckId), url: opt(a.url), modul: opt(a.modul), empfaenger: opt(a.empfaenger), betreff: opt(a.betreff),
  analyseTyp: opt(a.analyseTyp), datenQuelle: opt(a.datenQuelle),
});

async function aktionenSchreiben(tx: Tx | Db, typ: BsTyp, aktionen: readonly BsAktion[]) {
  await tx.delete(schema.begleitscheinAktionen).where(eq(schema.begleitscheinAktionen.vorlageTyp, typ));
  if (!aktionen.length) return;
  await tx.insert(schema.begleitscheinAktionen).values(aktionen.map((a, sort) => ({
    id: a.id, vorlageTyp: typ, rowId: a.rowId, subId: a.subId ?? null, typ: a.typ, label: a.label, aktiv: a.aktiv, vordruckId: a.vordruckId || null,
    url: a.url ?? null, modul: a.modul ?? null, empfaenger: a.empfaenger ?? null, betreff: a.betreff ?? null, analyseTyp: a.analyseTyp ?? null, datenQuelle: a.datenQuelle ?? null, sort,
  })));
}

/** E1/Y1 — wie beim ersten Öffnen in der alten App: fehlt die Vorlage, wird der Auslieferungszustand angelegt (Ankauf mit Aktionen). */
async function vorlageSicherstellen(db: Db, typ: BsTyp) {
  const [da] = await db.select({ typ: schema.begleitscheinVorlagen.typ }).from(schema.begleitscheinVorlagen).where(eq(schema.begleitscheinVorlagen.typ, typ));
  if (da) return;
  await db.transaction(async (tx) => {
    const seed = bsSeedVorlage(typ);
    const neu = await tx.insert(schema.begleitscheinVorlagen).values({ typ, kopf: seed.kopf, zeilen: seed.rows }).onConflictDoNothing().returning({ typ: schema.begleitscheinVorlagen.typ });
    if (neu.length && typ === 'ankauf') await aktionenSchreiben(tx, typ, bsSeedAktionen());
  });
}

export async function bsAktionenLesen(db: Db, typ: BsTyp): Promise<BsAktion[]> {
  await vorlageSicherstellen(db, typ);
  const zeilen = await db.select().from(schema.begleitscheinAktionen).where(eq(schema.begleitscheinAktionen.vorlageTyp, typ)).orderBy(asc(schema.begleitscheinAktionen.sort), asc(schema.begleitscheinAktionen.id));
  return zeilen.map(alsAktion);
}

export async function bsVorlageLesen(db: Db, typ: BsTyp): Promise<BsVorlage> {
  await vorlageSicherstellen(db, typ);
  const [v] = await db.select().from(schema.begleitscheinVorlagen).where(eq(schema.begleitscheinVorlagen.typ, typ));
  return { typ, kopf: v!.kopf ?? '', rows: (v!.zeilen as BsRow[] | null) ?? [], updatedAt: v!.updatedAt };
}

/** Vorlage speichern; Aktionen an nicht mehr vorhandenen Punkten fallen weg (alt: aktionenAufraeumen beim Löschen/Zurücksetzen). */
export async function bsVorlageSpeichern(db: Db, typ: BsTyp, e: { kopf: string; rows: BsRow[] }): Promise<{ vorlage: BsVorlage; entfernteAktionen: number }> {
  const aktionen = await bsAktionenLesen(db, typ);
  const aufger = bsAktionenAufraeumen({ typ, kopf: e.kopf, rows: e.rows }, aktionen);
  await db.transaction(async (tx) => {
    await tx.update(schema.begleitscheinVorlagen).set({ kopf: e.kopf, zeilen: e.rows, updatedAt: sql`now()` }).where(eq(schema.begleitscheinVorlagen.typ, typ));
    if (aufger.entfernt) await aktionenSchreiben(tx, typ, aufger.aktionen);
  });
  return { vorlage: await bsVorlageLesen(db, typ), entfernteAktionen: aufger.entfernt };
}

export async function bsVorlageZuruecksetzen(db: Db, typ: BsTyp) {
  const seed = bsSeedVorlage(typ);
  return bsVorlageSpeichern(db, typ, { kopf: seed.kopf, rows: seed.rows });
}

export async function bsAktionenSpeichern(db: Db, typ: BsTyp, aktionen: BsAktion[]): Promise<BsAktion[]> {
  await vorlageSicherstellen(db, typ);
  const ids = new Set<string>();
  for (const a of aktionen) { if (ids.has(a.id)) throw new FachFehler(422, `Aktions-ID doppelt: ${a.id}`); ids.add(a.id); }
  const vordrucke = new Set((await db.select({ id: schema.vordrucke.id }).from(schema.vordrucke)).map((v) => v.id));
  await db.transaction((tx) => aktionenSchreiben(tx, typ, aktionen.map((a) => (a.vordruckId && !vordrucke.has(a.vordruckId) ? { ...a, vordruckId: undefined } : a))));
  return bsAktionenLesen(db, typ);
}

export async function bsVordruckeLesen(db: Db): Promise<(BsVordruck & { verwendung: number })[]> {
  const zeilen = await db.select().from(schema.vordrucke).orderBy(asc(schema.vordrucke.sort), asc(schema.vordrucke.id));
  const aktionen = await db.select({ vordruckId: schema.begleitscheinAktionen.vordruckId }).from(schema.begleitscheinAktionen);
  return zeilen.map((v) => ({
    id: v.id, nummer: v.nummer ?? '', titel: v.titel ?? '', art: (v.art ?? 'brief') as BsVordruck['art'], inhalt: opt(v.inhalt), betreff: opt(v.betreff),
    dateiName: opt(v.dateiName), aktiv: v.aktiv !== false, verwendung: aktionen.filter((a) => a.vordruckId === v.id).length,
  }));
}

/** Liste ersetzen; gelöschte Vordrucke verlieren ihre Zuordnung (FK set null — alt blieb die ID tot stehen, Ergebnis gleich). */
export async function bsVordruckeSpeichern(db: Db, liste: BsVordruck[]) {
  await db.transaction(async (tx) => {
    const ids = liste.map((v) => v.id);
    const alle = await tx.select({ id: schema.vordrucke.id }).from(schema.vordrucke);
    for (const alt of alle) if (!ids.includes(alt.id)) await tx.delete(schema.vordrucke).where(eq(schema.vordrucke.id, alt.id));
    for (const [sort, v] of liste.entries()) {
      const werte = { nummer: v.nummer, titel: v.titel, art: v.art, inhalt: v.inhalt ?? null, betreff: v.betreff ?? null, dateiName: v.dateiName ?? null, aktiv: v.aktiv, sort };
      await tx.insert(schema.vordrucke).values({ id: v.id, ...werte }).onConflictDoUpdate({ target: schema.vordrucke.id, set: { ...werte, updatedAt: sql`now()` } });
    }
  });
  return bsVordruckeLesen(db);
}

// ── Begleitscheine ─────────────────────────────────────────

export async function begleitscheineListe(db: Db): Promise<BegleitscheinEintrag[]> {
  const zeilen = await db.select({ b: schema.begleitscheine, o: schema.objekte }).from(schema.begleitscheine)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.begleitscheine.objektId)).where(isNull(schema.begleitscheine.deletedAt));
  return zeilen.map(({ b, o }) => ({
    id: b.id, typ: b.vorlageTyp as BsTyp, objektId: b.objektId, objektAdresse: adresse(o), name: b.name ?? '', whgNr: b.whgNr,
    createdAt: b.createdAt, archiviertAm: b.archiviertAm, zaehler: bsZaehler((b.zeilen as BsRow[] | null) ?? []),
  }));
}

async function laden(db: Db, id: string): Promise<Zeile> {
  const [b] = await db.select().from(schema.begleitscheine).where(and(eq(schema.begleitscheine.id, id), isNull(schema.begleitscheine.deletedAt)));
  if (!b) throw new FachFehler(404, 'Begleitschein nicht gefunden');
  return b;
}

export async function begleitscheinDetail(db: Db, id: string): Promise<Begleitschein> {
  const b = await laden(db, id);
  const typ = b.vorlageTyp as BsTyp;
  return {
    id: b.id, typ, objektId: b.objektId, dealId: b.dealId, adresse: b.adresse ?? '', whgNr: b.whgNr, name: b.name ?? '', kopf: b.kopf ?? '',
    rows: (b.zeilen as BsRow[] | null) ?? [], archiviertAm: b.archiviertAm, version: b.version, createdAt: b.createdAt, updatedAt: b.updatedAt,
    aktionen: await bsAktionenLesen(db, typ),
  };
}

/** B7/E4 — immer bewusst angelegt: vollständige Kopie der Vorlage, Name aus Adresse + Typ (+ Whg.) + Name, Deal des Objekts verknüpft. */
export async function begleitscheinAnlegen(db: Db, e: { typ: BsTyp; objektId: string; whgNr?: string; name: string }): Promise<Begleitschein> {
  const [o] = await db.select().from(schema.objekte).where(and(eq(schema.objekte.id, e.objektId), isNull(schema.objekte.deletedAt)));
  if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
  const [deal] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.objektId, o.id), isNull(schema.deals.deletedAt))).orderBy(asc(schema.deals.createdAt)).limit(1);
  const vorlage = await bsVorlageLesen(db, e.typ);
  const whgNr = e.typ === 'verkauf' ? e.whgNr?.trim() || undefined : undefined;
  const bs = bsAusVorlage({ ...vorlage, updatedAt: vorlage.updatedAt ?? undefined }, {
    typ: e.typ, objektId: o.id, dealId: deal?.id, adresse: adresse(o), whgNr,
    name: bsName({ strasse: opt(o.strasse), hausnr: opt(o.hausnr), stadt: opt(o.stadt) }, e.typ, e.name, whgNr),
  }, crypto.randomUUID(), heuteIso());
  await db.insert(schema.begleitscheine).values({
    id: bs.id, vorlageTyp: bs.typ, objektId: bs.objektId, dealId: bs.dealId ?? null, adresse: bs.adresse, whgNr: bs.whgNr ?? null, name: bs.name, kopf: bs.kopf, zeilen: bs.rows,
  });
  return begleitscheinDetail(db, bs.id);
}

/** K1 — jede Änderung speichert; Archiv folgt dem Abschlusspunkt (D3/D4). */
export async function begleitscheinSpeichern(db: Db, id: string, e: BegleitscheinSpeichern): Promise<Begleitschein> {
  const alt = await laden(db, id);
  const domain = { ...alt, typ: alt.vorlageTyp as BsTyp, rows: e.rows } as unknown as BsDomain;
  const archiv = bsArchivDatum(domain, alt.archiviertAm, new Date().toISOString());
  const [neu] = await db.update(schema.begleitscheine)
    .set({ kopf: e.kopf, zeilen: e.rows, archiviertAm: archiv, version: sql`${schema.begleitscheine.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(schema.begleitscheine.id, id), eq(schema.begleitscheine.version, e.version), isNull(schema.begleitscheine.deletedAt)))
    .returning({ id: schema.begleitscheine.id });
  if (!neu) throw new FachFehler(409, 'Begleitschein wurde zwischenzeitlich geändert', { aktuelleVersion: alt.version });
  return begleitscheinDetail(db, id);
}

export async function begleitscheinLoeschen(db: Db, id: string) {
  const [b] = await db.update(schema.begleitscheine).set({ deletedAt: sql`now()` }).where(and(eq(schema.begleitscheine.id, id), isNull(schema.begleitscheine.deletedAt))).returning({ id: schema.begleitscheine.id });
  if (!b) throw new FachFehler(404, 'Begleitschein nicht gefunden');
  return { id };
}

/** N1 — Aktion ausführen: liest Objekt, Deal (verknüpft, sonst der des Objekts) und Vordrucke; schreibt nichts. */
export async function begleitscheinAktion(db: Db, id: string, aktionId: string) {
  const b = await laden(db, id);
  const typ = b.vorlageTyp as BsTyp;
  const a = (await bsAktionenLesen(db, typ)).find((x) => x.id === aktionId);
  if (!a) throw new FachFehler(404, 'Aktion nicht gefunden');
  let dealId = b.dealId;
  if (!dealId) {
    const [d] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.objektId, b.objektId), isNull(schema.deals.deletedAt))).orderBy(asc(schema.deals.createdAt)).limit(1);
    dealId = d?.id ?? null;
  }
  const { deal } = dealId ? await dealUndObjektAlt(db, dealId) : { deal: null };
  const [o] = await db.select().from(schema.objekte).where(eq(schema.objekte.id, b.objektId));
  const vordrucke = await bsVordruckeLesen(db);
  const bs = { id: b.id, typ, objektId: b.objektId, adresse: b.adresse ?? '', whgNr: opt(b.whgNr), name: b.name ?? '', kopf: b.kopf ?? '', rows: (b.zeilen as BsRow[]) ?? [], createdAt: b.createdAt };
  return bsAktionErgebnis(bs, a as never, {
    objekt: o ? { strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt, baujahr: o.baujahr, wohnflaeche: o.wohnflaeche, einheitenAnz: o.einheitenAnzahl } : null,
    deal, vordrucke: vordrucke as never, heute: new Date(),
  });
}
