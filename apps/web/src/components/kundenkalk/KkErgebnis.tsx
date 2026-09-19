import type { KKalkOutputs } from '@gg/domain';
import { Divider, Group, Paper, SimpleGrid, Table, Text, Title } from '@mantine/core';
import { euro, prozent } from '../../lib/format.ts';

const zeile = (label: string, wert: string, stark = false, farbe?: string) => (
  <Group key={label} justify="space-between" gap="xs" wrap="nowrap">
    <Text size="sm" c={stark ? undefined : 'dimmed'} fw={stark ? 600 : 400}>{label}</Text>
    <Text size="sm" fw={stark ? 700 : 400} c={farbe} style={{ fontVariantNumeric: 'tabular-nums' }}>{wert}</Text>
  </Group>
);
const vz = (n: number) => (n < 0 ? 'red' : undefined);
const eurGenau = (n: number) => `${Math.round(n).toLocaleString('de-DE')} €`;

/** Ergebnis der Kundenkalkulation (Engine live). Die PDF-Vorschau im Bankgespräch-Layout folgt mit dem Dokumenten-Paket. */
export function KkErgebnis({ out, dauer }: { out: KKalkOutputs; dauer: number }) {
  const i = out.investition, f = out.finanzierung, j1 = out.kennzahlen_jahr_1, b = out.bankgespraech, h = b.hochrechnungVerkauf, m = out.matrix;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm" aria-label="Ergebnis Kundenkalkulation">
      <Paper withBorder p="sm">
        <Title order={5} mb={6}>Investition</Title>
        {zeile('Kaufpreis je m²', i.kaufpreisProQm ? `${Math.round(i.kaufpreisProQm).toLocaleString('de-DE')} €/m²` : '–')}
        {zeile('Nebenkosten', eurGenau(i.nebenkostenEuroTotal))}
        {zeile('Sanierung (käuferfinanziert)', eurGenau(i.renovierungSumme))}
        {i.renovierungWegRuecklage ? zeile('Sanierung aus WEG-Rücklage', eurGenau(i.renovierungWegRuecklage)) : null}
        <Divider my={4} />
        {zeile('Gesamtinvestition (GIK)', eurGenau(i.gik), true)}
        {zeile('AfA pro Jahr', eurGenau(i.afaProJahrTotal))}
      </Paper>
      <Paper withBorder p="sm">
        <Title order={5} mb={6}>Finanzierung</Title>
        {zeile('Darlehen gesamt', eurGenau(f.darlehensummeGesamt))}
        {zeile('Eigenkapital', eurGenau(f.eigenkapital), true, vz(f.eigenkapital))}
        {zeile('Zinssatz (gewichtet)', prozent(f.gewichteterZinssatz * 100, 2))}
        {zeile('Tilgung (gewichtet)', prozent(f.gewichteteTilgung * 100, 2))}
        {zeile('Kapitaldienst pro Monat', eurGenau(f.kapitaldienstProMonat))}
      </Paper>
      <Paper withBorder p="sm">
        <Title order={5} mb={6}>Kennzahlen Jahr 1</Title>
        {zeile('Bruttomietrendite', prozent(j1.bruttomietrendite * 100, 2))}
        {zeile('Faktor', j1.faktor ? `${j1.faktor.toFixed(1).replace('.', ',')}x` : '–')}
        {zeile('Nettomietrendite', prozent(j1.nettomietrendite * 100, 2))}
        {zeile('Cashflow operativ / Monat', eurGenau(j1.cashflowOperativ), true, vz(j1.cashflowOperativ))}
      </Paper>
      <Paper withBorder p="sm">
        <Title order={5} mb={6}>Hochrechnung Verkauf {h.zieljahr}</Title>
        {zeile('Verkaufspreis', eurGenau(h.verkaufspreis))}
        {zeile('Restschuld', eurGenau(h.restschuld))}
        {zeile('Erlös', eurGenau(h.erloes))}
        {zeile('Eingesetztes / entnommenes EK', eurGenau(h.eingesetztes_oder_entnommenes_EK), false, vz(h.eingesetztes_oder_entnommenes_EK))}
        <Divider my={4} />
        {zeile('Steuerfreier Vermögenszuwachs', eurGenau(h.steuerfreierVermoegenszuwachs), true, 'green')}
        {zeile('Netto-EK-Rendite p. a. (IRR)', h.nettoEKRenditePA_IRR === null ? '–' : prozent(h.nettoEKRenditePA_IRR * 100, 1), true)}
        {zeile('Miete im Endjahr / Monat', euro(h.mieteEndjahr))}
      </Paper>
      <Paper withBorder p="sm" style={{ gridColumn: '1 / -1' }} aria-label="Cashflow nach Steuern">
        <Title order={5} mb={6}>Cashflow nach Steuern</Title>
        <Table withRowBorders={false} verticalSpacing={0} fz="sm">
          <Table.Thead><Table.Tr><Table.Th /><Table.Th ta="right">Jahr 1</Table.Th><Table.Th ta="right">ab Jahr 2</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {([['Zuzahlung / Monat', 'zuzahlungProMonat'], ['Zuzahlung / Jahr', 'zuzahlungProJahr'], ['Erstattung Finanzamt', 'rueckerstattungVomFinanzamt'], ['Cashflow / Jahr n. St.', 'cashflowProJahrNachSteuer']] as const).map(([label, k]) => (
              <Table.Tr key={k}>
                <Table.Td c="dimmed">{label}</Table.Td>
                <Table.Td ta="right" c={vz(b.cashflow_jahr_1[k])}>{eurGenau(b.cashflow_jahr_1[k])}</Table.Td>
                <Table.Td ta="right" c={vz(b.cashflow_ab_jahr_2[k])}>{eurGenau(b.cashflow_ab_jahr_2[k])}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder p="sm" style={{ gridColumn: '1 / -1' }}>
        <Title order={5} mb={6}>Verlauf</Title>
        <Table.ScrollContainer minWidth={640}>
          <Table striped fz="xs" verticalSpacing={2}>
            <Table.Thead>
              <Table.Tr>{['Jahr', 'Miete', 'Zinsen', 'Tilgung', 'Restschuld', 'Wert', 'CF n. St.', 'kumuliert'].map((t) => <Table.Th key={t} ta={t === 'Jahr' ? 'left' : 'right'}>{t}</Table.Th>)}</Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Array.from({ length: dauer }, (_, y) => (
                <Table.Tr key={y}>
                  <Table.Td>{h.zieljahr - dauer + y + 1}</Table.Td>
                  {[m.miete_pro_jahr[y], m.zinsen_pro_jahr[y], m.tilgung_pro_jahr[y], m.restschuld_pro_jahr[y], m.wert_pro_jahr[y], m.cashflow_ns_jahr[y], b.kumulierterCashflow[y]].map((w, k) => (
                    <Table.Td key={k} ta="right" c={vz(w ?? 0)}>{Math.round(w ?? 0).toLocaleString('de-DE')}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </SimpleGrid>
  );
}
