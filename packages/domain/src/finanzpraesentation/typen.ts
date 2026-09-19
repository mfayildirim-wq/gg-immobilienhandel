/**
 * Datenmodell der Bank-Finanzierungspräsentation — wie in gg-immohandel src/modules/finanzpraes/finanzpraes.ts.
 * Pro Deal höchstens eine Präsentation; Folien mit Typ, Sichtbarkeit und freien Daten (Schema je Typ: foliendaten.ts).
 */
export type SlideTyp =
  | 'deckblatt'
  | 'objektbeschreibung'
  | 'lagebeschreibung'
  | 'projektbeschreibung'
  | 'geschaeftsmodell'
  | 'projektkalkulation'
  | 'verkaufspreise'
  | 'mietenaufstellung'
  | 'finanzierungsstruktur'
  | 'grundrisse'
  | 'organigramm'
  | 'abschluss'
  | 'impressionen'
  | 'referenz'
  | 'kundenliste'
  | 'marktvergleich';

export interface Slide {
  id: string;
  typ: SlideTyp;
  visible: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wie im Original: tolerant gegenüber Altdaten
  data: Record<string, any>;
}

export interface FinanzPraes {
  id: string;
  dealId: string;
  bankName: string;
  slides: Slide[];
  internNotiz?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlideTypMeta {
  typ: SlideTyp;
  label: string;
  icon: string;
  beschreibung: string;
}

export const SLIDE_TYPES: SlideTypMeta[] = [
  { typ: 'deckblatt',           label: 'Deckblatt',                   icon: '📄', beschreibung: 'Titel + Bilder-Galerie (6-7 Bilder)' },
  { typ: 'objektbeschreibung',  label: 'Objektbeschreibung',          icon: '🏠', beschreibung: 'Key-Facts-Tabelle + Beschreibungstext + Bild' },
  { typ: 'lagebeschreibung',    label: 'Lagebeschreibung',            icon: '📍', beschreibung: 'Standort + Anbindung + Karte/Foto' },
  { typ: 'projektbeschreibung', label: 'Projektbeschreibung',         icon: '🔨', beschreibung: 'Aktueller Stand · Geplante Maßnahmen · Vertrieb' },
  { typ: 'geschaeftsmodell',    label: 'Geschäftsmodell',             icon: '🎯', beschreibung: 'Zielgruppe · Angebot · Kundengewinnung · Vorteile' },
  { typ: 'projektkalkulation',  label: 'Projektkalkulation',          icon: '📊', beschreibung: 'Bild der Excel-Kalkulation' },
  { typ: 'verkaufspreise',      label: 'Liste Verkaufspreise',        icon: '💰', beschreibung: 'Tabelle/Bild der VKP pro Einheit' },
  { typ: 'mietenaufstellung',   label: 'Mietenaufstellung',           icon: '📋', beschreibung: 'Aktuelle Mieterliste mit Kaltmieten' },
  { typ: 'finanzierungsstruktur', label: 'Finanzierungsstruktur',     icon: '🏦', beschreibung: 'GIK · EM · FM · Zinsbindung · Tilgung' },
  { typ: 'grundrisse',          label: 'Grundrisse',                  icon: '📐', beschreibung: 'Mehrere Seiten, je 1 Grundriss-Bild' },
  { typ: 'organigramm',         label: 'Organigramm',                 icon: '🏢', beschreibung: 'IVT-Konzernstruktur (anpassbar)' },
  { typ: 'abschluss',           label: 'Abschluss "Ein Projekt der"', icon: '👥', beschreibung: 'Geschäftsführer-Vorstellung + Bilder' },
  { typ: 'impressionen',        label: 'Impressionen',                icon: '📸', beschreibung: '4-8 Objektfotos in Galerie' },
  { typ: 'referenz',            label: 'Referenz Abwicklung',         icon: '📅', beschreibung: 'Past-Projekt mit Termin-Tabelle' },
  { typ: 'kundenliste',         label: 'Kundenliste',                 icon: '👤', beschreibung: 'Einzelverkauf / Globalansprachen' },
  { typ: 'marktvergleich',      label: 'Marktvergleich',              icon: '📈', beschreibung: 'Sprengnetter / Online-Portale' },
];

export const SLIDE_TYP_WERTE = SLIDE_TYPES.map((t) => t.typ) as [SlideTyp, ...SlideTyp[]];

/** Standard-IVT-Pitch — Reihenfolge wie in den 3 analysierten Beispielen. */
export const STANDARD_PRESET_ORDER: SlideTyp[] = [
  'deckblatt',
  'objektbeschreibung',
  'lagebeschreibung',
  'projektbeschreibung',
  'geschaeftsmodell',
  'projektkalkulation',
  'verkaufspreise',
  'mietenaufstellung',
  'finanzierungsstruktur',
  'grundrisse',
  'impressionen',
  'organigramm',
  'abschluss',
];
