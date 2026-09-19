import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { KkZeile } from '../components/kundenkalk/KkListe.tsx';
import { useKundenkalkulationen } from '../lib/api.ts';

/** Alle Kundenkalkulationen, gruppiert nach Deal (zuletzt geänderter Deal zuerst). */
export function KundenkalkulationenSeite() {
  const { data = [], isLoading, error } = useKundenkalkulationen();
  const navigate = useNavigate();
  const nachDeal = new Map<string, typeof data>();
  for (const k of data) nachDeal.set(k.dealId, [...(nachDeal.get(k.dealId) ?? []), k]);
  const gruppen = [...nachDeal.entries()]
    .map(([dealId, kalks]) => ({ dealId, kalks, zuletzt: kalks.reduce((m, k) => (k.updatedAt > m ? k.updatedAt : m), '') }))
    .sort((a, b) => b.zuletzt.localeCompare(a.zuletzt));

  return (
    <Stack maw={1100}>
      <Group justify="space-between" align="baseline">
        <Title order={2}>💼 Kundenkalkulationen</Title>
        <Text size="sm" c="dimmed">{data.length} Kalkulation{data.length === 1 ? '' : 'en'} in {gruppen.length} Deal{gruppen.length === 1 ? '' : 's'}</Text>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Text c="dimmed">Lädt …</Text>}
      {!isLoading && data.length === 0 && (
        <Stack align="center" py={60} gap={4}>
          <Text size="xl">📋</Text>
          <Text>Noch keine Kundenkalkulation angelegt.</Text>
          <Text size="sm" c="dimmed">Deal öffnen → Reiter „Kundenkalkulation“ → Globalverkauf oder Aufteiler</Text>
        </Stack>
      )}
      {gruppen.map((g) => (
        <Paper key={g.dealId} withBorder p="sm" component="section" aria-label={g.kalks[0]!.deal.titel}>
          <Group justify="space-between" mb="xs">
            <div>
              <Text fw={600}>{g.kalks[0]!.deal.titel}</Text>
              <Group gap={6}><StatusBadge status={g.kalks[0]!.deal.status} /><Text size="xs" c="dimmed">{g.kalks.length} Kalkulation{g.kalks.length === 1 ? '' : 'en'}</Text></Group>
            </div>
            <Button size="xs" variant="subtle" onClick={() => navigate({ to: '/deals', search: { deal: g.dealId } })}>→ Deal öffnen</Button>
          </Group>
          <Stack gap="xs">{g.kalks.map((k) => <KkZeile key={k.id} k={k} />)}</Stack>
        </Paper>
      ))}
    </Stack>
  );
}
