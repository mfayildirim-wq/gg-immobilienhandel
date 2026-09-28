/**
 * AgentMode in gg-immo: die Brücke zwischen `@cosai/agentmode` und dieser App — Anmeldung, Router, Stil, Verfügbarkeit.
 * Die Oberflächenkarte (Ziele) liegt in `@gg/api-contract`; die Marken stehen als `data-agent` in den Komponenten.
 */
import '@cosai/agentmode/agentmode.css';
import { AgentKnopf, AgentMode, FeldVorschlaege, Lernen, type SprechkreisStil } from '@cosai/agentmode';
import { OBERFLAECHENKARTE } from '@gg/api-contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { agentAnfrage, transkribieren } from '../lib/api.ts';
import { useEinstellung } from '../lib/ansicht.ts';

export const AGENT_STILE = ['kern', 'puls', 'orbit'] as const;

/** Ob die API ein Modell hat — ohne Modell zeigt die Oberfläche keinen AgentMode. */
export function useAgentVerfuegbar() {
  return useQuery({
    queryKey: ['agent', 'stand'],
    queryFn: async () => (await agentAnfrage('/api/agent/stand')).ok,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAgentStil() {
  return useEinstellung<SprechkreisStil>('agent.stil', AGENT_STILE, 'kern');
}

export function useAgentAktiv() {
  return useEinstellung('agent.aktiv', ['an', 'aus'] as const, 'aus');
}

/** `navigiere nav.<seite>` → Pfad aus der Oberflächenkarte */
export function useZielNavigation() {
  const navigate = useNavigate();
  return useCallback(async (ziel: string) => {
    const eintrag = OBERFLAECHENKARTE.find((z) => z.ziel === ziel);
    if (!eintrag?.seite) throw new Error(`Kein Seitenziel: ${ziel}`);
    await navigate({ to: eintrag.seite });
  }, [navigate]);
}

/** Der AgentMode als Overlay über der App (im AppRahmen) oder als eigene Seite. */
export function AgentModeHost({ modus, children, schliessen }: { modus: 'overlay' | 'seite'; children?: ReactNode; schliessen?: () => void }) {
  const [stil, setStil] = useAgentStil();
  const navigiere = useZielNavigation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ort = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div style={{ '--am-oben': modus === 'overlay' ? '56px' : '0px' } as CSSProperties}>
    <AgentMode
      api="/api/agent"
      anfrage={agentAnfrage}
      modus={modus}
      navigiere={navigiere}
      ort={ort}
      stil={stil}
      onStil={setStil}
      schliessen={schliessen ?? (modus === 'seite' ? () => { if (window.history.length > 1) window.history.back(); else void navigate({ to: '/' }); } : undefined)}
      // Nach einem Klick des Agenten die Daten neu laden — wie nach einem Klick des Nutzers
      onSteuerung={(s) => { if (s.art === 'sende') void qc.invalidateQueries(); }}
      // Firefox kennt keine eingebaute Spracherkennung: dort nimmt das Mikrofon auf, Whisper macht Text daraus
      transkribieren={transkribieren}
      einstellungen={() => void navigate({ to: '/einstellungen/agentmode' as '/' })}
      // Unter dem Kreis: im Overlay ↗ zum Agent-Dialog; auf der Seite ✕ zurück, woher man kam
      zurSeite={modus === 'overlay' ? () => void navigate({ to: '/agent' as '/' }) : undefined}
    >
      {children}
    </AgentMode>
    </div>
  );
}

/** Overlay zu: kleiner roter Agent oben in der Mitte — ein Klick öffnet das Overlay (Wunsch des Auftraggebers, 28.09.) */
export function AgentOeffnen({ oeffnen }: { oeffnen: () => void }) {
  const [stil] = useAgentStil();
  return <AgentKnopf oeffnen={oeffnen} stil={stil} groesse={40} />;
}

/** Lernen auch ohne Overlay (Entscheidung 26.09.): gespeicherte Eingaben werden zu Formulierungen und Episoden. */
export function AgentLernen() {
  const verfuegbar = useAgentVerfuegbar().data === true;
  return verfuegbar ? <Lernen api="/api/agent" anfrage={agentAnfrage} /> : null;
}

/** Die häufigsten Formulierungen des Nutzers an einem Feld — ein Klick füllt, abschicken tut der Nutzer. */
export function AgentVorschlaege({ ziel, waehlen }: { ziel: string; waehlen: (text: string) => void }) {
  const verfuegbar = useAgentVerfuegbar().data === true;
  return verfuegbar ? <FeldVorschlaege api="/api/agent" anfrage={agentAnfrage} ziel={ziel} waehlen={waehlen} /> : null;
}
