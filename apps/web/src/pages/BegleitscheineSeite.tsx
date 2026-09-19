import { bsGruppiert, BS_STATUS_FARBE } from '@gg/domain';
import { ActionIcon, Alert, Anchor, Button, Group, Modal, Paper, Progress, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { BegleitscheinEintrag } from '@gg/api-contract';
import { useBegleitscheinAnlegen, useBegleitscheine, useBegleitscheinLoeschen, useObjekte } from '../lib/api.ts';
import { alsDatum } from '../lib/format.ts';

const tag = (w: string) => alsDatum(w).toLocaleDateString('de-DE');

/** Übersicht (B8/B9): nach Objekt gruppiert, Ankauf vor Verkauf; Archiv eingeklappt. */
export function BegleitscheineSeite() {
  const { data: liste = [], isLoading } = useBegleitscheine();
  const [neu, setNeu] = useState(false);
  const [archivOffen, setArchivOffen] = useState(false);
  const aktiv = liste.filter((b) => !b.archiviertAm);
  const archiv = liste.filter((b) => b.archiviertAm);

  return (
    <Stack maw={1000}>
      <Group justify="space-between">
        <Title order={2}>📑 Begleitscheine ({aktiv.length}{archiv.length ? ` · ${archiv.length} archiviert` : ''})</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setNeu(true)}>Begleitschein anlegen</Button>
      </Group>
      {isLoading && <Text c="dimmed">Lädt …</Text>}
      {!isLoading && aktiv.length === 0 && (
        <Paper withBorder p="xl" ta="center" c="dimmed">
          <Text fz={32}>📑</Text>
          <Text>Noch kein Begleitschein angelegt</Text>
          <Text size="xs">Ein Begleitschein wird immer bewusst angelegt und nie automatisch erzeugt.</Text>
        </Paper>
      )}
      <Gruppen liste={aktiv} />
      {archiv.length > 0 && (
        <Stack gap="xs" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          <Button variant="subtle" size="xs" w="fit-content" leftSection={archivOffen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />} onClick={() => setArchivOffen((x) => !x)}>
            Archiv ({archiv.length})
          </Button>
          {archivOffen && <Gruppen liste={archiv} />}
        </Stack>
      )}
      <NeuDialog offen={neu} schliessen={() => setNeu(false)} />
    </Stack>
  );
}

function Gruppen({ liste }: { liste: BegleitscheinEintrag[] }) {
  const adressen = useMemo(() => new Map(liste.map((b) => [b.objektId, b.objektAdresse])), [liste]);
  return bsGruppiert(liste, (id) => adressen.get(id) ?? '').map(([objektId, scheine]) => (
    <section key={objektId} aria-label={adressen.get(objektId) || 'Ohne Objekt'}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>{adressen.get(objektId) || 'Ohne Objekt'}</Text>
      <Stack gap={6}>{scheine.map((b) => <Karte key={b.id} b={b} />)}</Stack>
    </section>
  ));
}

function Karte({ b }: { b: BegleitscheinEintrag }) {
  const navigate = useNavigate();
  const loeschen = useBegleitscheinLoeschen();
  const pct = b.zaehler.summe ? Math.round((b.zaehler.erledigt / b.zaehler.summe) * 100) : 0;
  return (
    <Paper withBorder p="sm">
      <Group wrap="wrap" gap="md">
        <div style={{ flex: 1, minWidth: 220 }}>
          <Anchor component="button" fw={600} onClick={() => navigate({ to: '/begleitscheine/$id', params: { id: b.id } })}>{b.name}</Anchor>
          <Text size="xs" c="dimmed">
            {b.typ === 'ankauf' ? 'Ankauf' : 'Verkauf'}{b.whgNr ? ` · Whg. ${b.whgNr}` : ''} · angelegt {tag(b.createdAt)}
            {b.archiviertAm && <Text span c="teal" size="xs"> · archiviert {tag(b.archiviertAm)}</Text>}
          </Text>
        </div>
        <div style={{ width: 160 }}>
          <Progress value={pct} color={BS_STATUS_FARBE.erledigt} size="sm" aria-label={`${b.zaehler.erledigt} von ${b.zaehler.summe} erledigt`} />
          <Text size="xs" c="dimmed">{b.zaehler.erledigt} / {b.zaehler.summe} erledigt</Text>
        </div>
        <ActionIcon variant="subtle" color="red" aria-label="Begleitschein löschen" onClick={() => window.confirm(`Begleitschein „${b.name}“ löschen?`) && loeschen.mutate(b.id)}><IconTrash size={16} /></ActionIcon>
      </Group>
    </Paper>
  );
}

function NeuDialog({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const { data: objekte = [] } = useObjekte();
  const anlegen = useBegleitscheinAnlegen();
  const navigate = useNavigate();
  const [objektId, setObjektId] = useState<string | null>(null);
  const [typ, setTyp] = useState<'ankauf' | 'verkauf'>('ankauf');
  const [whgNr, setWhgNr] = useState('');
  const [name, setName] = useState('');
  const optionen = objekte.map((o) => ({ value: o.id, label: [[o.strasse, o.hausnr].filter(Boolean).join(' '), [o.plz, o.stadt].filter(Boolean).join(' ')].filter(Boolean).join(', ') || o.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return (
    <Modal opened={offen} onClose={schliessen} title="Begleitschein anlegen">
      <Stack>
        {objekte.length === 0 && <Alert color="orange">Zuerst ein Objekt anlegen</Alert>}
        {anlegen.error && <Alert color="red">{anlegen.error.message}</Alert>}
        <Select label="Objekt" searchable data={optionen} value={objektId} onChange={setObjektId} />
        <Select label="Typ" data={[{ value: 'ankauf', label: 'Ankauf' }, { value: 'verkauf', label: 'Verkauf' }]} value={typ} allowDeselect={false} onChange={(v) => v && setTyp(v as 'ankauf')} />
        {typ === 'verkauf' && <TextInput label="Wohnungsnummer" placeholder="02" value={whgNr} onChange={(e) => setWhgNr(e.currentTarget.value)} />}
        <TextInput label="Individueller Name" withAsterisk placeholder="IVT Wohnen" value={name} onChange={(e) => setName(e.currentTarget.value)}
          description="Der vollständige Name wird aus Adresse, Typ und diesem Namen zusammengesetzt." />
        <Group justify="flex-end">
          <Button variant="default" onClick={schliessen}>Abbrechen</Button>
          <Button disabled={!objektId || !name.trim()} loading={anlegen.isPending} onClick={() => anlegen.mutate({ typ, objektId: objektId!, name, ...(typ === 'verkauf' ? { whgNr } : {}) }, {
            onSuccess: (b) => { schliessen(); navigate({ to: '/begleitscheine/$id', params: { id: b.id } }); },
          })}>Anlegen</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
