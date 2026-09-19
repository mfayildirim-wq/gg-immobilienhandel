import type { VorlagenEinstellungen as Daten } from '@gg/api-contract';
import { standardVorlagen, type Vorlage } from '@gg/domain';
import { ActionIcon, Alert, Badge, Button, Code, Group, Paper, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconDeviceFloppy, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useVorlagen, useVorlagenSpeichern } from '../lib/api.ts';

const KANAL = [{ value: 'email', label: '✉️ E-Mail' }, { value: 'whatsapp', label: '📱 WhatsApp' }, { value: 'beide', label: '✉️📱 Beide' }];
const PLATZHALTER = ['{adresse}', '{stadt}', '{maklerName}', '{maklerFirma}', '{kaufpreis}', '{wohnflaeche}', '{meinName}'];

/** Einstellungen → Vorlagen-Texte (settingsVorlagenRender): Name, Kanal, Betreff, Text; „Mein Name“ für {meinName}. */
export function VorlagenEinstellungen() {
  const { data } = useVorlagen();
  const speichern = useVorlagenSpeichern();
  const [stand, setStand] = useState<Daten | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  useEffect(() => { if (data) setStand(data); }, [data]);
  if (!stand) return null;
  const sichern = (neu: Daten, text: (n: number) => string) => speichern.mutate(neu, { onSuccess: (d) => { setStand(d); setMeldung(text(d.vorlagen.length)); } });
  const aendern = (i: number, a: Partial<Vorlage>) => setStand({ ...stand, vorlagen: stand.vorlagen.map((v, j) => (j === i ? { ...v, ...a } : v)) });

  return (
    <Stack>
      <Paper withBorder p="md" component="section" aria-label="Mein Name">
        <Title order={4}>👤 Mein Name</Title>
        <Text size="sm" c="dimmed" mb="xs">Wird in Vorlagen für <Code>{'{meinName}'}</Code> eingesetzt.</Text>
        <Group align="flex-end">
          <TextInput label="Name" w={280} value={stand.meinName} onChange={(e) => setStand({ ...stand, meinName: e.currentTarget.value })} />
          <Button variant="default" onClick={() => sichern(stand, () => '✅ Name gespeichert')}>Speichern</Button>
        </Group>
      </Paper>
      <Paper withBorder p="md" component="section" aria-label="Vorlagen-Texte">
        <Title order={4}>📝 Vorlagen-Texte</Title>
        {meldung && <Alert color="teal" variant="light" my="xs" withCloseButton onClose={() => setMeldung(null)}>{meldung}</Alert>}
        {speichern.error && <Alert color="red" my="xs">{speichern.error.message}</Alert>}
        <Stack gap="sm" mt="sm">
          {stand.vorlagen.length === 0 && <Text size="sm" c="dimmed">Keine Vorlagen vorhanden</Text>}
          {stand.vorlagen.map((v, i) => (
            <Paper key={v.id} withBorder data-vorlage={i}>
              <Group gap="xs" px="sm" py={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }} wrap="nowrap">
                <Badge variant="light" tt="none">Vorlage {i + 1}</Badge>
                <Text fw={700} style={{ flex: 1 }} truncate>{v.name || '(unbenannt)'}</Text>
                <Badge variant="outline" color="gray" tt="none">{KANAL.find((k) => k.value === v.kanal)?.label}</Badge>
                <ActionIcon variant="subtle" color="red" aria-label="Vorlage löschen" onClick={() => sichern({ ...stand, vorlagen: stand.vorlagen.filter((_, j) => j !== i) }, (n) => `✅ ${n} Vorlagen gespeichert`)}><IconTrash size={16} /></ActionIcon>
              </Group>
              <Stack gap="xs" p="sm">
                <Group grow align="flex-end">
                  <TextInput label="Name der Vorlage" placeholder="z.B. Erstanfrage" value={v.name} onChange={(e) => aendern(i, { name: e.currentTarget.value })} />
                  <Select label="Kanal" data={KANAL} value={v.kanal} allowDeselect={false} onChange={(k) => k && aendern(i, { kanal: k as Vorlage['kanal'] })} maw={170} />
                </Group>
                {v.kanal !== 'whatsapp' && <TextInput label="Betreff (E-Mail)" placeholder="z.B. Anfrage: {adresse}, {stadt}" value={v.betreff ?? ''} onChange={(e) => aendern(i, { betreff: e.currentTarget.value })} />}
                <Textarea label="Nachrichtentext" placeholder="Nachrichtentext mit Platzhaltern…" autosize minRows={4} value={v.text} onChange={(e) => aendern(i, { text: e.currentTarget.value })} />
              </Stack>
            </Paper>
          ))}
          <Text size="xs" c="dimmed">💡 Platzhalter: {PLATZHALTER.map((p) => <Code key={p} mr={4}>{p}</Code>)}— werden beim Versand automatisch ersetzt.</Text>
        </Stack>
        <Group mt="sm" gap="xs">
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={speichern.isPending} onClick={() => sichern(stand, (n) => `✅ ${n} Vorlagen gespeichert`)}>Vorlagen speichern</Button>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setStand({ ...stand, vorlagen: [...stand.vorlagen, { id: crypto.randomUUID(), name: '', kanal: 'email', betreff: '', text: '' }] })}>Vorlage hinzufügen</Button>
          <Button variant="subtle" ml="auto" leftSection={<IconRestore size={16} />} onClick={() => {
            if (window.confirm('Vorlagen auf Standard zurücksetzen?')) sichern({ ...stand, vorlagen: standardVorlagen(() => crypto.randomUUID()) }, () => '↺ Vorlagen zurückgesetzt');
          }}>Auf Standard zurücksetzen</Button>
        </Group>
      </Paper>
    </Stack>
  );
}
