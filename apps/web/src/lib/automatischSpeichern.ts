import { useCallback, useEffect, useRef, useState } from 'react';

export type Speicherstand = 'gespeichert' | 'speichert' | 'wartet' | { fehler: string };

/**
 * Speichert jede Änderung nach kurzer Pause (wie die alte App), mit Versionsprüfung.
 * Ändert sich während des Speicherns etwas, wird der neueste Stand nachgeschoben; ein 409 bleibt als Fehler stehen.
 */
export function useAutomatischSpeichern<T, A extends { version: number }>(
  aktuell: T,
  start: { version: number; stand: T },
  speichern: (stand: T, version: number) => Promise<A>,
  gespeichert?: (antwort: A) => void,
  verzoegerungMs = 700,
): Speicherstand {
  const s = useRef({ version: start.version, gesendet: JSON.stringify(start.stand), laeuft: false });
  const neuester = useRef(aktuell);
  neuester.current = aktuell;
  const aufrufe = useRef({ speichern, gespeichert });
  aufrufe.current = { speichern, gespeichert };
  const [zustand, setZustand] = useState<Speicherstand>('gespeichert');

  const lauf = useCallback(async () => {
    const r = s.current;
    if (r.laeuft) return; // der laufende Durchgang prüft am Ende selbst, ob noch etwas offen ist
    r.laeuft = true;
    try {
      for (let json = JSON.stringify(neuester.current); json !== r.gesendet; json = JSON.stringify(neuester.current)) {
        setZustand('speichert');
        const antwort = await aufrufe.current.speichern(neuester.current, r.version);
        r.version = antwort.version;
        r.gesendet = json;
        aufrufe.current.gespeichert?.(antwort);
      }
      setZustand('gespeichert');
    } catch (e) {
      setZustand({ fehler: (e as Error).message });
    } finally {
      r.laeuft = false;
    }
  }, []);

  useEffect(() => {
    if (JSON.stringify(aktuell) === s.current.gesendet) return;
    setZustand('wartet');
    const t = setTimeout(() => void lauf(), verzoegerungMs);
    return () => clearTimeout(t);
  }, [aktuell, lauf, verzoegerungMs]);
  return zustand;
}
