/**
 * AgentMode in gg-immo: die Brücke zwischen `@cosai/agentmode` und dieser App — Anmeldung, Router, Stil, Verfügbarkeit.
 * Die Oberflächenkarte (Ziele) liegt in `@gg/api-contract`; die Marken stehen als `data-agent` in den Komponenten.
 */
import '@cosai/agentmode/agentmode.css';
import { AgentMode, type SprechkreisStil } from '@cosai/agentmode';
import { OBERFLAECHENKARTE } from '@gg/api-contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { agentAnfrage } from '../lib/api.ts';
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
      schliessen={schliessen}
      // Nach einem Klick des Agenten die Daten neu laden — wie nach einem Klick des Nutzers
      onSteuerung={(s) => { if (s.art === 'sende') void qc.invalidateQueries(); }}
    >
      {children}
    </AgentMode>
    </div>
  );
}
