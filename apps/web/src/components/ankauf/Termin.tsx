import { isoPlusTage, TERMIN_GEAENDERT_HINWEIS } from '@gg/domain';
import { Button, Group, TextInput } from '@mantine/core';

const SCHNELL = [['1W', 7], ['1M', 30], ['3M', 90], ['6M', 180]] as const;

/**
 * Datumsfeld + Schnellwahl 1W/1M/3M/6M (wie die Karten der alten App). `kompakt`: schmales Datumsfeld fester Breite,
 * damit auf der Deal-Karte auch „Erledigt“ in dieselbe Zeile passt.
 * `geaendert` (08.10.2026, Kundenwunsch): Die Karte steht nach einem neuen Termin bis „Erledigt“ — als Erinnerung daran
 * bleibt der gedrückte Knopf rot gefüllt (der Knopf, dessen Datum dem gespeicherten Termin entspricht) und das Datum ist
 * rot umrandet; bei einem von Hand eingetragenen Datum ist nur das Datum rot.
 */
export function TerminWahl({ wert, heute, setzen, label, kompakt, geaendert }: {
  wert: string | null; heute: string; setzen: (iso: string | null) => void; label: string; kompakt?: boolean; geaendert?: boolean;
}) {
  const gedrueckt = (tage: number) => !!geaendert && wert === isoPlusTage(heute, tage);
  return (
    <Group gap={4} wrap="nowrap">
      <TextInput size="xs" type="date" aria-label={label} value={wert ?? ''} onChange={(e) => setzen(e.currentTarget.value || null)}
        title={geaendert ? TERMIN_GEAENDERT_HINWEIS : undefined} data-geaendert={geaendert || undefined}
        style={kompakt ? { width: 124, flexShrink: 0 } : { flex: 1, minWidth: 120 }}
        styles={{ input: { ...(kompakt ? { paddingInline: 6 } : {}), ...(geaendert ? { borderColor: 'var(--mantine-color-red-6)', borderWidth: 2 } : {}) } }} />
      {SCHNELL.map(([text, tage]) => (
        <Button key={text} size="compact-xs" variant={gedrueckt(tage) ? 'filled' : 'default'} color={gedrueckt(tage) ? 'red' : undefined}
          aria-pressed={gedrueckt(tage) || undefined} title={gedrueckt(tage) ? TERMIN_GEAENDERT_HINWEIS : undefined}
          onClick={() => setzen(isoPlusTage(heute, tage))} aria-label={`${label} in ${text}`}>
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
