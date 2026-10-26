import type { GedaechtnisEintrag } from '@gg/api-contract';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text, Textarea, Tooltip, Typography, UnstyledButton } from '@mantine/core';
import { IconBrain, IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { type GedaechtnisArt, useGedaechtnis, useGedaechtnisAendern, useGedaechtnisStand } from '../lib/api.ts';
import { datumDe } from '../lib/format.ts';
import { markdownAlsHtml } from '../lib/markdown.ts';

/** Woher ein Eintrag stammt — gg (Ereignis), KI (aus Text gezogen), abgelegtes Ergebnis (Cowork/Claude), von Hand korrigiert. */
const QUELLE: Record<string, { text: string; farbe: string }> = {
  api: { text: 'aus der App', farbe: 'gray' },
  ki: { text: 'gemerkt', farbe: 'violet' },
  ablage: { text: 'abgelegt', farbe: 'indigo' },
  hand: { text: 'korrigiert', farbe: 'teal' },
};

/** Der ganze Eintrag im Popup, Markdown als HTML (26.10.2026: Recherchen aus Cowork sind lang und haben Tabellen). */
function EintragAnsicht({ eintrag, schliessen }: { eintrag: GedaechtnisEintrag; schliessen: () => void }) {
  const html = useMemo(() => markdownAlsHtml(eintrag.text), [eintrag.text]);
  return (
    <Modal opened onClose={schliessen} size="xl" title={<Text fw={600}>🧠 {eintrag.titel ?? 'Gedächtnis-Eintrag'}</Text>}>
      <Typography data-gedaechtnis-ansicht>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Typography>
      <Text size="xs" c="dimmed" mt="md">
        App {eintrag.app}{eintrag.von && eintrag.von !== eintrag.app ? ` · ${eintrag.von}` : ''}{eintrag.am ? ` · ${datumDe(eintrag.am.slice(0, 10))}` : ''}
      </Text>
    </Modal>
  );
}

/**
 * Gedächtnis zu einem Deal oder Makler (24.10.2026): was der zentrale Gedächtnis-Dienst weiß — aus gg-Ereignissen,
 * aus Notizen hier und aus KI-Gesprächen (Claude, Desk). Einträge anderer Apps sind sichtbar; ändern darf nur die App, der ein
 * Eintrag gehört — das prüft der Dienst, die Oberfläche zeigt seine Antwort.
 */
export function GedaechtnisKasten({ art, id }: { art: GedaechtnisArt; id: string }) {
  const { data: stand } = useGedaechtnisStand();
  const { data, isLoading, error } = useGedaechtnis(art, id, stand?.verbunden === true);
  const { merken, aendern, vergessen } = useGedaechtnisAendern(art, id);
  const [neu, setNeu] = useState('');
  const [bearbeitet, setBearbeitet] = useState<{ id: string; text: string } | null>(null);
  const [offen, setOffen] = useState<GedaechtnisEintrag | null>(null);

  if (stand && !stand.verbunden) {
    return <Alert color="gray" icon={<IconBrain size={18} />}>Der Gedächtnis-Dienst ist nicht eingerichtet (Einstellungen → Zugänge: Adresse und Schlüssel).</Alert>;
  }
  const eintraege = data?.eintraege ?? [];
  return (
    <Stack gap="sm" data-gedaechtnis={`${art}:${id}`}>
      <Text size="sm" c="dimmed">
        Was das zentrale Gedächtnis zu {art === 'deal' ? 'diesem Deal' : 'diesem Makler'} weiß: aus gg (Status, Kommentare, Kontakt, Betreuung),
        aus Notizen hier und aus KI-Gesprächen. Neue Angaben lösen überholte ab.
      </Text>
      <Paper withBorder p="sm">
        <Textarea
          label="Merken" placeholder="z. B. Verkäufer erst ab November erreichbar" autosize minRows={2} maxLength={4000}
          value={neu} onChange={(e) => setNeu(e.currentTarget.value)} data-gedaechtnis-eingabe
        />
        <Group justify="flex-end" mt="xs">
          <Button size="xs" leftSection={<IconBrain size={14} />} loading={merken.isPending} disabled={!neu.trim()}
            onClick={() => merken.mutate(neu.trim(), { onSuccess: () => setNeu('') })}>
            Merken
          </Button>
        </Group>
        {merken.error && <Text size="xs" c="red" mt={4}>{merken.error.message}</Text>}
      </Paper>
      {isLoading && <Loader size="sm" />}
      {error && <Alert color="red">{error.message}</Alert>}
      {(aendern.error ?? vergessen.error) && <Alert color="red">{(aendern.error ?? vergessen.error)!.message}</Alert>}
      {!isLoading && !error && eintraege.length === 0 && <Text size="sm" c="dimmed">Noch nichts im Gedächtnis.</Text>}
      {eintraege.map((e) => {
        const q = QUELLE[e.quelle ?? ''] ?? { text: e.quelle ?? '?', farbe: 'gray' };
        const imBearbeiten = bearbeitet?.id === e.id;
        return (
          <Paper key={e.id} withBorder p="sm" data-gedaechtnis-eintrag={e.id}>
            {imBearbeiten ? (
              <Group align="flex-end" wrap="nowrap" gap="xs">
                <Textarea style={{ flex: 1 }} autosize minRows={1} value={bearbeitet.text} onChange={(x) => setBearbeitet({ id: e.id, text: x.currentTarget.value })} />
                <ActionIcon variant="light" color="teal" aria-label="Speichern" loading={aendern.isPending} disabled={!bearbeitet.text.trim()}
                  onClick={() => aendern.mutate({ id: e.id, text: bearbeitet.text.trim() }, { onSuccess: () => setBearbeitet(null) })}>
                  <IconCheck size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" aria-label="Abbrechen" onClick={() => setBearbeitet(null)}><IconX size={16} /></ActionIcon>
              </Group>
            ) : (
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                <UnstyledButton style={{ flex: 1, minWidth: 0 }} onClick={() => setOffen(e)} aria-label={`Eintrag öffnen: ${e.titel ?? e.text.slice(0, 40)}`}>
                  {e.titel && <Text size="sm" fw={600}>{e.titel}</Text>}
                  <Text size="sm" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{e.text}</Text>
                </UnstyledButton>
                <Group gap={2} wrap="nowrap">
                    <Tooltip label="Korrigieren"><ActionIcon variant="subtle" size="sm" aria-label="Korrigieren" onClick={() => setBearbeitet({ id: e.id, text: e.text })}><IconPencil size={14} /></ActionIcon></Tooltip>
                    <Tooltip label="Vergessen"><ActionIcon variant="subtle" size="sm" color="red" aria-label="Vergessen" loading={vergessen.isPending && vergessen.variables === e.id}
                      onClick={() => vergessen.mutate(e.id)}><IconTrash size={14} /></ActionIcon></Tooltip>
                </Group>
              </Group>
            )}
            <Group gap={6} mt={4}>
              <Badge size="xs" variant="light" color={q.farbe} tt="none">{q.text}</Badge>
              <Badge size="xs" variant="outline" tt="none">App {e.app}</Badge>
              {e.am && <Text size="xs" c="dimmed">{datumDe(e.am.slice(0, 10))}</Text>}
              {e.von && e.von !== e.app && <Text size="xs" c="dimmed">· {e.von}</Text>}
            </Group>
          </Paper>
        );
      })}
      {offen && <EintragAnsicht eintrag={offen} schliessen={() => setOffen(null)} />}
    </Stack>
  );
}
