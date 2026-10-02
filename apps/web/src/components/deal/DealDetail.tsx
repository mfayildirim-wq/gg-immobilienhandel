import { Alert, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { Reiterleiste } from '../Reiterleiste.tsx';
import { IconBriefcase, IconBuildingBank, IconCalculator, IconFolder, IconInfoCircle, IconMessages } from '@tabler/icons-react';
import { useState } from 'react';
import { useDealDetail } from '../../lib/api.ts';
import { useEinstellung } from '../../lib/ansicht.ts';
import { darfVerlassen } from '../../lib/ungespeichert.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { DateiLeiste, DealDateien } from './DealDateien.tsx';
import { DealKalkulation } from './DealKalkulation.tsx';
import { DealKommunikation } from './DealKommunikation.tsx';
import { DealKundenkalkulationen } from './DealKundenkalkulationen.tsx';
import { DealPraesentation } from './DealPraesentation.tsx';
import { DealUebersicht } from './DealUebersicht.tsx';
import css from './DealDetail.module.css';

const REITER = ['uebersicht', 'kommunikation', 'kalkulation', 'dateien', 'kundenkalkulation', 'praesentation'] as const;
type Reiter = (typeof REITER)[number];

/**
 * `start`: der Reiter, mit dem das Detail zuerst öffnet — auf der Ankaufseite „Kommunikation“ (dort geht es ums
 * Nachfassen), auf der Deal-Liste die Übersicht. Der zuletzt gewählte Reiter wird je Kontext gemerkt.
 */
export function DealDetail({ id, start = 'uebersicht' }: { id: string; start?: Reiter }) {
  const { data: deal, isLoading, error } = useDealDetail(id);
  const [reiter, setReiter] = useEinstellung<Reiter>(`deal.reiter.${start}`, REITER, start);
  // Platz unter der Reiterleiste, in den der aktive Reiter seine Knopfleiste setzt (Kalkulation: Varianten, Verwerfen, Speichern)
  const [leistenPlatz, setLeistenPlatz] = useState<HTMLDivElement | null>(null);

  if (isLoading) return <Loader size="sm" />;
  if (error || !deal) return <Alert color="red">{error?.message ?? 'Deal nicht gefunden'}</Alert>;

  return (
    <Stack gap="sm">
      <Tabs value={reiter} onChange={(v) => v && v !== reiter && darfVerlassen() && setReiter(v as Reiter)} keepMounted={false}>
        <div className={css.fest}>
          {/* Adresse, Stadt und Makler in einer Zeile — bleibt mit den Reitern stehen, damit klar ist, in welchem Deal man arbeitet */}
          <Group justify="space-between" wrap="nowrap" gap="sm" pb={4}>
            <Group gap="sm" wrap="nowrap" align="baseline" style={{ minWidth: 0 }}>
              <Title order={3} className={css.adresse}>{deal.objekt.titel}</Title>
              <Text c="dimmed" size="sm" truncate style={{ flex: '1 1 0', minWidth: 0 }}>
                {deal.objekt.stadt ?? ''} · Makler: {deal.makler?.name ?? '– (ohne Makler)'}
              </Text>
            </Group>
            <div style={{ flexShrink: 0 }}>
              <StatusBadge status={deal.status} />
            </div>
          </Group>
          <Reiterleiste>
            <Tabs.Tab value="uebersicht" leftSection={<IconInfoCircle size={16} />}>
              Übersicht
            </Tabs.Tab>
            <Tabs.Tab value="kommunikation" leftSection={<IconMessages size={16} />}>
              Kommunikation
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
          </Reiterleiste>
          <div ref={setLeistenPlatz} />
        </div>
        <Tabs.Panel value="uebersicht" pt="md">
          <DateiLeiste dealId={deal.id} />
          <DealUebersicht deal={deal} />
        </Tabs.Panel>
        <Tabs.Panel value="kommunikation" pt="md">
          <DealKommunikation deal={deal} />
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
          <DealKalkulation key={`${deal.id}:${deal.version}`} deal={deal} leistenPlatz={leistenPlatz} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
