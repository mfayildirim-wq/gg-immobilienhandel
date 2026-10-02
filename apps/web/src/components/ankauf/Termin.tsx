import { isoPlusTage } from '@gg/domain';
import { Button, Group, TextInput } from '@mantine/core';

const SCHNELL = [['1W', 7], ['1M', 30], ['3M', 90], ['6M', 180]] as const;

/**
 * Datumsfeld + Schnellwahl 1W/1M/3M/6M (wie die Karten der alten App). `kompakt`: schmales Datumsfeld fester Breite,
 * damit auf der Deal-Karte auch „Erledigt“ in dieselbe Zeile passt.
 */
export function TerminWahl({ wert, heute, setzen, label, kompakt }: { wert: string | null; heute: string; setzen: (iso: string | null) => void; label: string; kompakt?: boolean }) {
  return (
    <Group gap={4} wrap="nowrap">
      <TextInput size="xs" type="date" aria-label={label} value={wert ?? ''} onChange={(e) => setzen(e.currentTarget.value || null)}
        style={kompakt ? { width: 124, flexShrink: 0 } : { flex: 1, minWidth: 120 }} styles={kompakt ? { input: { paddingInline: 6 } } : undefined} />
      {SCHNELL.map(([text, tage]) => (
        <Button key={text} size="compact-xs" variant="default" onClick={() => setzen(isoPlusTage(heute, tage))} aria-label={`${label} in ${text}`}>
          {text}
        </Button>
      ))}
    </Group>
  );
}

export const FAELLIG_FARBE = { heute: 'red', ueberfaellig: 'orange', woche: 'green' } as const;
export const ABSCHNITTE = [
  { klasse: 'heute', titel: 'Heute kontaktieren' },
  { klasse: 'ueberfaellig', titel: 'Überfällig' },
  { klasse: 'woche', titel: 'Diese Woche' },
] as const;
