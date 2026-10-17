/**
 * Unternehmen der Makler (Normalform seit 17.10.2026, Protokoll 32). Die frühere Textspalte `makler.firma` ist eine eigene
 * Tabelle; nach außen bleibt „firma“ ein abgeleitetes Feld (Name des verknüpften Unternehmens), damit Listen, Karten, Suche,
 * Dubletten, Golden Master und Paritätstest unverändert bleiben.
 *
 * Firmen kommen als Text herein (Dialog, Exposé, Tabellenimport, Umzug): `unternehmenFuerFirma` findet das vorhandene
 * Unternehmen über den normierten Namen oder legt es an — nie Dubletten, nie Rückfrage.
 */
import type { Unternehmen, UnternehmenAendern, UnternehmenAnlegen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { domainAusAdresse, rechtsformAusName, unternehmenNameNormieren, webseiteNormieren } from '@gg/domain';
import { and, asc, eq, getTableColumns, isNull, ne, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import type { Tx } from './tx.ts';
import { versionFortschreiben } from './version.ts';

/**
 * Firmenname und Webseite des Maklers per Unterabfrage — Ersatz für die früheren Spalten `makler.firma`/`makler.webseite`.
 * Die äußere Spalte steht bewusst als `"makler"."unternehmen_id"` im Text: Drizzle schreibt Spalten bei einer einzelnen
 * Tabelle ohne Tabellennamen, und ein nacktes `"id"` träfe in der Unterabfrage die falsche Tabelle.
 */
export const maklerFirma = sql<string | null>`(select u.name from fach.unternehmen u where u.id = "makler"."unternehmen_id" and u.deleted_at is null)`;
export const maklerWebseite = sql<string | null>`(select u.webseite from fach.unternehmen u where u.id = "makler"."unternehmen_id" and u.deleted_at is null)`;

/** Alle Makler-Spalten plus `firma` und `webseite` wie früher — für `db.select(maklerMitFirma).from(schema.makler)`. */
export const maklerMitFirma = { ...getTableColumns(schema.makler), firma: maklerFirma, webseite: maklerWebseite };

const maklerAnzahl = sql<number>`(select count(*)::int from fach.makler mk where mk.unternehmen_id = "unternehmen"."id" and mk.deleted_at is null)`;

const spalten = {
  id: schema.unternehmen.id, name: schema.unternehmen.name, rechtsform: schema.unternehmen.rechtsform, domain: schema.unternehmen.domain,
  webseite: schema.unternehmen.webseite, strasse: schema.unternehmen.strasse, plz: schema.unternehmen.plz, ort: schema.unternehmen.ort,
  tel: schema.unternehmen.tel, fax: schema.unternehmen.fax, email: schema.unternehmen.email, notizen: schema.unternehmen.notizen,
  quelle: schema.unternehmen.quelle, geprueftAm: schema.unternehmen.geprueftAm, version: schema.unternehmen.version, maklerAnzahl,
};

type DbOderTx = Db | Tx;
const leerZuNull = (v: string | null | undefined) => { const t = (v ?? '').trim(); return t ? t : null; };

export async function unternehmenListe(db: Db): Promise<Unternehmen[]> {
  return db.select(spalten).from(schema.unternehmen).where(isNull(schema.unternehmen.deletedAt)).orderBy(asc(sql`lower(${schema.unternehmen.name})`));
}

export async function unternehmenDetail(db: DbOderTx, id: string): Promise<Unternehmen> {
  const [u] = await db.select(spalten).from(schema.unternehmen).where(and(eq(schema.unternehmen.id, id), isNull(schema.unternehmen.deletedAt)));
  if (!u) throw new FachFehler(404, 'Unternehmen nicht gefunden');
  return u;
}

/** Vorhandenes Unternehmen zum Namen (normiert, ohne Gelöschte). */
export async function unternehmenZuName(db: DbOderTx, name: string | null | undefined) {
  const normiert = unternehmenNameNormieren(name);
  if (!normiert) return null;
  const [u] = await db.select({ id: schema.unternehmen.id, webseite: schema.unternehmen.webseite, domain: schema.unternehmen.domain, email: schema.unternehmen.email })
    .from(schema.unternehmen).where(and(eq(schema.unternehmen.nameNormiert, normiert), isNull(schema.unternehmen.deletedAt)));
  return u ?? null;
}

export interface FirmaZusatz { webseite?: string | null; email?: string | null; quelle?: string }

/**
 * Firma als Text → Unternehmens-ID: vorhandenes per normiertem Namen, sonst neu angelegt (Rechtsform und Domain aus Name,
 * Webseite und E-Mail abgeleitet). Beim vorhandenen Unternehmen werden nur leere Felder (Webseite, Domain) ergänzt,
 * nie überschrieben. Leerer Name → null (Makler ohne Unternehmen).
 */
export async function unternehmenFuerFirma(db: DbOderTx, firma: string | null | undefined, zusatz: FirmaZusatz = {}): Promise<string | null> {
  const name = (firma ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const webseite = webseiteNormieren(zusatz.webseite);
  const domain = domainAusAdresse(zusatz.webseite) ?? domainAusAdresse(zusatz.email);
  const vorhanden = await unternehmenZuName(db, name);
  if (vorhanden) {
    const ergaenzung: Partial<typeof schema.unternehmen.$inferInsert> = {};
    if (!vorhanden.webseite && webseite) ergaenzung.webseite = webseite;
    if (!vorhanden.domain && domain) ergaenzung.domain = domain;
    if (Object.keys(ergaenzung).length) await db.update(schema.unternehmen).set({ ...ergaenzung, updatedAt: sql`now()` }).where(eq(schema.unternehmen.id, vorhanden.id));
    return vorhanden.id;
  }
  const id = crypto.randomUUID();
  await db.insert(schema.unternehmen).values({
    id, name, nameNormiert: unternehmenNameNormieren(name), rechtsform: rechtsformAusName(name), webseite, domain, quelle: zusatz.quelle ?? 'hand',
  });
  return id;
}

/** Anlegen aus dem Dialog: gibt es den Namen schon, kommt das vorhandene Unternehmen zurück (`neu: false`). */
export async function unternehmenAnlegen(db: Db, e: UnternehmenAnlegen): Promise<Unternehmen & { neu: boolean }> {
  const vorhanden = await unternehmenZuName(db, e.name);
  if (vorhanden) return { ...(await unternehmenDetail(db, vorhanden.id)), neu: false };
  const id = await unternehmenFuerFirma(db, e.name, { webseite: e.webseite, email: e.email, quelle: 'hand' });
  if (!id) throw new FachFehler(400, 'Name fehlt');
  const felder = { strasse: leerZuNull(e.strasse), plz: leerZuNull(e.plz), ort: leerZuNull(e.ort), tel: leerZuNull(e.tel), fax: leerZuNull(e.fax), email: leerZuNull(e.email), notizen: leerZuNull(e.notizen) };
  if (Object.values(felder).some((v) => v !== null)) await db.update(schema.unternehmen).set(felder).where(eq(schema.unternehmen.id, id));
  return { ...(await unternehmenDetail(db, id)), neu: true };
}

export async function unternehmenAendern(db: Db, id: string, e: UnternehmenAendern) {
  const { version, ...felder } = e;
  return db.transaction(async (tx) => {
    const neu = await versionFortschreiben(tx, schema.unternehmen, id, version, 'Unternehmen');
    const werte: Partial<typeof schema.unternehmen.$inferInsert> = {};
    if (felder.name !== undefined) {
      const name = felder.name.replace(/\s+/g, ' ').trim();
      if (!name) throw new FachFehler(400, 'Name fehlt');
      const normiert = unternehmenNameNormieren(name);
      const [anderes] = await tx.select({ id: schema.unternehmen.id, name: schema.unternehmen.name }).from(schema.unternehmen)
        .where(and(eq(schema.unternehmen.nameNormiert, normiert), ne(schema.unternehmen.id, id), isNull(schema.unternehmen.deletedAt)));
      if (anderes) throw new FachFehler(409, `„${anderes.name}“ gibt es schon — bitte zusammenführen statt umbenennen`, { unternehmenId: anderes.id });
      werte.name = name; werte.nameNormiert = normiert; werte.rechtsform = rechtsformAusName(name);
    }
    if (felder.webseite !== undefined) {
      werte.webseite = webseiteNormieren(felder.webseite);
      if (felder.domain === undefined) werte.domain = domainAusAdresse(felder.webseite) ?? undefined;
    }
    if (felder.domain !== undefined) werte.domain = domainAusAdresse(felder.domain) ?? leerZuNull(felder.domain);
    for (const k of ['strasse', 'plz', 'ort', 'tel', 'fax', 'email', 'notizen'] as const) if (felder[k] !== undefined) werte[k] = leerZuNull(felder[k]);
    if (Object.keys(werte).length) await tx.update(schema.unternehmen).set(werte).where(eq(schema.unternehmen.id, id));
    return { id, version: neu };
  });
}

/** Löschen nur ohne Makler (sonst zusammenführen); Papierkorb wie bei den anderen Entitäten. */
export async function unternehmenLoeschen(db: Db, id: string) {
  const u = await unternehmenDetail(db, id);
  if (u.maklerAnzahl > 0) throw new FachFehler(409, `${u.maklerAnzahl} Makler gehören zu diesem Unternehmen — erst zusammenführen oder umhängen`);
  await db.update(schema.unternehmen).set({ deletedAt: sql`now()` }).where(eq(schema.unternehmen.id, id));
  return { id };
}

/**
 * Zusammenführen: alle Makler von `wegId` wechseln zu `behaltenId`, leere Felder des behaltenen Unternehmens werden aus dem
 * anderen gefüllt, der andere Datensatz wandert in den Papierkorb. Im Audit-Log nachvollziehbar.
 */
export async function unternehmenZusammenfuehren(db: Db, behaltenId: string, wegId: string) {
  if (behaltenId === wegId) throw new FachFehler(400, 'Ein Unternehmen kann nicht mit sich selbst zusammengeführt werden');
  const ergebnis = await db.transaction(async (tx) => {
    const behalten = await unternehmenDetail(tx, behaltenId);
    const weg = await unternehmenDetail(tx, wegId);
    const ergaenzung: Partial<typeof schema.unternehmen.$inferInsert> = {};
    for (const k of ['rechtsform', 'domain', 'webseite', 'strasse', 'plz', 'ort', 'tel', 'fax', 'email'] as const) if (!behalten[k] && weg[k]) ergaenzung[k] = weg[k];
    const notizen = [behalten.notizen, weg.notizen, `Zusammengeführt mit „${weg.name}“`].filter(Boolean).join('\n');
    await tx.update(schema.unternehmen).set({ ...ergaenzung, notizen, version: sql`${schema.unternehmen.version} + 1`, updatedAt: sql`now()` }).where(eq(schema.unternehmen.id, behaltenId));
    const makler = await tx.update(schema.makler).set({ unternehmenId: behaltenId, updatedAt: sql`now()` }).where(eq(schema.makler.unternehmenId, wegId)).returning({ id: schema.makler.id });
    await tx.update(schema.unternehmen).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(schema.unternehmen.id, wegId));
    return { id: behaltenId, makler: makler.length, wegName: weg.name, behaltenName: behalten.name };
  });
  await auditSchreiben(db, {
    type: 'mutation', entity: 'unternehmen', entityId: behaltenId, action: 'merge', source: '/api/unternehmen/zusammenfuehren',
    metadata: { wegId, wegName: ergebnis.wegName, behaltenName: ergebnis.behaltenName, makler: ergebnis.makler },
  });
  return { id: ergebnis.id, makler: ergebnis.makler };
}
