import { dealAktuelleKriterien, dealListe, type DealStatus, LISTEN_STATUS } from '@gg/domain';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Timeline,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconLayoutColumns, IconLayoutRows, IconPlus } from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { DealDetail } from '../components/deal/DealDetail.tsx';
import { Listenzeile } from '../components/Listenzeile.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { GespeicherteFilterLeiste, useAktiverFilter } from '../components/GespeicherteFilterLeiste.tsx';
import { Chipleiste, Zaehlerleiste } from '../components/ListenKopf.tsx';
import { useDealAnlegen, useListen, useMakler, useObjekte } from '../lib/api.ts';
import { STATUS_CHIPS, STATUS_FARBE, Titelbild } from './ObjekteSeite.tsx';
import { LAYOUTS, type Layout, useAuswahl, useEinstellung } from '../lib/ansicht.ts';
import { darfVerlassen } from '../lib/ungespeichert.ts';

/** Liste + Detail, umschaltbar nebeneinander (Liste links) oder untereinander (Liste oben, scrollbar). */
export function DealsSeite() {
  const { data: listen, isLoading } = useListen();
  const [status, setStatus] = useState('alle');
  const [text, setText] = useState('');
  const gespeichert = useAktiverFilter('deals');
  const liste = dealListe(listen?.deals ?? [], listen?.objekte ?? [], listen?.makler ?? [], status, text, gespeichert);
  const [layout, setLayout] = useEinstellung<Layout>('deals.layout', LAYOUTS, 'nebeneinander');
  const suche = useSearch({ from: '/deals' });
  const navigate = useNavigate();
  const [auswahlId, setAuswahlId] = useAuswahl(liste.zeilen.map((d) => d.id), suche.deal);
  // Ein anderer Deal baut das Detail neu auf: bei ungespeicherter Kalkulation erst fragen
  const waehlen = (id: string) => { if (id === auswahlId || darfVerlassen()) setAuswahlId(id); };
  const [neuOffen, neu] = useDisclosure(!!suche.neu);
  const auswahl = liste.zeilen.find((d) => d.id === auswahlId) ?? (listen?.deals.some((d) => d.id === auswahlId) ? { id: auswahlId! } : null);
  const nebeneinander = layout === 'nebeneinander';

  return (
    <Stack h="calc(100dvh - 56px - 2 * var(--mantine-spacing-md))" gap="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        {/* Titel und Zähler nehmen den Platz links; die Zähler brechen bei Bedarf um, die Knöpfe rechts bleiben in der ersten Zeile */}
        <Group gap="md" wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
          <Title order={2}>Deals</Title>
          <Zaehlerleiste waehlen={setStatus} kennzahlen={LISTEN_STATUS.map((s) => ({ wert: s, label: s, anzahl: liste.zaehler[s] ?? 0, farbe: STATUS_FARBE[s] }))} />
        </Group>
        <Group gap="xs" wrap="nowrap">
          <GespeicherteFilterLeiste modul="deals" aktuelleKriterien={dealAktuelleKriterien(status, text)} />
          <SegmentedControl
            aria-label="Ansicht"
            value={layout}
            onChange={(v) => setLayout(v as Layout)}
            data={[
              { value: 'nebeneinander', label: <IconLayoutColumns size={16} aria-label="nebeneinander" /> },
              { value: 'untereinander', label: <IconLayoutRows size={16} aria-label="untereinander" /> },
            ]}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={neu.open}>
            Neuer Deal
          </Button>
        </Group>
      </Group>

      <Chipleiste chips={STATUS_CHIPS} aktiv={status} waehlen={setStatus} suche={text} setSuche={setText} platzhalter="Suchen…" />

      <Box
        data-layout={layout}
        style={{ display: 'flex', flexDirection: nebeneinander ? 'row' : 'column', gap: 12, flex: 1, minHeight: 0 }}
      >
        <ScrollArea
          type="auto"
          style={nebeneinander ? { width: 360, flexShrink: 0 } : { height: '38%', flexShrink: 0 }}
          aria-label="Deal-Liste"
        >
          {isLoading && <Text c="dimmed">Lädt …</Text>}
          {!isLoading && liste.zeilen.length === 0 && <Text c="dimmed">📋 Keine Deals</Text>}
          {nebeneinander ? (
            <Stack gap={4}>
              {liste.zeilen.map((d) => (
                <DealZeile key={d.id} deal={d} exposeId={listen?.exposeIds?.[d.id]} aktiv={d.id === auswahlId} waehlen={() => waehlen(d.id)} />
              ))}
            </Stack>
          ) : liste.zeilen.length > 0 && <DealTabelle zeilen={liste.zeilen} exposeIds={listen?.exposeIds ?? {}} auswahlId={auswahlId} waehlen={waehlen} />}
        </ScrollArea>
        <Box component="section" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }} aria-label="Deal-Detail">
          {auswahl ? <DealDetail key={auswahl.id} id={auswahl.id} /> : <Text c="dimmed">Deal in der Liste wählen.</Text>}
        </Box>
      </Box>

      <NeuerDealDialog
        offen={neuOffen}
        maklerVorgabe={suche.neu ?? null}
        schliessen={() => { neu.close(); if (suche.neu) void navigate({ to: '/deals', search: {} }); }}
        angelegt={setAuswahlId}
      />
    </Stack>
  );
}

type DealZeileDaten = ReturnType<typeof dealListe>['zeilen'][number];

function DealZeile({ deal, exposeId, aktiv, waehlen }: { deal: DealZeileDaten; exposeId?: string; aktiv: boolean; waehlen: () => void }) {
  return (
    <Listenzeile
      data-deal={deal.id}
      aktiv={aktiv}
      waehlen={waehlen}
      titel={deal.adresse}
      unterzeile={`${deal.stadt} · ${deal.makler} · ${deal.kaufpreis}`}
      rechts={
        <Group gap={6} wrap="nowrap">
          {/* Das Exposé ist auch in der schmalen Liste einen Klick entfernt, nicht nur in der Tabelle. */}
          {exposeId && (
            <Anchor href={`/api/deals/${deal.id}/dokumente/${exposeId}/datei`} target="_blank" rel="noopener"
              title="Exposé öffnen" data-expose onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>📄</Anchor>
          )}
          <StatusBadge status={deal.status as DealStatus} />
        </Group>
      }
    />
  );
}

/** Tabellenansicht wie alt: Status | Adresse | Makler | Telefon | Kaufpreis | m² | JNKM | Rendite | Angeboten */
function DealTabelle({ zeilen, exposeIds, auswahlId, waehlen }: { zeilen: DealZeileDaten[]; exposeIds: Record<string, string>; auswahlId: string | null; waehlen: (id: string) => void }) {
  return (
    <Table striped highlightOnHover aria-label="Dealliste" miw={1000}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={58} /><Table.Th w={30} /><Table.Th>Status</Table.Th><Table.Th>Adresse</Table.Th><Table.Th>Makler</Table.Th><Table.Th>Telefon</Table.Th>
          <Table.Th>Kaufpreis</Table.Th><Table.Th>m²</Table.Th><Table.Th>JNKM</Table.Th><Table.Th>Rendite</Table.Th><Table.Th>Angeboten</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {zeilen.map((d) => (
          <Table.Tr key={d.id} data-deal={d.id} onClick={() => waehlen(d.id)} aria-selected={d.id === auswahlId} style={{ cursor: 'pointer' }}
            bg={d.id === auswahlId ? 'var(--mantine-primary-color-light)' : undefined}>
            <Table.Td><Titelbild objektId={d.objId} /></Table.Td>
            <Table.Td>{exposeIds[d.id] && (
              <Anchor href={`/api/deals/${d.id}/dokumente/${exposeIds[d.id]}/datei`} target="_blank" rel="noopener" title="Exposé öffnen" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>📄</Anchor>
            )}</Table.Td>
            <Table.Td><StatusBadge status={d.status as DealStatus} /></Table.Td>
            <Table.Td><Text fw={600} size="sm">{d.adresse}</Text><Text size="xs" c="dimmed">{d.stadt}</Text></Table.Td>
            <Table.Td><Text fw={600} size="sm">{d.makler}</Text><Text size="xs" c="dimmed">{d.firma}</Text></Table.Td>
            <Table.Td>{d.tel ? <Anchor href={`tel:${d.tel}`} c="teal" size="sm" fw={600} onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>📞 {d.tel}</Anchor> : '–'}</Table.Td>
            <Table.Td c="yellow.7">{d.kaufpreis}</Table.Td>
            <Table.Td>{d.flaeche}</Table.Td>
            <Table.Td c="teal">{d.jnkm}</Table.Td>
            <Table.Td c="yellow.7">{d.rendite}</Table.Td>
            <Table.Td c="dimmed">{d.angeboten}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function NeuerDealDialog({
  offen,
  maklerVorgabe,
  schliessen,
  angelegt,
}: {
  offen: boolean;
  maklerVorgabe: string | null;
  schliessen: () => void;
  angelegt: (id: string) => void;
}) {
  const { data: objekte = [] } = useObjekte();
  const { data: makler = [] } = useMakler();
  const anlegen = useDealAnlegen();
  const { data: listen } = useListen();
  const [objektId, setObjektId] = useState<string | null>(null);
  const [maklerId, setMaklerId] = useState<string | null>(maklerVorgabe);

  return (
    <Modal opened={offen} onClose={schliessen} title="Neuer Deal" closeButtonProps={{ 'aria-label': 'Schließen' }}>
      <Stack>
        <Select
          label="Objekt"
          required
          searchable
          value={objektId}
          onChange={setObjektId}
          data={objekte.map((o) => ({
            value: o.id,
            label: [[o.strasse, o.hausnr].filter(Boolean).join(' '), o.stadt].filter(Boolean).join(', ') || o.id,
          }))}
        />
        <Select
          label="Makler"
          required
          clearable
          searchable
          value={maklerId}
          onChange={setMaklerId}
          data={makler.map((m) => ({ value: m.id, label: m.name ?? m.firma ?? m.id }))}
        />
        {anlegen.error && <Alert color="red">{anlegen.error.message}</Alert>}
        <Button
          disabled={!objektId || !maklerId}
          loading={anlegen.isPending}
          onClick={() =>
            // Dublette wie dealSave: gleicher Deal für Objekt + Makler
            (!listen?.deals.some((d) => d.objId === objektId && d.maklerId === maklerId)
              || window.confirm('Es existiert bereits ein Deal für dieses Objekt mit diesem Makler.\n\nTrotzdem neuen Deal anlegen?')) &&
            anlegen.mutate(
              { objektId: objektId!, ...(maklerId ? { maklerId } : {}) },
              {
                onSuccess: ({ id }) => {
                  angelegt(id);
                  setObjektId(null);
                  setMaklerId(null);
                  schliessen();
                },
              },
            )
          }
        >
          Deal anlegen
        </Button>
      </Stack>
    </Modal>
  );
}
