// Anweisung und Werkzeug für die Erfassung v2 (Protokoll 28) in zwei Teilen, EIN Aufruf:
// - Teil A: der bisherige Prompt (prompt.ts) und das bisherige Werkzeug-Schema WORTGLEICH — die gg-Felder kommen
//   mindestens so wie früher (Auftraggeber 11.10.2026: „mindestens wie früher alles“). Hier darf die KI wie bisher deuten.
// - Teil B: Vollerfassung aller Angaben wörtlich mit Seite, Standard-Pfad und gg-Vorschlag; Mietlisten als Tabellen.
//   Teil B füllt im Code nur Lücken von Teil A (@gg/domain: zuordnen) und landet sonst unter „Weitere Angaben“.
//
// Katalog und Zielliste stehen fest im Text; der System-Prompt wird zwischengespeichert und darf keine variablen Teile haben.
import { EXPOSE_V2_TOOL_NAME, exposeV2ToolSchema, katalogFuerPrompt, zieleFuerPrompt } from '@gg/domain';
import { EXTRACT_TOOL, SYSTEM_PROMPT } from './prompt.ts';

/** Fassung der Anweisung; wird je Import festgehalten, damit Ergebnisse vergleichbar bleiben. */
export const PROMPT_VERSION_V2 = 'v2.1';

const TEIL_B = `Du erfasst deutsche Immobilien-Exposés zusätzlich VOLLSTÄNDIG und WÖRTLICH.

═══ AUFGABE: VOLLERFASSUNG ═══
- Gehe das Dokument Seite für Seite durch und nimm JEDE Angabe als Eintrag in "angaben" auf, in Dokumentreihenfolge.
- Eine Angabe ist: jedes Paar aus Beschriftung und Wert, jeder Aufzählungspunkt, jede Tabellenzeile (außer Mietlisten, siehe unten), jeder Freitext-Abschnitt, jede Kontaktangabe, das Impressum.
- Nicht nur „wichtige“ Daten: auch Besichtigung, Verkaufsablauf, Rechte und Lasten, Teilungserklärung, Hausverwaltung, Mietsicherheiten, Objektnummer, Stand, Hinweise, Haftungsausschluss.
- Lieber zu viel als zu wenig. Eine Angabe, die zweimal im Dokument steht, wird zweimal erfasst (mit ihrer jeweiligen Seite).

═══ WÖRTLICH ═══
- "bezeichnung" und "wert" EXAKT wie im Dokument: mit Einheit, „ca.“, „inkl. MwSt.“, „zzgl.“, Fußnotenzeichen, Schreibweise der Zahlen.
- NICHTS umrechnen (kein Jahr → Monat, kein m² → Zahl), nichts addieren, nichts zusammenfassen, nichts umformulieren, nichts ergänzen, nichts übersetzen.
- KEINE Rendite, keinen Faktor, keinen Quadratmeterpreis berechnen. Steht er im Dokument, wird er wörtlich erfasst — sonst gar nicht.
- Freitexte (Lage, Objektbeschreibung, Ausstattung, Sonstiges, Hinweise) VOLLSTÄNDIG und UNGEKÜRZT übernehmen, je Abschnitt ein Eintrag; "bezeichnung" ist die Abschnittsüberschrift.
- Angabe ohne Beschriftung: "bezeichnung" = kurze Überschrift des Abschnitts, in dem sie steht.
- Nichts raten. Was nicht im Dokument steht, wird nicht erfasst.

═══ SEITE ═══
- "seite": Beim Text gliedert der Marker "──────── Seite N" die Seiten; N ist die Seitennummer. Beim PDF ist es die PDF-Seite.

═══ PFAD (Standard OpenImmo + gg-Erweiterung) ═══
- "pfad": der passende Pfad aus der Liste unten, sonst null. Der Pfad sagt nur, WAS die Angabe ist; der Wert bleibt wörtlich.
- Periodische Beträge: "_monat" oder "_jahr" je nachdem, was das Dokument angibt (z. B. „Jahresnettokaltmiete“ → preise.mieteinnahmen_ist_jahr). Nicht umrechnen.
- Adresse in einer Zeile („Musterweg 12, 89073 Ulm“) → geo.strasse mit dem ganzen Wortlaut. Stehen Straße, PLZ und Ort getrennt, je ein Eintrag.
- Sanierungen/Modernisierungen einzeln, je Maßnahme ein Eintrag mit gg.sanierung.
- Ausstattungsmerkmale einzeln, je Merkmal ein Eintrag (ausstattung.* oder ausstattung.merkmal).
- Passt kein Pfad: null — die Angabe wird trotzdem erfasst.

═══ KONTAKT ═══
- "kontakt": nur bei Kontaktangaben die Nummer der Person/Firma: 1 = Hauptansprechpartner des Anbieters/Maklers, 2, 3 … weitere Personen oder Firmen.
- Kontaktfelder ohne eigene Person (Firmenzentrale, allgemeine E-Mail, Webseite, Büroadresse) bekommen die Nummer der Person/Firma, zu der sie gehören.
- Telefon: Mobilnummer (01…, +49 1…) → kontaktperson.tel_handy; Festnetz → tel_durchw oder tel_zentrale.
- Bei allen anderen Angaben: null.

═══ GG-VORSCHLAG ═══
- "gg": Vorschlag aus der gg-Zielliste unten, in welches gg-Feld der Wert gehört; sonst null.
- Nur ein Vorschlag — der Code entscheidet. Auch Angaben ohne Pfad dürfen einen Vorschlag haben (z. B. „Rücklage“ → details.instandhaltungsruecklage).

═══ MIETLISTEN → einheiten_tabellen ═══
- Mietlisten, Mieterlisten, Wohnungslisten, Flächenaufstellungen gehören NICHT in "angaben", sondern in "einheiten_tabellen".
- "spalten": die Spaltenüberschriften einmal WÖRTLICH, je Spalte "feld" = nr, typ, lage, zimmer, flaeche, kaltmiete, nebenkosten, warmmiete, sollmiete, status, mietbeginn, mietende — oder null, wenn keine Bedeutung passt.
- "zeilen": JEDE Zeile der Liste, Zellen WÖRTLICH in Spaltenreihenfolge, leere Zelle = "". ALLE Zeilen: auch Stellplätze, Garagen, Leerstand, Gewerbe. Nichts auslassen, nichts zusammenfassen.
- Die Spalte mit Mieternamen WEGLASSEN (Datenschutz) — weder als Spalte noch als Zelle.
- Summenzeilen („Summe“, „Gesamt“) nicht als Zeile, sondern als Angabe in "angaben" (z. B. preise.mieteinnahmen_ist_monat bzw. _jahr, wie im Dokument).
- Einheiten nur im Fließtext („Im EG befindet sich eine 85 m² Wohnung mit 3 Zimmern, vermietet für 720 € netto kalt“) → als Tabelle mit sinnvollen Spaltenüberschriften (z. B. Lage, Zimmer, Fläche, Kaltmiete), Zellen wörtlich („EG“, „3“, „85 m²“, „720 €“).
- Steht eine Einheit sowohl in der Liste als auch im Fließtext: nur die Liste.
- Häufige Fundstellen: Mietaufstellung, Mieterliste, Wohnungsliste, Grundriss-Beschreibung mit Tabelle je Etage, Baubeschreibung/Wohnflächenberechnung im Anhang, Mietnachweise.

SPALTENZUORDNUNG — Erkennungshilfen (nur für "feld", die Zellen bleiben wörtlich):
- flaeche: „m²“, „qm“, „Fläche“, „Wohnfläche“, „Wfl.“, „WF“, „Nutzfläche“
- kaltmiete: NUR die Netto-Kaltmiete ohne Nebenkosten — „Kaltmiete“, „NKM“, „Nettokaltmiete“, „Kalt“, „KM“, „Netto“, „Miete kalt“, „Mietpreis kalt“. „Mietzins“ oder nur „Miete“: kaltmiete, wenn daneben eine eigene Nebenkosten-Spalte steht.
- warmmiete: „Warmmiete“, „Bruttomiete“, „BKM“, „Inklusivmiete“, „Gesamtmiete inkl. NK“ — NIE als kaltmiete.
- nebenkosten: „NK“, „Nebenkosten“, „BK“, „Betriebskosten“, „NK-Vorauszahlung“, „Heizkosten“
- sollmiete: „Soll-Miete“, „erzielbare Miete“, „Marktmiete“, „marktübliche Miete“
- zimmer: „Zi.“, „Zimmer“, „ZKB“, „Räume“
- lage: „Lage“, „Etage“, „Geschoss“, „EG/OG/DG“; nr: „Nr.“, „Whg.-Nr.“, „WE“, „Einheit“; typ: „Art“, „Nutzung“, „Typ“
- status: „Status“, „vermietet/leer“, „Leerstand“; mietbeginn: „Mietbeginn“, „seit“, „Mietvertrag vom“; mietende: „befristet bis“, „Mietende“

═══ ANZAHL UND VOLLSTÄNDIGKEIT ═══
- "einheiten_im_dokument": die Zahl der Einheiten, die das Dokument nennt (Wohnungen + Gewerbe + Stellplätze); nennt es keine Zahl, die Zahl der Zeilen der Liste(n); ohne Liste und ohne Zahl null.
- "einheiten_vollstaendig": true nur, wenn ALLE Einheiten des Dokuments als Zeilen in "einheiten_tabellen" stehen.

═══ NIEMALS ═══
- NIE einen Wert umrechnen, kürzen, runden, zusammenfassen oder berechnen.
- NIE Warmmiete als Kaltmiete zuordnen.
- NIE Mieternamen erfassen.
- NIE Werte erfinden, die nicht im Dokument stehen.

═══ PFADE (pfad — Bedeutung) ═══
${katalogFuerPrompt()}

═══ GG-ZIELE (gg — Bedeutung) ═══
${zieleFuerPrompt()}`;

export const SYSTEM_PROMPT_V2 = `═══════════ TEIL A: DIE FELDER objekt, makler, kalkulation, _konfidenz ═══════════
Fülle diese Felder GENAU so, wie es die folgende Anweisung verlangt (sie gilt unverändert seit Monaten):

${SYSTEM_PROMPT}

═══════════ TEIL B: ZUSÄTZLICH DIE FELDER angaben, einheiten_tabellen, einheiten_im_dokument, einheiten_vollstaendig ═══════════
Teil A bleibt davon unberührt: fülle Teil A vollständig wie oben. Die folgenden Regeln (WÖRTLICH, nichts umrechnen) gelten NUR für Teil B.

${TEIL_B}`;

/** Teil A (bisheriges Schema, wortgleich) + Teil B (Vollerfassung aus @gg/domain) in einem Werkzeug. */
function werkzeugSchema(): Record<string, unknown> {
  const a = EXTRACT_TOOL.input_schema as { properties: Record<string, unknown>; required?: string[] };
  const b = exposeV2ToolSchema() as { properties: Record<string, unknown>; required?: string[] };
  return { type: 'object', properties: { ...a.properties, ...b.properties }, required: [...(a.required ?? []), ...(b.required ?? [])] };
}

/** Werkzeug der Erfassung v2 (Teil A + Teil B). */
export const EXTRACT_TOOL_V2 = {
  name: EXPOSE_V2_TOOL_NAME,
  description: 'Extrahiert die Daten eines deutschen Immobilien-Exposés wie bisher (objekt, makler, kalkulation) und erfasst zusätzlich alle Angaben wörtlich (mit Seite, Standard-Pfad und gg-Vorschlag) sowie die Mietlisten als Tabellen.',
  input_schema: werkzeugSchema(),
};

/** Dasselbe Werkzeug nur mit den Einheiten-Tabellen — für den Nachfass. */
export const EINHEITEN_TOOL_V2 = {
  name: EXPOSE_V2_TOOL_NAME,
  description: 'Erfasst NUR die Mietliste(n)/Einheitenliste(n) eines deutschen Immobilien-Exposés wörtlich als Tabellen, alle Zeilen.',
  input_schema: exposeV2ToolSchema(true),
};

/** Zusatz zur user-Nachricht, wenn die erste Antwort an max_tokens abgeschnitten wurde. */
export const HINWEIS_WIEDERHOLUNG_V2 = 'WICHTIG: Die vorige Antwort war zu lang und wurde abgeschnitten. Erfasse alle Angaben und Freitexte trotzdem vollständig, aber lass die Mietliste(n) weg: "einheiten_tabellen" = [] und "einheiten_vollstaendig" = false. Die Mietliste wird danach gesondert erfasst.';

/** user-Nachricht des Nachfasses. */
export const HINWEIS_NACHFASS_V2 = 'Erfasse NUR die Mietliste(n) vollständig, alle Zeilen — wörtlich, in Dokumentreihenfolge, auch Stellplätze und Leerstand, ohne Mieternamen.';
