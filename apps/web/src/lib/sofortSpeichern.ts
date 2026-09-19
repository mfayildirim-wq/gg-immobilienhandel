import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Bearbeitete Kopie eines Server-Stands, die jede Änderung sofort speichert (wie alt: K1, kein Speichern-Knopf).
 * Änderungen wirken auf den neuesten lokalen Stand (nicht auf eine veraltete Render-Kopie), Speichervorgänge laufen
 * nacheinander und senden immer den jeweils neuesten Stand.
 */
export function useSofortSpeichern<T>(server: T | undefined, speichern: (stand: T) => Promise<unknown>) {
  const [stand, setStand] = useState<T | undefined>(server);
  const aktuell = useRef<T | undefined>(server);
  const kette = useRef<Promise<unknown>>(Promise.resolve());
  const aufruf = useRef(speichern);
  aufruf.current = speichern;
  const offen = useRef(0);
  const [fehler, setFehler] = useState<string | null>(null);

  // Server-Stand übernehmen (erstes Laden, Änderungen von anderer Stelle) — nie, solange eigene Speicherungen laufen
  useEffect(() => {
    if (server !== undefined && offen.current === 0) { aktuell.current = server; setStand(server); }
  }, [server]);

  const aendern = useCallback((f: (alt: T) => T) => {
    if (aktuell.current === undefined) return;
    const neu = f(aktuell.current);
    aktuell.current = neu;
    setStand(neu);
    offen.current++;
    kette.current = kette.current.then(async () => {
      try {
        if (aktuell.current !== neu) return; // ein neuerer Stand folgt ohnehin
        await aufruf.current(neu);
        setFehler(null);
      } catch (e) {
        setFehler((e as Error).message);
      } finally {
        offen.current--;
      }
    });
  }, []);

  /** Server-Antwort übernehmen, z. B. nach Zurücksetzen. */
  const ersetzen = useCallback((neu: T) => { aktuell.current = neu; setStand(neu); }, []);
  return { stand, aendern, ersetzen, fehler };
}
