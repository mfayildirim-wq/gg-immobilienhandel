/**
 * Firmendaten aus dem Impressum (Baustein B, 17.10.2026, Protokoll 32). Zwischenspeicher je Domain (`fach.firmen_auskuenfte`),
 * Prüfung eines Unternehmens gegen sein Impressum und — für die HubSpot-Übernahme (Baustein C) — ein Unternehmen zu einer
 * Domain finden oder aus dem Impressum anlegen.
 *
 * Entscheidung des Auftraggebers (17.10.): Unternehmensfelder dürfen leere Felder automatisch füllen; gefüllte Felder werden
 * nie überschrieben, Abweichungen sind Vorschläge. Kosten der KI stehen im Audit unter `unternehmen/impressum`.
 */
import type { FirmendatenErgebnis, Unternehmen } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { domainAusAdresse, type FirmenFelder, firmenFelderVergleichen, type FirmenVergleich, rechtsformAusName } from '@gg/domain';
import { firmendatenErmitteln, type ImpressumAbrufOptionen, type KiClient } from '@gg/integrations';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { kostenBuchen } from './maklerKi.ts';
import { unternehmenDetail, unternehmenFuerFirma } from './unternehmen.ts';

const TAG_MS = 86_400_000;
/** Ein Impressum ändert sich selten; ein Fehlschlag (Seite im Umbau, Zeitüberschreitung) wird nach einer Woche neu versucht. */
const GUELTIG_TREFFER_MS = 30 * TAG_MS;
const GUELTIG_OHNE_MS = 7 * TAG_MS;

export interface FirmendatenOptionen extends ImpressumAbrufOptionen {
  /** Zwischenspeicher übergehen */
  erneut?: boolean;
  jetzt?: number;
}

export interface Firmenauskunft {
  domain: string;
  url: string | null;
  felder: FirmenFelder | null;
  abgerufenAt: string;
  ausCache: boolean;
  mitKi: boolean;
}

/**
 * Impressum einer Domain lesen — aus dem Zwischenspeicher oder frisch. Speichert auch „nichts gefunden“, damit eine Domain
 * ohne Impressum nicht bei jedem Ansehen neu abgefragt wird. Eine KI-Buchung je frischem Abruf.
 */
export async function firmenauskunft(db: Db, ki: KiClient | null | undefined, domain: string, o: FirmendatenOptionen = {}): Promise<Firmenauskunft> {
  const d = domainAusAdresse(domain) ?? domain.trim().toLowerCase();
  if (!d) throw new FachFehler(400, 'Domain fehlt');
  const jetzt = o.jetzt ?? Date.now();
  if (!o.erneut) {
    const [z] = await db.select().from(schema.firmenAuskuenfte).where(eq(schema.firmenAuskuenfte.domain, d));
    if (z) {
      const alter = jetzt - new Date(z.abgerufenAt).getTime();
      if (alter < (z.felder ? GUELTIG_TREFFER_MS : GUELTIG_OHNE_MS)) {
        const felder = (z.felder as (FirmenFelder & { _mitKi?: boolean }) | null) ?? null;
        return { domain: d, url: z.url, felder: felder ? ohneMarker(felder) : null, abgerufenAt: z.abgerufenAt, ausCache: true, mitKi: felder?._mitKi ?? false };
      }
    }
  }
  const e = await firmendatenErmitteln(d, ki, { abruf: o.abruf, zeitlimitMs: o.zeitlimitMs, lokaleZieleErlaubt: o.lokaleZieleErlaubt });
  const mitKi = e.gefunden && !!e.ki;
  if (e.gefunden && e.ki) await kostenBuchen(db, e.ki, 'unternehmen/impressum', { domain: d, url: e.url });
  const felder = e.gefunden ? { ...e.felder, _mitKi: mitKi } : null;
  const url = e.gefunden ? e.url : null;
  const [z] = await db.insert(schema.firmenAuskuenfte).values({ domain: d, url, felder, abgerufenAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.firmenAuskuenfte.domain, set: { url, felder, abgerufenAt: sql`now()` } })
    .returning({ abgerufenAt: schema.firmenAuskuenfte.abgerufenAt });
  return { domain: d, url, felder: e.gefunden ? e.felder : null, abgerufenAt: z!.abgerufenAt, ausCache: false, mitKi };
}

const ohneMarker = (f: FirmenFelder & { _mitKi?: boolean }): FirmenFelder => {
  const { _mitKi: _, ...rest } = f;
  return rest;
};

/** Die Domain, über die ein Unternehmen zu prüfen ist: gespeicherte Domain, sonst aus Webseite oder zentraler E-Mail. */
export function unternehmenDomain(u: { domain: string | null; webseite: string | null; email: string | null }): string | null {
  return u.domain ?? domainAusAdresse(u.webseite) ?? domainAusAdresse(u.email);
}

/**
 * Ein Unternehmen gegen sein Impressum prüfen: leere Felder füllen (auch Domain und Webseite, wenn sie fehlten), `geprueft_am`
 * setzen, Abweichungen als Vorschläge zurückgeben. Ohne Domain 422 — dann ist zuerst Webseite oder E-Mail einzutragen.
 */
export async function unternehmenFirmendatenPruefen(db: Db, ki: KiClient | null | undefined, id: string, o: FirmendatenOptionen = {}): Promise<FirmendatenErgebnis> {
  const u = await unternehmenDetail(db, id);
  const domain = unternehmenDomain(u);
  if (!domain) throw new FachFehler(422, 'Keine Domain bekannt — bitte Webseite oder zentrale E-Mail eintragen, dann lässt sich das Impressum finden.');
  const a = await firmenauskunft(db, ki, domain, o);
  const werte: Partial<typeof schema.unternehmen.$inferInsert> = {};
  if (!u.domain) werte.domain = a.domain;
  if (!u.webseite && a.url) werte.webseite = domainAusAdresse(a.url) ?? a.domain;
  let vergleich: FirmenVergleich = { leer: [], abweichend: [], gleich: [] };
  if (a.felder) {
    vergleich = firmenFelderVergleichen(u, a.felder);
    for (const k of vergleich.leer) {
      // Der Name ist der Schlüssel des Unternehmens: leer kommt er praktisch nicht vor; wenn doch, nur mit Rechtsform nachziehen
      if (k === 'name') { werte.name = a.felder.name!; werte.rechtsform = rechtsformAusName(a.felder.name); continue; }
      if (k === 'rechtsform' && werte.rechtsform !== undefined) continue;
      werte[k] = a.felder[k];
    }
  }
  await db.update(schema.unternehmen).set({ ...werte, geprueftAm: sql`now()`, updatedAt: sql`now()`, version: sql`${schema.unternehmen.version} + 1` })
    .where(and(eq(schema.unternehmen.id, id), isNull(schema.unternehmen.deletedAt)));
  const nachher: Unternehmen = await unternehmenDetail(db, id);
  return {
    domain: a.domain, gefunden: !!a.felder, url: a.url, ausCache: a.ausCache, abgerufenAt: a.abgerufenAt, mitKi: a.mitKi,
    ermittelt: a.felder, uebernommen: vergleich.leer, abweichend: vergleich.abweichend, gleich: vergleich.gleich, unternehmen: nachher,
  };
}

/**
 * Für die HubSpot-Übernahme (Baustein C): das Unternehmen zu einer Domain — vorhandenes (gleiche Domain), sonst aus dem
 * Impressum angelegt (Quelle „impressum“, Felder gefüllt). Null, wenn kein Impressum mit Firmennamen zu finden ist.
 */
export async function unternehmenAusDomain(db: Db, ki: KiClient | null | undefined, domain: string, o: FirmendatenOptionen = {}): Promise<string | null> {
  const d = domainAusAdresse(domain) ?? domain.trim().toLowerCase();
  if (!d) return null;
  const [vorhanden] = await db.select({ id: schema.unternehmen.id }).from(schema.unternehmen).where(and(eq(schema.unternehmen.domain, d), isNull(schema.unternehmen.deletedAt))).limit(1);
  if (vorhanden) return vorhanden.id;
  const a = await firmenauskunft(db, ki, d, o);
  if (!a.felder?.name) return null;
  const id = await unternehmenFuerFirma(db, a.felder.name, { webseite: a.url ? (domainAusAdresse(a.url) ?? d) : d, quelle: 'impressum' });
  if (!id) return null;
  const u = await unternehmenDetail(db, id);
  const werte: Partial<typeof schema.unternehmen.$inferInsert> = {};
  if (!u.domain) werte.domain = d;
  for (const k of firmenFelderVergleichen(u, a.felder).leer) if (k !== 'name') werte[k] = a.felder[k];
  await db.update(schema.unternehmen).set({ ...werte, geprueftAm: sql`now()`, updatedAt: sql`now()` }).where(eq(schema.unternehmen.id, id));
  return id;
}
