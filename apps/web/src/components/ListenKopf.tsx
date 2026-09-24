import { Badge, Group, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface Kennzahl { wert: string; label: string; anzahl: number; farbe?: string; klickbar?: boolean }

/**
 * Statusleiste (statsbar): Zahl je Status, Klick setzt den Filter wie ein Chip. Seit dem 23.09.2026 als Zahl-Pillen in
 * der Kopfzeile hinter dem Seitentitel — dieselbe Form wie „Nächste Kontakte“ auf der Ankaufseite, statt großer Kästen.
 */
export function Zaehlerleiste({ kennzahlen, waehlen }: { kennzahlen: Kennzahl[]; waehlen: (wert: string) => void }) {
  return (
    // display: contents — die Zähler stehen als einzelne Kinder in der Kopfzeile und brechen einzeln um, nicht als Block
    <Group aria-label="Zähler" style={{ display: 'contents' }}>
      {kennzahlen.map((k) => (
        <UnstyledButton key={k.label} onClick={() => k.klickbar !== false && waehlen(k.wert)} data-zaehler={k.label} style={{ cursor: k.klickbar === false ? 'default' : 'pointer' }}>
          <Group gap={4} wrap="nowrap">
            <Badge size="md" color={k.farbe ?? 'gray'} data-anzahl>{k.anzahl}</Badge>
            <Text size="xs" c="dimmed">{k.label}</Text>
          </Group>
        </UnstyledButton>
      ))}
    </Group>
  );
}

/** Filterleiste (filterbar): Chips + Suchfeld. */
export function Chipleiste({ chips, aktiv, waehlen, suche, setSuche, platzhalter, rechts }: {
  chips: { wert: string; label: string }[]; aktiv: string; waehlen: (wert: string) => void;
  suche: string; setSuche: (s: string) => void; platzhalter: string; rechts?: ReactNode;
}) {
  return (
    <Group gap={6} wrap="wrap" aria-label="Filter">
      {chips.map((c) => (
        <UnstyledButton key={c.wert} onClick={() => waehlen(c.wert)} aria-pressed={aktiv === c.wert}
          style={{ padding: '3px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--mantine-color-default-border)',
            background: aktiv === c.wert ? 'var(--mantine-primary-color-filled)' : undefined, color: aktiv === c.wert ? 'white' : undefined }}>
          {c.label}
        </UnstyledButton>
      ))}
      <TextInput type="search" size="xs" aria-label="Suchen" placeholder={platzhalter} leftSection={<IconSearch size={14} />} value={suche}
        onChange={(e) => setSuche(e.currentTarget.value)} style={{ flex: 1, minWidth: 180 }} />
      {rechts}
    </Group>
  );
}
