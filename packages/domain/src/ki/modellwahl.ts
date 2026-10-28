/**
 * KI-Modellwahl je Bereich (Einstellungen → KI-Modelle). Neu gegenüber der alten App, dort stand jedes Modell fest im Code.
 * „standard“ heißt: wie bisher, je Funktion das fest hinterlegte Modell — so ändert die Einstellung nichts, bis jemand sie setzt.
 */

export const KI_STANDARD = 'standard';

export const KI_BEREICHE = [
  { id: 'praesentation', label: 'Bank-Präsentation', beschreibung: 'Lage- und Objektbeschreibung', bisher: 'Haiku 4.5' },
  { id: 'expose', label: 'Exposé und Unterlagen', beschreibung: 'Exposé-Analyse, Einheiten aus der Mieterliste', bisher: 'Haiku 4.5, bei dünnem Ergebnis und Scans Sonnet 5; Mieterliste Sonnet 4.5' },
  { id: 'makler', label: 'Makler und Persona', beschreibung: 'Zusammenfassung, Profil, Entwürfe, Kontaktanlässe', bisher: 'Haiku 4.5; Stilanalyse Sonnet 4.5' },
  { id: 'autoimport', label: 'Auto-Import', beschreibung: 'Seiten, Links und PDFs einordnen, Exposé aus Mailtext', bisher: 'Haiku 4.5; Mailtext Sonnet 4.5' },
] as const;

export type KiBereich = (typeof KI_BEREICHE)[number]['id'];

/** Wählbare Modelle (Claude-API-Kennung). Preise in US-$ je Million Token, Eingabe / Ausgabe — nur zur Orientierung in der Auswahl. */
export const KI_MODELLE = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', preis: '1 / 5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', preis: '0,10 / 0,50' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', preis: '3 / 15' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', preis: '2 / 10' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', preis: '4 / 20' },
] as const;

export type KiModellwahl = Record<KiBereich, string>;

export const KI_MODELLWAHL_STANDARD: KiModellwahl = { praesentation: KI_STANDARD, expose: KI_STANDARD, makler: KI_STANDARD, autoimport: KI_STANDARD };

const bekannt = (id: unknown): id is string => id === KI_STANDARD || KI_MODELLE.some((m) => m.id === id);

/** Gespeicherter Wert → vollständige Wahl. Fehlendes und Unbekanntes (z. B. ein inzwischen gestrichenes Modell) gilt als „standard“. */
export function kiModellwahlBereinigen(roh: unknown): KiModellwahl {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  const wahl = { ...KI_MODELLWAHL_STANDARD };
  for (const b of KI_BEREICHE) if (bekannt(r[b.id])) wahl[b.id] = r[b.id] as string;
  return wahl;
}

/** Das Modell, das ein Bereich erzwingt — `null` heißt: jede Funktion nimmt ihr fest hinterlegtes. */
export function kiModellFuer(wahl: KiModellwahl, bereich: KiBereich): string | null {
  const m = wahl[bereich];
  return m && m !== KI_STANDARD ? m : null;
}
