import { Badge } from '@mantine/core';
import type { DealStatus } from '@gg/domain';

const FARBE: Record<DealStatus, string> = {
  'In Prüfung': 'blue',
  'Angebot abgegeben': 'violet',
  'Über Zeit nachfassen': 'yellow',
  'Closing Path': 'teal',
  Angekauft: 'green',
  Archiv: 'gray',
};

/** Auch für Objekte: deren Status ist freier Text (Altbestand), unbekannt bleibt grau. */
export function StatusBadge({ status }: { status: DealStatus | string }) {
  return (
    <Badge color={FARBE[status as DealStatus] ?? 'gray'} variant="light">
      {status}
    </Badge>
  );
}
