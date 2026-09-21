import { ActionIcon, Alert, Button, Group, Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useDdVorlage, useDdVorlageSpeichern } from '../lib/api.ts';

/** 📋 DD-Dokumentenliste (alt: Einstellungen → DD): welche Unterlagen gebraucht werden und woher sie kommen. */
export function DdEinstellungen() {
  const { data, isLoading } = useDdVorlage();
  const speichern = useDdVorlageSpeichern();
  const [zeilen, setZeilen] = useState<{ dokument: string; quelle: string }[]>([]);
  useEffect(() => { if (data) setZeilen(data.zeilen); }, [data]);
  const aendern = (i: number, feld: 'dokument' | 'quelle', wert: string) => setZeilen(zeilen.map((z, n) => (n === i ? { ...z, [feld]: wert } : z)));

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>📋 DD-Dokumentenliste</Title>
        <Text size="xs" c="dimmed">Die Unterlagen für die Prüfung eines Objekts, in der Reihenfolge, in der sie angefordert werden. Positionen ohne Dokument entfallen beim Speichern.</Text>
      </div>
      {isLoading && <Loader size="sm" />}
      {data && !data.gespeichert && <Alert color="gray" py={4}>Auslieferungszustand — noch keine eigene Liste gespeichert.</Alert>}
      <Table verticalSpacing={2} aria-label="DD-Dokumentenliste">
        <Table.Thead><Table.Tr><Table.Th w={36}>#</Table.Th><Table.Th>Dokument</Table.Th><Table.Th w={220}>Quelle</Table.Th><Table.Th w={36} /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {zeilen.map((z, i) => (
            // eslint-disable-next-line react/no-array-index-key -- die Position IST die Kennung der Zeile
            <Table.Tr key={i}>
              <Table.Td><Text size="xs" c="dimmed">{i + 1}</Text></Table.Td>
              <Table.Td><TextInput size="xs" aria-label={`Dokument ${i + 1}`} value={z.dokument} onChange={(e) => aendern(i, 'dokument', e.currentTarget.value)} /></Table.Td>
              <Table.Td><TextInput size="xs" aria-label={`Quelle ${i + 1}`} value={z.quelle} onChange={(e) => aendern(i, 'quelle', e.currentTarget.value)} /></Table.Td>
              <Table.Td><ActionIcon variant="subtle" color="red" size="sm" aria-label={`Position ${i + 1} entfernen`} onClick={() => setZeilen(zeilen.filter((_, n) => n !== i))}><IconX size={14} /></ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text fz={11} c="dimmed" data-dd-anzahl>{zeilen.length} Positionen</Text>
      {speichern.error && <Alert color="red">{speichern.error.message}</Alert>}
      {speichern.data && <Alert color="teal" py={4}>✅ DD-Dokumentenliste gespeichert ({speichern.data.zeilen.length} Positionen)</Alert>}
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => setZeilen([...zeilen, { dokument: '', quelle: '—' }])}>+ Position</Button>
        <Button size="xs" variant="default" color="orange"
          onClick={() => window.confirm('Liste auf den Auslieferungszustand zurücksetzen?') && speichern.mutate([])}>↺ Zurücksetzen</Button>
        <Button size="xs" loading={speichern.isPending} onClick={() => speichern.mutate(zeilen)}>Speichern</Button>
      </Group>
    </Stack>
  );
}
