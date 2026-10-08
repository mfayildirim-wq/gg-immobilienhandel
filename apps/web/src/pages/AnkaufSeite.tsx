import type { AnkaufCockpit, CockpitDeal, CockpitMakler, ListenAltformat } from '@gg/api-contract';
import { applyFilter, cockpitMitGehaltenen, eingehendUnbekannt, maklerZuTelefon } from '@gg/domain';
import { Alert, Badge, Button, Group, Paper, Progress, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { AnsichtMenue } from '../components/AnsichtMenue.tsx';
import { GeteilteAnsicht } from '../components/GeteilteAnsicht.tsx';
import { Reiterleiste } from '../components/Reiterleiste.tsx';
import { IconPhone, IconPhoneCall, IconTarget, IconUsers } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnrufBriefing } from '../components/ankauf/AnrufBriefing.tsx';
import { DealDetail } from '../components/deal/DealDetail.tsx';
import { PersonaDialog } from '../components/ankauf/PersonaDialog.tsx';
import { DealKarte } from '../components/ankauf/DealKarte.tsx';
import { MaklerKarte } from '../components/ankauf/MaklerKarte.tsx';
import { ABSCHNITTE, FAELLIG_FARBE } from '../components/ankauf/Termin.tsx';
import { Waehlmaschine, type WaehlQuelle } from '../components/ankauf/Waehlmaschine.tsx';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useAktiverFilter } from '../components/GespeicherteFilterLeiste.tsx';
import { useAnkauf, useEinplanen, useListen } from '../lib/api.ts';
import { LAYOUTS, type Layout, useAuswahl, useEinstellung } from '../lib/ansicht.ts';
import { darfVerlassen } from '../lib/ungespeichert.ts';
import { gehalteneKarten, useGehalteneKarten } from '../lib/gehalteneKarten.ts';
import { MaklerDetail } from '../components/MaklerDetail.tsx';
import { alsDatum } from '../lib/format.ts';

/** Die beiden Listen der Ankaufseite als Reiter; der zuletzt gewählte wird gemerkt. */
const REITER = ['deals', 'makler'] as const;
type Reiter = (typeof REITER)[number];

/** Zahlen im Kopf der Liste: nur die Zahl im farbigen Rahmen, die Bedeutung steht im Hinweis beim Überfahren. */
const ZAHLEN = [{ klasse: 'heute', hinweis: 'heute' }, { klasse: 'ueberfaellig', hinweis: 'überfällig' }, { klasse: 'woche', hinweis: 'diese Woche' }] as const;

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
  // Karten, deren Termin gesetzt wurde (auf der Karte oder rechts im Deal-Detail), bleiben stehen, bis „Erledigt“ sie
  // abschließt (wie in der alten App) — auch wenn sie laut Server nicht mehr fällig sind. Gilt, solange die Seite offen ist.
  useEffect(() => { gehalteneKarten.leeren(); return () => gehalteneKarten.leeren(); }, []);
  const gehalten = useGehalteneKarten();
  const dealKarten = useMemo(() => cockpitMitGehaltenen(data?.deals ?? [], gehalteneKarten.karten('deals', data?.deals ?? []), gehalteneKarten.reihenfolge('deals')), [data, gehalten]);
  const maklerKarten = useMemo(() => cockpitMitGehaltenen(data?.makler ?? [], gehalteneKarten.karten('makler', data?.makler ?? []), gehalteneKarten.reihenfolge('makler')), [data, gehalten]);
  // Was gerade zu sehen ist, merken: so hält ein Termin aus dem Deal-Detail die Karte an ihrem bisherigen Platz fest
  gehalteneKarten.angezeigt('deals', dealKarten);
  gehalteneKarten.angezeigt('makler', maklerKarten);
  // Deals in der Reihenfolge der Abschnitte (heute, überfällig, diese Woche) — der erste ist vorgewählt
  const dealsGeordnet = ABSCHNITTE.flatMap(({ klasse }) => data?.deals.filter((d) => d.faellig.klasse === klasse) ?? []);
  const [dealAuswahl, setDealAuswahl] = useAuswahl(ABSCHNITTE.flatMap(({ klasse }) => dealKarten.filter((d) => d.faellig.klasse === klasse)).map((d) => d.id));
  // Ein anderer Deal baut das Detail neu auf: bei ungespeicherter Kalkulation erst fragen
  const dealWaehlen = (id: string) => { if (id === dealAuswahl || darfVerlassen()) setDealAuswahl(id); };
  const maklerGeordnet = ABSCHNITTE.flatMap(({ klasse }) => data?.makler.filter((m) => m.faellig.klasse === klasse) ?? []);
  const [maklerAuswahl, setMaklerAuswahl] = useAuswahl(ABSCHNITTE.flatMap(({ klasse }) => maklerKarten.filter((m) => m.faellig.klasse === klasse)).map((m) => m.id));
  const [dealLayout, setDealLayout] = useEinstellung<Layout>('ankauf.layout', LAYOUTS, 'nebeneinander');
  const [maklerLayout, setMaklerLayout] = useEinstellung<Layout>('ankauf.makler.layout', LAYOUTS, 'nebeneinander');

  const liste: readonly { faellig: { klasse: string } }[] = (reiter === 'deals' ? data?.deals : data?.makler) ?? [];
  const zaehle = (k: string) => liste.filter((e) => e.faellig.klasse === k).length;
  const dringend = zaehle('heute') + zaehle('ueberfaellig');
  const fortschritt = useFortschritt(data?.heute, reiter, dringend);

  if (error) return <Alert color="red">{error.message}</Alert>;
  if (isLoading || !data) return <Text c="dimmed">Lädt …</Text>;

  // Fester Kopf über der Liste des aktiven Reiters: Durchwählen und die Zahlen — Deals und Makler sind zwei Listen, nicht eine.
  const listenKopf = (
    <Stack gap={6}>
      <Group gap="xs" wrap="wrap" aria-label="Nächste Kontakte">
        {/* Durchwählen als Symbol: Telefon, drei Punkte, Telefon — einer nach dem anderen. Nur grüner Rahmen; der Text steht im Hinweis. */}
        <Tooltip label={reiter === 'deals' ? `Deals durchwählen (${dealsGeordnet.length})` : `Makler durchwählen (${maklerGeordnet.length})`}>
          <Button size="xs" px="xs" variant="outline" color="green" aria-label="Wählmaschine öffnen" data-durchwaehlen={reiter}
            onClick={() => setWmQuelle(reiter === 'deals' ? { art: 'deals', deals: dealsGeordnet } : { art: 'makler' })}>
            <Group gap={6} wrap="nowrap" align="center">
              <IconPhone size={16} />
              <span aria-hidden data-punkte style={{ letterSpacing: 4, fontSize: 20, lineHeight: '16px' }}>•••</span>
              <IconPhoneCall size={16} />
            </Group>
          </Button>
        </Tooltip>
        {ZAHLEN.map(({ klasse, hinweis }) => (
          <Tooltip key={klasse} label={hinweis}>
            <Badge variant="outline" color={FAELLIG_FARBE[klasse]} size="lg" data-zahl={klasse} aria-label={`${zaehle(klasse)} ${hinweis}`}>{zaehle(klasse)}</Badge>
          </Tooltip>
        ))}
        {dringend === 0 && <Text size="xs" c="green">✅ Alles erledigt!</Text>}
        {reiter === 'makler' && <Button size="xs" variant="light" ml="auto" onClick={() => setStilOffen(true)}>🧠 KI-Stil</Button>}
      </Group>
      {fortschritt.start > 0 && (
        <Group gap="xs" wrap="nowrap">
          <Progress value={(fortschritt.erledigt / fortschritt.start) * 100} color="green" style={{ flex: 1 }} size="sm" />
          <Text size="xs" c="dimmed">{fortschritt.erledigt}/{fortschritt.start} erledigt</Text>
        </Group>
      )}
    </Stack>
  );

  return (
    <Stack h="calc(100dvh - 56px - 2 * var(--mantine-spacing-md))" gap="sm">
      {/* Die Seite steht als Brotkrume in der Kopfzeile; Ansicht und Filter liegen dort im Menü. */}
      {reiter === 'deals'
        ? <AnsichtMenue filterModul="ankauf" ansichtLabel="Ansicht Deals" layout={dealLayout} setLayout={setDealLayout} />
        : <AnsichtMenue filterModul="ankauf" ansichtLabel="Ansicht Makler" layout={maklerLayout} setLayout={setMaklerLayout} />}
      <Tabs value={reiter} onChange={(v) => v && v !== reiter && darfVerlassen() && setReiter(v as Reiter)} keepMounted={false} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Reiterleiste>
          <Tabs.Tab value="deals" fw={700} leftSection={<IconTarget size={16} />} rightSection={<Badge size="sm" variant="transparent" color={data.deals.length ? 'red' : 'gray'} data-anzahl>{data.deals.length}</Badge>}>Deals kontaktieren</Tabs.Tab>
          <Tabs.Tab value="makler" fw={700} leftSection={<IconUsers size={16} />} rightSection={<Badge size="sm" variant="transparent" color={data.makler.length ? 'red' : 'gray'} data-anzahl>{data.makler.length}</Badge>}>Makler kontaktieren</Tabs.Tab>
        </Reiterleiste>

        <Tabs.Panel value="deals" pt="sm" style={{ flex: 1, minHeight: 0 }}>
          <GeteilteAnsicht
            schluessel="ankauf.deals" layout={dealLayout} listeLabel="Deal-Liste" detailLabel="Deal-Detail" listeKopf={listenKopf}
            liste={
              <Spalte titel="🎯 Deals nachverfolgen" anzahl={data.deals.length} leer="Keine Deals diese Woche">
                {ABSCHNITTE.map(({ klasse, titel }) => (
                  <Abschnitt key={klasse} klasse={klasse} titel={titel} eintraege={dealKarten.filter((d) => d.faellig.klasse === klasse)}
                    karte={(d: CockpitDeal) => <DealKarte key={d.id} d={d} heute={data.heute} aktiv={d.id === dealAuswahl} waehlen={dealWaehlen}
 />} />
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
            schluessel="ankauf.makler" layout={maklerLayout} listeLabel="Makler-Liste" detailLabel="Makler-Detail" listeKopf={listenKopf}
            liste={
              <Spalte titel="🤝 Makler kontaktieren" anzahl={data.makler.length} leer="Keine Makler diese Woche">
                {ABSCHNITTE.map(({ klasse, titel }) => (
                  <Abschnitt key={klasse} klasse={klasse} titel={titel} eintraege={maklerKarten.filter((m) => m.faellig.klasse === klasse)}
                    karte={(m: CockpitMakler) => <MaklerKarte key={m.id} m={m} heute={data.heute} anrufen={setBriefing} stilOeffnen={() => setStilOffen(true)} aktiv={m.id === maklerAuswahl} waehlen={setMaklerAuswahl}
 />} />
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
