import type { CockpitMakler } from '@gg/api-contract';
import { whatsappNummer } from '@gg/domain';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconPhone, IconPlus } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useAnlaesse, useKiStatus, useMaklerErledigt, useTerminSetzen, useWhatsappProtokoll } from '../../lib/api.ts';
import { KiEntwurf } from './KiEntwurf.tsx';
import { MailAuswahl } from './MailAuswahl.tsx';
import { datumDe } from '../../lib/format.ts';
import { FAELLIG_FARBE, TerminWahl } from './Termin.tsx';
import css from '../Listenzeile.module.css';

export const PRIO_FARBE: Record<string, string> = { A: 'green', B: 'orange', C: 'gray' };

export function MaklerKarte({ m, heute, anrufen, stilOeffnen, aktiv, waehlen }: { m: CockpitMakler; heute: string; anrufen: (m: CockpitMakler) => void; stilOeffnen: () => void; aktiv?: boolean; waehlen?: (id: string) => void }) {
  const erledigt = useMaklerErledigt(m.id);
  const termin = useTerminSetzen('makler', m.id);
  const whatsapp = useWhatsappProtokoll(m.id);
  const navigate = useNavigate();
  const wa = whatsappNummer(m.tel);
  const { data: ki } = useKiStatus();
  // Anlässe nur für heute/überfällig fällige Makler — nur dort zeigt die Karte sie (vtMaklerCard)
  const faellig = m.faellig.klasse === 'heute' || m.faellig.klasse === 'ueberfaellig';
  const { data: anlaesse } = useAnlaesse(m.id, faellig && !!ki?.verfuegbar);
  const geburtstag = m.hinweise.filter((h) => h.art === 'geburtstag');
  const stagnation = m.hinweise.filter((h) => h.art === 'stagnation');
  const hinweise = [...geburtstag.map((h) => ({ emoji: '', text: h.text, hoch: h.dringend })), ...(faellig ? anlaesse?.anlaesse ?? [] : []).map((a) => ({ emoji: a.emoji, text: a.text, hoch: a.priority === 'hoch' })), ...stagnation.map((h) => ({ emoji: '📊', text: h.text, hoch: true }))];
  const fehler = erledigt.error ?? termin.error ?? whatsapp.error;

  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      className={waehlen ? css.karte : undefined}
      onClick={() => waehlen?.(m.id)}
      aria-current={aktiv}
      data-aktiv={aktiv || undefined}
      style={{
        borderLeft: `4px solid var(--mantine-color-${FAELLIG_FARBE[m.faellig.klasse]}-6)`,
        cursor: waehlen ? 'pointer' : undefined,
      }}
      aria-label={`Makler ${m.name ?? m.firma ?? ''}`}
      data-karte={`makler:${m.id}`}
      data-faellig-klasse={m.faellig.klasse}
    >
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start" style={{ cursor: 'pointer' }} onClick={() => navigate({ to: '/makler', search: { makler: m.id } })}>
          <div style={{ minWidth: 0 }}>
            <Text fw={700} size="md" truncate>🤝 {m.name ?? '–'}</Text>
            {m.firma && <Text size="xs" c="dimmed" truncate>{m.firma}</Text>}
            {m.tel && <Text size="sm" fw={700} c="green">📞 {m.tel}</Text>}
          </div>
          <Stack gap={2} align="flex-end">
            {m.prio && <Badge variant="light" color={PRIO_FARBE[m.prio] ?? 'gray'}>{m.prio}-Makler</Badge>}
            <Text size="xs" c="dimmed">{m.aktiveDeals} aktive Deal{m.aktiveDeals === 1 ? '' : 's'}</Text>
          </Stack>
        </Group>

        <Group gap={4}>
          {m.tel && (
            <Button size="xs" color="green" leftSection={<IconPhone size={14} />} onClick={() => anrufen(m)}>
              {m.tel} anrufen
            </Button>
          )}
          {wa && (
            <Button component="a" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" size="xs" variant="light" color="green" leftSection={<IconBrandWhatsapp size={14} />} onClick={() => whatsapp.mutate(undefined)}>
              WhatsApp
            </Button>
          )}
          {m.email && <MailAuswahl email={m.email} makler={m} />}
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => navigate({ to: '/deals', search: { neu: m.id } })}>
            Neuer Deal
          </Button>
        </Group>

        {m.merker.length > 0 && (
          <Group gap={4}>
            {m.merker.slice(0, 3).map((e) => (
              <Badge key={`${e.thema}-${e.ts}`} variant="outline" color="gray" title={`${e.detail} (${e.ts})`}>📌 {e.thema}</Badge>
            ))}
          </Group>
        )}
        {ki?.verfuegbar && <KiEntwurf maklerId={m.id} tel={m.tel} email={m.email} stand={m.version} heute={heute} stilOeffnen={stilOeffnen} />}
        {hinweise.length > 0 && (
          <Stack gap={2} p={6} style={{ borderLeft: `3px solid var(--mantine-color-${hinweise.some((h) => h.hoch) ? 'red' : 'orange'}-6)`, background: 'var(--mantine-color-default-hover)', borderRadius: 4 }} aria-label="Kontakt-Anlässe">
            {hinweise.map((h) => <Text key={h.text} size="xs">{h.emoji ? `${h.emoji} ` : ''}{h.text}</Text>)}
          </Stack>
        )}

        <Group justify="space-between" wrap="nowrap">
          <Group gap={6}>
            <Badge variant="light" color={FAELLIG_FARBE[m.faellig.klasse]} data-faellig-label>{m.faellig.label}</Badge>
            {m.lastContact && <Text size="xs" c="dimmed" data-zuletzt>Zuletzt: {datumDe(m.lastContact)}</Text>}
          </Group>
          <Button size="xs" variant="light" color="green" leftSection={<IconCheck size={14} />} loading={erledigt.isPending} onClick={() => erledigt.mutate(m.version)}>
            Erledigt
          </Button>
        </Group>
        <TerminWahl label="Nächster Kontakt Makler" wert={m.nextContact} heute={heute} setzen={(iso) => termin.mutate({ version: m.version, nextContact: iso })} />
        {fehler && <Text size="xs" c="red">{fehler.message}</Text>}
      </Stack>
    </Card>
  );
}
