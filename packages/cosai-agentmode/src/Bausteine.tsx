/**
 * Kleine Bausteine der Oberfläche: Sprechblasen (Text erscheint Buchstabe für Buchstabe, wie in CoSAi), Chips,
 * das Schaufenster (Schleier, Hervorhebung, Etikett, Geisterzeiger) und die Gedächtnis-Leiste.
 */
import { useEffect, useState, type ReactNode } from 'react';

/** Der Text wächst, solange der Satz neu ist; alte Sätze stehen einfach da. */
export function useGetippt(text: string, schluessel: string | number, aktiv: boolean): { sichtbar: string; tippt: boolean } {
  const [anzahl, setAnzahl] = useState(aktiv ? 0 : text.length);
  useEffect(() => {
    const ruhig = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!aktiv || ruhig) { setAnzahl(text.length); return; }
    setAnzahl(0);
    const schritt = Math.max(1, Math.ceil(text.length / 70));
    const t = setInterval(() => setAnzahl((n) => (n >= text.length ? (clearInterval(t), n) : n + schritt)), 28);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel, aktiv]);
  return { sichtbar: text.slice(0, Math.min(anzahl, text.length)), tippt: anzahl < text.length };
}

export function Sprechblase({ wer, text, schluessel, lebendig = false }: { wer: 'agent' | 'nutzer'; text: string; schluessel: string | number; lebendig?: boolean }) {
  const { sichtbar, tippt } = useGetippt(text, schluessel, lebendig);
  return (
    <div className="am-blase" data-wer={wer} role={wer === 'agent' ? 'status' : undefined} aria-live={wer === 'agent' ? 'polite' : undefined}>
      <span className="am-wer">{wer === 'agent' ? 'Agent' : 'Du'}</span>
      <span className="am-sr" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{text}</span>
      <span aria-hidden>{sichtbar}{tippt && <span className="am-cursor" />}</span>
    </div>
  );
}

export interface ChipDaten { label: string; wert: string; art?: 'entscheidung' | 'vorschlag' }

export function Chips({ chips, waehlen, aus }: { chips: ChipDaten[]; waehlen: (c: ChipDaten) => void; aus?: boolean }) {
  if (!chips.length) return null;
  return (
    <div className="am-chips" role="group" aria-label="Antwortmöglichkeiten">
      {chips.map((c) => (
        <button key={`${c.art}-${c.wert}-${c.label}`} type="button" className="am-chip" data-art={c.art ?? 'vorschlag'} disabled={aus} onClick={() => waehlen(c)}>{c.label}</button>
      ))}
    </div>
  );
}

export interface Schritt { el: HTMLElement | null; text: string }

/**
 * Das Schaufenster: solange der Agent handelt, ist die App zu sehen, aber nicht zu klicken. Das Ziel des aktuellen
 * Schritts leuchtet, ein Etikett sagt, was passiert, ein Geisterzeiger bewegt sich dorthin.
 */
export function Schaufenster({ aktiv, schritt, uebernehmen, children }: { aktiv: boolean; schritt: Schritt | null; uebernehmen: () => void; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    document.querySelectorAll('[data-agent-ziel="aktiv"]').forEach((e) => e.removeAttribute('data-agent-ziel'));
    if (!schritt?.el) { setPos(null); return; }
    schritt.el.setAttribute('data-agent-ziel', 'aktiv');
    const r = schritt.el.getBoundingClientRect();
    setPos({ top: Math.max(8, r.top - 30), left: Math.max(8, r.left) });
    return () => schritt.el?.removeAttribute('data-agent-ziel');
  }, [schritt]);
  return (
    <div className="am-schaufenster" data-aktiv={aktiv ? 'true' : 'false'} aria-busy={aktiv || undefined}>
      <div className="am-inhalt">{children}</div>
      {aktiv && (
        <div className="am-schleier" aria-hidden style={{ opacity: 1 }}>
          <button type="button" className="am-knopf" style={{ position: 'absolute', right: 12, bottom: 12, pointerEvents: 'auto' }} onClick={uebernehmen}>Übernehmen</button>
        </div>
      )}
      {schritt && pos && (
        <>
          <span className="am-etikett" style={{ top: pos.top, left: pos.left }} data-etikett>Agent: {schritt.text}</span>
          <svg className="am-zeiger" viewBox="0 0 18 18" style={{ top: pos.top + 26, left: pos.left + 8 }} aria-hidden>
            <path d="M2 1l13 7-6 1.5L7 16z" fill="#fff" stroke="#1c2429" strokeWidth="1.2" />
          </svg>
        </>
      )}
    </div>
  );
}

export interface GedaechtnisEintragDaten { id?: string; art: string; schluessel: string; inhalt: string; haeufigkeit: number; zuletzt?: string }

export function Gedaechtnisleiste({ eintraege, loeschen, bestaetigen }: { eintraege: GedaechtnisEintragDaten[]; loeschen: (id: string) => void; bestaetigen?: (id: string) => void }) {
  if (!eintraege.length) return <p className="am-hinweis">Noch nichts gemerkt.</p>;
  return (
    <ul className="am-liste" aria-label="Gedächtnis">
      {eintraege.map((e) => (
        <li key={e.id ?? `${e.art}-${e.schluessel}-${e.inhalt}`}>
          <span className="am-hinweis" style={{ minWidth: 86 }}>{e.art}</span>
          <span style={{ flex: 1 }}><b>{e.schluessel}</b>: {e.inhalt}{e.haeufigkeit > 1 ? ` (${e.haeufigkeit}×)` : ''}</span>
          {e.id && e.art === 'fakt' && bestaetigen && <button type="button" className="am-knopf" onClick={() => bestaetigen(e.id!)}>Bestätigen</button>}
          {e.id && <button type="button" className="am-knopf" aria-label={`${e.inhalt} vergessen`} onClick={() => loeschen(e.id!)}>Vergessen</button>}
        </li>
      ))}
    </ul>
  );
}
