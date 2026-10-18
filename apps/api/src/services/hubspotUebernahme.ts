/**
 * HubSpot-Übernahme (Baustein C, 17.10.2026, Protokoll 32): den Kontakt-Export (xlsx) in den Maklerbestand übernehmen.
 *
 * Je Kontakt: Abgleich mit dem Bestand (HubSpot-ID → E-Mail → Telefon → Name, `@gg/domain`; E-Mail und Telefon nur bei passendem
 * Namen — Kollegen teilen Zentralnummer und Sammelpostfach, sie werden neu angelegt und im Bericht genannt). Bekannte Makler werden nur in
 * leeren Feldern ergänzt (Telefon, Mobil, E-Mail, Anschrift, `persoenlich`), nichts wird überschrieben. Unbekannte werden angelegt:
 * Prio aus der Klassifizierung (VIP/High Potential → A, B → B, sonst C), Frequenz Monatlich (Exit → Nie), Anrede/Du-Sie/
 * Jobbezeichnung/Mailing-Status und die Herkunft mit HubSpot-ID in `persoenlich`. Das Unternehmen kommt über die E-Mail-Domain:
 * vorhandenes Unternehmen mit dieser Domain, sonst aus dem Impressum (Baustein B, `unternehmenAusDomain`), sonst ein Platzhalter
 * aus „Unternehmensname“ bzw. der Domain mit Quelle `hubspot` (Liste zeigt „Name prüfen“). Freemail-Adressen ergeben kein Unternehmen.
 *
 * `trocken`: alles wird in einer Transaktion geschrieben, gezählt und zurückgerollt — der Bericht ist derselbe. `ohneNetz`: kein
 * Impressumsabruf (Unternehmen dann nur vorhanden oder Platzhalter) — für den schnellen Probelauf.
 */
import { type Db, schema } from '@gg/db';
import {
  type BestandsMakler, domainAusAdresse, type HubspotKontakt, hubspotAbgleich, hubspotErgaenzung, hubspotKollege, hubspotFehlendeSpalten, hubspotFrequenz, hubspotKontaktLesen, hubspotPersoenlich, hubspotPrio,
  hubspotSpalten, type HubspotTreffer, weitereKontakte,
} from '@gg/domain';
import type { KiClient, Tabelle } from '@gg/integrations';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { auditSchreiben } from './audit.ts';
import { firmenauskunft, type FirmendatenOptionen, unternehmenAusAuskunft } from './firmendaten.ts';
import type { Tx } from './tx.ts';
import { unternehmenFuerFirma } from './unternehmen.ts';

export interface HubspotOptionen extends FirmendatenOptionen {
  trocken?: boolean;
  /** kein Impressumsabruf — Unternehmen nur über vorhandene Domain oder als Platzhalter */
  ohneNetz?: boolean;
  /** Datum der Übernahme (YYYY-MM-DD), Standard heute */
  heute?: string;
  /** Fortschritt je 25 Kontakte */
  fortschritt?: (fertig: number, gesamt: number) => void;
}

export interface HubspotZeile {
  id: string;
  name: string;
  email: string | null;
  klassifizierung: string | null;
  ergebnis: 'neu' | 'ergaenzt' | 'unveraendert' | 'uebersprungen';
  ueber?: HubspotTreffer['ueber'];
  /** Wie gut der Name zum getroffenen Makler passt (gleich · ähnlich · einer fehlt) */
  namePasst?: HubspotTreffer['name'];
  maklerId?: string;
  /** Neu angelegt, obwohl ein Bestandsmakler dieselbe E-Mail oder Telefonnummer hat — anderer Name, also Kollege */
  kollege?: { maklerId: string; name: string; ueber: 'email' | 'telefon' };
  /** Felder, die beim bekannten Makler gefüllt wurden */
  ergaenzt?: string[];
  unternehmen?: { id: string; name: string; weg: 'vorhanden' | 'impressum' | 'platzhalter' } | null;
  grund?: string;
}

export interface HubspotBericht {
  datei: string;
  zeitpunkt: string;
  trocken: boolean;
  ohneNetz: boolean;
  mitKi: boolean;
  gelesen: number;
  uebersprungen: number;
  bekannt: { gesamt: number; ueber: Record<HubspotTreffer['ueber'], number>; ergaenzt: number; unveraendert: number; felder: Record<string, number> };
  neu: { gesamt: number; prio: Record<'A' | 'B' | 'C', number>; frequenzNie: number };
  /** Unternehmen je Domain (nicht je Kontakt); `ohne` = neue Makler ohne Unternehmen */
  unternehmen: { vorhanden: number; impressum: number; platzhalter: number; ohne: number };
  /** Namenstreffer gesondert — die sollte man ansehen */
  namenstreffer: { hubspot: string; makler: string; maklerId: string }[];
  /** Treffer über E-Mail oder Telefon, bei denen der Name nur ähnlich ist oder fehlt — ebenfalls ansehen */
  kontaktdatenTreffer: { hubspot: string; makler: string; maklerId: string; ueber: 'email' | 'telefon'; name: 'aehnlich' | 'fehlt' }[];
  /** Neu angelegt trotz gleicher Kontaktdaten eines Bestandsmaklers (anderer Name: Zentralnummer, Sammelpostfach, weitere Kontakte) */
  kollegen: { hubspot: string; makler: string; maklerId: string; ueber: 'email' | 'telefon' }[];
  zeilen: HubspotZeile[];
}

class Zurueckrollen extends Error {
  constructor(readonly bericht: HubspotBericht) { super('HubSpot-Übernahme zurückgerollt (Probelauf)'); }
}

const FREEMAIL_OHNE_UNTERNEHMEN = 'Freemail-Adresse — kein Unternehmen';

/** Alle Makler mit den Feldern für den Abgleich. */
async function bestandLaden(tx: Tx): Promise<(BestandsMakler & { strasse: string | null; plz: string | null; ort: string | null; unternehmenId: string | null })[]> {
  return tx.select({
    id: schema.makler.id, name: schema.makler.name, email: schema.makler.email, tel: schema.makler.tel, mobil: schema.makler.mobil, festnetz: schema.makler.festnetz,
    weitereKontakte: schema.makler.weitereKontakte, persoenlich: schema.makler.persoenlich, strasse: schema.makler.strasse, plz: schema.makler.plz, ort: schema.makler.ort, unternehmenId: schema.makler.unternehmenId,
  }).from(schema.makler).where(isNull(schema.makler.deletedAt)) as never;
}

/**
 * Unternehmen zu einem Kontakt: über die Domain der E-Mail (vorhanden → Impressum → Platzhalter). Ohne verwertbare Domain und ohne
 * „Unternehmensname“ bleibt der Makler ohne Unternehmen.
 */
async function unternehmenFuerKontakt(db: Db, tx: Tx, ki: KiClient | null | undefined, k: HubspotKontakt, o: HubspotOptionen, zwischen: Map<string, HubspotZeile['unternehmen']>): Promise<HubspotZeile['unternehmen']> {
  const domain = domainAusAdresse(k.email) ?? domainAusAdresse(k.webseite);
  const schluessel = domain ?? (k.firma ? `firma:${k.firma.toLowerCase()}` : null);
  if (!schluessel) return null;
  const bekannt = zwischen.get(schluessel);
  if (bekannt !== undefined) return bekannt;
  let ergebnis: HubspotZeile['unternehmen'] = null;
  if (domain) {
    const [vorhanden] = await tx.select({ id: schema.unternehmen.id, name: schema.unternehmen.name }).from(schema.unternehmen)
      .where(and(eq(schema.unternehmen.domain, domain), isNull(schema.unternehmen.deletedAt))).limit(1);
    if (vorhanden) ergebnis = { ...vorhanden, weg: 'vorhanden' };
    else if (!o.ohneNetz) {
      // Abruf und Zwischenspeicher außerhalb der Transaktion (bleiben auch im Probelauf), das Unternehmen selbst in ihr
      const a = await firmenauskunft(db, ki, domain, o);
      const id = await unternehmenAusAuskunft(tx, domain, a);
      if (id) {
        const [u] = await tx.select({ name: schema.unternehmen.name }).from(schema.unternehmen).where(eq(schema.unternehmen.id, id));
        ergebnis = { id, name: u?.name ?? domain, weg: 'impressum' };
      }
    }
  }
  if (!ergebnis) {
    // Platzhalter: „Unternehmensname“ aus HubSpot (oft selbst nur eine Domain), sonst die Domain — zum Prüfen markiert
    const name = k.firma ?? domain!;
    const id = await unternehmenFuerFirma(tx, name, { webseite: k.webseite ?? (domain ? domain : null), email: k.email, quelle: 'hubspot' });
    if (id) {
      const [u] = await tx.select({ name: schema.unternehmen.name, quelle: schema.unternehmen.quelle, notizen: schema.unternehmen.notizen }).from(schema.unternehmen).where(eq(schema.unternehmen.id, id));
      // Gab es den Namen schon (z. B. „Deutsche Immobilien“ von Hand angelegt), zählt es als vorhanden
      const weg: 'vorhanden' | 'platzhalter' = u?.quelle === 'hubspot' ? 'platzhalter' : 'vorhanden';
      if (weg === 'platzhalter' && domain && k.firmenAnschrift) {
        await tx.update(schema.unternehmen).set({ notizen: sql`coalesce(${schema.unternehmen.notizen}, '') || ${`Name prüfen · HubSpot-Anschrift: ${k.firmenAnschrift}\n`}` }).where(eq(schema.unternehmen.id, id));
      }
      ergebnis = { id, name: u?.name ?? name, weg };
    }
  }
  zwischen.set(schluessel, ergebnis);
  return ergebnis;
}

export async function hubspotUebernehmen(db: Db, ki: KiClient | null | undefined, tabelle: Tabelle, datei: string, o: HubspotOptionen = {}): Promise<HubspotBericht> {
  const spalten = hubspotSpalten(tabelle.ueberschriften);
  const fehlend = hubspotFehlendeSpalten(spalten);
  if (fehlend.length) throw new FachFehler(422, `Das ist kein HubSpot-Kontaktexport — es fehlen die Spalten: ${fehlend.join(', ')}`);
  const heute = o.heute ?? new Date().toISOString().slice(0, 10);
  const bericht: HubspotBericht = {
    datei, zeitpunkt: new Date().toISOString(), trocken: !!o.trocken, ohneNetz: !!o.ohneNetz, mitKi: !!ki && !o.ohneNetz,
    gelesen: 0, uebersprungen: 0,
    bekannt: { gesamt: 0, ueber: { 'hubspot-id': 0, email: 0, telefon: 0, name: 0 }, ergaenzt: 0, unveraendert: 0, felder: {} },
    neu: { gesamt: 0, prio: { A: 0, B: 0, C: 0 }, frequenzNie: 0 },
    unternehmen: { vorhanden: 0, impressum: 0, platzhalter: 0, ohne: 0 },
    namenstreffer: [], kontaktdatenTreffer: [], kollegen: [], zeilen: [],
  };
  const kontakte = tabelle.zeilen.map((z) => hubspotKontaktLesen(z, spalten)).filter((k): k is HubspotKontakt => !!k);
  bericht.gelesen = kontakte.length;

  const lauf = async (tx: Tx) => {
    const bestand = await bestandLaden(tx);
    const zwischen = new Map<string, HubspotZeile['unternehmen']>();
    let fertig = 0;
    for (const k of kontakte) {
      const zeile: HubspotZeile = { id: k.id, name: k.name, email: k.email, klassifizierung: k.klassifizierung, ergebnis: 'uebersprungen' };
      bericht.zeilen.push(zeile);
      if (!k.name && !k.email && !k.tel && !k.mobil) { zeile.grund = 'weder Name noch E-Mail noch Telefon'; bericht.uebersprungen++; continue; }
      const treffer = hubspotAbgleich(k, bestand);
      if (treffer) {
        const m = bestand.find((b) => b.id === treffer.id)!;
        bericht.bekannt.gesamt++;
        bericht.bekannt.ueber[treffer.ueber]++;
        zeile.ueber = treffer.ueber; zeile.namePasst = treffer.name; zeile.maklerId = m.id;
        if (treffer.ueber === 'name') bericht.namenstreffer.push({ hubspot: k.name, makler: m.name ?? '', maklerId: m.id });
        if ((treffer.ueber === 'email' || treffer.ueber === 'telefon') && treffer.name !== 'gleich') {
          bericht.kontaktdatenTreffer.push({ hubspot: k.name, makler: m.name ?? '', maklerId: m.id, ueber: treffer.ueber, name: treffer.name });
        }
        const e = hubspotErgaenzung(k, m, heute);
        const werte: Record<string, unknown> = { ...e.felder };
        if (e.persoenlich) werte.persoenlich = e.persoenlich;
        if (!m.unternehmenId) {
          const u = await unternehmenFuerKontakt(db, tx, ki, k, o, zwischen);
          if (u) { werte.unternehmenId = u.id; zeile.unternehmen = u; }
        }
        const geaenderteFelder = Object.keys(werte).filter((f) => f !== 'persoenlich');
        if (Object.keys(werte).length) {
          await tx.update(schema.makler).set({ ...werte, updatedAt: sql`now()` }).where(eq(schema.makler.id, m.id));
          // Bestand im Speicher nachziehen, damit spätere Zeilen den neuen Stand sehen
          Object.assign(m, e.felder, e.persoenlich ? { persoenlich: e.persoenlich } : {}, werte.unternehmenId ? { unternehmenId: werte.unternehmenId } : {});
          zeile.ergebnis = 'ergaenzt'; zeile.ergaenzt = geaenderteFelder.concat(e.persoenlich ? ['persoenlich'] : []);
          bericht.bekannt.ergaenzt++;
          for (const f of zeile.ergaenzt) bericht.bekannt.felder[f] = (bericht.bekannt.felder[f] ?? 0) + 1;
        } else { zeile.ergebnis = 'unveraendert'; bericht.bekannt.unveraendert++; }
      } else {
        const kollege = hubspotKollege(k, bestand);
        if (kollege) {
          const km = bestand.find((b) => b.id === kollege.id)!;
          zeile.kollege = { maklerId: km.id, name: km.name ?? '', ueber: kollege.ueber };
          bericht.kollegen.push({ hubspot: k.name, makler: km.name ?? '', maklerId: km.id, ueber: kollege.ueber });
        }
        const u = await unternehmenFuerKontakt(db, tx, ki, k, o, zwischen);
        const id = crypto.randomUUID();
        const prio = hubspotPrio(k.klassifizierung);
        const frequenz = hubspotFrequenz(k.klassifizierung);
        const haupt = k.tel ?? k.mobil;
        const mobil = k.mobil && k.mobil !== haupt ? k.mobil : null;
        const weitere = weitereKontakte({ name: k.name, tel: haupt, mobil, email: k.email }, { emails: k.zusatzEmails, telefonnummern: [] });
        await tx.insert(schema.makler).values({
          id, name: k.name || null, unternehmenId: u?.id ?? null, tel: haupt, mobil, email: k.email,
          strasse: k.strasse, plz: k.plz, ort: k.ort, weitereKontakte: weitere, prio, kontaktFrequenz: frequenz,
          lastContact: k.letzterKontakt, persoenlich: hubspotPersoenlich(k, heute), tags: ['HubSpot'],
        });
        bestand.push({ id, name: k.name || null, email: k.email, tel: haupt, mobil, festnetz: null, weitereKontakte: weitere, persoenlich: hubspotPersoenlich(k, heute), strasse: k.strasse, plz: k.plz, ort: k.ort, unternehmenId: u?.id ?? null });
        zeile.ergebnis = 'neu'; zeile.maklerId = id; zeile.unternehmen = u;
        bericht.neu.gesamt++; bericht.neu.prio[prio]++;
        if (frequenz === 'Nie') bericht.neu.frequenzNie++;
        if (!u) zeile.grund = domainAusAdresse(k.email) === null && k.email ? FREEMAIL_OHNE_UNTERNEHMEN : 'keine Domain und kein Unternehmensname';
      }
      if (++fertig % 25 === 0 || fertig === kontakte.length) o.fortschritt?.(fertig, kontakte.length);
    }
    // Unternehmen je Domain gezählt (nicht je Kontakt): zwei Kollegen derselben Firma sind ein Unternehmen
    for (const u of zwischen.values()) if (u) bericht.unternehmen[u.weg]++;
    bericht.unternehmen.ohne = bericht.zeilen.filter((z) => z.ergebnis === 'neu' && !z.unternehmen).length;
    await auditSchreiben(tx as never, {
      type: 'import', entity: 'makler', action: o.trocken ? 'hubspot-probelauf' : 'hubspot-uebernahme', collection: 'makler', source: 'skript/hubspot',
      metadata: { datei, gelesen: bericht.gelesen, neu: bericht.neu.gesamt, bekannt: bericht.bekannt.gesamt, ergaenzt: bericht.bekannt.ergaenzt, unternehmen: bericht.unternehmen, trocken: !!o.trocken },
    });
    if (o.trocken) throw new Zurueckrollen(bericht);
  };

  try {
    await db.transaction(lauf);
  } catch (e) {
    if (e instanceof Zurueckrollen) return e.bericht;
    throw e;
  }
  return bericht;
}

/** Lesbarer Bericht für Konsole und Datei. */
export function hubspotBerichtText(b: HubspotBericht): string {
  const z: string[] = [];
  z.push(`# HubSpot-Übernahme ${b.trocken ? '· Probelauf (zurückgerollt)' : '· geschrieben'}`);
  z.push(`Datei: ${b.datei} · ${b.zeitpunkt}${b.ohneNetz ? ' · ohne Impressumsabruf' : b.mitKi ? ' · Impressum mit KI' : ' · Impressum nur Regeln (keine KI)'}`);
  z.push('');
  z.push(`Gelesen: ${b.gelesen} Kontakte · übersprungen: ${b.uebersprungen}`);
  z.push(`Bekannt: ${b.bekannt.gesamt} (HubSpot-ID ${b.bekannt.ueber['hubspot-id']}, E-Mail ${b.bekannt.ueber.email}, Telefon ${b.bekannt.ueber.telefon}, Name ${b.bekannt.ueber.name}) — ergänzt ${b.bekannt.ergaenzt}, unverändert ${b.bekannt.unveraendert}`);
  const felder = Object.entries(b.bekannt.felder).map(([f, n]) => `${f} ${n}`).join(', ');
  if (felder) z.push(`  ergänzte Felder: ${felder}`);
  z.push(`Neu: ${b.neu.gesamt} (Prio A ${b.neu.prio.A}, B ${b.neu.prio.B}, C ${b.neu.prio.C}; Frequenz „Nie“ ${b.neu.frequenzNie})`);
  z.push(`Unternehmen: vorhanden ${b.unternehmen.vorhanden}, aus Impressum ${b.unternehmen.impressum}, Platzhalter „Name prüfen“ ${b.unternehmen.platzhalter}, ohne ${b.unternehmen.ohne}`);
  if (b.namenstreffer.length) {
    z.push('');
    z.push(`Namenstreffer (bitte ansehen, ${b.namenstreffer.length}):`);
    for (const n of b.namenstreffer) z.push(`  · HubSpot „${n.hubspot}“ → Makler „${n.makler}“ (${n.maklerId})`);
  }
  if (b.kontaktdatenTreffer.length) {
    z.push('');
    z.push(`Treffer über Kontaktdaten mit nur ähnlichem oder fehlendem Namen (bitte ansehen, ${b.kontaktdatenTreffer.length}):`);
    for (const n of b.kontaktdatenTreffer) z.push(`  · HubSpot „${n.hubspot}“ → Makler „${n.makler}“ (${n.maklerId}, über ${n.ueber === 'email' ? 'E-Mail' : 'Telefon'}, Name ${n.name === 'aehnlich' ? 'ähnlich' : 'fehlt'})`);
  }
  if (b.kollegen.length) {
    z.push('');
    z.push(`Neu angelegt trotz gleicher Kontaktdaten eines Bestandsmaklers — anderer Name, also Kollege (${b.kollegen.length}):`);
    for (const n of b.kollegen) z.push(`  · HubSpot „${n.hubspot}“ neben Makler „${n.makler}“ (${n.maklerId}, gleiche ${n.ueber === 'email' ? 'E-Mail' : 'Telefonnummer'})`);
  }
  const ohne = b.zeilen.filter((x) => x.ergebnis === 'neu' && !x.unternehmen);
  if (ohne.length) {
    z.push('');
    z.push(`Neue Makler ohne Unternehmen (${ohne.length}): ${ohne.slice(0, 15).map((x) => `${x.name}${x.grund === FREEMAIL_OHNE_UNTERNEHMEN ? ' (Freemail)' : ''}`).join(', ')}${ohne.length > 15 ? ' …' : ''}`);
  }
  return z.join('\n');
}
