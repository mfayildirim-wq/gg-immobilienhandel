/**
 * Der Agent, wenn das Overlay zu ist: ein kleiner roter Sprechkreis oben in der Mitte. Ein Klick öffnet das Overlay.
 * Der Host entscheidet, wann er ihn zeigt (Overlay aus) — Lage und Aussehen liefert CoSAi, in jeder App gleich.
 */
import { useMemo } from 'react';
import { saatAus } from './konstellation.ts';
import { Sprechkreis, type SprechkreisStil } from './Sprechkreis.tsx';

export interface AgentKnopfProps {
  oeffnen: () => void;
  stil?: SprechkreisStil;
  farbe?: string;
  groesse?: number;
  titel?: string;
}

export function AgentKnopf({ oeffnen, stil = 'kern', farbe = '#e03131', groesse = 40, titel = 'Agent öffnen' }: AgentKnopfProps) {
  const saat = useMemo(() => saatAus('agent'), []);
  return (
    <button type="button" className="am-agentknopf" aria-label={titel} data-tipp={titel} data-agentknopf onClick={oeffnen}>
      <Sprechkreis stil={stil} zustand="ruhig" groesse={groesse} farbe={farbe} saat={saat} titel="Agent" />
    </button>
  );
}
