import type { VlSpalte } from '@gg/api-contract';
import { DEFAULT_COLUMNS, vlIstBerechnet, vlSpalteHinzufuegen } from '@gg/domain';
import { ActionIcon, Alert, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import { useVlEinstellungen, useVlEinstellungenSpeichern } from '../lib/api.ts';
import { useSofortSpeichern } from '../lib/sofortSpeichern.ts';

const TYPEN: { value: VlSpalte['type']; label: string }[] = [
  { value: 'text', label: 'Text' }, { value: 'multitext', label: 'Notiz (mehrzeilig)' }, { value: 'number', label: 'Zahl' }, { value: 'euro', label: 'Euro' },
  { value: 'percent', label: 'Prozent' }, { value: 'date', label: 'Datum' }, { value: 'dropdown', label: 'Auswahl' }, { value: 'ampel', label: 'Ampel (grün/gelb/rot)' }, { value: 'checkbox', label: 'Ja/Nein' },
];

/** Einstellungen → Vertriebslisten: Provisionssatz und Standardspalten für neue Listen (settingsVlDefaultsRender). */
export function VertriebslistenEinstellungen() {
  const { data } = useVlEinstellungen();
  const speichern = useVlEinstellungenSpeichern();
  const { stand, aendern, fehler } = useSofortSpeichern(data, (e) => speichern.mutateAsync(e));
  if (!stand) return null;
  const spalten = (f: (c: VlSpalte[]) => VlSpalte[]) => aendern((alt) => ({ ...alt, spalten: f(alt.spalten) }));
  return (
    <Paper withBorder p="md" component="section" aria-label="Vertriebslisten Einstellungen">
      <Title order={4}>🏗️ Vertriebslisten — Standard-Spalten</Title>
      <Text size="sm" c="dimmed" mb="sm">Diese Spalten werden beim Anlegen einer neuen Vertriebsliste übernommen. Berechnete Spalten (🔒) können gelöscht werden, rechnen dann aber nicht mehr.</Text>
      {fehler && <Alert color="red" mb="sm">{fehler}</Alert>}
      <Group mb="sm" align="flex-end">
        <NumberInput label="Provisionssatz für Berechnung" suffix=" %" decimalSeparator="," decimalScale={2} w={200} value={stand.provision}
          onBlur={(e) => { const n = parseFloat(e.currentTarget.value.replace(' %', '').replace(',', '.')); if (!Number.isNaN(n) && n >= 0 && n !== stand.provision) aendern((a) => ({ ...a, provision: n })); }} />
        <Text size="xs" c="dimmed">inkl. MwSt. (Standard 7,14 %)</Text>
      </Group>
      <Text size="xs" c="dimmed" mb={6}>Reihenfolge bestimmt die Spalten-Reihenfolge in der Vertriebsliste.</Text>
      <Stack gap={4}>
        {stand.spalten.map((c, i) => {
          const berechnet = vlIstBerechnet(c as never);
          return (
            <Group key={`${c.id}-${i}`} gap={6} wrap="nowrap" p={4} style={{ background: berechnet ? 'var(--mantine-primary-color-light)' : 'var(--mantine-color-default-hover)', borderRadius: 4 }} aria-label={`Spalte ${c.label}`}>
              <ActionIcon size="sm" variant="default" aria-label="nach oben" disabled={i === 0} onClick={() => spalten((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}><IconArrowUp size={12} /></ActionIcon>
              <ActionIcon size="sm" variant="default" aria-label="nach unten" disabled={i === stand.spalten.length - 1} onClick={() => spalten((l) => { const n = [...l]; [n[i], n[i + 1]] = [n[i + 1]!, n[i]!]; return n; })}><IconArrowDown size={12} /></ActionIcon>
              <TextInput size="xs" style={{ flex: 1 }} aria-label="Bezeichnung" defaultValue={c.label} rightSection={berechnet ? '🔒' : undefined}
                onBlur={(e) => { const label = e.currentTarget.value.replace(/\s*🔒\s*$/, '').trim() || c.id; if (label !== c.label) spalten((l) => l.map((x, j) => (j === i ? { ...x, label } : x))); }} />
              <Select size="xs" w={190} aria-label="Typ" data={TYPEN} value={c.type} disabled={berechnet} allowDeselect={false} onChange={(v) => v && spalten((l) => l.map((x, j) => (j === i ? { ...x, type: v as VlSpalte['type'] } : x)))} />
              <ActionIcon size="sm" variant="subtle" color="red" aria-label="Spalte löschen" onClick={() => {
                const warnung = berechnet
                  ? `Spalte "${c.label}" ist eine berechnete Spalte (🔒). Wenn du sie löschst, fehlt die Auto-Berechnung in zukünftigen Vertriebslisten.\n\nWirklich löschen?`
                  : `Spalte "${c.label}" wirklich aus den Standard-Spalten löschen?`;
                if (window.confirm(warnung)) spalten((l) => l.filter((_, j) => j !== i));
              }}><IconTrash size={14} /></ActionIcon>
            </Group>
          );
        })}
      </Stack>
      <Group mt="sm" gap="xs">
        <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => {
          const name = window.prompt('Name der neuen Spalte:', 'Neue Spalte');
          if (name) spalten((l) => vlSpalteHinzufuegen(l as never, name, Date.now()) as VlSpalte[]);
        }}>Spalte hinzufügen</Button>
        <Button size="xs" variant="subtle" ml="auto" leftSection={<IconRestore size={14} />} onClick={() => {
          if (window.confirm(`Alle Spalten auf die originalen Standard-Spalten (${DEFAULT_COLUMNS.length} Spalten) zurücksetzen? Vorhandene Vertriebslisten behalten ihre aktuelle Spalten-Liste.`)) spalten(() => DEFAULT_COLUMNS.map((c) => ({ ...c })) as VlSpalte[]);
        }}>Auf Originalspalten zurücksetzen</Button>
      </Group>
    </Paper>
  );
}
