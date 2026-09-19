import { Alert, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconBriefcase, IconBuildingBank, IconCalculator, IconFolder, IconInfoCircle } from '@tabler/icons-react';
import { useDealDetail } from '../../lib/api.ts';
import { useEinstellung } from '../../lib/ansicht.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { DateiLeiste, DealDateien } from './DealDateien.tsx';
import { DealKalkulation } from './DealKalkulation.tsx';
import { DealKundenkalkulationen } from './DealKundenkalkulationen.tsx';
import { DealPraesentation } from './DealPraesentation.tsx';
import { DealUebersicht } from './DealUebersicht.tsx';

const REITER = ['uebersicht', 'kalkulation', 'dateien', 'kundenkalkulation', 'praesentation'] as const;
type Reiter = (typeof REITER)[number];

export function DealDetail({ id }: { id: string }) {
  const { data: deal, isLoading, error } = useDealDetail(id);
  const [reiter, setReiter] = useEinstellung<Reiter>('deal.reiter', REITER, 'uebersicht');

  if (isLoading) return <Loader size="sm" />;
  if (error || !deal) return <Alert color="red">{error?.message ?? 'Deal nicht gefunden'}</Alert>;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Title order={3}>{deal.objekt.titel}</Title>
          <Text c="dimmed" size="sm">
            {deal.objekt.stadt ?? ''} · Makler: {deal.makler?.name ?? '– (ohne Makler)'}
          </Text>
        </div>
        <StatusBadge status={deal.status} />
      </Group>
      <Tabs value={reiter} onChange={(v) => v && setReiter(v as Reiter)} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="uebersicht" leftSection={<IconInfoCircle size={16} />}>
            Übersicht
          </Tabs.Tab>
          <Tabs.Tab value="kalkulation" leftSection={<IconCalculator size={16} />}>
            Kalkulation
          </Tabs.Tab>
          <Tabs.Tab value="dateien" leftSection={<IconFolder size={16} />}>
            Dateien
          </Tabs.Tab>
          <Tabs.Tab value="kundenkalkulation" leftSection={<IconBriefcase size={16} />}>
            Kundenkalkulation
          </Tabs.Tab>
          <Tabs.Tab value="praesentation" leftSection={<IconBuildingBank size={16} />}>
            Bank-Präsentation
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="uebersicht" pt="md">
          <DateiLeiste dealId={deal.id} />
          <DealUebersicht deal={deal} />
        </Tabs.Panel>
        <Tabs.Panel value="dateien" pt="md">
          <DealDateien dealId={deal.id} />
        </Tabs.Panel>
        <Tabs.Panel value="kundenkalkulation" pt="md">
          <DealKundenkalkulationen deal={deal} />
        </Tabs.Panel>
        <Tabs.Panel value="praesentation" pt="md">
          <DealPraesentation deal={deal} />
        </Tabs.Panel>
        <Tabs.Panel value="kalkulation" pt="md">
          <DateiLeiste dealId={deal.id} />
          <DealKalkulation key={`${deal.id}:${deal.version}`} deal={deal} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
