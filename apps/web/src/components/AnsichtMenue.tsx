import type { FilterCriterion } from '@gg/domain';
import { ActionIcon, Box, Group, Menu, SegmentedControl } from '@mantine/core';
import { IconLayoutColumns, IconLayoutRows, IconMenu2 } from '@tabler/icons-react';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { Layout } from '../lib/ansicht.ts';
import { useFilterMenue } from './GespeicherteFilterLeiste.tsx';

/** Platz in der Kopfzeile der App (links von „Exposé importieren“), in den eine Seite ihr Menü setzt. */
export const KopfPlatzKontext = createContext<HTMLElement | null>(null);

/**
 * Menü „Ansicht und Filter“ in der Kopfzeile: zuerst die zwei Knöpfe zum Teilen (Liste und Detail neben- oder
 * untereinander), darunter die gespeicherten Filter und ihre Verwaltung. Die Seite bestimmt den Inhalt, der Knopf
 * steht im Kopf der App — so braucht die Seite keine eigene Zeile dafür.
 */
export function AnsichtMenue({ ansichtLabel, layout, setLayout, filterModul, aktuelleKriterien }: {
  ansichtLabel: string; layout: Layout; setLayout: (l: Layout) => void;
  filterModul: Parameters<typeof useFilterMenue>[0]; aktuelleKriterien?: FilterCriterion[];
}) {
  const platz = useContext(KopfPlatzKontext);
  const { aktiverFilter, hinweis, punkte, dialog } = useFilterMenue(filterModul, aktuelleKriterien);
  if (!platz) return null;
  return createPortal(
    <Group gap={6} wrap="nowrap">
      <Box visibleFrom="md">{hinweis}</Box>
      <Menu position="bottom-end" width={260} withinPortal shadow="md">
        <Menu.Target>
          <ActionIcon variant={aktiverFilter ? 'light' : 'default'} size="lg" aria-label="Ansicht und Filter" title="Ansicht und Filter">
            <IconMenu2 size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Ansicht</Menu.Label>
          <Box px="sm" pb={6}>
            <SegmentedControl
              fullWidth
              aria-label={ansichtLabel}
              value={layout}
              onChange={(v) => setLayout(v as Layout)}
              data={[
                { value: 'nebeneinander', label: <IconLayoutColumns size={16} aria-label="nebeneinander" /> },
                { value: 'untereinander', label: <IconLayoutRows size={16} aria-label="untereinander" /> },
              ]}
            />
          </Box>
          <Menu.Divider />
          {punkte}
        </Menu.Dropdown>
      </Menu>
      {dialog}
    </Group>,
    platz,
  );
}
