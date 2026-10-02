import { useBlocker } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Wächter für ungespeicherte Eingaben (wie panelDarfSchliessen der alten App). Ein Formular mit offenen Änderungen
 * meldet sich mit `useUngespeichert` an; wer die Ansicht wechselt, ohne dass der Router beteiligt ist (Reiter,
 * anderer Eintrag der Liste), fragt vorher `darfVerlassen()`. Seitenwechsel und Neuladen fängt der Wächter selbst ab.
 */
let frage: string | null = null;

/** `true`, wenn nichts offen ist oder die Rückfrage mit „OK“ (verwerfen) beantwortet wurde. */
export const darfVerlassen = () => frage === null || window.confirm(frage);

export function useUngespeichert(aktiv: boolean, text: string) {
  useEffect(() => {
    if (!aktiv) return;
    frage = text;
    return () => { frage = null; };
  }, [aktiv, text]);
  // Suche und Filter ändern nur die Adresszeile derselben Seite — das Formular bleibt stehen, also keine Rückfrage
  useBlocker({
    disabled: !aktiv,
    enableBeforeUnload: aktiv,
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && !window.confirm(text),
  });
}
