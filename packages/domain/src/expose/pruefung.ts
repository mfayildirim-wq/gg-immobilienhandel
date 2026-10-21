/**
 * Prüfseite (Protokoll 30, P6): Pflichtfeld-Ampel, Plausibilitätswarnungen und Text der Rückfrage an den Makler.
 * Platzhalter — die Umsetzung folgt.
 */
import type { KalkulationV0, MaklerV0, ObjektV0 } from './zuordnung.ts';

export type Ampel = 'ok' | 'unsicher' | 'fehlt';
export interface PflichtfeldStand { feld: string; label: string; ampel: Ampel; hinweis: string | null }
export interface PruefDaten { objekt: Partial<ObjektV0>; makler: Partial<MaklerV0>; kalkulation: Partial<KalkulationV0> }
export interface Plausibilitaet { regel: string; text: string }

/** Muss-Felder (Adresse, Angebotspreis, Einheitenliste mit Fläche und Kaltmiete, Makler mit Telefon oder E-Mail, Provision %). */
export function pflichtfelderPruefen(_d: PruefDaten, _konfidenz: Record<string, string> = {}): PflichtfeldStand[] {
  return [];
}

/** Warnungen: Miete/m², Faktor, Σ Einheitenmieten ≈ Ist-Miete, Σ Flächen ≈ Wohnfläche, Einheitenzahl = Liste. */
export function plausibilitaetPruefen(_d: PruefDaten): Plausibilitaet[] {
  return [];
}

/** Rückfrage an den Makler zu den fehlenden/unsicheren Pflichtfeldern (nur Text, kein Versand). */
export function rueckfrageText(_fehlend: PflichtfeldStand[], _objekt: Partial<ObjektV0>, _makler: Partial<MaklerV0>): { betreff: string; text: string } {
  return { betreff: '', text: '' };
}
