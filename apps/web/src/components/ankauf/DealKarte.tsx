import type { CockpitDeal } from '@gg/api-contract';
import { faelligKurz, TERMIN_GEAENDERT, TERMIN_GEAENDERT_HINWEIS, whatsappNummer } from '@gg/domain';
import { ActionIcon, Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconPhone } from '@tabler/icons-react';
import { useDealErledigt, useTerminSetzen } from '../../lib/api.ts';
import { datumDe } from '../../lib/format.ts';
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
 *   1 Adresse und Stadt, rechts die Fälligkeit in Kurzform („32T“, „Heute“, „in 3T“) — nur farbiger Rahmen, keine Füllung
 *   2 Makler (Name, darunter die Firma), rechts WhatsApp, Anrufen und E-Mail als Symbole
 *   3 Termin (Datum + Schnellwahl) und rechts daneben „Erledigt“ — alles in einer Zeile
 * Ein Klick auf die Karte zeigt den Deal rechts im Detailbereich. Status, Kennzahlen (Kaufpreis, Fläche, Miete) und
 * „Zuletzt“ stehen seit dem 02.10.2026 nicht mehr auf der Karte (Kundenwunsch) — sie stehen im Detail.
 * `halten`/`loslassen`: ein neuer Termin lässt die Karte stehen, erst „Erledigt“ schließt sie ab (wie in der alten App).
 */
export function DealKarte({ d, heute, aktiv, waehlen, halten, loslassen }: {
  d: CockpitDeal & { gehalten?: true }; heute: string; aktiv?: boolean; waehlen?: (id: string) => void;
  halten?: (karte: CockpitDeal) => void; loslassen?: (id: string) => void;
}) {
  const erledigt = useDealErledigt(d.id);
  const termin = useTerminSetzen('deals', d.id);
  const wa = whatsappNummer(d.makler?.tel);

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
        {/* 1 — Adresse und Stadt, rechts die Fälligkeit kurz; der volle Text steht im Tooltip und im Anker für die Parallelprüfung */}
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={700} truncate style={{ minWidth: 0 }}>
            📍 {d.objekt.titel}
            {d.objekt.stadt ? `, ${d.objekt.stadt}` : ''}
          </Text>
          {d.gehalten
            ? <Badge variant="outline" color="gray" title={TERMIN_GEAENDERT_HINWEIS} data-faellig-kurz style={{ flexShrink: 0 }}>{TERMIN_GEAENDERT}</Badge>
            : <Badge variant="outline" color={FAELLIG_FARBE[d.faellig.klasse]} title={d.faellig.label} data-faellig-kurz style={{ flexShrink: 0 }}>{faelligKurz(d.faellig)}</Badge>}
          <span hidden data-faellig-label>{d.gehalten ? TERMIN_GEAENDERT : d.faellig.label}</span>
          {d.lastContact && <span hidden data-zuletzt>Zuletzt: {datumDe(d.lastContact)}</span>}
        </Group>

        {/* 2 — Makler: Name, darunter die Firma; rechts WhatsApp, Anrufen und E-Mail ohne Beschriftung */}
        <Group justify="space-between" wrap="nowrap" gap="xs" p={6} style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 6 }}>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>{d.makler?.name ?? d.makler?.firma ?? '– ohne Makler'}</Text>
            {d.makler?.name && d.makler.firma && <Text size="xs" c="dimmed" truncate>{d.makler.firma}</Text>}
          </div>
          {ohneAuswahl(
            <Group gap={4} wrap="nowrap">
              {wa && (
                <ActionIcon component="a" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" variant="outline" color="green" size={30}
                  aria-label="WhatsApp-Chat öffnen" title={`WhatsApp-Chat mit ${d.makler?.name ?? d.makler?.tel} öffnen`}>
                  <IconBrandWhatsapp size={18} />
                </ActionIcon>
              )}
              {d.makler?.tel && (
                <ActionIcon component="a" href={`tel:${d.makler.tel}`} variant="outline" color="green" size={30} aria-label="Anrufen" title={d.makler.tel}>
                  <IconPhone size={18} />
                </ActionIcon>
              )}
              {d.makler?.email && <MailAuswahl email={d.makler.email} dealId={d.id} kompakt />}
            </Group>,
          )}
        </Group>

        {/* 3 — Datum, Schnellwahl und „Erledigt“ in einer Zeile; nur wenn die Karte sehr schmal wird, rutscht „Erledigt“ darunter */}
        {ohneAuswahl(
          <Group gap={4} wrap="wrap" justify="space-between">
            <TerminWahl kompakt label="Nächster Kontakt Deal" wert={d.nextContact} heute={heute}
              setzen={(iso) => termin.mutate({ version: d.version, nextContact: iso }, { onSuccess: (r) => halten?.({ ...d, nextContact: iso, version: r.version }) })} />
            <Button size="compact-sm" variant="light" color="green" leftSection={<IconCheck size={14} />} loading={erledigt.isPending}
              onClick={() => erledigt.mutate(d.version, { onSuccess: () => loslassen?.(d.id) })}>
              Erledigt
            </Button>
          </Group>,
        )}
        {(erledigt.error ?? termin.error) && <Text size="xs" c="red">{(erledigt.error ?? termin.error)!.message}</Text>}
      </Stack>
    </Card>
  );
}
