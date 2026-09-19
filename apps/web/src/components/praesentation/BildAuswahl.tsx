import type { Praesentation } from '@gg/api-contract';
import { Alert, Badge, Button, FileButton, Group, Image, Modal, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconClipboard, IconPhotoPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fotoHochladen, useObjektFotos } from '../../lib/api.ts';
import { bildVerkleinern } from '../../lib/bild.ts';
import { bildQuellen } from './bilder.ts';

export interface AuswahlAuftrag {
  titel: string;
  /** 1 = Einzelbild (Klick übernimmt), sonst Mehrfachauswahl mit Reihenfolge */
  max: number;
  vorauswahl: string[];
  fertig: (refs: string[]) => void;
}

/** Bildauswahl wie der Foto-Picker der alten App: Objektfotos + Bilder anderer Folien, Hochladen direkt ins Objekt. */
export function BildAuswahl({ auftrag, objektId, praes = { slides: [] }, schliessen }: { auftrag: AuswahlAuftrag | null; objektId: string | null; praes?: Pick<Praesentation, 'slides'>; schliessen: () => void }) {
  const { data: fotos = [], refetch } = useObjektFotos(objektId);
  const qc = useQueryClient();
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [offenFuer, setOffenFuer] = useState<AuswahlAuftrag | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  if (auftrag !== offenFuer) {
    setOffenFuer(auftrag);
    setAuswahl(auftrag ? auftrag.vorauswahl.slice(0, auftrag.max) : []);
    setFehler(null);
  }
  // Beim Öffnen frisch laden: Fotos können inzwischen woanders hochgeladen worden sein
  useEffect(() => { if (auftrag && objektId) void refetch(); }, [auftrag, objektId, refetch]);
  const quellen = useMemo(() => bildQuellen(fotos, praes), [fotos, praes]);
  if (!auftrag) return null;
  const einzel = auftrag.max === 1;

  const hochladen = async (dateien: Blob[], namen: string[]) => {
    if (!objektId) return;
    setLaeuft(true);
    setFehler(null);
    const neu: string[] = [];
    try {
      for (const [i, d] of dateien.entries()) {
        const f = await fotoHochladen(objektId, d instanceof File ? await bildVerkleinern(d) : d, namen[i] ?? 'Bild.jpg');
        neu.push(f.ref);
      }
      await qc.invalidateQueries({ queryKey: ['objekte', objektId, 'fotos'] });
      if (einzel && neu[0]) { auftrag.fertig([neu[0]]); schliessen(); return; }
      setAuswahl((a) => [...a, ...neu].slice(0, auftrag.max));
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  const ausZwischenablage = async () => {
    try {
      const teile = await navigator.clipboard.read();
      for (const t of teile) {
        const typ = t.types.find((x) => x.startsWith('image/'));
        if (typ) { await hochladen([await t.getType(typ)], [`Zwischenablage-${new Date().toISOString().slice(0, 19)}.png`]); return; }
      }
      setFehler('In der Zwischenablage ist kein Bild.');
    } catch {
      setFehler('Zwischenablage nicht lesbar – bitte den Zugriff im Browser erlauben.');
    }
  };

  const klick = (ref: string) => {
    if (einzel) { auftrag.fertig([ref]); schliessen(); return; }
    setAuswahl((a) => (a.includes(ref) ? a.filter((x) => x !== ref) : a.length >= auftrag.max ? a : [...a, ref]));
  };

  return (
    <Modal opened onClose={schliessen} title={auftrag.titel} size="xl">
      <Stack>
        {!objektId && <Alert color="orange">Kein Objekt mit dem Deal verknüpft — Hochladen nicht möglich.</Alert>}
        {fehler && <Alert color="red">{fehler}</Alert>}
        <Group gap="xs">
          <FileButton multiple={!einzel} accept="image/*,.heic,.heif" onChange={(d) => { const liste = Array.isArray(d) ? d : d ? [d] : []; if (liste.length) void hochladen(liste, liste.map((x) => x.name)); }}>
            {(props) => <Button {...props} size="xs" leftSection={<IconPhotoPlus size={14} />} loading={laeuft} disabled={!objektId}>Neu hochladen</Button>}
          </FileButton>
          <Button size="xs" variant="default" leftSection={<IconClipboard size={14} />} disabled={!objektId || laeuft} onClick={() => void ausZwischenablage()}>Aus Zwischenablage</Button>
          {!einzel && <Text size="sm" c="dimmed">{auswahl.length} / {auftrag.max} gewählt</Text>}
        </Group>
        {quellen.length === 0 && <Text c="dimmed" size="sm">Noch keine Bilder – oben hochladen.</Text>}
        <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
          {quellen.map((q) => {
            const nr = auswahl.indexOf(q.ref);
            return (
              <UnstyledButton key={q.ref} onClick={() => klick(q.ref)} aria-label={`Bild ${q.label}`} aria-pressed={nr >= 0}
                style={{ position: 'relative', borderRadius: 6, outline: nr >= 0 ? '3px solid var(--mantine-color-teal-6)' : '1px solid var(--mantine-color-default-border)' }}>
                <Image src={q.url} h={100} fit="cover" radius="sm" alt={q.label} />
                {nr >= 0 && <Badge size="sm" style={{ position: 'absolute', top: 4, left: 4 }}>{nr + 1}</Badge>}
                <Text size="xs" c="dimmed" truncate px={4}>{q.label}</Text>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
        {!einzel && (
          <Group justify="flex-end">
            <Button variant="default" onClick={schliessen}>Abbrechen</Button>
            <Button onClick={() => { auftrag.fertig(auswahl); schliessen(); }}>Auswahl übernehmen</Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
