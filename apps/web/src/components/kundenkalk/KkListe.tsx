import type { KundenkalkulationEintrag } from '@gg/api-contract';
import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconCopy, IconTrash } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useKundenkalkDuplizieren, useKundenkalkLoeschen } from '../../lib/api.ts';
import { euro, prozent } from '../../lib/format.ts';

/** Zeile einer Kundenkalkulation mit Kennzahlen (Kaufpreis, Cashflow Jahr 1 n. St., Vermögenszuwachs, IRR). */
export function KkZeile({ k }: { k: KundenkalkulationEintrag }) {
  const navigate = useNavigate();
  const kopieren = useKundenkalkDuplizieren();
  const loeschen = useKundenkalkLoeschen();
  const kennzahl = (label: string, wert: string, farbe?: string) => (
    <div style={{ textAlign: 'right', minWidth: 96 }}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm" c={farbe} style={{ fontVariantNumeric: 'tabular-nums' }}>{wert}</Text>
    </div>
  );
  return (
    <Paper withBorder p="xs" style={{ cursor: 'pointer' }} onClick={() => navigate({ to: '/kundenkalkulationen/$id', params: { id: k.id } })} aria-label={`Kundenkalkulation ${k.name}`}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="lg">{k.scope === 'aufteiler' ? '🏠' : '🏢'}</Text>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} truncate>{k.name}</Text>
            <Text size="xs" c="dimmed">
              {k.scope === 'aufteiler' ? (k.einheitLage ? `🏠 ${k.einheitLage}` : '🏠 Einzeleinheit') : '🏢 Global'} · geändert {new Date(k.updatedAt.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleDateString('de-DE')}
            </Text>
          </div>
        </Group>
        <Group gap="md" wrap="nowrap" visibleFrom="sm">
          {kennzahl('Kaufpreis', euro(k.kaufpreis))}
          {kennzahl('CF n. St. J1', euro(k.cashflowJahr1, '0 €'), k.cashflowJahr1 < 0 ? 'red' : 'green')}
          {kennzahl('Verm.zuwachs', euro(k.vermoegenszuwachs), 'green')}
          {kennzahl('IRR p. a.', k.irr === null ? '–' : prozent(k.irr * 100), 'teal')}
        </Group>
        <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
          <Tooltip label="Duplizieren">
            <ActionIcon variant="subtle" aria-label="Duplizieren" loading={kopieren.isPending} onClick={() => kopieren.mutate(k.id, { onSuccess: (neu) => navigate({ to: '/kundenkalkulationen/$id', params: { id: neu.id } }) })}>
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="In den Papierkorb">
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Löschen"
              onClick={() => { if (confirm(`Kundenkalkulation „${k.name}“ wirklich löschen?\n\nSie liegt danach im Papierkorb.`)) loeschen.mutate(k.id); }}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
