import type { ObjektDetail as Detail, ObjektEinheit } from '@gg/api-contract';
import {
  EINHEIT_TYPEN, ENERGIE_KLASSEN, OBJEKT_HAT_DEAL_HINWEIS, OBJEKT_LOESCHEN_FRAGE, OBJEKT_STATUS, objektAnzeige, objektEinheitAendern, objektEinheitenAnzeige, objektEinheitNeu, objektRecherche,
  VERMIETUNG_OPTIONEN,
} from '@gg/domain';
import { ActionIcon, Alert, Anchor, Button, Group, Loader, NativeSelect, NumberInput, Paper, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { ListeUmschalter } from './GeteilteAnsicht.tsx';
import { Reiterleiste } from './Reiterleiste.tsx';
import { IconDeviceFloppy, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useObjektAendern, useObjektDetail, useObjektLoeschen } from '../lib/api.ts';
import { alsZahl } from '../lib/format.ts';
import { ObjektFotos } from './ObjektFotos.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const ZAHL = { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } as const;
type Einheit = Omit<ObjektEinheit, 'id'> & { id?: string };

const ADRESSE = [['strasse', 'Straße'], ['hausnr', 'Hausnummer'], ['plz', 'PLZ'], ['stadt', 'Stadt']] as const;
const GEBAEUDE_ZAHLEN = [['baujahr', 'Baujahr'], ['einheitenAnzahl', 'Einheiten (gesamt)'], ['wohnflaeche', 'Wohnfläche m²'], ['grundstueck', 'Grundstück m²']] as const;
const PREISE = [['angebotspreis', 'Angebotspreis €'], ['zielpreis', 'Zielkaufpreis €'], ['istMiete', 'Ist-Miete/Mo €'], ['sollMiete', 'Soll-Miete/Mo €']] as const;

export function ObjektDetail({ id, geloescht }: { id: string; geloescht?: () => void }) {
  const { data: o, isLoading, error } = useObjektDetail(id);
  if (isLoading) return <Loader size="sm" />;
  if (error || !o) return <Alert color="red">{error?.message ?? 'Objekt nicht gefunden'}</Alert>;
  return <ObjektInhalt key={o.version} o={o} geloescht={geloescht} />;
}

function ObjektInhalt({ o, geloescht }: { o: Detail; geloescht?: () => void }) {
  const aendern = useObjektAendern(o.id);
  const loeschen = useObjektLoeschen();
  const [reiter, setReiter] = useState<string | null>('details');

  return (
    <Stack gap="sm">
      {aendern.error && <Alert color="red">{aendern.error.message}</Alert>}
      <Group justify="space-between">
        <Group gap="xs">
          <ListeUmschalter />
          <Text fz={11} c="dimmed" tt="uppercase" style={{ letterSpacing: '.05em' }}>Objekt-Status</Text>
          <StatusBadge status={o.status ?? ''} />
        </Group>
        <NativeSelect size="xs" aria-label="Objekt-Status" value={o.status ?? ''} data={OBJEKT_STATUS as unknown as string[]}
          onChange={(e) => aendern.mutate({ version: o.version, status: e.currentTarget.value })} />
      </Group>

      <Tabs value={reiter} onChange={setReiter} keepMounted={false}>
        <Reiterleiste>
          <Tabs.Tab value="details">📋 Details</Tabs.Tab>
          <Tabs.Tab value="bearbeiten">✏️ Bearbeiten</Tabs.Tab>
        </Reiterleiste>
        <Tabs.Panel value="details" pt="sm"><Details o={o} /></Tabs.Panel>
        <Tabs.Panel value="bearbeiten" pt="sm"><Formular o={o} /></Tabs.Panel>
      </Tabs>

      <ObjektFotos objektId={o.id} />

      <section aria-label="Deals zum Objekt">
        <Title order={5} mb="xs">Deals</Title>
        {o.deals.length === 0 && <Text c="dimmed" size="sm">Kein Deal.</Text>}
        {o.deals.map((d) => (
          <Group key={d.id} justify="space-between">
            <Text size="sm">{d.maklerName ?? 'ohne Makler'}</Text>
            <StatusBadge status={d.status} />
          </Group>
        ))}
      </section>

      {loeschen.error && <Alert color="red">{loeschen.error.message}</Alert>}
      <Group justify="flex-end">
        {o.deals.length > 0 && <Text size="xs" c="dimmed" data-hinweis="objekt-hat-deal">{OBJEKT_HAT_DEAL_HINWEIS}</Text>}
        <Button color="red" variant="light" leftSection={<IconTrash size={16} />} loading={loeschen.isPending} disabled={o.deals.length > 0}
          onClick={() => window.confirm(OBJEKT_LOESCHEN_FRAGE) && loeschen.mutate(o.id, { onSuccess: () => geloescht?.() })}>
          🗑 Löschen
        </Button>
      </Group>
    </Stack>
  );
}

function Feld({ label, wert }: { label: string; wert: string }) {
  return (
    <div data-feld={label}>
      <Text fz={10} c="dimmed" tt="uppercase" style={{ letterSpacing: '.05em' }}>{label}</Text>
      <Text size="sm">{wert}</Text>
    </div>
  );
}

/** 📋 Details (objDetailHTML): Lage, Recherche, Gebäude, Kennzahlen, Einheiten, Notizen. */
function Details({ o }: { o: Detail }) {
  const a = objektAnzeige(o);
  const e = objektEinheitenAnzeige(o.einheiten);
  return (
    <Stack gap="sm">
      <Paper withBorder p="sm" aria-label="Lage">
        <Title order={6} mb={6}>📍 Lage</Title>
        <SimpleGrid cols={{ base: 2, sm: 3 }}><Feld label="Adresse" wert={a.adresse} /><Feld label="PLZ / Stadt" wert={a.plzStadt} /></SimpleGrid>
      </Paper>
      <Paper withBorder p="sm" aria-label="Recherche">
        <Title order={6} mb={6}>🔗 Recherche</Title>
        <Group gap="xs">
          {objektRecherche(o).map((l) => (
            <Anchor key={l.label} href={l.url} target="_blank" rel="noopener" size="xs">{l.label}</Anchor>
          ))}
        </Group>
      </Paper>
      <Paper withBorder p="sm" aria-label="Gebäude">
        <Title order={6} mb={6}>🏢 Gebäude</Title>
        <SimpleGrid cols={{ base: 2, sm: 3 }}>
          <Feld label="Baujahr" wert={a.baujahr} /><Feld label="Einheiten" wert={a.einheiten} /><Feld label="Wohnfläche" wert={a.wohnflaeche} />
          <Feld label="Grundstück" wert={a.grundstueck} /><Feld label="Energieausweis" wert={a.energieklasse} /><Feld label="Heizungsart" wert={a.heizung} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="sm" aria-label="Kennzahlen">
        <Title order={6} mb={6}>💶 Kennzahlen</Title>
        <SimpleGrid cols={{ base: 2, sm: 3 }}>
          <Feld label="Angebotspreis" wert={a.angebotspreis} /><Feld label="Zielkaufpreis" wert={a.zielpreis} /><Feld label="Ist-Miete/Mo" wert={a.istMiete} />
          <Feld label="Soll-Miete/Mo" wert={a.sollMiete} /><Feld label="Rendite brutto" wert={a.renditeBrutto} /><Feld label="KP-Faktor" wert={a.kpFaktor} />
        </SimpleGrid>
      </Paper>
      {o.einheiten.length > 0 && (
        <Paper withBorder p="sm" aria-label="Einheiten des Objekts">
          <Title order={6} mb={6}>🏠 Einheiten</Title>
          <Table.ScrollContainer minWidth={560}>
            <Table striped>
              <Table.Thead>
                <Table.Tr><Table.Th>Typ</Table.Th><Table.Th>Lage</Table.Th><Table.Th>Zi/Stk</Table.Th><Table.Th>m²</Table.Th><Table.Th>Kaltmiete</Table.Th><Table.Th>€/m²</Table.Th><Table.Th>Status</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {e.zeilen.map((z, i) => (
                  <Table.Tr key={o.einheiten[i]!.id}>
                    <Table.Td>{z.typ}</Table.Td><Table.Td c="dimmed">{z.lage}</Table.Td><Table.Td>{z.anzahl}</Table.Td>
                    <Table.Td>{z.flaeche}</Table.Td><Table.Td>{z.kaltmiete}</Table.Td><Table.Td>{z.proQm}</Table.Td>
                    <Table.Td c={z.vermietung.startsWith('⬜') ? 'red' : 'teal'}>{z.vermietung}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {o.notizen && (
        <Paper withBorder p="sm" aria-label="Notizen">
          <Title order={6} mb={6}>📝 Notizen</Title>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{o.notizen}</Text>
        </Paper>
      )}
    </Stack>
  );
}

/** ✏️ Bearbeiten (objFormHTML + objSave): alle Felder und die Einheitenaufstellung. */
function Formular({ o }: { o: Detail }) {
  const aendern = useObjektAendern(o.id);
  const [t, setT] = useState<Record<string, string>>({
    strasse: o.strasse ?? '', hausnr: o.hausnr ?? '', plz: o.plz ?? '', stadt: o.stadt ?? '', bundesland: o.bundesland ?? '',
    energieklasse: o.energieklasse ?? '', heizung: o.heizung ?? '',
  });
  const [z, setZ] = useState<Record<string, number | string>>({
    baujahr: o.baujahr ?? '', einheitenAnzahl: o.einheitenAnzahl ?? '', wohnflaeche: o.wohnflaeche ?? '', grundstueck: o.grundstueck ?? '',
    angebotspreis: o.angebotspreis ?? '', zielpreis: o.zielpreis ?? '', istMiete: o.istMiete ?? '', sollMiete: o.sollMiete ?? '',
  });
  const [notizen, setNotizen] = useState(o.notizen ?? '');
  const [einheiten, setEinheiten] = useState<Einheit[]>(o.einheiten);
  const summen = objektEinheitenAnzeige(einheiten).summen;
  const aendereEinheit = (i: number, feld: Parameters<typeof objektEinheitAendern>[1], wert: string) =>
    setEinheiten((es) => es.map((e, j) => (j === i ? { ...e, ...objektEinheitAendern(e, feld, wert) } : e)));

  return (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Title order={6} mb={6}>📍 Lage & Adresse</Title>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {ADRESSE.map(([k, label]) => <TextInput key={k} label={label} value={t[k]} onChange={(e) => setT({ ...t, [k]: e.currentTarget.value })} />)}
          <TextInput label="Bundesland" value={t.bundesland} onChange={(e) => setT({ ...t, bundesland: e.currentTarget.value })} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="sm">
        <Title order={6} mb={6}>🏢 Gebäude</Title>
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          {GEBAEUDE_ZAHLEN.map(([k, label]) => (
            <NumberInput key={k} label={label} value={z[k]} onChange={(v) => setZ({ ...z, [k]: v })} {...ZAHL} thousandSeparator={k === 'baujahr' ? undefined : '.'} />
          ))}
          <NativeSelect label="Energieausweis" aria-label="Energieausweis" value={t.energieklasse} onChange={(e) => setT({ ...t, energieklasse: e.currentTarget.value })}
            data={[{ value: '', label: '– nicht bekannt –' }, ...ENERGIE_KLASSEN.map((k) => ({ value: k, label: k }))]} />
          <TextInput label="Heizungsart" placeholder="z.B. Gas-Zentralheizung" value={t.heizung} onChange={(e) => setT({ ...t, heizung: e.currentTarget.value })} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="sm">
        <Title order={6} mb={6}>💶 Kaufpreis & Mieteinnahmen</Title>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {PREISE.map(([k, label]) => <NumberInput key={k} label={label} value={z[k]} onChange={(v) => setZ({ ...z, [k]: v })} {...ZAHL} />)}
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="sm" aria-label="Einheitenaufstellung">
        <Title order={6} mb={6}>🏠 Einheitenaufstellung</Title>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing={4} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr><Table.Th>Typ</Table.Th><Table.Th>Lage</Table.Th><Table.Th>Zi / Stk</Table.Th><Table.Th>m²</Table.Th><Table.Th>Kaltmiete €</Table.Th><Table.Th>€/m²</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {einheiten.map((e, i) => {
                const stpl = e.typ === 'Stellplatz';
                const proQm = objektEinheitenAnzeige([e]).zeilen[0]!.proQm;
                return (
                  <Table.Tr key={e.id ?? `neu-${i}`}>
                    <Table.Td><NativeSelect size="xs" w={110} aria-label="Typ" value={e.typ ?? 'Wohnung'} data={EINHEIT_TYPEN as unknown as string[]} onChange={(ev) => aendereEinheit(i, 'typ', ev.currentTarget.value)} /></Table.Td>
                    <Table.Td><TextInput size="xs" w={90} aria-label="Lage" placeholder="EG links" value={e.lage ?? ''} onChange={(ev) => aendereEinheit(i, 'lage', ev.currentTarget.value)} /></Table.Td>
                    <Table.Td>
                      <TextInput size="xs" w={60} type="number" step={stpl ? 1 : 0.5} aria-label={stpl ? 'Stück' : 'Zimmer'} placeholder={stpl ? 'Stk' : 'Zi'}
                        value={String((stpl ? e.stueck : e.zimmer) ?? '')} onChange={(ev) => aendereEinheit(i, stpl ? 'stueck' : 'zimmer', ev.currentTarget.value)} />
                    </Table.Td>
                    <Table.Td>
                      {stpl ? <Text size="xs" c="dimmed">–</Text>
                        : <TextInput size="xs" w={70} type="number" aria-label="Fläche" placeholder="75" value={String(e.flaeche ?? '')} onChange={(ev) => aendereEinheit(i, 'flaeche', ev.currentTarget.value)} />}
                    </Table.Td>
                    <Table.Td><TextInput size="xs" w={80} type="number" aria-label="Kaltmiete" placeholder="800" value={String(e.kaltmiete ?? '')} onChange={(ev) => aendereEinheit(i, 'kaltmiete', ev.currentTarget.value)} /></Table.Td>
                    <Table.Td><Text size="xs" c={proQm === '–' ? 'dimmed' : 'yellow.7'} data-proqm>{proQm}</Text></Table.Td>
                    <Table.Td>
                      <NativeSelect size="xs" w={120} aria-label="Vermietung" value={e.vermietung === 'Leerstand' ? 'Leerstand' : 'Vermietet'}
                        data={VERMIETUNG_OPTIONEN.map((v) => ({ value: v.wert, label: v.label }))} onChange={(ev) => aendereEinheit(i, 'vermietung', ev.currentTarget.value)} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" aria-label="Einheit entfernen" onClick={() => setEinheiten((es) => es.filter((_, j) => j !== i))}><IconTrash size={14} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr><Table.Th colSpan={3}>∑</Table.Th><Table.Th data-summe="flaeche">{summen.flaeche}</Table.Th><Table.Th data-summe="kaltmiete">{summen.kaltmiete}</Table.Th><Table.Th data-summe="proQm">{summen.proQm}</Table.Th><Table.Th colSpan={2} /></Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
        <Group gap="xs" mt={6}>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEinheiten((es) => [...es, objektEinheitNeu() as Einheit])}>Wohnung / Gewerbe</Button>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEinheiten((es) => [...es, objektEinheitNeu('Stellplatz') as Einheit])}>Stellplatz</Button>
        </Group>
      </Paper>

      <Textarea label="📝 Notizen" placeholder="Besonderheiten…" autosize minRows={2} value={notizen} onChange={(e) => setNotizen(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button leftSection={<IconDeviceFloppy size={16} />} loading={aendern.isPending}
          onClick={() => aendern.mutate({
            version: o.version,
            ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.trim() || undefined])),
            ...Object.fromEntries(Object.entries(z).map(([k, v]) => [k, alsZahl(v)])),
            notizen: notizen || null,
            einheiten: einheiten.map((e) => ({ ...e, typ: e.typ ?? 'Wohnung', vermietung: e.vermietung ?? 'Vermietet' })),
          })}>
          Speichern
        </Button>
      </Group>
    </Stack>
  );
}
