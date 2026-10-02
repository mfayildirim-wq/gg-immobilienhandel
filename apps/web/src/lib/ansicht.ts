import { useCallback, useEffect, useState } from 'react';

/** Merkt sich Ansichts-Einstellungen je Gerät. Speicher kann fehlen (privater Modus) → Standardwert. */
export function leseEinstellung<T extends string>(schluessel: string, erlaubt: readonly T[], standard: T): T {
  try {
    const wert = localStorage.getItem(`gg.${schluessel}`);
    return erlaubt.includes(wert as T) ? (wert as T) : standard;
  } catch {
    return standard;
  }
}

export function useEinstellung<T extends string>(schluessel: string, erlaubt: readonly T[], standard: T) {
  const [wert, setWert] = useState<T>(() => leseEinstellung(schluessel, erlaubt, standard));
  const setzen = useCallback(
    (neu: T) => {
      setWert(neu);
      try {
        localStorage.setItem(`gg.${schluessel}`, neu);
      } catch {
        // nur Komfort, kein Fehler
      }
    },
    [schluessel],
  );
  return [wert, setzen] as const;
}

/** Gemerkte Größe je Gerät (z. B. Breite der Liste in Pixeln); `null`, wenn nichts Brauchbares gespeichert ist. */
export function leseZahl(schluessel: string): number | null {
  try {
    const roh = localStorage.getItem(`gg.${schluessel}`);
    const n = roh === null || roh.trim() === '' ? Number.NaN : Number(roh);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function useZahlEinstellung(schluessel: string) {
  const [wert, setWert] = useState<number | null>(() => leseZahl(schluessel));
  const setzen = useCallback(
    (neu: number | null) => {
      setWert(neu);
      try {
        if (neu === null) localStorage.removeItem(`gg.${schluessel}`);
        else localStorage.setItem(`gg.${schluessel}`, String(neu));
      } catch {
        // nur Komfort, kein Fehler
      }
    },
    [schluessel],
  );
  return [wert, setzen] as const;
}

/**
 * Größe der Liste beim Ziehen des Teilers: ganze Pixel, die Liste nicht kleiner als `minListe`, das Detail nicht
 * kleiner als `minDetail`. Reicht der Platz für beides nicht, geht die Liste zurück — das Detail ist die Arbeitsfläche.
 */
export function teilerBegrenzen(wert: number, gesamt: number, minListe = 240, minDetail = 360): number {
  return Math.round(Math.max(minListe, Math.min(wert, gesamt - minDetail)));
}

export const LAYOUTS = ['nebeneinander', 'untereinander'] as const;
export type Layout = (typeof LAYOUTS)[number];

/**
 * Auswahl einer Master-Detail-Ansicht: rechts steht immer etwas.
 *  • Ohne eigene Wahl ist der erste Eintrag der Liste gewählt.
 *  • Eine Kennung aus der Adresszeile (`?deal=…`) hat Vorrang, solange sie dort steht.
 *  • Was aus der Liste verschwindet (gelöscht, gefiltert), gibt die Auswahl an den ersten Eintrag ab —
 *    sonst bliebe rechts ein Datensatz stehen, den es nicht mehr gibt.
 */
export function useAuswahl(ids: readonly string[], ausAdresse?: string | null) {
  const [gewaehlt, waehlen] = useState<string | null>(ausAdresse ?? null);
  useEffect(() => {
    if (ausAdresse) waehlen(ausAdresse);
  }, [ausAdresse]);
  const auswahl = gewaehlt && ids.includes(gewaehlt) ? gewaehlt : ids[0] ?? null;
  return [auswahl, waehlen] as const;
}

export function heuteIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
