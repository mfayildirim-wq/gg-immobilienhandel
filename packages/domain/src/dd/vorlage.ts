/**
 * DD-Dokumentenliste (Einstellungen → DD): welche Unterlagen für die Prüfung eines Objekts gebraucht werden und woher
 * sie kommen. Auslieferungszustand wörtlich aus der alten App (`DD_DEFAULT` in settings.ts); die gespeicherte Liste
 * des Nutzers zieht beim Umzug mit (`immo-dd-template` → `dd_checkliste_vorlage`).
 */
export interface DdZeile { dokument: string; quelle: string }

export const DD_STANDARD: readonly DdZeile[] = [
  { dokument: 'Fotos (professionell)', quelle: '—' },
  { dokument: 'Katasterkarte', quelle: 'Online' },
  { dokument: 'Lageplan', quelle: 'Online' },
  { dokument: 'Auszug Bodenrichtwertkarte', quelle: 'Online' },
  { dokument: 'Grundbuchauszug', quelle: 'Notariat' },
  { dokument: 'Bewilligungsurkunden', quelle: 'Grundbuchzentralarchiv' },
  { dokument: 'Teilungserklärung', quelle: 'Grundbuchamt' },
  { dokument: 'Teilungspläne', quelle: 'Baurechtsamt' },
  { dokument: 'Letzte 3 Protokolle', quelle: 'Hausverwaltung' },
  { dokument: 'Wirtschaftsplan', quelle: 'Hausverwaltung' },
  { dokument: 'Abrechnung Hausverwaltung', quelle: 'Hausverwaltung' },
  { dokument: 'Bebauungsplan', quelle: 'Baurechtsamt' },
  { dokument: 'Denkmalschutzauskunft', quelle: 'Baurechtsamt' },
  { dokument: 'Erschließungsbeitragsbescheid', quelle: 'Baurechtsamt' },
  { dokument: 'Umlegung/Sanierung/Erhaltungssatzung', quelle: 'Baurechtsamt' },
  { dokument: 'Altlastenauskunft', quelle: 'Baurechtsamt' },
  { dokument: 'Baugenehmigung (letzter Stand)', quelle: 'Baurechtsamt' },
  { dokument: 'Baugenehmigungen (Historie)', quelle: 'Baurechtsamt' },
  { dokument: 'Baulastenauskünfte', quelle: 'Baurechtsamt' },
  { dokument: 'Grundrisse (genehmigt mit Stempel)', quelle: 'Baurechtsamt' },
  { dokument: 'Grundrisse (optisch mit Maß)', quelle: '—' },
  { dokument: 'Ansichten-Schnitte', quelle: 'Baurechtsamt' },
  { dokument: 'Flächenaufmaß (gestempelt)', quelle: '—' },
  { dokument: 'Legionellen Prüfbericht', quelle: '—' },
  { dokument: 'Energieausweis', quelle: 'Hausverwaltung' },
  { dokument: 'Mietverträge', quelle: '—' },
  { dokument: 'Übergabeprotokolle', quelle: '—' },
  { dokument: 'Mietanpassungen', quelle: '—' },
  { dokument: 'Nebenkostenabrechnung', quelle: '—' },
  { dokument: 'Sonstiger wichtiger Schriftverkehr', quelle: '—' },
  { dokument: 'Bewirtschaftungsverträge', quelle: '—' },
  { dokument: 'Versicherungsnachweise', quelle: 'Hausverwaltung' },
  { dokument: 'Grundsteuerbescheide', quelle: '—' },
  { dokument: 'Kaufvertragsentwurf', quelle: 'Notariat' },
];

/** settingsDDSave: Werte trimmen, Positionen ohne Dokument entfallen; eine fehlende Quelle wird zum Gedankenstrich. */
export function ddListeBereinigen(zeilen: { dokument?: string | null; quelle?: string | null }[]): DdZeile[] {
  return zeilen.map((z) => ({ dokument: (z.dokument ?? '').trim(), quelle: (z.quelle ?? '').trim() || '—' })).filter((z) => z.dokument);
}
