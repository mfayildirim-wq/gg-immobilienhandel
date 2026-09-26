import type { DealDetail } from '@gg/api-contract';
import { FREQUENZEN, isoPlusTage, NAECHSTER_KONTAKT_KNOEPFE, nachfassStand, naechsterKontaktNachFrequenz, normalisiereFrequenz } from '@gg/domain';
import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { AgentVorschlaege } from '../../agent/agent.tsx';
import { useDealErledigt, useDealInfoAendern, useKommentarAnlegen } from '../../lib/api.ts';
import { heuteIso } from '../../lib/ansicht.ts';
import { datumDe, zeitpunktLog } from '../../lib/format.ts';

const FARBE = { ueberfaellig: 'orange', heute: 'red', woche: 'green' } as const;

/**
 * Reiter „Kommunikation“ des Deals (23.09.2026): Nachfassen (Frequenz, nächster und letzter Kontakt, Erledigt) und das
 * Gesprächslog — früher Teil der Übersicht. Auf der Ankaufseite öffnet das Deal-Detail mit diesem Reiter.
 */
export function DealKommunikation({ deal }: { deal: DealDetail }) {
  const aendern = useDealInfoAendern(deal.id);
  const erledigt = useDealErledigt(deal.id);
  const fehler = aendern.error ?? erledigt.error;
  const speichern = (felder: Omit<Parameters<typeof aendern.mutate>[0], 'version'>) => aendern.mutate({ version: deal.version, ...felder });
  const stand = nachfassStand({ nextContact: deal.nextContact, lastContact: deal.lastContact, frequenz: deal.nachfassFrequenz }, heuteIso());

  return (
    <Stack>
      {fehler && (
        <Alert color="red" title="Nicht gespeichert">
          {fehler.message}
        </Alert>
      )}
      <Paper withBorder p="sm">
        <Group justify="space-between" mb="xs">
          <Title order={5}>Nachfassen</Title>
          <Badge color={stand.faellig ? FARBE[stand.faellig.klasse] : 'gray'}>{stand.faellig?.label ?? (stand.termin ? `nächster Kontakt ${datumDe(stand.termin)}` : 'kein Termin')}</Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Select
            label="Frequenz"
            data={[...FREQUENZEN]}
            value={normalisiereFrequenz(deal.nachfassFrequenz)}
            allowDeselect={false}
            onChange={(v) => {
              if (!v) return;
              // dealFreqChanged: nächster Kontakt nur vorbelegen, wenn noch keiner gesetzt ist
              const vorschlag = naechsterKontaktNachFrequenz(v, deal.nextContact, heuteIso());
              speichern({ nachfassFrequenz: v as (typeof FREQUENZEN)[number], ...(vorschlag ? { nextContact: vorschlag } : {}) });
            }}
          />
          <Stack gap={4}>
            <TextInput
              data-agent="deal.naechster-kontakt.datum"
              label="Nächster Kontakt"
              type="date"
              value={deal.nextContact ?? ''}
              onChange={(e) => speichern({ nextContact: e.currentTarget.value || null })}
            />
            <Group gap={4} grow>
              {NAECHSTER_KONTAKT_KNOEPFE.map((k) => (
                <Button key={k.label} size="compact-xs" variant="default" onClick={() => speichern({ nextContact: isoPlusTage(heuteIso(), k.tage) })}>{k.label}</Button>
              ))}
            </Group>
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Letzter Kontakt
            </Text>
            <Group gap="xs">
              <Text size="sm">{datumDe(deal.lastContact)}</Text>
              <Button data-agent="deal.erledigt" size="xs" variant="light" leftSection={<IconCheck size={14} />} loading={erledigt.isPending}
                onClick={() => erledigt.mutate(deal.version)}>
                Erledigt
              </Button>
            </Group>
          </Stack>
        </SimpleGrid>
      </Paper>


      <Kommentare deal={deal} />
    </Stack>
  );
}

/** Nur datierte Einträge — die undatierten Notizen aus der alten App („Altbestand“) stehen in der Übersicht. */
function Kommentare({ deal }: { deal: DealDetail }) {
  const anlegen = useKommentarAnlegen(deal.id);
  const [text, setText] = useState('');
  const gespraeche = deal.kommentare.filter((k) => k.zeitpunkt);
  return (
    <section aria-label="Kommentare" data-agent-kontext={JSON.stringify({ dealId: deal.id })}>
      <Title order={5} mb="xs">
        📝 Gesprächslog
      </Title>
      <Group align="flex-end" gap="xs" mb="sm">
        <Textarea data-agent="deal.kommentar.text" placeholder="Neue Gesprächsnotiz…" autosize minRows={2} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Neue Gesprächsnotiz" />
        <Button data-agent="deal.kommentar.senden" disabled={!text.trim()} loading={anlegen.isPending}
          onClick={() => anlegen.mutate(text, { onSuccess: () => setText('') })}>
          + Eintrag
        </Button>
      </Group>
      <AgentVorschlaege ziel="deal.kommentar" waehlen={setText} />
      <Stack gap={6}>
        {gespraeche.length === 0 && (
          <Text c="dimmed" size="sm">
            Noch keine Einträge.
          </Text>
        )}
        {gespraeche.map((k) => (
          <Paper key={k.id} withBorder p="xs">
            <Text size="xs" c="dimmed">
              {zeitpunktLog(k.zeitpunkt)}
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {k.text}
            </Text>
          </Paper>
        ))}
      </Stack>
    </section>
  );
}

