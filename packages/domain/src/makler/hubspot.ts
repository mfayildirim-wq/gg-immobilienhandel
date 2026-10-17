/**
 * HubSpot-Übernahme (Baustein C, 17.10.2026, Protokoll 32): den Kontakt-Export aus HubSpot (xlsx, 316 Spalten) lesen und auf
 * Makler abbilden. Hier die reinen Regeln — Spalten finden, Zeile zu Kontakt, Telefon bereinigen, Prio und Frequenz aus der
 * Klassifizierung, Herkunft und Anrede nach `persoenlich`, Abgleich mit dem Bestand (E-Mail → Telefon → Name), Ergänzung
 * leerer Felder. Schreiben, Unternehmen und Bericht liegen im API-Service `hubspotUebernahme.ts`.
 *
 * Entscheidungen des Auftraggebers (17.10.): alle Kontakte übernehmen („Test“ = Prio C), bekannte Makler nur in leeren Feldern
 * ergänzen, Exit → Frequenz „Nie“, Anrede/Du-Sie/Jobbezeichnung/Mailing-Status nach `persoenlich`.
 */
import { telefonNormalisieren, telefonPruefen } from '../expose/uebernahme.ts';
import type { Frequenz } from '../nachfassen.ts';
import { telefonSchluessel } from './kontakte.ts';
import type { MaklerPersonal } from './persona.ts';

/** Spalten des HubSpot-Exports, die wir lesen — Überschrift wie in der Datei (Leerraum am Rand zählt nicht). */
export const HUBSPOT_SPALTEN = {
  id: 'Datensatz-ID', vorname: 'Vorname', nachname: 'Nachname', anrede: 'Anrede', duSie: 'Du / Sie',
  email: 'E-Mail', zusatzEmails: 'Zusätzliche E-Mail-Adressen', emailDomain: 'E-Mail-Domain',
  tel: 'Telefonnummer', mobil: 'Handynummer', fax: 'Faxnummer',
  firma: 'Unternehmensname', firmenAnschrift: 'Unternehmensanschrift', webseite: 'Webseite', webseiteUrl: 'Website-URL',
  strasse: 'Adresszeile', plz: 'Postleitzahl', ort: 'Stadt',
  klassifizierung: 'Klassifizierung', mailingStatus: 'Makler Status Mailings', stellung: 'Stellung', beruf: 'Beruf', jobbezeichnung: 'Jobbezeichnung',
  warnhinweis: 'Warnhinweis', abgemeldet: 'Von allen E-Mails abgemeldet', zustaendig: 'Für Kontakt zuständiger Mitarbeiter',
  erstelltAm: 'Erstellungsdatum', letzterKontakt: 'Letzte Kontaktaufnahme', zusammengefuehrt: 'Zusammengeführte Kontakt-IDs',
} as const;
export type HubspotSpalte = keyof typeof HUBSPOT_SPALTEN;
/** Ohne diese Spalten ist es nicht der erwartete Export. */
export const HUBSPOT_PFLICHT: readonly HubspotSpalte[] = ['id', 'vorname', 'nachname', 'email', 'tel', 'klassifizierung'];

export interface HubspotKontakt {
  id: string;
  vorname: string;
  nachname: string;
  /** „Vorname Nachname“ */
  name: string;
  anrede: string | null;
  duSie: 'Du' | 'Sie' | null;
  email: string | null;
  /** weitere Adressen aus „Zusätzliche E-Mail-Adressen“ (Semikolon-getrennt) */
  zusatzEmails: string[];
  emailDomain: string | null;
  tel: string | null;
  mobil: string | null;
  fax: string | null;
  /** „Unternehmensname“ — in der Datei oft nur eine Domain oder ein Kürzel */
  firma: string | null;
  firmenAnschrift: string | null;
  webseite: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  klassifizierung: string | null;
  mailingStatus: string | null;
  stellung: string | null;
  beruf: string | null;
  jobbezeichnung: string | null;
  warnhinweis: string | null;
  abgemeldet: boolean;
  zustaendig: string | null;
  /** ISO-Datum (YYYY-MM-DD) oder null */
  erstelltAm: string | null;
  letzterKontakt: string | null;
  zusammengefuehrteIds: string[];
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

/** Spalten in der Kopfzeile finden (−1 = fehlt). */
export function hubspotSpalten(ueberschriften: string[]): Record<HubspotSpalte, number> {
  const klein = ueberschriften.map((u) => (u ?? '').toString().trim().toLowerCase());
  const aus = {} as Record<HubspotSpalte, number>;
  for (const [k, titel] of Object.entries(HUBSPOT_SPALTEN) as [HubspotSpalte, string][]) aus[k] = klein.indexOf(titel.toLowerCase());
  return aus;
}

/** Welche Pflichtspalten fehlen — leer heißt: die Datei ist ein HubSpot-Kontaktexport. */
export const hubspotFehlendeSpalten = (spalten: Record<HubspotSpalte, number>): string[] =>
  HUBSPOT_PFLICHT.filter((k) => spalten[k] < 0).map((k) => HUBSPOT_SPALTEN[k]);

/**
 * Telefon aus HubSpot bereinigen: führendes Hochkomma (Excel-Textmarker) weg, „49711…“ ohne Plus → „+49711…“, nur „'+“ → null,
 * Platzhalter mit sieben Nullen am Ende („4971310000000“) → null; danach die Regeln der Exposé-Übernahme (0049 → +49, Klammern weg).
 */
export function hubspotTelefon(roh: unknown): string | null {
  let t = text(roh)?.replace(/^'+/, '').trim() ?? '';
  if (!t) return null;
  const ziffern = t.replace(/\D/g, '');
  if (ziffern.length < 6) return null;
  if (/0{7}$/.test(ziffern)) return null;
  if (/^49\d{8,}$/.test(t)) t = `+${t}`;
  t = telefonNormalisieren(t);
  return telefonPruefen(t) ? null : t;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const hubspotEmail = (roh: unknown): string | null => {
  const t = text(roh)?.toLowerCase() ?? null;
  return t && EMAIL.test(t) ? t : null;
};

/** Excel-Seriendatum (45678.43) oder ISO-Text → YYYY-MM-DD. */
export function excelDatum(wert: unknown): string | null {
  if (typeof wert === 'number' && Number.isFinite(wert) && wert > 20000 && wert < 80000) {
    const ms = Math.round((wert - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const t = text(wert);
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (de) return `${de[3]}-${de[2]!.padStart(2, '0')}-${de[1]!.padStart(2, '0')}`;
  return null;
}

/** Eine Zeile des Exports als Kontakt; null ohne Datensatz-ID. */
export function hubspotKontaktLesen(zeile: unknown[], s: Record<HubspotSpalte, number>): HubspotKontakt | null {
  const z = (k: HubspotSpalte): unknown => (s[k] >= 0 ? zeile[s[k]] : null);
  const id = text(z('id'));
  if (!id) return null;
  const vorname = text(z('vorname')) ?? '';
  const nachname = text(z('nachname')) ?? '';
  const duSieRoh = (text(z('duSie')) ?? '').toLowerCase();
  const liste = (v: unknown) => (text(v) ?? '').split(/[;,]\s*/).map((e) => e.trim()).filter(Boolean);
  const zusatzEmails = liste(z('zusatzEmails')).map((e) => hubspotEmail(e)).filter((e): e is string => !!e);
  return {
    id, vorname, nachname, name: [vorname, nachname].filter(Boolean).join(' '),
    anrede: text(z('anrede')), duSie: duSieRoh.includes('du') ? 'Du' : duSieRoh.includes('sie') ? 'Sie' : null,
    email: hubspotEmail(z('email')), zusatzEmails, emailDomain: text(z('emailDomain'))?.toLowerCase() ?? null,
    tel: hubspotTelefon(z('tel')), mobil: hubspotTelefon(z('mobil')), fax: hubspotTelefon(z('fax')),
    firma: text(z('firma')), firmenAnschrift: text(z('firmenAnschrift')), webseite: text(z('webseite')) ?? text(z('webseiteUrl')),
    strasse: text(z('strasse')), plz: text(z('plz')), ort: text(z('ort')),
    klassifizierung: text(z('klassifizierung')), mailingStatus: text(z('mailingStatus')), stellung: text(z('stellung')), beruf: text(z('beruf')), jobbezeichnung: text(z('jobbezeichnung')),
    warnhinweis: text(z('warnhinweis')), abgemeldet: /^(true|ja|1)$/i.test(text(z('abgemeldet')) ?? ''), zustaendig: text(z('zustaendig')),
    erstelltAm: excelDatum(z('erstelltAm')), letzterKontakt: excelDatum(z('letzterKontakt')), zusammengefuehrteIds: liste(z('zusammengefuehrt')),
  };
}

/** Prio aus der Klassifizierung: VIP und High Potential → A, B → B, alles andere (C, Test, Exit, leer) → C. */
export function hubspotPrio(klassifizierung: string | null | undefined): 'A' | 'B' | 'C' {
  const k = (klassifizierung ?? '').trim().toLowerCase();
  if (k === 'vip' || k === 'high potential') return 'A';
  if (k === 'b') return 'B';
  return 'C';
}

/** Frequenz: Exit → Nie (nicht mehr anrufen), sonst der Anlage-Standard Monatlich. */
export function hubspotFrequenz(klassifizierung: string | null | undefined): Frequenz {
  return (klassifizierung ?? '').trim().toLowerCase() === 'exit' ? 'Nie' : 'Monatlich';
}

/** Was aus HubSpot nach `persoenlich` geht: Anrede, Du/Sie, Jobbezeichnung, Mailing-Status und die Herkunft mit HubSpot-ID. */
export function hubspotPersoenlich(k: HubspotKontakt, importiertAm: string): MaklerPersonal {
  const p: MaklerPersonal = {
    herkunft: {
      quelle: 'hubspot', id: k.id, importiertAm,
      ...(k.klassifizierung ? { klassifizierung: k.klassifizierung } : {}),
      ...(k.zustaendig ? { zustaendig: k.zustaendig } : {}),
      ...(k.stellung ? { stellung: k.stellung } : {}),
      ...(k.warnhinweis ? { warnhinweis: k.warnhinweis } : {}),
      ...(k.erstelltAm ? { erstelltAm: k.erstelltAm } : {}),
    },
  };
  if (k.anrede) p.anrede = k.anrede;
  if (k.duSie) p.duSie = k.duSie;
  const job = k.jobbezeichnung ?? k.beruf;
  if (job) p.jobbezeichnung = job;
  if (k.mailingStatus) p.mailingStatus = k.mailingStatus;
  if (k.abgemeldet) p.mailingStatus = p.mailingStatus ? `${p.mailingStatus} · von allen E-Mails abgemeldet` : 'Von allen E-Mails abgemeldet';
  return p;
}

export interface BestandsMakler {
  id: string;
  name: string | null;
  email: string | null;
  tel: string | null;
  mobil: string | null;
  festnetz: string | null;
  weitereKontakte?: { emails?: unknown; telefonnummern?: unknown } | null;
  persoenlich?: unknown;
}

export type HubspotTreffer = { id: string; ueber: 'hubspot-id' | 'email' | 'telefon' | 'name' };

/** Telefon in Vergleichsform (wie `telefonSchluessel` der weiteren Kontakte); zu kurze Nummern zählen nicht. */
const telSchluessel = (t: string | null | undefined): string => {
  const z = telefonSchluessel(t ?? '');
  return z.length >= 6 ? z : '';
};

const listeAus = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Abgleich mit dem Bestand in dieser Reihenfolge: HubSpot-ID (schon einmal übernommen) → E-Mail (auch Zusatzadressen und
 * weitere Kontakte) → Telefon (Haupt-, Mobil-, Festnetznummer) → gleicher Name (ohne akademische Titel, Groß/Klein egal).
 * Der Treffer sagt, worüber — der Bericht zeigt Namenstreffer gesondert, damit man sie ansehen kann.
 */
export function hubspotAbgleich(k: HubspotKontakt, bestand: readonly BestandsMakler[]): HubspotTreffer | null {
  for (const m of bestand) {
    const herkunft = (m.persoenlich as MaklerPersonal | null | undefined)?.herkunft;
    if (herkunft?.quelle === 'hubspot' && (herkunft.id === k.id || k.zusammengefuehrteIds.includes(herkunft.id))) return { id: m.id, ueber: 'hubspot-id' };
  }
  const emails = new Set([k.email, ...k.zusatzEmails].filter((e): e is string => !!e));
  if (emails.size) {
    for (const m of bestand) {
      const eigene = [m.email, ...listeAus(m.weitereKontakte?.emails)].map((e) => (e ?? '').toLowerCase()).filter(Boolean);
      if (eigene.some((e) => emails.has(e))) return { id: m.id, ueber: 'email' };
    }
  }
  const nummern = new Set([k.tel, k.mobil].map(telSchluessel).filter(Boolean));
  if (nummern.size) {
    for (const m of bestand) {
      const eigene = [m.tel, m.mobil, m.festnetz, ...listeAus(m.weitereKontakte?.telefonnummern)].map(telSchluessel).filter(Boolean);
      if (eigene.some((n) => nummern.has(n))) return { id: m.id, ueber: 'telefon' };
    }
  }
  if (k.vorname && k.nachname) {
    const ohneTitel = (n: string) => n.replace(/\b(prof|dr|dipl|ing|mag|med|jur|rer|nat|h\.?\s?c|phil|habil)\.?(-\w+\.?)?\s*/gi, '').replace(/\s+/g, ' ').trim();
    // Gleicher Name (ohne Titel, Groß/Klein egal) — bewusst nicht die unscharfe Dubletten-Ähnlichkeit: bei 771 Kontakten wären
    // „Anna Müller“ und „Anne Müller“ sonst dieselbe Person. Namenstreffer stehen im Bericht zum Ansehen.
    const name = ohneTitel(k.name).toLowerCase();
    for (const m of bestand) if (m.name && ohneTitel(m.name).toLowerCase() === name) return { id: m.id, ueber: 'name' };
  }
  return null;
}

export type MaklerFeld = 'tel' | 'mobil' | 'email' | 'strasse' | 'plz' | 'ort';

/**
 * Bekannter Makler: nur leere Felder ergänzen. Haupttelefon aus Telefonnummer, sonst Handynummer; Mobil nur, wenn die Handynummer
 * nicht schon das Haupttelefon ist. `persoenlich` bekommt die HubSpot-Schlüssel, die noch fehlen (Herkunft immer, wenn keine da ist).
 */
export function hubspotErgaenzung(k: HubspotKontakt, m: BestandsMakler & { strasse?: string | null; plz?: string | null; ort?: string | null }, importiertAm: string): { felder: Partial<Record<MaklerFeld, string>>; persoenlich: MaklerPersonal | null } {
  const felder: Partial<Record<MaklerFeld, string>> = {};
  const leer = (v: string | null | undefined) => !v || !v.trim();
  const haupt = k.tel ?? k.mobil;
  if (leer(m.tel) && haupt) felder.tel = haupt;
  if (leer(m.mobil) && k.mobil && telSchluessel(k.mobil) !== telSchluessel(felder.tel ?? m.tel)) felder.mobil = k.mobil;
  if (leer(m.email) && k.email) felder.email = k.email;
  if (leer(m.strasse) && k.strasse) felder.strasse = k.strasse;
  if (leer(m.plz) && k.plz) felder.plz = k.plz;
  if (leer(m.ort) && k.ort) felder.ort = k.ort;
  const alt = (m.persoenlich && typeof m.persoenlich === 'object' ? m.persoenlich : {}) as MaklerPersonal;
  const neu = hubspotPersoenlich(k, importiertAm);
  const zusammen: MaklerPersonal = { ...alt };
  let geaendert = false;
  for (const key of ['anrede', 'duSie', 'jobbezeichnung', 'mailingStatus', 'herkunft'] as const) {
    if (alt[key] === undefined && neu[key] !== undefined) { (zusammen as Record<string, unknown>)[key] = neu[key]; geaendert = true; }
  }
  return { felder, persoenlich: geaendert ? zusammen : null };
}
