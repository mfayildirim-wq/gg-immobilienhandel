import { Alert, Button, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { IconClipboardList, IconPlus, IconTrash } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useVertriebslisteAnlegen, useVertriebslisteLoeschen, useVertriebslisten } from '../lib/api.ts';

/** vlRenderList: alle Deals mit Status „Angekauft“, je höchstens eine Vertriebsliste. */
export function VertriebslistenSeite() {
  const { data: deals = [], isLoading } = useVertriebslisten();
  const anlegen = useVertriebslisteAnlegen();
  const loeschen = useVertriebslisteLoeschen();
  const navigate = useNavigate();
  const oeffnen = (id: string) => navigate({ to: '/vertriebslisten/$id', params: { id } });
  if (isLoading) return <Text c="dimmed">Lädt …</Text>;
  if (deals.length === 0) {
    return (
      <Paper withBorder p="xl" ta="center" c="dimmed" maw={600}>
        <Text fz={32}>📋</Text>
        <Text>Noch keine angekauften Deals</Text>
        <Text size="xs">Vertriebslisten können nur für Deals mit Status „Angekauft“ erstellt werden.</Text>
      </Paper>
    );
  }
  const mitListe = deals.filter((d) => d.liste).length;
  return (
    <Stack maw={1100}>
      <Title order={2}>🏗️ Vertriebslisten ({mitListe} / {deals.length} Deals)</Title>
      {(anlegen.error || loeschen.error) && <Alert color="red">{(anlegen.error ?? loeschen.error)!.message}</Alert>}
      <Table striped aria-label="Vertriebslisten">
        <Table.Thead><Table.Tr><Table.Th>Deal</Table.Th><Table.Th>Einheiten</Table.Th><Table.Th>Vertriebsliste</Table.Th><Table.Th ta="right">Aktionen</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {deals.map((d) => (
            <Table.Tr key={d.dealId} data-deal={d.dealId}>
              <Table.Td><Text fw={700} size="sm">{d.adresse}</Text>{d.stadt && <Text size="xs" c="dimmed">{d.stadt}</Text>}</Table.Td>
              <Table.Td>{d.einheiten}</Table.Td>
              <Table.Td>{d.liste ? <Text size="sm" c="teal">✓ {d.liste.zeilen} Zeilen · zuletzt {d.liste.zuletzt}</Text> : <Text c="dimmed">–</Text>}</Table.Td>
              <Table.Td>
                <Group justify="flex-end" gap="xs">
                  {d.liste ? <>
                    <Button size="xs" variant="default" leftSection={<IconClipboardList size={14} />} onClick={() => oeffnen(d.liste!.id)}>Öffnen</Button>
                    <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => {
                      if (window.confirm(`Vertriebsliste mit ${d.liste!.zeilen} Zeilen wirklich löschen?\n\nSie liegt danach im Papierkorb.`)) loeschen.mutate(d.liste!.id);
                    }}>Löschen</Button>
                  </> : d.einheiten > 0
                    ? <Button size="xs" leftSection={<IconPlus size={14} />} loading={anlegen.isPending} onClick={() => anlegen.mutate(d.dealId, { onSuccess: (vl) => oeffnen(vl.id) })}>Vertriebsliste anlegen</Button>
                    : <Text size="xs" c="dimmed">Keine Einheiten im Deal</Text>}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
