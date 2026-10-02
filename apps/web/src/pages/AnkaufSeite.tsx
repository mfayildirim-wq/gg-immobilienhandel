import type { AnkaufCockpit, CockpitDeal, CockpitMakler, ListenAltformat } from '@gg/api-contract';
import { applyFilter, cockpitMitGehaltenen, eingehendUnbekannt, maklerZuTelefon } from '@gg/domain';
import { Alert, Badge, Button, Group, Paper, Progress, SegmentedControl, Stack, Tabs, Text, Title } from '@mantine/core';
import { GeteilteAnsicht } from '../components/GeteilteAnsicht.tsx';
import { Reiterleiste } from '../components/Reiterleiste.tsx';
import { IconLayoutColumns, IconLayoutRows, IconPhoneCall, IconTarget, IconUsers } from '@tabler/icons-react';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { AnrufBriefing } from '../components/ankauf/AnrufBriefing.tsx';
import { DealDetail } from '../components/deal/DealDetail.tsx';
import { PersonaDialog } from '../components/ankauf/PersonaDialog.tsx';
import { DealKarte } from '../components/ankauf/DealKarte.tsx';
import { MaklerKarte } from '../components/ankauf/MaklerKarte.tsx';
import { ABSCHNITTE, FAELLIG_FARBE } from '../components/ankauf/Termin.tsx';
import { Waehlmaschine, type WaehlQuelle } from '../components/ankauf/Waehlmaschine.tsx';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { GespeicherteFilterLeiste, useAktiverFilter } from '../components/GespeicherteFilterLeiste.tsx';
import { useAnkauf, useEinplanen, useListen } from '../lib/api.ts';
import { LAYOUTS, type Layout, useAuswahl, useEinstellung } from '../lib/ansicht.ts';
import { darfVerlassen } from '../lib/ungespeichert.ts';
import { MaklerDetail } from '../components/MaklerDetail.tsx';
import { alsDatum } from '../lib/format.ts';

/** Die beiden Listen der Ankaufseite als Reiter; der zuletzt gewählte wird gemerkt. */
const REITER = ['deals', 'makler'] as const;
type Reiter = (typeof REITER)[number];

const KANAL_ICON: Record<string, string> = { whatsapp: '📱', email: '✉️', anruf: '📞', notiz: '📝' };

/** Tagesfortschritt: höchste Zahl dringender Kontakte dieser Sitzung (sessionStorage, nur Komfort). */
function useFortschritt(heute: string | undefined, reiter: Reiter, dringend: number) {
  const schluessel = `gg.ankauf.start.${reiter}.${heute}`;
  let start = dringend;
  try {
    start = Math.max(dringend, Number(sessionStorage.getItem(schluessel) ?? 0));
    if (heute) sessionStorage.setItem(schluessel, String(start));
  } catch { /* ohne Speicher kein Balken über Neuladen hinweg */ }
  return { start, erledigt: Math.max(0, start - dringend) };
}

/** Vertriebs-Priorität der Deal-Karte (vtDealPrio) — Teil des alten Karteneintrags, nach dem Filter greifen können. */
const DEAL_PRIO: Record<string, { order: number; cls: string; label: string }> = {
  'Closing Path': { order: 0, cls: 'vt-dp-cp', label: 'Closing Path' }, 'Angebot abgegeben': { order: 1, cls: 'vt-dp-ang', label: 'Angebot abgegeben' },
  'In Prüfung': { order: 2, cls: 'vt-dp-pru', label: 'In Prüfung' }, 'Über Zeit nachfassen': { order: 3, cls: 'vt-dp-nf', label: 'Über Zeit nachfassen' },
};

/** Gespeicherter Filter „Ankauf“ auf beide Listen, wie vtRender: Einträge im Altformat samt _freq/_nextDue/_due/_lastC. */
function useGefiltert(data: AnkaufCockpit | undefined, listen: ListenAltformat | undefined): AnkaufCockpit | undefined {
  const filter = useAktiverFilter('ankauf');
  if (!data || !filter) return data;
  const altDeal = new Map((listen?.deals ?? []).map((d) => [d.id as string, d]));
  const altMakler = new Map((listen?.makler ?? []).map((m) => [m.id as string, m]));
  const due = (f: CockpitDeal['faellig']) => ({ cls: f.klasse, label: f.label, sort: f.sort });
  const passt = (item: Record<string, unknown>) => applyFilter([item], filter).length === 1;
  return {
    ...data,
    deals: data.deals.filter((d) => passt({ ...(altDeal.get(d.id) ?? { id: d.id, status: d.status }), _prio: DEAL_PRIO[d.status], _freq: d.nachfassFrequenz || 'Wöchentlich', _nextDue: d.termin, _due: due(d.faellig), _lastC: d.lastContact })),
    makler: data.makler.filter((m) => passt({ ...(altMakler.get(m.id) ?? { id: m.id, prio: m.prio }), _freq: m.kontaktFrequenz || 'Monatlich', _nextDue: m.termin, _due: due(m.faellig), _lastC: m.lastContact })),
  };
}

export function AnkaufSeite() {
  const einplanen = useEinplanen();
  const eingehend = useSearch({ from: '/' }).incoming;
  const navigate = useNavigate();
  const angestossen = useRef(false);
  useEffect(() => {
    if (!angestossen.current) { angestossen.current = true; einplanen.mutate(undefined); }
  }, [einplanen]);
  const { data: roh, isLoading, error } = useAnkauf();
  const { data: listen } = useListen();
  const data = useGefiltert(roh, listen);
  const [briefing, setBriefing] = useState<CockpitMakler | null>(null);
  const [anrufHinweis, setAnrufHinweis] = useState('');
  // Eingehender Anruf (iOS-Kurzbefehl): bekannten Makler ins Briefing holen, sonst die Nummer zeigen
  useEffect(() => {
    if (!eingehend || !data) return;
    const treffer = maklerZuTelefon(data.makler, eingehend);
    if (treffer) setBriefing(treffer);
    else setAnrufHinweis(eingehendUnbekannt(eingehend));
    void navigate({ to: '/', search: {}, replace: true });
  }, [eingehend, data, navigate]);
  const [wmQuelle, setWmQuelle] = useState<WaehlQuelle | null>(null);
  const [stilOffen, setStilOffen] = useState(false);
  const [reiter, setReiter] = useEinstellung<Reiter>('ankauf.reiter', REITER, 'deals');
  // Karten, deren Termin hier gesetzt wurde, bleiben stehen, bis „Erledigt“ sie abschließt (wie in der alten App) —
  // auch wenn sie laut Server nicht mehr fällig sind. Gilt, solange die Ankaufseite offen ist.
  const [dealsGehalten, setDealsGehalten] = useState<Record<string, CockpitDeal>>({});
  const [maklerGehalten, setMaklerGehalten] = useState<Record<string, CockpitMakler>>({});
  const halten = <T extends { id: string; nextContact: string | null; version: number }>(setzen: Dispatch<SetStateAction<Record<string, T>>>) => (karte: T) =>
    setzen((g) => ({ ...g, [karte.id]: g[karte.id] ? { ...g[karte.id]!, nextContact: karte.nextContact, version: karte.version } : karte }));
  const loslassen = <T,>(setzen: Dispatch<SetStateAction<Record<string, T>>>) => (id: string) =>
    setzen((g) => Object.fromEntries(Object.entries(g).filter(([k]) => k !== id)));
  const dealKarten = useMemo(() => cockpitMitGehaltenen(data?.deals ?? [], dealsGehalten), [data, dealsGehalten]);
  const maklerKarten = useMemo(() => cockpitMitGehaltenen(data?.makler ?? [], maklerGehalten), [data, maklerGehalten]);
  // Deals in der Reihenfolge der Abschnitte (heute, überfällig, diese Woche) — der erste ist vorgewählt
  const dealsGeordnet = ABSCHNITTE.flatMap(({ klasse }) => data?.deals.filter((d) => d.faellig.klasse === klasse) ?? []);
  const [dealAuswahl, setDealAuswahl] = useAuswahl(ABSCHNITTE.flatMap(({ klasse }) => dealKarten.filter((d) => d.faellig.klasse === klasse)).map((d) => d.id));
  // Ein anderer Deal baut das Detail neu auf: bei ungespeicherter Kalkulation erst fragen
  const dealWaehlen = (id: string) => { if (id === dealAuswahl || darfVerlassen()) setDealAuswahl(id); };
  const maklerGeordnet = ABSCHNITTE.flatMap(({ klasse }) => data?.makler.filter((m) => m.faellig.klasse === klasse) ?? []);
  const [maklerAuswahl, setMaklerAuswahl] = useAuswahl(ABSCHNITTE.flatMap(({ klasse }) => maklerKarten.filter((m) => m.faellig.klasse === klasse)).map((m) => m.id));
  const [dealLayout, setDealLayout] = useEinstellung<Layout>('ankauf.layout', LAYOUTS, 'nebeneinander');
  const [maklerLayout, setMaklerLayout] = useEinstellung<Layout>('ankauf.makler.layout', LAYOUTS, 'nebeneinander');
  const dealsNebeneinander = dealLayout === 'nebeneinander';
  const maklerNebeneinander = maklerLayout === 'nebeneinander';

  const liste: readonly { faellig: { klasse: string } }[] = (reiter === 'deals' ? data?.deals : data?.makler) ?? [];
  const zaehle = (k: string) => liste.filter((e) => e.faellig.klasse === k).length;
  const dringend = zaehle('heute') + zaehle('ueberfaellig');
  const fortschritt = useFortschritt(data?.heute, reiter, dringend);

  if (error) return <Alert color="red">{error.message}</Alert>;
  if (isLoading || !data) return <Text c="dimmed">Lädt …</Text>;

  return (
    <Stack h="calc(100dvh - 56px - 2 * var(--mantine-spacing-md))" gap="sm">
      {/* Eine Kopfzeile: Titel, Durchwählen und die Zahlen des aktiven Reiters — Deals und Makler sind zwei Listen, nicht eine. */}
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Group gap="md" wrap="wrap" aria-label="Nächste Kontakte" style={{ flex: 1, minWidth: 0 }}>
          <Title order={2}>Ankauf</Title>
          <Button size="sm" leftSection={<IconPhoneCall size={18} />} aria-label="Wählmaschine öffnen"
            onClick={() => setWmQuelle(reiter === 'deals' ? { art: 'deals', deals: dealsGeordnet } : { art: 'makler' })}>
            {reiter === 'deals' ? `Deals durchwählen (${dealsGeordnet.length})` : `Makler durchwählen (${maklerGeordnet.length})`}
          </Button>
          <Text fw={600}>Nächste Kontakte</Text>
          <Group gap={6}><Badge color="red" size="lg">{zaehle('heute')}</Badge><Text size="sm" c="dimmed">heute</Text></Group>
          <Group gap={6}><Badge color="orange" size="lg">{zaehle('ueberfaellig')}</Badge><Text size="sm" c="dimmed">überfällig</Text></Group>
          <Group gap={6}><Badge color="green" size="lg">{zaehle('woche')}</Badge><Text size="sm" c="dimmed">diese Woche</Text></Group>
          {dringend === 0 && <Text size="sm" c="green">✅ Alles erledigt!</Text>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <GespeicherteFilterLeiste modul="ankauf" />
          {reiter === 'makler' && <Button size="xs" variant="light" onClick={() => setStilOffen(true)}>🧠 KI-Stil</Button>}
          {reiter === 'deals'
            ? <Ansichtswahl label="Ansicht Deals" wert={dealLayout} setzen={setDealLayout} />
            : <Ansichtswahl label="Ansicht Makler" wert={maklerLayout} setzen={setMaklerLayout} />}
        </Group>
      </Group>
      {fortschritt.start > 0 && (
        <Group gap="xs">
          <Progress value={(fortschritt.erledigt / fortschritt.start) * 100} color="green" style={{ flex: 1 }} size="sm" />
          <Text size="xs" c="dimmed">{fortschritt.erledigt}/{fortschritt.start} erledigt</Text>
        </Group>
      )}

      <Tabs value={reiter} onChange={(v) => v && v !== reiter && darfVerlassen() && setReiter(v as Reiter)} keepMounted={false} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Reiterleiste>
          <Tabs.Tab value="deals" leftSection={<IconTarget size={16} />} rightSection={<Badge size="sm" color={data.deals.length ? 'red' : 'gray'}>{data.deals.length}</Badge>}>Deals kontaktieren</Tabs.Tab>
          <Tabs.Tab value="makler" leftSection={<IconUsers size={16} />} rightSection={<Badge size="sm" color={data.makler.length ? 'red' : 'gray'}>{data.makler.length}</Badge>}>Makler kontaktieren</Tabs.Tab>
        </Reiterleiste>

        <Tabs.Panel value="deals" pt="sm" style={{ flex: 1, minHeight: 0 }}>
          <GeteilteAnsicht
            schluessel="ankauf.deals" layout={dealLayout} listeLabel="Deal-Liste" detailLabel="Deal-Detail"
            liste={
              <Spalte titel="🎯 Deals nachverfolgen" anzahl={data.deals.length} leer="Keine Deals diese Woche">
                {ABSCHNITTE.map(({ klasse, titel }) => (
                  <Abschnitt key={klasse} klasse={klasse} titel={titel} eintraege={dealKarten.filter((d) => d.faellig.klasse === klasse)}
                    karte={(d: CockpitDeal) => <DealKarte key={d.id} d={d} heute={data.heute} aktiv={d.id === dealAuswahl} waehlen={dealWaehlen}
                      halten={halten(setDealsGehalten)} loslassen={loslassen(setDealsGehalten)} />} />
                ))}
              </Spalte>
            }
            detail={dealAuswahl
              ? <DealDetail key={dealAuswahl} id={dealAuswahl} start="kommunikation" />
              : <Text c="dimmed">Deal in der Liste wählen.</Text>}
          />
        </Tabs.Panel>

        <Tabs.Panel value="makler" pt="sm" style={{ flex: 1, minHeight: 0 }}>
          <GeteilteAnsicht
            schluessel="ankauf.makler" layout={maklerLayout} listeLabel="Makler-Liste" detailLabel="Makler-Detail"
            liste={
              <Spalte titel="🤝 Makler kontaktieren" anzahl={data.makler.length} leer="Keine Makler diese Woche">
                {ABSCHNITTE.map(({ klasse, titel }) => (
                  <Abschnitt key={klasse} klasse={klasse} titel={titel} eintraege={maklerKarten.filter((m) => m.faellig.klasse === klasse)}
                    karte={(m: CockpitMakler) => <MaklerKarte key={m.id} m={m} heute={data.heute} anrufen={setBriefing} stilOeffnen={() => setStilOffen(true)} aktiv={m.id === maklerAuswahl} waehlen={setMaklerAuswahl}
                      halten={halten(setMaklerGehalten)} loslassen={loslassen(setMaklerGehalten)} />} />
                ))}
              </Spalte>
            }
            detail={maklerAuswahl ? <MaklerDetail key={maklerAuswahl} id={maklerAuswahl} start="komm" /> : <Text c="dimmed">Makler in der Liste wählen.</Text>}
          />
        </Tabs.Panel>
      </Tabs>

      {data.tageslog.length > 0 && (
        <Paper withBorder p="sm" aria-label="Heute erledigt" style={{ flexShrink: 0, maxHeight: '22%', overflow: 'auto' }}>
          <Title order={5} mb="xs">📋 Heute erledigt</Title>
          {data.tageslog.map((e, i) => (
            <Group key={`${e.zeitpunkt}-${i}`} gap="sm" wrap="nowrap" py={4} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Text size="xs" c="dimmed" w={40}>{alsDatum(e.zeitpunkt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</Text>
              <Text size="sm">
                {e.art === 'makler' ? '🤝' : '🏘️'} {e.titel} — {e.art === 'makler' ? `${KANAL_ICON[e.kanal ?? ''] ?? '📝'} ` : ''}{e.text.slice(0, 60)}{e.text.length > 60 ? '…' : ''}
              </Text>
            </Group>
          ))}
        </Paper>
      )}

      {anrufHinweis && (
        <Alert color="blue" withCloseButton onClose={() => setAnrufHinweis('')} data-anruf-hinweis>
          {anrufHinweis}
        </Alert>
      )}
      <AnrufBriefing makler={briefing} heute={data.heute} schliessen={() => setBriefing(null)} />
      <Waehlmaschine offen={wmQuelle !== null} schliessen={() => setWmQuelle(null)} heute={data.heute} quelle={wmQuelle ?? undefined} />
      <PersonaDialog offen={stilOffen} schliessen={() => setStilOffen(false)} />
    </Stack>
  );
}

/** Liste und Detail nebeneinander oder untereinander — wie auf den Listenseiten. */
function Ansichtswahl({ label, wert, setzen }: { label: string; wert: Layout; setzen: (l: Layout) => void }) {
  return (
    <SegmentedControl
      aria-label={label}
      value={wert}
      onChange={(v) => setzen(v as Layout)}
      data={[
        { value: 'nebeneinander', label: <IconLayoutColumns size={16} aria-label="nebeneinander" /> },
        { value: 'untereinander', label: <IconLayoutRows size={16} aria-label="untereinander" /> },
      ]}
    />
  );
}

/** Die Liste eines Reiters. Der Titel ist nur der Name des Bereichs — sichtbar stehen Titel und Zahl schon am Reiter. */
function Spalte({ titel, anzahl, leer, children }: { titel: string; anzahl: number; leer: string; children: React.ReactNode }) {
  return (
    <Paper withBorder p="sm" component="section" aria-label={titel}>
      {anzahl === 0 ? (
        <Stack align="center" py="xl" gap={4}><Text size="xl">✅</Text><Text fw={600}>Alles erledigt</Text><Text size="sm" c="dimmed">{leer}</Text></Stack>
      ) : (
        <Stack gap="sm">{children}</Stack>
      )}
    </Paper>
  );
}

function Abschnitt<T>({ klasse, titel, eintraege, karte }: { klasse: keyof typeof FAELLIG_FARBE; titel: string; eintraege: T[]; karte: (e: T) => React.ReactNode }) {
  if (!eintraege.length) return null;
  return (
    <Stack gap="xs">
      <Group gap={6}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: `var(--mantine-color-${FAELLIG_FARBE[klasse]}-6)` }} />
        <Text size="sm" fw={700} c={FAELLIG_FARBE[klasse]}>{titel}</Text>
      </Group>
      {eintraege.map(karte)}
    </Stack>
  );
}
