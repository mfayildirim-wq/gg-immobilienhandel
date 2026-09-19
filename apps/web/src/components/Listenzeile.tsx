import { Group, Text, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';
import css from './Listenzeile.module.css';

/**
 * Eine Zeile der schmalen Liste in der Ansicht „nebeneinander" (Deals, Objekte, Makler).
 * Überall gleich: Titel, eine graue Zeile darunter, rechts ein Abzeichen — mit Hover und sichtbarer Auswahl.
 */
export function Listenzeile({
  titel,
  unterzeile,
  rechts,
  aktiv,
  waehlen,
  ...rest
}: {
  titel: ReactNode;
  unterzeile?: ReactNode;
  rechts?: ReactNode;
  aktiv: boolean;
  waehlen: () => void;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <UnstyledButton className={css.zeile} p="xs" onClick={waehlen} aria-current={aktiv} data-aktiv={aktiv || undefined} {...rest}>
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={600} truncate>{titel}</Text>
          {unterzeile && <Text size="xs" c="dimmed" truncate>{unterzeile}</Text>}
        </div>
        {rechts}
      </Group>
    </UnstyledButton>
  );
}
