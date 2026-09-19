import type { PropstackBewertung } from '@gg/api-contract';
import { QUALITAET_OPTIONEN } from '@gg/domain';
import { Alert, Anchor, Button, Group, Loader, Modal, NativeSelect, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { usePropstackAnlegen, usePropstackVorbelegung } from '../../lib/api.ts';

const FELDER: [keyof PropstackBewertung['daten'], string][] = [
  ['strasse', 'Straße'], ['hausnr', 'Hausnr.'], ['plz', 'PLZ'], ['ort', 'Ort'],
  ['baujahr', 'Baujahr'], ['wohnflaeche', 'Wohnfläche m²'], ['zimmer', 'Zimmer'],
  ['letzteModernisierung', 'Letzte Modernisierung'], ['etage', 'Etage'], ['etagenzahl', 'Etagen im Haus'], ['balkonFlaeche', 'Balkon m²'],
];

/** 📊 Bewertung über Propstack (alt: dealOpenPropstack): Angaben prüfen, dann als Einheit ins CRM. */
export function PropstackDialog({ dealId, einheitId, schliessen }: { dealId: string; einheitId: string | null; schliessen: () => void }) {
  const { data, isLoading, error } = usePropstackVorbelegung(dealId, einheitId);
  const anlegen = usePropstackAnlegen(dealId, einheitId ?? '');
  const [daten, setDaten] = useState<PropstackBewertung['daten'] | null>(null);
  useEffect(() => setDaten(data?.daten ?? null), [data]);

  const fehler = anlegen.error as (Error & { status?: number; details?: { hint?: string } }) | null;

  return (
    <Modal opened={!!einheitId} onClose={schliessen} title="📊 Bewertung über Propstack" size="lg">
      {isLoading && <Loader size="sm" />}
      {error && <Alert color="red">{error.message}</Alert>}
      {data && daten && (
        <Stack gap="sm">
          {data.unitId && (
            <Alert color="teal" py={6}>
              ✅ Bereits in Propstack:{' '}
              <Anchor href={data.url ?? '#'} target="_blank" rel="noopener">ID {data.unitId} öffnen</Anchor>
            </Alert>
          )}
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
            {FELDER.map(([feld, label]) => (
              <TextInput key={feld} size="xs" label={label} value={daten[feld]} onChange={(e) => setDaten({ ...daten, [feld]: e.currentTarget.value })} />
            ))}
            <NativeSelect size="xs" label="Qualität" aria-label="Qualität" value={daten.qualitaet}
              onChange={(e) => setDaten({ ...daten, qualitaet: e.currentTarget.value as PropstackBewertung['daten']['qualitaet'] })}
              data={QUALITAET_OPTIONEN as unknown as string[]} />
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Der Datensatz wird im CRM angelegt und lässt sich von hier nicht zurücknehmen. Die Angaben bleiben an der Einheit,
            damit die nächste Bewertung sie schon kennt.
          </Text>
          {fehler && (
            <Alert color="red" data-propstack-fehler>
              {fehler.message}
              {fehler.details?.hint && <Text size="xs" mt={4}>{fehler.details.hint}</Text>}
            </Alert>
          )}
          {anlegen.data && (
            <Alert color="teal" data-propstack-erfolg>
              Angelegt als ID {anlegen.data.unitId}.{' '}
              {anlegen.data.url && <Anchor href={anlegen.data.url} target="_blank" rel="noopener">In Propstack öffnen und Bewertung anstoßen</Anchor>}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={schliessen}>Schließen</Button>
            <Button loading={anlegen.isPending} onClick={() => anlegen.mutate(daten)}>📊 An Propstack senden</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
