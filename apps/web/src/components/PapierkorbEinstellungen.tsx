import { ENDGUELTIG_FRAGE, leerenFrage, papierkorbGruppen, papierkorbUebrigHinweis, PAPIERKORB_HINWEIS, PAPIERKORB_LEER, PAPIERKORB_TAGE } from '@gg/domain';
import { Alert, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { usePapierkorb, usePapierkorbEndgueltig, usePapierkorbLeeren, usePapierkorbWiederherstellen } from '../lib/api.ts';

/** 🗑 Papierkorb (Einstellungen): Gelöschtes je Bereich, wiederherstellen, endgültig entfernen, leeren. */
export function PapierkorbEinstellungen() {
  const { data: eintraege = [], isLoading, error } = usePapierkorb();
  const wiederherstellen = usePapierkorbWiederherstellen();
  const endgueltig = usePapierkorbEndgueltig();
  const leeren = usePapierkorbLeeren();
  const gruppen = papierkorbGruppen(eintraege);
  // Abgelehntes (es verweist noch etwas darauf, das Objekt eines Deals liegt selbst im Papierkorb) kommt als Hinweis vom Server
  const [hinweis, setHinweis] = useState<string | null>(null);
  const melden = { onError: (e: Error) => setHinweis(e.message), onSuccess: () => setHinweis(null) };

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>🗑 Papierkorb</Title>
        <Text size="xs" c="dimmed">{PAPIERKORB_HINWEIS}</Text>
      </div>
      {error && <Alert color="red">{error.message}</Alert>}
      {hinweis && <Alert color="yellow" data-hinweis="papierkorb">{hinweis}</Alert>}
      {isLoading && <Loader size="sm" />}
      {!isLoading && gruppen.length === 0 && <Text size="sm" c="dimmed">{PAPIERKORB_LEER}</Text>}
      {gruppen.map((g) => (
        <div key={g.bereich}>
          <Text size="sm" fw={600} c="dimmed" mb={4}>{g.label} ({g.eintraege.length})</Text>
          <Stack gap={4}>
            {g.eintraege.map((e) => (
              <Paper key={`${e.bereich}:${e.id}`} withBorder p="xs" data-papierkorb={e.id}>
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>{e.bezeichnung}</Text>
                    <Text size="xs" c={e.dringend ? 'red' : 'dimmed'}>{e.text}</Text>
                  </div>
                  <Group gap={6} wrap="nowrap">
                    <Button size="compact-xs" onClick={() => wiederherstellen.mutate({ bereich: e.bereich, id: e.id }, melden)}>↩ Wiederherstellen</Button>
                    <Button size="compact-xs" variant="default" onClick={() => window.confirm(ENDGUELTIG_FRAGE) && endgueltig.mutate({ bereich: e.bereich, id: e.id }, melden)}>✖ Endgültig</Button>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </div>
      ))}
      {eintraege.length > 0 && (
        <Group justify="flex-end">
          <Button variant="default" size="xs" loading={leeren.isPending}
            onClick={() => window.confirm(leerenFrage(eintraege.length))
              && leeren.mutate(undefined, { ...melden, onSuccess: (r) => setHinweis(r.uebrig ? papierkorbUebrigHinweis(r.uebrig) : null) })}>
            Papierkorb leeren ({eintraege.length})
          </Button>
        </Group>
      )}
      <Text size="xs" c="dimmed">Frist: {PAPIERKORB_TAGE} Tage.</Text>
    </Stack>
  );
}
