import { Alert, Button, Group, Loader, NativeSelect, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useKiKosten, useNachfassReset, useNachfassResetVorschau } from '../lib/api.ts';
import { euro } from '../lib/format.ts';

/** 🔧 Werkzeuge (Einstellungen): Nachfass-Datum-Reset und KI-Kosten. */
export function WerkzeugeEinstellungen() {
  return (
    <Stack gap="lg">
      <NachfassReset />
      <KiKosten />
    </Stack>
  );
}

function NachfassReset() {
  const [datum, setDatum] = useState('');
  const [gefragt, setGefragt] = useState('');
  const { data: sicht, isFetching } = useNachfassResetVorschau(gefragt);
  const ausfuehren = useNachfassReset();

  return (
    <div>
      <Title order={4}>🔧 Nachfass-Datum-Reset</Title>
      <Text size="xs" c="dimmed" mb="xs">
        Setzt alle Deals und Makler mit diesem <code>nächsten Kontakt</code> zurück (Datum und letzter Kontakt werden gelöscht) — etwa nach einem versehentlichen Massen-„Erledigt“.
      </Text>
      <Group gap="xs" align="flex-end">
        <TextInput size="xs" type="date" label="Nächster Kontakt" aria-label="Nachfass-Datum" value={datum} onChange={(e) => setDatum(e.currentTarget.value)} />
        <Button size="xs" variant="default" disabled={!datum} onClick={() => setGefragt(datum)}>🔍 Vorschau</Button>
        <Button size="xs" color="red" variant="outline" disabled={!sicht || (sicht.deals.length + sicht.makler.length === 0)} loading={ausfuehren.isPending}
          onClick={() => sicht && window.confirm(`Wirklich nächsten und letzten Kontakt bei ${sicht.deals.length} Deals und ${sicht.makler.length} Maklern (alle mit nächstem Kontakt = ${sicht.datum}) löschen?\n\nDie Einträge erscheinen danach wieder in der Nachverfolgen-Liste.`)
            && ausfuehren.mutate(sicht.datum)}>
          🔧 Datum löschen
        </Button>
        {isFetching && <Loader size="xs" />}
      </Group>
      {sicht && (
        <Paper withBorder p="xs" mt="xs" aria-label="Nachfass-Vorschau">
          <Text size="sm"><b>{sicht.deals.length} Deals</b> + <b>{sicht.makler.length} Makler</b> mit nächstem Kontakt = {sicht.datum}</Text>
          {[['Deals', sicht.deals], ['Makler', sicht.makler]].map(([titel, liste]) => (liste as typeof sicht.deals).length > 0 && (
            <div key={titel as string}>
              <Text size="xs" fw={600} mt={4}>{titel as string} (max 10):</Text>
              {(liste as typeof sicht.deals).slice(0, 10).map((e) => (
                <Text key={e.id} size="xs" c="dimmed" data-nachfass={e.id}>{e.label} ({e.zusatz})</Text>
              ))}
            </div>
          ))}
        </Paper>
      )}
      {ausfuehren.data && <Alert color="teal" mt="xs">✅ Zurückgesetzt: {ausfuehren.data.deals} Deals und {ausfuehren.data.makler} Makler.</Alert>}
    </div>
  );
}

function KiKosten() {
  const [tage, setTage] = useState('30');
  const { data, isLoading } = useKiKosten(Number(tage));
  return (
    <div>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={4}>🤖 KI-Kosten</Title>
          <Text size="xs" c="dimmed">Aus dem Audit-Log (Aufrufe vom Typ „kicall“), gruppiert nach Modell und Funktion.</Text>
        </div>
        <NativeSelect size="xs" aria-label="Zeitraum" value={tage} onChange={(e) => setTage(e.currentTarget.value)}
          data={[{ value: '7', label: '7 Tage' }, { value: '30', label: '30 Tage' }, { value: '365', label: '1 Jahr' }]} />
      </Group>
      {isLoading && <Loader size="sm" />}
      {data && (
        <>
          <Text size="sm" mt="xs" data-ki-summe>Summe: <b>{data.summeEur.toFixed(4)} €</b> in {data.tage} Tagen</Text>
          {data.zeilen.length === 0 && <Text size="xs" c="dimmed">Keine KI-Aufrufe im Zeitraum.</Text>}
          {data.zeilen.length > 0 && (
            <Table mt="xs" verticalSpacing={4} aria-label="KI-Kosten">
              <Table.Thead>
                <Table.Tr><Table.Th>Modell</Table.Th><Table.Th>Funktion</Table.Th><Table.Th ta="right">Aufrufe</Table.Th><Table.Th ta="right">Tokens ein/aus</Table.Th><Table.Th ta="right">Kosten</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.zeilen.map((z) => (
                  <Table.Tr key={`${z.model}:${z.funktion}`} data-ki-zeile={`${z.model}:${z.funktion}`}>
                    <Table.Td><Text size="xs">{z.model}</Text></Table.Td>
                    <Table.Td><Text size="xs">{z.funktion}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs">{z.aufrufe}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs">{z.inputTokens.toLocaleString('de-DE')} / {z.outputTokens.toLocaleString('de-DE')}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs">{z.kostenEur ? `${z.kostenEur.toFixed(4)} €` : euro(0)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
