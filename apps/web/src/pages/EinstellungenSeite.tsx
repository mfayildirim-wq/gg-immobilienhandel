import type { KundenkalkEinstellungen } from '@gg/api-contract';
import { KALK_STANDARD, type KalkStandard, KUNDENKALK_STANDARD, type KundenkalkStandard } from '@gg/domain';
import { Alert, Button, Group, NumberInput, Paper, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useState } from 'react';
import { useKalkStandard, useKalkStandardSpeichern, useKundenkalkEinstellungen, useKundenkalkEinstellungenSpeichern } from '../lib/api.ts';

const LABEL: Record<keyof KalkStandard, string> = {
  notar: 'Notar %', gest: 'Grunderwerbsteuer %', makler: 'Maklerprovision %', fk_p: 'Fremdkapital %', ek_p: 'Eigenkapital %',
  euribor: 'Euribor %', margeB: 'Marge Bank %', bank_abgeb: 'Abschlussgebühr Bank %', ek_r: 'EK-Rendite p. a. %', halt: 'Haltedauer Monate',
  vprov: 'Vertriebsprovision %', glo_m: 'Marge Global %', rp_pct: 'Risikopuffer %', rend_k: 'Ziel-Rendite Einheiten %',
  auf_h: 'Aufteilung: Häuser', auf_e: 'Aufteilung: Einheiten',
};

/** Einstellungen → Kalkulation: Standardwerte der Ankaufskalkulation. */
export function KalkulationEinstellungen() {
  const { data, isLoading } = useKalkStandard();
  if (isLoading || !data) return <Text c="dimmed">Lädt …</Text>;
  return <Formular key={JSON.stringify(data)} start={data} />;
}

function Formular({ start }: { start: KalkStandard }) {
  const speichern = useKalkStandardSpeichern();
  const [w, setW] = useState<KalkStandard>(start);
  return (
    <Stack maw={900}>
      <Paper withBorder p="md" component="section" aria-label="Kalkulation Einstellungen">
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Kalkulations-Standardwerte</Title>
            <Text size="sm" c="dimmed">Gelten in jeder Ankaufskalkulation, in der das Feld leer ist.</Text>
          </div>
          <Group gap="xs">
            <Button variant="default" onClick={() => setW(KALK_STANDARD)}>Werkseinstellung</Button>
            <Button leftSection={<IconDeviceFloppy size={16} />} loading={speichern.isPending} onClick={() => speichern.mutate(w)}>Speichern</Button>
          </Group>
        </Group>
        {speichern.error && <Alert color="red" mb="sm">{speichern.error.message}</Alert>}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {(Object.keys(LABEL) as (keyof KalkStandard)[]).map((k) => (
            <NumberInput key={k} label={LABEL[k]} decimalSeparator="," hideControls value={w[k]} onChange={(v) => typeof v === 'number' && setW({ ...w, [k]: v })} />
          ))}
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}

const KK_LABEL: Record<keyof KundenkalkStandard, string> = {
  notarPct: 'Notar %', grundbuchPct: 'Grundbuch %', grundsteuerPct: 'Grunderwerbsteuer %', maklerPct: 'Makler %', sonstigePct: 'Sonstige %',
  wertsteigerungJaehrlich: 'Wertsteigerung %/J.', mieterhoehungJaehrlich: 'Mietsteigerung %/J.', kostensteigerungJaehrlich: 'Kostensteigerung %/J.',
  anteilGebaeudeKaufpreis: 'Anteil Gebäude %', afaSatz: 'AfA-Satz %', grenzsteuersatz: 'Steuersatz %', betrachtungsdauerJahre: 'Betrachtungsdauer Jahre',
  default_zinssatz: 'Zinssatz %', default_tilgung: 'Tilgung %', default_fk_anteil_kp: 'Fremdkapital % vom KP',
};

/** Standardannahmen Kundenkalkulation: gelten für neu angelegte Kalkulationen. */
export function KundenkalkEinstellungenFormular() {
  const { data } = useKundenkalkEinstellungen();
  const speichern = useKundenkalkEinstellungenSpeichern();
  const [w, setW] = useState<KundenkalkEinstellungen | null>(null);
  const aktuell = w ?? data;
  if (!aktuell) return null;
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Title order={4}>Standardannahmen Kundenkalkulation</Title>
          <Text size="sm" c="dimmed">Werden in jede neue Kundenkalkulation übernommen.</Text>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => setW({ ...aktuell, standard: KUNDENKALK_STANDARD })}>Werkseinstellung</Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={speichern.isPending} onClick={() => speichern.mutate(aktuell, { onSuccess: () => setW(null) })}>Speichern</Button>
        </Group>
      </Group>
      {speichern.error && <Alert color="red" mb="sm">{speichern.error.message}</Alert>}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {(Object.keys(KK_LABEL) as (keyof KundenkalkStandard)[]).map((k) => (
          <NumberInput key={k} label={KK_LABEL[k]} decimalSeparator="," hideControls value={aktuell.standard[k]} onChange={(v) => typeof v === 'number' && setW({ ...aktuell, standard: { ...aktuell.standard, [k]: v } })} />
        ))}
      </SimpleGrid>
      <Textarea mt="sm" label="Zentrale Hinweise (eine Zeile je Hinweis)" autosize minRows={3} value={aktuell.hinweise.join('\n')} onChange={(e) => setW({ ...aktuell, hinweise: e.currentTarget.value.split('\n') })} />
      <TextInput mt="sm" label="Ersteller im Bankgespräch-PDF (leer = GG Immohandel)" value={aktuell.ersteller} onChange={(e) => setW({ ...aktuell, ersteller: e.currentTarget.value })} />
      <Textarea mt="sm" label="Disclaimer (leer = Standardtext der Vorlage)" autosize minRows={3} value={aktuell.disclaimer} onChange={(e) => setW({ ...aktuell, disclaimer: e.currentTarget.value })} />
    </Paper>
  );
}
