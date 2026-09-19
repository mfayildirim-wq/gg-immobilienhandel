import type { CockpitMakler } from '@gg/api-contract';
import { isoPlusTage, whatsappNummer } from '@gg/domain';
import { Anchor, Badge, Button, Group, Modal, Paper, Stack, Text, TextInput } from '@mantine/core';
import { IconBrandWhatsapp, IconMail, IconPhone } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useAnlaesse, useBriefingAbschluss, useGespraechsoeffner, useKiStatus, useKommunikationAnlegen, useMaklerDetail, useWhatsappProtokoll } from '../../lib/api.ts';
import { Aufnahme } from '../MaklerDetail.tsx';
import { zeitpunktDe } from '../../lib/format.ts';

const KANAL_ICON: Record<string, string> = { whatsapp: '📱', email: '✉️', anruf: '📞', notiz: '📝' };

/**
 * Anruf-Briefing vor dem Anruf: Hinweise, persönliche Merker, letzte Kommunikation, Beziehungsprofil,
 * KI-Gesprächsöffner, nächster Kontakt, Anruf-Aufnahme. Beim Schließen mit Datum: nächster Kontakt = Datum, letzter Kontakt = heute.
 */
export function AnrufBriefing({ makler, heute, schliessen }: { makler: CockpitMakler | null; heute: string; schliessen: () => void }) {
  const { data: detail } = useMaklerDetail(makler?.id ?? null);
  const { data: ki } = useKiStatus();
  const { data: anlaesse } = useAnlaesse(makler?.id ?? '', !!makler && !!ki?.verfuegbar);
  const oeffner = useGespraechsoeffner(makler && ki?.verfuegbar && anlaesse ? makler.id : null);
  const kommAnlegen = useKommunikationAnlegen(makler?.id ?? '');
  const abschluss = useBriefingAbschluss(makler?.id ?? '');
  const whatsapp = useWhatsappProtokoll(makler?.id ?? '');
  const [datum, setDatum] = useState('');
  useEffect(() => setDatum(makler?.nextContact ?? ''), [makler]);

  const zu = () => {
    if (makler && datum && detail) abschluss.mutate({ version: detail.version, nextContact: datum });
    schliessen();
  };
  const wa = whatsappNummer(makler?.tel);

  return (
    <Modal opened={!!makler} onClose={zu} title={`📞 ${makler?.name ?? '–'}`} styles={{ title: { fontSize: 'var(--mantine-font-size-xl)', fontWeight: 700 } }} size="lg" closeButtonProps={{ 'aria-label': 'Briefing schließen' }}>
      {makler && (
        <Stack gap="sm">
          {makler.firma && <Text size="sm" c="dimmed">{makler.firma}</Text>}
          {(makler.hinweise.some((h) => h.art === 'geburtstag') || (anlaesse?.anlaesse.length ?? 0) > 0) && (
            <Paper withBorder p="xs" style={{ borderLeft: `3px solid var(--mantine-color-${makler.hinweise.some((h) => h.dringend) || anlaesse?.anlaesse.some((a) => a.priority === 'hoch') ? 'red' : 'orange'}-6)` }} aria-label="Anlässe">
              {makler.hinweise.filter((h) => h.art === 'geburtstag').map((h) => <Text key={h.text} size="sm">{h.text}</Text>)}
              {anlaesse?.anlaesse.map((a) => (
                <Group key={a.text} gap={6} wrap="nowrap"><Text size="sm">{a.emoji}</Text><Text size="sm" style={{ flex: 1 }}>{a.text}</Text>{a.quelleUrl && <Anchor size="xs" href={a.quelleUrl} target="_blank" rel="noopener">→</Anchor>}</Group>
              ))}
            </Paper>
          )}
          <section aria-label="Persönliche Merker">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">📌 Persönliche Merker</Text>
            {makler.merker.length === 0 ? <Text size="sm" c="dimmed">Noch keine persönlichen Merker</Text> : makler.merker.map((e) => (
              <Group key={`${e.thema}-${e.ts}`} gap={6} wrap="nowrap">
                <Badge variant="light" size="sm">{e.thema}</Badge>
                <Text size="sm" style={{ flex: 1 }}>{e.detail}</Text>
                <Text size="xs" c="dimmed">{e.ts}</Text>
              </Group>
            ))}
          </section>
          <section aria-label="Letzte Kommunikation">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">💬 Letzte Kommunikation</Text>
            {!detail?.kommunikation.length ? <Text size="sm" c="dimmed">Noch keine Kommunikation</Text> : detail.kommunikation.slice(0, 3).map((k) => (
              <div key={k.id}>
                <Text size="xs" c="dimmed">{zeitpunktDe(k.zeitpunkt)} · {KANAL_ICON[k.kanal ?? ''] ?? '💬'} {k.kanal}</Text>
                <Text size="sm">{(k.text ?? '').slice(0, 100)}{(k.text ?? '').length > 100 ? '…' : ''}</Text>
              </div>
            ))}
          </section>
          {detail?.beziehungsNotiz && (
            <Paper withBorder p="xs" bg="var(--mantine-primary-color-light)">
              <Text size="xs" fw={700}>🤝 Beziehungsprofil</Text>
              <Text size="sm">{detail.beziehungsNotiz}</Text>
            </Paper>
          )}
          {ki?.verfuegbar && (
            <Paper withBorder p="xs" aria-label="Gesprächsöffner">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>💬 Gesprächsöffner</Text>
              <Text size="sm" fs={oeffner.data ? undefined : 'italic'} data-gespraechsoeffner>{oeffner.data?.text ?? (oeffner.isError ? 'Gesprächsöffner konnte nicht generiert werden.' : '⏳ KI formuliert Gesprächsöffner…')}</Text>
            </Paper>
          )}
          <Paper withBorder p="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>📅 Nächster Kontakt</Text>
            <TextInput type="date" aria-label="Nächster Kontakt im Briefing" value={datum} onChange={(e) => setDatum(e.currentTarget.value)} />
            <Group grow gap={6} mt={6}>
              <Button size="xs" variant="default" onClick={() => setDatum(isoPlusTage(heute, 7))}>in 1 Woche</Button>
              <Button size="xs" variant="default" onClick={() => setDatum(isoPlusTage(heute, 30))}>in 1 Monat</Button>
              <Button size="xs" variant="default" onClick={() => setDatum(isoPlusTage(heute, 180))}>in 6 Monaten</Button>
            </Group>
          </Paper>
          <Group grow>
            {makler.tel && <Button component="a" href={`tel:${makler.tel}`} color="green" size="md" leftSection={<IconPhone size={18} />}>Jetzt anrufen</Button>}
            {wa && <Button component="a" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" variant="light" color="green" onClick={() => whatsapp.mutate(undefined)} leftSection={<IconBrandWhatsapp size={18} />}>WhatsApp</Button>}
            {makler.email && <Button component="a" href={`mailto:${makler.email}`} variant="default" leftSection={<IconMail size={18} />}>E-Mail</Button>}
          </Group>
          <Aufnahme maklerId={makler.id} speichern={(text, ok) => kommAnlegen.mutate({ kanal: 'anruf', text }, { onSuccess: ok })} />
        </Stack>
      )}
    </Modal>
  );
}
