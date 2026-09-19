import type { DealDetail } from '@gg/api-contract';
import { DEAL_STATUS, DealStatus, dublettenObjekt, FREQUENZEN, isoPlusTage, maklerMailBetreff, NAECHSTER_KONTAKT_KNOEPFE, nachfassStand, naechsterKontaktNachFrequenz, normalisiereFrequenz } from '@gg/domain';
import { Alert, Anchor, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Timeline, Title } from '@mantine/core';
import { IconArrowRight, IconCheck, IconMail, IconTrash } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { ObjektFotos } from '../ObjektFotos.tsx';
import { useState } from 'react';
import {
  useDealErledigt,
  useDealInfoAendern,
  useDealLoeschen,
  useDealObjektWechseln,
  useObjektAnlegen,
  useObjekte,
  useKommentarAnlegen,
  useMakler,
  useStatusAendern,
  useStatusHistorie,
} from '../../lib/api.ts';
import { heuteIso } from '../../lib/ansicht.ts';
import { datumDe, zeitpunktDe, zeitpunktLog } from '../../lib/format.ts';

const FARBE = { ueberfaellig: 'orange', heute: 'red', woche: 'green' } as const;

/** Info-Felder werden wie in der alten App sofort gespeichert (jede Änderung eine Version). */
export function DealUebersicht({ deal }: { deal: DealDetail }) {
  const aendern = useDealInfoAendern(deal.id);
  const status = useStatusAendern();
  const erledigt = useDealErledigt(deal.id);
  const { data: makler = [] } = useMakler();
  const { data: objekte = [] } = useObjekte();
  const objektWechseln = useDealObjektWechseln(deal.id);
  const objektAnlegen = useObjektAnlegen();
  const loeschen = useDealLoeschen();
  const navigate = useNavigate();
  const fehler = aendern.error ?? status.error ?? erledigt.error ?? objektWechseln.error ?? objektAnlegen.error ?? loeschen.error;
  const mk = makler.find((m) => m.id === deal.makler?.id);
  const obj = objekte.find((o) => o.id === deal.objekt.id);
  const speichern = (felder: Omit<Parameters<typeof aendern.mutate>[0], 'version'>) => aendern.mutate({ version: deal.version, ...felder });
  const stand = nachfassStand({ nextContact: deal.nextContact, lastContact: deal.lastContact, frequenz: deal.nachfassFrequenz }, heuteIso());

  return (
    <Stack>
      {fehler && (
        <Alert color="red" title="Nicht gespeichert">
          {fehler.message}
        </Alert>
      )}
      <ObjektFotos objektId={deal.objekt.id} />
      <Paper withBorder p="sm" aria-label="Verknüpfung">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Stack gap={4}>
            <Select
              label="🏢 Objekt"
              searchable
              allowDeselect={false}
              value={deal.objekt.id}
              data={objekte.map((o) => ({
                value: o.id,
                label: `${[o.strasse, o.stadt].filter(Boolean).join(', ') || `#${o.id.slice(-4)}`}${o.angebotspreis ? ` · ${o.angebotspreis.toLocaleString('de-DE')}€` : ''}${o.wohnflaeche ? ` · ${o.wohnflaeche.toLocaleString('de-DE')}m²` : ''}`,
              }))}
              onChange={(v) => {
                if (!v || v === deal.objekt.id) return;
                if (window.confirm('Objekt wechseln? Kaufpreis, Wohnfläche und Einheiten der Kalkulation werden aus dem neuen Objekt vorbelegt.')) objektWechseln.mutate({ objektId: v, version: deal.version });
              }}
            />
            <Group gap="xs">
              <Button size="compact-xs" variant="default" rightSection={<IconArrowRight size={12} />} onClick={() => navigate({ to: '/objekte', search: { objekt: deal.objekt.id } })}>Öffnen</Button>
              <Button size="compact-xs" variant="subtle" onClick={() => {
                const adresse = window.prompt('Adresse (Straße + Hausnummer):');
                if (adresse === null) return;
                const stadt = window.prompt('Stadt:') || '';
                const dublette = dublettenObjekt(objekte.map((o) => ({ ...o, strasse: o.strasse ?? '', hausnr: o.hausnr ?? '', stadt: o.stadt ?? '' })), { strasse: adresse.trim(), stadt: stadt.trim() });
                if (dublette && !window.confirm(`Ähnliches Objekt existiert: "${[dublette.match.strasse, dublette.match.hausnr].filter(Boolean).join(' ')}, ${dublette.match.stadt || ''}"\n\nTrotzdem neu anlegen?`)) return;
                objektAnlegen.mutate({ strasse: adresse.trim(), stadt: stadt.trim() }, {
                  onSuccess: (o: { id: string }) => objektWechseln.mutate({ objektId: o.id, version: deal.version }),
                });
              }}>＋ Neu anlegen</Button>
            </Group>
          </Stack>
          <Stack gap={4}>
            <Select
              label="🤝 Makler"
              placeholder="Makler suchen…"
              clearable
              searchable
              value={deal.makler?.id ?? null}
              data={makler.map((m) => ({ value: m.id, label: `${m.name || '–'}${m.firma ? ` (${m.firma})` : ''}` }))}
              // dealMaklerFilter: Name, Firma oder Telefon (ohne Leer- und Bindestriche)
              filter={({ options, search }) => {
                const q = search.toLowerCase();
                const tel = (id: string) => (makler.find((m) => m.id === id)?.tel ?? '').replace(/[\s-]/g, '');
                return (options as { value: string; label: string }[]).filter((o) => o.label.toLowerCase().includes(q) || tel(o.value).includes(q.replace(/[\s-]/g, '')));
              }}
              onChange={(v) => speichern({ maklerId: v })}
            />
            <Group gap="xs">
              {deal.makler && <Button size="compact-xs" variant="default" rightSection={<IconArrowRight size={12} />} onClick={() => navigate({ to: '/makler', search: { makler: deal.makler!.id } })}>Öffnen</Button>}
              {mk?.email && (
                <Anchor size="sm" href={`mailto:${mk.email}?subject=${encodeURIComponent(maklerMailBetreff({ adresse: obj?.strasse, hausnr: obj?.hausnr, stadt: obj?.stadt }))}`} target="_blank">
                  <Group gap={4}><IconMail size={14} />E-Mail an Makler</Group>
                </Anchor>
              )}
            </Group>
          </Stack>
        </SimpleGrid>
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <Select
          label="Status"
          data={[...DEAL_STATUS]}
          value={deal.status}
          allowDeselect={false}
          onChange={(v) => {
            const s = DealStatus.safeParse(v);
            if (s.success) status.mutate({ id: deal.id, status: s.data, version: deal.version });
          }}
        />
        <TextInput
          label="Angebotsdatum"
          type="date"
          value={deal.angebotsDatum ?? ''}
          onChange={(e) => speichern({ angebotsDatum: e.currentTarget.value || null })}
        />
        <Select label="Priorität" clearable data={['A', 'B', 'C']} value={deal.prio} onChange={(v) => speichern({ prio: v })} />
      </SimpleGrid>

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
              <Button size="xs" variant="light" leftSection={<IconCheck size={14} />} loading={erledigt.isPending} onClick={() => erledigt.mutate(deal.version)}>
                Erledigt
              </Button>
            </Group>
          </Stack>
        </SimpleGrid>
      </Paper>

      <Kommentare deal={deal} />
      <Verlauf dealId={deal.id} />
      <Group justify="flex-end">
        <Button color="red" variant="light" leftSection={<IconTrash size={16} />} loading={loeschen.isPending}
          onClick={() => window.confirm('Deal in den Papierkorb verschieben?') && loeschen.mutate(deal.id, { onSuccess: () => navigate({ to: '/deals', search: {} }) })}>Löschen</Button>
      </Group>
    </Stack>
  );
}

function Kommentare({ deal }: { deal: DealDetail }) {
  const anlegen = useKommentarAnlegen(deal.id);
  const [text, setText] = useState('');
  return (
    <section aria-label="Kommentare">
      <Title order={5} mb="xs">
        📝 Gesprächslog
      </Title>
      <Group align="flex-end" gap="xs" mb="sm">
        <Textarea placeholder="Neue Gesprächsnotiz…" autosize minRows={2} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Neue Gesprächsnotiz" />
        <Button disabled={!text.trim()} loading={anlegen.isPending} onClick={() => anlegen.mutate(text, { onSuccess: () => setText('') })}>
          + Eintrag
        </Button>
      </Group>
      <Stack gap={6}>
        {deal.kommentare.length === 0 && (
          <Text c="dimmed" size="sm">
            Noch keine Einträge.
          </Text>
        )}
        {deal.kommentare.map((k) => (
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

function Verlauf({ dealId }: { dealId: string }) {
  const { data: verlauf = [] } = useStatusHistorie(dealId);
  return (
    <section aria-label="Status-Verlauf">
      <Title order={5} mb="xs">
        Status-Verlauf
      </Title>
      <Timeline bulletSize={14} lineWidth={2}>
        {verlauf.map((v) => (
          <Timeline.Item key={v.id} title={v.nachStatus}>
            <Text size="xs" c="dimmed">
              {zeitpunktDe(v.am)} · {v.vonStatus ? `von ${v.vonStatus}` : 'angelegt'} · {v.quelle}
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </section>
  );
}
