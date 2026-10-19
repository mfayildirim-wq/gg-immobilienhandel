/**
 * Unternehmen der Makler (18.10.2026). Firma, Webseite, Büroanschrift und weitere Kontakte stehen am Unternehmen;
 * die gleichnamigen Spalten am Makler sind Altfelder bis zur Aufräum-Migration.
 *
 * Lesen: `MAKLER_AUFGELOEST` + `UNTERNEHMEN_JOIN` liefern Makler-Zeilen mit den Werten des Unternehmens, wo es eins
 * gibt, sonst mit den Altfeldern — so läuft der Code auch vor der Übernahme (Migration `unternehmen_uebernahme`).
 * Schreiben: nur hier. Wer ein Altfeld über das Unternehmen setzt, leert es am Makler, sonst käme der alte Wert über
 * den Rückfall wieder zum Vorschein.
 */
import { type Db, schema } from '@gg/db';
import {
  type MaklerFuerUnternehmen, type UnternehmenFelder, type WeitereKontakte, unternehmenDomain, unternehmenErgaenzen, unternehmenSchluessel,
} from '@gg/domain';
import { and, asc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import type { Tx } from './tx.ts';

const u = schema.unternehmen;
const m = schema.makler;
const uHatAdresse = sql`(${u.strasse} is not null or ${u.plz} is not null or ${u.ort} is not null)`;

export const UNTERNEHMEN_JOIN = and(eq(u.id, m.unternehmenId), isNull(u.deletedAt));

/** Firmenname eines Maklers (für Abfragen mit eigener Spaltenliste; braucht `leftJoin(schema.unternehmen, UNTERNEHMEN_JOIN)`). */
export const MAKLER_FIRMA = sql<string | null>`coalesce(${u.name}, ${m.firma})`;

/** Alle Makler-Spalten, Firmenfelder aus dem Unternehmen (Anschrift nur als Ganzes). */
/** Anzeigename „Vorname Name“; ohne Vorname steht der volle Name in `name` (19.10.2026). */
export const MAKLER_NAME = sql<string | null>`nullif(concat_ws(' ', ${m.vorname}, ${m.name}), '')`;

export const MAKLER_AUFGELOEST = {
  ...getTableColumns(m),
  name: MAKLER_NAME,
  nachname: m.name,
  firma: MAKLER_FIRMA,
  webseite: sql<string | null>`coalesce(${u.webseite}, ${m.webseite})`,
  strasse: sql<string | null>`case when ${uHatAdresse} then ${u.strasse} else ${m.strasse} end`,
  plz: sql<string | null>`case when ${uHatAdresse} then ${u.plz} else ${m.plz} end`,
  ort: sql<string | null>`case when ${uHatAdresse} then ${u.ort} else ${m.ort} end`,
  weitereKontakte: sql<unknown>`coalesce(${u.weitereKontakte}, ${m.weitereKontakte})`,
};

const FIRMEN_FELDER = ['webseite', 'strasse', 'plz', 'ort'] as const;
type FirmenFeld = (typeof FIRMEN_FELDER)[number];

const vollerName = (z: { vorname: string | null; name: string | null }) => [z.vorname, z.name].filter(Boolean).join(' ') || null;
const alsKollege = (z: typeof m.$inferSelect): MaklerFuerUnternehmen => ({ id: z.id, name: vollerName(z), tel: z.tel, mobil: z.mobil, festnetz: z.festnetz, email: z.email });

const kollegen = (tx: Tx, unternehmenId: string): Promise<MaklerFuerUnternehmen[]> =>
  tx.select({ id: m.id, name: MAKLER_NAME, tel: m.tel, mobil: m.mobil, festnetz: m.festnetz, email: m.email })
    .from(m).where(and(eq(m.unternehmenId, unternehmenId), isNull(m.deletedAt)));

async function unternehmenAendern(tx: Tx, id: string, felder: object) {
  if (!Object.keys(felder).length) return;
  await tx.update(u).set({ ...felder, version: sql`${u.version} + 1`, updatedAt: sql`now()` }).where(eq(u.id, id));
}

/**
 * Unternehmen zu einem Firmennamen: vorhandenes (gleicher Schlüssel) ergänzen oder neu anlegen.
 * `neu` heißt: eben angelegt — die mitgegebenen Felder sind dann seine Werte.
 */
export async function unternehmenZuordnen(tx: Tx, name: string, felder: UnternehmenFelder & { email?: string | null } = {}, makler: MaklerFuerUnternehmen[] = []) {
  const schluessel = unternehmenSchluessel(name);
  if (!schluessel) return null;
  const [vorhanden] = await tx.select().from(u).where(and(eq(u.nameSchluessel, schluessel), isNull(u.deletedAt))).orderBy(asc(u.createdAt)).limit(1);
  if (vorhanden) {
    const dazu = unternehmenErgaenzen(
      { ...vorhanden, weitereKontakte: vorhanden.weitereKontakte as WeitereKontakte | null },
      { ...felder, domain: felder.domain ?? unternehmenDomain(felder.webseite, felder.email) },
      [...(await kollegen(tx, vorhanden.id)), ...makler],
    );
    await unternehmenAendern(tx, vorhanden.id, dazu);
    return { id: vorhanden.id, neu: false };
  }
  const id = crypto.randomUUID();
  const ergaenzt = unternehmenErgaenzen({}, felder, makler);
  await tx.insert(u).values({
    id, name: name.trim().replace(/\s+/g, ' '), nameSchluessel: schluessel,
    ...ergaenzt, domain: unternehmenDomain(felder.webseite, felder.email),
  });
  return { id, neu: true };
}

/**
 * Altfelder eines Maklers (Firma, Webseite, Anschrift, weitere Kontakte) ins Unternehmen verschieben — nach dem Anlegen
 * (Formular, Exposé, Liste). Ohne Firma bleibt alles am Makler.
 */
export async function maklerInsUnternehmen(tx: Tx, maklerId: string) {
  const [z] = await tx.select().from(m).where(eq(m.id, maklerId));
  if (!z || z.unternehmenId || !unternehmenSchluessel(z.firma)) return z?.unternehmenId ?? null;
  const ergebnis = await unternehmenZuordnen(tx, z.firma!, {
    webseite: z.webseite, strasse: z.strasse, plz: z.plz, ort: z.ort, email: z.email, weitereKontakte: z.weitereKontakte as WeitereKontakte | null,
  }, [alsKollege(z)]);
  await tx.update(m).set({ unternehmenId: ergebnis!.id, firma: null, webseite: null, strasse: null, plz: null, ort: null, weitereKontakte: null })
    .where(eq(m.id, maklerId));
  return ergebnis!.id;
}

export type FirmaEingabe = { firma?: string | null } & Partial<Record<FirmenFeld, string | null>>;

/**
 * Makler ändern, Teil Unternehmen: `firma` ordnet zu (neu/anderes Unternehmen/keins), Webseite und Anschrift gelten
 * für das Unternehmen und damit für alle seine Makler. Wechselt der Makler zu einem schon bestehenden Unternehmen,
 * füllen die mitgeschickten Werte dort nur Lücken — das Formular trägt ja noch die Angaben der alten Firma.
 */
export async function maklerFirmaSetzen(tx: Tx, maklerId: string, eingabe: FirmaEingabe) {
  const e = { ...eingabe };
  const [z] = await tx.select().from(m).where(eq(m.id, maklerId));
  if (!z) throw new FachFehler(404, 'Makler nicht gefunden');
  let unternehmenId = z.unternehmenId;
  let nurLuecken = false;
  const maklerSetzen: Record<string, unknown> = {};

  if (e.firma !== undefined) {
    const [aktuell] = unternehmenId ? await tx.select({ s: u.nameSchluessel }).from(u).where(eq(u.id, unternehmenId)) : [];
    const bisher = aktuell ? aktuell.s : unternehmenSchluessel(z.firma);
    const neuSchluessel = unternehmenSchluessel(e.firma);
    if (!neuSchluessel) unternehmenId = null;
    else if (neuSchluessel !== bisher || !unternehmenId) {
      // Altbestand ohne Unternehmen, aber gleicher Name: anhängen — die Formularwerte sind dann seine eigenen.
      // Erstmals im Unternehmen: seine weiteren Kontakte gehen mit.
      const mit = z.unternehmenId ? {} : { weitereKontakte: z.weitereKontakte as WeitereKontakte | null };
      const ergebnis = (await unternehmenZuordnen(tx, e.firma!, mit, [alsKollege(z)]))!;
      nurLuecken = neuSchluessel !== bisher && !ergebnis.neu;
      unternehmenId = ergebnis.id;
    }
    Object.assign(maklerSetzen, { unternehmenId, firma: null });
    if (unternehmenId && !z.unternehmenId) {
      maklerSetzen.weitereKontakte = null;
      // Felder, die das Formular nicht schickt, nimmt der Makler mit
      for (const f of FIRMEN_FELDER) if (e[f] === undefined && z[f]) e[f] = z[f];
    }
  }

  const gesendet = FIRMEN_FELDER.filter((f) => e[f] !== undefined);
  if (unternehmenId && gesendet.length) {
    const wert = (f: FirmenFeld) => e[f]?.trim() || null;
    if (nurLuecken) {
      const [alt] = await tx.select().from(u).where(eq(u.id, unternehmenId));
      await unternehmenAendern(tx, unternehmenId, unternehmenErgaenzen(alt! as UnternehmenFelder, Object.fromEntries(gesendet.map((f) => [f, wert(f)]))));
    } else {
      const felder: Record<string, unknown> = Object.fromEntries(gesendet.map((f) => [f, wert(f)]));
      if (felder.webseite !== undefined) felder.domain = unternehmenDomain(felder.webseite as string | null) ?? undefined;
      const [alt] = await tx.select().from(u).where(eq(u.id, unternehmenId));
      const geaendert = Object.fromEntries(Object.entries(felder).filter(([k, v]) => v !== undefined && (alt as Record<string, unknown>)[k] !== v));
      await unternehmenAendern(tx, unternehmenId, geaendert);
    }
    for (const f of gesendet) maklerSetzen[f] = null;
  } else {
    for (const f of gesendet) maklerSetzen[f] = e[f]?.trim() || null;
  }
  if (Object.keys(maklerSetzen).length) await tx.update(m).set(maklerSetzen).where(eq(m.id, maklerId));
  return unternehmenId;
}

/** Die anderen Makler desselben Unternehmens (Profil: „Weitere Makler im Unternehmen“). */
export async function unternehmenKurz(tx: Db | Tx, unternehmenId: string | null, ohneMaklerId: string) {
  if (!unternehmenId) return null;
  const [x] = await tx.select({ id: u.id, name: u.name }).from(u).where(and(eq(u.id, unternehmenId), isNull(u.deletedAt)));
  if (!x) return null;
  const alle = await tx.select({ id: m.id, name: MAKLER_NAME }).from(m).where(and(eq(m.unternehmenId, unternehmenId), isNull(m.deletedAt))).orderBy(asc(MAKLER_NAME));
  return { ...x, makler: alle.filter((k) => k.id !== ohneMaklerId) };
}
