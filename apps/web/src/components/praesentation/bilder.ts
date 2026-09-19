import type { Praesentation } from '@gg/api-contract';
import { bildFuerVorschau } from '@gg/documents';

export interface BildQuelle { ref: string; url: string; label: string }

const istBild = (v: unknown): v is string => typeof v === 'string' && (v.startsWith('photo:') || v.startsWith('data:image/'));

/**
 * Bildquellen für die Auswahl wie collectPickerSources der alten App: zuerst die Objektfotos,
 * dann Bilder aus anderen Folien dieser Präsentation, jeweils ohne Doppelte.
 */
export function bildQuellen(objektFotos: { ref: string; url: string; dateiname: string | null }[], p: Pick<Praesentation, 'slides'>): BildQuelle[] {
  const gesehen = new Set<string>();
  const quellen: BildQuelle[] = [];
  for (const f of objektFotos) {
    if (gesehen.has(f.ref)) continue;
    gesehen.add(f.ref);
    quellen.push({ ref: f.ref, url: f.url, label: f.dateiname || 'Objekt-Foto' });
  }
  for (const s of p.slides) {
    for (const [feld, wert] of Object.entries(s.data)) {
      for (const v of Array.isArray(wert) ? wert : [wert]) {
        if (!istBild(v) || gesehen.has(v)) continue;
        gesehen.add(v);
        quellen.push({ ref: v, url: bildFuerVorschau(v), label: `aus Folie „${s.typ}“ (${feld})` });
      }
    }
  }
  return quellen;
}

/** Mehrfachauswahl übernehmen: Beschriftungen wandern mit ihrem Bild in die neue Reihenfolge (finanzpraesPickerApplyMulti). */
export function auswahlUebernehmen(data: Record<string, unknown>, auswahl: string[]): Record<string, unknown> {
  const alteBilder = Array.isArray(data.bilder) ? (data.bilder as string[]) : [];
  const alteCaptions = Array.isArray(data.captions) ? (data.captions as string[]) : [];
  return { ...data, bilder: [...auswahl], captions: auswahl.map((ref) => { const i = alteBilder.indexOf(ref); return i >= 0 ? alteCaptions[i] || '' : ''; }) };
}
