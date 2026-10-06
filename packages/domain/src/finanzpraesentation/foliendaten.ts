// Wörtliche Kopie von gg-immohandel src/lib/finanzpraesSlideData.ts
// ──────────────────────────────────────────────────────────────
// Slide-Data-Schemas für Bank-Finanzierungspräsentation
// ──────────────────────────────────────────────────────────────
// Pro Slide-Typ ein dediziertes Daten-Schema. Ergänzt das generische
// `Record<string, any>` aus `finanzpraes.ts` als Dokumentation und
// für IDE-Unterstützung. Wird absichtlich NICHT als Constraint im
// Slide-Interface durchgesetzt — die Slides bleiben rückwärtskompatibel
// mit alten Daten und Schema-Drift wird tolerant behandelt.
//
// Bilder können in zwei Formaten vorliegen:
//   - "photo:objId/photoId"   — Server-Storage-Referenz (neuer Default)
//   - "data:image/jpeg;base64..."   — Backwards-Compat (alte Slides)
// ──────────────────────────────────────────────────────────────

/** Bilder-String-Format (Refs ODER Data-URL). */
export type ImageString = string;

export interface SlideDataDeckblatt {
  titel?: string;
  untertitel?: string;
  bilder?: ImageString[];   // Erstes Bild = Hauptbild rechts vertikal
}

export interface SlideDataObjektbeschreibung {
  adresse?: string;
  baujahr?: string;
  einheiten?: string;
  stellplaetze?: string;
  wohnflaeche?: string;
  /** Gewerbefläche m² — nur angezeigt, wenn ausgefüllt (Neuerung 06.10.2026). */
  gewerbeflaeche?: string;
  /** Mietfläche m² (Wohn- + Gewerbefläche) — nur angezeigt, wenn ausgefüllt. */
  mietflaeche?: string;
  grundstueck?: string;
  /** Feldname historisch "gik", LABEL ist Kaufpreis (siehe Editor + Renderer). */
  gik?: string;
  /** Kaufpreis pro m² Mietfläche, formatiert (z.B. "2.450 €/m²"). */
  kaufpreisPerM2?: string;
  /** Jahresnettokaltmiete IST, formatiert (z.B. "48.000 €"). */
  jnkm?: string;
  /** Bruttorendite IST in %, formatiert (z.B. "5,2 %"). */
  renditeIst?: string;
  beschreibung?: string;
  bildPath?: ImageString;
}

export interface SlideDataLagebeschreibung {
  standortBullets?: string;   // Multi-line, eine Zeile pro Bullet
  anbindungBullets?: string;
  bildPath?: ImageString;
}

export interface SlideDataProjektbeschreibung {
  aktuellerStand?: string;
  geplanteMassnahmen?: string;
  vertrieb?: string;
}

export interface SlideDataGeschaeftsmodell {
  zielgruppe?: string;
  angebot?: string;
  kundengewinnung?: string;
  /** Vorteile für die Kunden — entspricht "Vorteile für die Kunden" im Original-Pitch.
   *  Feldname historisch "vorteile" (Backward-Compat). */
  vorteile?: string;
  /** Vorteile für die IVT — separate Sektion im Original-Pitch. */
  vorteileIvt?: string;
}

/** Gemeinsames Schema für Projektkalkulation, Verkaufspreise, Mietenaufstellung.
 *  Tabelle hat Vorrang vor Bild — wenn `tableRows` gesetzt, wird Tabelle gerendert. */
export interface SlideDataTabular {
  tableTitle?: string;
  tableHeaders?: string[];
  tableRows?: string[][];
  bildPath?: ImageString;       // Fallback wenn keine Tabelle
  beschreibung?: string;        // Optional unter Bild/Tabelle
}

export interface SlideDataFinanzierungsstruktur {
  gik?: string;
  em?: string;
  ekAnteil?: string;            // z.B. "18%" — Eigenmittel-Anteil
  fm?: string;
  fkAnteil?: string;            // z.B. "82%" — Fremdmittel-Anteil
  zinsbindung?: string;         // z.B. "Euribor 3 Monate + 2,5% Marge"
  verzinsung?: string;
  tilgung?: string;
  bereitstellung?: string;
  /** Strukturierungsentgelt der Bank, z.B. "1,5%". */
  strukturierungsentgelt?: string;
  /** Kreditlaufzeit, z.B. "18 Monate". */
  kreditlaufzeit?: string;
  /** Kreditnehmer (juristische Person), z.B. "IVT Wohnen GmbH". */
  kreditnehmer?: string;
  /** Verwendungszweck, z.B. "Zum gewerbsmäßigen Weiterverkauf". */
  verwendungszweck?: string;
  /** Bürgschaftsstruktur, z.B. "Blanco Anteil 50% Sven Neubert, 50% IVT AG". */
  buergschaft?: string;
  /** Grundschuldeintragung, z.B. "mit enger Zweckerklärung". */
  grundschuldeintragung?: string;
  /** Aufteilung der Grundschuld, z.B. "vollstreckbare und nicht vollstreckbare Grundschuld". */
  grundschuldAufteilung?: string;
  /** Ausschüttungs-Mechanik, z.B. "aus Übererlös der verkauften Einheiten". */
  ausschuettung?: string;
  zusatzBullets?: string;       // Multi-line — weitere freie Bullets
}

export interface SlideDataGrundrisse {
  bilder?: ImageString[];       // Pro Bild eine eigene PDF-/PPTX-Seite
  captions?: string[];          // Parallel-Array: caption[i] gehört zu bilder[i]
}

export interface SlideDataOrganigramm {
  bild?: ImageString;
  beschreibung?: string;
}

export interface SlideDataAbschluss {
  bild?: ImageString;
  untertitel?: string;          // z.B. "Gerry Weyrich, GF IVT Wohnen GmbH & ..."
}

export interface SlideDataImpressionen {
  bilder?: ImageString[];       // 4-8 Bilder Galerie
  captions?: string[];          // Parallel-Array
}

export interface SlideDataReferenz {
  projektName?: string;
  zeilen?: string;              // Multi-line Format: "Phase | Datum | Wert"
}

export interface SlideDataKundenliste {
  einzelverkauf?: string;       // Multi-line Bullets
  globalansprachen?: string;    // Multi-line Bullets
}

export interface SlideDataMarktvergleich {
  titel1?: string;
  bild1?: ImageString;
  text1?: string;
  titel2?: string;
  bild2?: ImageString;
  text2?: string;
}

/** Diskriminierte Union: ein Slide-Typ → genau ein Daten-Schema. */
export type SlideData =
  | ({ typ: 'deckblatt'             } & SlideDataDeckblatt)
  | ({ typ: 'objektbeschreibung'    } & SlideDataObjektbeschreibung)
  | ({ typ: 'lagebeschreibung'      } & SlideDataLagebeschreibung)
  | ({ typ: 'projektbeschreibung'   } & SlideDataProjektbeschreibung)
  | ({ typ: 'geschaeftsmodell'      } & SlideDataGeschaeftsmodell)
  | ({ typ: 'projektkalkulation'    } & SlideDataTabular)
  | ({ typ: 'verkaufspreise'        } & SlideDataTabular)
  | ({ typ: 'mietenaufstellung'     } & SlideDataTabular)
  | ({ typ: 'finanzierungsstruktur' } & SlideDataFinanzierungsstruktur)
  | ({ typ: 'grundrisse'            } & SlideDataGrundrisse)
  | ({ typ: 'organigramm'           } & SlideDataOrganigramm)
  | ({ typ: 'abschluss'             } & SlideDataAbschluss)
  | ({ typ: 'impressionen'          } & SlideDataImpressionen)
  | ({ typ: 'referenz'              } & SlideDataReferenz)
  | ({ typ: 'kundenliste'           } & SlideDataKundenliste)
  | ({ typ: 'marktvergleich'        } & SlideDataMarktvergleich);
