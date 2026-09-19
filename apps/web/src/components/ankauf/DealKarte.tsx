import type { CockpitDeal } from '@gg/api-contract';
import { ActionIcon, Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconCheck, IconPhone } from '@tabler/icons-react';
import { useDealErledigt, useTerminSetzen } from '../../lib/api.ts';
import { datumDe, euro } from '../../lib/format.ts';
import { StatusBadge } from '../StatusBadge.tsx';
import { MailAuswahl } from './MailAuswahl.tsx';
import { FAELLIG_FARBE, TerminWahl } from './Termin.tsx';
import css from '../Listenzeile.module.css';

/**
 * Klicks auf Knöpfe in der Karte wählen sie nicht aus — sie tun, was auf ihnen steht.
 * `display: contents` hält das Layout der Gruppe unverändert; der Stopp wirkt trotzdem, weil das Ereignis den DOM-Baum hochläuft.
 */
const ohneAuswahl = (kind: React.ReactNode) => (
  <div onClick={(e) => e.stopPropagation()} style={{ display: 'contents' }}>{kind}</div>
);

/**
 * Nachverfolgungs-Karte in drei Zeilen:
 *   1 Adresse und Stadt, rechts der Status
 *   2 Makler (Firma, Name), rechts Anrufen und E-Mail als Symbole
 *   3 links Termin (Datum + Schnellwahl), rechts Fälligkeit und „Erledigt“
 * Ein Klick auf die Karte zeigt den Deal rechts im Detailbereich; die Werte sind dieselben wie zuvor.
 */
export function DealKarte({ d, heute, aktiv, waehlen }: { d: CockpitDeal; heute: string; aktiv?: boolean; waehlen?: (id: string) => void }) {
  const erledigt = useDealErledigt(d.id);
  const termin = useTerminSetzen('deals', d.id);
  const rendite = d.jahresmiete && d.kaufpreis ? `${((d.jahresmiete / d.kaufpreis) * 100).toFixed(1).replace('.', ',')} % · ` : '';

  return (
    <Card
      withBorder
      padding="xs"
      radius="md"
      className={waehlen ? css.karte : undefined}
      onClick={() => waehlen?.(d.id)}
      aria-current={aktiv}
      data-aktiv={aktiv || undefined}
      style={{
        borderLeft: `4px solid var(--mantine-color-${FAELLIG_FARBE[d.faellig.klasse]}-6)`,
        cursor: waehlen ? 'pointer' : undefined,
      }}
      aria-label={`Deal ${d.objekt.titel}`}
      data-karte={`deal:${d.id}`}
      data-faellig-klasse={d.faellig.klasse}
    >
      <Stack gap={6}>
        {/* 1 — Adresse und Stadt, rechts der Status */}
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} truncate>
              📍 {d.objekt.titel}
              {d.objekt.stadt ? `, ${d.objekt.stadt}` : ''}
            </Text>
            <Group gap={6} mt={2}>
              {d.kaufpreis && <Text size="xs" fw={600} c="teal">{euro(d.kaufpreis)}</Text>}
              {d.wohnflaeche && <Text size="xs" c="dimmed">{d.wohnflaeche.toLocaleString('de-DE')} m²</Text>}
              {d.jahresmiete && <Text size="xs" c="green">{rendite}{euro(d.jahresmiete)}/Jahr</Text>}
            </Group>
          </div>
          <StatusBadge status={d.status} />
        </Group>

        {/* 2 — Makler, rechts Anrufen und E-Mail ohne Beschriftung */}
        <Group justify="space-between" wrap="nowrap" gap="xs" p={6} style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 6 }}>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>{d.makler?.firma ?? d.makler?.name ?? '– ohne Makler'}</Text>
            {d.makler?.firma && d.makler.name && <Text size="xs" c="dimmed" truncate>{d.makler.name}</Text>}
          </div>
          {ohneAuswahl(
            <Group gap={4} wrap="nowrap">
              {d.makler?.tel && (
                <ActionIcon component="a" href={`tel:${d.makler.tel}`} variant="light" color="green" size="lg" aria-label="Anrufen" title={d.makler.tel}>
                  <IconPhone size={18} />
                </ActionIcon>
              )}
              {d.makler?.email && <MailAuswahl email={d.makler.email} dealId={d.id} kompakt />}
            </Group>,
          )}
        </Group>

        {/* 3 — links Termin, rechts Fälligkeit und „Erledigt“ */}
        <Group justify="space-between" wrap="wrap" gap="xs">
          {ohneAuswahl(
            <div style={{ flex: '1 1 210px', minWidth: 190 }}>
              <TerminWahl label="Nächster Kontakt Deal" wert={d.nextContact} heute={heute} setzen={(iso) => termin.mutate({ version: d.version, nextContact: iso })} />
            </div>,
          )}
          <Group gap={6} wrap="nowrap">
            <Stack gap={0} align="flex-end">
              <Badge variant="light" color={FAELLIG_FARBE[d.faellig.klasse]} data-faellig-label>{d.faellig.label}</Badge>
              {d.lastContact && <Text size="xs" c="dimmed" data-zuletzt>Zuletzt: {datumDe(d.lastContact)}</Text>}
            </Stack>
            {ohneAuswahl(
              <Button size="xs" variant="light" color="green" leftSection={<IconCheck size={14} />} loading={erledigt.isPending} onClick={() => erledigt.mutate(d.version)}>
                Erledigt
              </Button>,
            )}
          </Group>
        </Group>
        {(erledigt.error ?? termin.error) && <Text size="xs" c="red">{(erledigt.error ?? termin.error)!.message}</Text>}
      </Stack>
    </Card>
  );
}
