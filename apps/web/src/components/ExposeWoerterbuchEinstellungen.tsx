import { GG_ZIELE } from '@gg/domain';
import { Alert, Button, Loader, Paper, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { useExposeBezeichnungen, useExposeBezeichnungLoeschen } from '../lib/api.ts';
import { zeitpunktDe } from '../lib/format.ts';

/** Exposé-Wörterbuch (gelernt): Bezeichnungen, die beim Zuordnen gemerkt wurden; Löschen nimmt die Zuordnung zurück. */
export function ExposeWoerterbuchEinstellungen() {
  const { data = [], isLoading, error } = useExposeBezeichnungen();
  const loeschen = useExposeBezeichnungLoeschen();
  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>Exposé-Wörterbuch (gelernt)</Title>
        <Text size="xs" c="dimmed">
          Beim Zuordnen einer Angabe (Prüfseite oder Reiter „Aus dem Exposé“) wird die Bezeichnung gemerkt und künftig automatisch diesem Feld zugeordnet.
        </Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {loeschen.error && <Alert color="red">{loeschen.error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {!isLoading && !data.length && <Text size="sm" c="dimmed" data-woerterbuch="leer">Noch nichts gelernt.</Text>}
      {data.length > 0 && (
        <Paper withBorder>
          <ScrollArea>
            <Table miw={640} verticalSpacing={4} horizontalSpacing={8} data-woerterbuch="liste">
              <Table.Thead><Table.Tr><Table.Th>Bezeichnung</Table.Th><Table.Th>Ziel</Table.Th><Table.Th>Anzahl</Table.Th><Table.Th>Zuletzt</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data.map((x) => (
                  <Table.Tr key={x.schluessel} data-bezeichnung={x.schluessel}>
                    <Table.Td>{x.bezeichnung}</Table.Td>
                    <Table.Td>{GG_ZIELE[x.ziel]?.label ?? x.ziel}</Table.Td>
                    <Table.Td>{x.anzahl}</Table.Td>
                    <Table.Td>{zeitpunktDe(x.zuletzt)}</Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="default" loading={loeschen.isPending && loeschen.variables === x.schluessel}
                        onClick={() => loeschen.mutate(x.schluessel)}>Löschen</Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}
