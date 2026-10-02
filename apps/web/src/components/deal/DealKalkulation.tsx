import type { DealDetail, DealEinheit, DealSanierung, KalkulationWerte } from '@gg/api-contract';
import {
  type AnkaufErgebnis,
  aufteilungskostenVorschlag,
  berechneAnkauf,
  KALK_UNGESPEICHERT_FRAGE,
  einheitAlsEingabe,
  KALK_STANDARD,
  type KalkStandard,
  margenAmpel,
  sanierungAlsEingabe, kalkMitStandard } from '@gg/domain';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDeviceFloppy, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKalkStandard, useKalkulationSpeichern } from '../../lib/api.ts';
import { alsZahl, euro, euroProQm, prozent } from '../../lib/format.ts';
import { useUngespeichert } from '../../lib/ungespeichert.ts';
import { AlleSetzen, Variantenleiste } from './KalkWerkzeuge.tsx';
import { PropstackDialog } from './PropstackDialog.tsx';
import css from './DealDetail.module.css';

type Einheit = Omit<DealEinheit, 'id'> & { id?: string };
type Sanierung = Omit<DealSanierung, 'id'> & { id?: string };

const ZAHL = { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } as const;

/** Eingabefelder der Ankaufskalkulation; leer = Standardwert aus den Einstellungen. */
const FELDER: { feld: keyof KalkStandard | 'kaufpreis' | 'aufk' | 'rp_pct' | 'rp_fix'; label: string; einheit: string }[] = [
  { feld: 'kaufpreis', label: 'Kaufpreis', einheit: '€' },
  { feld: 'notar', label: 'Notar', einheit: '%' },
  { feld: 'gest', label: 'Grunderwerbsteuer', einheit: '%' },
  { feld: 'makler', label: 'Maklerprovision', einheit: '%' },
  { feld: 'fk_p', label: 'Fremdkapital', einheit: '%' },
  { feld: 'ek_p', label: 'Eigenkapital', einheit: '%' },
  { feld: 'euribor', label: 'Euribor', einheit: '%' },
  { feld: 'margeB', label: 'Marge Bank', einheit: '%' },
  { feld: 'bank_abgeb', label: 'Abschlussgebühr Bank', einheit: '%' },
  { feld: 'ek_r', label: 'EK-Rendite p. a.', einheit: '%' },
  { feld: 'halt', label: 'Haltedauer', einheit: 'Monate' },
  { feld: 'vprov', label: 'Vertriebsprovision', einheit: '%' },
  { feld: 'glo_m', label: 'Marge Global', einheit: '%' },
  { feld: 'rp_pct', label: 'Risikopuffer Sanierung', einheit: '%' },
  { feld: 'rp_fix', label: 'Risikopuffer fest (vorrangig)', einheit: '€' },
  { feld: 'aufk', label: 'Aufteilungskosten', einheit: '€' },
];

const AMPEL_FARBE = { gruen: 'green', gelb: 'yellow', rot: 'red', verlust: 'red' } as const;

/** `leistenPlatz`: fester Platz unter der Reiterleiste des Deals — dorthin kommt die Knopfleiste, damit sie beim Scrollen stehen bleibt. */
export function DealKalkulation({ deal, leistenPlatz }: { deal: DealDetail; leistenPlatz: HTMLElement | null }) {
  const { data: standard = KALK_STANDARD } = useKalkStandard();
  const speichern = useKalkulationSpeichern(deal.id);
  const [kalk, setKalk] = useState<KalkulationWerte>(deal.kalkulation);
  const [einheiten, setEinheiten] = useState<Einheit[]>(deal.einheiten);
  const [sanierungen, setSanierungen] = useState<Sanierung[]>(deal.sanierungen);

  const ergebnis = useMemo(
    () => berechneAnkauf(kalkMitStandard(kalk, standard), einheiten.map(einheitAlsEingabe), sanierungen.map(sanierungAlsEingabe), standard),
    [kalk, einheiten, sanierungen, standard],
  );
  const geaendert =
    JSON.stringify([kalk, einheiten, sanierungen]) !== JSON.stringify([deal.kalkulation, deal.einheiten, deal.sanierungen]);
  // Reiterwechsel und ein anderer Deal bauen die Kalkulation neu auf — ohne Rückfrage wären die Eingaben still verloren
  useUngespeichert(geaendert, KALK_UNGESPEICHERT_FRAGE);

  const setzeFeld = (feld: string, v: number | string) => {
    const n = alsZahl(v);
    setKalk((k) => {
      const neu = { ...k };
      if (n === null) delete neu[feld];
      else neu[feld] = n;
      // FK und EK ergänzen sich zu 100 % (wie dkSyncEk/dkSyncFk)
      if (feld === 'fk_p' && n !== null) neu.ek_p = Math.max(0, 100 - n);
      if (feld === 'ek_p' && n !== null) neu.fk_p = Math.max(0, 100 - n);
      return neu;
    });
  };
  const zahlAus = (feld: string) => (typeof kalk[feld] === 'number' ? (kalk[feld] as number) : '');

  // Links die Varianten, rechts Verwerfen und Speichern — in einer Leiste, die mit der Reiterleiste stehen bleibt
  const leiste = (
    <div className={css.leiste} role="group" aria-label="Kalkulation speichern und Varianten">
      <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
        <Variantenleiste
          dealId={deal.id}
          aktuell={{ kalkulation: kalk, einheiten, sanierungen }}
          laden={(v) => {
            setKalk(v.kalkulation);
            setEinheiten(v.einheiten);
            setSanierungen(v.sanierungen);
          }}
        />
        <Stack gap={4} align="flex-end">
          <Group gap="xs" wrap="nowrap">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRestore size={16} />}
              disabled={!geaendert}
              onClick={() => {
                setKalk(deal.kalkulation);
                setEinheiten(deal.einheiten);
                setSanierungen(deal.sanierungen);
              }}
            >
              Verwerfen
            </Button>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={16} />}
              disabled={!geaendert}
              loading={speichern.isPending}
              onClick={() => speichern.mutate({ version: deal.version, kalkulation: kalk, einheiten, sanierungen })}
            >
              Speichern
            </Button>
          </Group>
          {geaendert && <Badge color="orange">ungespeichert</Badge>}
        </Stack>
      </Group>
      {speichern.error && (
        <Alert color="red" py={4} mt={6}>
          {speichern.error.message}
        </Alert>
      )}
    </div>
  );

  return (
    <Stack>
      {leistenPlatz && createPortal(leiste, leistenPlatz)}

      <Ergebnis ergebnis={ergebnis} />

      <Paper withBorder p="sm">
        <Title order={5} mb="xs">
          Annahmen
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="xs">
          {FELDER.map(({ feld, label, einheit }) => (
            <NumberInput
              key={feld}
              label={label}
              rightSection={<Text size="xs" c="dimmed" pr={6}>{einheit}</Text>}
              rightSectionWidth={einheit === 'Monate' ? 56 : 28}
              placeholder={feld in standard ? String(standard[feld as keyof KalkStandard]).replace('.', ',') : feld === 'rp_pct' ? '10' : ''}
              value={zahlAus(feld)}
              onChange={(v) => setzeFeld(feld, v)}
              {...ZAHL}
            />
          ))}
        </SimpleGrid>
        <Group mt="xs" gap="xs" align="flex-end">
          <NumberInput label="Anzahl Häuser" w={110} value={zahlAus('auf_h')} placeholder={String(standard.auf_h)} onChange={(v) => setzeFeld('auf_h', v)} {...ZAHL} />
          <NumberInput label="Anzahl Einheiten" w={130} value={zahlAus('auf_e')} placeholder={String(standard.auf_e)} onChange={(v) => setzeFeld('auf_e', v)} {...ZAHL} />
          <Button
            variant="light"
            onClick={() => setzeFeld('aufk', aufteilungskostenVorschlag(Number(kalk.auf_h ?? 0), Number(kalk.auf_e ?? 0)))}
          >
            = {euro(aufteilungskostenVorschlag(Number(kalk.auf_h ?? 0), Number(kalk.auf_e ?? 0)), '0 €')} als Aufteilungskosten übernehmen
          </Button>
        </Group>
      </Paper>

      <EinheitenTabelle dealId={deal.id} einheiten={einheiten} setEinheiten={setEinheiten} ergebnis={ergebnis} standardRendite={standard.rend_k} />
      <SanierungenTabelle sanierungen={sanierungen} setSanierungen={setSanierungen} ergebnis={ergebnis} />
    </Stack>
  );
}

function Zeile({ label, wert, stark, k }: { label: string; wert: string; stark?: boolean; k?: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" data-kennzahl={k} data-wert={wert}>
      <Text size="sm" c={stark ? undefined : 'dimmed'} fw={stark ? 600 : 400}>
        {label}
      </Text>
      <Text size="sm" fw={stark ? 700 : 400} ta="right">
        {wert}
      </Text>
    </Group>
  );
}

function Ampel({ marge, k }: { marge: number; k?: string }) {
  const a = margenAmpel(marge);
  return <Badge color={AMPEL_FARBE[a]} data-kennzahl={k} data-wert={Number.isFinite(marge) ? marge.toFixed(1) : ''}>{a === 'verlust' ? 'Verlust' : prozent(marge)}</Badge>;
}

function Ergebnis({ ergebnis: r }: { ergebnis: AnkaufErgebnis }) {
  const a = r.aufteiler, g = r.global, wf = r.einheiten.wohnflaeche;
  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="sm" aria-label="Ergebnis">
      <Paper withBorder p="sm">
        <Title order={5} mb={6}>Anschaffung</Title>
        <Zeile k="kaufpreis" label="Kaufpreis" wert={euro(r.kaufpreis)} />
        <Zeile k="notar" label="Notar" wert={euro(r.notar)} />
        <Zeile k="grunderwerbsteuer" label="Grunderwerbsteuer" wert={euro(r.grunderwerbsteuer)} />
        <Zeile k="makler" label="Makler" wert={euro(r.maklerprovision)} />
        <Divider my={4} />
        <Zeile k="anschaffungskosten" label="Anschaffungskosten" wert={euro(r.anschaffungskosten)} stark />
        <Zeile k="kaufpreis-m2" label="Kaufpreis je m²" wert={wf ? euroProQm(r.kaufpreis / wf) : '–'} />
        <Zeile k="rendite-kp" label="Mietrendite auf Kaufpreis" wert={r.kaufpreis ? prozent((r.jahresmieteIst / r.kaufpreis) * 100, 2) : '–'} />
        <Zeile k="mietabzug" label={`Mieten ${r.haltedauerMonate} Monate`} wert={r.mietabzug ? `– ${euro(r.mietabzug)}` : '–'} />
      </Paper>
      <Paper withBorder p="sm" aria-label="Aufteiler">
        <Group justify="space-between" mb={6}>
          <Title order={5}>Aufteiler</Title>
          <Ampel k="aufteiler.marge" marge={a.marge} />
        </Group>
        <Zeile k="aufteiler.sanierung" label="Sanierung + Puffer" wert={euro(a.sanierung + a.sanierungPuffer)} />
        <Zeile k="aufteiler.vertriebsprovision" label="Vertriebsprovision" wert={euro(r.vertriebsprovision)} />
        <Zeile k="aufteiler.teilungskosten" label="Aufteilungskosten" wert={euro(r.teilungskosten)} />
        <Zeile k="aufteiler.fkz" label="FK-Zinsen" wert={euro(a.fkZinsen)} />
        <Zeile k="aufteiler.bankabgeb" label="Abschlussgebühr Bank" wert={euro(a.bankAbschluss)} />
        <Zeile k="aufteiler.ekk" label="EK-Kosten" wert={euro(a.ekKosten)} />
        <Divider my={4} />
        <Zeile k="aufteiler.gik" label="Gesamtinvestition (GIK)" wert={euro(a.gik)} stark />
        <Zeile k="aufteiler.verkaufspreis" label="Verkaufspreise Einheiten" wert={euro(a.verkaufspreis)} />
        <Zeile k="aufteiler.gewinn" label="Gewinn" wert={euro(a.gewinn)} stark />
      </Paper>
      <Paper withBorder p="sm" aria-label="Global">
        <Group justify="space-between" mb={6}>
          <Title order={5}>Global</Title>
          <Ampel k="global.marge" marge={g.marge} />
        </Group>
        <Zeile k="global.sanierung" label="Sanierung + Puffer" wert={euro(g.sanierung + g.sanierungPuffer)} />
        <Zeile k="global.fkz" label="FK-Zinsen" wert={euro(g.fkZinsen)} />
        <Zeile k="global.bankabgeb" label="Abschlussgebühr Bank" wert={euro(g.bankAbschluss)} />
        <Zeile k="global.ekk" label="EK-Kosten" wert={euro(g.ekKosten)} />
        <Divider my={4} />
        <Zeile k="global.gik" label="Gesamtinvestition (GIK)" wert={euro(g.gik)} stark />
        <Zeile k="global.verkaufspreis" label="Verkaufspreis" wert={euro(g.verkaufspreis)} />
        <Zeile k="global.faktor" label="Faktor / Rendite" wert={g.faktor ? `${g.faktor.toFixed(1).replace('.', ',')}x · ${prozent(g.kaufpreisrendite, 2)}` : '–'} />
        <Zeile k="global.gewinn" label="Gewinn" wert={euro(g.gewinn)} stark />
      </Paper>
    </SimpleGrid>
  );
}

const TYPEN = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'];

function EinheitenTabelle({
  dealId,
  einheiten,
  setEinheiten,
  ergebnis,
  standardRendite,
}: {
  dealId: string;
  einheiten: Einheit[];
  setEinheiten: (f: (e: Einheit[]) => Einheit[]) => void;
  ergebnis: AnkaufErgebnis;
  standardRendite: number;
}) {
  const aendere = (i: number, teil: Partial<Einheit>) => setEinheiten((es) => es.map((e, j) => (j === i ? { ...e, ...teil } : e)));
  const s = ergebnis.einheiten;
  const [propstack, setPropstack] = useState<string | null>(null);
  return (
    <Paper withBorder p="sm" aria-label="Einheiten">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Einheiten</Title>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() =>
            setEinheiten((es) => [...es, { typ: 'Wohnung', lage: null, zimmer: null, flaeche: null, mieteIst: null, mieteNeu: null, mieteNeuManuell: false, renditeK: null, verkaufspreis: null, stueck: null }])
          }
        >
          Einheit
        </Button>
      </Group>
      <AlleSetzen dealId={dealId} einheiten={einheiten} setEinheiten={(neu) => setEinheiten(() => neu)} standardRendite={standardRendite} />
      <Table.ScrollContainer minWidth={1100}>
        <Table verticalSpacing={4} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Typ</Table.Th><Table.Th>Lage</Table.Th><Table.Th>Zi./Stk.</Table.Th><Table.Th>Fläche</Table.Th>
              <Table.Th>Miete ist</Table.Th><Table.Th>€/m² ist</Table.Th><Table.Th>Miete neu</Table.Th><Table.Th>€/m² neu</Table.Th>
              <Table.Th>Rendite %</Table.Th><Table.Th>Verkaufspreis</Table.Th><Table.Th>€/m²</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {einheiten.map((e, i) => {
              const z = ergebnis.einheiten.zeilen[i];
              const stpl = e.typ === 'Stellplatz';
              return (
                <Table.Tr key={e.id ?? `neu-${i}`}>
                  <Table.Td><Select size="xs" w={110} data={TYPEN} value={e.typ} allowDeselect={false} onChange={(v) => aendere(i, { typ: v })} aria-label="Typ" /></Table.Td>
                  <Table.Td><TextInput size="xs" w={90} value={e.lage ?? ''} onChange={(ev) => aendere(i, { lage: ev.currentTarget.value || null })} aria-label="Lage" /></Table.Td>
                  <Table.Td>
                    {stpl ? (
                      <NumberInput size="xs" w={60} value={e.stueck ?? ''} onChange={(v) => aendere(i, { stueck: alsZahl(v) })} aria-label="Stück" {...ZAHL} />
                    ) : (
                      <NumberInput size="xs" w={60} value={e.zimmer ?? ''} onChange={(v) => aendere(i, { zimmer: alsZahl(v) })} aria-label="Zimmer" {...ZAHL} />
                    )}
                  </Table.Td>
                  <Table.Td>{stpl ? '–' : <NumberInput size="xs" w={80} value={e.flaeche ?? ''} onChange={(v) => aendere(i, { flaeche: alsZahl(v) })} aria-label="Fläche" {...ZAHL} />}</Table.Td>
                  <Table.Td><NumberInput size="xs" w={90} value={e.mieteIst ?? ''} onChange={(v) => aendere(i, { mieteIst: alsZahl(v) })} aria-label="Miete ist" {...ZAHL} /></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{z?.kaltmieteProQmIst ? z.kaltmieteProQmIst.toFixed(2).replace('.', ',') : ''}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      <NumberInput
                        size="xs"
                        w={90}
                        placeholder={e.mieteIst ? String(e.mieteIst).replace('.', ',') : ''}
                        value={e.mieteNeuManuell ? (e.mieteNeu ?? '') : ''}
                        onChange={(v) => aendere(i, { mieteNeu: alsZahl(v), mieteNeuManuell: alsZahl(v) !== null })}
                        aria-label="Miete neu"
                        {...ZAHL}
                      />
                      <Checkbox size="xs" checked={e.mieteNeuManuell} onChange={(ev) => aendere(i, { mieteNeuManuell: ev.currentTarget.checked })} aria-label="Miete neu manuell" title="manuell" />
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{z?.kaltmieteProQmSoll ? z.kaltmieteProQmSoll.toFixed(2).replace('.', ',') : ''}</Text></Table.Td>
                  <Table.Td><NumberInput size="xs" w={70} value={e.renditeK ?? ''} onChange={(v) => aendere(i, { renditeK: alsZahl(v) })} aria-label="Rendite" {...ZAHL} /></Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      w={110}
                      placeholder={z?.verkaufspreis ? z.verkaufspreis.toLocaleString('de-DE') : ''}
                      value={e.verkaufspreis ?? ''}
                      onChange={(v) => aendere(i, { verkaufspreis: alsZahl(v) })}
                      aria-label="Verkaufspreis"
                      {...ZAHL}
                    />
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">{z?.verkaufspreisProQm ? z.verkaufspreisProQm.toLocaleString('de-DE') : ''}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      {!stpl && e.id && (
                        <ActionIcon variant="subtle" color="yellow" aria-label="Bewertung über Propstack" title="An Propstack senden zur Bewertung" onClick={() => setPropstack(e.id!)}>
                          📊
                        </ActionIcon>
                      )}
                      <ActionIcon variant="subtle" color="red" onClick={() => setEinheiten((es) => es.filter((_, j) => j !== i))} aria-label="Einheit entfernen">
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th colSpan={3}>{s.anzahlEinheiten} Einh. · {s.anzahlStellplaetze} Stpl.</Table.Th>
              <Table.Th>{s.wohnflaeche ? `${s.wohnflaeche.toLocaleString('de-DE')} m²` : '–'}</Table.Th>
              <Table.Th>{euro(s.mieteIst)}</Table.Th>
              <Table.Th />
              <Table.Th>{euro(s.mieteSoll)}</Table.Th>
              <Table.Th />
              <Table.Th>{s.verkaufspreise && s.mieteSoll ? prozent(((s.mieteSoll * 12) / s.verkaufspreise) * 100) : '–'}</Table.Th>
              <Table.Th>{euro(s.verkaufspreise)}</Table.Th>
              <Table.Th colSpan={2}>{s.wohnflaeche && s.verkaufspreise ? euroProQm(s.verkaufspreise / s.wohnflaeche) : ''}</Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
      <PropstackDialog dealId={dealId} einheitId={propstack} schliessen={() => setPropstack(null)} />
    </Paper>
  );
}

const BEREICHE = [
  { value: 'both', label: 'beide' },
  { value: 'auf', label: 'nur Aufteiler' },
  { value: 'glo', label: 'nur Global' },
];

function SanierungenTabelle({
  sanierungen,
  setSanierungen,
  ergebnis,
}: {
  sanierungen: Sanierung[];
  setSanierungen: (f: (s: Sanierung[]) => Sanierung[]) => void;
  ergebnis: AnkaufErgebnis;
}) {
  const aendere = (i: number, teil: Partial<Sanierung>) => setSanierungen((ss) => ss.map((s, j) => (j === i ? { ...s, ...teil } : s)));
  return (
    <Paper withBorder p="sm" aria-label="Sanierung">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Sanierung</Title>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setSanierungen((ss) => [...ss, { beschreibung: null, betrag: null, bereich: 'both' }])}>
          Posten
        </Button>
      </Group>
      <Stack gap={6}>
        {sanierungen.map((s, i) => (
          <Group key={s.id ?? `neu-${i}`} gap="xs" wrap="nowrap">
            <TextInput size="xs" style={{ flex: 1 }} placeholder="Beschreibung" value={s.beschreibung ?? ''} onChange={(e) => aendere(i, { beschreibung: e.currentTarget.value || null })} aria-label="Beschreibung" />
            <NumberInput size="xs" w={120} placeholder="Betrag €" value={s.betrag ?? ''} onChange={(v) => aendere(i, { betrag: alsZahl(v) })} aria-label="Betrag" {...ZAHL} />
            <Select size="xs" w={140} data={BEREICHE} value={s.bereich ?? 'both'} allowDeselect={false} onChange={(v) => aendere(i, { bereich: v as Sanierung['bereich'] })} aria-label="Bereich" />
            <ActionIcon variant="subtle" color="red" onClick={() => setSanierungen((ss) => ss.filter((_, j) => j !== i))} aria-label="Posten entfernen">
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Group justify="flex-end" gap="lg">
          <Text size="sm">Netto {euro(ergebnis.sanierungNetto)}</Text>
          <Text size="sm">Puffer {euro(ergebnis.sanierungPuffer)}</Text>
          <Text size="sm" fw={700}>Gesamt {euro(ergebnis.sanierungNetto + ergebnis.sanierungPuffer)}</Text>
        </Group>
      </Stack>
    </Paper>
  );
}
