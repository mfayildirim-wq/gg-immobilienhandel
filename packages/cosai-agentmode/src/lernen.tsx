/**
 * Lernen ohne Overlay: `Lernen` hängt immer in der App und meldet gespeicherte Eingaben an den Kern — daraus werden
 * Formulierungen und Episoden (sichtbar und löschbar in der Gedächtnis-Leiste). `FeldVorschlaege` zeigt die häufigsten
 * Formulierungen eines Ziels als Chips direkt am Feld; ein Klick füllt nur, abschicken tut der Nutzer.
 */
import { useCallback, useEffect, useState } from 'react';
import { beobachten, type Beobachtung } from './kanal.ts';

export type Anfrage = (pfad: string, init?: RequestInit) => Promise<Response>;

/** Das lokale Datum des Nutzers (nicht UTC) — der „Tag“ des Morgenvorschlags. */
export function heuteLokal(jetzt = new Date()): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`;
}

export function Lernen({ api, anfrage }: { api: string; anfrage: Anfrage }) {
  useEffect(() => beobachten((b: Beobachtung) => {
    if (b.art !== 'gespeichert') return;
    void anfrage(`${api}/ereignis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, kontext: b.kontext ?? {} }) }).catch(() => undefined);
  }), [anfrage, api]);
  return null;
}

export function FeldVorschlaege({ api, anfrage, ziel, waehlen, anzahl = 5 }: { api: string; anfrage: Anfrage; ziel: string; waehlen: (text: string) => void; anzahl?: number }) {
  const [liste, setListe] = useState<string[]>([]);
  const laden = useCallback(() => {
    anfrage(`${api}/vorschlaege?ziel=${encodeURIComponent(ziel)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { vorschlaege: string[] }).vorschlaege : []))
      .then((v) => setListe(v.slice(0, anzahl)))
      .catch(() => setListe([]));
  }, [anfrage, api, ziel, anzahl]);
  useEffect(laden, [laden]);
  // Nach dem Speichern an diesem Ziel neu laden — der Kern zählt asynchron mit, deshalb kurz warten
  useEffect(() => beobachten((b) => {
    if (b.art === 'gespeichert' && b.ziel === ziel) window.setTimeout(laden, 300);
  }), [laden, ziel]);
  if (!liste.length) return null;
  return (
    <div className="am-feldvorschlaege" role="group" aria-label="Vorschläge aus dem Gedächtnis">
      {liste.map((t) => (
        <button key={t} type="button" className="am-chip" data-art="vorschlag" title={t} onClick={() => waehlen(t)}>{t}</button>
      ))}
    </div>
  );
}
