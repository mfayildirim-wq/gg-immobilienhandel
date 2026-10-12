// Bilder aus dem Exposé (Protokoll 30, P5): eingebettete Fotos herauslösen, Logos/Symbole/Duplikate filtern.
// Platzhalter — die Umsetzung folgt.

export interface ExposeBild { seite: number; breite: number; hoehe: number; mime: 'image/jpeg'; bytes: Uint8Array; hash: string }

export interface BilderOptionen { minBreite?: number; minHoehe?: number; maxBilder?: number }

/** Alle brauchbaren Fotos des PDFs in Dokumentreihenfolge, als JPEG; wirft nicht (Fehler → leere Liste). */
export async function bilderAusPdf(_pdf: Uint8Array, _optionen: BilderOptionen = {}): Promise<ExposeBild[]> {
  return [];
}
