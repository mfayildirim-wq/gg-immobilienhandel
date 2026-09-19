import type { ZugangStatus } from '@gg/api-contract';
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { usePropstackStatus, usePropstackStatusSpeichern, useZugaenge, useZugangSpeichern } from '../lib/api.ts';

const QUELLE = {
  einstellungen: { label: 'hier hinterlegt', farbe: 'teal' },
  umgebung: { label: 'aus der Umgebung', farbe: 'blue' },
  fehlt: { label: 'nicht hinterlegt', farbe: 'gray' },
} as const;

/** 🔑 Zugänge (Einstellungen): API-Schlüssel verschlüsselt ablegen; sie haben Vorrang vor der Umgebung. */
export function ZugaengeEinstellungen() {
  const { data: zugaenge = [], isLoading, error } = useZugaenge();
  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>🔑 Zugänge</Title>
        <Text size="xs" c="dimmed">
          Schlüssel werden verschlüsselt gespeichert (AES-256-GCM) und nie wieder angezeigt — nur die letzten vier Zeichen.
          Ein hier hinterlegter Schlüssel hat Vorrang vor der Umgebungsvariable.
        </Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {isLoading && <Loader size="sm" />}
      {zugaenge.map((z) => <Zugang key={z.schluessel} z={z} />)}
      <PropstackZielstatus zugangDa={zugaenge.some((z) => z.schluessel === 'propstack-api-key' && z.quelle !== 'fehlt')} />
    </Stack>
  );
}

/**
 * Zielstatus für neue Einheiten im Propstack-CRM (alt: „📋 Statuses laden" neben dem API-Schlüssel).
 * Ohne festgelegten Status legt die Anbindung Einheiten ohne Status an — die Liste holt die Auswahl
 * aus dem CRM und schlägt den Status vor, dessen Name „Kaufangebot" enthält.
 */
export function PropstackZielstatus({ zugangDa }: { zugangDa: boolean }) {
  const { data, isFetching, error, refetch } = usePropstackStatus(false);
  const speichern = usePropstackStatusSpeichern();
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const wert = gewaehlt ?? (data?.gewaehlt != null ? String(data.gewaehlt) : null);

  return (
    <Paper withBorder p="sm" component="section" aria-label="Propstack-Zielstatus">
      <Text size="sm" fw={600} mb={4}>Propstack: Zielstatus</Text>
      <Text size="xs" c="dimmed" mb={6}>
        Unter diesem Status legt die Anbindung neue Einheiten an. Ohne Festlegung bleibt er leer.
      </Text>
      {!zugangDa && <Text size="xs" c="dimmed">Erst den Propstack-Schlüssel hinterlegen.</Text>}
      {zugangDa && (
        <Group gap="xs" align="flex-end">
          <Button size="xs" variant="default" loading={isFetching} onClick={() => void refetch()}>📋 Statuses laden</Button>
          {data && (
            <>
              <Select size="xs" style={{ flex: 1, minWidth: 220 }} aria-label="Zielstatus" placeholder="Status wählen…" clearable
                value={wert} onChange={setGewaehlt}
                data={data.liste.map((s) => ({ value: String(s.id), label: `${s.name} (${s.id})` }))} />
              <Button size="xs" loading={speichern.isPending}
                onClick={() => speichern.mutate(wert ? Number(wert) : null, { onSuccess: () => setGewaehlt(null) })}>Speichern</Button>
            </>
          )}
        </Group>
      )}
      {data?.vorschlag != null && data.gewaehlt !== data.vorschlag && (
        <Text size="xs" c="dimmed" mt={6}>
          Vorschlag: <Anchor component="button" type="button" size="xs" onClick={() => setGewaehlt(String(data.vorschlag))}>
            {data.liste.find((s) => s.id === data.vorschlag)?.name} ({data.vorschlag})
          </Anchor>
        </Text>
      )}
      {error && <Text size="xs" c="red" mt={6}>{(error as Error).message}</Text>}
      {speichern.error && <Text size="xs" c="red" mt={6}>{speichern.error.message}</Text>}
    </Paper>
  );
}

function Zugang({ z }: { z: ZugangStatus }) {
  const speichern = useZugangSpeichern();
  const [wert, setWert] = useState('');
  const quelle = QUELLE[z.quelle];
  return (
    <Paper withBorder p="sm" data-zugang={z.schluessel}>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>{z.label}</Text>
        <Badge size="xs" variant="light" tt="none" color={quelle.farbe} data-quelle>{quelle.label}{z.maske ? ` · ${z.maske}` : ''}</Badge>
      </Group>
      <Text size="xs" c="dimmed" mb={6}>
        {z.hinweis} Umgebungsvariable: <code>{z.umgebung}</code>
        {z.quelleUrl && <> · Schlüssel erstellen: <Anchor href={z.quelleUrl} target="_blank" rel="noopener noreferrer" size="xs">{z.quelleText}</Anchor></>}
      </Text>
      <Group gap="xs">
        <TextInput size="xs" type="password" style={{ flex: 1 }} aria-label={`${z.label} Schlüssel`} placeholder="Neuen Schlüssel einsetzen…" value={wert}
          onChange={(e) => setWert(e.currentTarget.value)} />
        <Button size="xs" disabled={!wert.trim()} loading={speichern.isPending}
          onClick={() => speichern.mutate({ schluessel: z.schluessel, wert }, { onSuccess: () => setWert('') })}>Speichern</Button>
        {z.quelle === 'einstellungen' && (
          <Button size="xs" variant="subtle" color="red" onClick={() => window.confirm(`${z.label}: hinterlegten Schlüssel entfernen?`) && speichern.mutate({ schluessel: z.schluessel, wert: '' })}>
            Entfernen
          </Button>
        )}
      </Group>
    </Paper>
  );
}
