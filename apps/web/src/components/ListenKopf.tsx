import { Badge, Group, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface Kennzahl { wert: string; label: string; anzahl: number; farbe?: string; klickbar?: boolean }

/**
 * Statusleiste (statsbar): Zahl je Status, Klick setzt den Filter wie ein Chip. Seit dem 02.10.2026 steht sie fest über
 * der Liste (`listeKopf` der `GeteilteAnsicht`) — nur die Zahl im farbigen Rahmen, ohne Füllung; der Name des Status
 * erscheint beim Überfahren. Dieselbe Form wie die Zahlen über der Ankauf-Liste.
 */
export function Zaehlerleiste({ kennzahlen, waehlen }: { kennzahlen: Kennzahl[]; waehlen: (wert: string) => void }) {
  return (
    <Group gap={6} wrap="wrap" aria-label="Zähler">
      {kennzahlen.map((k) => (
        <Tooltip key={k.label} label={k.label}>
          <UnstyledButton onClick={() => k.klickbar !== false && waehlen(k.wert)} data-zaehler={k.label} aria-label={`${k.anzahl} ${k.label}`}
            style={{ cursor: k.klickbar === false ? 'default' : 'pointer', display: 'inline-flex' }}>
            <Badge size="lg" variant="outline" color={k.farbe ?? 'gray'} data-anzahl style={{ cursor: 'inherit' }}>{k.anzahl}</Badge>
          </UnstyledButton>
        </Tooltip>
      ))}
    </Group>
  );
}

/** Filterleiste (filterbar): Chips + Suchfeld; `rechts` steht direkt neben dem Suchfeld (z. B. „Neuer Deal“). */
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
      {/* Suchfeld und der Knopf rechts davon bleiben zusammen in einer Zeile, auch wenn die Chips umbrechen */}
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 180 }}>
        <TextInput type="search" size="xs" aria-label="Suchen" placeholder={platzhalter} leftSection={<IconSearch size={14} />} value={suche}
          onChange={(e) => setSuche(e.currentTarget.value)} style={{ flex: 1, minWidth: 120 }} />
        {rechts}
      </Group>
    </Group>
  );
}
