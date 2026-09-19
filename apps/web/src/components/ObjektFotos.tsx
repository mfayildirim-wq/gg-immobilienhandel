import type { ObjektFoto } from '@gg/api-contract';
import { ActionIcon, Alert, Button, FileButton, Group, Image, Paper, SimpleGrid, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconPhotoPlus, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fotoHochladen, useFotoLoeschen, useFotosSortieren, useObjektFotos } from '../lib/api.ts';
import { bildVerkleinern } from '../lib/bild.ts';

/** Fotos eines Objekts: mehrere auf einmal hochladen (ein Fehler hält den Stapel nicht an), sortieren, löschen. */
export function ObjektFotos({ objektId }: { objektId: string }) {
  const { data: fotos = [] } = useObjektFotos(objektId);
  const qc = useQueryClient();
  const loeschen = useFotoLoeschen(objektId);
  const sortieren = useFotosSortieren(objektId);
  const [stand, setStand] = useState<{ fertig: number; gesamt: number } | null>(null);
  const [fehler, setFehler] = useState<string[]>([]);

  const hochladen = async (dateien: File[]) => {
    setFehler([]);
    setStand({ fertig: 0, gesamt: dateien.length });
    const probleme: string[] = [];
    for (const [i, datei] of dateien.entries()) {
      try {
        await fotoHochladen(objektId, await bildVerkleinern(datei), datei.name);
      } catch (e) {
        probleme.push(`${datei.name}: ${(e as Error).message}`);
      }
      setStand({ fertig: i + 1, gesamt: dateien.length });
    }
    setStand(null);
    setFehler(probleme);
    await qc.invalidateQueries({ queryKey: ['objekte', objektId, 'fotos'] });
  };

  const verschieben = (i: number, richtung: -1 | 1) => {
    const ids = fotos.map((f) => f.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + richtung, 0, x!);
    sortieren.mutate(ids);
  };

  return (
    <section aria-label="Fotos des Objekts">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Fotos {fotos.length > 0 && <Text span c="dimmed" size="sm">({fotos.length})</Text>}</Title>
        <FileButton multiple accept="image/*,.heic,.heif" onChange={(d) => d.length && void hochladen(d)}>
          {(props) => (
            <Button {...props} size="xs" variant="light" leftSection={<IconPhotoPlus size={14} />} loading={!!stand}>
              Fotos hinzufügen
            </Button>
          )}
        </FileButton>
      </Group>
      {stand && <Text size="sm" c="dimmed">Lade hoch … {stand.fertig} / {stand.gesamt}</Text>}
      {fehler.length > 0 && <Alert color="orange" mb="xs" title="Nicht alle Fotos hochgeladen" withCloseButton onClose={() => setFehler([])}>{fehler.map((f) => <div key={f}>{f}</div>)}</Alert>}
      {fotos.length === 0 && !stand && <Text c="dimmed" size="sm">Noch keine Fotos.</Text>}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
        {fotos.map((f, i) => <FotoKachel key={f.id} f={f} erstes={i === 0} letztes={i === fotos.length - 1} links={() => verschieben(i, -1)} rechts={() => verschieben(i, 1)} weg={() => loeschen.mutate(f.id)} />)}
      </SimpleGrid>
    </section>
  );
}

function FotoKachel({ f, erstes, letztes, links, rechts, weg }: { f: ObjektFoto; erstes: boolean; letztes: boolean; links: () => void; rechts: () => void; weg: () => void }) {
  return (
    <Paper withBorder p={4} aria-label={`Foto ${f.dateiname ?? f.id}`}>
      <Image src={f.url} alt={f.dateiname ?? 'Foto'} h={110} fit="cover" radius="sm" loading="lazy" />
      <Group justify="space-between" gap={2} mt={4} wrap="nowrap">
        <Text size="xs" c="dimmed" truncate>{erstes ? 'Titelbild' : f.dateiname}</Text>
        <Group gap={0} wrap="nowrap">
          <Tooltip label="nach vorne"><ActionIcon size="sm" variant="subtle" aria-label="Foto nach vorne" disabled={erstes} onClick={links}><IconArrowLeft size={14} /></ActionIcon></Tooltip>
          <Tooltip label="nach hinten"><ActionIcon size="sm" variant="subtle" aria-label="Foto nach hinten" disabled={letztes} onClick={rechts}><IconArrowRight size={14} /></ActionIcon></Tooltip>
          <Tooltip label="löschen"><ActionIcon size="sm" variant="subtle" color="red" aria-label="Foto löschen" onClick={() => window.confirm('Foto wirklich löschen?') && weg()}><IconTrash size={14} /></ActionIcon></Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
