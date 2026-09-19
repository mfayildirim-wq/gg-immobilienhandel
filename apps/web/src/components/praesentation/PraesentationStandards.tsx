import type { FinanzpraesStandard } from '@gg/api-contract';
import { FINANZPRAES_DEFAULTS_STANDARD, STANDARDBILD_ABSCHLUSS, STANDARDBILD_ORGANIGRAMM } from '@gg/domain';
import { standardbilderEinsetzen } from '@gg/documents';
import { Alert, Button, FileButton, Group, Image, Paper, SimpleGrid, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useState } from 'react';
import { usePraesentationStandard, usePraesentationStandardSpeichern } from '../../lib/api.ts';
import { bildVerkleinern } from '../../lib/bild.ts';

const alsDataUrl = (b: Blob) => new Promise<string>((ok, fehler) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fehler(r.error); r.readAsDataURL(b); });

/** Vorbelegungen der Bank-Präsentation (alt: Einstellungen „Bank-Präsentation“): Geschäftsmodell-Texte, Organigramm, Abschlussfoto. */
export function PraesentationStandards() {
  const { data } = usePraesentationStandard();
  const speichern = usePraesentationStandardSpeichern();
  const [w, setW] = useState<FinanzpraesStandard | null>(null);
  const aktuell = w ?? data;
  if (!aktuell) return null;
  const g = aktuell.geschaeftsmodell;

  const bild = (teil: 'organigramm' | 'abschluss', label: string, platzhalter: string) => {
    const wert = aktuell[teil].bild;
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{label}</Text>
        {wert ? <Image src={standardbilderEinsetzen(wert)} mah={140} fit="contain" alt={label} /> : <Text size="xs" c="dimmed">Kein Bild — die Folie zeigt einen Hinweis.</Text>}
        <Group gap="xs">
          <FileButton accept="image/*" onChange={async (f) => { if (f) setW({ ...aktuell, [teil]: { ...aktuell[teil], bild: await alsDataUrl(await bildVerkleinern(f)) } }); }}>
            {(props) => <Button {...props} size="compact-xs" variant="default">Eigenes Bild</Button>}
          </FileButton>
          <Button size="compact-xs" variant="default" disabled={wert === platzhalter} onClick={() => setW({ ...aktuell, [teil]: { ...aktuell[teil], bild: platzhalter } })}>Mitgeliefertes Bild</Button>
          <Button size="compact-xs" variant="subtle" color="red" disabled={!wert} onClick={() => setW({ ...aktuell, [teil]: { ...aktuell[teil], bild: '' } })}>Entfernen</Button>
        </Group>
      </Stack>
    );
  };

  return (
    <Paper withBorder p="md" component="section" aria-label="Bank-Präsentation Standards">
      <Group justify="space-between" mb="sm">
        <div>
          <Title order={4}>Bank-Präsentation</Title>
          <Text size="sm" c="dimmed">Vorbelegung neuer Slides; leere Organigramm-/Abschluss-Slides und Geschäftsmodell-Felder nutzen diese Werte beim Export.</Text>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => setW(FINANZPRAES_DEFAULTS_STANDARD)}>Werkseinstellung</Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={speichern.isPending} onClick={() => speichern.mutate(aktuell, { onSuccess: () => setW(null) })}>Speichern</Button>
        </Group>
      </Group>
      {speichern.error && <Alert color="red" mb="sm">{speichern.error.message}</Alert>}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {([['zielgruppe', 'Zielgruppe'], ['angebot', 'Angebot der IVT'], ['kundengewinnung', 'Kundengewinnung'], ['vorteile', 'Vorteile für die Kunden'], ['vorteileIvt', 'Vorteile für die IVT']] as const).map(([k, l]) => (
          <Textarea key={k} label={l} autosize minRows={3} value={g[k]} onChange={(e) => setW({ ...aktuell, geschaeftsmodell: { ...g, [k]: e.currentTarget.value } })} />
        ))}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="md">
        <Stack gap="xs">
          {bild('organigramm', 'Organigramm', STANDARDBILD_ORGANIGRAMM)}
          <Textarea label="Organigramm: Beschreibung" autosize minRows={2} value={aktuell.organigramm.beschreibung} onChange={(e) => setW({ ...aktuell, organigramm: { ...aktuell.organigramm, beschreibung: e.currentTarget.value } })} />
        </Stack>
        <Stack gap="xs">
          {bild('abschluss', 'Abschluss-Foto', STANDARDBILD_ABSCHLUSS)}
          <Textarea label="Abschluss: Untertitel" autosize minRows={2} value={aktuell.abschluss.untertitel} onChange={(e) => setW({ ...aktuell, abschluss: { ...aktuell.abschluss, untertitel: e.currentTarget.value } })} />
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}
