import type { DealDetail } from '@gg/api-contract';
import { SLIDE_TYPES } from '@gg/domain';
import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconBolt, IconPlus, IconPresentation } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useDealPraesentation, usePraesentationAnlegen } from '../../lib/api.ts';

/** Reiter „Bank-Präsentation“: höchstens eine je Deal (wie alt). Anlegen als Standard-IVT-Pitch oder leer, bearbeitet wird im Editor. */
export function DealPraesentation({ deal }: { deal: DealDetail }) {
  const { data, isLoading } = useDealPraesentation(deal.id);
  const anlegen = usePraesentationAnlegen(deal.id);
  const navigate = useNavigate();
  const oeffnen = (id: string) => navigate({ to: '/praesentationen/$id', params: { id } });
  if (isLoading) return <Text c="dimmed">Lädt …</Text>;
  const p = data?.praesentation;

  if (!p) {
    return (
      <Paper withBorder p="lg" maw={560} mx="auto" ta="center">
        <Title order={4}>🏦 Noch keine Bank-Präsentation</Title>
        <Text c="dimmed" size="sm" my="md">
          Erstelle eine Präsentation für die Finanzierungsanfrage. Du kannst mit dem Standard-IVT-Pitch starten (alle Standard-Slides) oder leer beginnen und Slides einzeln hinzufügen.
        </Text>
        {anlegen.error && <Alert color="red" mb="sm">{anlegen.error.message}</Alert>}
        <Group justify="center">
          <Button leftSection={<IconBolt size={16} />} loading={anlegen.isPending} onClick={() => anlegen.mutate('standard', { onSuccess: (n) => oeffnen(n.id) })}>Standard-IVT-Pitch anlegen</Button>
          <Button variant="default" leftSection={<IconPlus size={16} />} disabled={anlegen.isPending} onClick={() => anlegen.mutate('leer', { onSuccess: (n) => oeffnen(n.id) })}>Leer beginnen</Button>
        </Group>
      </Paper>
    );
  }
  const sichtbar = p.slides.filter((s) => s.visible);
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Text fw={600}>🏦 {p.bankName || 'Bank-Präsentation (ohne Bankname)'}</Text>
          <Text size="sm" c="dimmed">{p.slides.length} Slides, davon {sichtbar.length} im Export</Text>
        </div>
        <Button leftSection={<IconPresentation size={16} />} onClick={() => oeffnen(p.id)}>Editor öffnen</Button>
      </Group>
      <Text size="sm" c="dimmed">{sichtbar.map((s) => SLIDE_TYPES.find((m) => m.typ === s.typ)?.label ?? s.typ).join(' · ')}</Text>
    </Stack>
  );
}
