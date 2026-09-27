/**
 * Ergebnisse des Agenten (Recherchen, Analysen) zum Objekt, das in der App offen ist. Im Block ersetzen sie den zweiten
 * Bereich (Eingabe und Knöpfe); ⤢ vergrößert als Dialog, ✕ schließt — dann sind die Knöpfe wieder da.
 */
import { useEffect, useState } from 'react';
import { Formatiert } from './Bausteine.tsx';

export interface ErgebnisDaten {
  id: string;
  titel: string;
  art: string;
  inhalt: string;
  quellen: { titel: string; url?: string }[];
  frage: string | null;
  createdAt: string;
  bezuege: { typ: string; refId: string; bezeichnung: string }[];
}

const ART: Record<string, string> = { recherche: 'Recherche', dokumentanalyse: 'Dokumentanalyse', vergleich: 'Vergleich', zusammenfassung: 'Zusammenfassung', sonstiges: 'Ergebnis' };
const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Nur http(s)-Adressen als Link — Quellen kommen vom Modell */
const sichereUrl = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : undefined);

function Eintrag({ e, offen, umschalten, loeschen }: { e: ErgebnisDaten; offen: boolean; umschalten: () => void; loeschen: (id: string) => void }) {
  return (
    <li className="am-ergebnis" data-offen={offen}>
      <button type="button" className="am-ergebnis-kopf" aria-expanded={offen} onClick={umschalten}>
        <span className="am-ergebnis-titel">{e.titel}</span>
        <span className="am-ergebnis-art">{ART[e.art] ?? e.art}</span>
        <time>{datum(e.createdAt)}</time>
      </button>
      {offen && (
        <div className="am-ergebnis-inhalt">
          {e.frage && <p className="am-hinweis">Frage: {e.frage}</p>}
          <div className="am-blase-text"><Formatiert text={e.inhalt} /></div>
          {!!e.quellen.length && (
            <p className="am-ergebnis-quellen">
              Quellen: {e.quellen.map((q, i) => {
                const url = sichereUrl(q.url);
                return <span key={i}>{i > 0 && ' · '}{url ? <a href={url} target="_blank" rel="noopener noreferrer">{q.titel}</a> : q.titel}</span>;
              })}
            </p>
          )}
          {!!e.bezuege.length && <p className="am-hinweis">Gehört zu: {e.bezuege.map((b) => `${b.typ} ${b.bezeichnung || b.refId}`).join(', ')}</p>}
          <button type="button" className="am-knopf" onClick={() => loeschen(e.id)}>Löschen</button>
        </div>
      )}
    </li>
  );
}

export function ErgebnisListe({ ergebnisse, alleOffen = false, loeschen }: { ergebnisse: ErgebnisDaten[]; alleOffen?: boolean; loeschen: (id: string) => void }) {
  const [offen, setOffen] = useState<Set<string>>(new Set());
  if (!ergebnisse.length) return <p className="am-hinweis">Noch keine gespeicherten Ergebnisse. Frag den Agenten nach einer Recherche oder Analyse — er bietet an, sie hier zu speichern.</p>;
  return (
    <ul className="am-ergebnis-liste">
      {ergebnisse.map((e) => (
        <Eintrag key={e.id} e={e} offen={alleOffen || offen.has(e.id)} loeschen={loeschen}
          umschalten={() => setOffen((o) => { const n = new Set(o); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
      ))}
    </ul>
  );
}

/** Der zweite Bereich des Blocks: Liste mit Kopf (⤢ vergrößern, ✕ schließen) */
export function ErgebnisBereich({ titel, ergebnisse, loeschen, vergroessern, schliessen }: { titel: string; ergebnisse: ErgebnisDaten[]; loeschen: (id: string) => void; vergroessern: () => void; schliessen: () => void }) {
  return (
    <section className="am-ergebnisse" aria-label="Ergebnisse">
      <div className="am-ergebnisse-kopf">
        <strong>🗂 {titel}</strong>
        <span className="am-hinweis">{ergebnisse.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="am-symbol" aria-label="Ergebnisse vergrößern" data-tipp="Vergrößern" onClick={vergroessern}>⤢</button>
        <button type="button" className="am-symbol" aria-label="Ergebnisse schließen" data-tipp="Schließen" onClick={schliessen}>✕</button>
      </div>
      <ErgebnisListe ergebnisse={ergebnisse} loeschen={loeschen} />
    </section>
  );
}

/** Groß als Dialog — Esc oder ✕ schließt (zurück zu den Knöpfen) */
export function ErgebnisDialog({ titel, ergebnisse, loeschen, schliessen }: { titel: string; ergebnisse: ErgebnisDaten[]; loeschen: (id: string) => void; schliessen: () => void }) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') schliessen(); };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [schliessen]);
  return (
    <div className="am-dialog-grund" onClick={schliessen}>
      <div className="am-dialog" role="dialog" aria-modal="true" aria-label={`Ergebnisse — ${titel}`} onClick={(e) => e.stopPropagation()}>
        <div className="am-ergebnisse-kopf">
          <strong>🗂 {titel}</strong>
          <span className="am-hinweis">{ergebnisse.length}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="am-symbol" aria-label="Ergebnisse schließen" data-tipp="Schließen" onClick={schliessen}>✕</button>
        </div>
        <ErgebnisListe ergebnisse={ergebnisse} alleOffen loeschen={loeschen} />
      </div>
    </div>
  );
}
