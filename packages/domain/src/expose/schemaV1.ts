/**
 * gg-Exposé-Schema v1 — was die KI aus einem Exposé holt (Protokoll 26/27, Fachentscheidung 10.10.2026).
 *
 * Gruppen und Feldnamen lehnen sich an OpenImmo 1.2.7 an (geo, preise, flaechen, ausstattung, zustand, energiepass,
 * verwaltung, freitexte, kontaktperson); dazu die Einheitenliste, ein Auffangbereich `weitere_angaben` für alles ohne
 * Schemafeld und `belege` (Seite + kurzes Zitat) für die Kernzahlen. Alle Felder dürfen null sein — nichts ist Pflicht.
 *
 * Aus diesem zod-Schema entstehen das Tool-Schema für den KI-Aufruf (`exposeV1ToolSchema`) und der Typ. Die `describe`-Texte
 * sind die Anweisung ans Modell je Feld; Änderungen daran ändern die Ergebnisse (Prüfsatz laufen lassen).
 */
import { z } from 'zod';

const N = (beschreibung: string) => z.number().nullable().describe(beschreibung);
const S = (beschreibung: string) => z.string().max(300).nullable().describe(beschreibung);
const T600 = (beschreibung: string) => z.string().max(600).nullable().describe(`${beschreibung} Höchstens 600 Zeichen, gekürzt, keine Ausschmückung.`);
const B = (beschreibung: string) => z.boolean().nullable().describe(beschreibung);

export const KONFIDENZ = ['hoch', 'mittel', 'niedrig'] as const;
export type Konfidenz = (typeof KONFIDENZ)[number];

export const Beleg = z.object({
  seite: z.number().int().nullable().describe('Seitennummer laut Seitenmarker „──────── Seite N“ (Textweg) oder PDF-Seite, auf der der Wert steht'),
  zitat: z.string().max(120).nullable().describe('Wörtliches Zitat (höchstens 80 Zeichen) aus dem Dokument, das den Wert enthält, z. B. „Kaufpreis: 1.250.000 €“'),
  konfidenz: z.enum(KONFIDENZ).describe('hoch = steht explizit im Dokument; mittel = abgeleitet; niedrig = nicht gefunden (Wert dann null)'),
}).describe('Fundstelle eines Kernwerts');
export type Beleg = z.infer<typeof Beleg>;

export const EINHEIT_TYP = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'] as const;
export const ANGABE_GRUPPEN = ['lage', 'preise', 'flaechen', 'ausstattung', 'zustand', 'energie', 'verwaltung', 'recht', 'vertrieb', 'sonstiges'] as const;
export type AngabeGruppe = (typeof ANGABE_GRUPPEN)[number];

export const ExposeV1Einheit = z.object({
  typ: z.enum(EINHEIT_TYP).describe('"Wohnung" für Wohneinheiten, "Stellplatz" für TG/Carport/Außenstellplatz, "Gewerbe" für Laden/Büro/Praxis'),
  lage: S('Etage oder Lage exakt wie im Dokument: "EG", "1. OG links", "DG", "Whg. 3", "TG-01"'),
  zimmer: N('Zimmeranzahl: "2-Zimmer" = 2, "2,5 Zi." = 2.5, "1 ZKB" = 1, Zahlworte erkennen; bei Stellplätzen null'),
  flaeche: N('Wohn-/Nutzfläche in m² (85,5 → 85.5). Spalten "m²", "qm", "Fläche", "Wfl.", "WF". Ohne explizite Zahl: null — NICHT schätzen'),
  kaltmiete: N('Monatliche NETTO-Kaltmiete in Euro (Spalten "NKM", "Kalt", "Netto"). Nur Warmmiete/Brutto/Inklusivmiete genannt → null. Leerstand → 0'),
  nebenkosten: N('Monatliche Nebenkosten/Betriebskostenvorauszahlung in Euro, falls genannt'),
  sollmiete: N('Soll-/Zielmiete oder erzielbare Miete in Euro je Monat, falls genannt (bei Leerstand die "erzielbare Miete")'),
  vermiet: z.enum(['Vermietet', 'Leerstand']).nullable().describe('"Vermietet" wenn vermietet/Mieter genannt/Mietbeginn vor heute; "Leerstand" bei leer/frei/Mietzins 0'),
  mietbeginn: S('Mietbeginn wie im Dokument (z. B. "01.03.2019" oder "2019"); keine Mieternamen übernehmen'),
  _seite: N('Seitennummer, auf der diese Einheit steht'),
}).describe('Eine Zeile der Mietaufstellung/Wohnungsliste');
export type ExposeV1Einheit = z.infer<typeof ExposeV1Einheit>;

export const ExposeV1WeitereAngabe = z.object({
  gruppe: z.enum(ANGABE_GRUPPEN).describe('Zuordnung: lage, preise, flaechen, ausstattung, zustand, energie, verwaltung, recht, vertrieb, sonstiges'),
  bezeichnung: z.string().max(80).describe('Bezeichnung wie im Dokument, z. B. "Instandhaltungsrücklage", "Keller", "Besichtigung"'),
  wert: z.string().max(200).describe('Wert als Text, höchstens 200 Zeichen'),
  einheit: S('Einheit, falls vorhanden: "€", "€/Monat", "m²", "%", "Stück"'),
  seite: N('Seitennummer'),
}).describe('Angabe, für die es KEIN Feld im Schema gibt');
export type ExposeV1WeitereAngabe = z.infer<typeof ExposeV1WeitereAngabe>;

export const ExposeV1Kontakt = z.object({
  name: S('Vollständiger Name'), rolle: S('Rolle/Position, z. B. "Geschäftsführer", "Sachbearbeitung"'),
  tel: S('Festnetz'), mobil: S('Mobil (beginnt mit 01… / +49 1…)'), email: S('E-Mail'),
});

export const ExposeV1 = z.object({
  schema: z.literal('gg-expose-v1'),
  dokument: z.object({
    objektnr_extern: S('Objekt-/Angebotsnummer des Maklers (z. B. "Objekt-Nr. 1072081")'),
    datum: S('Datum des Exposés, falls genannt'),
    titel: S('Titel/Überschrift des Exposés'),
  }),
  objektkategorie: z.object({
    nutzungsart: z.enum(['WOHNEN', 'GEWERBE', 'GEMISCHT']).nullable().describe('WOHNEN = nur Wohnen; GEMISCHT = Wohnen + Gewerbe; GEWERBE = nur Gewerbe'),
    objektart: S('Objektart wie im Dokument: "Mehrfamilienhaus", "Wohn- und Geschäftshaus", "Paket", "Eigentumswohnung" …'),
  }),
  geo: z.object({
    strasse: S('Straßenname ohne Hausnummer'), hausnummer: S('Hausnummer inkl. Zusatz, bei mehreren "2 & 4"'),
    plz: S('5-stellige Postleitzahl'), ort: S('Stadt oder Gemeinde (ohne Stadtteil)'), bundesland: S('Bundesland'),
    etage_anzahl: N('Anzahl der Geschosse/Etagen des Gebäudes, falls genannt'),
  }),
  preise: z.object({
    kaufpreis: N('Angeforderter Kaufpreis in Euro (Gesamtbetrag)'),
    provision_text: S('Provisionsangabe wörtlich, z. B. "3,57 % inkl. MwSt. vom Kaufpreis" oder "provisionsfrei"'),
    provision_prozent: N('Käuferprovision in Prozent, falls als Zahl genannt'),
    nebenkosten_monat: N('Nebenkosten/Betriebskosten gesamt je Monat in Euro, falls genannt'),
    hausgeld_monat: N('Hausgeld je Monat in Euro (bei WEG), falls genannt'),
    mieteinnahmen_ist_monat: N('Aktuelle Netto-Kaltmieteinnahmen GESAMT je Monat in Euro (alle Einheiten). NICHT Jahresmiete, NICHT Warmmiete. Jahresangabe "Jahresnettokaltmiete 60.000 €" → 5000'),
    mieteinnahmen_soll_monat: N('Soll-/Zielmieteinnahmen GESAMT je Monat in Euro, falls genannt'),
    x_fache_angegeben: N('Im Dokument genannter Kaufpreisfaktor ("das 18,5-fache"); NICHT selbst rechnen'),
    bruttorendite_angegeben: N('Im Dokument genannte Bruttorendite in Prozent; NICHT selbst rechnen'),
  }),
  flaechen: z.object({
    wohnflaeche: N('Gesamte Wohnfläche in m²'), nutzflaeche: N('Nutzfläche in m² (ohne Wohnfläche), falls genannt'),
    gewerbeflaeche: N('Gewerbefläche in m², falls genannt'), grundstuecksflaeche: N('Grundstücksfläche in m²'),
    anzahl_stellplaetze: N('Anzahl Stellplätze/Garagen gesamt, falls genannt'),
  }),
  ausstattung: z.object({
    heizungsart: S('Art der Heizung: "Gas-Zentralheizung", "Fernwärme", "Wärmepumpe", "Etagenheizung" …'),
    energietraeger: S('Energieträger/Befeuerung: Gas, Öl, Fernwärme, Strom, Pellets …'),
    merkmale: z.array(z.string().max(80)).max(30).describe('Ausstattungsmerkmale als kurze Stichworte: "Balkon", "Aufzug", "Keller", "Fenster 2015", "Bad gefliest" …'),
  }),
  zustand: z.object({
    baujahr: N('Baujahr des Gebäudes (bei "ca. 1900" → 1900)'),
    heizung_baujahr: N('Baujahr der Heizungsanlage, falls genannt'),
    sanierungen: z.array(z.object({ jahr: N('Jahr der Maßnahme'), was: z.string().max(120).describe('Maßnahme, z. B. "Dach neu gedeckt"') })).max(20).describe('Genannte Sanierungen/Modernisierungen mit Jahr'),
    zustand_text: T600('Zustandsbeschreibung des Gebäudes.'),
    denkmalschutz: B('true wenn Denkmalschutz genannt, false wenn ausdrücklich keiner, sonst null'),
    erbpacht: B('true bei Erbbaurecht/Erbpacht, false wenn ausdrücklich keine, sonst null'),
  }),
  energiepass: z.object({
    art: S('"Bedarfsausweis" oder "Verbrauchsausweis"'), klasse: S('Energieeffizienzklasse A+ bis H'),
    kennwert: N('Energiekennwert in kWh/(m²·a)'), gueltig_bis: S('Gültig bis, falls genannt'),
  }),
  verwaltung: z.object({
    anzahl_wohneinheiten: N('Anzahl Wohneinheiten laut Dokument'), anzahl_gewerbeeinheiten: N('Anzahl Gewerbeeinheiten laut Dokument'),
    verfuegbar_ab: S('Verfügbar ab / Übergabe, falls genannt'),
    einheiten_anzahl_dokument: N('Wie viele Einheiten (Wohnung, Gewerbe, Stellplatz) nennt das Dokument insgesamt?'),
    einheiten_vollstaendig: B('true wenn ALLE Einheiten des Dokuments in "einheiten" stehen; false wenn gekürzt (höchstens 200 Zeilen)'),
  }),
  einheiten: z.array(ExposeV1Einheit).max(200).describe('Eine Zeile je Mieteinheit aus Mietaufstellung/Mieterliste/Wohnungsliste; bei MFH je Wohnung ein Eintrag, je Stellplatz ein Eintrag'),
  freitexte: z.object({
    lage: T600('Lagebeschreibung.'), ausstattung: T600('Ausstattungsbeschreibung.'),
    objektbeschreibung: T600('Objektbeschreibung.'), sonstiges: T600('Sonstige relevante Hinweise (z. B. Besichtigung, Verkaufsablauf).'),
  }),
  kontaktperson: z.object({
    anrede: S('Herr/Frau'), titel: S('Titel, z. B. Dr.'), vorname: S('Vorname'), name: S('Nachname'),
    position: S('Position/Rolle im Büro'), firma: S('Name des Maklerbüros'),
    strasse: S('Straße + Hausnummer des Büros'), plz: S('PLZ des Büros'), ort: S('Ort des Büros'),
    tel_zentrale: S('Zentrale/Büro-Festnetz'), tel_durchwahl: S('Durchwahl des Ansprechpartners'),
    mobil: S('Mobilnummer (01… / +49 1…)'), fax: S('Fax'), email: S('E-Mail des Ansprechpartners'), web: S('Webseite des Büros'),
  }),
  weitere_kontakte: z.array(ExposeV1Kontakt).max(20).describe('ALLE weiteren im Dokument genannten Personen mit ihren Nummern/Adressen (außer der Kontaktperson)'),
  weitere_angaben: z.array(ExposeV1WeitereAngabe).max(40).describe('NUR Angaben, für die es KEIN Feld im Schema gibt. Zuerst die Schemafelder füllen. Jede Angabe genau einmal. NIE hierher: Kaufpreis, Flächen, Baujahr, Mieten, Einheiten, Energie, Heizung, Kontaktdaten'),
  belege: z.object({
    kaufpreis: Beleg, istmiete: Beleg, wohnflaeche: Beleg, grundstueck: Beleg, baujahr: Beleg, anzahl_we: Beleg, energiekennwert: Beleg, adresse: Beleg,
  }).describe('Fundstellen der Kernwerte (Seite + wörtliches Zitat); bei nicht gefundenem Wert konfidenz "niedrig", seite und zitat null'),
});
export type ExposeV1 = z.infer<typeof ExposeV1>;

export const EXPOSE_V1_SCHEMA = 'gg-expose-v1' as const;
export const EXPOSE_V0_SCHEMA = 'gg-expose-v0' as const;
export const EXPOSE_V1_TOOL_NAME = 'extract_expose_v1';

/** Tool-`input_schema` für den KI-Aufruf — aus dem zod-Schema, damit Prompt und Typ nicht auseinanderlaufen. */
export function exposeV1ToolSchema(): Record<string, unknown> {
  return z.toJSONSchema(ExposeV1, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
}

const belegLeer = (): Beleg => ({ seite: null, zitat: null, konfidenz: 'niedrig' });

/** Ein leeres v1-Ergebnis (alles null/[]) — Grundlage für Attrappe, Tests und das Bereinigen unvollständiger Antworten. */
export function exposeV1Leer(): ExposeV1 {
  return {
    schema: EXPOSE_V1_SCHEMA,
    dokument: { objektnr_extern: null, datum: null, titel: null },
    objektkategorie: { nutzungsart: null, objektart: null },
    geo: { strasse: null, hausnummer: null, plz: null, ort: null, bundesland: null, etage_anzahl: null },
    preise: { kaufpreis: null, provision_text: null, provision_prozent: null, nebenkosten_monat: null, hausgeld_monat: null, mieteinnahmen_ist_monat: null, mieteinnahmen_soll_monat: null, x_fache_angegeben: null, bruttorendite_angegeben: null },
    flaechen: { wohnflaeche: null, nutzflaeche: null, gewerbeflaeche: null, grundstuecksflaeche: null, anzahl_stellplaetze: null },
    ausstattung: { heizungsart: null, energietraeger: null, merkmale: [] },
    zustand: { baujahr: null, heizung_baujahr: null, sanierungen: [], zustand_text: null, denkmalschutz: null, erbpacht: null },
    energiepass: { art: null, klasse: null, kennwert: null, gueltig_bis: null },
    verwaltung: { anzahl_wohneinheiten: null, anzahl_gewerbeeinheiten: null, verfuegbar_ab: null, einheiten_anzahl_dokument: null, einheiten_vollstaendig: null },
    einheiten: [],
    freitexte: { lage: null, ausstattung: null, objektbeschreibung: null, sonstiges: null },
    kontaktperson: { anrede: null, titel: null, vorname: null, name: null, position: null, firma: null, strasse: null, plz: null, ort: null, tel_zentrale: null, tel_durchwahl: null, mobil: null, fax: null, email: null, web: null },
    weitere_kontakte: [],
    weitere_angaben: [],
    belege: { kaufpreis: belegLeer(), istmiete: belegLeer(), wohnflaeche: belegLeer(), grundstueck: belegLeer(), baujahr: belegLeer(), anzahl_we: belegLeer(), energiekennwert: belegLeer(), adresse: belegLeer() },
  };
}

/**
 * Eine KI-Antwort in ein gültiges v1 überführen: fehlende Gruppen aus dem leeren Gerüst, unbekannte Schlüssel weg,
 * Typfehler → null (Zahl als Text „1.250.000“ wird gelesen). Gibt Warnungen zurück, statt die Analyse abzubrechen.
 */
export function exposeV1Bereinigen(roh: unknown): { v1: ExposeV1; warnungen: string[] } {
  const warnungen: string[] = [];
  const leer = exposeV1Leer();
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const zahl = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') { const m = v.replace(/\s|€|m²|%/g, '').match(/-?\d[\d.]*(,\d+)?/)?.[0]; if (m) { const n = Number(m.replace(/\./g, '').replace(',', '.')); if (Number.isFinite(n)) return n; } }
    return null;
  };
  const ersteEbene: Record<string, unknown> = { schema: EXPOSE_V1_SCHEMA };
  for (const [gruppe, vorlage] of Object.entries(leer)) {
    if (gruppe === 'schema') continue;
    const wert = r[gruppe];
    if (Array.isArray(vorlage)) { ersteEbene[gruppe] = Array.isArray(wert) ? wert : []; continue; }
    const quelle = (wert && typeof wert === 'object' ? wert : {}) as Record<string, unknown>;
    const ziel: Record<string, unknown> = {};
    for (const [feld, leerwert] of Object.entries(vorlage as Record<string, unknown>)) {
      const q = quelle[feld];
      if (q === undefined) { ziel[feld] = leerwert; continue; }
      if (gruppe === 'belege') { const b = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>; ziel[feld] = { seite: zahl(b.seite), zitat: typeof b.zitat === 'string' ? b.zitat.slice(0, 120) : null, konfidenz: KONFIDENZ.includes(b.konfidenz as Konfidenz) ? b.konfidenz : 'niedrig' }; continue; }
      if (Array.isArray(leerwert)) { ziel[feld] = Array.isArray(q) ? q : []; continue; }
      ziel[feld] = q;
    }
    ersteEbene[gruppe] = ziel;
  }
  // Erster Versuch: so wie geliefert. Zweiter Versuch: Zahlen aus Texten lesen, Texte kürzen, Ungültiges auf null.
  let ergebnis = ExposeV1.safeParse(ersteEbene);
  if (!ergebnis.success) {
    for (const i of ergebnis.error.issues) {
      const pfad = i.path.map(String);
      let o: any = ersteEbene;
      for (const p of pfad.slice(0, -1)) o = o?.[p];
      const k = pfad.at(-1);
      if (!o || k === undefined) continue;
      const v = o[k];
      if (i.code === 'invalid_type' && (i as { expected?: string }).expected === 'number') o[k] = zahl(v);
      else if (i.code === 'too_big' && typeof v === 'string') o[k] = v.slice(0, (i as { maximum?: number }).maximum ?? 300);
      else if (i.code === 'too_big' && Array.isArray(v)) o[k] = v.slice(0, (i as { maximum?: number }).maximum ?? 40);
      else if (i.code === 'invalid_type' && (i as { expected?: string }).expected === 'string') o[k] = v == null ? null : String(v).slice(0, 300);
      else if (i.code === 'invalid_value' || i.code === 'invalid_type') o[k] = null;
      else if (i.code === 'unrecognized_keys') for (const key of (i as { keys?: string[] }).keys ?? []) delete o[key];
      warnungen.push(`${pfad.join('.')}: ${i.message}`);
    }
    // Zeilen, die danach immer noch ungültig sind, fallen weg
    for (const liste of ['einheiten', 'weitere_angaben', 'weitere_kontakte'] as const) {
      const schemaZeile = liste === 'einheiten' ? ExposeV1Einheit : liste === 'weitere_angaben' ? ExposeV1WeitereAngabe : ExposeV1Kontakt;
      const vorher = (ersteEbene[liste] as unknown[]).length;
      ersteEbene[liste] = (ersteEbene[liste] as unknown[]).filter((z) => schemaZeile.safeParse(z).success);
      const weg = vorher - (ersteEbene[liste] as unknown[]).length;
      if (weg) warnungen.push(`${liste}: ${weg} ungültige Zeile(n) verworfen`);
    }
    ergebnis = ExposeV1.safeParse(ersteEbene);
  }
  if (!ergebnis.success) {
    warnungen.push(`Antwort nicht lesbar: ${ergebnis.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return { v1: leer, warnungen };
  }
  return { v1: ergebnis.data, warnungen };
}
