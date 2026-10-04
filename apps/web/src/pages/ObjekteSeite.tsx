import { LISTEN_STATUS, LISTEN_STATUS_CHIPS, objektAktuelleKriterien, objektListe } from '@gg/domain';
import { Alert, Badge, Button, Group, Modal, NumberInput, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { GeteilteAnsicht } from '../components/GeteilteAnsicht.tsx';
import { ObjektDetail } from '../components/ObjektDetail.tsx';
import { Listenzeile } from '../components/Listenzeile.tsx';
import { AnsichtMenue } from '../components/AnsichtMenue.tsx';
import { useAktiverFilter } from '../components/GespeicherteFilterLeiste.tsx';
import { Chipleiste, Zaehlerleiste } from '../components/ListenKopf.tsx';
import { useListen, useObjektAnlegen } from '../lib/api.ts';
import { LAYOUTS, type Layout, useAuswahl, useEinstellung } from '../lib/ansicht.ts';

export const STATUS_FARBE: Record<string, string> = { 'In Prüfung': 'blue', 'Über Zeit nachfassen': 'orange', 'Closing Path': 'red', 'Angebot abgegeben': 'yellow', Angekauft: 'teal', Archiv: 'gray' };
export const STATUS_CHIPS = LISTEN_STATUS_CHIPS.map((w) => ({ wert: w, label: w === 'alle' ? 'Alle' : w }));

/** Vorschaubild wie alt (/api/photos/<id>/cover); ohne Foto verschwindet es. */
export function Titelbild({ objektId }: { objektId: string }) {
  const [da, setDa] = useState(true);
  return da ? <img src={`/api/photos/${objektId}/cover`} alt="" loading="lazy" onError={() => setDa(false)} style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, display: 'block' }} /> : null;
}

export function ObjekteSeite() {
  const { data: listen, isLoading } = useListen();
  const [offen, dialog] = useDisclosure(false);
  const suche = useSearch({ from: '/objekte' });
  const navigate = useNavigate();
  const [status, setStatus] = useState('alle');
  const [text, setText] = useState('');
  const gespeichert = useAktiverFilter('objects');
  const liste = objektListe(listen?.objekte ?? [], listen?.deals ?? [], status, text, gespeichert);
  const [auswahl, setAuswahl] = useAuswahl(liste.zeilen.map((o) => o.id), suche.objekt);
  const [layout, setLayout] = useEinstellung<Layout>('objekte.layout', LAYOUTS, 'nebeneinander');
  const nebeneinander = layout === 'nebeneinander';
  const geloescht = () => { setAuswahl(null); if (suche.objekt) void navigate({ to: '/objekte', search: {} }); };

  return (
    <Stack h="calc(100dvh - 56px - 2 * var(--mantine-spacing-md))" gap="sm">
      {/* Der Seitenname steht als Brotkrume in der Kopfzeile; Ansicht und Filter liegen dort im Menü. */}
      <AnsichtMenue filterModul="objects" aktuelleKriterien={objektAktuelleKriterien(status, text)} ansichtLabel="Ansicht" layout={layout} setLayout={setLayout} />

      <Chipleiste chips={STATUS_CHIPS} aktiv={status} waehlen={setStatus} suche={text} setSuche={setText} platzhalter="Suchen…"
        rechts={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={dialog.open}>Neues Objekt</Button>} />
      <GeteilteAnsicht
        schluessel="objekte" layout={layout} listeLabel="Objekt-Liste" detailLabel="Objekt-Detail" standardBreite={360} standardHoehe="38%"
        listeKopf={<Zaehlerleiste waehlen={setStatus} kennzahlen={LISTEN_STATUS.map((s) => ({ wert: s, label: s, anzahl: liste.zaehler[s] ?? 0, farbe: STATUS_FARBE[s] }))} />}
        liste={
          <>
            {isLoading && <Text c="dimmed">Lädt …</Text>}
            {!isLoading && liste.zeilen.length === 0 && <Text c="dimmed" ta="center" p="lg">🏢 Keine Objekte</Text>}
            {nebeneinander ? (
              <Stack gap={4}>
                {liste.zeilen.map((o) => (
                  <ObjektZeile key={o.id} objekt={o} aktiv={o.id === auswahl} waehlen={() => setAuswahl(o.id)} />
                ))}
              </Stack>
            ) : liste.zeilen.length > 0 && <ObjektTabelle zeilen={liste.zeilen} auswahlId={auswahl} waehlen={setAuswahl} />}
          </>
        }
        detail={auswahl ? <ObjektDetail key={auswahl} id={auswahl} geloescht={geloescht} /> : <Text c="dimmed">Objekt in der Liste wählen.</Text>}
      />

      <ObjektDialog offen={offen} schliessen={dialog.close} />
    </Stack>
  );
}

type ObjektZeileDaten = ReturnType<typeof objektListe>['zeilen'][number];

function ObjektZeile({ objekt, aktiv, waehlen }: { objekt: ObjektZeileDaten; aktiv: boolean; waehlen: () => void }) {
  return (
    <Listenzeile
      data-objekt={objekt.id}
      aktiv={aktiv}
      waehlen={waehlen}
      titel={objekt.adresse}
      unterzeile={`${objekt.ort} · ${objekt.makler} · ${objekt.angebotspreis}`}
      rechts={objekt.status ? <Badge variant="light" tt="none" color={STATUS_FARBE[objekt.status] ?? 'gray'}>{objekt.status}</Badge> : null}
    />
  );
}

/** Tabellenansicht wie alt: Bild | Adresse | Angeboten | Makler | Angebotspreis | Zielpreis | m² | Einh. | Kaltmiete/Jahr | Status */
function ObjektTabelle({ zeilen, auswahlId, waehlen }: { zeilen: ObjektZeileDaten[]; auswahlId: string | null; waehlen: (id: string) => void }) {
  return (
    <Table striped highlightOnHover aria-label="Objektliste" miw={900}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={58} /><Table.Th>Adresse</Table.Th><Table.Th>Angeboten</Table.Th><Table.Th>Makler</Table.Th><Table.Th>Angebotspreis</Table.Th>
          <Table.Th>Zielpreis</Table.Th><Table.Th>m²</Table.Th><Table.Th>Einh.</Table.Th><Table.Th>Kaltmiete/Jahr</Table.Th><Table.Th>Status</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {zeilen.map((o) => (
          <Table.Tr key={o.id} onClick={() => waehlen(o.id)} aria-selected={o.id === auswahlId} style={{ cursor: 'pointer' }} data-objekt={o.id}
            bg={o.id === auswahlId ? 'var(--gg-auswahl)' : undefined}>
            <Table.Td><Titelbild objektId={o.id} /></Table.Td>
            <Table.Td><Text fw={600} size="sm">{o.adresse}</Text><Text size="xs" c="dimmed">{o.ort}</Text></Table.Td>
            <Table.Td c="dimmed">{o.angeboten}</Table.Td>
            <Table.Td c="dimmed">{o.makler}</Table.Td>
            <Table.Td c="yellow.7">{o.angebotspreis}</Table.Td>
            <Table.Td>{o.zielpreis}</Table.Td>
            <Table.Td>{o.flaeche}</Table.Td>
            <Table.Td ta="center">{o.einheiten}</Table.Td>
            <Table.Td c="teal">{o.kaltmieteJahr}</Table.Td>
            <Table.Td>{o.status && <Badge variant="light" tt="none" color={STATUS_FARBE[o.status] ?? 'gray'}>{o.status}</Badge>}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ObjektDialog({ offen, schliessen }: { offen: boolean; schliessen: () => void }) {
  const anlegen = useObjektAnlegen();
  const [f, setF] = useState({ strasse: '', hausnr: '', plz: '', stadt: '' });
  const [preis, setPreis] = useState<number | string>('');

  return (
    <Modal opened={offen} onClose={schliessen} title="Neues Objekt" closeButtonProps={{ 'aria-label': 'Schließen' }}>
      <Stack>
        <Group grow>
          <TextInput label="Straße" value={f.strasse} onChange={(e) => setF({ ...f, strasse: e.currentTarget.value })} />
          <TextInput label="Hausnr." value={f.hausnr} onChange={(e) => setF({ ...f, hausnr: e.currentTarget.value })} />
        </Group>
        <Group grow>
          <TextInput label="PLZ" value={f.plz} onChange={(e) => setF({ ...f, plz: e.currentTarget.value })} />
          <TextInput label="Stadt" value={f.stadt} onChange={(e) => setF({ ...f, stadt: e.currentTarget.value })} />
        </Group>
        <NumberInput label="Angebotspreis (€)" min={0} thousandSeparator="." decimalSeparator="," value={preis} onChange={setPreis} />
        {anlegen.error && <Alert color="red">{anlegen.error.message}</Alert>}
        <Button
          loading={anlegen.isPending}
          onClick={() =>
            anlegen.mutate(
              {
                ...Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())),
                ...(typeof preis === 'number' ? { angebotspreis: preis } : {}),
              },
              {
                onSuccess: () => {
                  setF({ strasse: '', hausnr: '', plz: '', stadt: '' });
                  setPreis('');
                  schliessen();
                },
              },
            )
          }
        >
          Objekt anlegen
        </Button>
      </Stack>
    </Modal>
  );
}
