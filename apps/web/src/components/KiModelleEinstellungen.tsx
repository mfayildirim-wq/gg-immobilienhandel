import { KI_BEREICHE, KI_MODELLE, KI_MODELLWAHL_STANDARD, KI_STANDARD, type KiModellwahl } from '@gg/domain';
import { Alert, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useState } from 'react';
import { useKiModellwahl, useKiModellwahlSpeichern } from '../lib/api.ts';

const AUSWAHL = [
  { value: KI_STANDARD, label: 'Wie bisher (je Funktion fest)' },
  ...KI_MODELLE.map((m) => ({ value: m.id, label: `${m.label} · $ ${m.preis} je Mio. Token` })),
];

/** 🤖 KI-Modelle (Einstellungen): welches Claude-Modell jeder Bereich nutzt. „Wie bisher“ lässt die fest hinterlegten Modelle. */
export function KiModelleEinstellungen() {
  const { data, isLoading, error } = useKiModellwahl();
  if (error) return <Alert color="red">{error.message}</Alert>;
  if (isLoading || !data) return <Text c="dimmed">Lädt …</Text>;
  return <Formular key={JSON.stringify(data)} start={data} />;
}

function Formular({ start }: { start: KiModellwahl }) {
  const speichern = useKiModellwahlSpeichern();
  const [w, setW] = useState<KiModellwahl>(start);
  return (
    <Stack maw={900}>
      <Paper withBorder p="md" component="section" aria-label="KI-Modelle">
        <Group justify="space-between" mb="sm" align="flex-start">
          <div>
            <Title order={4}>🤖 KI-Modelle</Title>
            <Text size="sm" c="dimmed">
              Welches Claude-Modell jeder Bereich nutzt. Größere Modelle erfinden seltener etwas, kosten aber mehr.
              Die Kosten je Aufruf stehen unter Werkzeuge → KI-Kosten.
            </Text>
          </div>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={() => setW(KI_MODELLWAHL_STANDARD)}>Werkseinstellung</Button>
            <Button leftSection={<IconDeviceFloppy size={16} />} loading={speichern.isPending} onClick={() => speichern.mutate(w)}>Speichern</Button>
          </Group>
        </Group>
        {speichern.error && <Alert color="red" mb="sm">{speichern.error.message}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {KI_BEREICHE.map((b) => (
            <Select
              key={b.id}
              label={b.label}
              description={`${b.beschreibung} · bisher: ${b.bisher}`}
              data={AUSWAHL}
              value={w[b.id]}
              allowDeselect={false}
              onChange={(v) => v && setW({ ...w, [b.id]: v })}
            />
          ))}
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}
