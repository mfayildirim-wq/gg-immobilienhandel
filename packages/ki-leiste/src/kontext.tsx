/**
 * Wo bin ich? Jede Detailansicht der App meldet ihren Dialog mit `useKiBezug({ art, id })` — eine Zeile. Gemeldet ist
 * immer der zuletzt geöffnete; schließt er, gilt wieder der davor. Außerdem: ist die Leiste offen?
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { KiBezug } from '@gg/ki-kern/vertrag';
import type { KiTransport } from './transport.ts';

interface KiLeisteWert {
  transport: KiTransport;
  offen: boolean;
  setOffen: (offen: boolean) => void;
  bezug: KiBezug | null;
  melden: (wer: string, b: KiBezug | null) => void;
}

const Kontext = createContext<KiLeisteWert | null>(null);
const SPEICHER = 'ki-leiste.offen';

function gemerktOffen(): boolean {
  try { return localStorage.getItem(SPEICHER) === '1'; } catch { return false; }
}

export function KiLeisteRahmen({ transport, children }: { transport: KiTransport; children: ReactNode }) {
  const [offen, setOffenRoh] = useState(gemerktOffen);
  // Reihenfolge = Meldereihenfolge; der letzte Eintrag ist der aktuelle Dialog
  const [meldungen, setMeldungen] = useState<[string, KiBezug][]>([]);
  const setOffen = useCallback((o: boolean) => {
    setOffenRoh(o);
    try { localStorage.setItem(SPEICHER, o ? '1' : '0'); } catch { /* privates Fenster */ }
  }, []);
  const melden = useCallback((wer: string, b: KiBezug | null) => {
    setMeldungen((alt) => {
      const ohne = alt.filter(([w]) => w !== wer);
      return b ? [...ohne, [wer, b]] : ohne;
    });
  }, []);
  const letzte = meldungen.at(-1)?.[1] ?? null;
  const art = letzte?.art;
  const id = letzte?.id;
  const bezug = useMemo(() => (art && id ? { art, id } : null), [art, id]);
  const wert = useMemo(() => ({ transport, offen, setOffen, bezug, melden }), [transport, offen, setOffen, bezug, melden]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

export function useKiLeiste(): KiLeisteWert {
  const k = useContext(Kontext);
  if (!k) throw new Error('useKiLeiste braucht <KiLeisteRahmen> um die App.');
  return k;
}

/** Meldet den Dialog, solange die Komponente steht. Ohne Rahmen (z. B. in Tests einzelner Ansichten) tut es nichts. */
export function useKiBezug(b: KiBezug | null | undefined) {
  const k = useContext(Kontext);
  const wer = useId();
  const melden = k?.melden;
  const art = b?.art;
  const id = b?.id;
  useEffect(() => {
    if (!melden) return;
    melden(wer, art && id ? { art, id } : null);
    return () => melden(wer, null);
  }, [melden, wer, art, id]);
}
