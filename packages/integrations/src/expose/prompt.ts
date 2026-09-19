// Übernommen aus gg-immohandel server/expose-prompt.ts (Stand 9d693b8). Inhaltlich unverändert; Anpassungen sind markiert.
// ──────────────────────────────────────────────────────────────
// Was aus einem Exposé geholt wird — Schema und Anweisung
// ──────────────────────────────────────────────────────────────
// Wortgleich aus src/modules/expose-wizard/expose-wizard.ts hierher gezogen,
// als die Analyse am 17.08. serverseitig wurde. Bewusst ohne jede inhaltliche
// Änderung: das Schema ist über Monate an echten Exposés gewachsen — die
// Erkennungsmuster für Kaltmiete und Wohnfläche stehen dort, weil eine
// Extraktion ohne sie danebenlag. Ein Umbau der Ablaufsteuerung ist kein Anlass,
// daran zu drehen; was hier geändert wird, ändert die Ergebnisse.
//
// Nicht zu verwechseln mit server/expose-extract.ts: das ist die abgemagerte
// Variante desselben Tools für Makler-E-Mails, ohne Feldbeschreibungen und mit
// einem Prompt auf Fließtext gemünzt. Sie bleibt, wo sie ist — der Auto-Import
// liest Mailtexte, keine PDFs.
// ──────────────────────────────────────────────────────────────

/** Tool-Schema der strukturierten Extraktion. */
export const EXTRACT_TOOL = {
  name: 'extract_expose_data',
  description: 'Extrahiert alle relevanten Daten aus einem deutschen Immobilien-Exposé als strukturiertes JSON.',
  input_schema: {
    type: 'object',
    properties: {
      objekt: {
        type: 'object',
        properties: {
          strasse:          { type: 'string',  description: 'Straßenname ohne Hausnummer' },
          hausnr:           { type: 'string',  description: 'Hausnummer inkl. Zusatz (z.B. 12a)' },
          plz:              { type: 'string',  description: '5-stellige Postleitzahl' },
          stadt:            { type: 'string',  description: 'Stadt oder Gemeinde' },
          bundesland:       { type: 'string',  description: 'Bundesland' },
          baujahr:          { type: ['number','null'], description: 'Baujahr des Gebäudes' },
          wohnflaeche:      { type: ['number','null'], description: 'Gesamte Wohnfläche in m²' },
          grundstueck:      { type: ['number','null'], description: 'Grundstücksfläche in m²' },
          einheitenAnz:     { type: ['number','null'], description: 'Anzahl der Mieteinheiten gesamt' },
          angebotspreis:    { type: ['number','null'], description: 'Angeforderter Kaufpreis in Euro' },
          istmiete:         { type: ['number','null'], description: 'Aktuelle monatliche Netto-Kaltmieteinnahmen GESAMT (alle Einheiten zusammen) in Euro. NICHT verwechseln mit Warmmiete oder einzelner Wohnungsmiete!' },
          bruttorendite:    { type: ['number','null'], description: 'Bruttorendite in Prozent' },
          heizungsart:      { type: 'string',  description: 'Art der Heizung (z.B. Gas-Zentralheizung, Fernwärme, Wärmepumpe)' },
          heizungsbaujahr:  { type: ['number','null'], description: 'Baujahr der Heizungsanlage' },
          energieausweis: {
            type: 'object',
            properties: {
              klasse:   { type: 'string',  description: 'Energieeffizienzklasse (A+ bis H)' },
              kennwert: { type: ['number','null'], description: 'Energiekennwert in kWh/m²a' },
              art:      { type: 'string',  description: 'Bedarfsausweis oder Verbrauchsausweis' }
            }
          },
          lagebeschreibung: { type: 'string', description: 'Beschreibung der Lage aus dem Exposé' },
          ausstattung:      { type: 'string', description: 'Ausstattungsmerkmale als kommaseparierte Liste' },
          notizen:          { type: 'string', description: 'Sonstige relevante Informationen aus dem Exposé' },
          einheiten: {
            type: 'array',
            description: 'Eine Liste pro Mieteinheit. Wenn das Exposé eine Mietaufstellung/Mietliste/Wohnungsliste enthält, ist JEDE Zeile dort eine Einheit. Bei MFH/WEG: pro Wohnung ein Eintrag, plus pro Stellplatz ein Eintrag.',
            items: {
              type: 'object',
              properties: {
                typ:      { type: 'string', enum: ['Wohnung','Gewerbe','Stellplatz','Sonstiges'], description: '"Wohnung" für Wohneinheiten, "Stellplatz" für TG/Carport/Außenstellplatz, "Gewerbe" für Laden/Büro/Praxis.' },
                lage:     { type: 'string', description: 'Etage oder Lage. Häufige Schreibweisen im Exposé: "EG", "1. OG", "OG1", "OG", "1.OG links", "DG", "Dachgeschoss", "KG", "Souterrain", "ZG" (Zwischengeschoss), "Whg. Nr. 3", "Wohnung 5". Übernehme die exakte Bezeichnung wenn vorhanden.' },
                zimmer:   { type: ['number','null'], description: 'Zimmeranzahl. "2-Zimmer-Wohnung" = 2. "2,5 Zi." = 2.5. Bei "1 ZKB" = 1. Auch in Texten wie "drei Zimmer" suchen.' },
                flaeche:  { type: ['number','null'], description: 'Wohn-/Nutzfläche in m². ERKENNUNGSHINWEISE: "85 m²", "85,5 qm", "85.50 m2", "ca. 85 m²", "Wohnfläche: 85", "Wfl. 85", "WF 85,5". Steht oft in Tabellenspalten "m²", "qm", "Fläche", "Wohnfl.", "WF". Auch in Fließtext: "verfügt über ca. 85 m²". Bei Komma-Werten (85,5) immer als Dezimalzahl 85.5 angeben. Wenn keine explizite Zahl vorhanden ist, NULL setzen — NICHT raten oder schätzen.' },
                kaltmiete:{ type: ['number','null'], description: 'Monatliche NETTO-Kaltmiete in Euro (OHNE Nebenkosten/Warmmiete!). ERKENNUNGSHINWEISE: "Kaltmiete: 750 €", "Kalt: 750", "NKM 750", "Nettokaltmiete 750,00 €", "KM 750", "Miete kalt: 750", "750 €/Monat netto". WICHTIG: Wenn nur "Warmmiete" / "Bruttomiete" / "BKM" / "Inklusivmiete" angegeben ist, NICHT als Kaltmiete übernehmen → NULL setzen. Bei Tabellen mit Spalten "NKM" / "Netto" / "Kalt" → diese Werte nehmen. Bei "Mietpreis: 750" ohne weitere Angabe → wahrscheinlich Kaltmiete übernehmen. Bei Leerstand → 0 oder die "Soll-Miete"/"erzielbare Miete" wenn angegeben. NIEMALS raten — wenn unklar, NULL.' },
                vermiet:  { type: 'string', enum: ['Vermietet','Leerstand'], description: '"Vermietet" wenn Mieter genannt wird, Mietbeginn vor heute, "vermietet" steht. "Leerstand" wenn explizit "leer", "frei", "Leerstand", "Vorzeit. Übergabe möglich" oder Mietzins=0.' }
              }
            }
          }
        },
        // User-Wunsch 2026-05-30: keine Pflichtfelder — KI darf alles auslassen wenn nicht im PDF
      },
      makler: {
        type: 'object',
        properties: {
          name:       { type: 'string', description: 'Vollständiger Name des Maklers/Ansprechpartners (bevorzugt)' },
          alleNamen:  { type: 'array', items: { type: 'string' }, description: 'ALLE im Exposé gefundenen Personennamen (Ansprechpartner, Geschäftsführer, Sachbearbeiter etc.)' },
          firma:      { type: 'string', description: 'Name des Maklerbüros' },
          mobiltel:   { type: 'string', description: 'Mobiltelefon des Maklers (Nummern die mit 01.../+49 1... beginnen)' },
          festnetztel:{ type: 'string', description: 'Festnetztelefon des Maklers (Büronummer)' },
          tel:        { type: 'string', description: 'Telefonnummer falls Mobil/Festnetz nicht unterscheidbar' },
          alleTelefonnummern: { type: 'array', items: { type: 'string' }, description: 'ALLE im Exposé gefundenen Telefonnummern (Mobil, Festnetz, Fax, Zentrale)' },
          email:      { type: 'string', description: 'E-Mail-Adresse des Ansprechpartners (bevorzugt)' },
          alleEmails: { type: 'array', items: { type: 'string' }, description: 'ALLE im Exposé gefundenen E-Mail-Adressen' },
          webseite:   { type: 'string', description: 'Website des Maklerbüros' }
        }
      },
      kalkulation: {
        type: 'object',
        description: 'NUR Werte extrahieren die EXPLIZIT im Exposé stehen. Wenn ein Feld im Exposé nicht genannt wird → null zurückgeben (NICHT raten, NICHT hartcodierte Standardwerte einsetzen). Der User hat eigene Standardwerte in den Settings, die hier nur greifen wenn null.',
        properties: {
          kaufpreis: { type: ['number','null'], description: 'Kaufpreis = Angebotspreis' },
          notar:     { type: ['number','null'], description: 'Notarkosten in % — nur wenn im Exposé genannt, sonst null' },
          gest:      { type: ['number','null'], description: 'Grunderwerbsteuer in % — nur wenn im Exposé genannt, sonst null' },
          makler:    { type: ['number','null'], description: 'Maklerprovision in % — nur wenn im Exposé genannt, sonst null' },
          fk_p:      { type: ['number','null'], description: 'Fremdkapitalanteil in % — nur wenn im Exposé genannt, sonst null' },
          ek_p:      { type: ['number','null'], description: 'Eigenkapitalanteil in % — nur wenn im Exposé genannt, sonst null' },
          euribor:   { type: ['number','null'], description: 'Euribor in % — nur wenn im Exposé genannt, sonst null' },
          margeB:    { type: ['number','null'], description: 'Marge Bank in % — nur wenn im Exposé genannt, sonst null' },
          ek_r:      { type: ['number','null'], description: 'EK-Rendite in % — nur wenn im Exposé genannt, sonst null' },
          halt:      { type: ['number','null'], description: 'Geplante Haltedauer in Monaten — nur wenn im Exposé genannt, sonst null' },
          rp:        { type: ['number','null'], description: 'Risikopuffer in % — nur wenn im Exposé genannt, sonst null' },
          glo_m:     { type: ['number','null'], description: 'Globale Zielmarge in % — nur wenn im Exposé genannt, sonst null' }
        }
      },
      _konfidenz: {
        type: 'object',
        description: 'Konfidenz für jeden Hauptwert: "hoch" = klar im Dokument, "mittel" = abgeleitet, "niedrig" = nicht gefunden',
        additionalProperties: { type: 'string', enum: ['hoch','mittel','niedrig'] }
      }
    },
    required: ['objekt', 'makler', 'kalkulation', '_konfidenz']
  }
};

/**
 * Die Anweisung an das Modell.
 *
 * Sie spricht von „dem PDF", und das stimmt jetzt wörtlich: auf dem Bildweg
 * bekommt das Modell das PDF selbst, nicht mehr eine Reihe herunterskalierter
 * JPEGs. Auf dem Textweg bekommt es den ausgelesenen Text-Layer — dieselbe
 * Anweisung trägt beides, weil sie beschreibt, *was* zu finden ist, nicht *wo*.
 */
export const SYSTEM_PROMPT = `Du bist ein Experte für deutsche Immobilien-Exposés.
Analysiere das PDF SORGFÄLTIG und extrahiere ALLE relevanten Daten vollständig.

═══ EINHEITENLISTE — KRITISCH ═══
Für jede Wohnung/Gewerbeeinheit/Stellplatz MUSST du Wohnfläche und Kaltmiete extrahieren wenn diese irgendwo im Dokument stehen.
Häufige Fundstellen:
1. **Mietaufstellung** / **Mieterliste** / **Wohnungsliste** — meist eine Tabelle mit Spalten wie "Whg.Nr | Lage | Fläche | Mieter | Kaltmiete"
2. **Grundriss-Beschreibung** mit Tabelle pro Etage
3. **Fließtext-Beschreibung**: "Im EG befindet sich eine 85 m² Wohnung mit 2 Zimmern, vermietet für 720 € netto kalt"
4. **Baubeschreibung** / **Wohnflächenberechnung** im Anhang
5. **Mietnachweise** / **Mietbescheinigungen** als Anlage

DUAL-PASS-EXTRAKTION:
- Erst die Mietliste/Tabelle scannen (strukturierte Daten)
- DANN ZUSÄTZLICH den Fließtext durchsuchen — Werte aus Fließtext überschreiben Tabellenwerte NUR wenn die Tabelle fehlt
- Bei mehreren Quellen die plausibelste übernehmen (z.B. Mietaufstellung > Grundriss-Schätzung)

WOHNFLÄCHE — Erkennungsmuster:
- "85 m²" / "85 qm" / "85.5 m²" / "85,5 qm" / "ca. 85 m²"
- Tabellenspalten: "m²", "qm", "Fläche", "Wohnfläche", "Wfl.", "WF", "Wfl"
- "Wohn- und Nutzfläche: 85 m²"
- WICHTIG: Bei deutschem Komma (85,5) als 85.5 ausgeben

KALTMIETE — STRENGE Definition:
- NUR die Netto-Kaltmiete OHNE Nebenkosten
- Erkennungsmuster: "Kaltmiete", "NKM", "Nettokaltmiete", "Kalt", "KM", "Netto", "Miete kalt", "Mietpreis kalt"
- NICHT übernehmen: "Warmmiete", "Bruttomiete", "BKM", "Inkl.", "Inklusivmiete", "Gesamtmiete inkl. NK"
- Bei Tabellenspalten: Suche nach Spaltenüberschrift "NKM" oder "Kalt" oder "Netto"
- Bei "Mietzins" oder nur "Miete" ohne weitere Spezifikation: wenn separater "Nebenkostenvorschuss" daneben steht, ist es wahrscheinlich Kaltmiete
- Wenn nur Warmmiete vorhanden ist: NULL setzen (NICHT als Kaltmiete eintragen!)
- Leerstand: 0 € ODER die genannte "erzielbare Miete" / "marktübliche Miete" / "Soll-Miete"

ZIMMER-ANZAHL — Erkennungsmuster:
- "2-Zimmer-Wohnung" → 2
- "2,5 Zimmer" / "2.5 Zi" → 2.5
- "1 ZKB" / "2 ZKB" → 1 / 2
- "drei Zimmer" → 3 (Zahlworte erkennen)

═══ MAKLER ═══
- Kontaktdaten stehen oft im Impressum, Kontaktbereich oder am Seitenende
- Telefon: Unterscheide Mobilnummer (beginnt mit 01.../+49 1...) von Festnetz. Gib beides separat an (mobiltel/festnetztel)
- WICHTIG: Extrahiere ALLE gefundenen Kontaktdaten in die Array-Felder (alleNamen, alleTelefonnummern, alleEmails). Oft gibt es mehrere Ansprechpartner.

═══ KALKULATION ═══
- Kaufpreis aus der Kalkulation = Angebotspreis des Objekts
- Bruttorendite = Jahreskaltmiete / Kaufpreis × 100
- Grunderwerbsteuer variiert je Bundesland (Bayern/Sachsen 3,5%, Hamburg 5,5%, NRW/Berlin 6%, BW 5%)

═══ KONFIDENZ ═══
- "hoch": Wert steht explizit im Dokument
- "mittel": Wert ist abgeleitet/berechnet (z.B. Kaltmiete aus Bruttomiete minus genannte NK)
- "niedrig": Wert nicht gefunden — dann auch NULL setzen, NICHT raten

═══ NIEMALS ═══
- NIE Werte raten oder schätzen die nicht im Dokument stehen
- NIE Warmmiete als Kaltmiete übernehmen
- NIE die durchschnittliche Wohnfläche annehmen wenn die Einzelflächen fehlen`;
