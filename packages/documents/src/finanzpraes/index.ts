import { STANDARDBILD_ABSCHLUSS, STANDARDBILD_ORGANIGRAMM } from '@gg/domain';
import { STANDARD_ABSCHLUSS_BILD, STANDARD_ORGANIGRAMM_BILD } from './standardbilder.ts';

export * from './vorlage.ts';
export { STANDARD_ABSCHLUSS_BILD, STANDARD_ORGANIGRAMM_BILD } from './standardbilder.ts';

const STANDARDBILDER: Record<string, string> = {
  [STANDARDBILD_ORGANIGRAMM]: STANDARD_ORGANIGRAMM_BILD,
  [STANDARDBILD_ABSCHLUSS]: STANDARD_ABSCHLUSS_BILD,
};

/** Tiefe Kopie, in der die Platzhalter `standardbild:*` durch die mitgelieferten Bilder ersetzt sind. */
export function standardbilderEinsetzen<T>(wert: T): T {
  if (typeof wert === 'string') return (STANDARDBILDER[wert] ?? wert) as T;
  if (Array.isArray(wert)) return wert.map(standardbilderEinsetzen) as T;
  if (wert && typeof wert === 'object') return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, standardbilderEinsetzen(v)])) as T;
  return wert;
}
