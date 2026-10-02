import { Alert, Anchor, Badge, Button, Group, Modal, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { FREQUENZEN, MAKLER_PRIO_CHIPS, maklerAktuelleKriterien, maklerListe } from '@gg/domain';
import { IconLayoutColumns, IconLayoutRows, IconPlus } from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { GeteilteAnsicht } from '../components/GeteilteAnsicht.tsx';
import { MaklerDetail, maklerDublettenFrage } from '../components/MaklerDetail.tsx';
import { Listenzeile } from '../components/Listenzeile.tsx';
import { GespeicherteFilterLeiste, useAktiverFilter } from '../components/GespeicherteFilterLeiste.tsx';
import { Chipleiste, Zaehlerleiste } from '../components/ListenKopf.tsx';
import { useListen, useMaklerAnlegen } from '../lib/api.ts';
import { LAYOUTS, type Layout, useAuswahl, useEinstellung } from '../lib/ansicht.ts';

const PRIO_FARBE: Record<string, string> = { A: 'teal', B: 'orange', C: 'gray' };

export function MaklerSeite() {
  const { data: listen, isLoading } = useListen();
  const [offen, dialog] = useDisclosure(false);
  const suche = useSearch({ from: '/makler' });
  const navigate = useNavigate();
  const [prio, setPrio] = useState('alle');
  const [text, setText] = useState('');
  const gespeichert = useAktiverFilter('makler');
  const liste = maklerListe(listen?.makler ?? [], listen?.deals ?? [], prio, text, gespeichert);
  const [auswahl, setAuswahl] = useAuswahl(liste.zeilen.map((m) => m.id), suche.makler);
  const [layout, setLayout] = useEinstellung<Layout>('makler.layout', LAYOUTS, 'nebeneinander');
  const nebeneinander = layout === 'nebeneinander';
  const geloescht = () => { setAuswahl(null); if (suche.makler) void navigate({ to: '/makler', search: {} }); };

  return (
    <Stack h="calc(100dvh - 56px - 2 * var(--mantine-spacing-md))" gap="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        {/* Titel und Zähler nehmen den Platz links; die Zähler brechen bei Bedarf um, die Knöpfe rechts bleiben in der ersten Zeile */}
        <Group gap="md" wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
          <Title order={2}>Makler</Title>
          <Zaehlerleiste waehlen={setPrio} kennzahlen={[
            { wert: 'alle', label: '● Gesamt', anzahl: liste.zaehler.gesamt, klickbar: false },
            { wert: 'A', label: '▲ A-Makler', anzahl: liste.zaehler.A ?? 0, farbe: 'teal' },
            { wert: 'B', label: '◆ B-Makler', anzahl: liste.zaehler.B ?? 0, farbe: 'orange' },
            { wert: 'C', label: '○ C-Makler', anzahl: liste.zaehler.C ?? 0 },
          ]} />
        </Group>
        <Group gap="xs" wrap="nowrap">
          <GespeicherteFilterLeiste modul="makler" aktuelleKriterien={maklerAktuelleKriterien(prio, text)} />
          <SegmentedControl
            aria-label="Ansicht"
            value={layout}
            onChange={(v) => setLayout(v as Layout)}
            data={[
              { value: 'nebeneinander', label: <IconLayoutColumns size={16} aria-label="nebeneinander" /> },
              { value: 'untereinander', label: <IconLayoutRows size={16} aria-label="untereinander" /> },
            ]}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={dialog.open}>
            Neuer Makler
          </Button>
        </Group>
      </Group>
      <Chipleiste chips={MAKLER_PRIO_CHIPS.map((w) => ({ wert: w, label: w === 'alle' ? 'Alle' : `${w}-Makler` }))} aktiv={prio} waehlen={setPrio}
        suche={text} setSuche={setText} platzhalter="Name, Firma, Region…" />
      <GeteilteAnsicht
        schluessel="makler" layout={layout} listeLabel="Makler-Liste" detailLabel="Makler-Detail" standardBreite={360} standardHoehe="38%"
        liste={
          <>
            {isLoading && <Text c="dimmed">Lädt …</Text>}
            {!isLoading && liste.zeilen.length === 0 && <Text c="dimmed" ta="center" p="lg">🤝 Keine Makler</Text>}
            {nebeneinander ? (
              <Stack gap={4}>
                {liste.zeilen.map((m) => (
                  <MaklerZeile key={m.id} makler={m} aktiv={m.id === auswahl} waehlen={() => setAuswahl(m.id)} />
                ))}
              </Stack>
            ) : liste.zeilen.length > 0 && <MaklerTabelle zeilen={liste.zeilen} auswahlId={auswahl} waehlen={setAuswahl} />}
          </>
        }
        detail={auswahl ? <MaklerDetail key={auswahl} id={auswahl} geloescht={geloescht} /> : <Text c="dimmed">Makler in der Liste wählen.</Text>}
      />

      <MaklerDialog offen={offen} schliessen={dialog.close} bestand={listen?.makler ?? []} />
    </Stack>
  );
}

type MaklerZeileDaten = ReturnType<typeof maklerListe>['zeilen'][number];

function MaklerZeile({ makler, aktiv, waehlen }: { makler: MaklerZeileDaten; aktiv: boolean; waehlen: () => void }) {
  return (
    <Listenzeile
      data-makler={makler.id}
      aktiv={aktiv}
      waehlen={waehlen}
      titel={makler.name}
      unterzeile={`${makler.firma} · ${makler.frequenz} · ${makler.aktiveDeals}/${makler.deals} Deals`}
      rechts={<Badge variant="light" tt="none" color={PRIO_FARBE[makler.prio ?? ''] ?? 'gray'}>{makler.prioText}</Badge>}
    />
  );
}

/** Tabellenansicht wie alt: Priorität | Name | Firma | Telefon | E-Mail | Frequenz | Deals */
function MaklerTabelle({ zeilen, auswahlId, waehlen }: { zeilen: MaklerZeileDaten[]; auswahlId: string | null; waehlen: (id: string) => void }) {
  return (
    <Table striped highlightOnHover aria-label="Maklerliste" miw={700}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Priorität</Table.Th><Table.Th>Name</Table.Th><Table.Th>Firma</Table.Th><Table.Th>Telefon</Table.Th>
          <Table.Th>E-Mail</Table.Th><Table.Th>Frequenz</Table.Th><Table.Th>Deals</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {zeilen.map((m) => (
          <Table.Tr key={m.id} onClick={() => waehlen(m.id)} aria-selected={m.id === auswahlId} style={{ cursor: 'pointer' }} data-makler={m.id}
            bg={m.id === auswahlId ? 'var(--mantine-primary-color-light)' : undefined}>
            <Table.Td><Badge variant="light" tt="none" color={PRIO_FARBE[m.prio ?? ''] ?? 'gray'}>{m.prioText}</Badge></Table.Td>
            <Table.Td fw={600}>{m.name}</Table.Td>
            <Table.Td c="dimmed">{m.firma}</Table.Td>
            <Table.Td>{m.tel ? <Anchor href={`tel:${m.tel}`} c="teal" size="sm" onClick={(e) => e.stopPropagation()}>{m.tel}</Anchor> : '–'}</Table.Td>
            <Table.Td>{m.email ? <Anchor href={`mailto:${m.email}`} size="sm" onClick={(e) => e.stopPropagation()}>{m.email}</Anchor> : '–'}</Table.Td>
            <Table.Td c="dimmed">{m.frequenz}</Table.Td>
            <Table.Td><Text span fw={600} c="yellow.7">{m.aktiveDeals}</Text><Text span size="xs" c="dimmed"> / {m.deals}</Text></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function MaklerDialog({ offen, schliessen, bestand }: { offen: boolean; schliessen: () => void; bestand: { name?: string | null; email?: string | null; tel?: string | null }[] }) {
  const anlegen = useMaklerAnlegen();
  const leer = { name: '', firma: '', tel: '', email: '' };
  const [f, setF] = useState(leer);
  const [prio, setPrio] = useState<'A' | 'B' | 'C'>('B');
  const [frequenz, setFrequenz] = useState<(typeof FREQUENZEN)[number]>('Monatlich');

  return (
    <Modal opened={offen} onClose={schliessen} title="Neuer Makler" closeButtonProps={{ 'aria-label': 'Schließen' }}>
      <Stack>
        <TextInput label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <TextInput label="Firma" value={f.firma} onChange={(e) => setF({ ...f, firma: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Telefon" value={f.tel} onChange={(e) => setF({ ...f, tel: e.currentTarget.value })} />
          <TextInput label="E-Mail" value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} />
        </Group>
        <Group grow>
          <Select label="Prio" data={['A', 'B', 'C']} value={prio} allowDeselect={false} onChange={(v) => v && setPrio(v as 'A' | 'B' | 'C')} />
          <Select
            label="Kontaktfrequenz"
            data={[...FREQUENZEN]}
            value={frequenz}
            allowDeselect={false}
            onChange={(v) => v && setFrequenz(v as (typeof FREQUENZEN)[number])}
          />
        </Group>
        {anlegen.error && <Alert color="red">{anlegen.error.message}</Alert>}
        <Button
          loading={anlegen.isPending}
          onClick={() => {
            const frage = maklerDublettenFrage(bestand, { name: f.name.trim(), email: f.email.trim(), tel: f.tel.trim() });
            if (frage && !window.confirm(frage)) return;
            anlegen.mutate(
              { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())), prio, kontaktFrequenz: frequenz },
              {
                onSuccess: () => {
                  setF(leer);
                  schliessen();
                },
              },
            );
          }}
        >
          Makler anlegen
        </Button>
      </Stack>
    </Modal>
  );
}
