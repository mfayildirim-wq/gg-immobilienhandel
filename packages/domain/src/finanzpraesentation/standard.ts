/**
 * Globale Vorbelegungen der Bank-Präsentation (alte App: src/lib/finanzpraesDefaults.ts, KV „immo-finanzpraes-defaults“).
 * Texte wörtlich; die beiden Standardbilder (Organigramm, Abschlussfoto, zusammen ~230 KB) liegen nicht hier,
 * sondern in @gg/documents (finanzpraes/standardbilder.ts) und werden über die Platzhalter unten eingesetzt.
 */
export interface FinanzpraesDefaults {
  geschaeftsmodell: {
    zielgruppe: string;
    angebot: string;
    kundengewinnung: string;
    /** Vorteile für die Kunden — Sektion 4 im Original-Pitch. */
    vorteile: string;
    /** Vorteile für die IVT — Sektion 5 im Original-Pitch. */
    vorteileIvt: string;
  };
  organigramm: {
    bild: string;          // Data-URL, photo:-Verweis oder leer
    beschreibung: string;
  };
  abschluss: {
    untertitel: string;
    bild: string;
  };
}

/** Platzhalter für die mitgelieferten Standardbilder; @gg/documents setzt beim Rendern das Bild ein.
 *  Ein gespeichertes leeres `bild` bleibt leer (die alte App zeigte dann den Hinweis „Kein … hinterlegt“). */
export const STANDARDBILD_ORGANIGRAMM = 'standardbild:organigramm';
export const STANDARDBILD_ABSCHLUSS = 'standardbild:abschluss';

/** Texte wie in der alten App; Bilder als Platzhalter (siehe oben). */
export const FINANZPRAES_DEFAULTS_STANDARD: FinanzpraesDefaults = {
  geschaeftsmodell: {
    // Wortlaut 1:1 aus "Finanzierungspräsentation Aldinger Straße 86, Kornwestheim.pdf" Slide 4
    zielgruppe: 'Vermögende Menschen und Vielverdiener\nPrivate Banking Kunden',
    angebot: 'Direktinvestitionen in Immobilien der IVT\nFull-Service auf höchstem Niveau durch eigene Verwaltungsgesellschaft\nAlles aus einer Hand: Steueroptimierung, Sanierung, Vermietung, Verwaltung, Buchhaltung',
    kundengewinnung: 'Kooperation mit div. Bankhäusern, z. Bsp. Wealth Management / Private Banking Deutsche Bank Hamburg und BW-Bank\nSehr starke Weiterempfehlungen, da die bestehenden Kunden ein hoch vermögendes Umfeld haben\nAktuelle Warteliste mit > 20 Personen',
    vorteile: 'Kein Zeitaufwand durch die Full-Service-Dienstleistung der IVT\nHohe Steuervorteile durch gezielte Sanierungen, auf Rechnung der Kunden nach Erwerb',
    vorteileIvt: 'Kurze Projektlaufzeiten, aufgrund von drei etablierten Vertriebswegen pro Projekt\nGeringerer Kapitalbedarf, da Sanierungen erst später und auf Rechnung der Kunden durchgeführt werden',
  },
  organigramm: {
    bild: STANDARDBILD_ORGANIGRAMM,
    beschreibung: '',
  },
  abschluss: {
    untertitel: 'Gerry Weyrich, Geschäftsführer IVT Wohnen GmbH  &  Sven Neubert, Vorstand IVT AG',
    bild: STANDARDBILD_ABSCHLUSS,
  },
};

/** Wie getFinanzpraesDefaults: gespeicherte Teile über die Standardwerte legen (je Abschnitt). */
export function finanzpraesDefaultsZusammenfuehren(gespeichert: unknown): FinanzpraesDefaults {
  const s = (gespeichert && typeof gespeichert === 'object' ? gespeichert : {}) as Partial<Record<keyof FinanzpraesDefaults, object>>;
  const std = FINANZPRAES_DEFAULTS_STANDARD;
  return {
    geschaeftsmodell: { ...std.geschaeftsmodell, ...(s.geschaeftsmodell || {}) },
    organigramm: { ...std.organigramm, ...(s.organigramm || {}) },
    abschluss: { ...std.abschluss, ...(s.abschluss || {}) },
  };
}
